from __future__ import annotations

from datetime import date
from pathlib import Path
import argparse
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
DOC_PLAN = ROOT / "docs" / "plan.md"
DOC_CONTEXT = ROOT / "docs" / "context.md"
DOC_CHECKLIST = ROOT / "docs" / "checklist.md"
DOC_ENTERPRISE = ROOT / "docs" / "enterprise_workflow.md"
DOCS = [DOC_PLAN, DOC_CONTEXT, DOC_CHECKLIST, DOC_ENTERPRISE]

DATE_PATTERN = re.compile(
    r"^(- 문서 기준일:\s*)(\d{4}-\d{2}-\d{2})\s*$",
    re.MULTILINE,
)
ENTERPRISE_LOG_HEADER = "## 9) 자동 업데이트 로그"


def sanitize_cell(text: str) -> str:
    return " ".join(str(text).replace("|", "/").split()).strip()


def sync_doc_dates(today: str) -> None:
    for path in DOCS:
        content = path.read_text(encoding="utf-8")
        updated, count = DATE_PATTERN.subn(rf"\g<1>{today}", content, count=1)
        if count == 0:
            raise RuntimeError(f"`문서 기준일` 라인을 찾지 못했습니다: {path}")
        path.write_text(updated, encoding="utf-8")


def insert_after_marker(text: str, marker: str, insertion: str) -> str:
    idx = text.find(marker)
    if idx == -1:
        raise RuntimeError(f"마커를 찾지 못했습니다: {marker}")
    pos = idx + len(marker)
    return text[:pos] + insertion + text[pos:]


def update_plan(today: str, task_id: str, summary: str, note: str) -> None:
    content = DOC_PLAN.read_text(encoding="utf-8")
    marker = "## 변경 이력\n"
    line = f"- {today} - {task_id}({summary}): {note}\n"
    DOC_PLAN.write_text(insert_after_marker(content, marker, line), encoding="utf-8")


def update_context(today: str, decision: str, reason: str, impact: str) -> None:
    content = DOC_CONTEXT.read_text(encoding="utf-8")
    marker = "| 날짜 | 결정 | 이유 | 영향 범위 |\n|---|---|---|---|\n"
    row = f"| {today} | {decision} | {reason} | {impact} |\n"
    DOC_CONTEXT.write_text(insert_after_marker(content, marker, row), encoding="utf-8")


def update_checklist(
    today: str,
    task_id: str,
    summary: str,
    verification: str,
    result: str,
    note: str,
) -> None:
    content = DOC_CHECKLIST.read_text(encoding="utf-8")
    marker = "| 날짜 | 작업 | 검증 방법 | 결과 | 비고 |\n|---|---|---|---|---|\n"
    row = (
        f"| {today} | {task_id}({summary}) | {verification} | {result} | {note} |\n"
    )
    DOC_CHECKLIST.write_text(insert_after_marker(content, marker, row), encoding="utf-8")


def ensure_enterprise_log_section(text: str) -> str:
    if ENTERPRISE_LOG_HEADER in text:
        return text
    legacy_header = "## 8) 자동 업데이트 로그"
    if legacy_header in text:
        return text.replace(legacy_header, ENTERPRISE_LOG_HEADER, 1)
    if not text.endswith("\n"):
        text += "\n"
    return text + f"\n{ENTERPRISE_LOG_HEADER}\n"


def update_enterprise(
    today: str, task_id: str, summary: str, gates: str, note: str
) -> None:
    original = DOC_ENTERPRISE.read_text(encoding="utf-8")
    content = ensure_enterprise_log_section(original)
    marker = f"{ENTERPRISE_LOG_HEADER}\n"
    line = f"- {today} | {task_id} | {summary} | gates: {gates} | note: {note}\n"
    DOC_ENTERPRISE.write_text(insert_after_marker(content, marker, line), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="docs 4종(plan/context/checklist/enterprise)의 기록을 동시에 연동 업데이트합니다."
    )
    parser.add_argument("--task-id", help='작업 식별자(예: "학생관리 127차")')
    parser.add_argument("--summary", help="작업 요약")
    parser.add_argument("--decision", help="context 결정 문구")
    parser.add_argument("--reason", help="context 결정 이유")
    parser.add_argument("--impact", help="context 영향 범위")
    parser.add_argument(
        "--auto-from-git",
        action="store_true",
        help="staged 파일 목록을 기반으로 기록을 자동 생성",
    )
    parser.add_argument(
        "--verification",
        default="통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인",
        help="checklist 검증 방법",
    )
    parser.add_argument("--result", default="PASS", help="checklist 결과")
    parser.add_argument(
        "--gates",
        default="A:PASS,B:PASS,C:PASS,D:PASS,E:PASS",
        help="enterprise 게이트 결과",
    )
    parser.add_argument("--note", default="연동 자동 기록", help="공통 비고")
    args = parser.parse_args()

    for path in DOCS:
        if not path.exists():
            raise FileNotFoundError(f"문서를 찾을 수 없습니다: {path}")

    today = date.today().isoformat()
    now_id = date.today().strftime("%Y%m%d")

    staged_files: list[str] = []
    if args.auto_from_git:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise RuntimeError(f"git diff --cached 실패: {result.stderr.strip()}")
        staged_files = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if not staged_files:
            print("[append-linked-docs-log] skipped: no staged files")
            return 0

    task_id_raw = args.task_id
    summary_raw = args.summary
    decision_raw = args.decision
    reason_raw = args.reason
    impact_raw = args.impact

    if args.auto_from_git:
        changed = ", ".join(staged_files[:5])
        if len(staged_files) > 5:
            changed += f" 외 {len(staged_files) - 5}개"
        task_id_raw = task_id_raw or f"AUTO-{now_id}"
        summary_raw = summary_raw or f"staged {len(staged_files)}개 파일 기준 문서 연동 자동기록"
        decision_raw = decision_raw or "커밋 시 문서 4종을 자동 연동 업데이트한다"
        reason_raw = reason_raw or "작업 중 수동 문서 기록 누락과 문서 간 불일치를 방지하기 위해"
        impact_raw = impact_raw or changed

    missing = [
        name
        for name, value in [
            ("--task-id", task_id_raw),
            ("--summary", summary_raw),
            ("--decision", decision_raw),
            ("--reason", reason_raw),
            ("--impact", impact_raw),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(f"필수 인자가 없습니다: {', '.join(missing)}")

    task_id = sanitize_cell(task_id_raw)
    summary = sanitize_cell(summary_raw)
    decision = sanitize_cell(decision_raw)
    reason = sanitize_cell(reason_raw)
    impact = sanitize_cell(impact_raw)
    verification = sanitize_cell(args.verification)
    result = sanitize_cell(args.result)
    gates = sanitize_cell(args.gates)
    note = sanitize_cell(args.note)

    sync_doc_dates(today)
    update_plan(today, task_id, summary, note)
    update_context(today, decision, reason, impact)
    update_checklist(today, task_id, summary, verification, result, note)
    update_enterprise(today, task_id, summary, gates, note)

    print("[append-linked-docs-log] updated: plan/context/checklist/enterprise_workflow")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[append-linked-docs-log] failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
