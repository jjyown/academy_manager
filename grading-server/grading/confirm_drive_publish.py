"""선생님 확정 후: DB 문항(수정 반영) 기준 채점 이미지 생성 → 중앙 Drive 업로드."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from fastapi import HTTPException

from config import CENTRAL_GRADED_RESULT_FOLDER, CENTRAL_INSTANT_GRADE_FOLDER
from integrations.drive import delete_file, download_file_central, prepare_upload_target, upload_to_target
from integrations.supabase_client import (
    get_central_admin_token,
    get_grading_items_for_confirm,
    get_student,
    run_query,
    get_supabase,
)
from file_utils import extract_images_from_zip
from grading.image_marker import create_graded_image
from grading.panel_scores import panel_scores_from_items
from ocr.preprocessor import preprocess_batch

logger = logging.getLogger(__name__)


def _sort_key_question(it: dict) -> tuple:
    qn = it.get("question_number")
    try:
        n = int(qn) if qn is not None else 9999
    except (TypeError, ValueError):
        n = 9999
    label = str(it.get("question_label") or "")
    m = re.match(r"(\d+)", label)
    if m:
        n = min(n, int(m.group(1)))
    return (n, label)


def _items_for_marker(db_items: list[dict]) -> list[dict]:
    """image_marker.create_graded_image에 맞게 필드만 전달."""
    out: list[dict] = []
    for it in db_items:
        qt = it.get("question_type") or "multiple_choice"
        if qt in ("mc", "short"):
            qt = "multiple_choice" if qt == "mc" else "short_answer"
        out.append(
            {
                "question_number": it.get("question_number"),
                "question_label": it.get("question_label") or "",
                "question_type": qt,
                "student_answer": it.get("student_answer") or "",
                "correct_answer": it.get("correct_answer") or "",
                "is_correct": it.get("is_correct"),
                "ai_feedback": it.get("ai_feedback") or "",
                "error_type": it.get("error_type") or "",
            }
        )
    return out


def _fallback_drive_target(result_row: dict, student_name: str) -> tuple[str, list[str]]:
    ca = result_row.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    dt_local = dt.astimezone()
    y, m, d = dt_local.year, dt_local.month, dt_local.day
    mode = (result_row.get("mode") or "assigned").strip().lower()
    folder = CENTRAL_INSTANT_GRADE_FOLDER if mode == "instant" else CENTRAL_GRADED_RESULT_FOLDER
    sub = [f"{y}년", f"{m}월", f"{d}일", student_name or "학생"]
    return folder, sub


async def publish_graded_images_on_confirm(result_row: dict) -> tuple[list[str], list[str]]:
    """
    homework_submission 연결 건만: 원본 ZIP 재로드 → 페이지별 채점 이미지 생성 → Drive 업로드.
    반환: (drive_file_ids, image_urls)
    """
    result_id = int(result_row["id"])
    submission_id = result_row.get("homework_submission_id")
    if not submission_id:
        raise HTTPException(400, "숙제 제출과 연결되지 않은 결과는 이 경로로 Drive 반영을 할 수 없습니다.")

    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(503, "중앙 관리 드라이브 토큰이 없습니다.")

    sb = get_supabase()
    sub_res = await run_query(
        sb.table("homework_submissions")
        .select("drive_file_id, central_drive_file_id")
        .eq("id", int(submission_id))
        .limit(1)
        .execute
    )
    if not sub_res.data:
        raise HTTPException(404, "연결된 숙제 제출을 찾을 수 없습니다.")
    sub = sub_res.data[0]
    zip_drive_id = (
        sub.get("drive_file_id")
        or sub.get("central_drive_file_id")
        or ""
    )
    if not zip_drive_id:
        raise HTTPException(400, "제출 ZIP 드라이브 ID가 없어 채점 이미지를 만들 수 없습니다.")

    try:
        zip_data = download_file_central(central_token, zip_drive_id)
    except Exception as e:
        logger.error(f"[ConfirmDrive] ZIP 다운로드 실패: {e}")
        raise HTTPException(502, f"원본 ZIP 다운로드 실패: {str(e)[:200]}")

    image_bytes_list = extract_images_from_zip(zip_data)
    if not image_bytes_list:
        raise HTTPException(400, "원본 ZIP에서 이미지를 찾을 수 없습니다.")

    image_bytes_list = preprocess_batch(image_bytes_list)

    items = await get_grading_items_for_confirm(result_id)
    by_page: dict[int, list[dict]] = {}
    for it in items:
        idx = int(it.get("source_image_index") or 0)
        by_page.setdefault(idx, []).append(it)
    for lst in by_page.values():
        lst.sort(key=_sort_key_question)

    student = await get_student(int(result_row["student_id"]))
    student_name = (student or {}).get("name") or "학생"

    folder = (result_row.get("drive_publish_folder") or "").strip()
    sub_path = result_row.get("drive_publish_sub_path")
    if not folder or not sub_path or not isinstance(sub_path, list):
        folder, sub_path = _fallback_drive_target(result_row, student_name)
    else:
        sub_path = [str(x) for x in sub_path]

    old_ids = result_row.get("central_graded_drive_ids") or []
    if isinstance(old_ids, str):
        old_ids = []
    for fid in old_ids:
        if fid:
            try:
                delete_file(central_token, str(fid))
            except Exception as de:
                logger.warning(f"[ConfirmDrive] 기존 채점 파일 삭제 실패(무시): {fid} {de}")

    ids: list[str] = []
    urls: list[str] = []

    # 폴더 트리 1회 해석 — 페이지마다 재해석을 제거.
    try:
        upload_service, upload_parent_id = prepare_upload_target(central_token, folder, sub_path)
    except Exception as prep_err:
        logger.error(f"[ConfirmDrive] Drive 업로드 대상 준비 실패: {prep_err}", exc_info=True)
        raise HTTPException(502, f"Drive 업로드 대상 준비 실패: {str(prep_err)[:120]}")

    n = len(image_bytes_list)
    for idx in range(n):
        page_items = by_page.get(idx, [])
        raw = image_bytes_list[idx]
        if page_items:
            marker_items = _items_for_marker(page_items)
            ts, ms = panel_scores_from_items(page_items)
            try:
                jpg = create_graded_image(raw, marker_items, ts, ms)
            except Exception as e:
                logger.error(f"[ConfirmDrive] 이미지 {idx+1} 렌더 실패: {e}", exc_info=True)
                raise HTTPException(500, f"채점 이미지 생성 실패 (페이지 {idx+1}): {str(e)[:120]}")
            fname = f"채점_{idx+1}.jpg"
        else:
            jpg = raw
            fname = f"원본_{idx+1}.jpg"

        try:
            up = upload_to_target(upload_service, upload_parent_id, fname, jpg)
        except Exception as e:
            logger.error(f"[ConfirmDrive] Drive 업로드 실패 {fname}: {e}", exc_info=True)
            raise HTTPException(502, f"Drive 업로드 실패 ({fname}): {str(e)[:120]}")
        ids.append(up["id"])
        urls.append(up["url"])

    logger.info(f"[ConfirmDrive] result #{result_id}: {len(ids)}장 업로드 완료")
    return ids, urls
