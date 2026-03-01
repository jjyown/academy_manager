"""자동 채점 서버 - FastAPI
전체 흐름:
1. 학생이 숙제 제출 → 중앙 드라이브(jjyown@gmail.com)에 저장
2. Edge Function이 채점 서버에 비동기 트리거
3. 채점 서버가 ZIP 다운로드 → OCR → 배정된 교재로 채점
4. 채점 결과 이미지를 중앙 드라이브에 저장
5. 선생님이 채점 관리 페이지에서 검토/다운로드
"""
import logging
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
)
from auth import get_current_user
from scheduler.monthly_eval import run_monthly_evaluation

from routers import answer_keys, assignments, student_books, results, stats, grading, misc

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

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

        stuck_subs = await run_query(
            sb.table("homework_submissions")
            .select("id")
            .eq("grading_status", "grading")
            .lt("updated_at", cutoff)
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
    if request.url.path.startswith("/api/grade") or request.url.path.startswith("/api/auto-grade"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0
        timestamps = _rate_limit_store[client_ip]
        _rate_limit_store[client_ip] = [t for t in timestamps if now - t < window]
        if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_PER_MINUTE:
            from fastapi.responses import JSONResponse
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


# ============================================================
# 서버 시작
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
