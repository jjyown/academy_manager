"""채점 진행률 인메모리 추적"""
import time

_grading_progress: dict[int, dict] = {}


def update_progress(result_id: int, stage: str, current: int = 0, total: int = 0, detail: str = ""):
    _grading_progress[result_id] = {
        "result_id": result_id,
        "stage": stage,
        "current": current,
        "total": total,
        "percent": round(current / total * 100) if total > 0 else 0,
        "detail": detail,
        "updated_at": time.time(),
    }


def clear_old_progress():
    cutoff = time.time() - 300
    stale = [k for k, v in _grading_progress.items() if v.get("updated_at", 0) < cutoff]
    for k in stale:
        del _grading_progress[k]


def get_progress(result_id: int) -> dict | None:
    return _grading_progress.get(result_id)


def get_all_active() -> list[dict]:
    return [v for v in _grading_progress.values() if v.get("stage") != "done"]
