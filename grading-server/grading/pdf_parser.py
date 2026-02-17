"""정답 PDF 파싱: Gemini Vision으로 PDF 페이지를 이미지로 읽어 정답 추출

지원하는 교재 구조:
1) 프린트 과제: 문제 → 빠른정답 → 해설
2) 시중 교재: 문제 → 해설 (해설에 정답 포함)

페이지 범위가 지정되면 해당 페이지만 처리 (시중 교재 200p+ 대응)
페이지 미지정 시 자동으로 정답/해설 페이지 탐색
"""
import logging
import json
import re
import base64
import io
import fitz  # PyMuPDF
import pdfplumber
from integrations.gemini import parse_answers_from_pdf

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
        {"answers": {...}, "types": {...}, "total": int}
    """
    # 1차: Gemini Vision으로 정답 추출
    try:
        result = await _extract_with_gemini_vision(pdf_bytes, total_hint, page_range)
        if result.get("total", 0) > 0:
            logger.info(f"[Vision] 정답 추출 완료: {result['total']}문제")
            return result
        logger.warning("[Vision] 정답을 찾지 못함, 텍스트 방식으로 재시도")
    except Exception as e:
        logger.warning(f"[Vision] 실패: {e}, 텍스트 방식으로 재시도")

    # 2차 fallback: pdfplumber 텍스트 추출 → Gemini 텍스트 파싱
    text = _extract_text_from_pdf(pdf_bytes, page_range)
    if not text.strip():
        logger.warning("PDF에서 텍스트를 추출할 수 없습니다")
        return {"answers": {}, "types": {}, "total": 0}

    result = await parse_answers_from_pdf(text, total_hint)
    logger.info(f"[Text] 정답 추출 완료: {result.get('total', 0)}문제")
    return result


async def _extract_with_gemini_vision(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict:
    """PDF 페이지를 이미지로 변환 후 Gemini Vision으로 정답 추출"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

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
        parts.append(f"""이 PDF는 학원 교재/프린트의 정답 또는 해설 부분입니다.

가능한 구조:
1) 프린트 과제: 문제 → 빠른정답 → 해설
2) 시중 교재: 정답과 해설이 함께 있음 (각 문제의 풀이에서 정답 확인)

이 이미지들에서 각 문제의 정답을 추출해주세요.

우선순위:
1. "빠른정답" 페이지가 있으면 거기서 정답을 가져오세요
2. 해설 페이지에서 각 문제의 정답을 확인하세요
3. 문제 페이지만 있고 정답이 없으면 추론하지 마세요

추출 규칙:
- 객관식: 문제번호와 정답 보기 (①②③④⑤ 또는 1,2,3,4,5)
- 단답형: 문제번호와 정답 값 (숫자, 수식, 단어 등)
- 서술형: 문제번호와 모범답안 핵심 내용 (간결하게)

{hint_text}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{{"answers": {{"1": "③", "2": "12", "3": "정답텍스트"}}, "types": {{"1": "mc", "2": "short", "3": "essay"}}, "total": 문제수}}

mc=객관식, short=단답형, essay=서술형""")

        for i, img_bytes in enumerate(page_images):
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            parts.append({"mime_type": "image/jpeg", "data": b64})
            logger.info(f"  [{chunk_label}] 페이지 {i+1}: {len(img_bytes)//1024}KB")

        total_size = sum(len(b) for b in page_images)
        logger.info(f"[{chunk_label}] Gemini Vision 요청: {len(page_images)}페이지, 총 {total_size//1024}KB")

        response = model.generate_content(parts)
        text = response.text.strip()
        logger.info(f"[{chunk_label}] Gemini Vision 응답: {text[:200]}")

        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        chunk_result = json.loads(text.strip())

        # 청크별 결과 병합
        chunk_answers = chunk_result.get("answers", {})
        chunk_types = chunk_result.get("types", {})
        all_answers.update(chunk_answers)
        all_types.update(chunk_types)
        logger.info(f"[{chunk_label}] {len(chunk_answers)}문제 추출 (누적: {len(all_answers)}문제)")

    result = {
        "answers": all_answers,
        "types": all_types,
        "total": len(all_answers),
    }
    return result


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

        # ── 케이스 3: 교재 뒷부분에 정답 섹션 ──
        if answer_start is not None:
            end = min(answer_start + 8, total)
            indices = list(range(answer_start, end))
            logger.info(f"[정답] 발견: {answer_start+1}p ~ {end}p (전체 {total}p, {len(indices)}페이지 처리)")
            return indices

        # ── 케이스 4: 해설만 발견 ──
        if explanation_start is not None:
            end = min(explanation_start + 8, total)
            indices = list(range(explanation_start, end))
            logger.info(f"[해설] 발견: {explanation_start+1}p ~ {end}p (전체 {total}p, {len(indices)}페이지 처리)")
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
            mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI (충분한 해상도 + 작은 크기)
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
