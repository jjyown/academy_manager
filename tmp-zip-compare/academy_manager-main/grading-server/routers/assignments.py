"""과제 관리 라우터"""
import json
import logging

from fastapi import APIRouter, Form, HTTPException

from integrations.supabase_client import (
    get_assignments_by_teacher, create_assignment, update_assignment, delete_assignment,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@router.get("")
async def list_assignments(teacher_id: str):
    assignments = await get_assignments_by_teacher(teacher_id)
    return {"data": assignments}


@router.post("")
async def create_new_assignment(
    teacher_id: str = Form(...),
    title: str = Form(...),
    answer_key_id: int = Form(None),
    page_range: str = Form(""),
    due_date: str = Form(None),
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
        "due_date": due_date,
        "mode": mode,
        "assigned_students": students,
    }
    result = await create_assignment(data)
    return {"data": result}


@router.put("/{assignment_id}")
async def update_assignment_endpoint(
    assignment_id: int,
    title: str = Form(...),
    answer_key_id: int = Form(None),
    page_range: str = Form(""),
    due_date: str = Form(None),
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
        "due_date": due_date,
        "assigned_students": students,
    }
    result = await update_assignment(assignment_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")
    return {"data": result}


@router.delete("/{assignment_id}")
async def delete_assignment_endpoint(assignment_id: int):
    ok = await delete_assignment(assignment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")
    return {"ok": True}
