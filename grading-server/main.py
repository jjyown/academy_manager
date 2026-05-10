"""자동 채점 서버 - FastAPI
전체 흐름:
1. 학생이 숙제 제출 → 중앙 드라이브(jjyown@gmail.com)에 저장
2. Edge Function이 채점 서버에 비동기 트리거
3. 채점 서버가 ZIP 다운로드 → OCR → 배정된 교재로 채점
4. 채점 결과 이미지를 중앙 드라이브에 저장
5. 선생님이 채점 관리 페이지에서 검토/다운로드
"""
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from fastapi.responses import JSONResponse

from config import (
    PORT,
    CORS_ORIGINS,
    RATE_LIMIT_PER_MINUTE,
    SUPABASE_JWT_SECRET,
    AI_API_TIMEOUT,
    USE_GRADING_AGENT,
    GRADING_TIMEOUT_BASE_SECONDS,
    GRADING_TIMEOUT_PER_IMAGE_SECONDS,
    GRADING_TIMEOUT_MAX_SECONDS,
    OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE,
    OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION,
    OCR_TIEBREAK_FALLBACK_ON_REFUSAL,
    AGENT_VERIFY_HARD_TIMEOUT_SECONDS,
    AGENT_VERIFY_MAX_QUESTIONS,
    AGENT_VERIFY_MIN_REMAINING_SECONDS,
    AGENT_VERIFY_TIMEOUT_GUARD_SECONDS,
)
from auth import get_current_user
from scheduler.monthly_eval import run_monthly_evaluation

from routers import (
    answer_keys,
    assignments,
    student_books,
    results,
    stats,
    grading,
    misc,
    homework_submissions,
    grading_auth,
    homework_assignments,
    public_portal_grading,
    mathpix_status,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


# ============================================================
# 운영 환경 인증 점검 (보수적 — 시스템은 GRADING_SESSION_SECRET 기반 gst 인증을
# 주력으로 사용하며, SUPABASE_JWT_SECRET 는 선택임)
# ============================================================
# fail-fast 조건: 운영 환경이면서 두 비밀(GRADING_SESSION_SECRET, SUPABASE_JWT_SECRET)
# 가 모두 비어 있을 때만 — 그 외에는 경고만 남기고 통과.
_PROD_MARKERS = (
    "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_PROJECT_NAME",
    "RAILWAY_SERVICE_NAME",
)
_is_prod_env = any(os.getenv(m) for m in _PROD_MARKERS)
_has_grading_session = bool(os.getenv("GRADING_SESSION_SECRET", "").strip())
if _is_prod_env and not SUPABASE_JWT_SECRET and not _has_grading_session:
    raise RuntimeError(
        "[FATAL] 운영 환경에서 SUPABASE_JWT_SECRET 와 GRADING_SESSION_SECRET 가 모두 비어 있습니다. "
        "최소 한 개의 인증 비밀은 반드시 설정하세요."
    )
if not SUPABASE_JWT_SECRET:
    # 본 시스템은 SUPABASE_JWT_SECRET 가 선택. gst(grading session token) 기반 인증을 사용 중이라면 정상.
    logger.info(
        "[auth] SUPABASE_JWT_SECRET 미설정 — 일반 /api/* 는 GRADING_SESSION_SECRET(gst) 기반 인증으로만 보호됨. "
        "필요 시 Supabase JWT 도 함께 설정 가능."
    )


scheduler = AsyncIOScheduler()


async def _recover_orphaned_grading():
    """서버 시작 시 중단된 채점 작업 복구 — 'grading' 상태로 10분 이상 방치된 레코드 정리"""
    try:
        from integrations.supabase_client import get_supabase, run_query
        sb = get_supabase()

        cutoff = (datetime.utcnow().replace(microsecond=0) - timedelta(minutes=10)).isoformat() + "Z"

        stuck = await run_query(
            sb.table("grading_results")
            .select("id")
            .eq("status", "grading")
            .lt("updated_at", cutoff)
            .execute
        )
        stuck_ids = [r["id"] for r in (stuck.data or [])]

        if stuck_ids:
            await run_query(
                sb.table("grading_results")
                .update({"status": "review_needed", "error_message": "서버 재시작으로 채점이 중단되었습니다. 재채점해주세요."})
                .in_("id", stuck_ids)
                .execute
            )
            logger.warning(f"[Recovery] 고아 채점 {len(stuck_ids)}건 복구: {stuck_ids}")

        # 운영 DB에 updated_at이 없을 수 있음(PostgREST 400) → created_at 기준
        stuck_subs = await run_query(
            sb.table("homework_submissions")
            .select("id")
            .eq("grading_status", "grading")
            .lt("created_at", cutoff)
            .execute
        )
        stuck_sub_ids = [r["id"] for r in (stuck_subs.data or [])]
        if stuck_sub_ids:
            await run_query(
                sb.table("homework_submissions")
                .update({"grading_status": "grading_failed"})
                .in_("id", stuck_sub_ids)
                .execute
            )
            logger.warning(f"[Recovery] 고아 제출 {len(stuck_sub_ids)}건 복구: {stuck_sub_ids}")

        if not stuck_ids and not stuck_sub_ids:
            logger.info("[Recovery] 고아 채점 없음 — 정상")

    except Exception as e:
        logger.error(f"[Recovery] 고아 채점 복구 실패 (무시): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _recover_orphaned_grading()
    scheduler.add_job(run_monthly_evaluation, "cron", day=28, hour=0, minute=0)
    scheduler.start()
    logger.info("스케줄러 시작: 매월 28일 종합평가 자동 생성")
    yield
    scheduler.shutdown()


app = FastAPI(title="자동 채점 서버", version="2.0.0", lifespan=lifespan)


# ============================================================
# CORS
# ============================================================
_LOCAL_ORIGINS = [
    "http://127.0.0.1:5500", "http://localhost:5500",
    "http://127.0.0.1:5501", "http://localhost:5501",
    "http://127.0.0.1:8000", "http://localhost:8000",
]

if CORS_ORIGINS:
    _allowed_origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
    _allow_credentials = True
else:
    logger.warning("CORS_ORIGINS 미설정 - 로컬 개발 모드 (localhost만 허용)")
    _allowed_origins = _LOCAL_ORIGINS
    _allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# JWT 인증 미들웨어
# ============================================================
@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    from auth import PUBLIC_PATHS
    path = request.url.path

    if request.method == "OPTIONS":
        return await call_next(request)
    if path in PUBLIC_PATHS or not path.startswith("/api/"):
        return await call_next(request)
    if not SUPABASE_JWT_SECRET:
        return await call_next(request)

    try:
        user = await get_current_user(request)
        request.state.user = user
    except HTTPException as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    return await call_next(request)


# ============================================================
# Rate Limiting 미들웨어
# ============================================================
_rate_limit_store: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    p = request.url.path
    # 공개 포털(인증코드 무차단 brute-force 방지) 은 더 엄격하게 — IP+student_id 단위로
    # 별도 키를 사용하고, 기본 분당 한도의 1/3 만 허용.
    if p.startswith("/api/public-portal-grading"):
        client_ip = request.client.host if request.client else "unknown"
        sid = request.query_params.get("student_id") or ""
        # result_id 경로(GET /results/{result_id}/items) 의 경우 path 의 마지막 숫자 부분도 함께 사용
        key = f"portal:{client_ip}:{sid or 'anon'}:{p}"
        now = time.time()
        window = 60.0
        portal_limit = max(5, RATE_LIMIT_PER_MINUTE // 3)
        timestamps = _rate_limit_store[key]
        _rate_limit_store[key] = [t for t in timestamps if now - t < window]
        if len(_rate_limit_store[key]) >= portal_limit:
            return JSONResponse(
                status_code=429,
                content={"detail": f"요청이 너무 많습니다. 분당 {portal_limit}회까지 가능합니다."}
            )
        _rate_limit_store[key].append(now)
        return await call_next(request)

    if (
        p.startswith("/api/grade")
        or p.startswith("/api/auto-grade")
        or p.startswith("/api/grading-auth")
        or p.startswith("/api/homework-submissions")
    ):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0
        timestamps = _rate_limit_store[client_ip]
        _rate_limit_store[client_ip] = [t for t in timestamps if now - t < window]
        if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_PER_MINUTE:
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded. Max {RATE_LIMIT_PER_MINUTE} requests per minute."}
            )
        _rate_limit_store[client_ip].append(now)
    return await call_next(request)


# ============================================================
# 헬스체크
# ============================================================
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "time": datetime.now().isoformat(),
        "auth_enabled": bool(SUPABASE_JWT_SECRET),
    }


@app.get("/health/runtime")
async def health_runtime():
    """운영에서 적용 중인 핵심 런타임 설정 확인용."""
    return {
        "status": "ok",
        "time": datetime.now().isoformat(),
        "auth_enabled": bool(SUPABASE_JWT_SECRET),
        "timeouts": {
            "ai_api_timeout_seconds": AI_API_TIMEOUT,
            "grading_timeout_base_seconds": GRADING_TIMEOUT_BASE_SECONDS,
            "grading_timeout_per_image_seconds": GRADING_TIMEOUT_PER_IMAGE_SECONDS,
            "grading_timeout_max_seconds": GRADING_TIMEOUT_MAX_SECONDS,
        },
        "ocr_tiebreak": {
            "max_items_per_image": OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE,
            "max_retries_per_question": OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION,
            "fallback_on_refusal": OCR_TIEBREAK_FALLBACK_ON_REFUSAL,
        },
        "agent_verify": {
            "hard_timeout_seconds": AGENT_VERIFY_HARD_TIMEOUT_SECONDS,
            "max_questions": AGENT_VERIFY_MAX_QUESTIONS,
            "min_remaining_seconds": AGENT_VERIFY_MIN_REMAINING_SECONDS,
            "timeout_guard_seconds": AGENT_VERIFY_TIMEOUT_GUARD_SECONDS,
        },
        "features": {
            "use_grading_agent": USE_GRADING_AGENT,
        },
    }


# ============================================================
# 글로벌 예외 핸들러
# ============================================================
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status_code": exc.status_code},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"처리되지 않은 에러 [{request.method} {request.url.path}]: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "내부 서버 오류가 발생했습니다", "status_code": 500},
    )


# ============================================================
# 라우터 등록
# ============================================================
app.include_router(answer_keys.router)
app.include_router(assignments.router)
app.include_router(student_books.router)
app.include_router(results.router)
app.include_router(stats.router)
app.include_router(grading.router)
app.include_router(misc.router)
app.include_router(homework_submissions.router)
app.include_router(grading_auth.router)
app.include_router(homework_assignments.router)
app.include_router(public_portal_grading.router)
app.include_router(mathpix_status.router)


# ============================================================
# 서버 시작
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
