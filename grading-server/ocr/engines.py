"""OCR 엔진: Gemini Vision API 기반 (Smart Grading)

개선된 OCR 흐름:
1. 교재 정보 (교재명, 페이지, 단원) 자동 식별
2. 해당 페이지의 모든 문제 번호 추출 (미풀이 포함)
3. 학생 답안 추출 (더블체크)
"""
import logging
import json
import base64

logger = logging.getLogger(__name__)


async def ocr_gemini(image_bytes: bytes) -> dict:
    """Gemini Vision으로 이미지에서 교재정보 + 문제번호 + 답안 인식"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt = """이 학생 숙제 사진을 분석해주세요.

1. 교재 정보: 페이지 상단/하단/옆에 보이는 교재명, 출판사, 페이지 번호, 단원명
2. 모든 문제 목록: 이 페이지에 인쇄된 모든 문제 번호 (학생이 안 푼 것도 포함)
3. 학생 답: 각 문제에 대해 학생이 쓴 답 (안 풀었으면 "unanswered")

추출 규칙:
- 객관식: ①②③④⑤ 또는 1,2,3,4,5
- 단답형: 숫자, 수식, 텍스트
- 서술형: 작성 내용 전체
- 빈칸/미작성: "unanswered"

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"textbook_info": {"name": "교재명", "page": "45", "section": "단원명"}, "answers": {"1": "③", "2": "unanswered", "3": "12"}, "full_text": "전체 인식 텍스트"}"""

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
            "textbook_info": result.get("textbook_info", {}),
            "answers": result.get("answers", {}),
            "full_text": result.get("full_text", ""),
        }
    except Exception as e:
        logger.error(f"Gemini OCR 실패: {e}")
        return {"textbook_info": {}, "answers": {}, "full_text": ""}


async def ocr_gemini_double_check(image_bytes: bytes) -> dict:
    """Gemini Vision 더블체크: 2번 독립 호출 → 교재 식별 + 답안 비교"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt1 = """이 학생 숙제 사진을 분석해주세요.

1. 교재 정보: 페이지에 보이는 교재명, 페이지 번호, 단원/섹션명
2. 이 페이지의 모든 문제 번호를 나열하세요 (학생이 안 푼 문제도 포함)
3. 각 문제의 학생 답 (안 풀었으면 "unanswered")

추출 규칙:
- 객관식: ①②③④⑤ 또는 1,2,3,4,5
- 단답형: 숫자, 수식, 텍스트
- 빈칸: "unanswered"

JSON만 응답:
{"textbook_info": {"name": "교재명", "page": "45", "section": "단원명"}, "answers": {"1": "③", "2": "unanswered"}, "full_text": "..."}"""

    prompt2 = """이 사진은 학생의 숙제입니다. 수학 문제집 페이지에 학생이 답을 적었습니다.

확인할 것:
1. 어떤 교재인지 (페이지 헤더/푸터/디자인에서 교재명, 페이지 번호, 단원 확인)
2. 페이지에 있는 모든 문제 번호 (인쇄된 문제 전부, 학생이 풀지 않은 것도 포함)
3. 학생이 각 문제에 쓴 답 (빈칸이면 "unanswered")

JSON만 응답:
{"textbook_info": {"name": "교재명", "page": "45", "section": "단원명"}, "answers": {"1": "③", "2": "unanswered"}, "full_text": "..."}"""

    model = genai.GenerativeModel("gemini-2.0-flash")
    image_part = {"mime_type": "image/jpeg", "data": b64}

    # 1차 인식
    try:
        res1 = model.generate_content([prompt1, image_part])
        text1 = _parse_json_response(res1.text)
    except Exception as e:
        logger.error(f"Gemini 1차 OCR 실패: {e}")
        text1 = {"textbook_info": {}, "answers": {}, "full_text": ""}

    # 2차 인식 (다른 프롬프트)
    try:
        res2 = model.generate_content([prompt2, image_part])
        text2 = _parse_json_response(res2.text)
    except Exception as e:
        logger.error(f"Gemini 2차 OCR 실패: {e}")
        text2 = {"textbook_info": {}, "answers": {}, "full_text": ""}

    answers1 = text1.get("answers", {})
    answers2 = text2.get("answers", {})

    # 교재 정보: 1차 결과 우선 (2차로 보완)
    tb1 = text1.get("textbook_info", {})
    tb2 = text2.get("textbook_info", {})
    textbook_info = {
        "name": tb1.get("name") or tb2.get("name", ""),
        "page": tb1.get("page") or tb2.get("page", ""),
        "section": tb1.get("section") or tb2.get("section", ""),
    }

    # 더블체크 결합
    all_questions = set(list(answers1.keys()) + list(answers2.keys()))
    combined = {}

    for q in sorted(all_questions, key=lambda x: int(x) if x.isdigit() else 0):
        a1 = str(answers1.get(q, ""))
        a2 = str(answers2.get(q, ""))

        # "unanswered" 처리: 둘 다 unanswered면 미풀이 확정
        if a1 == "unanswered" and a2 == "unanswered":
            combined[q] = {
                "answer": "unanswered",
                "ocr1": a1, "ocr2": a2,
                "match": True, "confidence": 95,
            }
            continue

        # 한쪽만 unanswered면 다른 쪽 채택 (낮은 confidence)
        if a1 == "unanswered" and a2 and a2 != "unanswered":
            combined[q] = {
                "answer": a2, "ocr1": a1, "ocr2": a2,
                "match": False, "confidence": 60,
            }
            continue
        if a2 == "unanswered" and a1 and a1 != "unanswered":
            combined[q] = {
                "answer": a1, "ocr1": a1, "ocr2": a2,
                "match": False, "confidence": 60,
            }
            continue

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
            "ocr1": a1, "ocr2": a2,
            "match": match, "confidence": conf,
        }

    return {
        "textbook_info": textbook_info,
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
