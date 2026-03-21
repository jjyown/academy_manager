from __future__ import annotations

from datetime import date
from pathlib import Path
import argparse
import sys


ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "enterprise_workflow.md"
LOG_HEADER = "## 9) 자동 업데이트 로그"


def ensure_log_section(text: str) -> str:
    if LOG_HEADER in text:
        return text
    legacy_header = "## 8) 자동 업데이트 로그"
    if legacy_header in text:
        return text.replace(legacy_header, LOG_HEADER, 1)
    if not text.endswith("\n"):
        text += "\n"
    return text + f"\n{LOG_HEADER}\n"


def append_log(text: str, task_id: str, summary: str, gates: str, note: str) -> str:
    today = date.today().isoformat()
    line = f"- {today} | {task_id} | {summary} | gates: {gates}"
    if note:
        line += f" | note: {note}"
    line += "\n"

    marker = f"{LOG_HEADER}\n"
    idx = text.find(marker)
    if idx == -1:
        raise RuntimeError("자동 로그 섹션을 찾지 못했습니다.")
    insert_at = idx + len(marker)
    return text[:insert_at] + line + text[insert_at:]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="docs/enterprise_workflow.md에 작업 로그를 자동 추가합니다."
    )
    parser.add_argument("--task-id", required=True, help="작업 식별자(예: 학생관리 126차)")
    parser.add_argument("--summary", required=True, help="작업 요약")
    parser.add_argument(
        "--gates",
        default="A:PASS,B:PASS,C:PASS,D:PASS,E:PASS",
        help="Gate 결과 요약 문자열",
    )
    parser.add_argument("--note", default="", help="추가 메모(선택)")
    args = parser.parse_args()

    if not DOC_PATH.exists():
        raise FileNotFoundError(f"문서를 찾을 수 없습니다: {DOC_PATH}")

    original = DOC_PATH.read_text(encoding="utf-8")
    with_section = ensure_log_section(original)
    updated = append_log(
        with_section,
        task_id=args.task_id.strip(),
        summary=args.summary.strip(),
        gates=args.gates.strip(),
        note=args.note.strip(),
    )
    DOC_PATH.write_text(updated, encoding="utf-8")
    print(f"[append-enterprise-log] updated: {DOC_PATH.name}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[append-enterprise-log] failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
