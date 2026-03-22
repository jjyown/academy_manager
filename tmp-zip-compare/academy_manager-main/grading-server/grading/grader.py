"""채점 로직: Smart Grading - GPT-4o OCR + 크로스 검증 + 수학적 동치 비교"""
import re
import logging
from fractions import Fraction
from integrations.gemini import grade_essay_independent, grade_essay_mediate, smart_compare
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

    def _has_sub_question(key: str) -> bool:
        """소문제 형식인지 판별 (예: "3(1)", "3-1", "3.1")"""
        return bool(re.match(r'^\d+\s*[(-.]', key))

    def _fuzzy_find_answer_key(q_num: str) -> str | None:
        """OCR 문제번호가 정답지에 없을 때 fuzzy 매칭 시도

        안전한 매칭만 수행 (소문제 구조를 보존하여 오매칭 방지):
        - "3-1" ↔ "3(1)" (구분자 차이만 있을 때)
        - "03" ↔ "3" (선행 0 차이만 있을 때)
        - "12"와 "1(2)"는 구조가 다르므로 매칭하지 않음
        """
        if q_num in answer_key_set:
            return q_num

        # 정규화된 키로 비교 (normalize_question_key가 구조를 보존함)
        q_normalized = normalize_question_key(q_num)
        for ak in answer_key_set:
            if normalize_question_key(ak) == q_normalized:
                return ak

        # 소문제가 아닌 순수 번호일 때만 메인 번호 매칭
        if not _has_sub_question(q_num):
            q_main = re.match(r'(\d+)', q_num)
            if q_main:
                q_main_str = str(int(q_main.group(1)))
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
            item["error_type"] = None
            item["ai_feedback"] = "정답지에 해당 문제가 없음 (확인 필요)"
            uncertain_count += 1
            items.append(item)
            continue

        if is_unanswered:
            item["is_correct"] = None
            item["error_type"] = None
            item["student_answer"] = "(미풀이)"
            item["ai_feedback"] = "학생이 풀지 않은 문제"
            unanswered_count += 1

        elif q_type in ("mc", "short"):
            if not item["student_answer"]:
                item["is_correct"] = None
                item["confidence"] = 0
                item["error_type"] = None
                uncertain_count += 1
            else:
                match_result = compare_answers(
                    item["student_answer"], correct_answer, q_type
                )
                result = match_result["result"]
                item["error_type"] = match_result["error_type"]

                if result == "correct":
                    item["is_correct"] = True
                    correct_count += 1
                elif result == "wrong":
                    if item["confidence"] < 70:
                        item["is_correct"] = None
                        uncertain_count += 1
                    else:
                        item["is_correct"] = False
                        wrong_count += 1
                        if item["error_type"]:
                            logger.debug(f"  [{q_num}번] 오답 원인: {item['error_type']}")
                else:  # "uncertain" → AI로 재판정 시도
                    ai_result = await smart_compare(
                        item["student_answer"], correct_answer
                    )
                    if ai_result["result"] == "correct":
                        item["is_correct"] = True
                        item["error_type"] = None
                        correct_count += 1
                        logger.debug(f"  [{q_num}번] smart_compare → 정답 확인")
                    elif ai_result["result"] == "wrong":
                        item["is_correct"] = False
                        item["error_type"] = ai_result.get("error_type")
                        wrong_count += 1
                        logger.debug(f"  [{q_num}번] smart_compare → 오답 ({item['error_type']})")
                    else:
                        item["is_correct"] = None
                        item["error_type"] = None
                        uncertain_count += 1

        elif q_type == "essay":
            max_score = 10.0
            essay_total += max_score
            item["error_type"] = None

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

def compare_answers(student: str, correct: str, q_type: str = "mc") -> dict:
    """학생 답과 정답을 수학적으로 비교 + 오답 원인 분류

    Returns:
        {"result": "correct"|"wrong"|"uncertain", "error_type": str|None}

    error_type 값:
        None             - 정답이거나 판별 불가
        "calculation_error" - 계산 실수 (숫자가 비슷하지만 다름)
        "sign_error"     - 부호 오류 (절댓값 같고 부호만 다름)
        "fraction_error" - 분수 오류 (역수/약분 실수)
        "wrong_choice"   - 객관식 오답 (기본값)
        "notation_error" - 표기 차이 (수식 형태 유사)
    """
    if not student or not correct:
        return {"result": "uncertain", "error_type": None}

    ns = _normalize_answer(student)
    nc = _normalize_answer(correct)
    if ns == nc:
        return {"result": "correct", "error_type": None}

    if q_type == "mc":
        ns_mc = _normalize_mc(student)
        nc_mc = _normalize_mc(correct)
        if ns_mc and nc_mc and ns_mc == nc_mc:
            return {"result": "correct", "error_type": None}
        if ns_mc and nc_mc and ns_mc != nc_mc:
            return {"result": "wrong", "error_type": "wrong_choice"}

    num_result = _compare_numeric(student, correct)
    if num_result is not None:
        if num_result:
            return {"result": "correct", "error_type": None}
        error_type = _classify_numeric_error(student, correct)
        return {"result": "wrong", "error_type": error_type}

    expr_result = _compare_expression(ns, nc)
    if expr_result is not None:
        if expr_result:
            return {"result": "correct", "error_type": None}
        return {"result": "wrong", "error_type": "notation_error"}

    set_result = _compare_set(student, correct)
    if set_result is not None:
        if set_result:
            return {"result": "correct", "error_type": None}
        return {"result": "wrong", "error_type": "calculation_error"}

    unit_result = _compare_without_units(student, correct)
    if unit_result is not None:
        if unit_result:
            return {"result": "correct", "error_type": None}

    if q_type == "short" and ns.replace("-", "").replace(".", "").isdigit() \
            and nc.replace("-", "").replace(".", "").isdigit() and len(ns) <= 6 and len(nc) <= 6:
        error_type = _classify_numeric_error(student, correct)
        return {"result": "wrong", "error_type": error_type}

    return {"result": "uncertain", "error_type": None}


def _classify_numeric_error(student: str, correct: str) -> str:
    """두 수치 답안의 오답 원인을 휴리스틱으로 분류 (AI 호출 없음)"""
    sv = _parse_number(student)
    cv = _parse_number(correct)

    if sv is None or cv is None:
        return "calculation_error"

    try:
        sf = float(sv)
        cf = float(cv)
    except (ValueError, OverflowError):
        return "calculation_error"

    # 부호만 반대인 경우 (절댓값 동일, 부호 상이)
    if abs(sf + cf) < 0.005 and abs(sf) > 0.001:
        return "sign_error"

    # 분수 역수인 경우 (2/3 vs 3/2)
    if sv != 0 and cv != 0:
        try:
            product = sv * cv
            if product == 1:
                return "fraction_error"
        except (ValueError, OverflowError):
            pass

    # 분수 약분/통분 실수 (분모·분자 관계 확인)
    frac_s = re.match(r'^(-?\d+)\s*/\s*(\d+)$', student.strip().replace(" ", ""))
    frac_c = re.match(r'^(-?\d+)\s*/\s*(\d+)$', correct.strip().replace(" ", ""))
    if frac_s and frac_c:
        s_num, s_den = int(frac_s.group(1)), int(frac_s.group(2))
        c_num, c_den = int(frac_c.group(1)), int(frac_c.group(2))
        if (s_num == c_den and s_den == c_num) or (s_num == -c_den and s_den == -c_num):
            return "fraction_error"

    # 계산 실수 (차이가 작은 경우: 정답의 20% 이내 또는 절대차 5 이내)
    if cf != 0 and abs(sf - cf) / abs(cf) < 0.2:
        return "calculation_error"
    if abs(sf - cf) <= 5:
        return "calculation_error"

    return "calculation_error"


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


def _compare_set(student: str, correct: str) -> bool | None:
    """집합 비교: {1,2,3} == {3,1,2} (원소 순서 무시)

    Returns: True(같음), False(다름), None(집합 형태가 아님)
    """
    s = student.strip().replace(" ", "")
    c = correct.strip().replace(" ", "")

    s_match = re.match(r'^\{(.+)\}$', s)
    c_match = re.match(r'^\{(.+)\}$', c)
    if not s_match or not c_match:
        return None

    s_elements = sorted(e.strip() for e in s_match.group(1).split(','))
    c_elements = sorted(e.strip() for e in c_match.group(1).split(','))

    if s_elements == c_elements:
        return True

    s_nums = []
    c_nums = []
    for e in s_elements:
        n = _parse_number(e)
        if n is None:
            return s_elements == c_elements
        s_nums.append(n)
    for e in c_elements:
        n = _parse_number(e)
        if n is None:
            return s_elements == c_elements
        c_nums.append(n)

    return sorted(s_nums) == sorted(c_nums)


_MATH_UNITS = [
    'cm²', 'cm³', 'cm', 'mm²', 'mm', 'km²', 'km', 'm²', 'm³', 'm',
    'kg', 'g', 'mg', 'L', 'mL', 'l', 'ml',
    '°C', '°F', '°',
    '도', '개', '명', '원', '배', '살', '세',
]


def _strip_unit(s: str) -> tuple[str, str]:
    """문자열 끝의 단위를 분리 → (값, 단위). 단위가 없으면 ("원본", "")"""
    for u in _MATH_UNITS:
        if s.endswith(u) and len(s) > len(u):
            return s[:-len(u)], u
    return s, ""


def _compare_without_units(student: str, correct: str) -> bool | None:
    """단위 제거 후 비교: '5cm' == '5', '90°' == '90', '3개' == '3'

    Returns: True(같음), False(다름), None(단위 비교 대상 아님)
    """
    s = student.strip().replace(" ", "")
    c = correct.strip().replace(" ", "")

    s_val, s_unit = _strip_unit(s)
    c_val, c_unit = _strip_unit(c)

    if not s_unit and not c_unit:
        return None

    if s_unit and c_unit and s_unit != c_unit:
        return None

    if not s_val or not c_val:
        return None

    if s_val == c_val:
        return True

    sv = _parse_number(s_val)
    cv = _parse_number(c_val)
    if sv is not None and cv is not None:
        if sv == cv:
            return True
        try:
            if abs(float(sv) - float(cv)) < 0.005:
                return True
        except (ValueError, OverflowError):
            pass
        return False

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
