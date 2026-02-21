"""AI 연동: 소통형 서술형 채점 (GPT-4o 1차 → Gemini 리뷰 → GPT-4o 최종), 정답 PDF 파싱, 종합평가 생성"""
import asyncio
import json
import logging
import google.generativeai as genai
from config import GEMINI_API_KEY, OPENAI_API_KEY, AI_API_TIMEOUT, GEMINI_MODEL

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)
_gemini_model = genai.GenerativeModel(GEMINI_MODEL)
_request_opts = {"timeout": AI_API_TIMEOUT}

RETRY_MAX = 2
RETRY_BASE_DELAY = 1.5


async def _gemini_call_with_retry(prompt, label: str = "Gemini"):
    """Gemini API 호출 + 자동 재시도 (지수 백오프)"""
    last_err = None
    for attempt in range(1, RETRY_MAX + 1):
        try:
            response = _gemini_model.generate_content(prompt, request_options=_request_opts)
            return response
        except Exception as e:
            last_err = e
            if attempt < RETRY_MAX:
                delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(f"[Retry] {label} 실패 (시도 {attempt}/{RETRY_MAX}): {e} → {delay:.1f}초 후 재시도")
                await asyncio.sleep(delay)
            else:
                logger.error(f"[Retry] {label} 최종 실패 ({RETRY_MAX}회 시도): {e}")
    raise last_err


async def _gpt4o_call_with_retry(messages: list, label: str = "GPT-4o", max_tokens: int = 1024):
    """OpenAI GPT-4o API 호출 + 자동 재시도"""
    from openai import AsyncOpenAI

    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다")

    client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=AI_API_TIMEOUT)
    last_err = None
    for attempt in range(1, RETRY_MAX + 1):
        try:
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                max_tokens=max_tokens,
                temperature=0.1,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            last_err = e
            if attempt < RETRY_MAX:
                delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(f"[Retry] {label} 실패 (시도 {attempt}/{RETRY_MAX}): {e} → {delay:.1f}초 후 재시도")
                await asyncio.sleep(delay)
            else:
                logger.error(f"[Retry] {label} 최종 실패 ({RETRY_MAX}회 시도): {e}")
    raise last_err


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
        response = _gemini_model.generate_content(prompt, request_options=_request_opts)
        result = _parse_ai_json(response.text)
        return result if result else {"answers": {}, "types": {}, "total": 0}
    except Exception as e:
        logger.error(f"정답 파싱 실패: {e}")
        return {"answers": {}, "types": {}, "total": 0}


# ============================================================
# 소통형 서술형 채점: GPT-4o 1차 → Gemini 리뷰 → GPT-4o 최종
# ============================================================

async def grade_essay_independent(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """소통형 서술형 채점: GPT-4o가 채점 → Gemini가 리뷰 → 이의 시 GPT-4o 최종 판정

    Args:
        question_num: 문제 번호
        student_answer: 학생 답안
        correct_answer: 모범답안
        max_score: 배점
        question_text: 문제 본문 (있으면 정확도 향상)

    Returns:
        {"score": float, "max_score": float, "feedback": str, "confidence": int}
    """
    q_text_section = ""
    if question_text:
        q_text_section = f"\n문제 내용: {question_text}"

    # ── Round 1: GPT-4o 1차 채점 ──
    gpt_prompt = [
        {"role": "system", "content": (
            "당신은 수학 서술형 답안을 채점하는 전문 채점자입니다. "
            "학생 답안을 모범답안과 비교하여 정확하고 공정하게 채점하세요. "
            "반드시 JSON 형식으로만 응답하세요."
        )},
        {"role": "user", "content": f"""서술형 문제 채점을 해주세요.

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
  "feedback": "채점 사유 (한국어, 2~3문장, 구체적 근거 포함)",
  "key_points": ["학생이 맞힌 핵심 포인트", "놓친 포인트"]
}}"""},
    ]

    gpt_result = {"score": 0, "max_score": max_score, "feedback": "GPT-4o 채점 실패", "key_points": []}
    try:
        gpt_text = await _gpt4o_call_with_retry(gpt_prompt, label=f"Essay#{question_num}-GPT")
        parsed = _parse_ai_json(gpt_text)
        if parsed:
            gpt_result = parsed
    except Exception as e:
        logger.error(f"[Essay #{question_num}] GPT-4o 1차 채점 실패: {e}")
        return await _fallback_gemini_grade(question_num, student_answer, correct_answer, max_score, question_text)

    gpt_score = float(gpt_result.get("score", 0))
    gpt_feedback = gpt_result.get("feedback", "")
    gpt_key_points = gpt_result.get("key_points", [])

    logger.info(f"[Essay #{question_num}] GPT-4o 1차: {gpt_score}/{max_score} - {gpt_feedback}")

    # ── Round 2: Gemini 리뷰 (GPT-4o 결과를 함께 전달) ──
    review_prompt = f"""당신은 서술형 채점 결과를 검토하는 리뷰어입니다.
다른 AI가 채점한 결과를 원본 답안과 함께 검토하고, 채점이 적절한지 판단해주세요.

문제 번호: {question_num}{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

═══ 1차 채점 결과 (GPT-4o) ═══
점수: {gpt_score}/{max_score}점
채점 사유: {gpt_feedback}
핵심 포인트: {json.dumps(gpt_key_points, ensure_ascii=False)}

═══ 리뷰 요청 ═══
위 채점 결과가 공정하고 정확한지 검토해주세요:
1. 학생 답안을 직접 다시 읽고 모범답안과 비교하세요
2. 1차 채점자의 점수와 근거가 합리적인지 판단하세요
3. 부분 점수가 적절히 반영되었는지 확인하세요
4. 동의하면 agree=true, 이의가 있으면 agree=false로 응답하세요

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "agree": true 또는 false,
  "suggested_score": 당신이 생각하는 적정 점수(숫자),
  "review": "리뷰 의견 (한국어, 1~2문장. 동의하면 동의 근거, 이의면 수정 근거)"
}}"""

    review_result = None
    try:
        review_response = await _gemini_call_with_retry(review_prompt, label=f"Essay#{question_num}-Review")
        review_result = _parse_ai_json(review_response.text)
    except Exception as e:
        logger.error(f"[Essay #{question_num}] Gemini 리뷰 실패: {e}")

    # Gemini 리뷰 실패 시 GPT-4o 결과 그대로 반환 (confidence 낮춤)
    if not review_result:
        logger.warning(f"[Essay #{question_num}] 리뷰 실패 → GPT-4o 결과 단독 사용")
        return {
            "score": min(gpt_score, max_score),
            "max_score": max_score,
            "feedback": gpt_feedback,
            "confidence": 70,
            "score_a": gpt_score,
            "score_b": gpt_score,
        }

    gemini_agrees = review_result.get("agree", True)
    gemini_score = float(review_result.get("suggested_score", gpt_score))
    gemini_review = review_result.get("review", "")

    logger.info(f"[Essay #{question_num}] Gemini 리뷰: "
                f"{'동의' if gemini_agrees else '이의'}, "
                f"제안점수={gemini_score}/{max_score} - {gemini_review}")

    # ── Gemini 동의 → GPT-4o 점수 확정 ──
    if gemini_agrees and abs(gpt_score - gemini_score) <= max_score * 0.1:
        final_score = round(gpt_score * 2) / 2
        logger.info(f"[Essay #{question_num}] 동의 → 확정 {final_score}점 (confidence 90)")
        return {
            "score": min(final_score, max_score),
            "max_score": max_score,
            "feedback": gpt_feedback,
            "confidence": 90,
            "score_a": gpt_score,
            "score_b": gemini_score,
        }

    # ── Gemini 이의 → Round 3: GPT-4o 최종 판정 ──
    logger.info(f"[Essay #{question_num}] 이의 발생 → GPT-4o 최종 판정 요청")
    final_result = await _essay_final_judgment(
        question_num, student_answer, correct_answer,
        gpt_score, gpt_feedback, gpt_key_points,
        gemini_score, gemini_review,
        max_score, question_text,
    )

    return final_result


async def _essay_final_judgment(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    gpt_score: float, gpt_feedback: str, gpt_key_points: list,
    gemini_score: float, gemini_review: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """GPT-4o 최종 판정: 1차 채점 + Gemini 리뷰를 종합하여 최종 점수 결정"""
    q_text_section = f"\n문제 내용: {question_text}" if question_text else ""

    final_prompt = [
        {"role": "system", "content": (
            "당신은 서술형 채점의 최종 판정자입니다. "
            "1차 채점 결과와 리뷰어의 의견을 모두 검토한 뒤, "
            "원본 답안을 직접 다시 평가하여 최종 점수를 결정하세요. "
            "어느 한쪽에 편향되지 말고, 답안 자체를 기준으로 판단하세요."
        )},
        {"role": "user", "content": f"""서술형 문제의 최종 점수를 결정해주세요.

문제 번호: {question_num}{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

═══ 1차 채점 (GPT-4o) ═══
점수: {gpt_score}/{max_score}점
채점 사유: {gpt_feedback}
핵심 포인트: {json.dumps(gpt_key_points, ensure_ascii=False)}

═══ 리뷰어 의견 (Gemini) ═══
제안 점수: {gemini_score}/{max_score}점
리뷰: {gemini_review}

═══ 최종 판정 요청 ═══
- 위 두 의견을 참고하되, 학생 답안을 직접 다시 읽고 독립적으로 판단하세요
- 0.5점 단위로 점수를 부여하세요
- 최종 판단 근거를 명확히 서술하세요

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 최종점수(숫자),
  "max_score": {max_score},
  "feedback": "최종 채점 사유 (한국어, 1~2문장)",
  "confidence": 0~100
}}"""},
    ]

    try:
        text = await _gpt4o_call_with_retry(final_prompt, label=f"Essay#{question_num}-Final")
        result = _parse_ai_json(text)
        if result:
            final_score = round(float(result.get("score", 0)) * 2) / 2
            confidence = min(95, max(60, result.get("confidence", 75)))
            logger.info(f"[Essay #{question_num}] 최종 판정: {final_score}/{max_score} (conf={confidence})")
            return {
                "score": min(final_score, max_score),
                "max_score": max_score,
                "feedback": result.get("feedback", ""),
                "confidence": confidence,
                "score_a": gpt_score,
                "score_b": gemini_score,
            }
    except Exception as e:
        logger.error(f"[Essay #{question_num}] 최종 판정 실패: {e}")

    # 실패 시 두 점수의 가중 평균 (GPT-4o 60%, Gemini 40%)
    fallback_score = round((gpt_score * 0.6 + gemini_score * 0.4) * 2) / 2
    return {
        "score": min(fallback_score, max_score),
        "max_score": max_score,
        "feedback": f"최종 판정 실패 - GPT: {gpt_feedback} / 리뷰: {gemini_review}",
        "confidence": 55,
        "score_a": gpt_score,
        "score_b": gemini_score,
    }


async def _fallback_gemini_grade(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """GPT-4o 실패 시 Gemini 단독 채점 (fallback)"""
    q_text_section = f"\n문제 내용: {question_text}" if question_text else ""

    prompt = f"""서술형 문제 채점을 해주세요.

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

    try:
        response = await _gemini_call_with_retry(prompt, label=f"Essay#{question_num}-Fallback")
        result = _parse_ai_json(response.text)
        if result:
            score = round(float(result.get("score", 0)) * 2) / 2
            return {
                "score": min(score, max_score),
                "max_score": max_score,
                "feedback": result.get("feedback", ""),
                "confidence": 65,
                "score_a": score,
                "score_b": score,
            }
    except Exception as e:
        logger.error(f"[Essay #{question_num}] Gemini fallback 실패: {e}")

    return {
        "score": 0, "max_score": max_score,
        "feedback": "AI 채점 실패", "confidence": 0,
        "score_a": 0, "score_b": 0,
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
    """서술형 3차 중재 채점 (하위 호환용 - 소통형에서는 _essay_final_judgment 사용)"""
    return await _essay_final_judgment(
        question_num, student_answer, correct_answer,
        score_a, feedback_a, [],
        score_b, feedback_b,
        max_score, question_text,
    )


# ============================================================
# 기존 호환용 (단순 호출)
# ============================================================

async def grade_essay(question_num: int, student_answer: str, correct_answer: str, max_score: float = 10) -> dict:
    """서술형 답안 AI 채점 (기존 호환용 - 내부적으로 소통형 채점 호출)"""
    result = await grade_essay_independent(question_num, student_answer, correct_answer, max_score)
    return result


async def grade_essay_double_check(question_num: int, student_answer: str, correct_answer: str, first_result: dict, max_score: float = 10) -> dict:
    """서술형 더블체크 (기존 호환용)"""
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
        response = _gemini_model.generate_content(prompt, request_options=_request_opts)
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
        response = _gemini_model.generate_content(prompt, request_options=_request_opts)
        return response.text.strip()
    except Exception as e:
        logger.error(f"종합평가 생성 실패: {e}")
        return ""
