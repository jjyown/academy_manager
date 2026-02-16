"""OCR 엔진: EasyOCR + Gemini AI 더블체크"""
import logging
import json
import base64
from typing import Any

logger = logging.getLogger(__name__)

_easyocr_reader = None


def _get_easyocr():
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(["ko", "en"], gpu=False)
        logger.info("EasyOCR 초기화 완료")
    return _easyocr_reader


def ocr_easyocr(image_bytes: bytes) -> list[dict]:
    """EasyOCR로 이미지에서 텍스트 인식"""
    import numpy as np
    from PIL import Image
    import io

    reader = _get_easyocr()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(image)

    results = reader.readtext(img_array)
    parsed = []
    for bbox, text, conf in results:
        parsed.append({
            "text": text.strip(),
            "confidence": round(conf * 100, 2),
            "bbox": bbox,
            "center_x": (bbox[0][0] + bbox[2][0]) / 2,
            "center_y": (bbox[0][1] + bbox[2][1]) / 2,
        })
    return parsed


async def ocr_gemini(image_bytes: bytes) -> list[dict]:
    """Gemini Vision으로 이미지에서 텍스트/답안 인식 (더블체크용)"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt = """이 학생 답안지 이미지에서 문제 번호와 학생이 적은 답을 추출해주세요.

규칙:
- 객관식: 번호와 보기 번호(①②③④⑤ 또는 1,2,3,4,5)
- 단답형: 번호와 답 텍스트
- 서술형: 번호와 작성한 내용 요약

반드시 아래 JSON 형식으로만 응답하세요:
{"answers": {"1": "③", "2": "①", "3": "답텍스트", ...}}"""

    try:
        response = model.generate_content([
            prompt,
            {"mime_type": "image/jpeg", "data": b64}
        ])
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        return result.get("answers", {})
    except Exception as e:
        logger.error(f"Gemini OCR 실패: {e}")
        return {}


def double_check_ocr(image_bytes: bytes) -> dict:
    """EasyOCR로 1차 인식 (동기). Gemini 더블체크는 채점 시 별도 호출"""
    ocr1_results = ocr_easyocr(image_bytes)

    full_text_1 = " ".join([r["text"] for r in ocr1_results])
    answers1 = _extract_answers_from_ocr(ocr1_results)

    return {
        "ocr1": ocr1_results,
        "full_text_1": full_text_1,
        "full_text_2": "",
        "answers": {
            q: {
                "answer": answers1.get(q, ""),
                "ocr1": answers1.get(q, ""),
                "ocr2": "",
                "match": False,
                "confidence": answers1.get(f"{q}_conf", 0),
            }
            for q in answers1 if not q.endswith("_conf")
        },
    }


async def double_check_ocr_with_gemini(image_bytes: bytes) -> dict:
    """EasyOCR + Gemini Vision 더블체크 (비동기)"""
    ocr1_results = ocr_easyocr(image_bytes)
    full_text_1 = " ".join([r["text"] for r in ocr1_results])
    answers1 = _extract_answers_from_ocr(ocr1_results)

    # Gemini Vision으로 2차 인식
    gemini_answers = await ocr_gemini(image_bytes)

    # 더블체크 결합
    all_questions = set(
        [q for q in answers1 if not q.endswith("_conf")] +
        list(gemini_answers.keys())
    )

    combined = {}
    for q in sorted(all_questions, key=lambda x: int(x) if x.isdigit() else 0):
        a1 = answers1.get(q, "")
        a2 = str(gemini_answers.get(q, ""))
        c1 = answers1.get(f"{q}_conf", 0)

        match = a1 == a2 and a1 != ""
        if match:
            final = a1
            conf = min(c1 + 10, 100)
        elif a2 and not a1:
            final = a2
            conf = 75
        elif a1 and not a2:
            final = a1
            conf = c1 * 0.8
        else:
            # 둘 다 있지만 불일치
            final = a2 if a2 else a1
            conf = 50

        combined[q] = {
            "answer": final,
            "ocr1": a1,
            "ocr2": a2,
            "match": match,
            "confidence": round(conf, 2),
        }

    return {
        "ocr1": ocr1_results,
        "full_text_1": full_text_1,
        "full_text_2": json.dumps(gemini_answers, ensure_ascii=False),
        "answers": combined,
    }


def _extract_answers_from_ocr(ocr_results: list[dict]) -> dict:
    """OCR 결과에서 문제번호+답 패턴 추출"""
    import re
    answers = {}

    for item in ocr_results:
        text = item["text"]
        conf = item["confidence"]

        patterns = [
            r"(\d+)\s*[.)]\s*([①②③④⑤])",
            r"(\d+)\s*[.)]\s*(\d)",
            r"(\d+)\s*[.)]\s*([가-힣]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                q_num = match.group(1)
                answer = match.group(2)
                answers[q_num] = answer
                answers[f"{q_num}_conf"] = conf
                break

    return answers
