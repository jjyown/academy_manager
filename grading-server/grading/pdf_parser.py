"""정답 PDF 파싱: PDF에서 텍스트 추출 후 Gemini로 정답 파싱"""
import logging
import pdfplumber
import io
from integrations.gemini import parse_answers_from_pdf

logger = logging.getLogger(__name__)


async def extract_answers_from_pdf(pdf_bytes: bytes, total_hint: int | None = None) -> dict:
    """PDF에서 정답 추출

    Args:
        pdf_bytes: PDF 파일 바이트
        total_hint: 예상 총 문제 수 (힌트)

    Returns:
        {
            "answers": {"1": "③", "2": "①", ...},
            "types": {"1": "mc", "2": "mc", "5": "essay", ...},
            "total": 30
        }
    """
    # 1. PDF에서 텍스트 추출
    text = _extract_text_from_pdf(pdf_bytes)

    if not text.strip():
        logger.warning("PDF에서 텍스트를 추출할 수 없습니다 (스캔된 PDF일 수 있음)")
        return {"answers": {}, "types": {}, "total": 0}

    # 2. Gemini로 정답 파싱
    result = await parse_answers_from_pdf(text, total_hint)

    logger.info(f"정답 추출 완료: {result.get('total', 0)}문제")
    return result


def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """PDF에서 텍스트 추출 (pdfplumber 사용)"""
    text_parts = []

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
    except Exception as e:
        logger.error(f"PDF 텍스트 추출 실패: {e}")

    return "\n\n".join(text_parts)
