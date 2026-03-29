"""서버에서 Supabase Edge verify-teacher-pin 호출 (PIN 검증)."""
from __future__ import annotations

import logging

import httpx

from config import SUPABASE_ANON_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)


async def verify_teacher_pin_via_edge(
    teacher_id: str,
    pin: str,
    owner_user_id: str | None = None,
) -> tuple[bool, str | None]:
    """
    Edge Function과 동일 본문으로 PIN 검증.
    Returns: (ok, error_code_or_none)
    """
    tid = str(teacher_id or "").strip()
    pw = str(pin or "").strip()
    if not tid or not pw:
        return False, "missing_fields"

    base = (SUPABASE_URL or "").rstrip("/")
    key = (SUPABASE_ANON_KEY or "").strip()
    if not base or not key:
        logger.error("[verify-pin-edge] SUPABASE_URL 또는 SUPABASE_ANON_KEY 미설정")
        return False, "server_config"

    url = f"{base}/functions/v1/verify-teacher-pin"
    body: dict = {"teacherId": tid, "pin": pw}
    if owner_user_id and str(owner_user_id).strip():
        body["ownerUserId"] = str(owner_user_id).strip()

    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(url, json=body, headers=headers)
        try:
            data = res.json() if res.content else {}
        except Exception:
            data = {}
        if res.status_code >= 400:
            logger.warning("[verify-pin-edge] HTTP %s: %s", res.status_code, data)
            return False, "edge_http_error"
        ok = bool(data.get("ok"))
        err = data.get("error")
        return ok, (str(err) if err else None)
    except httpx.TimeoutException:
        logger.warning("[verify-pin-edge] timeout")
        return False, "timeout"
    except Exception as e:
        logger.exception("[verify-pin-edge] 실패: %s", e)
        return False, "edge_request_failed"
