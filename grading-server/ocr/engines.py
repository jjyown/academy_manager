"""OCR 엔진: GPT-4o (채점) + Gemini (크로스 검증)

하이브리드 엔진:
- GPT-4o: 학생 숙제 채점 OCR (1차, 배치 처리)
- Gemini: 크로스 검증 (불일치/저신뢰 문제 재검증)
- 배치 크기: 5장 (정확도 최적화)
"""
import asyncio
import logging
import json
import re
import base64

logger = logging.getLogger(__name__)

BATCH_SIZE = 5
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0


# ============================================================
# 문제번호 키 정규화 (OCR ↔ 정답지 매칭용)
# ============================================================

def normalize_question_key(key: str) -> str:
    """문제번호 키를 표준 형식으로 정규화

    변환 규칙:
    - "3-1" → "3(1)", "3-(2)" → "3(2)"
    - "3번" → "3", "제3문" → "3"
    - " 03 " → "3" (공백, 선행 0 제거)
    - "3(1)" → "3(1)" (이미 표준 형식)
    - "3.1" → "3(1)" (소수점 소문제)
    """
    s = str(key).strip()
    # 접두/접미 제거: "제", "번", "문", "Q", "#"
    s = re.sub(r'^[제Q#\s]+', '', s)
    s = re.sub(r'[번문\s]+$', '', s)
    s = s.strip()

    # 소문제 패턴: "3(1)", "3-(1)", "3-1", "3.1" → "3(1)"
    # 반드시 구분자(-, ., () 중 하나)가 있어야 소문제로 인식
    m = re.match(r'^(\d+)\s*[-.]?\s*\((\d+)\)$', s)  # "3(1)", "3-(1)"
    if m:
        return f"{str(int(m.group(1)))}({m.group(2)})"

    m2 = re.match(r'^(\d+)\s*[-.](\d+)$', s)  # "3-1", "3.1" (구분자 필수)
    if m2:
        return f"{str(int(m2.group(1)))}({m2.group(2)})"

    # 순수 숫자: "03" → "3"
    m_num = re.match(r'^0*(\d+)$', s)
    if m_num:
        return m_num.group(1)

    return s


def normalize_answer_keys(answers: dict) -> dict:
    """answers dict의 모든 키를 정규화 (중복 시 첫 번째 유지)"""
    normalized = {}
    for k, v in answers.items():
        nk = normalize_question_key(k)
        if nk not in normalized:
            normalized[nk] = v
    return normalized


async def _retry_async(func, *args, label: str = "API", max_retries: int = MAX_RETRIES, **kwargs):
    """비동기 함수 자동 재시도 (지수 백오프)"""
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(f"[Retry] {label} 실패 (시도 {attempt}/{max_retries}): {e} → {delay:.1f}초 후 재시도")
                await asyncio.sleep(delay)
            else:
                logger.error(f"[Retry] {label} 최종 실패 ({max_retries}회 시도): {e}")
    raise last_err


# ============================================================
# JSON 복구 유틸리티
# ============================================================

def _robust_json_parse(text: str) -> dict | list | None:
    """AI 응답에서 JSON을 안정적으로 추출 (불완전한 JSON 복구 포함)"""
    text = text.strip()

    # 코드 블록 제거
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

    # 1차: 직접 파싱
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2차: JSON 배열/객체 부분만 추출
    for pattern in [r'(\[[\s\S]*\])', r'(\{[\s\S]*\})']:
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass

    # 3차: trailing comma 제거 후 재시도
    cleaned = re.sub(r',\s*([}\]])', r'\1', text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 4차: 잘린 JSON 복구 (끝에 }] 또는 } 추가)
    for suffix in ['"}]', '"}', '}]', '}', ']']:
        try:
            return json.loads(text + suffix)
        except json.JSONDecodeError:
            continue

    logger.warning(f"[JSON] 복구 실패: {text[:200]}...")
    return None


# ============================================================
# GPT-4o OCR (1차 - 배치 5장)
# ============================================================

async def ocr_gpt4o_batch(
    image_bytes_list: list[bytes],
    expected_questions: list[str] | None = None,
    question_types: dict | None = None,
) -> list[dict]:
    """GPT-4o Vision으로 여러 이미지를 배치 OCR (최대 5장씩)

    Args:
        image_bytes_list: 학생 답안 이미지 바이트 리스트
        expected_questions: 기대 문제 번호 리스트 (예: ["1", "2", "3(1)", "3(2)"])
        question_types: 문제별 유형 dict (예: {"1": "mc", "2": "short", "5": "essay"})

    Returns:
        [{"textbook_info": {...}, "answers": {...}}, ...]
    """
    from openai import AsyncOpenAI
    from config import OPENAI_API_KEY, AI_API_TIMEOUT

    if not OPENAI_API_KEY:
        logger.warning("[GPT-4o] API 키 없음 → Gemini fallback")
        return [await ocr_gemini(img) for img in image_bytes_list]

    client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=AI_API_TIMEOUT)

    # 배치 분할 후 비동기 병렬 실행
    chunks = []
    for i in range(0, len(image_bytes_list), BATCH_SIZE):
        chunks.append(image_bytes_list[i:i + BATCH_SIZE])

    if len(chunks) > 1:
        logger.info(f"[GPT-4o] {len(image_bytes_list)}장 → {len(chunks)}개 배치 병렬 처리")

    tasks = [
        _retry_async(
            _ocr_gpt4o_chunk, client, chunk, chunk_idx, expected_questions,
            question_types=question_types,
            label=f"GPT-4o 배치{chunk_idx+1}", max_retries=2,
        )
        for chunk_idx, chunk in enumerate(chunks)
    ]
    chunk_results = await asyncio.gather(*tasks, return_exceptions=True)

    # 실패한 청크는 Gemini fallback
    resolved_results = []
    for i, result in enumerate(chunk_results):
        if isinstance(result, Exception):
            logger.error(f"[GPT-4o] 배치 {i+1} 최종 실패 → Gemini fallback: {result}")
            fallback = []
            for img in chunks[i]:
                try:
                    fallback.append(await ocr_gemini(img))
                except Exception:
                    fallback.append({"textbook_info": {}, "answers": {}})
            resolved_results.append(fallback)
        else:
            resolved_results.append(result)
    chunk_results = resolved_results

    all_results = []
    for results in chunk_results:
        all_results.extend(results)

    return all_results


async def _ocr_gpt4o_chunk(
    client,
    chunk: list[bytes],
    chunk_idx: int,
    expected_questions: list[str] | None,
    question_types: dict | None = None,
) -> list[dict]:
    """GPT-4o 배치 청크 처리 (최대 5장)"""
    chunk_label = f"배치 {chunk_idx + 1}"

    # 기대 문제번호 + 유형 힌트 텍스트 생성
    hint_text = ""
    if expected_questions:
        # 문제 유형 힌트 생성 (있으면 유형별로 표시)
        if question_types:
            type_labels = {"mc": "객관식(①~⑤ 중 택1)", "short": "단답형(숫자/수식)", "essay": "서술형"}
            type_hints = []
            for q in expected_questions[:30]:
                qt = question_types.get(q, "mc")
                label = type_labels.get(qt, "객관식(①~⑤ 중 택1)")
                type_hints.append(f"{q}번={label}")
            hint_text = f"""
★ 이 교재의 문제 정보 (매우 중요 - 반드시 참고) ★
문제별 유형:
{chr(10).join(type_hints)}

위 문제 번호 형식에 맞춰 읽어주세요.
- 객관식 문제: 반드시 ①②③④⑤ 중 학생이 선택(동그라미/체크)한 번호만 읽으세요
- 단답형 문제: 학생이 답란/답 옆에 최종적으로 적은 숫자/수식을 읽으세요
- 서술형 문제: 학생의 풀이 전체를 읽으세요
"""
        else:
            hint_text = f"""
★ 이 교재의 문제 번호 형식 참고 ★
등록된 문제 번호: {', '.join(expected_questions[:30])}
위 형식에 맞춰 문제 번호를 읽어주세요.
"""

    messages = [{"role": "system", "content": (
        "당신은 한국 수학 문제집 사진에서 학생의 최종 답안만 정확하게 읽어내는 전문 OCR 시스템입니다.\n\n"
        "★ 최우선 원칙: '최종 답'과 '풀이 과정'을 절대 혼동하지 마세요 ★\n\n"
        "학생의 '최종 답'을 찾는 방법 (우선순위 순서):\n"
        "1. 답란(빈칸/박스) 안에 적힌 값 → 이것이 최종 답\n"
        "2. 객관식: 보기 번호(①②③④⑤) 옆에 동그라미(○), 체크(✓), 밑줄을 한 것 → 이것이 선택한 답\n"
        "3. 단답형: 문제 바로 옆이나 아래의 답 공간에 깔끔하게 적은 숫자/수식 → 이것이 최종 답\n"
        "4. 문제 풀이 영역 끝에 '답:', '∴', '=' 등으로 표시한 값 → 이것이 최종 답\n\n"
        "★ 절대 답이 아닌 것 (무시해야 할 것) ★\n"
        "- 풀이 과정 중간에 나오는 계산 숫자 (예: 인수분해 도중의 숫자들)\n"
        "- 낙서, 연습 계산, 메모, 화살표, 밑줄\n"
        "- 취소선(X)이 그어진 숫자나 수식 → 학생이 지운 것\n"
        "- 인쇄된 문제 본문, 보기 텍스트, 보기 번호 자체 (학생이 표시하지 않은 것)\n"
        "- 풀이 과정에서 임시로 쓴 중간값, 대입값\n\n"
        "추가 규칙:\n"
        "- 객관식에서 학생이 아무 보기에도 표시하지 않았으면 → 'unanswered'\n"
        "- 단답형에서 답란이 비어있으면 → 'unanswered'\n"
        "- 정답 여부를 판단하지 마세요. 학생이 적은 것만 읽으세요\n"
        "- 확신이 없는 답은 가장 가능성 높은 값을 적되, 풀이 과정의 숫자를 답으로 적지 마세요"
    )}]

    content_parts = [{
        "type": "text",
        "text": f"""아래 {len(chunk)}장의 학생 숙제 사진을 각각 분석해주세요.
{hint_text}
★ 페이지 유형 분류 ★
먼저 각 이미지가 어떤 종류인지 판별하세요:
- "answer_sheet": 문제집/교재 페이지 (인쇄된 문제 번호가 있고, 학생이 답을 체크/기입한 페이지)
- "solution_only": 풀이 노트 (노트, A4, 이면지 등에 학생이 풀이 과정만 적은 페이지)

판별 기준:
- 인쇄된 문제 번호, 출판사 로고, 교재 레이아웃이 보이면 → "answer_sheet"
- 줄 노트, 빈 종이, 격자 노트에 손글씨만 있으면 → "solution_only"
- "solution_only"인 경우 answers는 빈 객체 {{}}로 응답하세요

각 이미지별로 (answer_sheet인 경우만):
1. 교재 정보: 페이지 상단/하단에서 교재명, 페이지 번호, 단원명 확인
2. 이 사진에 보이는 문제 번호 (인쇄된 번호 기준)
3. 각 문제의 학생 '최종 답'만 읽기 (풀이 과정은 무시!)

★ 답 읽기 핵심 규칙 ★
- 객관식: 학생이 동그라미/체크한 보기 번호만 (예: ③). 아무것도 안 골랐으면 "unanswered"
- 단답형: 답란에 적은 최종 숫자/수식만 (예: "24", "2√3", "-5"). 풀이 중간 숫자가 아님!
- 서술형: 학생이 적은 풀이의 최종 결론
- 빈칸: "unanswered"

반드시 아래 JSON 배열로만 응답 (다른 텍스트 없이):
[
  {{"image_index": 0, "page_type": "answer_sheet", "textbook_info": {{"name": "교재명", "page": "45", "section": "단원명"}}, "answers": {{"1": "③", "2": "unanswered", "3": "24"}}}},
  {{"image_index": 1, "page_type": "solution_only", "textbook_info": {{}}, "answers": {{}}}}
]"""
    }]

    for i, img_bytes in enumerate(chunk):
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        content_parts.append({"type": "text", "text": f"=== 이미지 {i} ==="})
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}
        })

    messages.append({"role": "user", "content": content_parts})

    try:
        total_kb = sum(len(b) for b in chunk) // 1024
        logger.info(f"[GPT-4o] {chunk_label}: {len(chunk)}장 OCR 요청 (총 {total_kb}KB)")
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=4096 * len(chunk),
            temperature=0,
        )

        text = response.choices[0].message.content.strip()
        logger.info(f"[GPT-4o] {chunk_label} 응답: {text[:300]}...")

        batch_results = _robust_json_parse(text)
        if not batch_results or not isinstance(batch_results, list):
            raise ValueError(f"JSON 파싱 결과가 리스트가 아닙니다: {type(batch_results)}")

        logger.info(f"[GPT-4o] {chunk_label}: {len(batch_results)}개 결과 수신")

        result_map = {}
        for r in batch_results:
            idx = r.get("image_index", 0)
            answers = r.get("answers", {})
            page_type = r.get("page_type", "answer_sheet")
            result_map[idx] = {
                "textbook_info": r.get("textbook_info", {}),
                "answers": answers,
                "page_type": page_type,
            }
            if page_type == "solution_only":
                logger.info(f"[GPT-4o] 이미지 {idx}: 풀이 노트 (채점 건너뜀)")
            else:
                logger.info(f"[GPT-4o] 이미지 {idx}: {len(answers)}문제 인식, "
                            f"answers={dict(list(answers.items())[:5])}")

        results = []
        for i in range(len(chunk)):
            if i in result_map:
                results.append(result_map[i])
            else:
                logger.warning(f"[GPT-4o] 이미지 {i} 결과 누락 → Gemini fallback")
                try:
                    results.append(await ocr_gemini(chunk[i]))
                except Exception:
                    results.append({"textbook_info": {}, "answers": {}})

        return results

    except Exception as e:
        logger.error(f"[GPT-4o] {chunk_label} 실패: {e} → Gemini fallback")
        results = []
        for img_bytes in chunk:
            try:
                results.append(await ocr_gemini(img_bytes))
            except Exception:
                results.append({"textbook_info": {}, "answers": {}})
        return results


# ============================================================
# Gemini OCR (fallback / 크로스 검증용)
# ============================================================

async def ocr_gemini(
    image_bytes: bytes,
    expected_questions: list[str] | None = None,
    question_types: dict | None = None,
) -> dict:
    """Gemini Vision으로 이미지에서 교재정보 + 문제번호 + 답안 인식"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY, AI_API_TIMEOUT

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")
    _request_opts = {"timeout": AI_API_TIMEOUT}

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    # 기대 문제번호 + 유형 힌트 생성
    hint_section = ""
    if expected_questions:
        if question_types:
            type_labels = {"mc": "객관식(①~⑤)", "short": "단답형(숫자/수식)", "essay": "서술형"}
            type_hints = []
            for q in expected_questions[:30]:
                qt = question_types.get(q, "mc")
                label = type_labels.get(qt, "객관식")
                type_hints.append(f"{q}번={label}")
            hint_section = f"""
★ 문제 정보 (참고) ★
{', '.join(type_hints)}
위 문제 번호 형식에 맞춰 읽어주세요.
"""
        else:
            hint_section = f"""
★ 문제 번호 참고 ★
등록된 문제 번호: {', '.join(expected_questions[:30])}
"""

    prompt = f"""이 학생 숙제 사진을 분석해주세요.
{hint_section}
1. 교재 정보: 페이지에 보이는 교재명, 페이지 번호, 단원명
2. 이 사진에 보이는 문제 번호만 나열 (사진에 없는 문제는 포함 금지)
3. 학생의 '최종 답'만 읽기 (풀이 과정의 중간 숫자는 무시!)

★ 최종 답 찾는 방법 ★
- 답란(빈칸/박스) 안에 적힌 값이 최종 답
- 객관식: 학생이 동그라미/체크한 보기 번호 (①②③④⑤ 형태)
- 단답형: 답 칸에 적힌 숫자/수식 (풀이 과정 중간값이 아님)
- 빈칸/미작성: "unanswered"
- 사진에 보이지 않는 문제는 절대 포함하지 마세요

★ 무시해야 할 것 ★
- 풀이 과정 중간 숫자, 낙서, 메모, 취소선(X)이 그어진 값

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{{"textbook_info": {{"name": "교재명", "page": "45", "section": "단원명"}}, "answers": {{"1": "③", "2": "unanswered", "3": "24"}}, "full_text": "전체 인식 텍스트"}}"""

    async def _call_gemini():
        response = model.generate_content(
            [prompt, {"mime_type": "image/jpeg", "data": b64}],
            request_options=_request_opts,
        )
        result = _robust_json_parse(response.text)
        if not result or not isinstance(result, dict):
            return {"textbook_info": {}, "answers": {}, "full_text": ""}
        return {
            "textbook_info": result.get("textbook_info", {}),
            "answers": result.get("answers", {}),
            "full_text": result.get("full_text", ""),
        }

    try:
        return await _retry_async(_call_gemini, label="Gemini OCR", max_retries=2)
    except Exception as e:
        logger.error(f"Gemini OCR 최종 실패: {e}")
        return {"textbook_info": {}, "answers": {}, "full_text": ""}


# ============================================================
# 크로스 엔진 검증 (#1: GPT-4o 결과를 Gemini로 교차 검증)
# ============================================================

async def cross_validate_ocr(
    image_bytes_list: list[bytes],
    gpt4o_results: list[dict],
    expected_questions: list[str] | None = None,
    question_types: dict | None = None,
) -> list[dict]:
    """GPT-4o OCR 결과를 Gemini로 교차 검증하여 confidence 강화

    - GPT-4o 결과의 각 답안을 Gemini로 재검증
    - 두 엔진이 일치하면 confidence 95
    - 불일치하면 confidence 60으로 낮추고 두 결과 모두 보존
    - 빈 결과(GPT-4o 실패)는 Gemini 결과로 대체

    Returns:
        검증된 OCR 결과 리스트 (더블체크 형식: answers 값이 dict)
    """
    validated = []

    # solution_only 페이지는 Gemini 호출 건너뛰기 (비용 절약)
    async def _noop_gemini():
        return None

    gemini_tasks = []
    for i, img in enumerate(image_bytes_list):
        if i < len(gpt4o_results) and gpt4o_results[i].get("page_type") == "solution_only":
            gemini_tasks.append(_noop_gemini())
        else:
            gemini_tasks.append(ocr_gemini(img, expected_questions=expected_questions, question_types=question_types))
    gemini_results = await asyncio.gather(*gemini_tasks, return_exceptions=True)

    for idx, (gpt_result, gemini_result) in enumerate(zip(gpt4o_results, gemini_results)):
        # 풀이 노트(solution_only)는 Gemini 검증 건너뜀 → 비용 절약
        if gpt_result.get("page_type") == "solution_only":
            logger.info(f"[CrossVal] 이미지 {idx}: 풀이 노트 → 크로스 검증 건너뜀")
            result = _to_single_check_format(gpt_result)
            result["page_type"] = "solution_only"
            validated.append(result)
            continue

        if isinstance(gemini_result, Exception):
            logger.warning(f"[CrossVal] 이미지 {idx} Gemini 검증 실패: {gemini_result}")
            # Gemini 실패 시 GPT-4o 결과를 단일 체크로 사용
            validated.append(_to_single_check_format(gpt_result))
            continue

        gpt_answers_raw = gpt_result.get("answers", {})
        gemini_answers_raw = gemini_result.get("answers", {})

        # 키 정규화: GPT-4o와 Gemini의 문제번호 형식 통일
        gpt_answers = normalize_answer_keys(gpt_answers_raw)
        gemini_answers = normalize_answer_keys(gemini_answers_raw)

        # GPT-4o 결과가 비어있으면 Gemini 결과 사용
        if not gpt_answers and gemini_answers:
            logger.info(f"[CrossVal] 이미지 {idx}: GPT-4o 비어있음 → Gemini 결과 사용")
            gem_norm = dict(gemini_result)
            gem_norm["answers"] = gemini_answers
            validated.append(_to_single_check_format(gem_norm, source="gemini"))
            continue

        # 교차 검증: 두 엔진 결과 비교
        all_questions = set(list(gpt_answers.keys()) + list(gemini_answers.keys()))
        combined_answers = {}
        match_count = 0
        mismatch_count = 0

        for q in all_questions:
            g_val = _extract_answer_str(gpt_answers.get(q, ""))
            m_val = _extract_answer_str(gemini_answers.get(q, ""))

            # 둘 다 unanswered
            if g_val == "unanswered" and m_val == "unanswered":
                combined_answers[q] = {
                    "answer": "unanswered",
                    "ocr1": g_val, "ocr2": m_val,
                    "match": True, "confidence": 95,
                }
                match_count += 1
                continue

            # 한쪽만 unanswered
            if g_val == "unanswered" and m_val and m_val != "unanswered":
                combined_answers[q] = {
                    "answer": m_val, "ocr1": g_val, "ocr2": m_val,
                    "match": False, "confidence": 55,
                }
                mismatch_count += 1
                continue
            if m_val == "unanswered" and g_val and g_val != "unanswered":
                combined_answers[q] = {
                    "answer": g_val, "ocr1": g_val, "ocr2": m_val,
                    "match": False, "confidence": 55,
                }
                mismatch_count += 1
                continue

            # 정규화 후 비교
            match = _fuzzy_ocr_match(g_val, m_val)
            if match:
                combined_answers[q] = {
                    "answer": g_val, "ocr1": g_val, "ocr2": m_val,
                    "match": True, "confidence": 95,
                }
                match_count += 1
            elif g_val and m_val:
                # 불일치: GPT-4o를 우선하되 confidence 낮춤
                combined_answers[q] = {
                    "answer": g_val, "ocr1": g_val, "ocr2": m_val,
                    "match": False, "confidence": 60,
                }
                mismatch_count += 1
            elif g_val:
                combined_answers[q] = {
                    "answer": g_val, "ocr1": g_val, "ocr2": "",
                    "match": False, "confidence": 75,
                }
            elif m_val:
                combined_answers[q] = {
                    "answer": m_val, "ocr1": "", "ocr2": m_val,
                    "match": False, "confidence": 70,
                }

        # 교재 정보: GPT-4o 우선
        tb_gpt = gpt_result.get("textbook_info", {})
        tb_gem = gemini_result.get("textbook_info", {})
        textbook_info = {
            "name": tb_gpt.get("name") or tb_gem.get("name", ""),
            "page": tb_gpt.get("page") or tb_gem.get("page", ""),
            "section": tb_gpt.get("section") or tb_gem.get("section", ""),
        }

        logger.info(f"[CrossVal] 이미지 {idx}: "
                     f"{len(all_questions)}문제, 일치={match_count}, 불일치={mismatch_count}")

        validated.append({
            "textbook_info": textbook_info,
            "answers": combined_answers,
            "full_text": gemini_result.get("full_text", ""),
        })

    return validated


def _extract_answer_str(val) -> str:
    """답안 값에서 문자열 추출 (dict/str 대응)"""
    if isinstance(val, dict):
        return str(val.get("answer", ""))
    return str(val) if val else ""


def _fuzzy_ocr_match(a: str, b: str) -> bool:
    """두 OCR 결과가 실질적으로 같은지 비교 (정규화 후)"""
    if not a or not b:
        return False
    na = _quick_normalize(a)
    nb = _quick_normalize(b)
    if na == nb:
        return True
    # 원형 숫자 ↔ 일반 숫자 비교
    circle_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    for k, v in circle_map.items():
        na = na.replace(k, v)
        nb = nb.replace(k, v)
    return na == nb


def _quick_normalize(s: str) -> str:
    """빠른 정규화 (OCR 비교용)"""
    s = s.strip().lower().replace(" ", "")
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    if s.endswith("."):
        s = s[:-1]
    return s


def _to_single_check_format(ocr_result: dict, source: str = "gpt4o") -> dict:
    """단일 OCR 결과를 크로스 검증 형식으로 변환"""
    answers = normalize_answer_keys(ocr_result.get("answers", {}))
    converted = {}
    base_conf = 90 if source == "gpt4o" else 80
    for k, v in answers.items():
        val = _extract_answer_str(v)
        converted[k] = {
            "answer": val,
            "ocr1": val if source == "gpt4o" else "",
            "ocr2": val if source == "gemini" else "",
            "match": False,
            "confidence": base_conf,
        }
    return {
        "textbook_info": ocr_result.get("textbook_info", {}),
        "answers": converted,
        "full_text": ocr_result.get("full_text", ""),
    }


# ============================================================
# 기존 Gemini 더블체크 (하위 호환)
# ============================================================

async def ocr_gemini_double_check(image_bytes: bytes) -> dict:
    """Gemini Vision 더블체크: 2번 독립 호출 → 교재 식별 + 답안 비교
    (기존 호환용 - 새 시스템에서는 cross_validate_ocr 사용)
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, AI_API_TIMEOUT

    genai.configure(api_key=GEMINI_API_KEY)
    _request_opts = {"timeout": AI_API_TIMEOUT}

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt1 = """이 학생 숙제 사진을 분석해주세요.

1. 교재 정보: 페이지에 보이는 교재명, 페이지 번호, 단원/섹션명
2. 이 사진에 보이는 문제 번호만 나열 (학생이 안 푼 문제도 포함)
3. 각 문제의 학생 답 (안 풀었으면 "unanswered")

문제 번호 규칙:
- 일반 번호: "1", "2", "3"
- 소문제: "1(1)", "1(2)" 또는 "1-1", "1-2" 형태 (답지와 동일한 형식)
- 인쇄된 문제 번호를 그대로 사용

답 읽기 규칙:
- 객관식: 학생이 동그라미 친 번호를 ①②③④⑤ 형태로 기록
- 단답형: 학생이 적은 숫자/수식/텍스트를 그대로 기록
- 빈칸/미작성: "unanswered"
- 이 사진에 보이지 않는 문제는 절대 포함하지 마세요
- 학생이 적은 답을 정확히 읽어주세요 (정답과 비교하지 마세요)

JSON만 응답:
{"textbook_info": {"name": "교재명", "page": "45", "section": "단원명"}, "answers": {"1": "③", "2": "unanswered", "3(1)": "12", "3(2)": "-5"}, "full_text": "..."}"""

    model = genai.GenerativeModel("gemini-2.0-flash")
    image_part = {"mime_type": "image/jpeg", "data": b64}

    try:
        res1 = model.generate_content([prompt1, image_part], request_options=_request_opts)
        text1 = _robust_json_parse(res1.text) or {"textbook_info": {}, "answers": {}, "full_text": ""}
    except Exception as e:
        logger.error(f"Gemini OCR 실패: {e}")
        text1 = {"textbook_info": {}, "answers": {}, "full_text": ""}

    return text1


def _parse_json_response(text: str) -> dict:
    """Gemini 응답에서 JSON 추출 (하위 호환)"""
    result = _robust_json_parse(text)
    return result if isinstance(result, dict) else {"answers": {}, "full_text": ""}
