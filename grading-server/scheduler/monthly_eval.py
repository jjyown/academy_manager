"""종합평가 자동 생성 스케줄러"""
import logging
from datetime import datetime
from integrations.supabase_client import (
    get_supabase,
    get_students_by_teacher, upsert_evaluation
)
from integrations.gemini import generate_monthly_evaluation

logger = logging.getLogger(__name__)


async def run_monthly_evaluation():
    """매월 말 자동 종합평가 생성"""
    now = datetime.now()
    month_str = now.strftime("%Y-%m")
    logger.info(f"[종합평가] {month_str} 자동 생성 시작")

    sb = get_supabase()

    # 모든 선생님 조회
    teachers_res = sb.table("teachers").select("id, owner_user_id, name").execute()
    teachers = teachers_res.data or []

    for teacher in teachers:
        teacher_uid = teacher["owner_user_id"]
        teacher_name = teacher["name"]

        # 선생님의 학생 목록
        students = await get_students_by_teacher(teacher_uid)

        for student in students:
            try:
                # 이번 달 채점 결과 수집 (DB 레벨에서 월별 필터링)
                month_start = f"{month_str}-01"
                month_end_day = 28 if now.month == 2 else 30 if now.month in (4,6,9,11) else 31
                month_end = f"{month_str}-{month_end_day}"
                monthly_res = sb.table("grading_results").select(
                    "*, answer_keys(title, subject)"
                ).eq("student_id", student["id"]).eq(
                    "status", "confirmed"
                ).gte("created_at", month_start).lte(
                    "created_at", month_end + "T23:59:59"
                ).order("created_at", desc=True).execute()
                monthly_results = monthly_res.data or []

                if not monthly_results:
                    continue

                # 출석 데이터 수집
                att_res = sb.table("attendance_records").select("status").eq(
                    "student_id", student["id"]
                ).gte("attendance_date", f"{month_str}-01").execute()

                att_data = None
                if att_res.data:
                    att_data = {
                        "present": sum(1 for r in att_res.data if r["status"] == "present"),
                        "late": sum(1 for r in att_res.data if r["status"] == "late"),
                        "absent": sum(1 for r in att_res.data if r["status"] == "absent"),
                    }

                # AI로 종합평가 생성
                grading_data = [
                    {
                        "title": r.get("answer_keys", {}).get("title", "과제") if r.get("answer_keys") else "과제",
                        "total_score": r.get("total_score", 0),
                        "max_score": r.get("max_score", 100),
                        "correct_count": r.get("correct_count", 0),
                        "wrong_count": r.get("wrong_count", 0),
                    }
                    for r in monthly_results
                ]

                eval_text = await generate_monthly_evaluation(
                    student["name"], grading_data, att_data
                )

                if eval_text:
                    # DB에 저장 (승인 전 상태)
                    await upsert_evaluation({
                        "teacher_id": teacher_uid,
                        "student_id": student["id"],
                        "month": month_str,
                        "content": eval_text,
                        "auto_generated": True,
                        "approved": False,
                        "ai_draft": eval_text,
                    })

                    logger.info(f"[종합평가] {student['name']} - {month_str} 생성 완료")

            except Exception as e:
                logger.error(f"[종합평가] {student.get('name', '?')} 실패: {e}")

    logger.info(f"[종합평가] {month_str} 자동 생성 완료")
