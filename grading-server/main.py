"""자동 채점 서버 - FastAPI
전체 흐름:
1. 학생이 숙제 제출 → 중앙 드라이브(jjyown@gmail.com)에 저장
2. Python 서버가 중앙 드라이브에서 ZIP 다운로드 → OCR 채점
3. 채점 결과 이미지를 중앙 드라이브 + 담당 선생님 드라이브에 저장
4. 선생님이 채점 관리 페이지에서 검토/수정
"""
import logging
import io
import json
import zipfile
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import (
    PORT, CENTRAL_GRADING_MATERIAL_FOLDER, CENTRAL_GRADED_RESULT_FOLDER,
    TEACHER_RESULT_FOLDER
)
from ocr.engines import double_check_ocr
from grading.grader import grade_submission
from grading.image_marker import create_graded_image
from grading.pdf_parser import extract_answers_from_pdf
from integrations.supabase_client import (
    get_central_admin_token, get_teacher_drive_token,
    get_answer_key, get_all_answer_keys, get_answer_keys_by_teacher, upsert_answer_key,
    get_assignment, get_assignments_by_teacher, create_assignment,
    create_grading_result, update_grading_result,
    get_grading_results_by_teacher, get_grading_results_by_student,
    create_grading_items, get_grading_items, update_grading_item,
    get_student, get_teacher, get_teacher_by_id,
    get_pending_submissions, update_submission_grading_status,
    get_supabase,
)
from integrations.drive import (
    download_file_central, upload_to_central, upload_to_teacher_drive,
    search_answer_pdfs_central, cleanup_old_originals, delete_file,
)
from integrations.gemini import match_answer_key
from scheduler.monthly_eval import run_monthly_evaluation

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 매월 28일 자정에 종합평가 자동 생성
    scheduler.add_job(run_monthly_evaluation, "cron", day=28, hour=0, minute=0)
    scheduler.start()
    logger.info("스케줄러 시작: 매월 28일 종합평가 자동 생성")
    yield
    scheduler.shutdown()


app = FastAPI(title="자동 채점 서버", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 헬스체크
# ============================================================

@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


# ============================================================
# 교재/정답 관리 (중앙 드라이브에서 관리)
# ============================================================

@app.get("/api/answer-keys")
async def list_answer_keys(teacher_id: str):
    """선생님의 교재 목록 조회"""
    keys = await get_answer_keys_by_teacher(teacher_id)
    return {"data": keys}


@app.post("/api/answer-keys/parse")
async def parse_answer_key(
    teacher_id: str = Form(...),
    title: str = Form(...),
    subject: str = Form(""),
    drive_file_id: str = Form(""),
    pdf_file: UploadFile = File(None),
):
    """정답 PDF 파싱 및 교재 등록
    PDF는 중앙 드라이브의 '숙제 채점 자료' 폴더에서 가져옴
    """
    pdf_bytes = None
    central_token = await get_central_admin_token()

    if pdf_file:
        pdf_bytes = await pdf_file.read()
    elif drive_file_id and central_token:
        pdf_bytes = download_file_central(central_token, drive_file_id)
    else:
        raise HTTPException(400, "PDF 파일 또는 드라이브 파일 ID가 필요합니다")

    result = await extract_answers_from_pdf(pdf_bytes)

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "drive_file_id": drive_file_id,
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "parsed": True,
    }
    saved = await upsert_answer_key(key_data)

    return {"data": saved, "parsed_result": result}


@app.get("/api/answer-keys/drive-pdfs")
async def list_drive_pdfs():
    """중앙 드라이브 '숙제 채점 자료' 폴더의 PDF 목록"""
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    pdfs = search_answer_pdfs_central(central_token, CENTRAL_GRADING_MATERIAL_FOLDER)
    return {"data": pdfs}


# ============================================================
# 과제 배정
# ============================================================

@app.get("/api/assignments")
async def list_assignments(teacher_id: str):
    assignments = await get_assignments_by_teacher(teacher_id)
    return {"data": assignments}


@app.post("/api/assignments")
async def create_new_assignment(
    teacher_id: str = Form(...),
    title: str = Form(...),
    answer_key_id: int = Form(None),
    page_range: str = Form(""),
    due_date: str = Form(None),
    mode: str = Form("assigned"),
):
    data = {
        "teacher_id": teacher_id,
        "title": title,
        "answer_key_id": answer_key_id,
        "page_range": page_range,
        "due_date": due_date,
        "mode": mode,
    }
    result = await create_assignment(data)
    return {"data": result}


# ============================================================
# 채점 실행 (핵심 API)
# ============================================================

@app.post("/api/grade")
async def grade_homework(
    student_id: int = Form(...),
    teacher_id: str = Form(...),
    assignment_id: int = Form(None),
    answer_key_id: int = Form(None),
    mode: str = Form("assigned"),
    homework_submission_id: int = Form(None),
    image: UploadFile = File(None),
    zip_drive_id: str = Form(""),
):
    """채점 실행
    - image: 직접 업로드 (즉시 채점)
    - zip_drive_id: 중앙 드라이브의 ZIP 파일 ID (수업 전 제출 채점)
    """
    student = await get_student(student_id)
    if not student:
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    # 중앙 드라이브 토큰 조회
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    # 선생님 드라이브 토큰 조회
    teacher_token = await get_teacher_drive_token(teacher_id)

    # 정답 데이터 조회
    answer_key = None
    if answer_key_id:
        answer_key = await get_answer_key(answer_key_id)
    elif assignment_id:
        assignment = await get_assignment(assignment_id)
        if assignment and assignment.get("answer_key_id"):
            answer_key = await get_answer_key(assignment["answer_key_id"])
            answer_key_id = assignment["answer_key_id"]

    # 이미지 가져오기
    image_bytes_list = []

    if image:
        img_data = await image.read()
        if image.filename and image.filename.endswith(".zip"):
            image_bytes_list = _extract_images_from_zip(img_data)
        else:
            image_bytes_list = [img_data]
    elif zip_drive_id:
        # 중앙 드라이브에서 ZIP 다운로드
        zip_data = download_file_central(central_token, zip_drive_id)
        image_bytes_list = _extract_images_from_zip(zip_data)

    if not image_bytes_list:
        raise HTTPException(400, "채점할 이미지가 없습니다")

    # 채점 결과 레코드 생성
    result_data = {
        "student_id": student_id,
        "teacher_id": teacher_id,
        "assignment_id": assignment_id,
        "answer_key_id": answer_key_id,
        "homework_submission_id": homework_submission_id,
        "mode": mode,
        "status": "grading",
        "total_questions": 0,
    }
    grading_result = await create_grading_result(result_data)
    result_id = grading_result["id"]

    # 숙제 제출 상태 업데이트
    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "grading")

    all_items = []
    central_graded_urls = []
    central_graded_ids = []
    teacher_graded_urls = []
    teacher_graded_ids = []
    total_correct = 0
    total_wrong = 0
    total_uncertain = 0
    total_questions = 0
    total_score = 0
    max_score = 0

    for idx, img_bytes in enumerate(image_bytes_list):
        # 자동 검색 모드: 정답 키 매칭
        if not answer_key and mode == "auto_search":
            ocr_preview = double_check_ocr(img_bytes)
            all_keys = await get_all_answer_keys()
            matched_id = await match_answer_key(ocr_preview["full_text_1"], all_keys)
            if matched_id:
                answer_key = await get_answer_key(matched_id)
                answer_key_id = matched_id

        if not answer_key:
            logger.warning(f"정답 데이터를 찾을 수 없습니다 (student: {student_id})")
            continue

        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        # 채점 실행
        grade_result = await grade_submission(img_bytes, answers_json, types_json)

        # 채점 이미지 생성
        graded_img = create_graded_image(
            img_bytes, grade_result["items"],
            grade_result["total_score"], grade_result["max_score"]
        )

        now_str = datetime.now().strftime('%Y%m%d_%H%M')
        filename = f"{student['name']}_{now_str}_{idx+1}.jpg"
        sub_path = [
            answer_key.get("subject", "") or "기타",
            answer_key.get("title", ""),
            student["name"]
        ]

        # 1) 중앙 드라이브에 채점 결과 저장
        central_uploaded = upload_to_central(
            central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, graded_img
        )
        central_graded_urls.append(central_uploaded["url"])
        central_graded_ids.append(central_uploaded["id"])

        # 2) 선생님 드라이브에 채점 결과 전송
        if teacher_token:
            try:
                teacher_uploaded = upload_to_teacher_drive(
                    teacher_token, TEACHER_RESULT_FOLDER, sub_path, filename, graded_img
                )
                teacher_graded_urls.append(teacher_uploaded["url"])
                teacher_graded_ids.append(teacher_uploaded["id"])
            except Exception as e:
                logger.warning(f"선생님 드라이브 전송 실패: {e}")
                teacher_graded_urls.append(central_uploaded["url"])

        # 문항별 데이터
        for item in grade_result["items"]:
            item["result_id"] = result_id
            all_items.append(item)

        total_correct += grade_result["correct_count"]
        total_wrong += grade_result["wrong_count"]
        total_uncertain += grade_result["uncertain_count"]
        total_questions += grade_result["total_questions"]
        total_score += grade_result["total_score"]
        max_score += grade_result["max_score"]

    # 문항별 DB 저장
    if all_items:
        await create_grading_items(all_items)

    # 결과 업데이트
    status = "confirmed" if total_uncertain == 0 else "review_needed"
    await update_grading_result(result_id, {
        "answer_key_id": answer_key_id,
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "total_questions": total_questions,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "status": status,
        "central_graded_drive_ids": central_graded_ids,
        "central_graded_image_urls": central_graded_urls,
        "teacher_graded_drive_ids": teacher_graded_ids,
        "teacher_graded_image_urls": teacher_graded_urls if teacher_graded_urls else central_graded_urls,
    })

    # 숙제 제출 상태 업데이트
    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "graded")

    return {
        "result_id": result_id,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "total_questions": total_questions,
        "status": status,
        "graded_images": teacher_graded_urls if teacher_graded_urls else central_graded_urls,
    }


# ============================================================
# 채점 결과 조회/수정
# ============================================================

@app.get("/api/results")
async def list_results(teacher_id: str, status: str = None):
    results = await get_grading_results_by_teacher(teacher_id, status)
    return {"data": results}


@app.get("/api/results/student/{student_id}")
async def list_student_results(student_id: int):
    results = await get_grading_results_by_student(student_id)
    return {"data": results}


@app.get("/api/results/{result_id}/items")
async def get_result_items(result_id: int):
    items = await get_grading_items(result_id)
    return {"data": items}


@app.put("/api/results/{result_id}/confirm")
async def confirm_result(result_id: int):
    updated = await update_grading_result(result_id, {"status": "confirmed"})
    return {"data": updated}


@app.put("/api/items/{item_id}")
async def update_item(item_id: int, teacher_score: float = Form(None), teacher_feedback: str = Form("")):
    data = {}
    if teacher_score is not None:
        data["teacher_score"] = teacher_score
    if teacher_feedback:
        data["teacher_feedback"] = teacher_feedback
    updated = await update_grading_item(item_id, data)
    return {"data": updated}


@app.put("/api/results/{result_id}/annotations")
async def save_annotations(result_id: int, annotations: str = Form("[]"), memo: str = Form("")):
    data = {"teacher_annotations": json.loads(annotations)}
    if memo:
        data["teacher_memo"] = memo
    updated = await update_grading_result(result_id, data)
    return {"data": updated}


# ============================================================
# 종합평가
# ============================================================

@app.post("/api/evaluations/generate")
async def trigger_evaluation(teacher_id: str = Form(...)):
    await run_monthly_evaluation()
    return {"status": "ok"}


@app.put("/api/evaluations/{eval_id}/approve")
async def approve_evaluation(eval_id: int):
    sb = get_supabase()
    sb.table("evaluations").update({"approved": True}).eq("id", eval_id).execute()
    return {"status": "approved"}


# ============================================================
# 자동 정리 (중앙 드라이브 원본 삭제)
# ============================================================

@app.post("/api/cleanup/originals")
async def cleanup_originals(result_id: int = Form(...)):
    """원본 사진 삭제 (중앙 드라이브에서)"""
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    sb = get_supabase()
    res = sb.table("grading_results").select("central_original_drive_ids").eq("id", result_id).maybe_single().execute()
    if res.data and res.data.get("central_original_drive_ids"):
        deleted = cleanup_old_originals(central_token, res.data["central_original_drive_ids"])
        await update_grading_result(result_id, {"central_original_drive_ids": []})
        return {"deleted": deleted}
    return {"deleted": 0}


@app.post("/api/cleanup/student")
async def cleanup_student_data(
    student_id: int = Form(...),
    delete_files: bool = Form(False),
):
    """학생 삭제 시 자료 정리 (중앙 + 선생님 드라이브)"""
    sb = get_supabase()

    if delete_files:
        central_token = await get_central_admin_token()

        results = sb.table("grading_results").select(
            "central_original_drive_ids, central_graded_drive_ids, teacher_graded_drive_ids, teacher_id"
        ).eq("student_id", student_id).execute()

        total_deleted = 0
        for r in (results.data or []):
            # 중앙 드라이브 파일 삭제
            if central_token:
                for fid in (r.get("central_original_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1
                for fid in (r.get("central_graded_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1

            # 선생님 드라이브 파일 삭제
            teacher_token = await get_teacher_drive_token(r.get("teacher_id", ""))
            if teacher_token:
                for fid in (r.get("teacher_graded_drive_ids") or []):
                    if delete_file(teacher_token, fid):
                        total_deleted += 1

        logger.info(f"학생 {student_id} 드라이브 파일 {total_deleted}개 삭제")

    sb.table("grading_results").delete().eq("student_id", student_id).execute()

    return {"status": "cleaned", "student_id": student_id}


# ============================================================
# 유틸리티
# ============================================================

def _extract_images_from_zip(zip_bytes: bytes) -> list[bytes]:
    """ZIP에서 이미지 파일 추출"""
    images = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in sorted(zf.namelist()):
                lower = name.lower()
                if lower.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")):
                    images.append(zf.read(name))
    except Exception as e:
        logger.error(f"ZIP 압축 해제 실패: {e}")
    return images


# ============================================================
# 서버 시작
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
