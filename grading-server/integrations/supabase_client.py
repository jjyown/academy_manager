import logging
import threading
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

logger = logging.getLogger(__name__)

_client: Client | None = None
_lock = threading.Lock()


def get_supabase() -> Client:
    """메인 스레드용 Supabase 싱글톤 클라이언트 (thread-safe 초기화)"""
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def create_supabase_for_background() -> Client:
    """BackgroundTasks용 독립 Supabase 클라이언트 (스레드 안전)"""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── 중앙 관리자 토큰 ──

async def get_central_admin_token() -> str | None:
    """중앙 관리자(is_central_admin=true) 드라이브 refresh_token 조회"""
    try:
        sb = get_supabase()
        res = sb.table("teachers").select("google_drive_refresh_token").eq(
            "is_central_admin", True
        ).eq("google_drive_connected", True).limit(1).execute()
        if res.data and len(res.data) > 0:
            return res.data[0].get("google_drive_refresh_token")
    except Exception as e:
        logger.error(f"중앙 관리자 토큰 조회 실패: {e}")
    return None


# ── 선생님 토큰 ──

async def get_teacher_drive_token(teacher_id: str) -> str | None:
    """선생님의 드라이브 refresh_token 조회 (owner_user_id 기준)"""
    try:
        sb = get_supabase()
        res = sb.table("teachers").select("google_drive_refresh_token, google_drive_connected").eq(
            "owner_user_id", teacher_id
        ).limit(1).execute()
        if res.data and len(res.data) > 0:
            row = res.data[0]
            if row.get("google_drive_connected"):
                return row.get("google_drive_refresh_token")
    except Exception as e:
        logger.error(f"선생님 드라이브 토큰 조회 실패 (teacher_id={teacher_id}): {e}")
    return None


# ── answer_keys ──

async def get_answer_key(answer_key_id: int) -> dict | None:
    try:
        sb = get_supabase()
        res = sb.table("answer_keys").select("*").eq("id", answer_key_id).limit(1).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception as e:
        logger.error(f"answer_key 조회 실패 (id={answer_key_id}): {e}")
        return None


async def get_answer_keys_by_teacher(teacher_id: str, parsed_only: bool = False) -> list[dict]:
    sb = get_supabase()
    query = sb.table("answer_keys").select("*").eq("teacher_id", teacher_id)
    if parsed_only:
        query = query.eq("parsed", True)
    res = query.order("created_at", desc=True).execute()
    return res.data or []


async def get_all_answer_keys() -> list[dict]:
    """모든 교재 조회 (자동 검색용)"""
    sb = get_supabase()
    res = sb.table("answer_keys").select("*").eq("parsed", True).order("created_at", desc=True).execute()
    return res.data or []


async def upsert_answer_key(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("answer_keys").upsert(data).execute()
    return res.data[0] if res.data else {}


# ── grading_assignments ──

async def get_assignment(assignment_id: int) -> dict | None:
    try:
        sb = get_supabase()
        res = sb.table("grading_assignments").select("*").eq("id", assignment_id).limit(1).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception as e:
        logger.error(f"assignment 조회 실패 (id={assignment_id}): {e}")
        return None


async def get_assignments_by_teacher(teacher_id: str) -> list[dict]:
    sb = get_supabase()
    res = sb.table("grading_assignments").select("*, answer_keys(title, subject)").eq("teacher_id", teacher_id).order("created_at", desc=True).execute()
    return res.data or []


async def create_assignment(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("grading_assignments").insert(data).execute()
    return res.data[0] if res.data else {}


# ── grading_results ──

async def create_grading_result(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("grading_results").insert(data).execute()
    return res.data[0] if res.data else {}


async def update_grading_result(result_id: int, data: dict) -> dict:
    sb = get_supabase()
    from datetime import datetime, timezone
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = sb.table("grading_results").update(data).eq("id", result_id).execute()
    return res.data[0] if res.data else {}


async def get_grading_results_by_teacher(teacher_id: str, status: str | None = None) -> list[dict]:
    sb = get_supabase()
    query = sb.table("grading_results").select("*, students(name, grade, school)").eq("teacher_id", teacher_id)
    if status:
        query = query.eq("status", status)
    res = query.order("created_at", desc=True).execute()
    return res.data or []


async def get_grading_results_by_student(student_id: int) -> list[dict]:
    sb = get_supabase()
    res = sb.table("grading_results").select("*, answer_keys(title, subject)").eq("student_id", student_id).eq("status", "confirmed").order("created_at", desc=True).execute()
    return res.data or []


# ── grading_items ──

async def create_grading_items(items: list[dict]) -> list[dict]:
    sb = get_supabase()
    res = sb.table("grading_items").insert(items).execute()
    return res.data or []


async def get_grading_items(result_id: int) -> list[dict]:
    sb = get_supabase()
    res = sb.table("grading_items").select("*").eq("result_id", result_id).order("question_number").execute()
    return res.data or []


async def update_grading_item(item_id: int, data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("grading_items").update(data).eq("id", item_id).execute()
    return res.data[0] if res.data else {}


# ── homework_submissions ──

async def get_pending_submissions() -> list[dict]:
    """채점 대기 중인 숙제 목록 조회"""
    sb = get_supabase()
    res = sb.table("homework_submissions").select(
        "*, students(name, grade, school, teacher_id, owner_user_id)"
    ).eq("grading_status", "pending").order("created_at", desc=False).execute()
    return res.data or []


async def update_submission_grading_status(submission_id: int, status: str):
    sb = get_supabase()
    sb.table("homework_submissions").update({"grading_status": status}).eq("id", submission_id).execute()


# ── students ──

async def get_student(student_id: int) -> dict | None:
    try:
        sb = get_supabase()
        res = sb.table("students").select("*").eq("id", student_id).limit(1).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception as e:
        logger.error(f"student 조회 실패 (id={student_id}): {e}")
        return None


async def get_students_by_teacher(teacher_id: str) -> list[dict]:
    sb = get_supabase()
    res = sb.table("students").select("*").eq("teacher_id", teacher_id).execute()
    return res.data or []


# ── teachers ──

async def get_teacher(teacher_id: str) -> dict | None:
    try:
        sb = get_supabase()
        res = sb.table("teachers").select("*").eq("owner_user_id", teacher_id).limit(1).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception as e:
        logger.error(f"teacher 조회 실패 (owner_user_id={teacher_id}): {e}")
        return None


async def get_teacher_by_id(teacher_table_id: int) -> dict | None:
    try:
        sb = get_supabase()
        res = sb.table("teachers").select("*").eq("id", teacher_table_id).limit(1).execute()
        return res.data[0] if res.data and len(res.data) > 0 else None
    except Exception as e:
        logger.error(f"teacher 조회 실패 (id={teacher_table_id}): {e}")
        return None


# ── grading_stats ──

async def upsert_grading_stats(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("grading_stats").upsert(data, on_conflict="teacher_id,answer_key_id,month").execute()
    return res.data[0] if res.data else {}


# ── evaluations (종합평가) ──

async def upsert_evaluation(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("evaluations").upsert(data).execute()
    return res.data[0] if res.data else {}
