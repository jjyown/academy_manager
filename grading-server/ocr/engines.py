"""OCR 엔진: EasyOCR + PaddleOCR 더블체크"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

_easyocr_reader = None
_paddleocr_engine = None


def _get_easyocr():
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(["ko", "en"], gpu=False)
        logger.info("EasyOCR 초기화 완료")
    return _easyocr_reader


def _get_paddleocr():
    global _paddleocr_engine
    if _paddleocr_engine is None:
        from paddleocr import PaddleOCR
        _paddleocr_engine = PaddleOCR(lang="korean", use_gpu=False, show_log=False)
        logger.info("PaddleOCR 초기화 완료")
    return _paddleocr_engine


def ocr_easyocr(image_bytes: bytes) -> list[dict]:
    """EasyOCR로 이미지에서 텍스트 인식

    Returns:
        [{"text": "③", "confidence": 0.95, "bbox": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]}, ...]
    """
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


def ocr_paddleocr(image_bytes: bytes) -> list[dict]:
    """PaddleOCR로 이미지에서 텍스트 인식

    Returns:
        [{"text": "③", "confidence": 0.95, "bbox": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]}, ...]
    """
    import numpy as np
    from PIL import Image
    import io

    engine = _get_paddleocr()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(image)

    result = engine.ocr(img_array, cls=True)
    parsed = []
    if result and result[0]:
        for line in result[0]:
            bbox = line[0]
            text = line[1][0].strip()
            conf = line[1][1]
            parsed.append({
                "text": text,
                "confidence": round(conf * 100, 2),
                "bbox": bbox,
                "center_x": (bbox[0][0] + bbox[2][0]) / 2,
                "center_y": (bbox[0][1] + bbox[2][1]) / 2,
            })
    return parsed


def double_check_ocr(image_bytes: bytes) -> dict:
    """두 OCR 엔진으로 더블체크

    Returns:
        {
            "ocr1": [...],  # EasyOCR 결과
            "ocr2": [...],  # PaddleOCR 결과
            "full_text_1": "전체 텍스트",
            "full_text_2": "전체 텍스트",
            "answers": {    # 문제번호별 답안 추출
                "1": {"answer": "③", "ocr1": "③", "ocr2": "③", "match": True, "confidence": 95.0},
                ...
            }
        }
    """
    ocr1_results = ocr_easyocr(image_bytes)
    ocr2_results = ocr_paddleocr(image_bytes)

    full_text_1 = " ".join([r["text"] for r in ocr1_results])
    full_text_2 = " ".join([r["text"] for r in ocr2_results])

    # 문제번호별 답안 추출 시도
    answers1 = _extract_answers_from_ocr(ocr1_results)
    answers2 = _extract_answers_from_ocr(ocr2_results)

    # 더블체크 결합
    all_questions = set(list(answers1.keys()) + list(answers2.keys()))
    combined = {}
    for q in sorted(all_questions, key=lambda x: int(x) if x.isdigit() else 0):
        a1 = answers1.get(q, "")
        a2 = answers2.get(q, "")
        c1 = answers1.get(f"{q}_conf", 0)
        c2 = answers2.get(f"{q}_conf", 0)

        match = a1 == a2 and a1 != ""
        # 최종 답: 일치하면 그대로, 아니면 확신도 높은 쪽
        if match:
            final = a1
            conf = (c1 + c2) / 2
        elif c1 >= c2:
            final = a1
            conf = c1 * 0.7  # 불일치 시 확신도 감소
        else:
            final = a2
            conf = c2 * 0.7

        combined[q] = {
            "answer": final,
            "ocr1": a1,
            "ocr2": a2,
            "match": match,
            "confidence": round(conf, 2),
        }

    return {
        "ocr1": ocr1_results,
        "ocr2": ocr2_results,
        "full_text_1": full_text_1,
        "full_text_2": full_text_2,
        "answers": combined,
    }


def _extract_answers_from_ocr(ocr_results: list[dict]) -> dict:
    """OCR 결과에서 문제번호+답 패턴 추출
    예: "1. ③" → {"1": "③", "1_conf": 95.0}
    """
    import re
    answers = {}

    # 번호 기호 매핑
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}

    for item in ocr_results:
        text = item["text"]
        conf = item["confidence"]

        # 패턴: "1. ③" 또는 "1) ③" 또는 "1 ③" 또는 "1.③"
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
