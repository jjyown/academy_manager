"""채점 관리 브라우저 세션 발급 (PIN → 단기 JWT)"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import GRADING_SESSION_TTL_HOURS, GRADING_CANONICAL_OWNER_USER_ID
from grading_session import create_grading_session_token, grading_session_enabled
from integrations.edge_verify_pin import verify_teacher_pin_via_edge
from integrations.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/grading-auth", tags=["grading-auth"])


class GradingSessionRequest(BaseModel):
    teacher_id: str = Field(..., description="teachers.id")
    pin: str = Field(..., min_length=1)
    owner_user_id: str | None = Field(None, description="원장 UUID (검증 강화용)")


@router.post("/session")
async def create_session(body: GradingSessionRequest):
    """
    선생님 PIN을 Edge verify-teacher-pin으로 재검증한 뒤,
    숙제 조회 등에 쓰는 단기 JWT(access_token)를 발급합니다.
    운영에서는 GRADING_SESSION_SECRET·SUPABASE_ANON_KEY 필수.
    """
    if not grading_session_enabled():
        raise HTTPException(
            status_code=503,
            detail="채점 세션이 비활성화되어 있습니다. 서버에 GRADING_SESSION_SECRET(16자 이상)을 설정하세요.",
        )

    ok, err = await verify_teacher_pin_via_edge(
        body.teacher_id,
        body.pin,
        body.owner_user_id,
    )
    if not ok:
        msg = {
            "invalid_pin": "비밀번호가 일치하지 않습니다.",
            "teacher_not_found": "선생님 정보를 찾을 수 없습니다.",
            "ownership_mismatch": "이 학원에 등록된 선생님이 아닙니다.",
            "missing_fields": "입력 정보가 부족합니다.",
            "server_config": "서버 설정 오류(Supabase URL/Anon 키)입니다.",
            "timeout": "인증 서버 응답 시간이 초과되었습니다.",
            "edge_http_error": "인증 서버 오류입니다. 잠시 후 다시 시도해주세요.",
            "edge_request_failed": "인증 서버에 연결하지 못했습니다.",
        }.get(err or "", "비밀번호 확인에 실패했습니다.")
        raise HTTPException(status_code=401, detail=msg)

    sb = get_supabase()
    res = await run_query(
        sb.table("teachers")
        .select("id, owner_user_id")
        .eq("id", str(body.teacher_id).strip())
        .limit(1)
        .execute
    )
    row = (res.data or [None])[0]
    if not row or not row.get("owner_user_id"):
        raise HTTPException(status_code=404, detail="선생님 정보를 찾을 수 없습니다")

    row_owner = str(row["owner_user_id"]).strip()
    if body.owner_user_id and str(body.owner_user_id).strip() != row_owner:
        raise HTTPException(status_code=403, detail="원장 정보가 일치하지 않습니다")

    owner = row_owner
    if GRADING_CANONICAL_OWNER_USER_ID:
        owner = str(GRADING_CANONICAL_OWNER_USER_ID).strip()

    try:
        token = create_grading_session_token(owner, str(row["id"]))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": int(GRADING_SESSION_TTL_HOURS) * 3600,
        "owner_user_id": owner,
    }
