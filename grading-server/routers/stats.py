"""통계 라우터"""
import logging

from fastapi import APIRouter, HTTPException

from integrations.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
async def get_stats(teacher_id: str):
    try:
        sb = get_supabase()
        res = await run_query(sb.table("grading_results").select("*").eq("teacher_id", teacher_id).eq("status", "confirmed").execute)
        results = res.data or []
        student_ids = list(set(r.get("student_id") for r in results if r.get("student_id")))
        student_map = {}
        if student_ids:
            s_res = await run_query(sb.table("students").select("id, name").in_("id", student_ids).execute)
            for s in (s_res.data or []):
                student_map[s["id"]] = s
        for r in results:
            r["students"] = student_map.get(r.get("student_id"), {})
        return {"data": results}
    except Exception as e:
        logger.error(f"통계 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"통계 조회 실패: {str(e)[:200]}")


@router.get("/student/{student_id}")
async def get_student_stats(student_id: int, teacher_id: str = ""):
    try:
        sb = get_supabase()
        query = sb.table("grading_results").select(
            "id, created_at, total_score, max_score, correct_count, wrong_count, "
            "total_questions, status, page_info, answer_key_id, answer_keys(title)"
        ).eq("student_id", student_id).in_(
            "status", ["confirmed", "review_needed"]
        ).order("created_at", desc=False)

        if teacher_id:
            query = query.eq("teacher_id", teacher_id)

        res = await run_query(query.execute)
        results = res.data or []

        trend = []
        for r in results:
            max_s = float(r.get("max_score") or 1)
            total_s = float(r.get("total_score") or 0)
            accuracy = round((total_s / max_s * 100) if max_s > 0 else 0, 1)
            ak = r.get("answer_keys") or {}
            trend.append({
                "result_id": r["id"],
                "date": r.get("created_at", "")[:10],
                "total_score": total_s,
                "max_score": max_s,
                "accuracy": accuracy,
                "correct_count": r.get("correct_count", 0),
                "wrong_count": r.get("wrong_count", 0),
                "total_questions": r.get("total_questions", 0),
                "textbook": ak.get("title", ""),
                "page_info": r.get("page_info", ""),
            })

        if trend:
            avg_accuracy = round(sum(t["accuracy"] for t in trend) / len(trend), 1)
            recent_accuracy = trend[-1]["accuracy"] if trend else 0
            best_accuracy = max(t["accuracy"] for t in trend)
            total_submissions = len(trend)
        else:
            avg_accuracy = recent_accuracy = best_accuracy = 0
            total_submissions = 0

        return {
            "student_id": student_id,
            "summary": {
                "total_submissions": total_submissions,
                "avg_accuracy": avg_accuracy,
                "recent_accuracy": recent_accuracy,
                "best_accuracy": best_accuracy,
            },
            "trend": trend,
        }
    except Exception as e:
        logger.error(f"학생 통계 조회 실패 (student_id={student_id}): {e}")
        raise HTTPException(status_code=500, detail=f"학생 통계 조회 실패: {str(e)[:200]}")


@router.get("/wrong-answers")
async def get_wrong_answer_stats(teacher_id: str, answer_key_id: int = 0):
    try:
        sb = get_supabase()
        query = sb.table("grading_results").select("id").eq("teacher_id", teacher_id).in_(
            "status", ["confirmed", "review_needed"]
        )
        if answer_key_id:
            query = query.eq("answer_key_id", answer_key_id)
        results = await run_query(query.execute)
        result_ids = [r["id"] for r in (results.data or [])]

        if not result_ids:
            return {"data": [], "summary": {}}

        all_items = []
        batch_size = 50
        for i in range(0, len(result_ids), batch_size):
            batch = result_ids[i:i + batch_size]
            items_res = await run_query(sb.table("grading_items").select(
                "question_number, question_label, question_type, is_correct, correct_answer"
            ).in_("result_id", batch).execute)
            all_items.extend(items_res.data or [])

        question_stats = {}
        for item in all_items:
            q_label = item.get("question_label") or str(item.get("question_number", "?"))
            if q_label not in question_stats:
                question_stats[q_label] = {
                    "question": q_label,
                    "correct_answer": item.get("correct_answer", ""),
                    "total": 0, "correct": 0, "wrong": 0, "unanswered": 0,
                }
            stats = question_stats[q_label]
            stats["total"] += 1
            if item.get("is_correct") is True:
                stats["correct"] += 1
            elif item.get("is_correct") is False:
                if not item.get("student_answer"):
                    stats["unanswered"] += 1
                else:
                    stats["wrong"] += 1

        result_data = []
        for q_label, stats in question_stats.items():
            total = stats["total"]
            wrong_rate = round(((stats["wrong"] + stats["unanswered"]) / total * 100) if total > 0 else 0, 1)
            result_data.append({
                "question": q_label,
                "correct_answer": stats["correct_answer"],
                "total_attempts": total,
                "correct_count": stats["correct"],
                "wrong_count": stats["wrong"],
                "unanswered_count": stats["unanswered"],
                "wrong_rate": wrong_rate,
            })

        result_data.sort(key=lambda x: x["wrong_rate"], reverse=True)

        total_items = len(all_items)
        total_correct = sum(1 for i in all_items if i.get("is_correct") is True)
        overall_accuracy = round((total_correct / total_items * 100) if total_items > 0 else 0, 1)

        return {
            "data": result_data,
            "summary": {
                "total_results": len(result_ids),
                "total_items": total_items,
                "overall_accuracy": overall_accuracy,
                "most_missed": result_data[:5] if result_data else [],
            },
        }
    except Exception as e:
        logger.error(f"오답률 통계 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"오답률 통계 조회 실패: {str(e)[:200]}")
