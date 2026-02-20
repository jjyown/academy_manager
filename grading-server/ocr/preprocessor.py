"""이미지 전처리: OCR 정확도 향상을 위한 자동 보정

- 자동 회전 보정 (EXIF 기반)
- 기울기 자동 보정 (Deskew - OpenCV 기반)
- 대비/밝기 자동 조정
- 적응형 이진화 (연필 필기 강화)
- 샤프닝 (흐릿한 사진 보정)
- 해상도 정규화
"""
import io
import logging
from PIL import Image, ImageEnhance, ImageFilter, ExifTags

logger = logging.getLogger(__name__)

TARGET_MAX_DIM = 2048
JPEG_QUALITY = 88
DESKEW_MAX_ANGLE = 15  # 이 각도 이하만 보정 (과도한 회전 방지)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    logger.warning("[Preprocess] OpenCV 미설치 → Deskew 비활성화. pip install opencv-python-headless")


def preprocess_image(image_bytes: bytes) -> bytes:
    """학생 숙제 사진 전처리 → OCR 정확도 향상

    1) EXIF 회전 보정 (폰카 세로/가로 자동 감지)
    2) 기울기 자동 보정 (Deskew - 비뚤게 찍힌 사진 수평 맞추기)
    3) 해상도 정규화 (너무 크면 축소, 너무 작으면 유지)
    4) 자동 대비 향상 (어두운 사진 보정)
    5) 샤프닝 (흐릿한 사진 보정)

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

        # 2) 기울기 자동 보정 (Deskew)
        img = _deskew(img)

        # 3) 해상도 정규화 (너무 큰 이미지 축소)
        img = _normalize_resolution(img)

        # 4) 자동 대비 향상
        img = _auto_enhance(img)

        # 5) 적응형 이진화 (연필 필기 강화)
        img = _adaptive_binarize(img)

        # 6) 조건부 샤프닝 (흐릿한 이미지만 - Laplacian variance 기반)
        img = _conditional_sharpen(img)

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


def _deskew(img: Image.Image) -> Image.Image:
    """OpenCV 기반 기울기 자동 보정 (Deskew)

    알고리즘:
    1. 그레이스케일 변환 → Canny 에지 검출
    2. HoughLinesP로 직선 검출 (문제집의 인쇄 줄, 텍스트 줄)
    3. 검출된 직선들의 각도 중앙값(median) 계산
    4. 각도가 DESKEW_MAX_ANGLE 이내일 때만 보정
    5. INTER_CUBIC 보간으로 글자 뭉개짐 방지
    """
    if not HAS_CV2:
        return img

    import numpy as np

    try:
        cv_img = np.array(img)
        gray = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)

        # Canny 에지 검출 (문서의 텍스트 줄/인쇄선 감지)
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)

        # HoughLinesP: 확률적 허프 변환으로 직선 검출
        lines = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=np.pi / 180,
            threshold=100,
            minLineLength=gray.shape[1] // 8,  # 이미지 너비의 1/8 이상인 선만
            maxLineGap=10,
        )

        if lines is None or len(lines) < 3:
            logger.debug("[Deskew] 직선 부족 → 보정 건너뜀")
            return img

        # 각 직선의 각도 계산 (수평선 기준 편차)
        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = x2 - x1
            dy = y2 - y1
            if abs(dx) < 1:
                continue
            angle = np.degrees(np.arctan2(dy, dx))
            # 수평에 가까운 선만 사용 (-45° ~ 45°)
            if abs(angle) < 45:
                angles.append(angle)

        if len(angles) < 3:
            logger.debug("[Deskew] 유효 각도 부족 → 보정 건너뜀")
            return img

        # 중앙값으로 기울기 각도 결정 (이상값에 강건)
        median_angle = float(np.median(angles))

        # 너무 작은 기울기는 무시 (0.3° 미만)
        if abs(median_angle) < 0.3:
            logger.debug(f"[Deskew] 기울기 {median_angle:.2f}° → 거의 수평, 보정 불필요")
            return img

        # 과도한 기울기는 보정하지 않음 (원본이 의도적 회전일 수 있음)
        if abs(median_angle) > DESKEW_MAX_ANGLE:
            logger.debug(f"[Deskew] 기울기 {median_angle:.2f}° → 과도함, 보정 건너뜀")
            return img

        # 이미지 중심 기준 회전 (INTER_CUBIC: 고품질 보간, 글자 뭉개짐 방지)
        h, w = cv_img.shape[:2]
        center = (w // 2, h // 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, median_angle, 1.0)

        # 회전 후 이미지 잘림 방지: 새 크기 계산
        cos_a = abs(rotation_matrix[0, 0])
        sin_a = abs(rotation_matrix[0, 1])
        new_w = int(h * sin_a + w * cos_a)
        new_h = int(h * cos_a + w * sin_a)
        rotation_matrix[0, 2] += (new_w - w) / 2
        rotation_matrix[1, 2] += (new_h - h) / 2

        rotated = cv2.warpAffine(
            cv_img, rotation_matrix, (new_w, new_h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,  # 가장자리를 복제하여 검은 테두리 방지
        )

        logger.info(f"[Deskew] 기울기 보정: {median_angle:.2f}° (직선 {len(angles)}개 감지)")
        return Image.fromarray(rotated)

    except Exception as e:
        logger.warning(f"[Deskew] 보정 실패, 원본 유지: {e}")
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


PENCIL_STD_THRESHOLD = 40.0    # 그레이스케일 표준편차 임계값 (연필 필기는 대비가 낮음)
PENCIL_BRIGHT_THRESHOLD = 150  # 평균 밝기 임계값 (연필 필기는 밝은 배경 위 옅은 글씨)
COLOR_SATURATION_THRESHOLD = 25.0  # 색상 채도 표준편차 (컬러 마킹/형광펜 감지)


def _adaptive_binarize(img: Image.Image) -> Image.Image:
    """연필 필기 감지 시 적응형 이진화로 글씨 강화

    연필로 쓴 옅은 글씨는 OCR이 놓치기 쉬움. 이미지 특성을 분석하여
    연필 필기로 판별되면 적응형 이진화를 적용해 글씨 대비를 극대화.

    적용 조건 (모두 충족해야 적용):
    - 그레이스케일 표준편차가 낮음 (저대비 = 연필 필기 특성)
    - 평균 밝기가 높음 (밝은 종이 위 옅은 글씨)
    - 색상 채도가 낮음 (컬러 마킹/형광펜이 아님)

    결과를 RGB로 반환하여 후속 처리와 호환 유지.
    """
    if not HAS_CV2:
        return img

    import numpy as np

    try:
        gray = np.array(img.convert("L"), dtype=np.float64)
        mean_brightness = gray.mean()
        std_dev = gray.std()

        if std_dev >= PENCIL_STD_THRESHOLD or mean_brightness <= PENCIL_BRIGHT_THRESHOLD:
            logger.debug(f"[Binarize] 연필 필기 아님 (std={std_dev:.1f}, bright={mean_brightness:.0f}) → 건너뜀")
            return img

        hsv = np.array(img.convert("HSV"), dtype=np.float64)
        saturation_std = hsv[:, :, 1].std()
        if saturation_std > COLOR_SATURATION_THRESHOLD:
            logger.debug(f"[Binarize] 컬러 마킹 감지 (sat_std={saturation_std:.1f}) → 건너뜀")
            return img

        gray_u8 = np.array(img.convert("L"), dtype=np.uint8)
        binary = cv2.adaptiveThreshold(
            gray_u8, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            blockSize=15,
            C=8,
        )

        result = Image.fromarray(binary).convert("RGB")
        logger.info(f"[Binarize] 연필 필기 감지 (std={std_dev:.1f}, bright={mean_brightness:.0f}) → 적응형 이진화 적용")
        return result

    except Exception as e:
        logger.debug(f"[Binarize] 이진화 실패, 원본 유지: {e}")
        return img


BLUR_THRESHOLD = 100.0  # Laplacian variance 임계값 (낮을수록 흐릿함)


def _conditional_sharpen(img: Image.Image) -> Image.Image:
    """선명도를 측정하여 흐릿한 이미지만 샤프닝 적용

    Laplacian variance가 BLUR_THRESHOLD 미만이면 흐릿한 것으로 판단.
    이미 선명한 이미지에 샤프닝하면 노이즈가 증가하여 OCR 정확도가 떨어짐.
    """
    if not HAS_CV2:
        img = img.filter(ImageFilter.SHARPEN)
        return img

    import numpy as np
    try:
        gray = np.array(img.convert("L"), dtype=np.float64)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()

        if variance < BLUR_THRESHOLD:
            img = img.filter(ImageFilter.SHARPEN)
            logger.debug(f"[Sharpen] 흐릿함 감지 (variance={variance:.1f}) → 샤프닝 적용")
        else:
            logger.debug(f"[Sharpen] 충분히 선명 (variance={variance:.1f}) → 샤프닝 건너뜀")
    except Exception as e:
        logger.debug(f"[Sharpen] 선명도 측정 실패, 기본 샤프닝: {e}")
        img = img.filter(ImageFilter.SHARPEN)

    return img
