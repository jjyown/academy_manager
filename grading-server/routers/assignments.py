"""과제 관리 라우터"""
import json
import logging
import re

from fastapi import APIRouter, Form, HTTPException

from integrations.supabase_client import (
    get_assignments_by_teacher, create_assignment, update_assignment, delete_assignment,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/assignments", tags=["assignments"])


def _norm_optional_date(v: str | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _norm_due_time(v: str | None) -> str | None:
    """HTML time input(HH:MM) 또는 HH:MM:SS → Postgres TIME 문자열 (HH:MM:SS)."""
    if v is None:
        return None
    s = str(v).strip().replace("：", ":")
    if not s:
        return None
    if len(s) == 5 and s[2] == ":":
        return f"{s}:00"
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        return f"{h:02d}:{mi:02d}:00"
    return s


@router.get("")
async def list_assignments(teacher_id: str):
    assignments = await get_assignments_by_teacher(teacher_id)
    return {"data": assignments}


@router.post("")
async def create_new_assignment(
    teacher_id: str = Form(...),
    title: str = Form(...),
    answer_key_id: int | None = Form(None),
    page_range: str = Form(""),
    due_date: str | None = Form(None),
    due_time: str | None = Form(None),
    mode: str = Form("assigned"),
    assigned_students: str = Form("[]"),
):
    try:
        students = json.loads(assigned_students)
    except Exception:
        students = []
    data = {
        "teacher_id": teacher_id,
        "title": title,
        "answer_key_id": answer_key_id,
        "page_range": page_range,
        "due_date": _norm_optional_date(due_date),
        "due_time": _norm_due_time(due_time),
        "mode": mode,
        "assigned_students": students,
    }
    logger.info("grading_assignments POST due_date=%s due_time(raw)=%s due_time(norm)=%s", due_date, due_time, data.get("due_time"))
    try:
        result = await create_assignment(data)
    except Exception as e:
        logger.exception("create_assignment 실패")
        raise HTTPException(status_code=400, detail=str(e)[:500]) from e
    return {"data": result}


@router.put("/{assignment_id}")
async def update_assignment_endpoint(
    assignment_id: int,
    title: str = Form(...),
    answer_key_id: int | None = Form(None),
    page_range: str = Form(""),
    due_date: str | None = Form(None),
    due_time: str | None = Form(None),
    assigned_students: str = Form("[]"),
):
    try:
        students = json.loads(assigned_students)
    except Exception:
        students = []
    data = {
        "title": title,
        "answer_key_id": answer_key_id,
        "page_range": page_range,
        "due_date": _norm_optional_date(due_date),
        "due_time": _norm_due_time(due_time),
        "assigned_students": students,
    }
    logger.info("grading_assignments PUT id=%s due_date=%s due_time(raw)=%s due_time(norm)=%s", assignment_id, due_date, due_time, data.get("due_time"))
    try:
        result = await update_assignment(assignment_id, data)
    except Exception as e:
        logger.exception("update_assignment 실패")
        raise HTTPException(status_code=400, detail=str(e)[:500]) from e
    if not result:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")
    return {"data": result}


@router.delete("/{assignment_id}")
async def delete_assignment_endpoint(assignment_id: int):
    ok = await delete_assignment(assignment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")
    return {"ok": True}
