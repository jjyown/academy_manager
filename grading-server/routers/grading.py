"""채점 실행 라우터 (핵심 API)"""
import logging
import re
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from config import CENTRAL_GRADED_RESULT_FOLDER
from progress import update_progress
from file_utils import extract_images_from_zip
from ocr.engines import ocr_gpt4o_batch, cross_validate_ocr
from ocr.preprocessor import preprocess_batch
from grading.grader import grade_submission
from grading.image_marker import create_graded_image
from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token,
    get_answer_key, get_assignment,
    get_student_assigned_key, get_best_book_by_assignment, get_student_book_keys,
    get_student, create_grading_result, update_grading_result,
    create_grading_items, update_submission_grading_status, create_notification,
)
from integrations.drive import download_file_central, upload_to_central

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["grading"])


@router.post("/grade")
async def grade_homework(
    background_tasks: BackgroundTasks,
    student_id: int = Form(...),
    teacher_id: str = Form(...),
    assignment_id: int = Form(None),
    answer_key_id: int = Form(None),
    mode: str = Form("assigned"),
    homework_submission_id: int = Form(None),
    image: UploadFile = File(None),
    zip_drive_id: str = Form(""),
):
    student = await get_student(student_id)
    if not student:
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    if homework_submission_id:
        sb = get_supabase()
        existing = await run_query(sb.table("grading_results").select("id, status").eq(
            "homework_submission_id", homework_submission_id
        ).in_("status", ["grading", "confirmed", "review_needed"]).limit(1).execute)
        if existing.data:
            existing_result = existing.data[0]
            logger.info(f"[Dedup] submission #{homework_submission_id} 이미 채점됨 → result #{existing_result['id']}")
            return {
                "result_id": existing_result["id"],
                "status": existing_result["status"],
                "message": "이미 채점된 제출입니다",
                "duplicate": True,
            }

    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    answer_key = None
    if answer_key_id:
        answer_key = await get_answer_key(answer_key_id)
    elif assignment_id:
        assignment = await get_assignment(assignment_id)
        if assignment and assignment.get("answer_key_id"):
            answer_key = await get_answer_key(assignment["answer_key_id"])
            answer_key_id = assignment["answer_key_id"]
    if not answer_key:
        assigned = await get_student_assigned_key(student_id)
        if assigned:
            answer_key = assigned
            answer_key_id = assigned.get("id")
            logger.info(f"[Assign] 학생 #{student_id} 배정 교재 → #{answer_key_id} '{assigned.get('title','')}'")
    if not answer_key:
        book_keys = await get_student_book_keys(student_id)
        if book_keys:
            if len(book_keys) == 1:
                answer_key = book_keys[0]
                answer_key_id = answer_key.get("id")
                logger.info(f"[StudentBooks] 학생 #{student_id} 교재 1개 → #{answer_key_id} '{answer_key.get('title','')}'")
            else:
                book_key_ids = [bk["id"] for bk in book_keys if bk.get("id")]
                matched = await get_best_book_by_assignment(book_key_ids)
                if matched:
                    answer_key = matched
                    answer_key_id = matched.get("id")
                    logger.info(f"[StudentBooks+Assign] 학생 #{student_id} 과제 매칭 교재 → #{answer_key_id}")
                else:
                    answer_key = book_keys[0]
                    answer_key_id = answer_key.get("id")
                    logger.warning(f"[StudentBooks] 학생 #{student_id} 교재 {len(book_keys)}개 중 과제 매칭 없음 → 첫 번째 교재 #{answer_key_id} 선택")

    image_bytes_list = []
    if image:
        img_data = await image.read()
        if image.filename and image.filename.endswith(".zip"):
            image_bytes_list = extract_images_from_zip(img_data)
        else:
            image_bytes_list = [img_data]
    elif zip_drive_id:
        zip_data = download_file_central(central_token, zip_drive_id)
        logger.info(f"[Grade] Drive ZIP 다운로드 완료: {len(zip_data)} bytes")
        image_bytes_list = extract_images_from_zip(zip_data)

    logger.info(f"[Grade] 추출된 이미지: {len(image_bytes_list)}장 "
                f"(크기: {[len(b)//1024 for b in image_bytes_list[:10]]}KB)")

    if not image_bytes_list:
        raise HTTPException(400, "채점할 이미지가 없습니다 (지원 형식: JPG, PNG, GIF, WEBP, BMP, HEIC, PDF)")

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

    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "grading")

    background_tasks.add_task(
        _run_grading_background,
        result_id=result_id,
        student=student,
        student_id=student_id,
        teacher_id=teacher_id,
        central_token=central_token,
        answer_key=answer_key,
        answer_key_id=answer_key_id,
        image_bytes_list=image_bytes_list,
        mode=mode,
        homework_submission_id=homework_submission_id,
    )

    return {
        "result_id": result_id,
        "status": "grading",
        "message": "채점이 백그라운드에서 시작되었습니다",
    }


async def _run_grading_background(
    *,
    result_id: int,
    student: dict,
    student_id: int,
    teacher_id: str,
    central_token: str,
    answer_key: dict | None,
    answer_key_id: int | None,
    image_bytes_list: list[bytes],
    mode: str,
    homework_submission_id: int | None,
):
    try:
        await _execute_grading(
            result_id=result_id,
            student=student,
            student_id=student_id,
            teacher_id=teacher_id,
            central_token=central_token,
            answer_key=answer_key,
            answer_key_id=answer_key_id,
            image_bytes_list=image_bytes_list,
            mode=mode,
            homework_submission_id=homework_submission_id,
        )
    except Exception as e:
        logger.error(f"[FATAL] 채점 실패 (result #{result_id}): {e}", exc_info=True)
        update_progress(result_id, "failed", 0, 0, f"채점 실패: {str(e)[:100]}")
        try:
            error_msg = str(e)[:500]
            await update_grading_result(result_id, {
                "status": "review_needed",
                "error_message": error_msg,
            })
            if homework_submission_id:
                await update_submission_grading_status(homework_submission_id, "grading_failed")

            student_name = student.get("name", "학생") if student else "학생"
            await create_notification({
                "teacher_id": teacher_id,
                "type": "grading_failed",
                "title": "채점 실패 - 확인 필요",
                "message": f"{student_name} 숙제 채점 실패: {str(e)[:100]}. 원본 파일을 확인해주세요.",
                "data": {"result_id": result_id, "student_id": student_id, "error": error_msg[:200]},
                "read": False,
            })
        except Exception as db_err:
            logger.error(f"[FATAL] 실패 상태 DB 업데이트도 실패: {db_err}")


async def _execute_grading(
    *,
    result_id: int,
    student: dict,
    student_id: int,
    teacher_id: str,
    central_token: str,
    answer_key: dict | None,
    answer_key_id: int | None,
    image_bytes_list: list[bytes],
    mode: str,
    homework_submission_id: int | None,
) -> dict:
    all_items = []
    central_graded_urls = []
    central_graded_ids = []
    total_correct = total_wrong = total_uncertain = total_questions = 0
    total_score = max_score = 0
    total_unanswered = 0
    page_info_parts = []
    total_images = len(image_bytes_list)

    if not answer_key:
        logger.warning(f"배정된 교재 없음 (student: {student_id}) → 확인 요청 상태로 전환")
        now = datetime.now()
        date_label = f"{now.year}년 {now.month}월 {now.day}일"
        folder_date = f"{date_label} {student['name']}"
        for idx, img_bytes in enumerate(image_bytes_list):
            filename = f"{date_label} {student['name']} 원본_{idx+1}.jpg"
            sub_path = [folder_date]
            uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, img_bytes
            )
            central_graded_urls.append(uploaded["url"])
            central_graded_ids.append(uploaded["id"])

        await update_grading_result(result_id, {
            "status": "review_needed",
            "error_message": "배정된 교재가 없습니다. 교재를 배정한 후 재채점해주세요.",
            "central_graded_drive_ids": central_graded_ids,
            "central_graded_image_urls": central_graded_urls,
        })
        if homework_submission_id:
            await update_submission_grading_status(homework_submission_id, "graded")

        await create_notification({
            "teacher_id": teacher_id,
            "type": "grading_review",
            "title": "확인 필요 - 교재 미배정",
            "message": f"{student.get('name', '학생')} 숙제: 배정된 교재가 없어 채점할 수 없습니다.",
            "data": {"result_id": result_id, "student_id": student_id},
            "read": False,
        })
        update_progress(result_id, "done", total_images, total_images, "확인 요청")
        return {"result_id": result_id, "status": "review_needed"}

    update_progress(result_id, "preprocess", 0, total_images, "이미지 전처리 중...")
    logger.info(f"[Preprocess] {total_images}장 이미지 전처리 시작")
    image_bytes_list = preprocess_batch(image_bytes_list)

    expected_questions = sorted(
        (answer_key.get("answers_json") or {}).keys(),
        key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
    )
    question_types = answer_key.get("question_types_json") or None

    update_progress(result_id, "ocr", 1, 4, f"GPT-4o OCR 처리 중 ({total_images}장)...")
    logger.info(f"[OCR] GPT-4o 배치 OCR 시작: {total_images}장"
                f"{f', 유형 힌트 {len(question_types)}문제' if question_types else ''}")
    gpt4o_results = await ocr_gpt4o_batch(
        image_bytes_list,
        expected_questions=expected_questions,
        question_types=question_types,
    )

    update_progress(result_id, "cross_validate", 2, 4, "Gemini 크로스 검증 중...")
    ocr_results = await cross_validate_ocr(
        image_bytes_list, gpt4o_results,
        expected_questions=expected_questions,
        question_types=question_types,
    )

    update_progress(result_id, "grading", 0, total_images, "채점 시작...")
    solution_only_count = 0
    graded_questions = set()

    for idx, img_bytes in enumerate(image_bytes_list):
        update_progress(result_id, "grading", idx + 1, total_images,
                        f"이미지 {idx+1}/{total_images} 채점 중...")

        ocr_data = ocr_results[idx] if idx < len(ocr_results) else None
        is_solution_only = (ocr_data or {}).get("page_type") == "solution_only"
        ocr_answers = (ocr_data or {}).get("answers", {})
        logger.info(f"[Grade] 이미지 {idx+1}/{total_images}: page_type={ocr_data.get('page_type', '?') if ocr_data else 'None'}, "
                    f"인식문제={len(ocr_answers)}개, 문제번호={list(ocr_answers.keys())[:10]}")

        if is_solution_only:
            solution_only_count += 1
            logger.info(f"[Grade] 이미지 {idx+1}: 풀이 노트 → 원본 저장")
            page_info_parts.append(f"풀이노트 {solution_only_count}")

            now = datetime.now()
            date_label = f"{now.year}년 {now.month}월 {now.day}일"
            filename = f"{date_label} {student['name']} 풀이_{idx+1}.jpg"
            sub_path = [f"{date_label} {student['name']}"]
            central_uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, img_bytes
            )
            central_graded_urls.append(central_uploaded["url"])
            central_graded_ids.append(central_uploaded["id"])
            continue

        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        grade_result = await grade_submission(
            img_bytes, answers_json, types_json,
            ocr_result=ocr_data,
            skip_questions=graded_questions if graded_questions else None,
        )

        newly_graded = grade_result.get("graded_questions", set())
        if newly_graded:
            graded_questions.update(newly_graded)

        ak_title = answer_key.get("title", "")
        ocr_page = grade_result.get("textbook_info", {}).get("page", "")
        if ak_title:
            pi = ak_title
            if ocr_page:
                pi += f" p.{ocr_page}"
            page_info_parts.append(pi)
        elif grade_result.get("page_info"):
            page_info_parts.append(grade_result["page_info"])

        graded_img = create_graded_image(
            img_bytes, grade_result["items"],
            grade_result["total_score"], grade_result["max_score"]
        )

        now = datetime.now()
        date_label = f"{now.year}년 {now.month}월 {now.day}일"
        filename = f"{date_label} {student['name']} 채점_{idx+1}.jpg"
        sub_path = [f"{date_label} {student['name']}"]

        central_uploaded = upload_to_central(
            central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, graded_img
        )
        central_graded_urls.append(central_uploaded["url"])
        central_graded_ids.append(central_uploaded["id"])

        db_fields = {
            "result_id", "question_number", "question_label", "question_type",
            "student_answer", "correct_answer", "is_correct",
            "confidence", "ocr1_answer", "ocr2_answer",
            "ai_score", "ai_max_score", "ai_feedback",
            "position_x", "position_y",
        }
        for item in grade_result["items"]:
            item["result_id"] = result_id
            db_item = {k: v for k, v in item.items() if k in db_fields}
            all_items.append(db_item)

        total_correct += grade_result["correct_count"]
        total_wrong += grade_result["wrong_count"]
        total_uncertain += grade_result["uncertain_count"]
        total_unanswered += grade_result.get("unanswered_count", 0)
        total_questions += grade_result["total_questions"]
        total_score += grade_result["total_score"]
        max_score += grade_result["max_score"]

    update_progress(result_id, "saving", total_images, total_images, "결과 저장 중...")
    if all_items:
        await create_grading_items(all_items)

    combined_page_info = " / ".join(page_info_parts) if page_info_parts else ""
    status = "confirmed" if total_uncertain == 0 else "review_needed"
    await update_grading_result(result_id, {
        "answer_key_id": answer_key_id,
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "unanswered_count": total_unanswered,
        "total_questions": total_questions,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "status": status,
        "page_info": combined_page_info,
        "central_graded_drive_ids": central_graded_ids,
        "central_graded_image_urls": central_graded_urls,
    })

    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "graded")

    try:
        student_name = student.get("name", "학생")
        score_text = f"{round(total_score, 1)}/{round(max_score, 1)}점" if max_score > 0 else ""
        notif_message = f"{student_name} 숙제 채점 완료"
        if combined_page_info:
            notif_message += f" ({combined_page_info})"
        if score_text:
            notif_message += f" - {score_text}"
        if status == "review_needed":
            notif_message += " [검토 필요]"

        await create_notification({
            "teacher_id": teacher_id,
            "type": "grading_complete",
            "title": "채점 완료",
            "message": notif_message,
            "data": {"result_id": result_id, "student_id": student_id, "status": status},
            "read": False,
        })
    except Exception as notif_err:
        logger.warning(f"채점 완료 알림 생성 실패 (무시): {notif_err}")

    update_progress(result_id, "done", total_images, total_images, "채점 완료")

    return {
        "result_id": result_id,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "unanswered_count": total_unanswered,
        "total_questions": total_questions,
        "status": status,
        "page_info": combined_page_info,
        "graded_images": central_graded_urls,
    }
