"""학부모·학생 포털용: 인증코드 검증 후 확정(confirmed) 채점만 조회 (JWT 불필요)."""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException

from integrations.supabase_client import (
    get_supabase,
    get_student,
    get_grading_results_by_student,
    get_answer_key,
    run_query,
)
from integrations import highroad_solution

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public-portal-grading", tags=["public-portal-grading"])

_PUBLIC_RESULT_FIELDS = {
    "id",
    "student_id",
    "total_score",
    "max_score",
    "correct_count",
    "wrong_count",
    "uncertain_count",
    "unanswered_count",
    "total_questions",
    "page_info",
    "created_at",
    "homework_submission_id",
    "central_graded_image_urls",
    "answer_key_id",
    "answer_keys",
}

_PUBLIC_ITEM_FIELDS = {
    "id",
    "question_number",
    "question_label",
    "question_type",
    "student_answer",
    "correct_answer",
    "is_correct",
    "ai_feedback",
    # highroad-math-solution 매핑 시 첨부 — 학생/학부모 포털에서도 노출
    "solution_body",
    "solution_source_kind",
    "solution_status",
}


def normalize_portal_access_code(value: str) -> str:
    """homework/parent 포털과 동일: 전각·대문자·구분자 제거."""
    out_chars: list[str] = []
    for ch in str(value or ""):
        c = ord(ch)
        if 0xFF10 <= c <= 0xFF19:
            out_chars.append(chr(c - 0xFF10 + 0x30))
        elif 0xFF21 <= c <= 0xFF3A:
            out_chars.append(chr(c - 0xFF21 + 0x41))
        elif 0xFF41 <= c <= 0xFF5A:
            out_chars.append(chr(c - 0xFF41 + 0x61))
        else:
            out_chars.append(ch)
    s = "".join(out_chars).upper()
    s = re.sub(r"[\s\-_]", "", s)
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


async def verify_student_portal_code(student_id: int, raw_code: str) -> bool:
    st = await get_student(student_id)
    if not st:
        return False
    if str(st.get("status") or "").lower() != "active":
        return False
    n = normalize_portal_access_code(raw_code)
    if not n:
        return False
    sc = normalize_portal_access_code(str(st.get("student_code") or ""))
    pc = normalize_portal_access_code(str(st.get("parent_code") or ""))
    return n == sc or n == pc


def _sanitize_results(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for r in rows:
        item = {k: r[k] for k in _PUBLIC_RESULT_FIELDS if k in r}
        out.append(item)
    return out


def _sanitize_items(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for r in rows:
        item = {k: r[k] for k in _PUBLIC_ITEM_FIELDS if k in r}
        out.append(item)
    return out


@router.get("/student-results")
async def list_confirmed_results_for_portal(student_id: int, verification_code: str = ""):
    """
    학생·학부모 인증코드(student_code 또는 parent_code) 일치 시,
    status=confirmed 인 채점 결과만 반환.
    """
    code = (verification_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="verification_code가 필요합니다")
    if not await verify_student_portal_code(student_id, code):
        raise HTTPException(status_code=403, detail="인증코드가 일치하지 않습니다")

    results = await get_grading_results_by_student(student_id)
    return {"data": _sanitize_results(results)}


@router.get("/results/{result_id}/items")
async def list_confirmed_result_items_for_portal(result_id: int, verification_code: str = ""):
    code = (verification_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="verification_code가 필요합니다")

    sb = get_supabase()
    res = await run_query(
        sb.table("grading_results")
        .select("id, student_id, status, answer_key_id")
        .eq("id", result_id)
        .limit(1)
        .execute
    )
    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="결과를 찾을 수 없습니다")
    if row.get("status") != "confirmed":
        raise HTTPException(status_code=404, detail="결과를 찾을 수 없습니다")

    sid = int(row["student_id"])
    if not await verify_student_portal_code(sid, code):
        raise HTTPException(status_code=403, detail="인증코드가 일치하지 않습니다")

    items_res = await run_query(
        sb.table("grading_items")
        .select("*")
        .eq("result_id", result_id)
        .order("question_number")
        .execute
    )
    raw = items_res.data or []

    # 검수 완료 해설 첨부 — 외부 시스템 장애에도 채점 결과 자체는 노출되도록 안전하게.
    if raw and highroad_solution.is_enabled():
        ak_id = row.get("answer_key_id")
        if ak_id:
            try:
                ak = await get_answer_key(int(ak_id))
                if ak:
                    labels = [str(it.get("question_label") or it.get("question_number") or "").strip() for it in raw]
                    labels = [s for s in labels if s]
                    exam_map, pair_map = await highroad_solution.load_solutions_for_answer_key(ak, item_labels=labels)
                    if exam_map or pair_map:
                        highroad_solution.attach_solutions_to_items(raw, exam_map, pair_map)
            except Exception as e:
                logger.warning(f"[Portal] 해설 첨부 실패(무시) result={result_id}: {e}")

    return {"data": _sanitize_items(raw)}
