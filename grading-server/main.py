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
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from fastapi.responses import JSONResponse

from config import PORT, CORS_ORIGINS, RATE_LIMIT_PER_MINUTE, SUPABASE_JWT_SECRET
from auth import get_current_user
from scheduler.monthly_eval import run_monthly_evaluation

from routers import answer_keys, assignments, student_books, results, stats, grading, misc

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
