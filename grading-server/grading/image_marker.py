"""채점 이미지 생성: 답안 사진 위에 ⭕/✔/❓ 표시"""
import io
import logging
from PIL import Image, ImageDraw, ImageFont
from config import IMAGE_QUALITY

logger = logging.getLogger(__name__)

# 채점 마크 색상
COLOR_CORRECT = (34, 197, 94)      # 초록 (⭕)
COLOR_WRONG = (239, 68, 68)        # 빨강 (✔)
COLOR_UNCERTAIN = (234, 179, 8)    # 노랑 (❓)
COLOR_TEXT = (30, 41, 59)          # 텍스트
COLOR_SCORE_BG = (255, 255, 255, 200)  # 점수 배경


def create_graded_image(image_bytes: bytes, items: list[dict], total_score: float, max_score: float) -> bytes:
    """채점 표시된 이미지 생성

    Args:
        image_bytes: 원본 학생 답안 이미지
        items: 문항별 채점 결과 (position_x, position_y, is_correct 포함)
        total_score: 총점
        max_score: 만점

    Returns:
        채점 표시된 이미지 (JPEG bytes)
    """
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)

    # 폰트 설정 (시스템 폰트 시도)
    font_large = _get_font(32)
    font_medium = _get_font(24)
    font_small = _get_font(18)

    # 각 문항에 마크 표시
    for item in items:
        px = item.get("position_x")
        py = item.get("position_y")
        if px is None or py is None:
            continue

        x, y = int(px), int(py)
        is_correct = item.get("is_correct")

        if is_correct is True:
            _draw_circle_mark(draw, x, y, COLOR_CORRECT, font_large)
        elif is_correct is False:
            _draw_check_mark(draw, x, y, COLOR_WRONG, font_large)
            # 틀린 문제 옆에 정답 표시
            correct = item.get("correct_answer", "")
            if correct:
                draw.text((x + 40, y - 10), f"정답: {correct}", fill=COLOR_WRONG, font=font_small)
        else:
            _draw_question_mark(draw, x, y, COLOR_UNCERTAIN, font_large)

    # 하단에 점수 배너
    _draw_score_banner(draw, image.size, total_score, max_score, items, font_medium, font_small)

    # 합성
    result = Image.alpha_composite(image, overlay).convert("RGB")

    # JPEG로 압축
    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=IMAGE_QUALITY, optimize=True)
    return buffer.getvalue()


def _draw_circle_mark(draw: ImageDraw.Draw, x: int, y: int, color: tuple, font):
    """⭕ 정답 마크"""
    r = 18
    draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=3)


def _draw_check_mark(draw: ImageDraw.Draw, x: int, y: int, color: tuple, font):
    """✔ 오답 마크"""
    size = 16
    draw.line([x - size, y - size, x + size, y + size], fill=color, width=3)
    draw.line([x - size, y + size, x + size, y - size], fill=color, width=3)


def _draw_question_mark(draw: ImageDraw.Draw, x: int, y: int, color: tuple, font):
    """❓ 불확실 마크"""
    r = 18
    draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=2)
    draw.text((x - 6, y - 12), "?", fill=color, font=font)


def _draw_score_banner(draw, img_size, total_score, max_score, items, font_medium, font_small):
    """하단 점수 배너"""
    w, h = img_size
    banner_h = 80
    y_start = h - banner_h

    # 반투명 배경
    draw.rectangle([0, y_start, w, h], fill=(255, 255, 255, 220))
    draw.line([0, y_start, w, y_start], fill=(200, 200, 200), width=2)

    # 점수
    score_text = f"{total_score:.0f}/{max_score:.0f}점"
    draw.text((20, y_start + 10), score_text, fill=COLOR_TEXT, font=font_medium)

    # 통계
    correct = sum(1 for i in items if i.get("is_correct") is True)
    wrong = sum(1 for i in items if i.get("is_correct") is False)
    uncertain = sum(1 for i in items if i.get("is_correct") is None)

    stats_text = f"⭕ {correct}  ✘ {wrong}  ❓ {uncertain}"
    draw.text((20, y_start + 45), stats_text, fill=(100, 116, 139), font=font_small)


def _get_font(size: int):
    """시스템 폰트 로드"""
    font_paths = [
        "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",  # Linux (Railway)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "C:/Windows/Fonts/malgun.ttf",  # Windows
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",  # Mac
    ]

    for path in font_paths:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue

    return ImageFont.load_default()
