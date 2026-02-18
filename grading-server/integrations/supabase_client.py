import logging
import threading
from datetime import date
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


async def upsert_answer_key(data: dict) -> dict:
    sb = get_supabase()
    if data.get("id"):
        res = sb.table("answer_keys").upsert(data).execute()
    else:
        teacher_id = data.get("teacher_id")
        title = data.get("title")
        if teacher_id and title:
            existing = sb.table("answer_keys").select("id").eq(
                "teacher_id", teacher_id
            ).eq("title", title).limit(1).execute()
            if existing.data:
                data["id"] = existing.data[0]["id"]
                res = sb.table("answer_keys").update(data).eq("id", data["id"]).execute()
            else:
                res = sb.table("answer_keys").insert(data).execute()
        else:
            res = sb.table("answer_keys").insert(data).execute()
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


async def update_assignment(assignment_id: int, data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("grading_assignments").update(data).eq("id", assignment_id).execute()
    return res.data[0] if res.data else {}


async def delete_assignment(assignment_id: int) -> bool:
    sb = get_supabase()
    res = sb.table("grading_assignments").delete().eq("id", assignment_id).execute()
    return bool(res.data)


async def get_student_assigned_key(student_id: int) -> dict | None:
    """학생에게 배정된 교재(answer_key) 조회 - due_date 기준
    1) 오늘/미래 과제 중 due_date가 가장 가까운 것
    2) 없으면 과거 과제 중 가장 최근 것"""
    try:
        sb = get_supabase()
        today = date.today().isoformat()

        res = sb.table("grading_assignments").select(
            "answer_key_id, due_date, answer_keys(*)"
        ).contains(
            "assigned_students", [student_id]
        ).gte("due_date", today).order("due_date", desc=False).limit(1).execute()

        if res.data and res.data[0].get("answer_keys"):
            return res.data[0]["answer_keys"]

        res = sb.table("grading_assignments").select(
            "answer_key_id, due_date, answer_keys(*)"
        ).contains(
            "assigned_students", [student_id]
        ).order("due_date", desc=True).limit(1).execute()

        if res.data and res.data[0].get("answer_keys"):
            return res.data[0]["answer_keys"]
    except Exception as e:
        logger.error(f"학생 배정 교재 조회 실패 (student_id={student_id}): {e}")
    return None


async def get_best_book_by_assignment(book_key_ids: list[int]) -> dict | None:
    """학생의 교재 목록 중 현재 과제와 매칭되는 교재 찾기 (due_date 기준)"""
    if not book_key_ids:
        return None
    try:
        sb = get_supabase()
        today = date.today().isoformat()

        res = sb.table("grading_assignments").select(
            "answer_key_id, due_date, answer_keys(*)"
        ).in_("answer_key_id", book_key_ids).gte(
            "due_date", today
        ).order("due_date", desc=False).limit(1).execute()

        if res.data and res.data[0].get("answer_keys"):
            return res.data[0]["answer_keys"]

        res = sb.table("grading_assignments").select(
            "answer_key_id, due_date, answer_keys(*)"
        ).in_("answer_key_id", book_key_ids).order(
            "due_date", desc=True
        ).limit(1).execute()

        if res.data and res.data[0].get("answer_keys"):
            return res.data[0]["answer_keys"]
    except Exception as e:
        logger.error(f"교재-과제 매칭 조회 실패: {e}")
    return None


# ── student_books (학생-교재 연결) ──

async def get_student_books(student_id: int) -> list[dict]:
    sb = get_supabase()
    res = sb.table("student_books").select(
        "*, answer_keys(id, title, subject, parsed)"
    ).eq("student_id", student_id).order("created_at", desc=True).execute()
    return res.data or []


async def get_student_books_by_teacher(teacher_id: str) -> list[dict]:
    sb = get_supabase()
    res = sb.table("student_books").select(
        "*, answer_keys(id, title, subject)"
    ).eq("teacher_id", teacher_id).order("student_id").execute()
    return res.data or []


async def add_student_book(student_id: int, answer_key_id: int, teacher_id: str) -> dict:
    sb = get_supabase()
    res = sb.table("student_books").upsert(
        {"student_id": student_id, "answer_key_id": answer_key_id, "teacher_id": teacher_id},
        on_conflict="student_id,answer_key_id",
    ).execute()
    return res.data[0] if res.data else {}


async def remove_student_book(student_book_id: int) -> bool:
    sb = get_supabase()
    res = sb.table("student_books").delete().eq("id", student_book_id).execute()
    return bool(res.data)


async def get_student_book_keys(student_id: int) -> list[dict]:
    """채점 시 학생이 풀고 있는 교재 answer_key 목록 반환"""
    sb = get_supabase()
    res = sb.table("student_books").select(
        "answer_key_id, answer_keys(*)"
    ).eq("student_id", student_id).execute()
    return [r["answer_keys"] for r in (res.data or []) if r.get("answer_keys")]


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


# ── notifications (알림) ──

async def create_notification(data: dict) -> dict:
    """알림 생성"""
    try:
        sb = get_supabase()
        res = sb.table("notifications").insert(data).execute()
        return res.data[0] if res.data else {}
    except Exception as e:
        logger.warning(f"알림 생성 실패 (무시): {e}")
        return {}


async def get_notifications(teacher_id: str, unread_only: bool = False, limit: int = 50) -> list[dict]:
    """알림 목록 조회"""
    sb = get_supabase()
    query = sb.table("notifications").select("*").eq("teacher_id", teacher_id)
    if unread_only:
        query = query.eq("read", False)
    res = query.order("created_at", desc=True).limit(limit).execute()
    return res.data or []


async def mark_notifications_read(teacher_id: str, notification_ids: list[int] | None = None):
    """알림 읽음 처리"""
    sb = get_supabase()
    query = sb.table("notifications").update({"read": True}).eq("teacher_id", teacher_id)
    if notification_ids:
        query = query.in_("id", notification_ids)
    query.execute()


# ── evaluations (종합평가) ──

async def upsert_evaluation(data: dict) -> dict:
    sb = get_supabase()
    res = sb.table("evaluations").upsert(data).execute()
    return res.data[0] if res.data else {}
