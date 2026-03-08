"""학생-교재 관리 라우터"""
import logging

from fastapi import APIRouter, Form, HTTPException

from integrations.supabase_client import (
    get_student_books, get_student_books_by_teacher, add_student_book, remove_student_book,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/student-books", tags=["student-books"])


@router.get("")
async def list_student_books(teacher_id: str):
    data = await get_student_books_by_teacher(teacher_id)
    return {"data": data}


@router.get("/{student_id}")
async def list_books_for_student(student_id: int):
    data = await get_student_books(student_id)
    return {"data": data}


@router.post("")
async def add_student_book_endpoint(
    student_id: int = Form(...),
    answer_key_id: int = Form(...),
    teacher_id: str = Form(...),
):
    result = await add_student_book(student_id, answer_key_id, teacher_id)
    return {"data": result}


@router.delete("/{book_id}")
async def remove_student_book_endpoint(book_id: int):
    ok = await remove_student_book(book_id)
    if not ok:
        raise HTTPException(status_code=404, detail="해당 교재 연결을 찾을 수 없습니다")
    return {"ok": True}
