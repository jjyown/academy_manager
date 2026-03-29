"""채점 관리 브라우저용 단기 JWT (숙제 조회 등). Supabase 세션과 별개."""
from __future__ import annotations

import logging
import time
from typing import Any

import jwt

from config import GRADING_SESSION_SECRET, GRADING_SESSION_TTL_HOURS

logger = logging.getLogger(__name__)

ISSUER = "grading-server"
AUDIENCE = "grading-homework"


def grading_session_enabled() -> bool:
    return bool(GRADING_SESSION_SECRET and len(GRADING_SESSION_SECRET.strip()) >= 16)


def create_grading_session_token(owner_user_id: str, teacher_table_id: str) -> str:
    if not grading_session_enabled():
        raise ValueError("GRADING_SESSION_SECRET이 설정되지 않았거나 너무 짧습니다(16자 이상 권장).")
    now = int(time.time())
    exp = now + int(GRADING_SESSION_TTL_HOURS) * 3600
    payload: dict[str, Any] = {
        "sub": str(owner_user_id).strip(),
        "tid": str(teacher_table_id).strip(),
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": exp,
        "scope": "homework_read",
    }
    return jwt.encode(payload, GRADING_SESSION_SECRET, algorithm="HS256")


def decode_grading_session_token(token: str) -> dict[str, Any]:
    if not grading_session_enabled():
        raise ValueError("GRADING_SESSION_SECRET 미설정")
    return jwt.decode(
        token,
        GRADING_SESSION_SECRET,
        algorithms=["HS256"],
        audience=AUDIENCE,
        issuer=ISSUER,
    )


def owner_from_authorization_header(auth_header: str | None) -> str | None:
    """Authorization: Bearer <grading_jwt> 에서 owner UUID(sub) 추출. 실패 시 None."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    raw = auth_header[7:].strip()
    if not raw:
        return None
    try:
        payload = decode_grading_session_token(raw)
        sub = str(payload.get("sub") or "").strip()
        return sub or None
    except jwt.ExpiredSignatureError:
        return None
    except Exception as e:
        logger.debug("grading session decode 실패: %s", e)
        return None
