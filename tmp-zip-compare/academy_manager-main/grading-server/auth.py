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
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


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

    if not SUPABASE_JWT_SECRET:
        return None

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증 헤더가 없습니다")

    token = auth_header[7:]
    return decode_supabase_jwt(token)
