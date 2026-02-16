"""OCR 엔진: Gemini Vision API 기반 (경량화)"""
import logging
import json
import base64

logger = logging.getLogger(__name__)


async def ocr_gemini(image_bytes: bytes) -> dict:
    """Gemini Vision으로 이미지에서 문제번호+답안 인식"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt = """이 학생 답안지 이미지를 분석해주세요.

추출 규칙:
- 객관식: 문제 번호와 선택한 보기 (①②③④⑤ 또는 1,2,3,4,5)
- 단답형: 문제 번호와 답 텍스트
- 서술형: 문제 번호와 작성한 내용 전체

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"answers": {"1": "③", "2": "①", "3": "답텍스트"}, "full_text": "전체 인식된 텍스트"}"""

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
        return {
            "answers": result.get("answers", {}),
            "full_text": result.get("full_text", ""),
        }
    except Exception as e:
        logger.error(f"Gemini OCR 실패: {e}")
        return {"answers": {}, "full_text": ""}


async def ocr_gemini_double_check(image_bytes: bytes) -> dict:
    """Gemini Vision 더블체크: 2번 독립 호출하여 결과 비교"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt1 = """학생 답안지에서 문제 번호와 학생이 적은 답을 추출하세요.
객관식은 ①②③④⑤ 형태, 단답형은 텍스트, 서술형은 전체 내용.
JSON만 응답: {"answers": {"1": "③", "2": "①"}, "full_text": "..."}"""

    prompt2 = """이 사진은 학생의 시험/숙제 답안지입니다.
각 문제의 번호와 학생이 선택하거나 작성한 답을 정확히 읽어주세요.
JSON만 응답: {"answers": {"1": "③", "2": "①"}, "full_text": "..."}"""

    model = genai.GenerativeModel("gemini-2.0-flash")
    image_part = {"mime_type": "image/jpeg", "data": b64}

    # 1차 인식
    try:
        res1 = model.generate_content([prompt1, image_part])
        text1 = _parse_json_response(res1.text)
    except Exception as e:
        logger.error(f"Gemini 1차 OCR 실패: {e}")
        text1 = {"answers": {}, "full_text": ""}

    # 2차 인식 (다른 프롬프트)
    try:
        res2 = model.generate_content([prompt2, image_part])
        text2 = _parse_json_response(res2.text)
    except Exception as e:
        logger.error(f"Gemini 2차 OCR 실패: {e}")
        text2 = {"answers": {}, "full_text": ""}

    answers1 = text1.get("answers", {})
    answers2 = text2.get("answers", {})

    # 더블체크 결합
    all_questions = set(list(answers1.keys()) + list(answers2.keys()))
    combined = {}

    for q in sorted(all_questions, key=lambda x: int(x) if x.isdigit() else 0):
        a1 = str(answers1.get(q, ""))
        a2 = str(answers2.get(q, ""))

        match = a1 == a2 and a1 != ""
        if match:
            final = a1
            conf = 95
        elif a1 and a2:
            final = a1
            conf = 60
        elif a1:
            final = a1
            conf = 75
        elif a2:
            final = a2
            conf = 75
        else:
            final = ""
            conf = 0

        combined[q] = {
            "answer": final,
            "ocr1": a1,
            "ocr2": a2,
            "match": match,
            "confidence": conf,
        }

    return {
        "full_text_1": text1.get("full_text", ""),
        "full_text_2": text2.get("full_text", ""),
        "answers": combined,
    }


def _parse_json_response(text: str) -> dict:
    """Gemini 응답에서 JSON 추출"""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return {"answers": {}, "full_text": ""}
