"""이미지 전처리: OCR 정확도 향상을 위한 자동 보정

- 자동 회전 보정 (EXIF 기반)
- 대비/밝기 자동 조정
- 샤프닝 (흐릿한 사진 보정)
- 해상도 정규화
"""
import io
import logging
from PIL import Image, ImageEnhance, ImageFilter, ExifTags

logger = logging.getLogger(__name__)

TARGET_MAX_DIM = 2048
JPEG_QUALITY = 88


def preprocess_image(image_bytes: bytes) -> bytes:
    """학생 숙제 사진 전처리 → OCR 정확도 향상

    1) EXIF 회전 보정 (폰카 세로/가로 자동 감지)
    2) 해상도 정규화 (너무 크면 축소, 너무 작으면 유지)
    3) 자동 대비 향상 (어두운 사진 보정)
    4) 샤프닝 (흐릿한 사진 보정)

    Returns:
        전처리된 JPEG 바이트
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))

        # 1) EXIF 회전 보정
        img = _fix_exif_rotation(img)

        # RGB 변환 (RGBA, P 등 대응)
        if img.mode != "RGB":
            img = img.convert("RGB")

        # 2) 해상도 정규화 (너무 큰 이미지 축소)
        img = _normalize_resolution(img)

        # 3) 자동 대비 향상
        img = _auto_enhance(img)

        # 4) 샤프닝
        img = img.filter(ImageFilter.SHARPEN)

        # JPEG 출력
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        result = buf.getvalue()

        original_kb = len(image_bytes) // 1024
        result_kb = len(result) // 1024
        logger.debug(f"[Preprocess] {img.size[0]}x{img.size[1]}, "
                     f"{original_kb}KB → {result_kb}KB")
        return result

    except Exception as e:
        logger.warning(f"[Preprocess] 전처리 실패, 원본 사용: {e}")
        return image_bytes


def preprocess_batch(image_bytes_list: list[bytes]) -> list[bytes]:
    """여러 이미지 일괄 전처리"""
    return [preprocess_image(img) for img in image_bytes_list]


def _fix_exif_rotation(img: Image.Image) -> Image.Image:
    """EXIF 방향 태그에 따라 이미지 회전"""
    try:
        exif = img.getexif()
        if not exif:
            return img

        orientation_key = None
        for k, v in ExifTags.TAGS.items():
            if v == "Orientation":
                orientation_key = k
                break

        if orientation_key is None or orientation_key not in exif:
            return img

        orientation = exif[orientation_key]
        rotate_map = {
            3: 180,
            6: 270,
            8: 90,
        }
        if orientation in rotate_map:
            img = img.rotate(rotate_map[orientation], expand=True)
            logger.debug(f"[EXIF] 회전 보정: {rotate_map[orientation]}°")

    except Exception:
        pass
    return img


def _normalize_resolution(img: Image.Image) -> Image.Image:
    """너무 큰 이미지 축소 (OCR 최적 해상도 유지)"""
    w, h = img.size
    max_dim = max(w, h)

    if max_dim > TARGET_MAX_DIM:
        ratio = TARGET_MAX_DIM / max_dim
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    return img


def _auto_enhance(img: Image.Image) -> Image.Image:
    """자동 대비/밝기 조정 (어두운 사진 보정)"""
    import numpy as np

    pixels = np.array(img)
    mean_brightness = pixels.mean()

    # 평균 밝기가 너무 낮으면 밝기 보정
    if mean_brightness < 100:
        brightness_factor = min(1.5, 130 / max(mean_brightness, 1))
        img = ImageEnhance.Brightness(img).enhance(brightness_factor)
        logger.debug(f"[Enhance] 밝기 보정: ×{brightness_factor:.2f} (원본 평균: {mean_brightness:.0f})")

    # 대비 약간 향상 (항상 적용)
    contrast_factor = 1.15 if mean_brightness < 140 else 1.05
    img = ImageEnhance.Contrast(img).enhance(contrast_factor)

    return img
