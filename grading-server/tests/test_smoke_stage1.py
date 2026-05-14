"""Stage 1 정적 스모크 테스트 — 의존성 설치 없이 실행 가능.

변경된 3개 파일의 핵심 패턴을 ast/텍스트로 검증:
- grading.py: files_json 분기 추가 확인
- upload-homework/index.ts: getAll('files'), MAX_FILES, files_json 추가 확인
- homework/index.html: zipBlob 제거 확인
"""
import ast
import pathlib

ROOT = pathlib.Path(__file__).parent.parent.parent  # academy_manager/


def test_grading_py_files_json_branch():
    """grading.py 에 files_json DB 조회 분기가 있어야 함."""
    src = (ROOT / "grading-server/routers/grading.py").read_text(encoding="utf-8")
    ast.parse(src)  # 구문 오류 없음
    assert "files_json_entries" in src, "files_json_entries 변수가 없음"
    assert "download_file_central" in src, "download_file_central 호출 없음"


def test_upload_homework_multi_files():
    """upload-homework/index.ts 에 다중 파일 수신·J1 한도·files_json 저장이 있어야 함."""
    src = (ROOT / "supabase/functions/upload-homework/index.ts").read_text(encoding="utf-8")
    assert 'getAll("files")' in src, "getAll('files') 없음 — 다중 파일 수신 미적용"
    assert "MAX_FILES_PER_SUBMISSION" in src, "J1 파일 수 한도 없음"
    assert "MAX_FILE_MB" in src, "J1 파일 크기 한도 없음"
    assert "files_json" in src, "files_json 컬럼 저장 없음"
    assert "JSZip" in src, "JSZip import 없음"
    # 구형 단일 파일 zip_drive_id 를 grading trigger 에 더 이상 보내지 않아야 함
    # (Stage 1 에서 제거됨)
    assert 'gradeForm.append("zip_drive_id"' not in src, "zip_drive_id 를 grading trigger 에 여전히 보내고 있음"


def test_homework_html_no_zip_creation():
    """homework/index.html 에서 zipBlob 생성 코드가 제거돼야 함."""
    src = (ROOT / "homework/index.html").read_text(encoding="utf-8")
    assert "zipBlob" not in src, "zipBlob 가 아직 남아있음 — zip 생성 코드 미제거"
    assert "new JSZip()" not in src, "new JSZip() 가 아직 남아있음 — zip 생성 코드 미제거"
    assert "append('files'" in src or 'append("files"' in src, "formData.append('files', ...) 없음"


def test_migration_file_exists():
    """Stage 1 마이그레이션 파일이 존재해야 함."""
    migration = ROOT / "migrations/0043_homework_files_json_20260514.sql"
    assert migration.exists(), f"마이그레이션 파일 없음: {migration.name}"
    content = migration.read_text(encoding="utf-8")
    assert "files_json" in content, "마이그레이션에 files_json 컬럼 추가 없음"
    assert "hw_files_json_gin_idx" in content, "GIN 인덱스 없음"
