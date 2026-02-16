"""채점 로직: OCR 결과와 정답 대조, 서술형 AI 채점"""
import logging
from ocr.engines import double_check_ocr
from integrations.gemini import grade_essay, grade_essay_double_check

logger = logging.getLogger(__name__)


async def grade_submission(image_bytes: bytes, answers_json: dict, types_json: dict) -> dict:
    """학생 답안 이미지를 채점

    Args:
        image_bytes: 학생 답안 사진
        answers_json: {"1": "③", "2": "①", ...} 정답
        types_json: {"1": "mc", "2": "mc", "5": "essay"} 유형

    Returns:
        {
            "items": [...],           # 문항별 채점 결과
            "correct_count": 26,
            "wrong_count": 3,
            "uncertain_count": 1,
            "total_questions": 30,
            "total_score": 85.0,
            "max_score": 100.0,
            "status": "review_needed" | "confirmed",
            "ocr_data": {...}
        }
    """
    # 1. OCR 더블체크
    ocr_result = double_check_ocr(image_bytes)
    student_answers = ocr_result["answers"]

    items = []
    correct_count = 0
    wrong_count = 0
    uncertain_count = 0
    essay_total = 0
    essay_earned = 0

    all_questions = sorted(answers_json.keys(), key=lambda x: int(x) if x.isdigit() else 0)

    for q_num in all_questions:
        correct_answer = answers_json[q_num]
        q_type = types_json.get(q_num, "mc")
        student_data = student_answers.get(q_num, {})

        item = {
            "question_number": int(q_num) if q_num.isdigit() else 0,
            "question_type": _map_type(q_type),
            "correct_answer": correct_answer,
            "student_answer": student_data.get("answer", "") if isinstance(student_data, dict) else "",
            "ocr1_answer": student_data.get("ocr1", "") if isinstance(student_data, dict) else "",
            "ocr2_answer": student_data.get("ocr2", "") if isinstance(student_data, dict) else "",
            "confidence": student_data.get("confidence", 0) if isinstance(student_data, dict) else 0,
            "position_x": None,
            "position_y": None,
        }

        if q_type in ("mc", "short"):
            # 객관식 / 단답형: 단순 대조
            if not item["student_answer"]:
                item["is_correct"] = None
                item["confidence"] = 0
                uncertain_count += 1
            elif _normalize_answer(item["student_answer"]) == _normalize_answer(correct_answer):
                item["is_correct"] = True
                correct_count += 1
            else:
                # 확신도가 낮으면 불확실 처리
                if item["confidence"] < 70:
                    item["is_correct"] = None
                    uncertain_count += 1
                else:
                    item["is_correct"] = False
                    wrong_count += 1

            # OCR 결과에서 위치 정보 추출
            for ocr_item in ocr_result["ocr1"]:
                if q_num in ocr_item["text"]:
                    item["position_x"] = ocr_item["center_x"]
                    item["position_y"] = ocr_item["center_y"]
                    break

        elif q_type == "essay":
            # 서술형: Gemini AI 채점 + 더블체크
            max_score = 10.0
            essay_total += max_score

            if item["student_answer"]:
                first = await grade_essay(int(q_num), item["student_answer"], correct_answer, max_score)
                second = await grade_essay_double_check(int(q_num), item["student_answer"], correct_answer, first, max_score)

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

    # 점수 계산
    total_questions = len(all_questions)
    mc_questions = sum(1 for q in all_questions if types_json.get(q, "mc") in ("mc", "short"))
    mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0
    mc_earned = correct_count * mc_per_score if mc_questions > 0 else 0
    total_score = round(mc_earned + essay_earned, 1)

    # 상태 결정
    status = "confirmed" if uncertain_count == 0 else "review_needed"

    return {
        "items": items,
        "correct_count": correct_count,
        "wrong_count": wrong_count,
        "uncertain_count": uncertain_count,
        "total_questions": total_questions,
        "total_score": total_score,
        "max_score": 100.0,
        "status": status,
        "ocr_data": {
            "full_text_1": ocr_result["full_text_1"],
            "full_text_2": ocr_result["full_text_2"],
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
