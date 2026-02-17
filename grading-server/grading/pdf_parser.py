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
            if total_pages <= 30:
                page_indices = list(range(total_pages))
                logger.info(f"전체 {total_pages}p 처리 (30p 이하)")
            else:
                # 30p 초과인데 정답 페이지를 못 찾으면 뒤쪽 30p만 처리
                page_indices = list(range(max(0, total_pages - 30), total_pages))
                logger.info(f"전체 {total_pages}p 중 뒤쪽 30p 처리 (정답은 보통 뒷부분)")

    page_images = _pdf_to_images(pdf_bytes, page_indices=page_indices)
    if not page_images:
        raise Exception("PDF를 이미지로 변환할 수 없습니다")

    logger.info(f"PDF {len(page_images)}페이지를 이미지로 변환 완료")

    parts = []
    parts.append(f"""이 PDF는 학원 교재/프린트의 정답 또는 해설 부분입니다.

가능한 구조:
1) 프린트 과제: 문제 → 빠른정답 → 해설
2) 시중 교재: 문제 → 해설 (해설에 정답 포함)

이 이미지들에서 각 문제의 정답을 추출해주세요.

우선순위:
1. "빠른정답" 페이지가 있으면 거기서 정답을 가져오세요
2. 해설 페이지에서 각 문제의 정답을 확인하세요
3. 문제 페이지만 있고 정답이 없으면 추론하지 마세요

추출 규칙:
- 객관식: 문제번호와 정답 보기 (①②③④⑤ 또는 1,2,3,4,5)
- 단답형: 문제번호와 정답 값 (숫자, 수식, 단어 등)
- 서술형: 문제번호와 모범답안 핵심 내용 (간결하게)

{f'예상 총 문제 수: {total_hint}' if total_hint else ''}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{{"answers": {{"1": "③", "2": "12", "3": "정답텍스트"}}, "types": {{"1": "mc", "2": "short", "3": "essay"}}, "total": 문제수}}

mc=객관식, short=단답형, essay=서술형""")

    for img_bytes in page_images:
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        parts.append({"mime_type": "image/png", "data": b64})

    response = model.generate_content(parts)
    text = response.text.strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    result = json.loads(text.strip())
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

    정답 키워드가 포함된 첫 페이지부터 마지막 페이지까지 반환
    """
    answer_start = None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i, page in enumerate(doc):
            text = page.get_text("text")
            if not text:
                continue

            first_300 = text[:300].replace(" ", "")
            for keyword in ANSWER_PAGE_KEYWORDS:
                kw_clean = keyword.replace(" ", "")
                if kw_clean in first_300:
                    answer_start = i
                    break

            if answer_start is not None:
                break

        if answer_start is not None:
            total = len(doc)
            doc.close()
            indices = list(range(answer_start, min(answer_start + 50, total)))
            logger.info(f"정답 페이지 자동 탐색: {answer_start + 1}p ~ {indices[-1] + 1}p (전체 {total}p)")
            return indices

        doc.close()
    except Exception as e:
        logger.error(f"정답 페이지 탐색 실패: {e}")

    return []


def _pdf_to_images(
    pdf_bytes: bytes,
    page_indices: list[int] | None = None,
) -> list[bytes]:
    """PDF 특정 페이지들을 PNG 이미지로 변환 (PyMuPDF 사용)"""
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
            mat = fitz.Matrix(200 / 72, 200 / 72)  # 200 DPI
            pix = page.get_pixmap(matrix=mat)
            images.append(pix.tobytes("png"))

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
