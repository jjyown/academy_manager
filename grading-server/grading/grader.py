"""채점 로직: Smart Grading - GPT-4o OCR + 크로스 검증 + 수학적 동치 비교"""
import re
import logging
from fractions import Fraction
from integrations.gemini import grade_essay_independent, grade_essay_mediate
from ocr.engines import normalize_question_key, normalize_answer_keys

logger = logging.getLogger(__name__)


async def grade_submission(
    image_bytes: bytes,
    answers_json: dict,
    types_json: dict,
    ocr_result: dict | None = None,
    question_texts: dict | None = None,
    skip_questions: set | None = None,
) -> dict:
    """학생 답안 이미지를 채점 (Smart Grading)

    Args:
        image_bytes: 학생 답안 사진
        answers_json: {"1": "③", "2": "①", ...} 정답
        types_json: {"1": "mc", "2": "mc", "5": "essay"} 유형
        ocr_result: 사전 OCR 결과 (크로스 검증 완료). None이면 내부에서 OCR 실행
        question_texts: {"3": "삼각형의 넓이를 구하시오", ...} 문제 본문 (서술형용)
        skip_questions: 이미 채점된 문제번호 set (중복 채점 방지)

    Returns:
        채점 결과 dict
    """
    if ocr_result is None:
        from ocr.engines import ocr_gemini
        ocr_result = await ocr_gemini(image_bytes)

    student_answers_raw = ocr_result.get("answers", {})
    textbook_info = ocr_result.get("textbook_info", {})

    # 문제번호 키 정규화 (OCR 결과, 정답지, 유형 모두 통일)
    student_answers_keyed = normalize_answer_keys(student_answers_raw)
    answers_json = normalize_answer_keys(answers_json)
    types_json = normalize_answer_keys(types_json)

    # OCR 결과 형태 통일 (str → dict)
    normalized_answers = {}
    for k, v in student_answers_keyed.items():
        if isinstance(v, dict):
            normalized_answers[k] = v
        else:
            normalized_answers[k] = {"answer": str(v), "confidence": 90}
    student_answers = normalized_answers

    # 중복 문제번호 제거 (이전 이미지에서 이미 채점된 문제)
    # skip_questions의 키도 정규화하여 비교
    normalized_skip = {normalize_question_key(q) for q in skip_questions} if skip_questions else set()
    skipped_dupes = []
    if normalized_skip:
        for q in list(student_answers.keys()):
            if q in normalized_skip:
                skipped_dupes.append(q)
                del student_answers[q]
        if skipped_dupes:
            logger.info(f"[Dedup] 중복 문제 {len(skipped_dupes)}개 건너뜀: {skipped_dupes}")

    logger.info(f"[Smart OCR] 교재: {textbook_info.get('name', '?')}, "
                f"페이지: {textbook_info.get('page', '?')}, "
                f"인식 문제 수: {len(student_answers)}, "
                f"문제 번호: {list(student_answers.keys())}")

    for q_num in sorted(student_answers.keys(), key=lambda x: _sort_key(x)):
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

    # fuzzy 매칭용: 정답지 키 → 가능한 변형 매핑 생성
    answer_key_set = set(answers_json.keys())

    def _fuzzy_find_answer_key(q_num: str) -> str | None:
        """OCR 문제번호가 정답지에 없을 때 fuzzy 매칭 시도"""
        # 이미 있으면 바로 반환
        if q_num in answer_key_set:
            return q_num
        # 숫자만 추출해서 비교
        q_digits = re.sub(r'[^\d]', '', q_num)
        for ak in answer_key_set:
            ak_digits = re.sub(r'[^\d]', '', ak)
            if q_digits and ak_digits and q_digits == ak_digits:
                return ak
        # 메인 번호만 비교 (소문제가 없는 경우)
        q_main = re.match(r'(\d+)', q_num)
        if q_main:
            q_main_str = q_main.group(1)
            for ak in answer_key_set:
                if ak == q_main_str:
                    return ak
        return None

    ocr_question_nums = set(student_answers.keys())
    all_questions = sorted(ocr_question_nums, key=lambda x: _sort_key(x))

    for q_num in all_questions:
        correct_answer = answers_json.get(q_num)
        q_type = types_json.get(q_num, "mc")

        # 정답지에 매칭 안 되면 fuzzy 매칭 시도
        matched_key = q_num
        if not correct_answer:
            fuzzy_key = _fuzzy_find_answer_key(q_num)
            if fuzzy_key and fuzzy_key != q_num:
                logger.info(f"[FuzzyMatch] '{q_num}' → '{fuzzy_key}'로 매칭")
                correct_answer = answers_json.get(fuzzy_key)
                q_type = types_json.get(fuzzy_key, q_type)
                matched_key = fuzzy_key

        student_data = student_answers.get(q_num, {})
        raw_answer = student_data.get("answer", "") if isinstance(student_data, dict) else str(student_data) if student_data else ""

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

        is_unanswered = raw_answer == "unanswered"

        # 정답지에 없는 문제: 건너뛰지 않고 "미매칭" 상태로 기록
        if not correct_answer:
            item["is_correct"] = None
            item["ai_feedback"] = "정답지에 해당 문제가 없음 (확인 필요)"
            uncertain_count += 1
            items.append(item)
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
            else:
                # 수학적 동치 비교 (#2)
                match_result = compare_answers(
                    item["student_answer"], correct_answer, q_type
                )
                if match_result == "correct":
                    item["is_correct"] = True
                    correct_count += 1
                elif match_result == "wrong":
                    if item["confidence"] < 70:
                        item["is_correct"] = None
                        uncertain_count += 1
                    else:
                        item["is_correct"] = False
                        wrong_count += 1
                else:  # "uncertain"
                    item["is_correct"] = None
                    uncertain_count += 1

        elif q_type == "essay":
            max_score = 10.0
            essay_total += max_score

            if item["student_answer"]:
                q_text = (question_texts or {}).get(q_num, "")
                result = await grade_essay_independent(
                    main_num, item["student_answer"],
                    correct_answer or "", max_score,
                    question_text=q_text,
                )

                item["ai_score"] = result.get("score", 0)
                item["ai_max_score"] = max_score
                item["ai_feedback"] = result.get("feedback", "")
                item["confidence"] = result.get("confidence", 70)

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

    # 점수 계산 (정답지에 매칭된 문제만 점수 계산에 포함)
    total_questions = len(items)
    gradable_items = [it for it in items if it.get("correct_answer")]
    mc_questions = sum(1 for it in gradable_items if it["question_type"] in ("multiple_choice", "short_answer"))
    mc_correct = sum(1 for it in gradable_items if it["question_type"] in ("multiple_choice", "short_answer") and it.get("is_correct") is True)
    mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0
    mc_earned = mc_correct * mc_per_score if mc_questions > 0 else 0
    total_score = round(mc_earned + essay_earned, 1)

    status = "confirmed" if uncertain_count == 0 else "review_needed"

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
        "graded_questions": set(student_answers.keys()),
        "skipped_duplicates": skipped_dupes,
        "ocr_data": {
            "full_text_1": ocr_result.get("full_text", ocr_result.get("full_text_1", "")),
            "full_text_2": ocr_result.get("full_text_2", ""),
        },
    }


# ============================================================
# #2: 수학적 동치 비교 레이어
# ============================================================

def compare_answers(student: str, correct: str, q_type: str = "mc") -> str:
    """학생 답과 정답을 수학적으로 비교

    Returns:
        "correct" | "wrong" | "uncertain"
    """
    if not student or not correct:
        return "uncertain"

    # 1단계: 정규화 후 문자열 비교 (가장 빠름)
    ns = _normalize_answer(student)
    nc = _normalize_answer(correct)
    if ns == nc:
        return "correct"

    # 2단계: 객관식 번호 매칭 (①↔1, "2번"↔②)
    if q_type == "mc":
        ns_mc = _normalize_mc(student)
        nc_mc = _normalize_mc(correct)
        if ns_mc and nc_mc and ns_mc == nc_mc:
            return "correct"
        if ns_mc and nc_mc and ns_mc != nc_mc:
            return "wrong"

    # 3단계: 수치 비교 (분수, 소수, 부호 등)
    num_result = _compare_numeric(student, correct)
    if num_result is not None:
        return "correct" if num_result else "wrong"

    # 4단계: 수식 정규화 비교
    expr_result = _compare_expression(ns, nc)
    if expr_result is not None:
        return "correct" if expr_result else "wrong"

    return "wrong"


def _normalize_mc(answer: str) -> str | None:
    """객관식 번호 추출 (다양한 형태 → 순수 숫자)"""
    circle_to_num = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    s = answer.strip()

    # ①②③④⑤ → 숫자
    for k, v in circle_to_num.items():
        if k in s:
            return v

    # "2번", "(2)", "번호 2" 등
    s = re.sub(r'[번호()\s]', '', s)
    if s.isdigit() and 1 <= int(s) <= 5:
        return s

    return None


def _compare_numeric(student: str, correct: str) -> bool | None:
    """두 값을 수치로 비교 (분수, 소수, 부호 처리)

    Returns: True(같음), False(다름), None(비교 불가)
    """
    sv = _parse_number(student)
    cv = _parse_number(correct)

    if sv is None or cv is None:
        return None

    # 정확히 같은지
    if sv == cv:
        return True

    # 소수점 반올림 비교 (소수점 2자리까지)
    try:
        if abs(float(sv) - float(cv)) < 0.005:
            return True
    except (ValueError, OverflowError):
        pass

    return False


def _parse_number(s: str) -> Fraction | None:
    """문자열에서 수치 파싱 (정수, 소수, 분수 지원)"""
    s = s.strip().replace(" ", "")
    # 부호 정규화
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    # 선행 + 제거
    if s.startswith("+"):
        s = s[1:]
    # 천 단위 쉼표 제거
    s = re.sub(r"(\d),(\d)", r"\1\2", s)

    # 분수 형태: "2/3", "-1/4"
    frac_m = re.match(r'^(-?\d+)\s*/\s*(\d+)$', s)
    if frac_m:
        try:
            return Fraction(int(frac_m.group(1)), int(frac_m.group(2)))
        except (ValueError, ZeroDivisionError):
            return None

    # 대분수: "1과 1/2", "1 1/2"
    mixed_m = re.match(r'^(-?\d+)\s*(?:과\s*)?(\d+)\s*/\s*(\d+)$', s)
    if mixed_m:
        try:
            whole = int(mixed_m.group(1))
            frac = Fraction(int(mixed_m.group(2)), int(mixed_m.group(3)))
            return Fraction(whole) + frac if whole >= 0 else Fraction(whole) - frac
        except (ValueError, ZeroDivisionError):
            return None

    # 일반 숫자 (정수, 소수)
    try:
        return Fraction(s).limit_denominator(10000)
    except (ValueError, ZeroDivisionError):
        return None


def _compare_expression(ns: str, nc: str) -> bool | None:
    """수식 수준 비교 (간단한 대수식)

    Returns: True(같음), False(다름), None(비교 불가)
    """
    # 루트 표현 통일: "root3" == "sqrt3" == "sqrt(3)"
    def normalize_sqrt(s):
        s = s.replace("루트", "sqrt").replace("root", "sqrt")
        s = re.sub(r'sqrt\(?(\d+)\)?', r'sqrt(\1)', s)
        return s

    ns2 = normalize_sqrt(ns)
    nc2 = normalize_sqrt(nc)
    if ns2 == nc2:
        return True

    # 곱셈 기호 통일: "2x" == "2*x" == "2·x"
    def normalize_mul(s):
        s = s.replace("·", "*").replace("⋅", "*")
        # "2x" → "2*x" (숫자 바로 뒤 문자)
        s = re.sub(r'(\d)([a-z])', r'\1*\2', s)
        return s

    ns3 = normalize_mul(ns2)
    nc3 = normalize_mul(nc2)
    if ns3 == nc3:
        return True

    return None


def _normalize_answer(answer: str) -> str:
    """답안 정규화 (비교용) - 수학 기호 통일"""
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    normalized = answer.strip()
    for k, v in circle_map.items():
        normalized = normalized.replace(k, v)

    # 수학 기호 통일
    normalized = normalized.replace("²", "^2").replace("³", "^3")
    normalized = normalized.replace("√", "sqrt")
    normalized = normalized.replace("−", "-").replace("–", "-").replace("—", "-")
    normalized = normalized.replace("×", "*").replace("÷", "/")
    normalized = normalized.replace("π", "pi")
    normalized = normalized.replace("½", "1/2").replace("⅓", "1/3").replace("¼", "1/4")

    # 공백 제거 (소수점 유지, 끝 마침표만 제거)
    normalized = normalized.replace(" ", "")
    if normalized.endswith("."):
        normalized = normalized[:-1]
    # 숫자 내 천 단위 쉼표만 제거
    normalized = re.sub(r"(\d),(\d)", r"\1\2", normalized)
    # 괄호 통일
    normalized = normalized.replace("[", "(").replace("]", ")").replace("{", "(").replace("}", ")")
    # "번" 접미사 제거 (객관식: "2번" → "2")
    normalized = re.sub(r'^(\d+)번$', r'\1', normalized)
    return normalized.lower()


def _map_type(t: str) -> str:
    mapping = {"mc": "multiple_choice", "short": "short_answer", "essay": "essay"}
    return mapping.get(t, "multiple_choice")


def _sort_key(x: str):
    """문제 번호 정렬 키"""
    m = re.match(r"(\d+)(?:[(-](\d+)[)]?)?", x)
    if m:
        main = int(m.group(1))
        sub = int(m.group(2)) if m.group(2) else 0
        return (main, sub, "")
    return (9999, 0, x)
