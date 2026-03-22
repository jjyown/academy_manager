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
# 단답형 uncertain 해소: Gemini Flash 수학적 동치 판정
# ============================================================

async def smart_compare(student: str, correct: str) -> dict:
    """알고리즘으로 판별 불가(uncertain)인 두 답을 Gemini Flash로 비교.

    Returns:
        {"result": "correct"|"wrong", "error_type": str|None}
    """
    prompt = f"""수학 문제의 학생 답과 정답이 수학적으로 동일한지 판별하세요.

학생 답: {student}
정답: {correct}

판별 규칙:
- 수학적 동치이면 같은 답 (예: 1/2 = 0.5, x²+2x+1 = (x+1)², {{1,2,3}} = {{3,1,2}})
- 단위 유무 차이는 같은 답 (예: "5cm" = "5", "90°" = "90")
- OCR 오류 감안: 글씨 인식 오차일 가능성 고려 (예: "ㅡ2" → "-2")
- 확신이 없으면 "uncertain"

반드시 아래 JSON만 응답:
{{"match": true/false, "reason": "한 줄 사유", "confidence": 0~100}}"""

    try:
        resp = await _gemini_call_with_retry(prompt, label="smart_compare")
        parsed = _parse_ai_json(resp.text)
        if not parsed or "match" not in parsed:
            return {"result": "uncertain", "error_type": None}

        if parsed["match"]:
            return {"result": "correct", "error_type": None}

        confidence = parsed.get("confidence", 50)
        if confidence < 40:
            return {"result": "uncertain", "error_type": None}

        return {"result": "wrong", "error_type": "notation_error"}
    except Exception as e:
        logger.warning(f"[smart_compare] AI 비교 실패: {e} → uncertain 유지")
        return {"result": "uncertain", "error_type": None}


# ============================================================
# 수학 서술형 채점 v2: Gemini 1차 → 조건부 GPT-4o 검증
# ============================================================

async def grade_essay_independent(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """수학 서술형 채점 v2: Gemini Flash 1차 채점 → 애매한 경우만 GPT-4o 검증

    v1 대비 개선:
    - 수학 전용 루브릭 (최종 답 50%, 풀이 과정 35%, 수학적 표현 15%)
    - Gemini Flash를 1차로 사용 (비용 1/10)
    - 명확한 경우 (만점 또는 0점) 1라운드로 종료
    - 부분 점수 (20~80%) 구간만 GPT-4o 2차 검증
    - OCR 아티팩트 인식 (학생 답이 OCR로 읽힌 것임을 고려)
    """
    q_text_section = ""
    if question_text:
        q_text_section = f"\n문제: {question_text}"

    # ── Round 1: Gemini Flash 1차 채점 (수학 전용 루브릭) ──
    gemini_prompt = f"""당신은 한국 중고등학교 수학 서술형 답안을 채점하는 전문가입니다.

{question_num}번 문제{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안: {student_answer}

★ 주의: 학생답안은 손글씨 사진을 AI가 읽은(OCR) 것이므로 오탈자가 있을 수 있습니다.
  글씨가 약간 다르더라도 수학적 의미가 같으면 정답으로 인정하세요.
  예: "루트3" = "√3", "2분의1" = "1/2", "엑스" = "x"

★★★ 수학 서술형 채점 기준 ★★★

[A] 최종 답의 정확성 (배점의 50%)
- 최종 답이 모범답안과 수학적으로 동치인가?
- 동치이면 → 배점의 50% 획득
- 오답이면 → 0%
- 답은 맞지만 형태가 다르면 (예: 2/4 vs 1/2) → 정답 인정

[B] 풀이 과정의 타당성 (배점의 35%)
- 올바른 공식/정리를 사용했는가?
- 핵심 계산 단계가 빠짐없이 있는가?
- 중간 과정에 논리적 오류가 없는가?
- 과정 없이 답만 쓴 경우 → B 영역 0%

[C] 수학적 표현 (배점의 15%)
- 수식/기호가 올바르게 사용되었는가?
- 단위, 조건 등 부수적 요소가 있는가?
- 사소한 표기 실수는 감점하지 않음

★ 채점 시 절대 규칙:
- 최종 답이 맞고 풀이도 올바르면 → 만점 또는 만점 근처
- 최종 답이 맞지만 풀이 생략 → 배점의 50~65%
- 풀이 방향은 맞지만 계산 실수로 답이 틀림 → 배점의 30~60%
- 풀이 방향이 완전히 틀림 → 배점의 0~15%
- 백지/무관한 내용 → 0점

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "score": 점수(숫자, 0.5점 단위),
  "max_score": {max_score},
  "final_answer_correct": true 또는 false,
  "feedback": "채점 사유 (한국어, 1~2문장, 구체적으로)",
  "confidence": 0~100
}}"""

    gemini_result = None
    try:
        response = await _gemini_call_with_retry(gemini_prompt, label=f"Essay#{question_num}-Gemini")
        gemini_result = _parse_ai_json(response.text)
    except Exception as e:
        logger.error(f"[Essay #{question_num}] Gemini 1차 채점 실패: {e}")

    if not gemini_result:
        logger.warning(f"[Essay #{question_num}] Gemini 실패 → GPT-4o fallback")
        return await _fallback_gpt4o_grade(question_num, student_answer, correct_answer, max_score, question_text)

    g_score = round(float(gemini_result.get("score", 0)) * 2) / 2
    g_score = max(0, min(g_score, max_score))
    g_feedback = gemini_result.get("feedback", "")
    g_confidence = gemini_result.get("confidence", 70)
    g_final_correct = gemini_result.get("final_answer_correct", None)

    logger.info(f"[Essay #{question_num}] Gemini 1차: {g_score}/{max_score} "
                f"(conf={g_confidence}, 최종답={'정' if g_final_correct else '오'}) - {g_feedback}")

    # ── 명확한 경우: 1라운드로 종료 (비용 절약) ──
    score_ratio = g_score / max_score if max_score > 0 else 0

    if (score_ratio >= 0.9 or score_ratio <= 0.1) and g_confidence >= 80:
        logger.info(f"[Essay #{question_num}] 명확한 케이스 → 1라운드 확정 ({g_score}점)")
        return {
            "score": g_score, "max_score": max_score,
            "feedback": g_feedback, "confidence": min(g_confidence, 92),
            "score_a": g_score, "score_b": g_score,
        }

    # ── 부분 점수 구간 (10~90%): GPT-4o 2차 검증 ──
    logger.info(f"[Essay #{question_num}] 부분 점수 구간 → GPT-4o 2차 검증")
    gpt_verify_prompt = [
        {"role": "system", "content": (
            "당신은 한국 중고등학교 수학 서술형 채점 검증자입니다. "
            "1차 채점 결과를 검토하고, 학생 답안을 직접 다시 평가하세요. "
            "반드시 JSON으로만 응답하세요."
        )},
        {"role": "user", "content": f"""{question_num}번 수학 서술형 채점을 검증해주세요.
{q_text_section}
배점: {max_score}점
모범답안: {correct_answer}
학생답안 (OCR 결과): {student_answer}

═══ 1차 채점 결과 ═══
점수: {g_score}/{max_score}점
사유: {g_feedback}
최종 답 정답 여부: {'정답' if g_final_correct else '오답' if g_final_correct is False else '판단 불가'}

═══ 검증 요청 ═══
수학 채점 기준: 최종 답 정확성 50%, 풀이 과정 35%, 수학적 표현 15%
- 학생 답안을 직접 읽고, 1차 채점이 적절한지 판단하세요
- 적절하면 1차 점수 유지, 부적절하면 수정 점수 제시
- 0.5점 단위

반드시 아래 JSON 형식으로만 응답:
{{
  "score": 최종점수(숫자),
  "feedback": "검증 결과 (한국어, 1문장)",
  "adjusted": false (1차 점수 유지 시) 또는 true (수정 시)
}}"""},
    ]

    try:
        gpt_text = await _gpt4o_call_with_retry(gpt_verify_prompt, label=f"Essay#{question_num}-Verify")
        gpt_result = _parse_ai_json(gpt_text)
        if gpt_result:
            v_score = round(float(gpt_result.get("score", g_score)) * 2) / 2
            v_score = max(0, min(v_score, max_score))
            v_feedback = gpt_result.get("feedback", g_feedback)
            v_adjusted = gpt_result.get("adjusted", False)

            if v_adjusted and abs(v_score - g_score) > 0.5:
                final_score = round((g_score * 0.4 + v_score * 0.6) * 2) / 2
                final_feedback = f"{g_feedback} [검증: {v_feedback}]"
                confidence = 80
                logger.info(f"[Essay #{question_num}] GPT-4o 수정: {g_score}→{v_score}, 최종={final_score}")
            else:
                final_score = g_score
                final_feedback = g_feedback
                confidence = 88
                logger.info(f"[Essay #{question_num}] GPT-4o 동의: {final_score}점 확정")

            return {
                "score": final_score, "max_score": max_score,
                "feedback": final_feedback, "confidence": confidence,
                "score_a": g_score, "score_b": v_score,
            }
    except Exception as e:
        logger.error(f"[Essay #{question_num}] GPT-4o 검증 실패: {e}")

    return {
        "score": g_score, "max_score": max_score,
        "feedback": g_feedback, "confidence": min(g_confidence, 75),
        "score_a": g_score, "score_b": g_score,
    }


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


async def _fallback_gpt4o_grade(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """Gemini 실패 시 GPT-4o 단독 채점 (fallback)"""
    q_text_section = f"\n문제: {question_text}" if question_text else ""

    prompt = [
        {"role": "system", "content": "한국 중고등학교 수학 서술형 채점자입니다. JSON으로만 응답하세요."},
        {"role": "user", "content": f"""{question_num}번 수학 서술형 채점{q_text_section}
배점: {max_score}점 | 모범답안: {correct_answer} | 학생답안(OCR): {student_answer}
기준: 최종답 50%, 풀이과정 35%, 수학표현 15%. 0.5점 단위.
JSON: {{"score": 숫자, "max_score": {max_score}, "feedback": "사유(한국어)"}}"""},
    ]

    try:
        text = await _gpt4o_call_with_retry(prompt, label=f"Essay#{question_num}-GPT-Fallback")
        result = _parse_ai_json(text)
        if result:
            score = round(float(result.get("score", 0)) * 2) / 2
            return {
                "score": max(0, min(score, max_score)),
                "max_score": max_score,
                "feedback": result.get("feedback", ""),
                "confidence": 70,
                "score_a": score, "score_b": score,
            }
    except Exception as e:
        logger.error(f"[Essay #{question_num}] GPT-4o fallback 실패: {e}")

    return {
        "score": 0, "max_score": max_score,
        "feedback": "AI 채점 실패", "confidence": 0,
        "score_a": 0, "score_b": 0,
    }


async def _fallback_gemini_grade(
    question_num: int,
    student_answer: str,
    correct_answer: str,
    max_score: float = 10,
    question_text: str = "",
) -> dict:
    """하위 호환용 (기존 코드에서 호출될 수 있으므로 유지)"""
    return await grade_essay_independent(
        question_num, student_answer, correct_answer, max_score, question_text
    )


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
