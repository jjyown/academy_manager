"""Gemini AI 연동: 서술형 채점, 정답 PDF 파싱, 종합평가 생성"""
import json
import logging
import google.generativeai as genai
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-2.0-flash")


async def parse_answers_from_pdf(pdf_text: str, total_hint: int | None = None) -> dict:
    """정답 PDF 텍스트에서 정답을 추출"""
    prompt = f"""다음은 문제집/프린트의 정답 또는 해설지 내용입니다.
각 문제 번호와 정답을 추출해주세요.

규칙:
- 객관식: 번호와 보기 번호(①②③④⑤ 또는 1,2,3,4,5)
- 단답형: 번호와 정답 텍스트
- 서술형: 번호와 모범답안

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "answers": {{"1": "③", "2": "①", "3": "정답텍스트", ...}},
  "types": {{"1": "mc", "2": "mc", "3": "short", "4": "essay", ...}},
  "total": 문제수
}}

mc=객관식, short=단답형, essay=서술형

{f'예상 총 문제 수: {total_hint}' if total_hint else ''}

정답 내용:
{pdf_text[:8000]}"""

    try:
        response = _model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        logger.error(f"정답 파싱 실패: {e}")
        return {"answers": {}, "types": {}, "total": 0}


async def grade_essay(question_num: int, student_answer: str, correct_answer: str, max_score: float = 10) -> dict:
    """서술형 답안 AI 채점"""
    prompt = f"""서술형 문제 채점을 해주세요.

문제 번호: {question_num}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

채점 기준:
- 핵심 키워드 포함 여부
- 논리적 설명 여부
- 부분 점수 가능

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 점수(숫자),
  "max_score": {max_score},
  "feedback": "채점 사유 (한국어, 1~2문장)"
}}"""

    try:
        response = _model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        logger.error(f"서술형 채점 실패 (문제 {question_num}): {e}")
        return {"score": 0, "max_score": max_score, "feedback": "AI 채점 실패"}


async def grade_essay_double_check(question_num: int, student_answer: str, correct_answer: str, first_result: dict, max_score: float = 10) -> dict:
    """서술형 답안 더블체크 (2차 채점)"""
    prompt = f"""서술형 문제 채점을 검증해주세요.

문제 번호: {question_num}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

1차 AI 채점 결과:
- 점수: {first_result.get('score', 0)}/{max_score}
- 사유: {first_result.get('feedback', '')}

1차 채점이 적절한지 검증하고, 필요시 점수를 조정해주세요.

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 최종점수(숫자),
  "max_score": {max_score},
  "feedback": "최종 채점 사유 (한국어, 1~2문장)",
  "adjusted": true/false,
  "confidence": 0~100
}}"""

    try:
        response = _model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        logger.error(f"서술형 더블체크 실패 (문제 {question_num}): {e}")
        return first_result


async def match_answer_key(student_image_text: str, available_keys: list[dict]) -> int | None:
    """자동 검색 모드: 학생 답안에서 어떤 교재인지 매칭"""
    if not available_keys:
        return None

    keys_desc = "\n".join([
        f"ID {k['id']}: {k['title']} ({k.get('subject', '')}) - {k.get('total_questions', 0)}문제"
        for k in available_keys
    ])

    prompt = f"""학생 답안지에서 인식된 텍스트를 보고, 아래 교재 중 어떤 것에 해당하는지 판단해주세요.

학생 답안 텍스트:
{student_image_text[:3000]}

등록된 교재 목록:
{keys_desc}

매칭되는 교재의 ID만 숫자로 응답하세요. 확실하지 않으면 0으로 응답하세요.
응답 형식: {{"id": 숫자, "confidence": 0~100}}"""

    try:
        response = _model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        if result.get("id", 0) > 0 and result.get("confidence", 0) >= 50:
            return result["id"]
        return None
    except Exception as e:
        logger.error(f"교재 매칭 실패: {e}")
        return None


async def generate_monthly_evaluation(student_name: str, grading_data: list[dict], attendance_data: dict | None = None) -> str:
    """월별 종합평가 자동 생성"""
    data_summary = "\n".join([
        f"- {d.get('title', '?')}: {d.get('total_score', 0)}/{d.get('max_score', 100)}점 "
        f"(맞은수: {d.get('correct_count', 0)}, 틀린수: {d.get('wrong_count', 0)})"
        for d in grading_data
    ])

    att_summary = ""
    if attendance_data:
        att_summary = f"""
출석 현황:
- 출석: {attendance_data.get('present', 0)}회
- 지각: {attendance_data.get('late', 0)}회
- 결석: {attendance_data.get('absent', 0)}회"""

    prompt = f"""학원 선생님이 학부모에게 보내는 월별 종합평가를 작성해주세요.

학생: {student_name}

채점 결과:
{data_summary}
{att_summary}

작성 규칙:
- 한국어로 3~5문장
- 긍정적인 면 먼저, 개선점 다음
- 구체적인 과목/단원 언급
- 학부모가 이해하기 쉬운 표현
- 격식체 사용 (~습니다, ~입니다)"""

    try:
        response = _model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        logger.error(f"종합평가 생성 실패: {e}")
        return ""
