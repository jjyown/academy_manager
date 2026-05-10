"""highroad-math-solution Supabase 의 검수 완료 해설을 읽기 전용으로 가져온다.

academy_manager(채점) 와 시험지 해설 제작(해설) 은 서로 다른 Supabase 프로젝트.
- 채점쪽: jzcrpdeomjmytfekcgqu.supabase.co
- 해설쪽: gsdhwuoyiboyzvtokrao.supabase.co (예시)

해설쪽 `exam_solutions` 테이블은 RLS enabled · 정책 없음 → service role 키로만 SELECT 가능.
이 모듈은 PostgREST 를 직접 호출하므로 별도 supabase-py 클라이언트를 만들지 않는다 (의존성 단순화).

ENV:
- HIGHROAD_SOLUTION_SUPABASE_URL=https://<ref>.supabase.co
- HIGHROAD_SOLUTION_SERVICE_KEY=<service role key>  (읽기 전용 사용)

이 두 값이 모두 설정되어 있을 때만 활성화. 미설정 시 모든 함수가 빈 결과를 반환.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_HIGHROAD_URL = (os.getenv("HIGHROAD_SOLUTION_SUPABASE_URL", "") or "").rstrip("/")
_HIGHROAD_KEY = os.getenv("HIGHROAD_SOLUTION_SERVICE_KEY", "") or ""
_HTTP_TIMEOUT = float(os.getenv("HIGHROAD_SOLUTION_TIMEOUT_SEC", "8"))

# 짧은 in-process 캐시: 같은 (exam_name, question_no) 조합이 한 채점 결과 안에서 여러 번 조회될 수 있음.
_CACHE_TTL_SEC = 60.0
_cache: dict[str, tuple[float, Any]] = {}


def is_enabled() -> bool:
    return bool(_HIGHROAD_URL and _HIGHROAD_KEY)


def _cache_get(key: str) -> Any:
    hit = _cache.get(key)
    if hit is None:
        return None
    ts, value = hit
    if time.monotonic() - ts > _CACHE_TTL_SEC:
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.monotonic(), value)


def _headers() -> dict[str, str]:
    return {
        "apikey": _HIGHROAD_KEY,
        "Authorization": f"Bearer {_HIGHROAD_KEY}",
        "Accept": "application/json",
    }


async def fetch_exam_solutions(
    exam_name: str,
    question_nos: list[str] | None = None,
    only_verified: bool = True,
) -> dict[str, dict]:
    """`exam_name` 의 검수 완료 해설을 question_no → row dict 로 반환.

    only_verified=True 면 status='verified' 인 행만(공개용·default).
    question_nos 가 주어지면 해당 번호만 in.<list> 로 좁힘.
    """
    if not is_enabled() or not (exam_name or "").strip():
        return {}

    cache_key = f"exam:{exam_name}:{','.join(sorted(question_nos)) if question_nos else '*'}:{only_verified}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params: dict[str, Any] = {
        "exam_name": f"eq.{exam_name}",
        "select": "question_no,body,status,updated_at,source_filename",
    }
    if only_verified:
        params["status"] = "eq.verified"
    if question_nos:
        # PostgREST in.(a,b,c) 인코딩 — 콤마 포함 값은 따옴표 처리 권장
        quoted = ",".join(f'"{q}"' for q in question_nos)
        params["question_no"] = f"in.({quoted})"

    url = f"{_HIGHROAD_URL}/rest/v1/exam_solutions"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            r = await client.get(url, headers=_headers(), params=params)
        if r.status_code != 200:
            logger.warning(
                "[HighroadSolution] exam_solutions GET %s → %s %s",
                exam_name, r.status_code, r.text[:200],
            )
            return {}
        rows = r.json() or []
    except Exception as e:
        logger.warning("[HighroadSolution] fetch_exam_solutions(%s) 실패: %s", exam_name, e)
        return {}

    out = {str(row.get("question_no")): row for row in rows if row.get("question_no") is not None}
    _cache_set(cache_key, out)
    logger.info("[HighroadSolution] '%s' 해설 %d건 (verified=%s)", exam_name, len(out), only_verified)
    return out


async def fetch_pair_solutions(
    pair_series: str,
    problem_nos: list[int] | None = None,
) -> dict[int, dict]:
    """`analysis_records` 의 1:1 매핑 해설(pair_series + problem_no) → problem_no → row.

    교재 단위(예: '쎈 대수') 매핑용. exam_solutions 가 없으면 폴백으로 사용.
    """
    if not is_enabled() or not (pair_series or "").strip():
        return {}

    cache_key = f"pair:{pair_series}:{','.join(map(str, sorted(problem_nos))) if problem_nos else '*'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params: dict[str, Any] = {
        "pair_series": f"eq.{pair_series}",
        "select": "problem_no,content,solution_text,solution_equations,answer,source",
        # solution_text 가 있는 row만 의미가 있음
        "solution_text": "not.is.null",
    }
    if problem_nos:
        params["problem_no"] = f"in.({','.join(str(n) for n in problem_nos)})"

    url = f"{_HIGHROAD_URL}/rest/v1/analysis_records"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            r = await client.get(url, headers=_headers(), params=params)
        if r.status_code != 200:
            logger.warning(
                "[HighroadSolution] analysis_records GET %s → %s %s",
                pair_series, r.status_code, r.text[:200],
            )
            return {}
        rows = r.json() or []
    except Exception as e:
        logger.warning("[HighroadSolution] fetch_pair_solutions(%s) 실패: %s", pair_series, e)
        return {}

    out: dict[int, dict] = {}
    for row in rows:
        pn = row.get("problem_no")
        try:
            pn_i = int(pn)
        except (TypeError, ValueError):
            continue
        out[pn_i] = row
    _cache_set(cache_key, out)
    logger.info("[HighroadSolution] '%s' pair 해설 %d건", pair_series, len(out))
    return out


def attach_solutions_to_items(
    items: list[dict],
    exam_solutions: dict[str, dict] | None = None,
    pair_solutions: dict[int, dict] | None = None,
) -> int:
    """grading_items list 에 solution 필드를 in-place 추가.

    각 item 에 다음 키를 주입(있을 때만):
    - solution_body: 검수 완료 마크다운 (exam_solutions 우선)
    - solution_source_kind: "exam_solutions" | "analysis_records"
    - solution_status: "verified" | "draft" 등
    Returns: 매칭된 item 수.
    """
    matched = 0
    for it in items:
        # question_label 가 우선(예: "1", "2-가"), 없으면 question_number
        q_label = str(it.get("question_label") or it.get("question_number") or "").strip()
        if not q_label:
            continue

        if exam_solutions:
            row = exam_solutions.get(q_label)
            if row and row.get("body"):
                it["solution_body"] = row["body"]
                it["solution_source_kind"] = "exam_solutions"
                it["solution_status"] = row.get("status")
                matched += 1
                continue

        if pair_solutions:
            try:
                q_int = int(q_label)
            except (TypeError, ValueError):
                continue
            row = pair_solutions.get(q_int)
            if row and row.get("solution_text"):
                it["solution_body"] = row["solution_text"]
                it["solution_source_kind"] = "analysis_records"
                it["solution_status"] = "draft"
                matched += 1
    return matched


def parse_solution_source(value: Any) -> dict[str, str]:
    """answer_keys.solution_source(jsonb) 파싱. 잘못된 값은 빈 dict.

    예시:
    - {"system": "highroad", "exam_name": "2026 모의고사 1회"}
    - {"system": "highroad", "pair_series": "쎈 대수"}
    """
    if not isinstance(value, dict):
        return {}
    if value.get("system") and value["system"] != "highroad":
        return {}
    out: dict[str, str] = {}
    for k in ("exam_name", "pair_series"):
        v = value.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()
    return out


async def load_solutions_for_answer_key(
    answer_key: dict | None,
    item_labels: list[str] | None = None,
) -> tuple[dict[str, dict], dict[int, dict]]:
    """answer_keys row 의 solution_source 를 보고 (exam_solutions, pair_solutions) 동시 조회.

    item_labels 가 주어지면 해당 번호로만 좁혀 조회 (서버 왕복 비용↓).
    Returns:
        (exam_solutions_map, pair_solutions_map)
        둘 다 비어 있으면 매핑 없음(없거나 비활성화).
    """
    if not is_enabled() or not isinstance(answer_key, dict):
        return {}, {}
    src = parse_solution_source(answer_key.get("solution_source"))
    if not src:
        return {}, {}

    exam_map: dict[str, dict] = {}
    pair_map: dict[int, dict] = {}

    if src.get("exam_name"):
        exam_map = await fetch_exam_solutions(
            src["exam_name"],
            question_nos=item_labels,
        )
    if src.get("pair_series"):
        pair_problem_nos: list[int] | None = None
        if item_labels:
            pair_problem_nos = []
            for lab in item_labels:
                try:
                    pair_problem_nos.append(int(lab))
                except (TypeError, ValueError):
                    continue
        pair_map = await fetch_pair_solutions(
            src["pair_series"],
            problem_nos=pair_problem_nos,
        )
    return exam_map, pair_map
