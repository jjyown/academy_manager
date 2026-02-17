"""채점 이미지 생성: 원본 사진 + 오른쪽 채점표 패널"""
import io
import logging
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

COLOR_CORRECT = (34, 197, 94)       # 초록
COLOR_WRONG = (239, 68, 68)         # 빨강
COLOR_UNCERTAIN = (234, 179, 8)     # 노랑
COLOR_UNANSWERED = (148, 163, 184)  # 회색
COLOR_TEXT = (30, 41, 59)           # 텍스트
COLOR_BG = (248, 250, 252)         # 패널 배경
COLOR_HEADER = (30, 58, 138)       # 헤더 배경
COLOR_DIVIDER = (226, 232, 240)    # 구분선


def create_graded_image(image_bytes: bytes, items: list[dict],
                        total_score: float, max_score: float) -> bytes:
    """채점 표시된 이미지 생성 - 원본 옆에 채점표 패널"""
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = original.size

    font_title = _get_font(28)
    font_header = _get_font(20)
    font_body = _get_font(18)
    font_small = _get_font(14)

    # 패널 크기 계산
    panel_w = max(280, int(orig_w * 0.35))
    row_h = 36
    header_h = 80
    table_header_h = 32
    footer_h = 70
    table_h = table_header_h + len(items) * row_h
    panel_h = max(orig_h, header_h + table_h + footer_h + 20)

    # 최종 이미지: 원본 + 패널
    result = Image.new("RGB", (orig_w + panel_w, max(orig_h, panel_h)), COLOR_BG)
    result.paste(original, (0, 0))

    draw = ImageDraw.Draw(result)

    px = orig_w  # 패널 시작 X

    # ── 헤더: 점수 표시 ──
    draw.rectangle([px, 0, px + panel_w, header_h], fill=COLOR_HEADER)

    correct_cnt = sum(1 for i in items if i.get("is_correct") is True)
    wrong_cnt = sum(1 for i in items if i.get("is_correct") is False)
    uncertain_cnt = sum(1 for i in items if i.get("is_correct") is None
                        and i.get("student_answer") != "(미풀이)")
    unanswered_cnt = sum(1 for i in items if i.get("student_answer") == "(미풀이)")

    score_text = f"{total_score:.0f} / {max_score:.0f}점"
    draw.text((px + 15, 12), score_text, fill="white", font=font_title)

    stats_text = f"O {correct_cnt}  X {wrong_cnt}  ? {uncertain_cnt}  - {unanswered_cnt}"
    draw.text((px + 15, 48), stats_text, fill=(200, 210, 230), font=font_small)

    # ── 테이블 헤더 ──
    ty = header_h + 5
    draw.rectangle([px, ty, px + panel_w, ty + table_header_h], fill=(241, 245, 249))
    col_num_x = px + 10
    col_ans_x = px + 55
    col_correct_x = px + 145
    col_result_x = px + 230

    draw.text((col_num_x, ty + 6), "번호", fill=COLOR_TEXT, font=font_small)
    draw.text((col_ans_x, ty + 6), "학생답", fill=COLOR_TEXT, font=font_small)
    draw.text((col_correct_x, ty + 6), "정답", fill=COLOR_TEXT, font=font_small)
    draw.text((col_result_x, ty + 6), "결과", fill=COLOR_TEXT, font=font_small)

    # ── 테이블 본문 ──
    ty += table_header_h

    for idx, item in enumerate(items):
        row_y = ty + idx * row_h

        # 줄무늬 배경
        if idx % 2 == 0:
            draw.rectangle([px, row_y, px + panel_w, row_y + row_h], fill="white")
        else:
            draw.rectangle([px, row_y, px + panel_w, row_y + row_h], fill=(248, 250, 252))

        # 구분선
        draw.line([px, row_y, px + panel_w, row_y], fill=COLOR_DIVIDER, width=1)

        q_num = item.get("question_number", idx + 1)
        student_ans = item.get("student_answer", "") or ""
        correct_ans = item.get("correct_answer", "") or ""
        is_correct = item.get("is_correct")

        # 번호
        draw.text((col_num_x, row_y + 8), str(q_num), fill=COLOR_TEXT, font=font_body)

        # 학생 답 (최대 8자)
        display_ans = student_ans[:8] + ".." if len(student_ans) > 8 else student_ans
        draw.text((col_ans_x, row_y + 8), display_ans, fill=COLOR_TEXT, font=font_body)

        # 정답 (최대 8자)
        display_correct = correct_ans[:8] + ".." if len(correct_ans) > 8 else correct_ans

        # 결과 표시
        if student_ans == "(미풀이)":
            draw.text((col_correct_x, row_y + 8), display_correct, fill=COLOR_UNANSWERED, font=font_body)
            _draw_tag(draw, col_result_x, row_y + 6, "미풀이", COLOR_UNANSWERED, font_small)
        elif is_correct is True:
            draw.text((col_correct_x, row_y + 8), display_correct, fill=COLOR_CORRECT, font=font_body)
            _draw_tag(draw, col_result_x, row_y + 6, "  O  ", COLOR_CORRECT, font_small)
        elif is_correct is False:
            draw.text((col_correct_x, row_y + 8), display_correct, fill=COLOR_WRONG, font=font_body)
            _draw_tag(draw, col_result_x, row_y + 6, "  X  ", COLOR_WRONG, font_small)
        else:
            draw.text((col_correct_x, row_y + 8), display_correct, fill=COLOR_UNCERTAIN, font=font_body)
            _draw_tag(draw, col_result_x, row_y + 6, "  ?  ", COLOR_UNCERTAIN, font_small)

    # ── 하단 구분선 ──
    bottom_y = ty + len(items) * row_h
    draw.line([px, bottom_y, px + panel_w, bottom_y], fill=COLOR_DIVIDER, width=2)

    # JPEG 출력
    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue()


def _draw_tag(draw, x, y, text, color, font):
    """컬러 태그 (둥근 배경)"""
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    padding = 4
    light_color = tuple(min(255, c + 180) for c in color[:3])
    draw.rounded_rectangle(
        [x, y, x + tw + padding * 2, y + th + padding * 2],
        radius=4,
        fill=light_color,
        outline=color, width=1,
    )
    draw.text((x + padding, y + padding - 1), text, fill=color, font=font)


def _get_font(size: int):
    """시스템 폰트 로드"""
    font_paths = [
        "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/malgun.ttf",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    ]
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()
