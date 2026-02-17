"""Gemini AI 연동: 서술형 채점 (독립 2회 + 중재), 정답 PDF 파싱, 종합평가 생성"""
import json
import logging
import google.generativeai as genai
from config import GEMINI_API_KEY, AI_API_TIMEOUT

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-2.0-flash")
_request_opts = {"timeout": AI_API_TIMEOUT}


def _parse_ai_json(text: str) -> dict | None:
    """AI 응답에서 JSON 추출"""
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return None


# ============================================================
# 정답 PDF 파싱
# ============================================================

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
        response = _model.generate_content(prompt, request_options=_request_opts)
        result = _parse_ai_json(response.text)
        return result if result else {"answers": {}, "types": {}, "total": 0}
    except Exception as e:
        logger.error(f"정답 파싱 실패: {e}")
        return {"answers": {}, "types": {}, "total": 0}


# ============================================================
# #5 + #10: 서술형 독립 2회 채점 + 중재 + 문제 본문 포함
# ============================================================

async def grade_essay_independent(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """서술형 답안 독립 2회 채점 → 차이 크면 3차 중재

    Args:
        question_num: 문제 번호
        student_answer: 학생 답안
        correct_answer: 모범답안
        max_score: 배점
        question_text: 문제 본문 (있으면 정확도 향상)

    Returns:
        {"score": float, "max_score": float, "feedback": str, "confidence": int}
    """
    # 문제 본문 텍스트 (있으면 포함)
    q_text_section = ""
    if question_text:
        q_text_section = f"\n문제 내용: {question_text}"

    # 1차 채점 (채점자 A)
    prompt_a = f"""서술형 문제 채점을 해주세요.

문제 번호: {question_num}{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

채점 기준:
- 핵심 개념/키워드 포함 여부 (40%)
- 논리적 서술 및 풀이 과정 (30%)
- 최종 답의 정확성 (30%)
- 부분 점수 가능 (0.5점 단위)

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 점수(숫자),
  "max_score": {max_score},
  "feedback": "채점 사유 (한국어, 1~2문장)"
}}"""

    # 2차 채점 (채점자 B - 다른 관점)
    prompt_b = f"""당신은 수학 서술형 답안을 채점하는 독립적인 채점자입니다.
아래 답안을 모범답안과 비교하여 점수를 매겨주세요.

문제 번호: {question_num}{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생이 작성한 답: {student_answer}

채점 시 확인할 것:
1. 학생이 핵심 수학 개념을 이해하고 있는가?
2. 풀이 과정이 논리적인가?
3. 최종 답이 맞는가?
4. 부분 점수를 줄 수 있는 부분이 있는가?

점수는 0.5점 단위로 부여하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 점수(숫자),
  "max_score": {max_score},
  "feedback": "채점 근거 (한국어, 1~2문장)"
}}"""

    # 두 채점을 독립적으로 실행
    result_a = {"score": 0, "max_score": max_score, "feedback": "AI 채점 실패"}
    result_b = {"score": 0, "max_score": max_score, "feedback": "AI 채점 실패"}

    try:
        res_a = _model.generate_content(prompt_a, request_options=_request_opts)
        parsed = _parse_ai_json(res_a.text)
        if parsed:
            result_a = parsed
    except Exception as e:
        logger.error(f"서술형 1차 채점 실패 (문제 {question_num}): {e}")

    try:
        res_b = _model.generate_content(prompt_b, request_options=_request_opts)
        parsed = _parse_ai_json(res_b.text)
        if parsed:
            result_b = parsed
    except Exception as e:
        logger.error(f"서술형 2차 채점 실패 (문제 {question_num}): {e}")

    score_a = float(result_a.get("score", 0))
    score_b = float(result_b.get("score", 0))
    score_diff = abs(score_a - score_b)

    logger.info(f"[Essay #{question_num}] 1차: {score_a}/{max_score}, "
                f"2차: {score_b}/{max_score}, 차이: {score_diff}")

    # 두 채점 결과가 비슷하면 평균 사용
    if score_diff <= max_score * 0.2:
        final_score = round((score_a + score_b) / 2 * 2) / 2  # 0.5 단위 반올림
        feedback = result_a.get("feedback", "") or result_b.get("feedback", "")
        confidence = 85
        logger.info(f"[Essay #{question_num}] 일치 → 평균 {final_score}점")
    else:
        # 차이가 크면 3차 중재 채점
        logger.info(f"[Essay #{question_num}] 불일치 → 3차 중재 요청")
        mediation = await grade_essay_mediate(
            question_num, student_answer, correct_answer,
            score_a, result_a.get("feedback", ""),
            score_b, result_b.get("feedback", ""),
            max_score, question_text,
        )
        final_score = float(mediation.get("score", (score_a + score_b) / 2))
        feedback = mediation.get("feedback", "")
        confidence = mediation.get("confidence", 65)

    return {
        "score": min(final_score, max_score),
        "max_score": max_score,
        "feedback": feedback,
        "confidence": confidence,
        "score_a": score_a,
        "score_b": score_b,
    }


async def grade_essay_mediate(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    score_a: float, feedback_a: str,
    score_b: float, feedback_b: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """서술형 3차 중재 채점 (두 채점자의 결과가 크게 다를 때)"""
    q_text_section = f"\n문제 내용: {question_text}" if question_text else ""

    prompt = f"""두 AI 채점자가 같은 서술형 답안에 대해 다른 점수를 부여했습니다.
중재자로서 두 채점 결과를 검토하고 최종 점수를 결정해주세요.

문제 번호: {question_num}{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

채점자 A: {score_a}/{max_score}점 - "{feedback_a}"
채점자 B: {score_b}/{max_score}점 - "{feedback_b}"

중재 규칙:
- 두 채점 결과를 모두 고려하되 답안을 직접 다시 평가하세요
- 어느 한쪽에 편향되지 마세요
- 0.5점 단위로 점수를 부여하세요
- 최종 판단 근거를 명확히 서술하세요

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 최종점수(숫자),
  "max_score": {max_score},
  "feedback": "최종 채점 사유 (한국어, 1~2문장)",
  "confidence": 0~100
}}"""

    try:
        response = _model.generate_content(prompt, request_options=_request_opts)
        result = _parse_ai_json(response.text)
        if result:
            return result
    except Exception as e:
        logger.error(f"서술형 중재 실패 (문제 {question_num}): {e}")

    # 실패 시 두 점수의 평균
    return {
        "score": round((score_a + score_b) / 2 * 2) / 2,
        "max_score": max_score,
        "feedback": f"중재 실패 - A: {feedback_a} / B: {feedback_b}",
        "confidence": 50,
    }


# ============================================================
# 기존 호환용 (단순 호출)
# ============================================================

async def grade_essay(question_num: int, student_answer: str, correct_answer: str, max_score: float = 10) -> dict:
    """서술형 답안 AI 채점 (기존 호환용 - 내부적으로 독립 채점 호출)"""
    result = await grade_essay_independent(question_num, student_answer, correct_answer, max_score)
    return result


async def grade_essay_double_check(question_num: int, student_answer: str, correct_answer: str, first_result: dict, max_score: float = 10) -> dict:
    """서술형 더블체크 (기존 호환용 - 이미 독립 채점에서 처리됨)"""
    return first_result


# ============================================================
# 교재 매칭
# ============================================================

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
        response = _model.generate_content(prompt, request_options=_request_opts)
        result = _parse_ai_json(response.text)
        if result and result.get("id", 0) > 0 and result.get("confidence", 0) >= 50:
            return result["id"]
        return None
    except Exception as e:
        logger.error(f"교재 매칭 실패: {e}")
        return None


# ============================================================
# 종합평가
# ============================================================

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
        response = _model.generate_content(prompt, request_options=_request_opts)
        return response.text.strip()
    except Exception as e:
        logger.error(f"종합평가 생성 실패: {e}")
        return ""
