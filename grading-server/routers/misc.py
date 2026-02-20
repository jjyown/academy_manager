"""기타 API 라우터 (teachers, notifications, evaluations, cleanup)"""
import logging

from fastapi import APIRouter, Form, HTTPException, Request

from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token, update_grading_result,
    create_notification, get_notifications, mark_notifications_read,
)
from integrations.drive import cleanup_old_originals, delete_file
from scheduler.monthly_eval import run_monthly_evaluation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["misc"])


@router.get("/teachers")
async def list_teachers():
    try:
        sb = get_supabase()
        res = await run_query(sb.table("teachers").select("*").order("created_at").execute)
        return {"data": res.data or []}
    except Exception as e:
        logger.error(f"선생님 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"선생님 목록 조회 실패: {str(e)[:200]}")


@router.get("/notifications")
async def list_notifications(teacher_id: str, unread_only: bool = False):
    notifications = await get_notifications(teacher_id, unread_only=unread_only)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    return {"data": notifications, "unread_count": unread_count}


@router.put("/notifications/read")
async def read_notifications(request: Request):
    try:
        body = await request.json()
        teacher_id = body.get("teacher_id", "")
        notification_ids = body.get("notification_ids")
        if not teacher_id:
            raise HTTPException(400, "teacher_id가 필요합니다")
        await mark_notifications_read(teacher_id, notification_ids)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"알림 읽음 처리 실패: {e}")
        raise HTTPException(status_code=500, detail=f"알림 읽음 처리 실패: {str(e)[:200]}")


@router.post("/evaluations/generate")
async def trigger_evaluation(teacher_id: str = Form(...)):
    await run_monthly_evaluation()
    return {"status": "ok"}


@router.put("/evaluations/{eval_id}/approve")
async def approve_evaluation(eval_id: int):
    sb = get_supabase()
    await run_query(sb.table("evaluations").update({"approved": True}).eq("id", eval_id).execute)
    return {"status": "approved"}


@router.post("/cleanup/originals")
async def cleanup_originals(result_id: int = Form(...)):
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    sb = get_supabase()
    res = await run_query(sb.table("grading_results").select("central_original_drive_ids").eq("id", result_id).limit(1).execute)
    row = res.data[0] if res.data and len(res.data) > 0 else None
    if row and row.get("central_original_drive_ids"):
        deleted = cleanup_old_originals(central_token, row["central_original_drive_ids"])
        await update_grading_result(result_id, {"central_original_drive_ids": []})
        return {"deleted": deleted}
    return {"deleted": 0}


@router.post("/cleanup/student")
async def cleanup_student_data(
    student_id: int = Form(...),
    delete_files: bool = Form(False),
):
    sb = get_supabase()
    if delete_files:
        central_token = await get_central_admin_token()
        results = await run_query(sb.table("grading_results").select(
            "central_original_drive_ids, central_graded_drive_ids"
        ).eq("student_id", student_id).execute)
        total_deleted = 0
        for r in (results.data or []):
            if central_token:
                for fid in (r.get("central_original_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1
                for fid in (r.get("central_graded_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1
        logger.info(f"학생 {student_id} 드라이브 파일 {total_deleted}개 삭제")
    await run_query(sb.table("grading_results").delete().eq("student_id", student_id).execute)
    return {"status": "cleaned", "student_id": student_id}
