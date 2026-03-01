"""
full regrade 오류 유형 재현용 ZIP 픽스처 생성기.

생성 파일:
- no_images.zip: 이미지가 전혀 없는 ZIP (텍스트만 포함)
- empty.zip: 엔트리가 없는 빈 ZIP
- not_a_zip.bin: ZIP 형식이 아닌 바이너리 파일

사용 예:
    python qa-artifacts/generate_regrade_fixtures.py
    python qa-artifacts/generate_regrade_fixtures.py --out-dir qa-artifacts/regrade-fixtures
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path
import zipfile


def _write_no_images_zip(path: Path) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("readme.txt", "This zip has no image files.")
        zf.writestr("notes/answer.md", "# no image fixture")


def _write_empty_zip(path: Path) -> None:
    # 엔트리가 없는 비어있는 ZIP
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED):
        pass


def _write_not_a_zip(path: Path) -> None:
    path.write_bytes(b"this-is-not-a-zip-binary")


def _write_usage_note(path: Path) -> None:
    text = """# Regrade Fixtures

이 디렉터리는 full regrade 오류 시나리오 재현용 샘플 파일입니다.

## 파일 설명
- `no_images.zip`: ZIP은 정상이나 이미지가 없어 \"이미지 0건\" 경로를 재현
- `empty.zip`: ZIP 안에 파일이 전혀 없어 \"빈 ZIP\" 경로를 재현
- `not_a_zip.bin`: ZIP이 아닌 파일로 \"ZIP 형식 오류\" 경로를 재현

## 사용 방법(권장)
1. 테스트 제출 데이터를 생성할 때 위 파일을 원본 제출물로 업로드
2. `/api/results/{id}/regrade`(full regrade 경로) 호출
3. HTTP 코드/메시지/진행률/프론트 토스트를 함께 기록
"""
    path.write_text(text, encoding="utf-8")


def main() -> None:
    default_out_dir = Path(__file__).resolve().parent / "regrade-fixtures"
    parser = argparse.ArgumentParser(description="Generate fixtures for full regrade failure scenarios.")
    parser.add_argument(
        "--out-dir",
        default=str(default_out_dir),
        help="Output directory path (default: qa-artifacts/regrade-fixtures next to this script)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    _write_no_images_zip(out_dir / "no_images.zip")
    _write_empty_zip(out_dir / "empty.zip")
    _write_not_a_zip(out_dir / "not_a_zip.bin")
    _write_usage_note(out_dir / "README.md")

    print(f"Generated fixtures in: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
