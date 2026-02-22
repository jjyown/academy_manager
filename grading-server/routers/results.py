"""채점 결과/문항 관리 라우터"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token, get_answer_key,
    get_grading_results_by_teacher, get_grading_results_by_student,
    update_grading_result,
)
from integrations.drive import delete_file
from progress import clear_old_progress, get_progress, get_all_active

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["results"])


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
        sb = get_supabase()
        res = await run_query(sb.table("grading_items").update(body).eq("id", item_id).execute)
        updated_item = res.data[0] if res.data else None
        if updated_item and updated_item.get("result_id"):
            await _recalculate_result_totals(updated_item["result_id"])
        return {"data": res.data}
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
async def regrade_result(result_id: int, request: Request):
    """기존 채점 결과를 정답지 기준으로 재채점"""
    try:
        body = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()

        sb = get_supabase()
        res = await run_query(sb.table("grading_results").select("*").eq("id", result_id).limit(1).execute)
        if not res.data:
            raise HTTPException(404, "채점 결과를 찾을 수 없습니다")
        result = res.data[0]

        new_key_id = body.get("answer_key_id")
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
            raise HTTPException(400, "재채점할 문항이 없습니다")

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


# ---- AI 피드백 (선생님 수정 → AI 학습) ----

@router.post("/feedback")
async def save_feedback(request: Request):
    """선생님이 AI 채점 결과를 수정한 내용을 피드백으로 저장"""
    try:
        body = await request.json()
        ai_answer = body.get("ai_answer", "")
        teacher_answer = body.get("teacher_corrected_answer", "")

        if not teacher_answer or ai_answer == teacher_answer:
            return {"saved": False, "reason": "no_change"}

        manual_type = body.get("manual_error_type")
        if manual_type:
            error_type = manual_type
        else:
            error_type = _classify_error(
                ai_answer, teacher_answer,
                body.get("question_type", "multiple_choice"),
            )

        teacher_id = body.get("teacher_id")
        if not teacher_id:
            teacher_id = request.headers.get("x-teacher-id")

        sb = get_supabase()
        insert_data = {
            "result_id": body.get("result_id"),
            "item_id": body.get("item_id"),
            "question_number": body.get("question_number"),
            "question_type": body.get("question_type", "multiple_choice"),
            "ai_answer": ai_answer,
            "correct_answer": body.get("correct_answer", ""),
            "teacher_corrected_answer": teacher_answer,
            "error_type": error_type,
        }
        if teacher_id:
            insert_data["teacher_id"] = teacher_id

        res = await run_query(sb.table("grading_feedback").insert(insert_data).execute)
        logger.info(
            f"[Feedback] 저장: Q{body.get('question_number')} "
            f"'{ai_answer}' → '{teacher_answer}' (error_type={error_type})"
        )
        return {"saved": True, "error_type": error_type, "data": res.data}
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
