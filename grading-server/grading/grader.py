"""채점 로직: Smart Grading - 교재 식별 + OCR + 정답 대조 + 미풀이 감지"""
import re
import logging
from ocr.engines import ocr_gemini_double_check
from integrations.gemini import grade_essay, grade_essay_double_check

logger = logging.getLogger(__name__)


async def grade_submission(image_bytes: bytes, answers_json: dict, types_json: dict) -> dict:
    """학생 답안 이미지를 채점 (Smart Grading)

    Args:
        image_bytes: 학생 답안 사진
        answers_json: {"1": "③", "2": "①", ...} 정답
        types_json: {"1": "mc", "2": "mc", "5": "essay"} 유형

    Returns:
        {
            "items": [...],
            "correct_count": 26,
            "wrong_count": 3,
            "uncertain_count": 1,
            "unanswered_count": 2,
            "total_questions": 32,
            "total_score": 85.0,
            "max_score": 100.0,
            "status": "review_needed" | "confirmed",
            "textbook_info": {"name": "...", "page": "...", "section": "..."},
            "ocr_data": {...}
        }
    """
    # 1. Gemini Vision 더블체크 OCR (교재 정보 + 답안 추출)
    ocr_result = await ocr_gemini_double_check(image_bytes)
    student_answers = ocr_result["answers"]
    textbook_info = ocr_result.get("textbook_info", {})

    logger.info(f"[Smart OCR] 교재: {textbook_info.get('name', '?')}, "
                f"페이지: {textbook_info.get('page', '?')}, "
                f"인식 문제 수: {len(student_answers)}, "
                f"문제 번호: {list(student_answers.keys())}")

    # 디버그: 학생 답안과 정답 비교 로그
    for q_num in sorted(student_answers.keys(), key=lambda x: int(x) if x.isdigit() else 0):
        s_data = student_answers[q_num]
        s_ans = s_data.get("answer", "") if isinstance(s_data, dict) else str(s_data)
        c_ans = answers_json.get(q_num, "(없음)")
        logger.info(f"  [{q_num}번] 학생: '{s_ans}' / 정답: '{c_ans}'")

    items = []
    correct_count = 0
    wrong_count = 0
    uncertain_count = 0
    unanswered_count = 0
    essay_total = 0
    essay_earned = 0

    # OCR이 이 페이지에서 감지한 문제만 채점 (답지 전체가 아닌 현재 페이지만)
    ocr_question_nums = set(student_answers.keys())
    all_questions = sorted(
        ocr_question_nums,
        key=lambda x: _sort_key(x),
    )

    for q_num in all_questions:
        correct_answer = answers_json.get(q_num)
        q_type = types_json.get(q_num, "mc")
        student_data = student_answers.get(q_num, {})
        raw_answer = student_data.get("answer", "") if isinstance(student_data, dict) else str(student_data) if student_data else ""

        # DB용 정수 번호 (소문제면 메인 번호만) + 표시용 라벨
        main_num = int(re.match(r"(\d+)", q_num).group(1)) if re.match(r"(\d+)", q_num) else 0

        item = {
            "question_number": main_num,
            "question_label": q_num,
            "question_type": _map_type(q_type),
            "correct_answer": correct_answer or "",
            "student_answer": raw_answer if raw_answer != "unanswered" else "",
            "ocr1_answer": student_data.get("ocr1", "") if isinstance(student_data, dict) else "",
            "ocr2_answer": student_data.get("ocr2", "") if isinstance(student_data, dict) else "",
            "confidence": student_data.get("confidence", 0) if isinstance(student_data, dict) else 0,
        }

        # 미풀이 감지: OCR이 "unanswered"로 판별
        is_unanswered = raw_answer == "unanswered"

        # 정답이 없는 문제 (답지에 없음) → 건너뜀
        if not correct_answer:
            continue

        if is_unanswered:
            item["is_correct"] = None
            item["student_answer"] = "(미풀이)"
            item["ai_feedback"] = "학생이 풀지 않은 문제"
            unanswered_count += 1

        elif q_type in ("mc", "short"):
            if not item["student_answer"]:
                item["is_correct"] = None
                item["confidence"] = 0
                uncertain_count += 1
            elif _normalize_answer(item["student_answer"]) == _normalize_answer(correct_answer or ""):
                item["is_correct"] = True
                correct_count += 1
            else:
                if item["confidence"] < 70:
                    item["is_correct"] = None
                    uncertain_count += 1
                else:
                    item["is_correct"] = False
                    wrong_count += 1

        elif q_type == "essay":
            max_score = 10.0
            essay_total += max_score

            if item["student_answer"]:
                first = await grade_essay(int(q_num), item["student_answer"], correct_answer or "", max_score)
                second = await grade_essay_double_check(int(q_num), item["student_answer"], correct_answer or "", first, max_score)

                item["ai_score"] = second.get("score", 0)
                item["ai_max_score"] = max_score
                item["ai_feedback"] = second.get("feedback", "")
                item["confidence"] = second.get("confidence", 70)

                essay_earned += item["ai_score"]

                if item["ai_score"] >= max_score * 0.8:
                    item["is_correct"] = True
                    correct_count += 1
                elif item["ai_score"] <= max_score * 0.3:
                    item["is_correct"] = False
                    wrong_count += 1
                else:
                    item["is_correct"] = None
                    uncertain_count += 1
            else:
                item["is_correct"] = None
                item["ai_score"] = 0
                item["ai_max_score"] = max_score
                item["ai_feedback"] = "답안 인식 실패"
                uncertain_count += 1

        items.append(item)

    # 점수 계산 (미풀이는 오답과 동일하게 0점)
    total_questions = len(items)
    mc_questions = sum(1 for it in items if it["question_type"] in ("multiple_choice", "short_answer"))
    mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0
    mc_earned = correct_count * mc_per_score if mc_questions > 0 else 0
    total_score = round(mc_earned + essay_earned, 1)

    status = "confirmed" if uncertain_count == 0 else "review_needed"

    # 페이지 정보 문자열 생성
    page_info = ""
    if textbook_info.get("name"):
        page_info = textbook_info["name"]
        if textbook_info.get("page"):
            page_info += f" p.{textbook_info['page']}"
        if textbook_info.get("section"):
            page_info += f" ({textbook_info['section']})"

    return {
        "items": items,
        "correct_count": correct_count,
        "wrong_count": wrong_count,
        "uncertain_count": uncertain_count,
        "unanswered_count": unanswered_count,
        "total_questions": total_questions,
        "total_score": total_score,
        "max_score": 100.0,
        "status": status,
        "textbook_info": textbook_info,
        "page_info": page_info,
        "ocr_data": {
            "full_text_1": ocr_result.get("full_text_1", ""),
            "full_text_2": ocr_result.get("full_text_2", ""),
        },
    }


def _map_type(t: str) -> str:
    """타입 매핑"""
    mapping = {"mc": "multiple_choice", "short": "short_answer", "essay": "essay"}
    return mapping.get(t, "multiple_choice")


def _normalize_answer(answer: str) -> str:
    """답안 정규화 (비교용)"""
    # 원문자 → 숫자
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    normalized = answer.strip()
    for k, v in circle_map.items():
        normalized = normalized.replace(k, v)
    # 공백, 마침표 제거
    normalized = normalized.replace(" ", "").replace(".", "").replace(",", "")
    return normalized.lower()


def _sort_key(x: str):
    """문제 번호 정렬 키 (소문제 지원)
    "1" → (1, 0, ""), "3(1)" → (3, 1, ""), "3-2" → (3, 2, "")
    """
    import re
    m = re.match(r"(\d+)(?:[(-](\d+)[)]?)?", x)
    if m:
        main = int(m.group(1))
        sub = int(m.group(2)) if m.group(2) else 0
        return (main, sub, "")
    return (9999, 0, x)
