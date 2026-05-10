"""Mathpix 충전량/소진 상태 조회 라우터.

운영자가 Mathpix가 현재 사용 중인지(설정/소진 여부)와 잔여 호출 수를 확인하고,
충전 후 exhausted 백오프를 수동으로 해제하는 용도.

Endpoints:
- GET /api/mathpix-status            : 현재 상태 조회 (5분 캐시)
- GET /api/mathpix-status?force=1    : 캐시 무시하고 최신 사용량 재조회
- GET /api/mathpix-status?resetExhaustion=1 : exhausted 백오프 해제(충전 후)
"""
import logging

from fastapi import APIRouter, Query

from ocr import mathpix
from config import (
    MATHPIX_LOW_THRESHOLD,
    MATHPIX_RETRY_AFTER_EXHAUSTION_MIN,
    PDF_EXTRACTION_PRIMARY,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mathpix"])


@router.get("/mathpix-status")
async def mathpix_status(
    force: int = Query(0, description="1이면 5분 캐시 무시하고 최신 사용량 재조회"),
    resetExhaustion: int = Query(0, description="1이면 exhausted 백오프 해제 후 상태 반환"),
):
    reset_performed = False
    if resetExhaustion:
        mathpix.reset_exhausted()
        reset_performed = True

    configured = mathpix.is_configured()
    exhausted = mathpix.is_exhausted()
    until_ms = mathpix._exhausted_until_ms  # noqa: SLF001 (모듈 내부 상태 의도적 노출)
    until_iso = mathpix._ms_to_iso(until_ms)  # noqa: SLF001

    usage_payload = None
    if configured:
        usage = await mathpix.get_account_usage(force=bool(force))
        if usage:
            usage_payload = {
                "calls_this_period": usage.calls_this_period,
                "calls_remaining": usage.calls_remaining,
                "billing_period_end": usage.billing_period_end,
            }

    primary = (PDF_EXTRACTION_PRIMARY or "").strip().lower() or (
        "mathpix" if configured else "gemini"
    )

    return {
        "ok": True,
        "configured": configured,
        "exhausted": exhausted,
        "exhausted_until_ms": until_ms if exhausted else 0,
        "exhausted_until_iso": until_iso if exhausted else None,
        "exhausted_permanent": exhausted and MATHPIX_RETRY_AFTER_EXHAUSTION_MIN <= 0,
        "reset_performed": reset_performed,
        "usage": usage_payload,
        "low_threshold": MATHPIX_LOW_THRESHOLD,
        "retry_after_minutes": MATHPIX_RETRY_AFTER_EXHAUSTION_MIN or None,
        "primary_pdf_engine": primary,
    }
