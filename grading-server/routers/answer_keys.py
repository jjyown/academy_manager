"""교재/정답 관리 라우터"""
import base64
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from config import CENTRAL_GRADING_MATERIAL_FOLDER
from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token,
    get_answer_keys_by_teacher, upsert_answer_key,
)
from integrations.drive import (
    download_file_central, upload_page_images_to_central,
    search_answer_pdfs_central, delete_page_images_folder,
)
from grading.pdf_parser import extract_answers_from_pdf
from grading.hml_parser import extract_answers_from_hml
from file_utils import parse_page_range

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/answer-keys", tags=["answer-keys"])


@router.get("")
async def list_answer_keys(teacher_id: str):
    keys = await get_answer_keys_by_teacher(teacher_id)
    return {"data": keys}


@router.put("/{key_id}")
async def update_answer_key(key_id: int, request: Request):
    try:
        body = await request.json()
        sb = get_supabase()

        existing = await run_query(sb.table("answer_keys").select("*").eq("id", key_id).limit(1).execute)
        if not existing.data:
            raise HTTPException(404, "교재를 찾을 수 없습니다")
        old_key = existing.data[0]

        update_data = {}

        if "title" in body:
            update_data["title"] = body["title"]
        if "subject" in body:
            update_data["subject"] = body["subject"]
        if "answers_json" in body:
            update_data["answers_json"] = body["answers_json"]
            update_data["total_questions"] = len(body["answers_json"])
        if "update_answers" in body:
            merged = dict(old_key.get("answers_json") or {})
            merged.update(body["update_answers"])
            update_data["answers_json"] = merged
            update_data["total_questions"] = len(merged)
        if "question_types_json" in body:
            update_data["question_types_json"] = body["question_types_json"]
        if "update_types" in body:
            merged_types = dict(old_key.get("question_types_json") or {})
            merged_types.update(body["update_types"])
            update_data["question_types_json"] = merged_types
        if "bookmarks_json" in body:
            update_data["bookmarks_json"] = body["bookmarks_json"]
        if "grade_level" in body:
            update_data["grade_level"] = body["grade_level"]

        if not update_data:
            return {"success": False, "message": "수정할 내용이 없습니다"}

        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = await run_query(sb.table("answer_keys").update(update_data).eq("id", key_id).execute)
        logger.info(f"[AnswerKey] #{key_id} 수정: {list(update_data.keys())}")
        return {"success": True, "data": res.data[0] if res.data else {}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"정답지 수정 실패 (id={key_id}): {e}")
        raise HTTPException(500, f"정답지 수정 실패: {str(e)[:200]}")


@router.delete("/{key_id}")
async def delete_answer_key(key_id: int, teacher_id: str):
    sb = get_supabase()
    record = await run_query(sb.table("answer_keys").select("id, title, page_images_json").eq(
        "id", key_id
    ).eq("teacher_id", teacher_id).limit(1).execute)

    if not record.data:
        return {"success": False, "message": "삭제할 교재를 찾을 수 없습니다"}

    key_data = record.data[0]
    title = key_data.get("title", "")
    await run_query(sb.table("answer_keys").delete().eq("id", key_id).execute)

    drive_deleted = False
    if title:
        central_token = await get_central_admin_token()
        if central_token:
            drive_deleted = delete_page_images_folder(central_token, title)
            if drive_deleted:
                logger.info(f"[Delete] 교재 '{title}' Drive 폴더 삭제 완료")
            else:
                logger.warning(f"[Delete] 교재 '{title}' Drive 폴더 없거나 삭제 실패")

    return {
        "success": True,
        "message": f"교재가 삭제되었습니다" + (" (Drive 폴더도 삭제됨)" if drive_deleted else ""),
    }


@router.post("/parse")
async def parse_answer_key(
    teacher_id: str = Form(...),
    title: str = Form(...),
    subject: str = Form(""),
    grade_level: str = Form(""),
    drive_file_id: str = Form(""),
    pdf_file: UploadFile = File(None),
    answer_page_range: str = Form(""),
    total_hint: int = Form(None),
):
    file_bytes = None
    file_ext = ""
    central_token = await get_central_admin_token()

    if pdf_file:
        file_bytes = await pdf_file.read()
        fname = (pdf_file.filename or "").lower()
        file_ext = "hml" if fname.endswith(".hml") else "pdf"
    elif drive_file_id and central_token:
        file_bytes = download_file_central(central_token, drive_file_id)
        file_ext = "pdf"
    else:
        raise HTTPException(400, "PDF 또는 HML 파일이 필요합니다")

    raw_page_images = []
    if file_ext == "hml":
        logger.info(f"[Parse] HML 파일 파싱: '{title}'")
        result = await extract_answers_from_hml(file_bytes)
    else:
        page_range = None
        if answer_page_range.strip():
            page_range = parse_page_range(answer_page_range.strip())
        result = await extract_answers_from_pdf(file_bytes, total_hint=total_hint, page_range=page_range)
        raw_page_images = result.pop("page_images", [])

    page_images_json = []
    if raw_page_images:
        if central_token:
            try:
                page_images_json = upload_page_images_to_central(central_token, title, raw_page_images)
                logger.info(f"[Parse] '{title}' 페이지 이미지 {len(page_images_json)}장 Drive 업로드 완료")
            except Exception as e:
                logger.warning(f"[Parse] Drive 업로드 실패, base64 fallback: {e}")
                page_images_json = []

        if not page_images_json:
            for img in raw_page_images:
                b64 = base64.b64encode(img["image_bytes"]).decode("utf-8")
                page_images_json.append({
                    "page": img["page"],
                    "url": f"data:image/jpeg;base64,{b64}",
                })
            logger.info(f"[Parse] '{title}' 페이지 이미지 {len(page_images_json)}장 base64 fallback 저장")

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "grade_level": grade_level or "",
        "drive_file_id": drive_file_id,
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "page_images_json": page_images_json,
        "parsed": True,
    }
    saved = await upsert_answer_key(key_data)
    logger.info(f"[Parse] '{title}' 정답 {result.get('total', 0)}문제 저장 완료 "
                 f"(파서: {'HML' if file_ext == 'hml' else 'PDF'}, "
                 f"페이지 이미지: {len(page_images_json)}장)")
    return {"data": saved, "parsed_result": result}


@router.get("/drive-pdfs")
async def list_drive_pdfs():
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    pdfs = search_answer_pdfs_central(central_token, CENTRAL_GRADING_MATERIAL_FOLDER)
    return {"data": pdfs}
