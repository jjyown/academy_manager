"""학생용 숙제 배정(due_date/due_time) 조회 API 라우터"""

import json
import logging
from datetime import date

from fastapi import APIRouter, HTTPException

from integrations.supabase_client import (
    get_supabase,
    get_student,
    get_homework_assignments_by_owner_student_dates,
    run_query,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/homework-assignments", tags=["homework-assignments"])

_MAX_RANGE_DAYS = 400


def _parse_iso_date(label: str, s: str) -> date:
    if not s or len(s) < 10:
        raise HTTPException(status_code=400, detail=f"{label}: YYYY-MM-DD 형식이 필요합니다")
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label}: 날짜가 올바르지 않습니다")


async def _assert_student_in_academy(student_id: int, owner_user_id: str) -> None:
    """학생이 해당 원장(owner_user_id) 학원 소속인지 검증"""
    st = await get_student(student_id)
    if not st:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다")

    if str(st.get("owner_user_id") or "").strip() == str(owner_user_id).strip():
        return

    tech_id = st.get("teacher_id")
    if tech_id is None:
        raise HTTPException(status_code=403, detail="이 학원에서 조회할 수 없는 학생입니다")

    sb = get_supabase()
    res = await run_query(
        sb.table("teachers").select("owner_user_id").eq("id", tech_id).limit(1).execute
    )
    row = (res.data or [None])[0]
    if not row or str(row.get("owner_user_id") or "").strip() != str(owner_user_id).strip():
        raise HTTPException(status_code=403, detail="이 학원에서 조회할 수 없는 학생입니다")


@router.get("")
async def list_homework_assignments(
    teacher_id: str,
    student_id: int,
    date_from: str,
    date_to: str,
):
    """
    원장(owner_user_id = teacher_id 파라미터) 소유 숙제 배정 목록(due_date/due_time).

    - teacher_id: grading_assignments.teacher_id 와 동일(= auth.users.id / owner_user_id)
    - student_id: 학생 id
    - date_from/date_to: YYYY-MM-DD

    반환: [
      { id, due_date, due_time, title, page_range,
        answer_key_id, answer_keys:{ id,title,subject } }
    ]
    """
    owner = (teacher_id or "").strip()
    if not owner:
        raise HTTPException(status_code=400, detail="teacher_id(owner_user_id)가 필요합니다")

    d0 = _parse_iso_date("date_from", date_from)
    d1 = _parse_iso_date("date_to", date_to)
    if d0 > d1:
        raise HTTPException(status_code=400, detail="date_from이 date_to보다 늦을 수 없습니다")
    if (d1 - d0).days > _MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"조회 기간은 최대 {_MAX_RANGE_DAYS}일까지입니다")

    await _assert_student_in_academy(student_id, owner)

    df = d0.isoformat()
    dt = d1.isoformat()
    try:
        rows = await get_homework_assignments_by_owner_student_dates(owner, student_id, df, dt)
    except Exception as e:
        logger.error(f"숙제 배정 조회 실패 owner={owner} student={student_id}: {e}")
        raise HTTPException(status_code=500, detail="숙제 배정 조회에 실패했습니다") from e

    return {"data": rows}

