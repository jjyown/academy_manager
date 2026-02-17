"""채점 이미지 생성: 원본 사진 + 오른쪽 채점표 패널"""
import io
import logging
import os
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

COLOR_CORRECT = (34, 197, 94)       # 초록
COLOR_WRONG = (239, 68, 68)         # 빨강
COLOR_UNCERTAIN = (234, 179, 8)     # 노랑
COLOR_UNANSWERED = (148, 163, 184)  # 회색
COLOR_TEXT = (30, 41, 59)           # 텍스트
COLOR_SUBTEXT = (100, 116, 139)    # 보조 텍스트
COLOR_BG = (248, 250, 252)         # 패널 배경
COLOR_HEADER = (30, 58, 138)       # 헤더 배경
COLOR_DIVIDER = (226, 232, 240)    # 구분선

_font_cache: dict = {}


def create_graded_image(image_bytes: bytes, items: list[dict],
                        total_score: float, max_score: float) -> bytes:
    """채점 표시된 이미지 생성 - 원본 옆에 채점표 패널"""
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = original.size

    ft = _get_font(28)
    fm = _get_font(18)
    fs = _get_font(15)

    # 패널 크기 계산
    panel_w = max(300, int(orig_w * 0.38))
    row_h = 38
    header_h = 56
    table_header_h = 32
    table_h = table_header_h + len(items) * row_h + 4
    panel_h = max(orig_h, header_h + table_h + 10)

    # 최종 이미지: 원본 + 패널
    canvas_w = orig_w + panel_w
    canvas_h = max(orig_h, panel_h)
    result = Image.new("RGB", (canvas_w, canvas_h), COLOR_BG)
    result.paste(original, (0, 0))

    draw = ImageDraw.Draw(result)
    px = orig_w

    # ── 컬럼 위치 (비율 기반) ──
    c_num = px + int(panel_w * 0.02)           # 번호
    c_ans = px + int(panel_w * 0.14)           # 학생답
    c_cor = px + int(panel_w * 0.48)           # 정답
    c_res_start = px + int(panel_w * 0.78)     # 결과 시작
    c_res_end = px + panel_w - 6               # 결과 끝
    c_res_center = (c_res_start + c_res_end) // 2  # 결과 중앙

    # ── 헤더: 점수만 표시 ──
    draw.rectangle([px, 0, px + panel_w, header_h], fill=COLOR_HEADER)
    score_text = f"{total_score:.0f} / {max_score:.0f}"
    draw.text((px + 14, 14), score_text, fill="white", font=ft)

    # ── 테이블 헤더 ──
    ty = header_h
    draw.rectangle([px, ty, px + panel_w, ty + table_header_h], fill=(241, 245, 249))

    draw.text((c_num + 2, ty + 7), "#", fill=COLOR_SUBTEXT, font=fs)
    draw.text((c_ans, ty + 7), "Student", fill=COLOR_SUBTEXT, font=fs)
    draw.text((c_cor, ty + 7), "Answer", fill=COLOR_SUBTEXT, font=fs)
    _draw_text_centered(draw, c_res_center, ty + 7, "Result", COLOR_SUBTEXT, fs)

    # ── 테이블 본문 ──
    ty += table_header_h

    for idx, item in enumerate(items):
        row_y = ty + idx * row_h
        text_y = row_y + (row_h - 18) // 2

        # 줄무늬 배경
        bg = "white" if idx % 2 == 0 else (248, 250, 252)
        draw.rectangle([px, row_y, px + panel_w, row_y + row_h], fill=bg)
        draw.line([px, row_y, px + panel_w, row_y], fill=COLOR_DIVIDER, width=1)

        q_num = item.get("question_label") or item.get("question_number", idx + 1)
        student_ans = item.get("student_answer", "") or ""
        correct_ans = item.get("correct_answer", "") or ""
        is_correct = item.get("is_correct")

        # 번호
        draw.text((c_num + 2, text_y), str(q_num), fill=COLOR_TEXT, font=fm)

        # 학생 답 (최대 10자)
        display_ans = _truncate(student_ans, 10)
        draw.text((c_ans, text_y), display_ans, fill=COLOR_TEXT, font=fm)

        # 정답 (최대 10자)
        display_correct = _truncate(correct_ans, 10)

        # 결과 분류 및 표시
        if student_ans == "(미풀이)":
            draw.text((c_cor, text_y), display_correct, fill=COLOR_UNANSWERED, font=fm)
            _draw_result_tag(draw, c_res_center, row_y, row_h, " - ", COLOR_UNANSWERED, fs)
        elif is_correct is True:
            draw.text((c_cor, text_y), display_correct, fill=COLOR_CORRECT, font=fm)
            _draw_result_tag(draw, c_res_center, row_y, row_h, " O ", COLOR_CORRECT, fs)
        elif is_correct is False:
            draw.text((c_cor, text_y), display_correct, fill=COLOR_WRONG, font=fm)
            _draw_result_tag(draw, c_res_center, row_y, row_h, " X ", COLOR_WRONG, fs)
        else:
            draw.text((c_cor, text_y), display_correct, fill=COLOR_UNCERTAIN, font=fm)
            _draw_result_tag(draw, c_res_center, row_y, row_h, " ? ", COLOR_UNCERTAIN, fs)

    # 하단 구분선
    bottom_y = ty + len(items) * row_h
    draw.line([px, bottom_y, px + panel_w, bottom_y], fill=COLOR_DIVIDER, width=2)

    # JPEG 출력
    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue()


def _draw_result_tag(draw, center_x, row_y, row_h, text, color, font):
    """결과 태그를 셀 중앙에 그리기"""
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad = 4
    tag_w = tw + pad * 2
    tag_h = th + pad * 2

    tx = center_x - tag_w // 2
    tag_y = row_y + (row_h - tag_h) // 2

    light = tuple(min(255, c + 180) for c in color[:3])
    draw.rounded_rectangle(
        [tx, tag_y, tx + tag_w, tag_y + tag_h],
        radius=4, fill=light, outline=color, width=1,
    )
    draw.text((tx + pad, tag_y + pad - 1), text, fill=color, font=font)


def _draw_text_centered(draw, center_x, y, text, color, font):
    """텍스트를 중앙 정렬로 그리기"""
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    draw.text((center_x - tw // 2, y), text, fill=color, font=font)


def _truncate(text: str, max_len: int) -> str:
    """텍스트 길이 제한"""
    return text[:max_len] + ".." if len(text) > max_len else text


def _get_font(size: int):
    """시스템 폰트 로드 (캐시)"""
    if size in _font_cache:
        return _font_cache[size]

    font_paths = [
        # Railway (fonts-noto-cjk)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
        # Fallback Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        # Windows
        "C:/Windows/Fonts/malgun.ttf",
        # Mac
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    ]

    # fonts-noto-cjk 패키지가 설치하는 경로 자동 탐색
    noto_dirs = [
        "/usr/share/fonts/opentype/noto",
        "/usr/share/fonts/truetype/noto",
    ]
    for d in noto_dirs:
        if os.path.isdir(d):
            for f in os.listdir(d):
                full = os.path.join(d, f)
                if full not in font_paths:
                    font_paths.insert(0, full)

    for path in font_paths:
        try:
            font = ImageFont.truetype(path, size)
            _font_cache[size] = font
            return font
        except (OSError, IOError):
            continue

    font = ImageFont.load_default()
    _font_cache[size] = font
    return font
