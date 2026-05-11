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


@router.get("/student/{student_id}/weakness-report")
async def get_weakness_report(student_id: int, teacher_id: str = "", limit_recent: int = 5):
    """학생 취약점 분석 보고서.

    누적 데이터:
      - mistake_category 별 빈도 (오답일 때 풀이 검토 조교가 분류한 실수 유형)
      - process_review_flags 별 빈도 (부호/지수/단위 등 풀이 이슈)
      - 단원별(question_meta_json.topic) 정답률 — 메타 있는 문항만
      - 최근 N개 결과 정답률 추이

    실수 카테고리·플래그 데이터는 0039 마이그레이션 적용 + 풀이 검토 조교 실행 이후
    축적되므로 초기에는 비어있을 수 있다.
    """
    try:
        sb = get_supabase()

        # 1) 학생의 모든 채점 결과 id 모으기 (confirmed + review_needed)
        q = sb.table("grading_results").select(
            "id, answer_key_id, created_at, total_score, max_score, "
            "correct_count, wrong_count, total_questions, status"
        ).eq("student_id", student_id).in_(
            "status", ["confirmed", "review_needed"]
        ).order("created_at", desc=False)
        if teacher_id:
            q = q.eq("teacher_id", teacher_id)
        results_res = await run_query(q.execute)
        results = results_res.data or []
        result_ids = [r["id"] for r in results]
        ak_ids = list({r["answer_key_id"] for r in results if r.get("answer_key_id")})

        # 2) 해당 result_id 들의 grading_items 일괄 조회 (취약점 컬럼 포함)
        all_items: list[dict] = []
        if result_ids:
            batch_size = 50
            for i in range(0, len(result_ids), batch_size):
                batch = result_ids[i:i + batch_size]
                items_res = await run_query(sb.table("grading_items").select(
                    "result_id, question_number, question_label, question_type, "
                    "is_correct, mistake_category, process_review_flags"
                ).in_("result_id", batch).execute)
                all_items.extend(items_res.data or [])

        # 3) answer_keys.question_meta_json 한 번에 조회
        meta_by_key: dict[int, dict] = {}
        if ak_ids:
            ak_res = await run_query(sb.table("answer_keys").select(
                "id, title, question_meta_json"
            ).in_("id", ak_ids).execute)
            for ak in (ak_res.data or []):
                meta_by_key[ak["id"]] = ak.get("question_meta_json") or {}
        ak_by_result = {r["id"]: r.get("answer_key_id") for r in results}

        # 4) 집계
        total_items = len(all_items)
        correct_count = sum(1 for it in all_items if it.get("is_correct") is True)
        accuracy = round(correct_count / total_items * 100, 1) if total_items else 0.0

        mistake_counter: dict[str, int] = {}
        flags_counter: dict[str, int] = {}
        topic_buckets: dict[str, dict] = {}
        for it in all_items:
            mc = it.get("mistake_category")
            if mc:
                mistake_counter[mc] = mistake_counter.get(mc, 0) + 1
            for fl in (it.get("process_review_flags") or []):
                if not isinstance(fl, str) or fl == "answer_correct":
                    continue
                flags_counter[fl] = flags_counter.get(fl, 0) + 1
            ak_id = ak_by_result.get(it.get("result_id"))
            meta = (meta_by_key.get(ak_id) or {})
            q_meta = meta.get(str(it.get("question_number"))) or {}
            topic = q_meta.get("topic")
            if topic:
                b = topic_buckets.setdefault(topic, {"topic": topic, "total": 0, "correct": 0})
                b["total"] += 1
                if it.get("is_correct") is True:
                    b["correct"] += 1

        # 빈도순 정렬 + 비율 부착
        def _ratio_list(counter: dict, denom: int) -> list[dict]:
            arr = [{"key": k, "count": v, "ratio": round(v / denom * 100, 1) if denom else 0.0}
                   for k, v in counter.items()]
            arr.sort(key=lambda x: x["count"], reverse=True)
            return arr

        mistake_categories = _ratio_list(mistake_counter, total_items)
        process_flags = _ratio_list(flags_counter, total_items)
        topics = []
        for b in topic_buckets.values():
            acc = round(b["correct"] / b["total"] * 100, 1) if b["total"] else 0.0
            topics.append({"topic": b["topic"], "total": b["total"], "correct": b["correct"], "accuracy": acc})
        topics.sort(key=lambda x: x["accuracy"])  # 정답률 낮은 단원 먼저(=취약 우선)

        # 5) 최근 N개 추이
        recent_trend = []
        for r in results[-max(limit_recent, 1):]:
            max_s = float(r.get("max_score") or 1)
            total_s = float(r.get("total_score") or 0)
            acc = round(total_s / max_s * 100, 1) if max_s else 0.0
            recent_trend.append({
                "result_id": r["id"],
                "date": str(r.get("created_at", ""))[:10],
                "accuracy": acc,
                "correct": r.get("correct_count", 0),
                "wrong": r.get("wrong_count", 0),
                "total_questions": r.get("total_questions", 0),
            })

        return {
            "student_id": student_id,
            "summary": {
                "total_results": len(results),
                "total_items": total_items,
                "correct_count": correct_count,
                "accuracy": accuracy,
            },
            "mistake_categories": mistake_categories,
            "process_flags": process_flags,
            "topics": topics,
            "recent_trend": recent_trend,
            "notes": {
                "data_dependencies": [
                    "mistake_categories / process_flags 는 0038·0039 마이그레이션 적용 + 풀이 검토 조교 실행 이후 축적",
                    "topics 는 answer_keys.question_meta_json 에 단원 메타가 입력된 문항에 한정",
                ],
            },
        }
    except Exception as e:
        logger.error(f"취약점 보고 조회 실패 (student_id={student_id}): {e}")
        raise HTTPException(status_code=500, detail=f"취약점 보고 실패: {str(e)[:200]}")


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
