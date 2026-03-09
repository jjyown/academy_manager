from __future__ import annotations

from datetime import date
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DOCS = [
    ROOT / "docs" / "plan.md",
    ROOT / "docs" / "context.md",
    ROOT / "docs" / "checklist.md",
]
PATTERN = re.compile(r"^(- 문서 기준일:\s*)(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)


def sync_doc_date(target_date: str) -> int:
    changed = 0
    for path in DOCS:
        text = path.read_text(encoding="utf-8")
        updated, count = PATTERN.subn(rf"\g<1>{target_date}", text, count=1)
        if count == 0:
            raise RuntimeError(f"`문서 기준일` 라인을 찾지 못했습니다: {path}")
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed += 1
        print(f"[sync-doc-dates] {path.name}: {target_date}")
    return changed


def main() -> int:
    today = date.today().isoformat()
    changed = sync_doc_date(today)
    print(f"[sync-doc-dates] 완료 (today={today}, changed_files={changed})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[sync-doc-dates] 실패: {exc}", file=sys.stderr)
        raise SystemExit(1)
