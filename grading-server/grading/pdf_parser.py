"""정답 PDF 파싱: Mathpix 1순위 → Gemini Vision 폴백으로 정답 추출

엔진 우선순위 (PDF_EXTRACTION_PRIMARY로 강제 가능):
1) Mathpix /v3/pdf (인쇄된 수식·텍스트에 강점, 충전량 부족 시 자동 비활성)
2) Gemini Vision (이미지 변환 → 비전 OCR + 정답 JSON 직접 생성)
3) pdfplumber 텍스트 → Gemini 텍스트 파싱 (둘 다 실패 시)

지원하는 교재 구조:
- 프린트 과제: 문제 → 빠른정답 → 해설
- 시중 교재: 문제 → 해설 (해설에 정답 포함)

페이지 범위가 지정되면 해당 페이지만 처리 (시중 교재 200p+ 대응)
"""
import logging
import json
import re
import base64
import io
import fitz  # PyMuPDF
import pdfplumber
from integrations.gemini import parse_answers_from_pdf
from ocr import mathpix

logger = logging.getLogger(__name__)

# 정답/해설 페이지를 식별하는 키워드
ANSWER_PAGE_KEYWORDS = [
    "빠른정답", "빠른 정답", "정답", "답안", "해설", "풀이",
    "정답 및 해설", "정답과 해설", "Answer", "Solutions",
    "정답·해설", "정답과풀이", "정답및풀이",
]


async def extract_answers_from_pdf(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict:
    """PDF에서 정답 추출 (Gemini Vision 우선, 텍스트 fallback)

    Args:
        pdf_bytes: PDF 파일 바이트
        total_hint: 예상 총 문제 수 (힌트)
        page_range: (시작페이지, 끝페이지) 1-based. 예: (45, 48)

    Returns:
        {"answers": {...}, "types": {...}, "total": int,
         "page_images": [{"page": 1, "image_bytes": bytes}, ...]}
    """
    primary = await _resolve_primary_engine()
    result = None

    # 1차: Mathpix (primary=mathpix일 때만)
    if primary == "mathpix":
        try:
            result = await _extract_with_mathpix(pdf_bytes, total_hint, page_range)
            if result and result.get("total", 0) > 0:
                logger.info(f"[Mathpix] 정답 추출 완료: {result['total']}문제")
            else:
                logger.warning("[Mathpix] 정답 0건 → Gemini Vision 폴백")
                result = None
        except Exception as e:
            logger.warning(f"[Mathpix] 예외 발생, Gemini Vision 폴백: {e}")
            result = None

    # 2차: Gemini Vision (primary=gemini이거나 Mathpix가 실패/소진된 경우)
    if not result:
        try:
            result = await _extract_with_gemini_vision(pdf_bytes, total_hint, page_range)
            if result.get("total", 0) > 0:
                logger.info(f"[Vision] 정답 추출 완료: {result['total']}문제")
            else:
                logger.warning("[Vision] 정답을 찾지 못함, 마지막 페이지 답안표 전용 재시도")
                result = None
        except Exception as e:
            logger.warning(f"[Vision] 실패: {e}, 마지막 페이지 답안표 전용 재시도")

    # 2.5차 fallback: 마지막 1~3 페이지를 "답안표 전용" 프롬프트로 재시도.
    # 일반 Vision 프롬프트는 "보기(①②③④⑤)가 있는 문제만 mc"로 보수적이라
    # 빠른정답 페이지처럼 "1) [정답] ② / 2) [정답] ①" 형태(보기 없음, 답만 나열)
    # 에서 0건 반환하는 경우가 있어 답안표 전용 프롬프트로 회수율 보강.
    # page_range가 명시되지 않은 경우만 발동 (사용자가 범위 지정했으면 그 안에서만).
    if not result and not page_range:
        try:
            result = await _extract_tail_answer_table(pdf_bytes, total_hint)
            if result and result.get("total", 0) > 0:
                logger.info(f"[Tail] 마지막 페이지 답안표 추출 완료: {result['total']}문제")
            else:
                result = None
        except Exception as e:
            logger.warning(f"[Tail] 실패: {e}, 텍스트 방식으로 재시도")

    # 3차 fallback: pdfplumber 텍스트 추출 → Gemini 텍스트 파싱
    if not result:
        text = _extract_text_from_pdf(pdf_bytes, page_range)
        if not text.strip():
            logger.warning("PDF에서 텍스트를 추출할 수 없습니다")
            result = {"answers": {}, "types": {}, "total": 0}
        else:
            result = await parse_answers_from_pdf(text, total_hint)
            logger.info(f"[Text] 정답 추출 완료: {result.get('total', 0)}문제")

    # 정답 추출 후 전체 페이지 썸네일 생성 (백그라운드 Drive 업로드용)
    page_images = _pdf_to_thumbnails(pdf_bytes)
    logger.info(f"[Thumbnails] {len(page_images)}페이지 썸네일 생성 완료")
    result["page_images"] = page_images

    return result


async def _resolve_primary_engine() -> str:
    """PDF 정답 추출 1순위 엔진 결정.

    PDF_EXTRACTION_PRIMARY 명시값 > Mathpix 가용성 > "gemini"
    """
    from config import PDF_EXTRACTION_PRIMARY
    forced = (PDF_EXTRACTION_PRIMARY or "").strip().lower()
    if forced in ("mathpix", "gemini"):
        if forced == "mathpix" and not await mathpix.is_usable_for_ocr():
            logger.info("[Engine] PDF_EXTRACTION_PRIMARY=mathpix 지정됐으나 사용 불가 → gemini 사용")
            return "gemini"
        return forced

    if await mathpix.is_usable_for_ocr():
        return "mathpix"
    return "gemini"


async def _extract_with_mathpix(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict | None:
    """Mathpix /v3/pdf 로 PDF → MMD 텍스트 추출 후 Gemini로 정답 JSON 파싱.

    page_range가 지정되면 해당 페이지만 잘라 보내 Mathpix 호출 비용을 줄인다.
    quota 에러는 mathpix 모듈이 자동으로 exhausted 마킹하므로 호출자는
    None만 반환받으면 다음 엔진(Gemini Vision)으로 자연 폴백된다.
    """
    target_bytes = pdf_bytes
    if page_range:
        sliced = _slice_pdf(pdf_bytes, page_range)
        if sliced:
            target_bytes = sliced
            logger.info(f"[Mathpix] page_range {page_range} 슬라이스: "
                        f"{len(pdf_bytes)//1024}KB → {len(target_bytes)//1024}KB")
        else:
            logger.warning(f"[Mathpix] page_range 슬라이스 실패, 전체 PDF로 진행")

    res = await mathpix.ocr_pdf(target_bytes, output_format="mmd")
    if not res.get("ok"):
        if res.get("quota_exceeded"):
            logger.warning(f"[Mathpix] 충전량 소진 감지 → 이후 호출 자동 차단: {res.get('error')}")
        else:
            logger.warning(f"[Mathpix] PDF OCR 실패: {res.get('error')}")
        return None

    mmd_text = (res.get("text") or "").strip()
    if not mmd_text:
        logger.warning("[Mathpix] 빈 결과 텍스트")
        return None

    parsed = await parse_answers_from_pdf(mmd_text, total_hint)
    answers = parsed.get("answers") or {}
    types = parsed.get("types") or {}
    answers, types = _validate_answer_types(answers, types)
    return {
        "answers": answers,
        "types": types,
        "total": len(answers),
    }


def _slice_pdf(pdf_bytes: bytes, page_range: tuple[int, int]) -> bytes | None:
    """page_range(1-based, 양끝 포함)에 해당하는 페이지만 가진 PDF 바이트 반환."""
    try:
        src = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            total = len(src)
            start = max(0, page_range[0] - 1)
            end = min(total, page_range[1]) - 1
            if start > end:
                return None
            dst = fitz.open()
            try:
                dst.insert_pdf(src, from_page=start, to_page=end)
                return dst.tobytes()
            finally:
                dst.close()
        finally:
            src.close()
    except Exception as e:
        logger.warning(f"[Mathpix] PDF 슬라이스 실패: {e}")
        return None


async def _extract_with_gemini_vision(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict:
    """PDF 페이지를 이미지로 변환 후 Gemini Vision으로 정답 추출"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # 페이지 범위 결정
    if page_range:
        page_indices = _range_to_indices(page_range)
        logger.info(f"지정된 정답 페이지: {page_range[0]}~{page_range[1]}p")
    else:
        page_indices = _find_answer_page_indices(pdf_bytes)
        if page_indices:
            logger.info(f"자동 탐색된 정답 페이지: {[i+1 for i in page_indices]}")
        else:
            total_pages = _get_total_pages(pdf_bytes)
            if total_pages <= 10:
                page_indices = list(range(total_pages))
                logger.info(f"전체 {total_pages}p 처리 (10p 이하)")
            else:
                # 정답 페이지를 못 찾으면 뒤쪽 5p만 처리
                page_indices = list(range(max(0, total_pages - 5), total_pages))
                logger.info(f"전체 {total_pages}p 중 뒤쪽 5p 처리 (정답은 보통 뒷부분)")

    CHUNK_SIZE = 15

    # 15페이지 이하면 한 번에 처리, 초과하면 청크 분할
    if len(page_indices) <= CHUNK_SIZE:
        chunks = [page_indices]
    else:
        chunks = [
            page_indices[i:i + CHUNK_SIZE]
            for i in range(0, len(page_indices), CHUNK_SIZE)
        ]
        logger.info(f"대용량 PDF: {len(page_indices)}페이지 → {len(chunks)}개 청크로 분할 처리")

    all_answers = {}
    all_types = {}

    for chunk_idx, chunk_indices in enumerate(chunks):
        page_images = _pdf_to_images(pdf_bytes, page_indices=chunk_indices)
        if not page_images:
            logger.warning(f"청크 {chunk_idx+1}: 이미지 변환 실패, 건너뜀")
            continue

        chunk_label = f"청크 {chunk_idx+1}/{len(chunks)}" if len(chunks) > 1 else "단일"
        logger.info(f"[{chunk_label}] {len(page_images)}페이지 이미지 변환 완료")

        hint_text = ""
        if total_hint and len(chunks) == 1:
            hint_text = f"예상 총 문제 수: {total_hint}"
        elif len(chunks) > 1:
            hint_text = f"이 이미지는 전체 답지의 일부입니다 ({chunk_label}). 보이는 문제의 정답만 추출하세요."

        parts = []
        parts.append(f"""이 이미지들은 수학 교재/프린트의 정답 또는 해설 페이지입니다.

각 문제의 **최종 정답만** 추출해주세요. 풀이 과정은 무시하세요.

정답 찾는 방법:
- "빠른정답" 표가 있으면 → 거기서 바로 추출 (가장 효율적)
- 해설 페이지에서 → 각 문제 번호 옆의 최종 답만 추출
- 정답이 보이지 않는 문제는 건너뛰세요 (추론하지 마세요)

문제번호 규칙:
- "001", "002" 같은 번호 → "1", "2"로 변환
- 소문제가 있으면 → "1(1)", "1(2)" 형태로 (하이픈: "1-1" → "1(1)")
- 단원별로 번호가 초기화되더라도 그대로 유지

★★★ 유형 판별 기준 (매우 중요 - 반드시 따르세요) ★★★
판별 핵심: "문제에 보기(①②③④⑤)가 있고, 그 중 하나를 고르는 문제인가?"

mc (객관식):
- 보기 ①②③④⑤가 있고 하나를 고르는 문제
- 정답을 반드시 원형 숫자로 기록: "①", "②", "③", "④", "⑤"
- 절대 "3"이라고 쓰지 마세요 → 반드시 "③"

short (단답형):
- 숫자, 수식, 단어를 직접 써넣는 문제 (빈칸, "구하시오", "값은?" 등)
- 정답을 있는 그대로 기록: "3", "-5", "2√3", "14", "(1) 14 (2) -3"
- ★ 정답이 1~5 사이 숫자여도, 보기 선택이 아니면 short!
- 프린트/워크시트의 빈칸 채우기, 답 구하기는 모두 short

essay (서술형): 풀이 과정을 서술하는 문제

{hint_text}

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{{"answers": {{"1": "③", "2": "12", "3": "-3", "4(1)": "14", "4(2)": "2√3"}}, "types": {{"1": "mc", "2": "short", "3": "short", "4(1)": "short", "4(2)": "short"}}, "total": 문제수}}""")

        for i, img_bytes in enumerate(page_images):
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            parts.append({"mime_type": "image/jpeg", "data": b64})
            logger.info(f"  [{chunk_label}] 페이지 {i+1}: {len(img_bytes)//1024}KB")

        total_size = sum(len(b) for b in page_images)
        logger.info(f"[{chunk_label}] Gemini Vision 요청: {len(page_images)}페이지, 총 {total_size//1024}KB")

        response = model.generate_content(parts)
        text = response.text.strip()
        logger.info(f"[{chunk_label}] Gemini Vision 응답: {text[:200]}")

        from ocr.engines import _robust_json_parse
        chunk_result = _robust_json_parse(text)
        if not chunk_result or not isinstance(chunk_result, dict):
            logger.warning(f"[{chunk_label}] JSON 파싱 실패, 건너뜀")
            continue

        # 청크별 결과 병합
        chunk_answers = chunk_result.get("answers", {})
        chunk_types = chunk_result.get("types", {})
        all_answers.update(chunk_answers)
        all_types.update(chunk_types)
        logger.info(f"[{chunk_label}] {len(chunk_answers)}문제 추출 (누적: {len(all_answers)}문제)")

    all_answers, all_types = _validate_answer_types(all_answers, all_types)

    result = {
        "answers": all_answers,
        "types": all_types,
        "total": len(all_answers),
    }
    return result


async def _extract_tail_answer_table(
    pdf_bytes: bytes,
    total_hint: int | None = None,
) -> dict | None:
    """마지막 2~3 페이지를 "답안표 전용" 프롬프트로 시도하는 fallback.

    배경: 일반 Vision 추출은 "정답이 안 보이면 건너뛰라"는 보수적 프롬프트라
    빠른정답 페이지에 헤더("빠른정답" 등)가 없거나 컴팩트한 표만 있으면
    Gemini 가 답을 안 뽑는 경우가 있다. 사용자 양식이 보통 "문제+빠른정답"
    구조라, 마지막 1~3 페이지를 답안표 전용 프롬프트로 한 번 더 시도해
    회수율을 끌어올린다.
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    total = _get_total_pages(pdf_bytes)
    if total == 0:
        return None
    # 마지막 1~3 페이지 (전체 페이지 수에 따라)
    tail_count = min(3, total)
    tail_indices = list(range(total - tail_count, total))

    images = _pdf_to_images(pdf_bytes, page_indices=tail_indices)
    if not images:
        return None

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    hint_line = f"예상 총 문제 수: {total_hint}" if total_hint else ""
    prompt = f"""이 이미지는 수학 문제집 PDF의 **마지막 {tail_count}페이지**입니다.
여기에 **빠른정답표 / 답안표 / 정답표**가 있는지 보고, 있다면 **모든 답**을 추출하세요.

답안표는 보통 이런 형태입니다:
- 작은 표·격자에 "1. ③  2. ①  3. ②  ..." 같이 번호와 답이 짝지어진 형태
- 또는 "1) ③  2) ①  3) ②" / "1 ③  2 ①  3 ②"
- 헤더가 "빠른정답", "정답", "정답표" 등일 수도, **헤더 없이 표만** 있을 수도 있음

★ 헤더가 없어도 됩니다 — **번호 + 답이 짝지어진 패턴**만 보이면 추출.
★ 풀이/해설은 무시하세요. 빠른정답 표가 우선.

문제번호 규칙:
- 1, 2, 3 ... 그대로
- 소문제는 "1(1)", "1(2)" 형식
- 단원/교시별로 번호가 초기화되더라도 그대로 유지

답 형식 규칙:
- 객관식(원형숫자 보기 ①②③④⑤): "①" "②" "③" "④" "⑤" 그대로 → type=mc
- 단답형(빈칸·구하시오·수식): "3", "-5", "14", "2√3" 그대로 → type=short
- 숫자만 적혀 있으면 short, 원형숫자면 mc

{hint_line}

**답안표가 전혀 안 보이면 빈 객체 반환**:
{{"answers": {{}}, "types": {{}}, "total": 0}}

답안표가 있으면 JSON 형식으로만 응답:
{{"answers": {{"1": "③", "2": "12", ...}}, "types": {{"1": "mc", "2": "short", ...}}, "total": 문제수}}"""

    parts = [prompt]
    for img_bytes in images:
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        parts.append({"mime_type": "image/jpeg", "data": b64})

    total_size = sum(len(b) for b in images)
    logger.info(f"[Tail] 마지막 {tail_count}p 답안표 전용 추출 시도 ({total_size//1024}KB)")

    try:
        response = model.generate_content(parts)
        text = (response.text or "").strip()
        logger.info(f"[Tail] 응답: {text[:200]}")

        from ocr.engines import _robust_json_parse
        result = _robust_json_parse(text)
        if not result or not isinstance(result, dict):
            logger.warning("[Tail] JSON 파싱 실패")
            return None

        answers = result.get("answers") or {}
        types = result.get("types") or {}
        if not answers:
            logger.info("[Tail] 답안표 미발견 (빈 응답)")
            return None
        answers, types = _validate_answer_types(answers, types)
        logger.info(f"[Tail] 답안표 추출 성공: {len(answers)}문제")
        return {
            "answers": answers,
            "types": types,
            "total": len(answers),
        }
    except Exception as e:
        logger.warning(f"[Tail] 추출 실패: {e}")
        return None


def _validate_answer_types(answers: dict, types: dict) -> tuple[dict, dict]:
    """AI가 분류한 문제 유형을 검증·보정

    규칙:
    - 정답이 ①②③④⑤ → mc 확정
    - type=mc인데 정답이 "1"~"5" → mc 유지 + 원형 숫자로 변환
    - type=mc인데 정답이 6 이상 / 음수 / 수식 → short로 보정
    - type=short인데 정답이 ①②③④⑤ → mc로 보정
    """
    CIRCLE_NUMS = {"①", "②", "③", "④", "⑤"}
    NUM_TO_CIRCLE = {"1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤"}

    fixed_answers = dict(answers)
    fixed_types = dict(types)
    fix_count = 0

    for q, ans in answers.items():
        raw = str(ans).strip()
        qtype = fixed_types.get(q, "mc")

        if qtype == "essay":
            continue

        has_circle = any(c in raw for c in CIRCLE_NUMS)

        if qtype == "mc":
            if has_circle:
                pass
            elif raw in NUM_TO_CIRCLE:
                fixed_answers[q] = NUM_TO_CIRCLE[raw]
            else:
                fixed_types[q] = "short"
                fix_count += 1

        elif qtype == "short" and has_circle and len(raw) <= 2:
            fixed_types[q] = "mc"
            fix_count += 1

    if fix_count:
        logger.info(f"[TypeFix] {fix_count}건 유형 보정 완료")

    return fixed_answers, fixed_types


# ────────────────────────────────────────
# 유틸리티 함수들
# ────────────────────────────────────────

def _range_to_indices(page_range: tuple[int, int]) -> list[int]:
    """1-based 페이지 범위를 0-based 인덱스 리스트로 변환"""
    start = max(0, page_range[0] - 1)
    end = page_range[1]
    return list(range(start, end))


def _get_total_pages(pdf_bytes: bytes) -> int:
    """PDF 총 페이지 수 반환"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    count = len(doc)
    doc.close()
    return count


def _find_answer_page_indices(pdf_bytes: bytes) -> list[int]:
    """PDF에서 정답/해설 페이지를 자동 탐색 (키워드 기반)

    우선순위:
    1. "빠른정답" 페이지 → 해당 페이지 + 2페이지 (보통 1~3p)
    2. "정답" 페이지 → 해당 페이지 + 4페이지
    3. "해설" 페이지 → 해당 페이지 + 7페이지 (해설은 좀 더 필요)
    """
    QUICK_ANSWER_KEYWORDS = ["빠른정답", "빠른 정답", "정답과풀이", "정답및풀이", "정답·해설"]
    ANSWER_KEYWORDS = ["정답", "답안", "Answer", "Solutions", "정답 및 해설", "정답과 해설"]
    EXPLANATION_KEYWORDS = ["해설", "풀이"]

    quick_start = None
    answer_start = None
    explanation_start = None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            total = len(doc)

            for i, page in enumerate(doc):
                text = page.get_text("text")
                if not text:
                    continue

                first_300 = text[:300].replace(" ", "")

                if quick_start is None:
                    for kw in QUICK_ANSWER_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            quick_start = i
                            break

                if answer_start is None and quick_start is None:
                    for kw in ANSWER_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            answer_start = i
                            break

                if explanation_start is None:
                    for kw in EXPLANATION_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            explanation_start = i
                            break
        finally:
            doc.close()

        # ── 케이스 1: 빠른정답 발견 → 해설 시작 전까지 ──
        if quick_start is not None:
            if explanation_start and explanation_start > quick_start:
                end = explanation_start
            else:
                end = min(quick_start + 10, total)
            indices = list(range(quick_start, end))
            logger.info(f"[빠른정답] 발견: {quick_start+1}p ~ {end}p (전체 {total}p, {len(indices)}페이지 처리)")
            return indices

        # ── 케이스 2: 답지 전용 PDF 감지 ──
        # 정답/해설 키워드가 첫 2페이지 내에서 발견되면
        # PDF 전체가 답지인 것으로 판단 → 전체 페이지 사용
        is_answer_only_pdf = False
        if answer_start is not None and answer_start <= 1:
            is_answer_only_pdf = True
        elif explanation_start is not None and explanation_start <= 1:
            is_answer_only_pdf = True

        if is_answer_only_pdf:
            indices = list(range(total))
            logger.info(f"[답지 전용 PDF] 감지: 전체 {total}p 처리 (정답이 1p부터 시작)")
            return indices

        # ── 케이스 3: 전체 교재 (문제+정답 합본) ──
        # 정답 섹션이 교재 뒷부분에 있으면 → 정답 시작부터 끝까지 전부
        if answer_start is not None:
            end = total
            indices = list(range(answer_start, end))
            logger.info(f"[전체교재→정답섹션] {answer_start+1}p ~ {end}p (전체 {total}p, 정답 {len(indices)}페이지 처리)")
            return indices

        # ── 케이스 4: 해설만 발견 → 해설부터 끝까지 ──
        if explanation_start is not None:
            end = total
            indices = list(range(explanation_start, end))
            logger.info(f"[전체교재→해설섹션] {explanation_start+1}p ~ {end}p (전체 {total}p, 해설 {len(indices)}페이지 처리)")
            return indices

    except Exception as e:
        logger.error(f"정답 페이지 탐색 실패: {e}")

    return []


def _pdf_to_images(
    pdf_bytes: bytes,
    page_indices: list[int] | None = None,
) -> list[bytes]:
    """PDF 특정 페이지들을 JPEG 이미지로 변환 (PyMuPDF 사용)"""
    from PIL import Image
    images = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total = len(doc)

        if page_indices is None:
            page_indices = list(range(min(30, total)))

        for i in page_indices:
            if i >= total:
                continue
            page = doc[i]
            mat = fitz.Matrix(220 / 72, 220 / 72)  # 220 DPI (수학 기호/분수 정확도 향상)
            pix = page.get_pixmap(matrix=mat)
            # PNG → JPEG 변환 (파일 크기 대폭 감소)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=80)
            images.append(buf.getvalue())

        doc.close()
        logger.info(f"PDF→이미지 변환: {len(images)}페이지 (전체 {total}p 중)")
    except Exception as e:
        logger.error(f"PDF→이미지 변환 실패 (PyMuPDF): {e}")
    return images


def _pdf_to_thumbnails(
    pdf_bytes: bytes,
) -> list[dict]:
    """PDF 전체 페이지를 썸네일로 변환 (base64 data URL로 DB 직접 저장용)

    Returns:
        [{"page": 1, "image_bytes": bytes}, ...]  (page는 1-based)
    """
    from PIL import Image
    thumbnails = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total = len(doc)

        for i in range(total):
            page = doc[i]
            mat = fitz.Matrix(200 / 72, 200 / 72)  # 200 DPI
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            thumbnails.append({
                "page": i + 1,
                "image_bytes": buf.getvalue(),
            })

        doc.close()
        logger.info(f"PDF→썸네일: 전체 {total}페이지 변환 완료")
    except Exception as e:
        logger.error(f"PDF→썸네일 변환 실패: {e}")
    return thumbnails


def _extract_text_from_pdf(
    pdf_bytes: bytes,
    page_range: tuple[int, int] | None = None,
) -> str:
    """PDF에서 텍스트 추출 (pdfplumber, fallback용)"""
    text_parts = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = pdf.pages
            if page_range:
                start = max(0, page_range[0] - 1)
                end = min(len(pages), page_range[1])
                pages = pages[start:end]

            for page in pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
    except Exception as e:
        logger.error(f"PDF 텍스트 추출 실패: {e}")
    return "\n\n".join(text_parts)
