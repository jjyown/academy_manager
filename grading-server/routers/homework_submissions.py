"""숙제 제출 조회 — 채점 관리 UI (Service Role, 학원 소속 검증)"""
import logging
from datetime import date

import jwt
from fastapi import APIRouter, HTTPException, Request

from grading_session import decode_grading_session_token, grading_session_enabled
from integrations.supabase_client import (
    get_supabase,
    get_student,
    get_homework_submissions_by_owner_student_dates,
    run_query,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/homework-submissions", tags=["homework-submissions"])

# teacher_id 쿼리 파라미터는 채점 프론트와 동일하게 owner_user_id(UUID)를 의미함
_MAX_RANGE_DAYS = 400


async def _assert_student_in_academy(student_id: int, owner_user_id: str) -> None:
    """학생이 해당 원장(owner_user_id) 학원 소속인지 확인 (직접 owner 또는 담당 선생님의 owner 일치)."""
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


def _resolve_owner_for_homework(request: Request, teacher_id_query: str) -> str:
    """
    GRADING_SESSION_SECRET 설정 시: Authorization의 채점 세션 JWT에서만 owner(sub) 신뢰.
    미설정 시(로컬 개발): teacher_id 쿼리 = owner_user_id 폴백.
    """
    if grading_session_enabled():
        auth = request.headers.get("authorization") or ""
        if not auth.startswith("Bearer "):
            raise HTTPException(
                status_code=401,
                detail="채점 세션 토큰이 필요합니다. 채점 관리에서 다시 로그인해주세요.",
            )
        token = auth[7:].strip()
        if not token:
            raise HTTPException(status_code=401, detail="채점 세션 토큰이 비어 있습니다.")
        try:
            payload = decode_grading_session_token(token)
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=401,
                detail="채점 세션이 만료되었습니다. 다시 로그인해주세요.",
            ) from None
        except Exception:
            raise HTTPException(status_code=401, detail="유효하지 않은 채점 세션입니다.") from None
        owner = str(payload.get("sub") or "").strip()
        if not owner:
            raise HTTPException(status_code=401, detail="채점 세션에 원장 정보가 없습니다.")
        q = (teacher_id_query or "").strip()
        if q and q != owner:
            raise HTTPException(
                status_code=403,
                detail="요청한 원장 정보(teacher_id)가 세션과 일치하지 않습니다.",
            )
        return owner

    owner = (teacher_id_query or "").strip()
    if not owner:
        raise HTTPException(status_code=400, detail="teacher_id(owner_user_id)가 필요합니다")
    return owner


def _parse_iso_date(label: str, s: str) -> date:
    if not s or len(s) < 10:
        raise HTTPException(status_code=400, detail=f"{label}: YYYY-MM-DD 형식이 필요합니다")
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label}: 날짜가 올바르지 않습니다")


@router.get("")
async def list_homework_submissions(
    request: Request,
    teacher_id: str,
    student_id: int,
    date_from: str,
    date_to: str,
):
    """
    원장 UUID(teacher_id 파라미터) + 학생 + 기간에 해당하는 homework_submissions 목록.
    Supabase anon RLS(학생 코드 등)와 무관하게, 서버가 소속 검증 후 Service Role로 조회한다.
    운영에서 GRADING_SESSION_SECRET이 있으면 owner는 세션 JWT의 sub만 신뢰한다.
    """
    owner = _resolve_owner_for_homework(request, teacher_id)

    d0 = _parse_iso_date("date_from", date_from)
    d1 = _parse_iso_date("date_to", date_to)
    if d0 > d1:
        raise HTTPException(status_code=400, detail="date_from이 date_to보다 늦을 수 없습니다")
    if (d1 - d0).days > _MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"조회 기간은 최대 {_MAX_RANGE_DAYS}일까지입니다",
        )

    await _assert_student_in_academy(student_id, owner)

    df = d0.isoformat()
    dt = d1.isoformat()
    try:
        rows = await get_homework_submissions_by_owner_student_dates(owner, student_id, df, dt)
    except Exception as e:
        logger.error(f"숙제 제출 조회 실패 owner={owner} student={student_id}: {e}")
        raise HTTPException(status_code=500, detail="숙제 제출 조회에 실패했습니다") from e

    return {"data": rows}


@router.delete("/{submission_id}")
async def delete_homework_submission(
    request: Request,
    submission_id: int,
    teacher_id: str,
):
    """
    숙제 제출 삭제 (채점 관리 UI용)

    - teacher_id: owner_user_id (또는 grading_session token이 있으면 세션의 owner를 우선 검증)
    - 삭제 대상:
        1) grading_results.homework_submission_id == submission_id 제거
        2) homework_submissions.id == submission_id 제거
    """
    owner = _resolve_owner_for_homework(request, teacher_id)
    sb = get_supabase()

    try:
        sub_row = await run_query(
            sb.table("homework_submissions")
            .select("id, owner_user_id, student_id")
            .eq("id", submission_id)
            .limit(1)
            .execute
        )
        if not sub_row.data:
            return {"success": False, "message": "삭제할 제출을 찾을 수 없습니다"}

        row = sub_row.data[0]
        if str(row.get("owner_user_id") or "").strip() != str(owner).strip():
            raise HTTPException(status_code=403, detail="이 제출을 삭제할 권한이 없습니다")

        # 소속 검증(안전장치)
        await _assert_student_in_academy(int(row.get("student_id")), owner)

        # 1) 결과 삭제 (grading_items는 grading_results FK ON DELETE CASCADE)
        await run_query(
            sb.table("grading_results")
            .delete()
            .eq("homework_submission_id", submission_id)
            .execute
        )

        # 2) 제출 삭제
        await run_query(
            sb.table("homework_submissions")
            .delete()
            .eq("id", submission_id)
            .execute
        )

        return {"success": True, "message": "제출이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"제출 삭제 실패 submission_id={submission_id} owner={owner}: {e}")
        raise HTTPException(status_code=500, detail="제출 삭제에 실패했습니다") from e
