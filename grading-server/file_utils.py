"""ZIP/HEIC/PDF 파일 처리 유틸리티"""
import io
import logging
import re
import zipfile

logger = logging.getLogger(__name__)


def parse_page_range(range_str: str) -> tuple[int, int] | None:
    """페이지 범위 문자열 파싱 (예: "45-48" → (45, 48), "30" → (30, 30))"""
    range_str = range_str.replace(" ", "")
    m = re.match(r"(\d+)\s*[-~]\s*(\d+)", range_str)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"(\d+)", range_str)
    if m:
        return (int(m.group(1)), int(m.group(1)))
    return None


def extract_images_from_zip(zip_bytes: bytes) -> list[bytes]:
    """ZIP에서 이미지/PDF/HEIC 파일 추출 → 모두 JPEG 바이트로 변환"""
    IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
    HEIC_EXTS = (".heic", ".heif")
    PDF_EXTS = (".pdf",)

    images: list[bytes] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            all_names = sorted(zf.namelist())
            logger.info(f"[ZIP] 파일 {len(all_names)}개 발견: {[n for n in all_names if not n.endswith('/')]}")

            for name in all_names:
                if name.endswith("/"):
                    continue
                lower = name.lower()

                if lower.endswith(IMAGE_EXTS):
                    images.append(zf.read(name))
                elif lower.endswith(HEIC_EXTS):
                    images.extend(_convert_heic_to_jpeg(zf.read(name), name))
                elif lower.endswith(PDF_EXTS):
                    images.extend(_convert_pdf_to_images(zf.read(name), name))
                else:
                    logger.warning(f"[ZIP] 지원되지 않는 파일 형식 건너뜀: {name}")

    except Exception as e:
        logger.error(f"ZIP 압축 해제 실패: {e}")

    logger.info(f"[ZIP] 최종 추출 이미지: {len(images)}장")
    return images


def _convert_heic_to_jpeg(heic_bytes: bytes, filename: str) -> list[bytes]:
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
        from PIL import Image
        img = Image.open(io.BytesIO(heic_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        logger.info(f"[ZIP] HEIC 변환 성공: {filename}")
        return [buf.getvalue()]
    except ImportError:
        logger.error(f"[ZIP] pillow-heif 미설치 → HEIC 파일 건너뜀: {filename}")
        return []
    except Exception as e:
        logger.error(f"[ZIP] HEIC 변환 실패 ({filename}): {e}")
        return []


def _convert_pdf_to_images(pdf_bytes: bytes, filename: str) -> list[bytes]:
    result = []
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        logger.info(f"[ZIP] PDF 변환 시작: {filename} ({len(doc)}페이지)")
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=200)
            img_bytes = pix.tobytes("jpeg")
            result.append(img_bytes)
        doc.close()
        logger.info(f"[ZIP] PDF 변환 완료: {filename} → {len(result)}장 이미지")
    except Exception as e:
        logger.error(f"[ZIP] PDF 변환 실패 ({filename}): {e}")
    return result
