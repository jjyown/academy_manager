"""Mathpix OCR 클라이언트

인쇄된 수식이 풍부한 PDF/이미지에 대해 우선적으로 사용하고,
충전량이 부족하거나 호출에 실패하면 자동으로 exhausted 상태로 전환되어
상위 호출자가 Gemini Vision 등 대체 OCR로 폴백할 수 있게 한다.

전략 (시험지 해설 제작 프로젝트의 mathpixV3Text.ts / mathpixV3Pdf.ts 포팅):
- /v3/account 로 callsRemaining 사전 조회 (5분 캐시)
- callsRemaining ≤ MATHPIX_LOW_THRESHOLD 이면 즉시 exhausted 마킹
- HTTP 402/403, "out of credit", "quota exceeded" 등 감지 시 exhausted 마킹
- exhausted 마킹 후 MATHPIX_RETRY_AFTER_EXHAUSTION_MIN 분 동안 사용 불가
  (미설정 시 영구 비활성 — 운영자가 /api/mathpix-status?resetExhaustion=1 로 해제)

⚠ academy_manager에서 학생 답안 OCR(손글씨 동그라미·체크)에는 Mathpix를 쓰지 않는다.
    Mathpix는 인쇄 수식·텍스트 OCR에 강점이 있고 손글씨 마킹 인식은 약하기 때문.
    학생 답안 인식은 ocr/engines.py의 Gemini + GPT-4o 파이프라인이 담당한다.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
import sys
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


# ============================================================
# 설정 로드 (config.py에서 주입; 임포트 순환 회피용 lazy import)
# ============================================================

def _load_settings() -> dict:
    from config import (
        MATHPIX_APP_ID,
        MATHPIX_APP_KEY,
        MATHPIX_API_BASE,
        MATHPIX_LOW_THRESHOLD,
        MATHPIX_RETRY_AFTER_EXHAUSTION_MIN,
        MATHPIX_PDF_TIMEOUT_SECONDS,
        MATHPIX_PDF_POLL_INTERVAL_SECONDS,
    )
    return {
        "app_id": (MATHPIX_APP_ID or "").strip(),
        "app_key": (MATHPIX_APP_KEY or "").strip(),
        "api_base": (MATHPIX_API_BASE or "https://api.mathpix.com").rstrip("/"),
        "low_threshold": MATHPIX_LOW_THRESHOLD,
        "retry_after_min": MATHPIX_RETRY_AFTER_EXHAUSTION_MIN,
        "pdf_timeout": MATHPIX_PDF_TIMEOUT_SECONDS,
        "pdf_poll_interval": MATHPIX_PDF_POLL_INTERVAL_SECONDS,
    }


# ============================================================
# 사용량/소진 상태 (모듈 전역 — 프로세스 라이프사이클 동안 유지)
# ============================================================

_USAGE_CACHE_MS = 5 * 60 * 1000
_usage_cache: dict | None = None
_usage_cache_at: float = 0.0  # epoch ms

_exhausted_until_ms: float = 0.0  # epoch ms; 0이면 사용 가능

# 마지막 /v3/account 호출 진단(운영용 — mathpix-status 엔드포인트에 노출)
_last_account_diagnostic: dict | None = None


@dataclass
class MathpixUsage:
    """Mathpix /v3/ocr-usage 응답 요약.

    ⚠ 2025년 이후 Mathpix API에는 '잔여 호출 수(calls_remaining)'를 직접 제공하는
    엔드포인트가 없다. /v3/account는 deprecated(404), 후속인 /v3/ocr-usage는
    누적 사용 기록만 반환한다. 따라서 잔여량은 None이며, 호출 사전 차단(low_threshold)
    로직은 동작하지 않는다 — 호출 후 quota error(402/403, "out of credit")가
    감지되면 그때 exhausted 마킹된다. 정확한 잔여량은 Mathpix Console 확인이 필요.
    """
    calls_this_period: int | None  # 누적 사용량 (ocr_usage[].count 합)
    calls_remaining: int | None    # Mathpix가 더 이상 제공하지 않음 — 항상 None
    billing_period_end: str | None # Mathpix가 더 이상 제공하지 않음 — 항상 None
    raw: dict


def is_configured() -> bool:
    s = _load_settings()
    return bool(s["app_id"] and s["app_key"])


def _now_ms() -> float:
    return time.time() * 1000


def _exhaustion_backoff_ms() -> float:
    s = _load_settings()
    minutes = s["retry_after_min"]
    if minutes is None or minutes <= 0:
        return float(sys.maxsize)
    return minutes * 60 * 1000


def is_exhausted() -> bool:
    if _exhausted_until_ms <= 0:
        return False
    return _now_ms() < _exhausted_until_ms


def mark_exhausted(reason: str = "") -> None:
    """Mathpix를 일시적/영구적으로 사용 불가로 표시한다."""
    global _exhausted_until_ms, _usage_cache, _usage_cache_at
    backoff = _exhaustion_backoff_ms()
    _exhausted_until_ms = _now_ms() + backoff
    _usage_cache = None
    _usage_cache_at = 0
    if backoff >= sys.maxsize:
        logger.warning(f"[Mathpix] EXHAUSTED (영구 비활성, 수동 reset 필요) — {reason}")
    else:
        until_iso = _ms_to_iso(_exhausted_until_ms)
        logger.warning(f"[Mathpix] EXHAUSTED (백오프 {backoff/60000:.0f}분, ~ {until_iso}) — {reason}")


def reset_exhausted() -> None:
    """exhausted 백오프 해제 + 사용량 캐시 무효화 (충전 후 재활성용)."""
    global _exhausted_until_ms, _usage_cache, _usage_cache_at
    _exhausted_until_ms = 0
    _usage_cache = None
    _usage_cache_at = 0
    logger.info("[Mathpix] exhausted 상태 수동 리셋")


def _ms_to_iso(ms: float) -> str | None:
    if ms >= sys.maxsize or ms <= 0:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


# ============================================================
# 사용량 조회 (/v3/account)
# ============================================================

async def get_account_usage(force: bool = False) -> MathpixUsage | None:
    """Mathpix /v3/ocr-usage 호출하여 누적 사용량을 조회 (5분 캐시).

    Mathpix는 더 이상 잔여 호출 수를 API로 제공하지 않는다 (2024-2025 변경).
    이 함수는 사용 기록(ocr_usage[])을 합산해 누적 호출 수만 돌려준다.
    잔여량은 항상 None이며, 호출 사전 차단은 사실상 동작하지 않는다.

    실패 사유는 _last_account_diagnostic에 기록되어 status 엔드포인트에서 조회 가능.
    """
    global _usage_cache, _usage_cache_at, _last_account_diagnostic

    s = _load_settings()
    if not s["app_id"] or not s["app_key"]:
        _last_account_diagnostic = {"stage": "preflight", "reason": "credentials_missing"}
        return None

    now = _now_ms()
    if not force and _usage_cache and (now - _usage_cache_at) < _USAGE_CACHE_MS:
        return MathpixUsage(**_usage_cache)

    url = f"{s['api_base']}/v3/ocr-usage"
    headers = {"app_id": s["app_id"], "app_key": s["app_key"]}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
    except Exception as e:
        msg = f"network exception: {e}"
        logger.warning(f"[Mathpix] /v3/ocr-usage 호출 예외: {e}")
        _last_account_diagnostic = {"stage": "request", "reason": msg}
        return None

    body_preview = (resp.text or "")[:300]
    if resp.status_code in (401, 403):
        logger.warning(f"[Mathpix] /v3/ocr-usage 인증 실패: {resp.status_code} body={body_preview}")
        _last_account_diagnostic = {
            "stage": "auth",
            "status_code": resp.status_code,
            "body_preview": body_preview,
            "hint": "MATHPIX_APP_ID/MATHPIX_APP_KEY 값이 올바른지, 키에 trailing space나 줄바꿈이 들어가지 않았는지 확인",
        }
        return None
    if resp.status_code >= 400:
        logger.warning(f"[Mathpix] /v3/ocr-usage 실패 {resp.status_code}: {body_preview}")
        _last_account_diagnostic = {
            "stage": "http",
            "status_code": resp.status_code,
            "body_preview": body_preview,
        }
        return None

    try:
        data = resp.json() or {}
    except Exception as e:
        _last_account_diagnostic = {
            "stage": "json",
            "reason": str(e),
            "body_preview": body_preview,
        }
        return None

    records = data.get("ocr_usage") if isinstance(data.get("ocr_usage"), list) else []
    total_count = 0
    for rec in records:
        if not isinstance(rec, dict):
            continue
        c = rec.get("count")
        try:
            total_count += int(c)
        except (TypeError, ValueError):
            continue

    _last_account_diagnostic = {
        "stage": "ok",
        "status_code": resp.status_code,
        "records_count": len(records),
        "note": "Mathpix는 잔여 호출 수를 API로 제공하지 않음 — 충전량 확인은 https://console.mathpix.com",
    }

    payload = {
        "calls_this_period": total_count if records else None,
        "calls_remaining": None,        # Mathpix가 더 이상 제공하지 않음
        "billing_period_end": None,     # Mathpix가 더 이상 제공하지 않음
        "raw": data,
    }
    _usage_cache = payload
    _usage_cache_at = now
    return MathpixUsage(**payload)


def get_last_account_diagnostic() -> dict | None:
    """마지막 /v3/ocr-usage 호출 결과(성공/실패 사유). 운영 모니터링용."""
    return _last_account_diagnostic


def _pick_int(obj: dict, keys: list[str]) -> int | None:
    for k in keys:
        if k in obj:
            try:
                return int(obj[k])
            except (TypeError, ValueError):
                continue
    return None


def _pick_str(obj: dict, keys: list[str]) -> str | None:
    for k in keys:
        if k in obj:
            v = obj[k]
            if v:
                return str(v)
    return None


async def is_usable_for_ocr() -> bool:
    """OCR 호출 직전 사전 체크.

    Mathpix가 잔여량을 더 이상 API로 제공하지 않으므로(2025+), 사전 차단은
    실질적으로 작동하지 않는다. configured && !exhausted 만 검사하고,
    실제 호출에서 quota error(402/403, "out of credit") 받으면 그때 mark_exhausted된다.

    MATHPIX_LOW_THRESHOLD 는 향후 Mathpix가 잔여량 API를 다시 제공할 경우를
    대비해 남겨둔다 — usage.calls_remaining 이 None이면 무시된다.
    """
    if not is_configured():
        return False
    if is_exhausted():
        return False

    s = _load_settings()
    usage = await get_account_usage()
    if usage and usage.calls_remaining is not None:
        if usage.calls_remaining <= s["low_threshold"]:
            mark_exhausted(
                reason=f"calls_remaining={usage.calls_remaining} ≤ low_threshold={s['low_threshold']}"
            )
            return False
    return True


# ============================================================
# Quota error 판별
# ============================================================

_QUOTA_PATTERNS = re.compile(
    r"out\s*of\s*credit|credits?\s*exhausted|quota\s*exceeded|"
    r"limit\s*reached|insufficient\s*funds|payment\s*required",
    re.IGNORECASE,
)


def is_quota_error(status_code: int | None, message: str | None) -> bool:
    if status_code in (402, 403, 429):
        return True
    if message and _QUOTA_PATTERNS.search(message):
        return True
    return False


# ============================================================
# /v3/text — 이미지 OCR (단일)
# ============================================================

async def ocr_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    options: dict | None = None,
) -> dict:
    """이미지 한 장을 Mathpix /v3/text 로 OCR.

    Returns:
        {"ok": True, "text": str, "latex": str, "confidence": float, "raw": dict}
        실패 시: {"ok": False, "error": str, "quota_exceeded": bool}

    quota_exceeded=True 이면 호출자가 별도로 mark_exhausted 호출할 필요 없음
    (이 함수가 이미 마킹함). Gemini 등 대체 OCR로 분기하면 된다.
    """
    s = _load_settings()
    if not s["app_id"] or not s["app_key"]:
        return {"ok": False, "error": "Mathpix not configured", "quota_exceeded": False}
    if is_exhausted():
        return {"ok": False, "error": "Mathpix exhausted", "quota_exceeded": True}

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    src = f"data:{mime_type};base64,{b64}"
    body = {
        "src": src,
        "formats": ["text", "latex_styled"],
        "math_inline_delimiters": ["$", "$"],
        "math_display_delimiters": ["$$", "$$"],
        "rm_spaces": True,
    }
    if options:
        body.update(options)

    url = f"{s['api_base']}/v3/text"
    headers = {
        "app_id": s["app_id"],
        "app_key": s["app_key"],
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
    except Exception as e:
        return {"ok": False, "error": f"network: {e}", "quota_exceeded": False}

    text_body = resp.text or ""
    if is_quota_error(resp.status_code, text_body):
        mark_exhausted(reason=f"/v3/text {resp.status_code}: {text_body[:120]}")
        return {"ok": False, "error": f"quota: {resp.status_code}", "quota_exceeded": True}
    if resp.status_code >= 400:
        return {"ok": False, "error": f"http {resp.status_code}: {text_body[:200]}", "quota_exceeded": False}

    try:
        data = resp.json()
    except Exception as e:
        return {"ok": False, "error": f"json parse: {e}", "quota_exceeded": False}

    err = data.get("error")
    if err and is_quota_error(None, str(err)):
        mark_exhausted(reason=f"/v3/text body error: {err}")
        return {"ok": False, "error": str(err), "quota_exceeded": True}
    if err:
        return {"ok": False, "error": str(err), "quota_exceeded": False}

    return {
        "ok": True,
        "text": data.get("text", "") or "",
        "latex": data.get("latex_styled", "") or "",
        "confidence": data.get("confidence", 0),
        "raw": data,
    }


# ============================================================
# /v3/pdf — PDF OCR (비동기 폴링)
# ============================================================

async def ocr_pdf(
    pdf_bytes: bytes,
    output_format: str = "mmd",
    options: dict | None = None,
) -> dict:
    """PDF 전체를 Mathpix /v3/pdf 로 OCR하여 마크다운(mmd) 또는 md 텍스트 반환.

    output_format: "mmd" (math markdown, 기본) 또는 "md"

    Returns:
        {"ok": True, "text": str, "pdf_id": str}
        실패 시: {"ok": False, "error": str, "quota_exceeded": bool}
    """
    s = _load_settings()
    if not s["app_id"] or not s["app_key"]:
        return {"ok": False, "error": "Mathpix not configured", "quota_exceeded": False}
    if is_exhausted():
        return {"ok": False, "error": "Mathpix exhausted", "quota_exceeded": True}

    submit = await _submit_pdf(pdf_bytes, options=options)
    if not submit["ok"]:
        return submit

    pdf_id = submit["pdf_id"]
    logger.info(f"[Mathpix] PDF 제출 OK → pdf_id={pdf_id}")

    poll = await _poll_pdf(pdf_id)
    if not poll["ok"]:
        return poll

    fetched = await _fetch_pdf_result(pdf_id, output_format)
    if not fetched["ok"]:
        return fetched

    return {"ok": True, "text": fetched["text"], "pdf_id": pdf_id}


async def _submit_pdf(pdf_bytes: bytes, options: dict | None = None) -> dict:
    s = _load_settings()
    url = f"{s['api_base']}/v3/pdf"
    headers = {"app_id": s["app_id"], "app_key": s["app_key"]}

    opts = {
        "math_inline_delimiters": ["$", "$"],
        "math_display_delimiters": ["$$", "$$"],
        "rm_spaces": True,
        "conversion_formats": {"mmd": True},
    }
    if options:
        opts.update(options)

    import json as _json
    files = {
        "file": ("input.pdf", pdf_bytes, "application/pdf"),
        "options_json": (None, _json.dumps(opts), "application/json"),
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, files=files)
    except Exception as e:
        return {"ok": False, "error": f"network: {e}", "quota_exceeded": False}

    text_body = resp.text or ""
    if is_quota_error(resp.status_code, text_body):
        mark_exhausted(reason=f"/v3/pdf submit {resp.status_code}: {text_body[:120]}")
        return {"ok": False, "error": f"quota: {resp.status_code}", "quota_exceeded": True}
    if resp.status_code >= 400:
        return {"ok": False, "error": f"submit http {resp.status_code}: {text_body[:200]}", "quota_exceeded": False}

    try:
        data = resp.json()
    except Exception as e:
        return {"ok": False, "error": f"submit json: {e}", "quota_exceeded": False}

    err = data.get("error")
    if err and is_quota_error(None, str(err)):
        mark_exhausted(reason=f"/v3/pdf submit body: {err}")
        return {"ok": False, "error": str(err), "quota_exceeded": True}
    if err:
        return {"ok": False, "error": str(err), "quota_exceeded": False}

    pdf_id = data.get("pdf_id")
    if not pdf_id:
        return {"ok": False, "error": "submit: pdf_id missing", "quota_exceeded": False}
    return {"ok": True, "pdf_id": pdf_id}


async def _poll_pdf(pdf_id: str) -> dict:
    s = _load_settings()
    url = f"{s['api_base']}/v3/pdf/{pdf_id}"
    headers = {"app_id": s["app_id"], "app_key": s["app_key"]}

    deadline = time.time() + s["pdf_timeout"]
    interval = max(1.0, float(s["pdf_poll_interval"]))
    await asyncio.sleep(2.0)  # 초기 대기

    last_status = None
    while time.time() < deadline:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, headers=headers)
        except Exception as e:
            logger.warning(f"[Mathpix] poll 예외: {e} (재시도)")
            await asyncio.sleep(interval)
            continue

        text_body = resp.text or ""
        if is_quota_error(resp.status_code, text_body):
            mark_exhausted(reason=f"/v3/pdf poll {resp.status_code}")
            return {"ok": False, "error": f"quota: {resp.status_code}", "quota_exceeded": True}

        if resp.status_code >= 500:
            await asyncio.sleep(interval)
            continue
        if resp.status_code >= 400:
            return {"ok": False, "error": f"poll http {resp.status_code}: {text_body[:200]}", "quota_exceeded": False}

        try:
            data = resp.json()
        except Exception:
            await asyncio.sleep(interval)
            continue

        status = (data.get("status") or "").lower()
        if status != last_status:
            logger.info(f"[Mathpix] PDF status: {status}")
            last_status = status

        if status == "completed":
            return {"ok": True, "status": status}
        if status in ("error", "failed"):
            err = data.get("error") or status
            if is_quota_error(None, str(err)):
                mark_exhausted(reason=f"/v3/pdf poll status error: {err}")
                return {"ok": False, "error": str(err), "quota_exceeded": True}
            return {"ok": False, "error": str(err), "quota_exceeded": False}

        await asyncio.sleep(interval)

    return {"ok": False, "error": f"poll timeout after {s['pdf_timeout']}s", "quota_exceeded": False}


async def _fetch_pdf_result(pdf_id: str, output_format: str) -> dict:
    s = _load_settings()
    fmt = output_format if output_format in ("mmd", "md") else "mmd"
    url = f"{s['api_base']}/v3/pdf/{pdf_id}.{fmt}"
    headers = {"app_id": s["app_id"], "app_key": s["app_key"]}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url, headers=headers)
    except Exception as e:
        return {"ok": False, "error": f"fetch network: {e}", "quota_exceeded": False}

    text_body = resp.text or ""
    if is_quota_error(resp.status_code, text_body):
        mark_exhausted(reason=f"/v3/pdf fetch {resp.status_code}")
        return {"ok": False, "error": f"quota: {resp.status_code}", "quota_exceeded": True}
    if resp.status_code >= 400:
        return {"ok": False, "error": f"fetch http {resp.status_code}: {text_body[:200]}", "quota_exceeded": False}

    return {"ok": True, "text": text_body}
