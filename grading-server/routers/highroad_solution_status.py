"""highroad-math-solution(시험지 해설 제작) 외부 Supabase 연동 상태 진단.

Railway env vars 가 제대로 들어갔는지 즉시 확인하기 위한 read-only 엔드포인트.
GET /api/highroad-solution-status

응답:
- enabled: HIGHROAD_SOLUTION_SUPABASE_URL + HIGHROAD_SOLUTION_SERVICE_KEY 둘 다 설정됨?
- url_configured / key_configured: 각각 별도 표시 (디버깅용)
- timeout_sec: 호출 timeout (기본 8s)
- ping: 실제 PostgREST 호출 결과 (HEAD on /rest/v1/exam_solutions?limit=0)
    - status_code: 200 = OK, 401 = key 잘못, 404 = 테이블 없음, 5xx = 서버 측 문제
    - ok: status_code == 200
    - reason: 한국어 진단 메시지 (사용자가 바로 보고 조치 가능하도록)

키 자체는 절대 응답에 포함하지 않는다 (보안).
"""
from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter

from integrations import highroad_solution

logger = logging.getLogger(__name__)
router = APIRouter(tags=["highroad-solution-status"])


@router.get("/api/highroad-solution-status")
async def get_status():
    url = (os.getenv("HIGHROAD_SOLUTION_SUPABASE_URL", "") or "").rstrip("/")
    key = os.getenv("HIGHROAD_SOLUTION_SERVICE_KEY", "") or ""
    timeout = float(os.getenv("HIGHROAD_SOLUTION_TIMEOUT_SEC", "8"))

    out = {
        "enabled": highroad_solution.is_enabled(),
        "url_configured": bool(url),
        "key_configured": bool(key),
        "url": url if url else None,
        "key_length": len(key) if key else 0,
        "timeout_sec": timeout,
        "ping": None,
    }

    if not out["enabled"]:
        out["ping"] = {
            "ok": False,
            "reason": "두 환경변수(HIGHROAD_SOLUTION_SUPABASE_URL · HIGHROAD_SOLUTION_SERVICE_KEY) 중 하나 이상 미설정",
        }
        return out

    # 실제 ping — exam_solutions 테이블에 limit=0 으로 안전한 GET (행은 가져오지 않음)
    ping_url = f"{url}/rest/v1/exam_solutions"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        # 행 안 가져옴 — 테이블/키 유효성만 검사
        "Range": "0-0",
        "Prefer": "count=none",
    }
    params = {"select": "question_no", "limit": "1"}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(ping_url, headers=headers, params=params)
        sc = r.status_code
        ok = sc in (200, 206)  # 206 = Partial Content (Range header 사용 시)
        reason = ""
        if ok:
            reason = "OK — exam_solutions 테이블 SELECT 가능. 매핑된 교재 채점 시 해설이 자동 첨부됩니다."
        elif sc == 401:
            reason = "401 Unauthorized — SERVICE_KEY 가 잘못됐거나 만료됨. 해설제작 Supabase Settings → API 의 service_role 키 다시 복사하세요."
        elif sc == 404:
            reason = "404 — exam_solutions 테이블이 없음. 해설제작 프로젝트의 supabase/exam_solutions.sql 을 SQL Editor 에서 실행하세요."
        elif sc == 403:
            reason = "403 Forbidden — RLS 정책으로 거부됨. service_role 키가 맞는지 (anon 키 아닌지) 다시 확인하세요."
        else:
            reason = f"HTTP {sc} — {r.text[:160]}"
        out["ping"] = {
            "ok": ok,
            "status_code": sc,
            "reason": reason,
        }
    except httpx.TimeoutException:
        out["ping"] = {
            "ok": False,
            "reason": f"timeout {timeout}s — URL 이 잘못됐거나 네트워크 차단. URL 형식 확인: https://<ref>.supabase.co",
        }
    except Exception as e:
        out["ping"] = {
            "ok": False,
            "reason": f"호출 예외: {str(e)[:200]}",
        }

    return out
