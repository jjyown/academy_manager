"""Supabase JWT 인증 미들웨어

프론트엔드에서 보내는 Authorization: Bearer <jwt> 헤더를 검증합니다.
Supabase anon key로 발급된 JWT의 서명을 JWT secret으로 검증하고,
만료 여부를 확인합니다.
"""
import logging
from typing import Optional

import jwt
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import SUPABASE_JWT_SECRET

logger = logging.getLogger(__name__)
_bearer_scheme = HTTPBearer(auto_error=False)

# /health와 같이 인증이 불필요한 경로
# /api/mathpix-status: Mathpix 충전량/소진 상태 운영 모니터링용(브라우저 직접 접근). reset도 백오프 해제일 뿐 destructive 영향 없음.
PUBLIC_PATHS = {"/health", "/health/runtime", "/docs", "/openapi.json", "/redoc", "/api/mathpix-status"}

# Supabase 사용자 JWT 대신 별도 인증(채점 세션 JWT·쿼리 폴백)을 쓰는 API — 미들웨어에서 Bearer 요구 제외
SKIP_SUPABASE_JWT_PATH_PREFIXES = (
    "/api/grading-auth",
    "/api/homework-submissions",
    "/api/public-portal-grading",
)


def path_skips_supabase_jwt(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in SKIP_SUPABASE_JWT_PATH_PREFIXES)


def decode_supabase_jwt(token: str) -> dict:
    """Supabase JWT를 검증하고 payload를 반환합니다."""
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="토큰이 만료되었습니다")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"유효하지 않은 토큰: {e}")


async def get_current_user(request: Request) -> Optional[dict]:
    """Request에서 JWT를 추출하고 검증합니다.
    
    공개 경로이거나 JWT_SECRET이 미설정이면 None을 반환합니다.
    인증 실패 시 HTTPException(401)을 발생시킵니다.
    """
    if request.url.path in PUBLIC_PATHS:
        return None

    if path_skips_supabase_jwt(request.url.path):
        return None

    if not SUPABASE_JWT_SECRET:
        return None

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증 헤더가 없습니다")

    token = auth_header[7:]
    return decode_supabase_jwt(token)
