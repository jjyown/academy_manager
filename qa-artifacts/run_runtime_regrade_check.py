"""
운영 런타임/재채점 상태 점검 스크립트.

기능:
1) /health, /health/runtime 응답 상태 확인
2) /api/results, /api/grading-progress, /api/results/{id}/items 응답성 확인
3) (옵션) 특정 result_id에 대해 /api/results/{id}/regrade 실행
4) 결과를 JSON 리포트로 저장

예시:
    python qa-artifacts/run_runtime_regrade_check.py \
      --base-url https://academymanager-production.up.railway.app \
      --teacher-id 508b3497-2923-4c16-b220-5099092dab76 \
      --result-id 34 \
      --trigger-regrade
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


def _call_get(url: str, params: dict[str, Any] | None, timeout: float) -> dict[str, Any]:
    started = time.time()
    try:
        res = requests.get(url, params=params, timeout=timeout)
        elapsed = round(time.time() - started, 3)
        payload: dict[str, Any] = {
            "ok": True,
            "status_code": res.status_code,
            "elapsed_sec": elapsed,
        }
        try:
            payload["json"] = res.json()
        except Exception:
            payload["text"] = res.text[:1000]
        return payload
    except Exception as e:
        elapsed = round(time.time() - started, 3)
        return {
            "ok": False,
            "error_type": type(e).__name__,
            "error": str(e),
            "elapsed_sec": elapsed,
        }


def _call_post(url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    started = time.time()
    try:
        res = requests.post(url, json=body, timeout=timeout)
        elapsed = round(time.time() - started, 3)
        payload: dict[str, Any] = {
            "ok": True,
            "status_code": res.status_code,
            "elapsed_sec": elapsed,
        }
        try:
            payload["json"] = res.json()
        except Exception:
            payload["text"] = res.text[:1000]
        return payload
    except Exception as e:
        elapsed = round(time.time() - started, 3)
        return {
            "ok": False,
            "error_type": type(e).__name__,
            "error": str(e),
            "elapsed_sec": elapsed,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Runtime/regrade verification helper")
    parser.add_argument("--base-url", required=True, help="API base URL, e.g. https://...railway.app")
    parser.add_argument("--teacher-id", required=True, help="Teacher owner_user_id for /api/results")
    parser.add_argument("--result-id", type=int, default=34, help="Target result_id for checks")
    parser.add_argument("--trigger-regrade", action="store_true", help="Call regrade endpoint before polls")
    parser.add_argument("--timeout", type=float, default=10.0, help="Per-request timeout seconds")
    parser.add_argument("--poll-count", type=int, default=3, help="Status poll count")
    parser.add_argument("--poll-interval", type=float, default=3.0, help="Seconds between polls")
    parser.add_argument(
        "--out-file",
        default="qa-artifacts/runtime-regrade-check-report.json",
        help="Output JSON report path",
    )
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    report: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(),
        "base_url": base_url,
        "teacher_id": args.teacher_id,
        "result_id": args.result_id,
        "checks": {},
    }

    # 1) health checks
    report["checks"]["health"] = _call_get(f"{base_url}/health", None, args.timeout)
    report["checks"]["health_runtime"] = _call_get(f"{base_url}/health/runtime", None, args.timeout)

    # 2) core API responsiveness
    report["checks"]["results"] = _call_get(
        f"{base_url}/api/results",
        {"teacher_id": args.teacher_id},
        args.timeout,
    )
    report["checks"]["progress"] = _call_get(
        f"{base_url}/api/grading-progress",
        {"teacher_id": args.teacher_id},
        args.timeout,
    )
    report["checks"]["items"] = _call_get(
        f"{base_url}/api/results/{args.result_id}/items",
        None,
        args.timeout,
    )

    # 3) optional regrade trigger
    if args.trigger_regrade:
        report["checks"]["regrade_trigger"] = _call_post(
            f"{base_url}/api/results/{args.result_id}/regrade",
            {},
            max(args.timeout, 30.0),
        )

    # 4) poll snapshots
    polls: list[dict[str, Any]] = []
    for i in range(args.poll_count):
        snap: dict[str, Any] = {"index": i}
        snap["results"] = _call_get(
            f"{base_url}/api/results",
            {"teacher_id": args.teacher_id},
            args.timeout,
        )
        snap["progress"] = _call_get(
            f"{base_url}/api/grading-progress",
            {"teacher_id": args.teacher_id},
            args.timeout,
        )
        polls.append(snap)
        if i < args.poll_count - 1:
            time.sleep(args.poll_interval)
    report["polls"] = polls

    out_path = Path(args.out_file)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report written: {out_path.resolve()}")


if __name__ == "__main__":
    main()
