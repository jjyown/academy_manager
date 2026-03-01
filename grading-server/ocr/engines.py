"""OCR 엔진: Gemini 2.5 Flash 더블체크

Gemini 2.5 Flash 2회 독립 OCR → 교차 비교 → 불일치 시 3차 타이브레이크:
- 1차 OCR: Gemini 2.5 Flash (독립)
- 2차 OCR: Gemini 2.5 Flash (독립, 병렬 실행)
- 3차 타이브레이크: Gemini 2.5 Flash (저신뢰 항목만)
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
        "당신은 한국 수학 문제집/교재 사진에서 학생의 최종 답안만 정확하게 읽어내는 전문 OCR 시스템입니다.\n\n"

        "═══════════════════════════════════════\n"
        "★ 최우선 원칙: '최종 답'과 '풀이 과정'을 절대 혼동하지 마세요 ★\n"
        "═══════════════════════════════════════\n\n"

        "【1단계: 최종 답 찾는 방법 (우선순위 순서)】\n"
        "① 답란(빈칸/박스/밑줄 위) 안에 적힌 값 → 이것이 최종 답\n"
        "② 문제 번호 옆 여백에 따로 적은 최종 값 (예: '답: 24', '∴ 11')\n"
        "③ 풀이 마지막 줄의 '=' 뒤에 나오는 최종 결과값\n"
        "④ 여러 값이 적혀있을 때: 마지막에 적은 것, 강조(밑줄/박스)한 것이 최종 답\n\n"

        "【2단계: 객관식(①②③④⑤) 읽기 - 매우 중요】\n"
        "학생이 '선택'을 표시하는 다양한 방법을 모두 인식해야 합니다:\n"
        "- 동그라미(○)로 감싼 번호 → 선택한 답\n"
        "- 체크(✓, ✔, V) 표시한 번호 → 선택한 답\n"
        "- 색연필/볼펜으로 칠한 번호 → 선택한 답\n"
        "- 번호 위에 밑줄 그은 것 → 선택한 답\n"
        "- 번호를 직접 적은 것 (여백에 '3' 또는 '③') → 선택한 답\n"
        "- ★ 학생도 빨간펜/파란펜/형광펜을 사용할 수 있음! 색상만으로 선생님 표시라 단정짓지 마세요\n"
        "- ★ 선생님 채점 표시 구분법: O/X 기호, 점수 숫자(예: -2, +5), '정답:' 텍스트가 있으면 선생님 표시\n"
        "- ★ 보기 번호에 동그라미/체크가 있으면 → 누가 했든 선택한 답으로 읽기 (학생 답 우선)\n"
        "- ★ 보기 번호 자체가 인쇄되어 있는 것 ≠ 학생의 선택 (손글씨 표시만 읽기)\n"
        "- 두 개 이상 표시한 경우: 취소선 없는 것이 최종, 둘 다 유효하면 마지막 것\n"
        "- 아무 표시도 없으면 → 'unanswered'\n\n"

        "【3단계: 단답형 읽기】\n"
        "- 답란에 적힌 최종 숫자/수식만 읽기\n"
        "- 풀이 과정의 중간 계산 ≠ 최종 답 (예: 인수분해 중 나온 숫자)\n"
        "- 여러 줄 풀이가 있으면 → 마지막 결과만\n"
        "- '답:', '∴', '=' 뒤의 값 = 최종 답\n"
        "- 분수: 학생이 적은 형태 그대로 (예: '2/3', '⅔')\n"
        "- 루트: '√3', '2√5' 등 그대로\n"
        "- 음수: '-5', '−3' 등 부호 포함\n"
        "- 좌표/순서쌍: '(2, 3)', '(-1, 4)' 그대로\n"
        "- 답란이 비어있으면 → 'unanswered'\n\n"

        "【4단계: 서술형 읽기】\n"
        "- 학생이 적은 풀이 전체를 읽되, 최종 결론 부분을 명확히\n"
        "- 수식, 그래프 설명, 텍스트 모두 포함\n\n"

        "【절대 답이 아닌 것 - 무시 목록】\n"
        "- 풀이 과정 중간의 계산 숫자 (인수분해, 대입, 이항 중 나온 값)\n"
        "- 취소선(X, ─)이 그어진 숫자/수식 → 학생이 지운 것\n"
        "- 인쇄된 문제 본문, 보기 텍스트 (학생 손글씨가 아닌 것)\n"
        "- 낙서, 연습 계산, 메모, 화살표\n"
        "- 선생님 채점 표시 (O/X 기호 + 점수 숫자가 함께 적힌 것만 해당. 단, 동그라미 자체는 학생 답일 수 있음!)\n"
        "- 교재에 인쇄된 예시 답, 힌트\n\n"

        "【특수 상황 대응】\n"
        "- 사진이 비뚤거나 일부만 보이면 → 보이는 문제만 읽기, 추측 금지\n"
        "- 글씨가 흐리거나 겹쳐있으면 → 가장 가능성 높은 값, confidence 낮춤\n"
        "- 학생이 수정액/수정테이프 위에 다시 적은 것 → 위에 적은 것이 최종\n"
        "- 연필 지우개 흔적 위에 다시 적은 것 → 위에 적은 것이 최종\n"
        "- 한 문제에 여러 답이 보이면 → 마지막(아래쪽/오른쪽)에 적은 것이 최종\n"
        "- 정답 여부를 판단하지 마세요. 학생이 적은 것만 읽으세요\n"
    )}]

    content_parts = [{
        "type": "text",
        "text": f"""아래 {len(chunk)}장의 학생 숙제 사진을 각각 분석해주세요.
{hint_text}
★ 페이지 유형 분류 ★
먼저 각 이미지가 어떤 종류인지 판별하세요:
- "answer_sheet": 문제집/교재 페이지 (인쇄된 문제 번호가 있고, 학생이 답을 체크/기입한 페이지)
- "solution_only": 풀이 노트 (줄 노트, 빈 A4, 이면지에 손글씨 풀이만 있는 페이지)

판별 기준 (중요! 확실할 때만 solution_only):
- 인쇄된 문제 번호 ①②③④⑤, 출판사 로고, 교재 레이아웃이 조금이라도 보이면 → "answer_sheet"
- 인쇄된 텍스트 위에 손글씨가 있으면 → "answer_sheet" (교재에 직접 풀이한 것)
- 완전히 빈 종이/노트에 손글씨만 있을 때만 → "solution_only"
- 확실하지 않으면 → "answer_sheet"로 분류 (answer_sheet가 기본값)
- ★★ "solution_only"라도 학생이 문제 번호를 손글씨로 적고 답을 쓴 것이 보이면 answers에 읽어주세요 ★★
  (예: 백지에 "1. ③  2. 5  3. -2/3" 처럼 번호+답을 나열한 경우 → 그대로 읽기)
- "solution_only"에서 문제 번호 없이 순수 풀이 과정만 있으면 answers는 빈 객체 {{}}

각 이미지별로:
1. 교재 정보: 페이지 상단/하단에서 교재명, 페이지 번호, 단원명 확인
2. 이 사진에 보이는 문제 번호 (인쇄된 번호 기준)
3. 각 문제의 학생 '최종 답'만 읽기 (풀이 과정은 무시!)

★★★ 핵심 답 읽기 규칙 ★★★

[객관식 - 가장 주의!]
- 학생이 동그라미(○)/체크(✓)/칠한/밑줄 그은 보기 번호만 읽기
- 반드시 원형 숫자로 기록: ①②③④⑤ (절대 "1", "2" 등 일반 숫자로 적지 마세요)
- 학생 손글씨 표시만! (인쇄된 보기 번호 자체는 선택이 아님)
- 학생도 빨간펜/파란펜을 사용할 수 있음! 보기에 동그라미/체크가 있으면 학생 답으로 읽기
- 선생님 채점 = O/X 기호, 점수(+5,-2) 등 → 이것만 구분해서 무시
- 아무것도 안 골랐으면 → "unanswered"
- 두 개 표시 중 하나에 취소선 → 취소선 없는 것이 최종

[단답형]
- 답란(빈칸/박스)에 적힌 최종 숫자/수식만
- 풀이 과정 중간 계산값 ≠ 최종 답 (이것을 혼동하면 안 됨!)
- '답:', '∴', '=' 뒤의 최종값
- 여러 값 중 마지막/강조된 것이 최종
- 분수, 루트, 음수 등 학생이 적은 형태 그대로
- 빈칸 → "unanswered"

[서술형]
- 학생의 풀이 전체 + 최종 결론

[특수 상황]
- 수정액/지우개 위에 다시 적은 것 → 위에 적은 것이 최종
- 사진에 보이지 않는 문제 → 절대 포함하지 마세요
- 불확실한 글씨 → 가장 가능성 높은 값 (풀이 중간값을 답으로 적지 마세요)

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
    second_pass: bool = False,
) -> dict:
    """Gemini Vision으로 이미지에서 교재정보 + 문제번호 + 답안 인식

    Args:
        second_pass: True이면 2차 검증용 관점 전환 프롬프트를 추가.
            1차와 다른 시각으로 보게 하여 동일 편향 반복을 방지.
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, AI_API_TIMEOUT, GEMINI_MODEL

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)
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

    second_pass_instruction = ""
    if second_pass:
        second_pass_instruction = """
★★ 2차 독립 검증 모드 ★★
이전 분석 결과는 잊고, 완전히 처음 보는 것처럼 독립적으로 분석하세요.

[가장 중요한 검증 항목]
1. "unanswered" 판별 재검증:
   - 각 문제의 보기 영역을 다시 봐주세요
   - 학생의 손글씨 표시(동그라미, 체크, 밑줄, 색칠)가 정말 있나요?
   - 인쇄된 보기만 있고 학생 표시가 없으면 → 반드시 "unanswered"
   - 인쇄 텍스트와 손글씨를 혼동하지 마세요!

2. 객관식 번호 재검증:
   - 동그라미 표시의 물리적 위치(좌우, 상하)를 기준으로 보기 번호 판단!
   - 보기 배치 확인 → 표시가 윗줄이면 ①②③, 아랫줄이면 ④⑤
   - ②와 ⑤ 혼동 주의! 반드시 위치 기반 판단 우선
   - 동그라미 안의 숫자 모양만으로 판단하지 말 것

3. 단답형: 풀이 과정의 중간값이 아닌 최종 답란/결과만 읽기
4. 흐릿하거나 겹친 글씨: 가장 위에 쓴 것(최종)만 읽기
5. 빈 문제: 정말 안 풀었는지 다시 확인 (작게 쓴 답을 놓치기 쉬움)
"""

    prompt = f"""이 학생 숙제/시험 사진을 분석해주세요.
{hint_section}{second_pass_instruction}
★ 페이지 유형 판별 ★
- "answer_sheet": 문제집/프린트물/시험지 (인쇄된 문제 번호, 교재 레이아웃이 보이는 페이지)
- "solution_only": 백지/노트 (인쇄 없이 손글씨만 있는 페이지)
- 확실하지 않으면 → "answer_sheet"

★★ 중요: "solution_only"라도 학생이 문제 번호를 적고 답을 쓴 것이 보이면 answers에 읽어주세요 ★★
(예: 백지에 "1. ③  2. 5  3(1) -2/3" 처럼 번호+답을 나열한 경우 → 그대로 읽기)

분석 순서:
1. 교재 정보: 페이지에 보이는 교재명, 페이지 번호, 단원명
2. 이 사진에 보이는 문제 번호만 나열 (사진에 없는 문제는 포함 금지!)
3. 각 문제마다: 학생의 손글씨 표시(동그라미/체크/밑줄/필기)가 있는지 확인 → 없으면 "unanswered"

★★★★ 최우선 규칙: "학생이 표시한 것"과 "인쇄된 것" 구분 ★★★★

인쇄된 텍스트: 깔끔하고 균일한 활자체, 완벽하게 정렬됨
학생 손글씨: 불규칙, 필압 차이, 펜 색상(검정/파랑/빨강), 동그라미/체크/밑줄

어떤 문제든 학생의 손글씨 표시(동그라미, 체크, 밑줄, 필기)가 전혀 없으면 → 반드시 "unanswered"
절대로 인쇄된 보기 번호나 보기 내용을 학생 답으로 읽지 마세요!

★★★ 객관식 답 읽기 (가장 중요!) ★★★

[STEP 1] 학생 표시 유무 확인
- 해당 문제의 보기(①②③④⑤) 영역에 학생의 손글씨 표시가 있는가?
- 동그라미(○), 체크(✓), 밑줄, 색칠 등이 있는가?
- 표시가 전혀 없으면 → "unanswered" (인쇄된 보기를 답으로 읽지 않기!)

[STEP 2] 표시 위치로 번호 결정 (핵심!)
- 학생의 표시(동그라미 등)가 어느 위치에 있는지 확인
- 그 위치에 인쇄된 보기 번호(①②③④⑤)를 읽기
- 동그라미 안의 숫자를 직접 읽는 것보다, 표시의 물리적 위치로 판단이 더 정확!

[STEP 3] 위치 기반 검증
- 한국 수능/모의고사 5지선다 보기 배치:
  * 1행 배치: ① ② ③ ④ ⑤ (좌→우)
  * 2행 배치: 윗줄 ① ② ③, 아랫줄 ④ ⑤
  * 세로 배치: ①(맨 위) → ⑤(맨 아래)
- 학생 표시가 아랫줄이면 ④ 또는 ⑤ (절대 ①②③이 아님!)
- 학생 표시가 윗줄 가운데면 ② (절대 ⑤가 아님!)

[STEP 4] ②↔⑤ 최종 확인
- 이 두 숫자는 동그라미 안에서 매우 비슷하게 보임
- 반드시 위치로 최종 판단: 윗줄이면 ②, 아랫줄이면 ⑤
- 동그라미 안 숫자만으로 판단하면 높은 확률로 틀림!

- 반드시 원형 숫자로 기록: ①②③④⑤ (일반 숫자 "1","2" 금지)
- 학생도 빨간펜/파란펜을 사용함! 보기에 동그라미/체크가 있으면 학생 답으로 읽기
- 선생님 채점 = O/X 기호, 점수(+5,-2) 등 → 이것만 구분해서 무시
- 두 개 표시 중 취소선 있는 것 제외, 남은 것이 최종
- ★ 백지에 손글씨로 번호+답만 나열한 경우: "1. ③" → 1번=③, "2) 5" → 2번=5

[단답형]
- 답란(빈칸/박스)에 적힌 최종값만 (풀이 과정 중간 계산값 ≠ 최종 답!)
- '답:', '∴', '=' 뒤의 최종값
- 분수, 루트, 음수, 좌표 등 학생이 적은 형태 그대로
- 답란에 학생 필기가 없으면 → "unanswered"

[서술형]
- 풀이 전체 + 최종 결론

[무시 목록]
- 인쇄된 보기 내용 자체 (학생 표시가 없는 인쇄물 ≠ 학생 답!)
- 풀이 과정 중간 숫자, 낙서, 메모, 취소선이 그어진 값
- 선생님 채점 표시 (빨간 O/X, 점수)
- 수정액/지우개 아래 흔적 (위에 다시 적은 것이 최종)

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{{"page_type": "answer_sheet", "textbook_info": {{"name": "교재명", "page": "45", "section": "단원명"}}, "answers": {{"1": "③", "2": "unanswered", "3": "24"}}, "full_text": "전체 인식 텍스트"}}"""

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
            "page_type": result.get("page_type", "answer_sheet"),
        }

    try:
        return await _retry_async(_call_gemini, label="Gemini OCR", max_retries=2)
    except Exception as e:
        logger.error(f"Gemini OCR 최종 실패: {e}")
        return {"textbook_info": {}, "answers": {}, "full_text": ""}


# ============================================================
# Gemini 더블체크 검증 (2회 독립 OCR → 비교 → 타이브레이크)
# ============================================================

async def cross_validate_ocr(
    image_bytes_list: list[bytes],
    ocr1_results: list[dict],
    expected_questions: list[str] | None = None,
    question_types: dict | None = None,
) -> list[dict]:
    """Gemini 2.5 Flash 2회 독립 OCR 교차 검증

    ocr1_results는 1차 Gemini OCR 결과. 내부에서 2차 Gemini OCR을 실행하여 비교.
    - 두 결과 일치 → confidence 95
    - 불일치 → confidence 60, 1차 결과 우선
    - confidence < 70 → 3차 Gemini 타이브레이크

    Returns:
        검증된 OCR 결과 리스트 (더블체크 형식: answers 값이 dict)
    """
    from config import OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE

    validated = []

    async def _noop():
        return None

    # 2차 OCR: solution_only이면서 답도 없는 이미지만 건너뜀
    ocr2_tasks = []
    for i, img in enumerate(image_bytes_list):
        r1 = ocr1_results[i] if i < len(ocr1_results) else {}
        is_empty_solution = (
            r1.get("page_type") == "solution_only"
            and not r1.get("answers")
        )
        if is_empty_solution:
            ocr2_tasks.append(_noop())
        else:
            ocr2_tasks.append(ocr_gemini(img, expected_questions=expected_questions, question_types=question_types, second_pass=True))
    ocr2_results = await asyncio.gather(*ocr2_tasks, return_exceptions=True)

    for idx, (r1, r2) in enumerate(zip(ocr1_results, ocr2_results)):
        is_empty_solution = (
            r1.get("page_type") == "solution_only"
            and not r1.get("answers")
        )
        if is_empty_solution:
            logger.info(f"[CrossVal] 이미지 {idx}: 풀이 노트 (답 없음) → 크로스 검증 건너뜀")
            result = _to_single_check_format(r1, source="ocr1")
            result["page_type"] = "solution_only"
            validated.append(result)
            continue

        if r1.get("page_type") == "solution_only" and r1.get("answers"):
            logger.info(f"[CrossVal] 이미지 {idx}: 풀이 노트지만 답 {len(r1['answers'])}개 → 크로스 검증 진행")

        if isinstance(r2, Exception):
            logger.warning(f"[CrossVal] 이미지 {idx} 2차 OCR 실패: {r2}")
            validated.append(_to_single_check_format(r1, source="ocr1"))
            continue

        r1_answers = normalize_answer_keys(r1.get("answers", {}))
        r2_answers = normalize_answer_keys(r2.get("answers", {}))

        # 1차 결과가 비어있으면 2차 결과 사용
        if not r1_answers and r2_answers:
            logger.info(f"[CrossVal] 이미지 {idx}: 1차 비어있음 → 2차 결과 사용")
            r2_norm = dict(r2)
            r2_norm["answers"] = r2_answers
            validated.append(_to_single_check_format(r2_norm, source="ocr2"))
            continue

        all_questions = set(list(r1_answers.keys()) + list(r2_answers.keys()))
        combined_answers = {}
        match_count = 0
        mismatch_count = 0

        for q in all_questions:
            v1 = _extract_answer_str(r1_answers.get(q, ""))
            v2 = _extract_answer_str(r2_answers.get(q, ""))

            if v1 == "unanswered" and v2 == "unanswered":
                combined_answers[q] = {
                    "answer": "unanswered",
                    "ocr1": v1, "ocr2": v2,
                    "match": True, "confidence": 95,
                }
                match_count += 1
                continue

            if v1 == "unanswered" and v2 and v2 != "unanswered":
                combined_answers[q] = {
                    "answer": v2, "ocr1": v1, "ocr2": v2,
                    "match": False, "confidence": 45,
                }
                mismatch_count += 1
                continue
            if v2 == "unanswered" and v1 and v1 != "unanswered":
                combined_answers[q] = {
                    "answer": v1, "ocr1": v1, "ocr2": v2,
                    "match": False, "confidence": 45,
                }
                mismatch_count += 1
                continue

            match = _fuzzy_ocr_match(v1, v2)
            if match:
                combined_answers[q] = {
                    "answer": v1, "ocr1": v1, "ocr2": v2,
                    "match": True, "confidence": 95,
                }
                match_count += 1
            elif v1 and v2:
                combined_answers[q] = {
                    "answer": v1, "ocr1": v1, "ocr2": v2,
                    "match": False, "confidence": 60,
                }
                mismatch_count += 1
            elif v1:
                combined_answers[q] = {
                    "answer": v1, "ocr1": v1, "ocr2": "",
                    "match": False, "confidence": 75,
                }
            elif v2:
                combined_answers[q] = {
                    "answer": v2, "ocr1": "", "ocr2": v2,
                    "match": False, "confidence": 70,
                }

        tb_r1 = r1.get("textbook_info", {})
        tb_r2 = r2.get("textbook_info", {})
        textbook_info = {
            "name": tb_r1.get("name") or tb_r2.get("name", ""),
            "page": tb_r1.get("page") or tb_r2.get("page", ""),
            "section": tb_r1.get("section") or tb_r2.get("section", ""),
        }

        logger.info(f"[CrossVal] 이미지 {idx}: "
                     f"{len(all_questions)}문제, 일치={match_count}, 불일치={mismatch_count}")

        # 3차 타이브레이크: confidence < 70인 불일치 항목
        low_conf_items = []
        for q, data in combined_answers.items():
            if data.get("confidence", 100) < 70 and not data.get("match"):
                low_conf_items.append(q)

        if low_conf_items and idx < len(image_bytes_list):
            max_items = max(0, OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE)
            if len(low_conf_items) > max_items:
                dropped = low_conf_items[max_items:]
                low_conf_items = low_conf_items[:max_items]
                logger.warning(
                    f"[Tiebreak] 이미지 {idx}: 저신뢰 {len(dropped)}개 항목은 시간 보호를 위해 건너뜀 {dropped}"
                )

            logger.info(f"[Tiebreak] 이미지 {idx}: {len(low_conf_items)}개 항목 3차 검증 시작 "
                        f"({low_conf_items})")
            q_types = question_types or {}
            tiebreak_tasks = [
                _tiebreak_ocr(
                    image_bytes_list[idx],
                    q,
                    combined_answers[q].get("ocr1", ""),
                    combined_answers[q].get("ocr2", ""),
                    q_type=q_types.get(q, "short"),
                )
                for q in low_conf_items
            ]
            tiebreak_results = await asyncio.gather(*tiebreak_tasks, return_exceptions=True)

            for q, tb_result in zip(low_conf_items, tiebreak_results):
                if isinstance(tb_result, Exception):
                    logger.warning(f"[Tiebreak] {q}번 실패: {tb_result}")
                    continue
                combined_answers[q]["answer"] = tb_result["answer"]
                combined_answers[q]["confidence"] = tb_result["confidence"]
                logger.debug(f"[Tiebreak] {q}번 갱신: '{tb_result['answer']}' (conf={tb_result['confidence']})")

        validated.append({
            "textbook_info": textbook_info,
            "answers": combined_answers,
            "full_text": r2.get("full_text", ""),
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


async def _tiebreak_ocr(
    image_bytes: bytes,
    question: str,
    ocr1_answer: str,
    ocr2_answer: str,
    q_type: str = "short",
) -> dict:
    """GPT-4o로 불일치 항목 중재 — Gemini 계열과 다른 모델로 systematic bias 상쇄

    두 OCR 결과(둘 다 Gemini)가 서로 다른 문제에 대해
    GPT-4o가 이미지를 다시 보고 어느 쪽이 맞는지 판별합니다.

    Returns:
        {"answer": "최종답", "confidence": 85~95}
    """
    from openai import AsyncOpenAI
    from config import (
        OPENAI_API_KEY,
        AI_API_TIMEOUT,
        OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION,
        OCR_TIEBREAK_FALLBACK_ON_REFUSAL,
    )

    if not OPENAI_API_KEY:
        logger.debug(f"[Tiebreak] OpenAI API 키 없음 → OCR1 채택 ({question}번)")
        return {"answer": ocr1_answer, "confidence": 60}

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    type_label = {"mc": "객관식(①~⑤)", "short": "단답형", "essay": "서술형"}.get(q_type, "단답형")

    unanswered_note = ""
    if ocr1_answer == "unanswered" or ocr2_answer == "unanswered":
        unanswered_note = (
            "\n★★ 중요: 한쪽이 'unanswered'입니다. ★★\n"
            "- 학생의 손글씨 표시(동그라미/체크/필기)가 정말로 있는지 신중히 확인하세요.\n"
            "- 인쇄된 보기 번호(①②③④⑤)만 있고 학생 표시가 없으면 → 'unanswered'가 맞습니다.\n"
            "- 인쇄 텍스트(깔끔한 활자)와 손글씨(불규칙, 필압 차이)를 확실히 구분하세요.\n"
        )

    mc_note = ""
    if q_type == "mc":
        mc_note = (
            "\n★ 객관식 위치 확인법 ★\n"
            "- 보기 배치 확인: 윗줄(①②③) vs 아랫줄(④⑤)\n"
            "- 학생 표시의 물리적 위치로 번호 결정 (동그라미 안 숫자 모양보다 위치가 정확)\n"
            "- ②↔⑤ 혼동 주의: 윗줄이면 ②, 아랫줄이면 ⑤\n"
        )

    prompt = (
        f"이 학생 숙제/시험 사진에서 {question}번 문제({type_label})의 학생 최종 답만 다시 확인해주세요.\n\n"
        f"두 OCR 결과가 서로 다릅니다:\n"
        f"- 결과A: \"{ocr1_answer}\"\n"
        f"- 결과B: \"{ocr2_answer}\"\n\n"
        f"{unanswered_note}{mc_note}"
        "이미지를 주의 깊게 확인하고, 학생이 실제로 적은/표시한 최종 답을 골라주세요.\n"
        "학생의 손글씨 표시가 전혀 없다면 반드시 'unanswered'로 답하세요.\n"
        "둘 다 틀렸다면 이미지에서 직접 읽은 정확한 답을 알려주세요.\n\n"
        "반드시 아래 JSON만 응답 (다른 텍스트 없이):\n"
        '{"answer": "최종답", "confidence": 85}'
    )

    try:
        client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=AI_API_TIMEOUT)
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
            ]}
        ]

        last_err = None
        max_attempts = max(1, OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION)
        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    max_tokens=256,
                    temperature=0.1,
                )
                text = response.choices[0].message.content.strip()
                low = text.lower()
                if OCR_TIEBREAK_FALLBACK_ON_REFUSAL and (
                    "can't assist" in low
                    or "cannot assist" in low
                    or "i'm sorry" in low
                ):
                    logger.warning(
                        f"[Tiebreak-GPT4o] {question}번 거부 응답 감지 → 즉시 OCR1 채택"
                    )
                    return {"answer": ocr1_answer, "confidence": 60}

                parsed = _robust_json_parse(text)
                if parsed and isinstance(parsed, dict) and "answer" in parsed:
                    confidence = min(95, max(70, parsed.get("confidence", 85)))
                    logger.info(f"[Tiebreak-GPT4o] {question}번: '{ocr1_answer}' vs '{ocr2_answer}' → '{parsed['answer']}' (conf={confidence})")
                    return {"answer": str(parsed["answer"]), "confidence": confidence}

                logger.warning(f"[Tiebreak-GPT4o] {question}번 응답 파싱 실패: {text[:200]}")
                return {"answer": ocr1_answer, "confidence": 60}
            except Exception as e:
                last_err = e
                if attempt < max_attempts:
                    await asyncio.sleep(1)
                    continue
        raise last_err

    except Exception as e:
        logger.warning(f"[Tiebreak-GPT4o] {question}번 실패: {e} → OCR1 채택")
        return {"answer": ocr1_answer, "confidence": 60}


def _to_single_check_format(ocr_result: dict, source: str = "ocr1") -> dict:
    """단일 OCR 결과를 크로스 검증 형식으로 변환"""
    answers = normalize_answer_keys(ocr_result.get("answers", {}))
    converted = {}
    base_conf = 85
    for k, v in answers.items():
        val = _extract_answer_str(v)
        converted[k] = {
            "answer": val,
            "ocr1": val if source == "ocr1" else "",
            "ocr2": val if source == "ocr2" else "",
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
    from config import GEMINI_API_KEY, AI_API_TIMEOUT, GEMINI_MODEL

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

    model = genai.GenerativeModel(GEMINI_MODEL)
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
