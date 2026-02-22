"""AI 채점 에이전트: 개별 문제 집중 검증으로 OCR 정확도 극대화

기존 전체 페이지 OCR의 한계를 보완하는 에이전트 파이프라인:
1단계: 전체 페이지 OCR (기존 방식 - 빠른 초벌 분석)
2단계: 각 문제를 하나씩 개별 검증 (집중 분석)
3단계: 초벌 + 개별 검증 결과 비교 → 일치하면 확정, 불일치면 최종 판단

핵심 원리: AI가 20개 문제를 동시에 읽을 때보다
1개 문제에만 집중할 때 정확도가 훨씬 높음 (인지 과부하 해소)
"""
import asyncio
import base64
import logging

logger = logging.getLogger(__name__)

VERIFY_CONCURRENCY = 8  # 동시 검증 요청 수 제한 (API rate limit 방어)


async def agent_verify_ocr(
    image_bytes_list: list[bytes],
    initial_ocr_results: list[dict],
    expected_questions: list[str] | None = None,
    question_types: dict | None = None,
) -> list[dict]:
    """AI 에이전트: 각 문제를 개별 검증하여 OCR 결과 보강

    Args:
        image_bytes_list: 전처리된 이미지 바이트 리스트
        initial_ocr_results: 1차 전체 페이지 OCR 결과 (cross_validate_ocr 결과)
        expected_questions: 정답지에 등록된 문제 번호 리스트
        question_types: 문제 유형 딕셔너리 {"1": "mc", "2": "short", ...}

    Returns:
        에이전트 검증 완료된 OCR 결과 리스트 (기존 형식과 동일)
    """
    q_types = question_types or {}
    verified_results = []

    feedback_hint = await _load_feedback_hint()

    for idx, (img_bytes, ocr_data) in enumerate(zip(image_bytes_list, initial_ocr_results)):
        page_type = ocr_data.get("page_type", "answer_sheet")

        if page_type == "solution_only" and not ocr_data.get("answers"):
            logger.info(f"[Agent] 이미지 {idx}: 풀이 노트 (답 없음) → 검증 건너뜀")
            verified_results.append(ocr_data)
            continue

        answers = ocr_data.get("answers", {})
        if not answers:
            logger.info(f"[Agent] 이미지 {idx}: 답 없음 → 검증 건너뜀")
            verified_results.append(ocr_data)
            continue

        all_questions_to_check = set(answers.keys())
        if expected_questions:
            for q in expected_questions:
                all_questions_to_check.add(q)

        logger.info(f"[Agent] 이미지 {idx}: {len(all_questions_to_check)}개 문제 개별 검증 시작")

        sem = asyncio.Semaphore(VERIFY_CONCURRENCY)
        tasks = {}
        for q_num in sorted(all_questions_to_check, key=_sort_question_key):
            q_type = q_types.get(q_num, _guess_type_from_answer(answers.get(q_num, {})))
            initial_answer = _extract_initial_answer(answers.get(q_num, {}))
            tasks[q_num] = _verify_with_semaphore(
                sem, img_bytes, q_num, initial_answer, q_type, feedback_hint
            )

        task_results = await asyncio.gather(
            *[tasks[q] for q in sorted(tasks.keys(), key=_sort_question_key)],
            return_exceptions=True,
        )

        verified_answers = dict(answers)
        sorted_questions = sorted(tasks.keys(), key=_sort_question_key)

        match_count = 0
        override_count = 0

        for q_num, result in zip(sorted_questions, task_results):
            if isinstance(result, Exception):
                logger.warning(f"[Agent] {q_num}번 검증 실패: {result}")
                continue

            initial = _extract_initial_answer(answers.get(q_num, {}))
            verified = result.get("answer", initial)
            has_mark = result.get("has_student_mark", True)
            confidence = result.get("confidence", 50)

            if not has_mark and verified != "unanswered":
                verified = "unanswered"
                confidence = 90

            initial_norm = _normalize_for_compare(initial)
            verified_norm = _normalize_for_compare(verified)

            if initial_norm == verified_norm:
                match_count += 1
                if isinstance(verified_answers.get(q_num), dict):
                    verified_answers[q_num]["confidence"] = max(
                        verified_answers[q_num].get("confidence", 80), confidence
                    )
            else:
                override_count += 1
                logger.info(
                    f"[Agent] {q_num}번 수정: '{initial}' → '{verified}' "
                    f"(has_mark={has_mark}, conf={confidence})"
                )
                if isinstance(verified_answers.get(q_num), dict):
                    old_data = verified_answers[q_num]
                    verified_answers[q_num] = {
                        "answer": verified,
                        "ocr1": old_data.get("ocr1", initial),
                        "ocr2": old_data.get("ocr2", ""),
                        "agent_verified": verified,
                        "match": False,
                        "confidence": confidence,
                    }
                else:
                    verified_answers[q_num] = {
                        "answer": verified,
                        "ocr1": initial,
                        "ocr2": "",
                        "agent_verified": verified,
                        "match": False,
                        "confidence": confidence,
                    }

        logger.info(
            f"[Agent] 이미지 {idx} 완료: "
            f"{len(sorted_questions)}문제 검증, 일치={match_count}, 수정={override_count}"
        )

        verified_data = dict(ocr_data)
        verified_data["answers"] = verified_answers
        verified_results.append(verified_data)

    return verified_results


async def _verify_with_semaphore(
    sem: asyncio.Semaphore,
    image_bytes: bytes,
    question_num: str,
    initial_answer: str,
    q_type: str,
    feedback_hint: str = "",
) -> dict:
    async with sem:
        return await _verify_single_question(image_bytes, question_num, initial_answer, q_type, feedback_hint)


async def _verify_single_question(
    image_bytes: bytes,
    question_num: str,
    initial_answer: str,
    q_type: str,
    feedback_hint: str = "",
) -> dict:
    """단일 문제 집중 검증: 해당 문제만 보고 학생 답 확인

    Returns:
        {"answer": "③", "has_student_mark": True, "confidence": 92}
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, AI_API_TIMEOUT, GEMINI_MODEL

    if not GEMINI_API_KEY:
        return {"answer": initial_answer, "has_student_mark": True, "confidence": 50}

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)
    _request_opts = {"timeout": AI_API_TIMEOUT}
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    type_label = {
        "mc": "객관식(5지선다)",
        "short": "단답형(숫자/수식)",
        "essay": "서술형",
    }.get(q_type, "단답형")

    mc_instructions = ""
    if q_type == "mc":
        mc_instructions = """
[객관식 판별법]
1. {q}번 보기 영역(①②③④⑤)을 찾으세요
2. 보기 배치를 파악: 1줄(① ② ③ ④ ⑤) 또는 2줄(①②③ / ④⑤) 또는 세로
3. 학생의 동그라미/체크 표시가 어느 위치에 있는지 확인
4. 그 위치의 인쇄된 보기 번호를 읽기
5. ★ 위치 기반 판단이 숫자 모양 판단보다 정확! ★
   - 2줄 배치에서 윗줄이면 ①②③, 아랫줄이면 ④⑤
   - ②와 ⑤는 동그라미 안에서 매우 비슷 → 반드시 위치로 결정
6. 답은 반드시 ①②③④⑤ 형태로 기록""".replace("{q}", question_num)

    short_instructions = ""
    if q_type == "short":
        short_instructions = """
[단답형 판별법]
1. 답란(빈칸/박스)에 학생이 손으로 적은 최종값만 읽기
2. 풀이 과정의 중간 계산값 ≠ 최종 답
3. '답:', '∴', '=' 뒤의 최종값
4. 답란에 아무것도 안 적혀있으면 → "unanswered"
"""

    feedback_section = ""
    if feedback_hint:
        feedback_section = f"\n{feedback_hint}\n"

    prompt = f"""이 시험지/문제지에서 **{question_num}번 문제만** 집중해서 봐주세요.
문제 유형: {type_label}{feedback_section}

★★★ 가장 중요: 학생 표시 유무 판별 ★★★

{question_num}번 문제의 답 영역을 찾고, 아래를 확인하세요:

[학생 표시란?]
- 동그라미(○), 체크(✓), 밑줄, 색칠, 손글씨 숫자/문자
- 특징: 불규칙, 필압 차이, 펜 자국이 뚜렷

[인쇄 텍스트란?]
- 깔끔하고 균일한 활자체, 완벽하게 정렬됨
- 보기 번호(①②③④⑤), 문제 텍스트, 선택지 내용

★ 판단 기준 ★
- 학생 표시가 있으면 → has_student_mark: true, 표시된 답을 읽기
- 학생 표시가 전혀 없으면 → has_student_mark: false, answer: "unanswered"
- 인쇄된 보기만 있고 학생 표시가 없으면 → "unanswered"
{mc_instructions}{short_instructions}
참고: 1차 분석에서 이 문제의 답은 "{initial_answer}"(으)로 읽혔습니다.
이것이 맞는지 이미지를 직접 보고 독립적으로 판단하세요.

반드시 아래 JSON만 응답 (다른 텍스트 없이):
{{"answer": "학생 답 또는 unanswered", "has_student_mark": true, "confidence": 90}}"""

    from ocr.engines import _retry_async, _robust_json_parse

    async def _call():
        response = model.generate_content(
            [prompt, {"mime_type": "image/jpeg", "data": b64}],
            request_options=_request_opts,
        )
        return response

    response = await _retry_async(_call, label=f"Agent-Q{question_num}", max_retries=2)
    parsed = _robust_json_parse(response.text)

    if parsed and isinstance(parsed, dict):
        answer = str(parsed.get("answer", initial_answer))
        has_mark = parsed.get("has_student_mark", True)
        confidence = min(95, max(50, parsed.get("confidence", 80)))

        if isinstance(has_mark, str):
            has_mark = has_mark.lower() in ("true", "yes", "1")

        return {"answer": answer, "has_student_mark": has_mark, "confidence": confidence}

    logger.warning(f"[Agent] {question_num}번 파싱 실패: {response.text[:200]}")
    return {"answer": initial_answer, "has_student_mark": True, "confidence": 50}


def _extract_initial_answer(val) -> str:
    if isinstance(val, dict):
        return str(val.get("answer", ""))
    return str(val) if val else ""


def _normalize_for_compare(s: str) -> str:
    if not s:
        return ""
    s = s.strip().lower().replace(" ", "")
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    for k, v in circle_map.items():
        s = s.replace(k, v)
    return s


def _guess_type_from_answer(val) -> str:
    answer = _extract_initial_answer(val)
    if not answer or answer == "unanswered":
        return "mc"
    circle_nums = {"①", "②", "③", "④", "⑤"}
    if answer in circle_nums:
        return "mc"
    if len(answer) > 50:
        return "essay"
    return "short"


import re

def _sort_question_key(q: str):
    m = re.match(r"(\d+)", q)
    return (int(m.group(1)) if m else 9999, q)


async def _load_feedback_hint() -> str:
    """DB에서 최근 피드백 패턴을 로드하여 프롬프트 힌트 문자열로 변환"""
    try:
        from integrations.supabase_client import get_supabase, run_query

        sb = get_supabase()
        res = await run_query(
            sb.table("grading_feedback")
            .select("question_type,ai_answer,teacher_corrected_answer,error_type")
            .order("created_at", desc=True)
            .limit(30)
            .execute
        )
        feedbacks = res.data or []
        if not feedbacks:
            return ""

        error_counts = {}
        for fb in feedbacks:
            et = fb.get("error_type", "unknown")
            error_counts[et] = error_counts.get(et, 0) + 1

        examples = []
        seen = set()
        for fb in feedbacks:
            key = (fb.get("ai_answer", ""), fb.get("teacher_corrected_answer", ""))
            if key in seen:
                continue
            seen.add(key)
            examples.append(
                f"  - AI가 '{fb.get('ai_answer')}' → 실제는 '{fb.get('teacher_corrected_answer')}' "
                f"({fb.get('error_type', '')})"
            )
            if len(examples) >= 8:
                break

        lines = ["★ 선생님 피드백 기반 주의사항 (과거 오류 패턴) ★"]
        if error_counts.get("mc_2_5_confusion", 0) > 0:
            lines.append(f"⚠ ②↔⑤ 혼동 {error_counts['mc_2_5_confusion']}회 발생 → 위치 기반 판별 필수!")
        if error_counts.get("false_answered", 0) > 0:
            lines.append(f"⚠ 안 푼 문제를 풀었다고 오인 {error_counts['false_answered']}회 → 학생 표시 유무 재확인!")
        if error_counts.get("false_unanswered", 0) > 0:
            lines.append(f"⚠ 푼 문제를 안 풀었다고 오인 {error_counts['false_unanswered']}회 → 작은 표시도 놓치지 마세요!")
        if error_counts.get("mc_wrong_number", 0) > 0:
            lines.append(f"⚠ 객관식 번호 오인식 {error_counts['mc_wrong_number']}회 → 보기 위치 대조 필수!")
        if error_counts.get("ocr_misread", 0) > 0:
            lines.append(f"⚠ 단답형/서술형 오인식 {error_counts['ocr_misread']}회 → 최종 답란만 읽기!")
        if error_counts.get("ambiguous_mark", 0) > 0:
            lines.append(f"⚠ 모호한 표시(별표/취소선) 오인 {error_counts['ambiguous_mark']}회 → 별표·취소선·낙서는 답이 아님!")
        if error_counts.get("wrong_question_area", 0) > 0:
            lines.append(f"⚠ 다른 문제 영역 읽음 {error_counts['wrong_question_area']}회 → 해당 문제 번호 영역만 확인!")
        if error_counts.get("mc_position_confusion", 0) > 0:
            lines.append(f"⚠ 객관식 위치 혼동 {error_counts['mc_position_confusion']}회 → 보기 배치 위치 기반 판별 필수!")

        if examples:
            lines.append("최근 오류 예시:")
            lines.extend(examples)

        hint = "\n".join(lines)
        logger.info(f"[Feedback] 피드백 힌트 로드: {len(feedbacks)}건, 유형별 {error_counts}")
        return hint

    except Exception as e:
        logger.debug(f"[Feedback] 힌트 로드 실패 (무시): {e}")
        return ""
