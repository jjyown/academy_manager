"""채점 실행 라우터 (핵심 API)"""
import logging
import re
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from config import CENTRAL_GRADED_RESULT_FOLDER, USE_GRADING_AGENT
from progress import update_progress
from file_utils import extract_images_from_zip
from ocr.engines import ocr_gemini, cross_validate_ocr
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

    now = datetime.now()
    student_name = student.get("name", "학생")
    result_sub_path = [f"{now.year}년", f"{now.month}월", f"{now.day}일", student_name]

    if not answer_key:
        logger.warning(f"배정된 교재 없음 (student: {student_id}) → 확인 요청 상태로 전환")
        for idx, img_bytes in enumerate(image_bytes_list):
            filename = f"원본_{idx+1}.jpg"
            uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, result_sub_path, filename, img_bytes
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

    import asyncio

    total_ocr_steps = 5 if USE_GRADING_AGENT else 4
    update_progress(result_id, "ocr", 1, total_ocr_steps, f"Gemini OCR 1차 처리 중 ({total_images}장)...")
    logger.info(f"[OCR] Gemini 2.5 Flash 더블체크 시작: {total_images}장"
                f"{f', 유형 힌트 {len(question_types)}문제' if question_types else ''}")
    ocr1_tasks = [
        ocr_gemini(img, expected_questions=expected_questions, question_types=question_types)
        for img in image_bytes_list
    ]
    ocr1_results = await asyncio.gather(*ocr1_tasks, return_exceptions=True)
    ocr1_results = [
        r if not isinstance(r, Exception) else {"textbook_info": {}, "answers": {}}
        for r in ocr1_results
    ]

    update_progress(result_id, "cross_validate", 2, total_ocr_steps, "Gemini 2차 검증 중...")
    ocr_results = await cross_validate_ocr(
        image_bytes_list, ocr1_results,
        expected_questions=expected_questions,
        question_types=question_types,
    )

    # ── AI 에이전트: 개별 문제 집중 검증 (3단계) ──
    if USE_GRADING_AGENT:
        try:
            from ocr.agent import agent_verify_ocr
            update_progress(result_id, "agent_verify", 3, 5, "AI 에이전트 개별 문제 검증 중...")
            ocr_results = await agent_verify_ocr(
                image_bytes_list, ocr_results,
                expected_questions=expected_questions,
                question_types=question_types,
            )
            logger.info("[Agent] 에이전트 검증 완료")
        except Exception as e:
            logger.warning(f"[Agent] 에이전트 검증 실패, 기존 결과 사용: {e}")

    # ── OCR 기반 교재 재검증 (여러 교재 배정 시 오매칭 방지) ──
    # 조건: 학생에게 교재가 2개 이상 + OCR에서 교재 정보 감지된 경우만
    try:
        book_keys = await get_student_book_keys(student_id)
        if book_keys and len(book_keys) > 1:
            ocr_textbook_names = []
            for r in (ocr1_results or []):
                tb_name = (r.get("textbook_info") or {}).get("name", "")
                if tb_name:
                    ocr_textbook_names.append(tb_name)

            if ocr_textbook_names:
                detected_name = ocr_textbook_names[0].lower().strip()
                current_title = (answer_key.get("title") or "").lower().strip()

                # 현재 선택된 교재와 OCR 감지 교재명이 다르면 재매칭 시도
                if detected_name and current_title and detected_name not in current_title and current_title not in detected_name:
                    # 1차: 간단한 제목 포함 매칭 (AI 호출 없음, 비용 0)
                    title_matched = None
                    for bk in book_keys:
                        bk_title = (bk.get("title") or "").lower().strip()
                        if detected_name in bk_title or bk_title in detected_name:
                            title_matched = bk
                            break

                    if title_matched and title_matched.get("id") != answer_key_id:
                        better_key = await get_answer_key(title_matched["id"])
                        if better_key:
                            logger.info(
                                f"[AutoMatch] 교재 재매칭: '{answer_key.get('title')}' → "
                                f"'{better_key.get('title')}' (OCR 감지: '{ocr_textbook_names[0]}')"
                            )
                            answer_key = better_key
                            answer_key_id = better_key["id"]
                            expected_questions = sorted(
                                (answer_key.get("answers_json") or {}).keys(),
                                key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
                            )
                            question_types = answer_key.get("question_types_json") or None
                    elif not title_matched:
                        # 2차: AI 매칭 (제목 매칭 실패 시 — Gemini Flash 1회 호출)
                        from integrations.gemini import match_answer_key
                        combined_text = " ".join(ocr_textbook_names)
                        better_id = await match_answer_key(combined_text, book_keys)
                        if better_id and better_id != answer_key_id:
                            better_key = await get_answer_key(better_id)
                            if better_key:
                                logger.info(
                                    f"[AutoMatch-AI] 교재 재매칭: '{answer_key.get('title')}' → "
                                    f"'{better_key.get('title')}' (AI 매칭)"
                                )
                                answer_key = better_key
                                answer_key_id = better_key["id"]
                                expected_questions = sorted(
                                    (answer_key.get("answers_json") or {}).keys(),
                                    key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
                                )
                                question_types = answer_key.get("question_types_json") or None
    except Exception as e:
        logger.warning(f"[AutoMatch] 교재 재검증 실패 (무시): {e}")

    update_progress(result_id, "grading", 0, total_images, "채점 시작...")
    solution_only_count = 0
    graded_questions = set()

    # answer_sheet(교재/프린트)를 먼저, solution_only(풀이 노트)를 나중에 처리
    # → 교재에서 정확한 답을 먼저 채점하고, 풀이 노트는 참고/보충용으로 처리
    grading_order = sorted(
        range(len(image_bytes_list)),
        key=lambda i: 0 if (ocr_results[i] or {}).get("page_type") != "solution_only" else 1,
    )
    if grading_order != list(range(len(image_bytes_list))):
        logger.info(f"[Grade] 이미지 순서 재정렬: {grading_order} (answer_sheet 우선)")

    failed_images = []

    for step, idx in enumerate(grading_order):
        img_bytes = image_bytes_list[idx]
        update_progress(result_id, "grading", step + 1, total_images,
                        f"이미지 {step+1}/{total_images} 채점 중...")

        try:
            ocr_data = ocr_results[idx] if idx < len(ocr_results) else None
            is_solution_only = (ocr_data or {}).get("page_type") == "solution_only"
            ocr_answers = (ocr_data or {}).get("answers", {})
            logger.info(f"[Grade] 이미지 {idx+1}/{total_images}: page_type={ocr_data.get('page_type', '?') if ocr_data else 'None'}, "
                        f"인식문제={len(ocr_answers)}개, 문제번호={list(ocr_answers.keys())[:10]}")

            if is_solution_only and not ocr_answers:
                solution_only_count += 1
                logger.info(f"[Grade] 이미지 {idx+1}: 풀이 노트 (답 미인식) → 원본 저장")
                page_info_parts.append(f"풀이노트 {solution_only_count}")

                filename = f"풀이_{idx+1}.jpg"
                central_uploaded = upload_to_central(
                    central_token, CENTRAL_GRADED_RESULT_FOLDER, result_sub_path, filename, img_bytes
                )
                central_graded_urls.append(central_uploaded["url"])
                central_graded_ids.append(central_uploaded["id"])
                continue

            if is_solution_only and ocr_answers:
                logger.info(f"[Grade] 이미지 {idx+1}: 풀이 노트지만 답 {len(ocr_answers)}개 인식 → 채점 진행")

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

            filename = f"채점_{idx+1}.jpg"
            central_uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, result_sub_path, filename, graded_img
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

        except Exception as img_err:
            failed_images.append(idx + 1)
            logger.error(f"[Grade] 이미지 {idx+1}/{total_images} 채점 실패 (계속 진행): {img_err}", exc_info=True)
            page_info_parts.append(f"이미지{idx+1} 실패")
            # 실패한 이미지의 원본이라도 저장 시도
            try:
                filename = f"실패_{idx+1}.jpg"
                fallback = upload_to_central(
                    central_token, CENTRAL_GRADED_RESULT_FOLDER, result_sub_path, filename, img_bytes
                )
                central_graded_urls.append(fallback["url"])
                central_graded_ids.append(fallback["id"])
            except Exception:
                logger.warning(f"[Grade] 실패 이미지 {idx+1} 원본 저장도 실패")

    if failed_images:
        logger.warning(f"[Grade] 총 {len(failed_images)}장 실패: {failed_images}")

    update_progress(result_id, "saving", total_images, total_images, "결과 저장 중...")
    if all_items:
        await create_grading_items(all_items)

    combined_page_info = " / ".join(page_info_parts) if page_info_parts else ""
    # 실패 이미지가 있으면 무조건 review_needed + 에러 메시지 기록
    if failed_images:
        status = "review_needed"
    else:
        status = "confirmed" if total_uncertain == 0 else "review_needed"

    error_message = ""
    if failed_images:
        error_message = f"이미지 {len(failed_images)}장 채점 실패 (이미지 번호: {failed_images}). 나머지는 정상 채점되었습니다."

    update_data = {
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
    }
    if error_message:
        update_data["error_message"] = error_message
    await update_grading_result(result_id, update_data)

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
        if failed_images:
            notif_message += f" [이미지 {len(failed_images)}장 실패]"
        elif status == "review_needed":
            notif_message += " [검토 필요]"

        notif_type = "grading_failed" if failed_images else "grading_complete"
        notif_title = "채점 완료 (일부 실패)" if failed_images else "채점 완료"

        await create_notification({
            "teacher_id": teacher_id,
            "type": notif_type,
            "title": notif_title,
            "message": notif_message,
            "data": {"result_id": result_id, "student_id": student_id, "status": status,
                     "failed_images": failed_images if failed_images else None},
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
