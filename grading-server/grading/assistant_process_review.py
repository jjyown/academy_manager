"""전문 채점조교 모듈 #2 — 풀이 검토 조교.

채점 결과 중 의심 항목(서답형, 신뢰도 낮음, uncertain) 만 골라
"정답은 맞았어도 풀이 과정에 실수가 없는지" 를 Gemini Vision 으로 점검한다.

출력은 grading_items 의 다음 컬럼에 저장:
  - process_feedback         : 자연어 코멘트
  - suggested_partial_score  : 부분점수 제안(0~max_score)
  - process_review_flags     : 이슈 카테고리 배열(예: ["sign_error","exponent_lost"])

파이프라인 위치: grade_submission 루프 종료 후, create_grading_items() 전.
입력: image_bytes_list(원본 페이지 이미지), all_items(채점 완료 grading_items dict 배열),
       answer_key(answers_json, question_types_json 포함).
출력: all_items 와 같은 길이의 리스트(같은 객체에 in-place 로 새 필드가 채워짐).

비용 통제: PROCESS_REVIEWER_MAX_ITEMS 까지만 호출, hard timeout 으로 전체 wall 제한.
"""
import asyncio
import base64
import json
import logging
import re

import google.generativeai as genai

from config import (
    PROCESS_REVIEWER_MAX_ITEMS,
    PROCESS_REVIEWER_HARD_TIMEOUT_SECONDS,
    PROCESS_REVIEWER_CONFIDENCE_THRESHOLD,
    AI_API_TIMEOUT,
    GEMINI_MODEL,
)
from integrations.gemini import _gemini_call_with_retry

logger = logging.getLogger(__name__)

# Flag 카테고리 화이트리스트 — 모델이 자유롭게 텍스트 만들지 않도록 제한
_ALLOWED_FLAGS = {
    "sign_error",        # 부호 오류 (-가 + 로 보임 등)
    "exponent_lost",     # 지수 누락 / 잘못 표기
    "unit_missing",      # 단위 누락
    "calc_step_error",   # 중간 계산 단계 오류
    "transcription_error",  # 답 옮겨 적기 오류 (풀이 정답 ≠ 답란)
    "logic_gap",         # 풀이 논리 비약/생략
    "format_issue",      # 답 형식 문제(분수/소수 등)
    "answer_correct",    # 풀이도 답도 깔끔 (이슈 없음)
}

# 실수 카테고리 — 학생별 취약점 누적 분석용. 오답일 때만 의미 있음.
_ALLOWED_MISTAKE_CATEGORIES = {
    "conceptual",     # 개념 이해 부족 (공식·정의 자체를 모름)
    "computational",  # 개념은 알지만 계산 실수
    "careless",       # 실수(부주의, 옮겨적기, 단위 누락 등)
    "transcription",  # 풀이는 맞았으나 답란에 옮길 때 실수
    "time_pressure",  # 시간 부족 흔적(빈칸/중간에 끊김)
    "unknown",        # 분류 불가
}


def _is_review_candidate(item: dict) -> bool:
    """이 항목을 풀이 검토 대상으로 볼지 결정.

    조건(OR):
      - is_correct == None 또는 부분점수 구간 (uncertain)
      - question_type == 'essay' (서답형은 항상 검토)
      - confidence 가 임계값 미만
    """
    if not isinstance(item, dict):
        return False
    qtype = (item.get("question_type") or "").lower()
    if qtype == "essay":
        return True
    if item.get("is_correct") is None:
        return True
    try:
        conf = float(item.get("confidence") or 0)
        if conf and conf < (PROCESS_REVIEWER_CONFIDENCE_THRESHOLD * 100 if conf > 1.0 else PROCESS_REVIEWER_CONFIDENCE_THRESHOLD):
            return True
    except Exception:
        pass
    return False


def _build_item_prompt(item: dict, correct_answer: str, question_type: str) -> str:
    student_answer = str(item.get("student_answer") or "").strip()
    student_normalized = str(item.get("student_answer_normalized") or "").strip()
    q_label = str(item.get("question_label") or item.get("question_number") or "?")
    is_correct = item.get("is_correct")
    judged = (
        "정답 처리" if is_correct is True
        else "오답 처리" if is_correct is False
        else "판단 보류(uncertain)"
    )
    return (
        "당신은 한국 수학 학원의 전문 채점조교입니다. 1차 자동 채점 결과를 받고, "
        "**풀이 과정의 디테일한 실수**를 검토해 선생님 확정 전에 보고하는 역할입니다.\n\n"
        "검토 원칙:\n"
        "1) 최종 답이 맞아도 풀이 과정에 부호·지수·단위·중간계산 실수가 있으면 반드시 보고하세요.\n"
        "2) 최종 답이 틀려도 풀이가 거의 맞고 옮겨 적기만 실수했다면 'transcription_error' 플래그 + 부분점수.\n"
        "3) 객관식이라 풀이가 없으면 'answer_correct' 또는 빈 결과로 응답.\n"
        "4) 부분점수는 max_score 기준 0~max_score 사이 정수(또는 .5 단위). 자신 없으면 null.\n\n"
        f"문항 번호: {q_label}\n"
        f"문제 유형: {question_type or 'unknown'}\n"
        f"정답: {correct_answer}\n"
        f"학생 답(OCR 원본): {student_answer}\n"
        f"학생 답(정제본): {student_normalized}\n"
        f"1차 채점 결과: {judged}\n"
        f"max_score: {item.get('ai_max_score') or 10}\n\n"
        "응답은 반드시 JSON 한 개만(다른 텍스트 없이):\n"
        "{\n"
        '  "feedback": "한두 문장 한국어로",\n'
        '  "suggested_score": <숫자 or null>,\n'
        '  "flags": ["sign_error","calc_step_error", ...],   // 허용: '
        + ", ".join(sorted(_ALLOWED_FLAGS)) + ",\n"
        '  "mistake_category": "<오답일 때만, null 가능>"  // 허용: '
        + ", ".join(sorted(_ALLOWED_MISTAKE_CATEGORIES)) + "\n"
        "}\n"
        "이슈가 없다면 flags 는 [\"answer_correct\"], mistake_category 는 null.\n"
        "정답이면 mistake_category 는 항상 null.\n"
    )


def _parse_review_response(text: str) -> dict | None:
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        data = json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            return None
    if not isinstance(data, dict):
        return None
    fb = str(data.get("feedback") or "").strip()
    raw_flags = data.get("flags") or []
    flags = [f for f in raw_flags if isinstance(f, str) and f in _ALLOWED_FLAGS]
    score = data.get("suggested_score")
    try:
        score_val = float(score) if score is not None else None
    except Exception:
        score_val = None
    mc_raw = data.get("mistake_category")
    mistake_category = mc_raw if (isinstance(mc_raw, str) and mc_raw in _ALLOWED_MISTAKE_CATEGORIES) else None
    return {
        "feedback": fb,
        "suggested_score": score_val,
        "flags": flags,
        "mistake_category": mistake_category,
    }


async def _review_one(item: dict, image_bytes: bytes | None, correct_answer: str,
                      question_type: str) -> dict | None:
    """단일 문항 검토 — Gemini Vision (이미지 있으면 첨부, 없으면 텍스트만)."""
    prompt = _build_item_prompt(item, correct_answer, question_type)
    try:
        if image_bytes:
            model = genai.GenerativeModel(GEMINI_MODEL)
            payload = [
                prompt,
                {"mime_type": "image/jpeg", "data": image_bytes},
            ]
            resp = await asyncio.to_thread(
                lambda: model.generate_content(payload, request_options={"timeout": AI_API_TIMEOUT})
            )
        else:
            resp = await _gemini_call_with_retry(prompt, label="ProcessReview")
        text = getattr(resp, "text", "") or ""
        return _parse_review_response(text)
    except Exception as e:
        logger.warning(f"[ProcessReview] item#{item.get('question_number')} 호출 실패: {e}")
        return None


async def review_grading_items(
    image_bytes_list: list[bytes],
    all_items: list[dict],
    answer_key: dict,
) -> list[dict]:
    """채점 직후 의심 항목만 검토. all_items 를 in-place 로 갱신해 같은 객체 반환.

    실패하더라도 all_items 자체는 손상시키지 않음(필드만 누락).
    """
    if not all_items:
        return all_items

    answers_json = (answer_key or {}).get("answers_json") or {}
    qtypes = (answer_key or {}).get("question_types_json") or {}

    # 대상 선별
    candidates: list[tuple[int, dict]] = []
    for idx, it in enumerate(all_items):
        if _is_review_candidate(it):
            candidates.append((idx, it))

    if not candidates:
        logger.info("[ProcessReview] 검토 대상 항목 없음 — skip")
        return all_items

    max_n = PROCESS_REVIEWER_MAX_ITEMS if PROCESS_REVIEWER_MAX_ITEMS > 0 else len(candidates)
    if len(candidates) > max_n:
        logger.info(
            f"[ProcessReview] 검토 대상 {len(candidates)}개 → 비용 한도 {max_n}개로 절단 "
            f"(question_number 작은 순으로)"
        )
        candidates.sort(key=lambda x: int(x[1].get("question_number") or 9999))
        candidates = candidates[:max_n]

    async def _run_one(pair):
        idx, it = pair
        q_num = it.get("question_number")
        q_key = str(q_num)
        correct = str(answers_json.get(q_key) or it.get("correct_answer") or "")
        qtype = str(qtypes.get(q_key) or it.get("question_type") or "")
        # source_image_index 가 있으면 해당 이미지 첨부
        img_bytes = None
        sii = it.get("source_image_index")
        if isinstance(sii, int) and 0 <= sii < len(image_bytes_list):
            img_bytes = image_bytes_list[sii]
        return idx, await _review_one(it, img_bytes, correct, qtype)

    try:
        tasks = [_run_one(p) for p in candidates]
        results = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=PROCESS_REVIEWER_HARD_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(
            f"[ProcessReview] hard timeout({PROCESS_REVIEWER_HARD_TIMEOUT_SECONDS}s) — 진행된 결과까지만 사용"
        )
        return all_items

    applied = 0
    for r in results:
        if isinstance(r, Exception) or r is None:
            continue
        idx, parsed = r
        if not parsed:
            continue
        target = all_items[idx]
        if parsed.get("feedback"):
            target["process_feedback"] = parsed["feedback"][:1000]
        if parsed.get("suggested_score") is not None:
            try:
                target["suggested_partial_score"] = round(float(parsed["suggested_score"]), 1)
            except Exception:
                pass
        flags = parsed.get("flags") or []
        if flags:
            target["process_review_flags"] = flags
        # 오답일 때만 mistake_category 채움(정답은 모델이 null 로 응답하지만 한 번 더 검증)
        if parsed.get("mistake_category") and target.get("is_correct") is False:
            target["mistake_category"] = parsed["mistake_category"]
        applied += 1

    logger.info(f"[ProcessReview] 검토 완료: {applied}/{len(candidates)} 항목에 결과 반영")
    return all_items
