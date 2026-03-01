"""채점 결과/문항 관리 라우터"""
import io
import logging
import zipfile
from typing import Any
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token, get_answer_key,
    get_grading_results_by_teacher, get_grading_results_by_student,
    update_grading_result, get_student, update_submission_grading_status,
)
from integrations.drive import delete_file
from progress import clear_old_progress, get_progress, get_all_active

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["results"])

ALLOWED_ITEM_UPDATE_FIELDS = {
    "is_correct",
    "correct_answer",
    "student_answer",
    "question_type",
    "error_type",
    "ai_feedback",
    "ai_confidence",
    "ai_score",
    "ai_max_score",
}

ALLOWED_QUESTION_TYPES = {"mc", "short", "essay", "multiple_choice"}
ALLOWED_FEEDBACK_ERROR_TYPES = {
    "false_unanswered",
    "false_answered",
    "mc_2_5_confusion",
    "mc_wrong_number",
    "ocr_misread",
}


def _normalize_item_update_payload(body: dict[str, Any]) -> dict[str, Any]:
    """문항 수정 API 입력을 허용 필드/타입 기준으로 정제."""
    safe: dict[str, Any] = {}

    for key, value in body.items():
        if key not in ALLOWED_ITEM_UPDATE_FIELDS:
            continue

        if key == "is_correct":
            if value in (True, False, None):
                safe[key] = value
            continue

        if key in {"ai_score", "ai_max_score", "ai_confidence"}:
            if value is None or value == "":
                continue
            try:
                num = float(value)
            except (TypeError, ValueError):
                continue
            # 점수/신뢰도 음수 입력 방지
            if num < 0:
                continue
            safe[key] = num
            continue

        if key == "question_type":
            if isinstance(value, str) and value in ALLOWED_QUESTION_TYPES:
                safe[key] = value
            continue

        if isinstance(value, str):
            safe[key] = value[:2000]
        elif value is None:
            safe[key] = value

    return safe


def _to_positive_int(value: Any) -> int | None:
    """양의 정수 변환 실패 시 None 반환."""
    if value in (None, ""):
        return None
    try:
        iv = int(value)
    except (TypeError, ValueError):
        return None
    return iv if iv > 0 else None


def _safe_text(value: Any, max_len: int = 2000) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()[:max_len]
    return str(value).strip()[:max_len]


# ---- 채점 진행률 ----

@router.get("/grading-progress/{result_id}")
async def get_grading_progress(result_id: int):
    clear_old_progress()
    progress = get_progress(result_id)
    if progress:
        return {"success": True, "data": progress}
    return {"success": True, "data": {"result_id": result_id, "stage": "unknown", "percent": 0}}


@router.get("/grading-progress")
async def get_all_grading_progress(teacher_id: str = ""):
    clear_old_progress()
    active = get_all_active()
    return {"success": True, "data": active}


# ---- 채점 결과 ----

@router.get("/results")
async def list_results(teacher_id: str, status: str = ""):
    try:
        sb = get_supabase()
        query = sb.table("grading_results").select("*").eq("teacher_id", teacher_id)
        if status and status != "all":
            query = query.eq("status", status)
        res = await run_query(query.order("created_at", desc=True).execute)
        results = res.data or []
        student_ids = list(set(r.get("student_id") for r in results if r.get("student_id")))
        student_map = {}
        if student_ids:
            s_res = await run_query(sb.table("students").select("id, name, grade, school").in_("id", student_ids).execute)
            for s in (s_res.data or []):
                student_map[s["id"]] = s
        for r in results:
            r["students"] = student_map.get(r.get("student_id"), {})
        return {"data": results}
    except Exception as e:
        logger.error(f"결과 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"결과 조회 실패: {str(e)[:200]}")


@router.put("/results/{result_id}/confirm")
async def confirm_result(result_id: int):
    try:
        sb = get_supabase()
        res = await run_query(sb.table("grading_results").update({"status": "confirmed"}).eq("id", result_id).execute)
        return {"data": res.data}
    except Exception as e:
        logger.error(f"결과 확정 실패: {e}")
        raise HTTPException(status_code=500, detail=f"결과 확정 실패: {str(e)[:200]}")


@router.delete("/results/{result_id}")
async def delete_result(result_id: int):
    try:
        sb = get_supabase()
        row = await run_query(sb.table("grading_results").select(
            "central_graded_drive_ids, central_original_drive_ids"
        ).eq("id", result_id).limit(1).execute)

        if row.data:
            central_token = await get_central_admin_token()
            if central_token:
                drive_ids = []
                drive_ids.extend(row.data[0].get("central_graded_drive_ids") or [])
                drive_ids.extend(row.data[0].get("central_original_drive_ids") or [])
                deleted = 0
                for fid in drive_ids:
                    if fid and delete_file(central_token, fid):
                        deleted += 1
                if deleted:
                    logger.info(f"[Delete] result #{result_id}: Drive 파일 {deleted}개 삭제")

        await run_query(sb.table("grading_items").delete().eq("result_id", result_id).execute)
        res = await run_query(sb.table("grading_results").delete().eq("id", result_id).execute)
        if res.data:
            logger.info(f"채점 결과 #{result_id} 삭제 완료")
            return {"success": True, "message": "채점 결과가 삭제되었습니다"}
        return {"success": False, "message": "삭제할 결과를 찾을 수 없습니다"}
    except Exception as e:
        logger.error(f"채점 결과 삭제 실패 (id={result_id}): {e}")
        raise HTTPException(status_code=500, detail=f"채점 결과 삭제 실패: {str(e)[:200]}")


@router.put("/results/{result_id}/annotations")
async def save_annotations(result_id: int, request: Request):
    ALLOWED_FIELDS = {"teacher_annotations", "teacher_memo", "updated_at"}
    try:
        body = await request.json()
        safe_body = {k: v for k, v in body.items() if k in ALLOWED_FIELDS}
        if not safe_body:
            return {"data": None, "message": "허용되지 않는 필드입니다"}
        safe_body["updated_at"] = datetime.now(timezone.utc).isoformat()
        sb = get_supabase()
        res = await run_query(sb.table("grading_results").update(safe_body).eq("id", result_id).execute)
        return {"data": res.data}
    except Exception as e:
        logger.error(f"메모 저장 실패: {e}")
        raise HTTPException(status_code=500, detail=f"메모 저장 실패: {str(e)[:200]}")


@router.get("/results/student/{student_id}")
async def list_student_results(student_id: int):
    results = await get_grading_results_by_student(student_id)
    return {"data": results}


# ---- 문항 ----

@router.get("/results/{result_id}/items")
async def list_result_items(result_id: int):
    try:
        sb = get_supabase()
        res = await run_query(sb.table("grading_items").select("*").eq("result_id", result_id).order("question_number").execute)
        return {"data": res.data or []}
    except Exception as e:
        logger.error(f"문항 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"문항 조회 실패: {str(e)[:200]}")


@router.put("/items/{item_id}")
async def update_item(item_id: int, request: Request):
    try:
        body = await request.json()
        safe_body = _normalize_item_update_payload(body)
        if not safe_body:
            raise HTTPException(status_code=400, detail="수정 가능한 필드가 없습니다")

        sb = get_supabase()
        res = await run_query(sb.table("grading_items").update(safe_body).eq("id", item_id).execute)
        updated_item = res.data[0] if res.data else None
        if updated_item and updated_item.get("result_id"):
            await _recalculate_result_totals(updated_item["result_id"])
        return {"data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"문항 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=f"문항 수정 실패: {str(e)[:200]}")


async def _recalculate_result_totals(result_id: int):
    """채점 결과의 문항별 데이터를 기반으로 총점/정답수 재계산"""
    try:
        sb = get_supabase()
        items_res = await run_query(sb.table("grading_items").select("*").eq("result_id", result_id).execute)
        items = items_res.data or []
        if not items:
            return

        correct = wrong = uncertain = unanswered = 0
        essay_total = essay_earned = 0.0
        mc_questions = 0

        for item in items:
            q_type = item.get("question_type", "multiple_choice")
            if q_type == "essay":
                ai_max = float(item.get("ai_max_score") or 0)
                essay_total += ai_max if ai_max > 0 else 10
            else:
                mc_questions += 1

        mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0

        for item in items:
            q_type = item.get("question_type", "multiple_choice")
            is_correct = item.get("is_correct")
            student_answer = item.get("student_answer", "")
            is_unanswered = student_answer == "(미풀이)" or (
                is_correct is None and item.get("ai_feedback") == "학생이 풀지 않은 문제"
            )

            if q_type == "essay":
                essay_earned += float(item.get("ai_score") or 0)
                if is_correct is True:
                    correct += 1
                elif is_correct is False:
                    wrong += 1
                elif is_unanswered:
                    unanswered += 1
                else:
                    uncertain += 1
            else:
                if is_unanswered:
                    unanswered += 1
                elif is_correct is True:
                    correct += 1
                elif is_correct is False:
                    wrong += 1
                elif is_correct is None:
                    uncertain += 1

        mc_earned = sum(
            mc_per_score for item in items
            if item.get("question_type", "multiple_choice") != "essay"
            and item.get("is_correct") is True
        )
        total_score = round(mc_earned + essay_earned, 1)
        status = "confirmed" if uncertain == 0 else "review_needed"

        await update_grading_result(result_id, {
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_questions": len(items),
            "total_score": total_score,
            "max_score": 100.0,
            "status": status,
        })
        logger.info(f"[Recalc] result #{result_id} 재계산 완료: "
                     f"{correct}맞/{wrong}틀/{uncertain}보류/{unanswered}미풀이, "
                     f"점수 {total_score}/100.0")
    except Exception as e:
        logger.error(f"[Recalc] result #{result_id} 재계산 실패: {e}")


# ---- 재채점 ----

@router.post("/results/{result_id}/regrade")
async def regrade_result(result_id: int, request: Request, background_tasks: BackgroundTasks):
    """기존 채점 결과를 정답지 기준으로 재채점. 문항이 없으면 전체 재채점 실행."""
    try:
        body: dict[str, Any] = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()

        sb = get_supabase()
        res = await run_query(sb.table("grading_results").select("*").eq("id", result_id).limit(1).execute)
        if not res.data:
            raise HTTPException(404, "채점 결과를 찾을 수 없습니다")
        result = res.data[0]

        new_key_id = _to_positive_int(body.get("answer_key_id"))
        if body.get("answer_key_id") not in (None, "") and new_key_id is None:
            raise HTTPException(400, "answer_key_id는 양의 정수여야 합니다")
        if new_key_id:
            await update_grading_result(result_id, {"answer_key_id": new_key_id})
            answer_key_id = new_key_id
            logger.info(f"[Regrade] result #{result_id}: 교재 변경 → key #{new_key_id}")
        else:
            answer_key_id = result.get("answer_key_id")

        if not answer_key_id:
            raise HTTPException(400, "정답지가 연결되지 않은 결과입니다")

        answer_key = await get_answer_key(answer_key_id)
        if not answer_key:
            raise HTTPException(404, "정답지를 찾을 수 없습니다")

        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        items_res = await run_query(sb.table("grading_items").select("*").eq("result_id", result_id).order("question_number").execute)
        old_items = items_res.data or []

        if not old_items:
            return await _full_regrade_from_submission(
                result, result_id, answer_key_id, background_tasks
            )

        await update_grading_result(result_id, {"status": "regrading"})

        correct = wrong = uncertain = unanswered = regraded_count = 0
        essay_total = essay_earned = 0.0
        mc_questions = 0

        from grading.grader import compare_answers

        for item in old_items:
            q_label = item.get("question_label") or str(item.get("question_number", ""))
            q_type = types_json.get(q_label, item.get("question_type", "mc"))
            if q_type == "essay":
                essay_total += float(item.get("ai_max_score") or 10)
            else:
                mc_questions += 1

        mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0

        for item in old_items:
            q_label = item.get("question_label") or str(item.get("question_number", ""))
            student_answer = item.get("student_answer", "")
            correct_answer = answers_json.get(q_label, item.get("correct_answer", ""))
            q_type = types_json.get(q_label, item.get("question_type", "mc"))

            update_data = {"correct_answer": correct_answer}
            is_unanswered = student_answer == "(미풀이)" or not student_answer

            if q_type in ("mc", "short"):
                if is_unanswered:
                    update_data["is_correct"] = None
                    update_data["student_answer"] = "(미풀이)" if not student_answer else student_answer
                    unanswered += 1
                else:
                    match_result = compare_answers(student_answer, correct_answer, q_type)
                    r = match_result["result"]
                    update_data["error_type"] = match_result["error_type"]
                    if r == "correct":
                        update_data["is_correct"] = True
                        correct += 1
                    elif r == "wrong":
                        update_data["is_correct"] = False
                        wrong += 1
                    else:
                        update_data["is_correct"] = None
                        update_data["error_type"] = None
                        uncertain += 1
            elif q_type == "essay":
                essay_earned += float(item.get("ai_score") or 0)

            await run_query(sb.table("grading_items").update(update_data).eq("id", item["id"]).execute)
            regraded_count += 1

        total_score = round(correct * mc_per_score + essay_earned, 1)
        status = "confirmed" if uncertain == 0 else "review_needed"

        await update_grading_result(result_id, {
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_questions": len(old_items),
            "total_score": total_score,
            "max_score": 100.0,
            "status": status,
        })

        logger.info(f"[Regrade] result #{result_id}: {regraded_count}문항 재채점 완료 "
                     f"→ {correct}맞/{wrong}틀/{uncertain}보류/{unanswered}미풀이")

        return {
            "result_id": result_id,
            "regraded_count": regraded_count,
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_score": total_score,
            "max_score": 100.0,
            "status": status,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Regrade] result #{result_id} 재채점 실패: {e}", exc_info=True)
        raise HTTPException(500, f"재채점 실패: {str(e)[:200]}")


async def _full_regrade_from_submission(
    result: dict, result_id: int, answer_key_id: int, background_tasks: BackgroundTasks,
):
    """문항 데이터가 없을 때 원본 제출물을 다시 다운로드하여 전체 채점을 재실행"""
    from integrations.supabase_client import get_central_admin_token
    from integrations.drive import download_file_central
    from file_utils import extract_images_from_zip
    from routers.grading import _run_grading_background

    submission_id = result.get("homework_submission_id")
    if not submission_id:
        raise HTTPException(400, "원본 제출 정보가 없어 전체 재채점이 불가합니다. 숙제를 다시 제출해주세요.")

    sb = get_supabase()
    sub_res = await run_query(
        sb.table("homework_submissions").select("*").eq("id", submission_id).limit(1).execute
    )
    if not sub_res.data:
        raise HTTPException(404, "원본 숙제 제출을 찾을 수 없습니다. 숙제를 다시 제출해주세요.")
    submission = sub_res.data[0]

    zip_drive_id = submission.get("zip_drive_id") or submission.get("drive_file_id") or ""
    if not zip_drive_id:
        raise HTTPException(400, "원본 파일 정보가 없습니다. 숙제를 다시 제출해주세요.")

    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    try:
        zip_data = download_file_central(central_token, zip_drive_id)
    except Exception as e:
        logger.error(f"[FullRegrade] Drive 다운로드 실패 (file_id={zip_drive_id}): {e}")
        raise HTTPException(502, f"Drive 원본 다운로드 실패: {str(e)[:200]}")

    if not zip_data:
        raise HTTPException(400, "원본 ZIP이 비어 있습니다. 숙제를 다시 제출해주세요.")

    try:
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            entries = [name for name in zf.namelist() if not name.endswith("/")]
            if not entries:
                raise HTTPException(400, "원본 ZIP에 파일이 없습니다. 숙제를 다시 제출해주세요.")
            broken_name = zf.testzip()
            if broken_name:
                raise HTTPException(
                    400,
                    f"원본 ZIP이 손상되었습니다(오류 파일: {broken_name}). 숙제를 다시 제출해주세요.",
                )
    except HTTPException:
        raise
    except zipfile.BadZipFile:
        raise HTTPException(400, "원본 파일이 ZIP 형식이 아닙니다. ZIP으로 다시 제출해주세요.")
    except Exception as e:
        logger.error(f"[FullRegrade] ZIP 구조 검사 실패 (file_id={zip_drive_id}): {e}")
        raise HTTPException(500, f"원본 ZIP 검사 실패: {str(e)[:200]}")

    try:
        image_bytes_list = extract_images_from_zip(zip_data)
    except Exception as e:
        logger.error(f"[FullRegrade] ZIP 이미지 추출 중 예외 발생 (file_id={zip_drive_id}): {e}")
        raise HTTPException(500, f"원본 ZIP 이미지 추출 실패: {str(e)[:200]}")

    if not image_bytes_list:
        raise HTTPException(
            400,
            "원본 ZIP에서 채점 가능한 이미지(JPG/PNG/HEIC/PDF)를 찾지 못했습니다.",
        )

    student_id = result.get("student_id")
    teacher_id = result.get("teacher_id", "")
    student = await get_student(student_id) if student_id else {}

    # 기존 결과를 grading 상태로 리셋
    await update_grading_result(result_id, {
        "status": "grading",
        "answer_key_id": answer_key_id,
        "error_message": None,
        "correct_count": 0, "wrong_count": 0,
        "uncertain_count": 0, "unanswered_count": 0,
        "total_questions": 0, "total_score": 0, "max_score": 0,
        "central_graded_drive_ids": [], "central_graded_image_urls": [],
    })
    # 기존 items 삭제 (혹시 남아있을 수 있음)
    await run_query(sb.table("grading_items").delete().eq("result_id", result_id).execute)

    if submission_id:
        await update_submission_grading_status(submission_id, "grading")

    answer_key = await get_answer_key(answer_key_id)

    background_tasks.add_task(
        _run_grading_background,
        result_id=result_id,
        student=student or {},
        student_id=student_id or 0,
        teacher_id=teacher_id,
        central_token=central_token,
        answer_key=answer_key,
        answer_key_id=answer_key_id,
        image_bytes_list=image_bytes_list,
        mode=result.get("mode", "assigned"),
        homework_submission_id=submission_id,
    )

    logger.info(f"[FullRegrade] result #{result_id}: 전체 재채점 시작 (이미지 {len(image_bytes_list)}장)")
    return {
        "result_id": result_id,
        "status": "grading",
        "message": "문항 데이터가 없어 전체 재채점을 시작합니다. 잠시 후 결과가 업데이트됩니다.",
        "full_regrade": True,
    }


# ---- AI 피드백 (선생님 수정 → AI 학습) ----

@router.post("/feedback")
async def save_feedback(request: Request):
    """선생님이 AI 채점 결과를 수정한 내용을 피드백으로 저장"""
    try:
        body = await request.json()
        result_id = _to_positive_int(body.get("result_id"))
        item_id = _to_positive_int(body.get("item_id"))
        question_number = _to_positive_int(body.get("question_number"))
        question_type = _safe_text(body.get("question_type", "multiple_choice"), 32)
        if question_type not in ALLOWED_QUESTION_TYPES:
            question_type = "multiple_choice"

        if not result_id or not item_id or not question_number:
            raise HTTPException(400, "result_id, item_id, question_number는 양의 정수여야 합니다")

        ai_answer = _safe_text(body.get("ai_answer", ""), 2000)
        teacher_answer = _safe_text(body.get("teacher_corrected_answer", ""), 2000)

        if not teacher_answer or ai_answer == teacher_answer:
            return {"saved": False, "reason": "no_change"}

        manual_type = _safe_text(body.get("manual_error_type", ""), 64)
        if manual_type:
            error_type = manual_type if manual_type in ALLOWED_FEEDBACK_ERROR_TYPES else "ocr_misread"
        else:
            error_type = _classify_error(
                ai_answer, teacher_answer,
                question_type,
            )

        teacher_id = _safe_text(body.get("teacher_id", ""), 128)
        if not teacher_id:
            teacher_id = _safe_text(request.headers.get("x-teacher-id"), 128)

        sb = get_supabase()
        insert_data = {
            "result_id": result_id,
            "item_id": item_id,
            "question_number": question_number,
            "question_type": question_type,
            "ai_answer": ai_answer,
            "correct_answer": _safe_text(body.get("correct_answer", ""), 2000),
            "teacher_corrected_answer": teacher_answer,
            "error_type": error_type,
        }
        if teacher_id:
            insert_data["teacher_id"] = teacher_id

        res = await run_query(sb.table("grading_feedback").insert(insert_data).execute)
        logger.info(
            f"[Feedback] 저장: Q{question_number} "
            f"'{ai_answer}' → '{teacher_answer}' (error_type={error_type})"
        )
        return {"saved": True, "error_type": error_type, "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"[Feedback] 저장 실패 (무시): {e}")
        return {"saved": False, "error": str(e)[:200]}


@router.get("/feedback/patterns")
async def get_feedback_patterns(limit: int = 50):
    """최근 피드백 패턴 조회 (에이전트 프롬프트용)"""
    try:
        sb = get_supabase()
        res = await run_query(
            sb.table("grading_feedback")
            .select("question_type,ai_answer,teacher_corrected_answer,error_type,correct_answer")
            .order("created_at", desc=True)
            .limit(limit)
            .execute
        )
        patterns = res.data or []

        summary = {}
        for p in patterns:
            et = p.get("error_type", "unknown")
            summary[et] = summary.get(et, 0) + 1

        return {"patterns": patterns, "summary": summary, "total": len(patterns)}
    except Exception as e:
        logger.warning(f"[Feedback] 패턴 조회 실패: {e}")
        return {"patterns": [], "summary": {}, "total": 0}


def _classify_error(ai_answer: str, teacher_answer: str, question_type: str) -> str:
    """오류 유형 자동 분류"""
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}

    if ai_answer == "unanswered" or ai_answer == "(미풀이)":
        return "false_unanswered"

    if teacher_answer == "unanswered" or teacher_answer == "(미풀이)":
        return "false_answered"

    if question_type == "multiple_choice":
        a = ai_answer
        t = teacher_answer
        for k, v in circle_map.items():
            a = a.replace(k, v)
            t = t.replace(k, v)
        pair = tuple(sorted([a.strip(), t.strip()]))
        if pair == ("2", "5") or pair == ("②", "⑤"):
            return "mc_2_5_confusion"
        return "mc_wrong_number"

    return "ocr_misread"
