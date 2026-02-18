"""채점 이미지 생성: 원본 사진 + 오른쪽 채점표 패널 (v2)

v2 개선:
- 패널 폭 확대 (45%, min 400px) → 긴 수식/소문제 정답 잘림 방지
- 픽셀 기반 스마트 텍스트 줄임 (하드코딩 글자 수 제한 제거)
- 점수 헤더에 퍼센트 + 진행 바 + O/X/?/- 통계
- 동적 행 높이: 긴 답안은 2줄로 자동 표시
- 한글 컬럼 헤더 (번호 / 학생답 / 정답 / 결과)
"""
import io
import logging
import os
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ── 색상 팔레트 (Tailwind Slate 기반) ──
COLOR_CORRECT = (22, 163, 74)
COLOR_WRONG = (220, 38, 38)
COLOR_UNCERTAIN = (217, 119, 6)
COLOR_UNANSWERED = (148, 163, 184)

COLOR_TEXT = (15, 23, 42)           # slate-900
COLOR_SUBTEXT = (100, 116, 139)    # slate-500
COLOR_LIGHT = (241, 245, 249)      # slate-100
COLOR_BG = (248, 250, 252)         # slate-50
COLOR_WHITE = (255, 255, 255)
COLOR_HEADER_BG = (15, 23, 42)     # slate-900
COLOR_DIVIDER = (226, 232, 240)    # slate-200

_font_cache: dict = {}


def create_graded_image(image_bytes: bytes, items: list[dict],
                        total_score: float, max_score: float) -> bytes:
    """채점 표시된 이미지 생성 - 원본 옆에 채점표 패널"""
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = original.size

    f_title = _get_font(38)
    f_sub = _get_font(22)
    f_stat = _get_font(17)
    f_hdr = _get_font(17)
    f_body = _get_font(20)
    f_tag = _get_font(16)

    # ── 패널 크기 계산 ──
    panel_w = max(400, int(orig_w * 0.45))
    pad = int(panel_w * 0.025)

    # 컬럼 경계 (픽셀)
    c_num_x = pad
    c_ans_x = int(panel_w * 0.11)
    c_cor_x = int(panel_w * 0.46)
    c_res_x = int(panel_w * 0.82)

    ans_col_w = c_cor_x - c_ans_x - 6
    cor_col_w = c_res_x - c_cor_x - 6

    # ── 동적 행 높이 계산 ──
    BASE_ROW_H = 42
    LINE_H = 22
    header_h = 108
    table_header_h = 34

    row_heights: list[int] = []
    for item in items:
        s_ans = item.get("student_answer", "") or ""
        c_ans = item.get("correct_answer", "") or ""
        s_lines = _count_lines(s_ans, f_body, ans_col_w)
        c_lines = _count_lines(c_ans, f_body, cor_col_w)
        max_lines = max(s_lines, c_lines, 1)
        row_heights.append(BASE_ROW_H if max_lines <= 1 else BASE_ROW_H + (max_lines - 1) * LINE_H)

    table_h = table_header_h + sum(row_heights) + 4
    panel_h = max(orig_h, header_h + table_h + 10)

    canvas_w = orig_w + panel_w
    canvas_h = max(orig_h, panel_h)
    result = Image.new("RGB", (canvas_w, canvas_h), COLOR_BG)
    result.paste(original, (0, 0))

    draw = ImageDraw.Draw(result)
    px = orig_w

    # ── 통계 ──
    correct = sum(1 for it in items if it.get("is_correct") is True)
    wrong = sum(1 for it in items if it.get("is_correct") is False)
    unanswered = sum(
        1 for it in items
        if it.get("student_answer") == "(미풀이)"
        or (it.get("is_correct") is None and it.get("ai_feedback") == "학생이 풀지 않은 문제")
    )
    uncertain = sum(
        1 for it in items
        if it.get("is_correct") is None
        and it.get("student_answer") != "(미풀이)"
        and it.get("ai_feedback") != "학생이 풀지 않은 문제"
    )
    pct = (total_score / max_score * 100) if max_score > 0 else 0

    # ═══════════════════════════════════════
    # 헤더: 점수 + 퍼센트 + 진행 바 + 통계
    # ═══════════════════════════════════════
    draw.rectangle([px, 0, px + panel_w, header_h], fill=COLOR_HEADER_BG)

    score_text = f"{total_score:.0f}"
    draw.text((px + pad, 10), score_text, fill=COLOR_WHITE, font=f_title)
    sw = f_title.getbbox(score_text)[2] - f_title.getbbox(score_text)[0]
    draw.text((px + pad + sw + 4, 20), f"/ {max_score:.0f}", fill=COLOR_SUBTEXT, font=f_sub)

    pct_text = f"{pct:.0f}%"
    pw = f_title.getbbox(pct_text)[2] - f_title.getbbox(pct_text)[0]
    pct_color = COLOR_CORRECT if pct >= 80 else COLOR_UNCERTAIN if pct >= 50 else COLOR_WRONG
    draw.text((px + panel_w - pad - pw, 10), pct_text, fill=pct_color, font=f_title)

    bar_y = 58
    bar_h = 8
    bar_x1, bar_x2 = px + pad, px + panel_w - pad
    draw.rounded_rectangle([bar_x1, bar_y, bar_x2, bar_y + bar_h], radius=4, fill=(51, 65, 85))
    fill_w = int((bar_x2 - bar_x1) * min(pct / 100, 1.0))
    if fill_w > 0:
        draw.rounded_rectangle([bar_x1, bar_y, bar_x1 + fill_w, bar_y + bar_h], radius=4, fill=pct_color)

    stat_y = 78
    stat_x = px + pad
    for label, count, color in [
        ("O", correct, COLOR_CORRECT),
        ("X", wrong, COLOR_WRONG),
        ("?", uncertain, COLOR_UNCERTAIN),
        ("-", unanswered, COLOR_UNANSWERED),
    ]:
        draw.ellipse([stat_x, stat_y + 3, stat_x + 10, stat_y + 13], fill=color)
        txt = f"{label} {count}"
        draw.text((stat_x + 14, stat_y), txt, fill=COLOR_LIGHT, font=f_stat)
        stat_x += _text_px_width(txt, f_stat) + 14 + 20

    # ═══════════════════════════════════════
    # 테이블 헤더
    # ═══════════════════════════════════════
    ty = header_h
    draw.rectangle([px, ty, px + panel_w, ty + table_header_h], fill=COLOR_LIGHT)
    draw.line([px, ty, px + panel_w, ty], fill=COLOR_DIVIDER, width=1)

    hy = ty + (table_header_h - 17) // 2
    draw.text((px + c_num_x, hy), "#", fill=COLOR_SUBTEXT, font=f_hdr)
    draw.text((px + c_ans_x, hy), "학생답", fill=COLOR_SUBTEXT, font=f_hdr)
    draw.text((px + c_cor_x, hy), "정답", fill=COLOR_SUBTEXT, font=f_hdr)
    _draw_text_centered(draw, px + c_res_x + (panel_w - c_res_x) // 2, hy, "결과", COLOR_SUBTEXT, f_hdr)

    # ═══════════════════════════════════════
    # 테이블 본문
    # ═══════════════════════════════════════
    ty += table_header_h
    cur_y = ty

    for idx, item in enumerate(items):
        rh = row_heights[idx]
        text_y = cur_y + 10

        bg = COLOR_WHITE if idx % 2 == 0 else (248, 250, 252)
        draw.rectangle([px, cur_y, px + panel_w, cur_y + rh], fill=bg)
        draw.line([px, cur_y, px + panel_w, cur_y], fill=COLOR_DIVIDER, width=1)

        q_label = str(item.get("question_label") or item.get("question_number", idx + 1))
        student_ans = item.get("student_answer", "") or ""
        correct_ans = item.get("correct_answer", "") or ""
        is_correct = item.get("is_correct")

        draw.text((px + c_num_x, text_y), q_label, fill=COLOR_TEXT, font=f_body)

        ans_color = COLOR_UNANSWERED if student_ans == "(미풀이)" else COLOR_TEXT
        _draw_wrapped_text(draw, px + c_ans_x, text_y, student_ans, f_body, ans_col_w, ans_color, LINE_H)

        if student_ans == "(미풀이)":
            cor_color = COLOR_UNANSWERED
            tag_text, tag_color = " - ", COLOR_UNANSWERED
        elif is_correct is True:
            cor_color = COLOR_CORRECT
            tag_text, tag_color = " O ", COLOR_CORRECT
        elif is_correct is False:
            cor_color = COLOR_WRONG
            tag_text, tag_color = " X ", COLOR_WRONG
        else:
            cor_color = COLOR_UNCERTAIN
            tag_text, tag_color = " ? ", COLOR_UNCERTAIN

        _draw_wrapped_text(draw, px + c_cor_x, text_y, correct_ans, f_body, cor_col_w, cor_color, LINE_H)

        res_cx = px + c_res_x + (panel_w - c_res_x) // 2
        _draw_result_tag(draw, res_cx, cur_y, rh, tag_text, tag_color, f_tag)

        cur_y += rh

    draw.line([px, cur_y, px + panel_w, cur_y], fill=COLOR_DIVIDER, width=2)

    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=88, optimize=True)
    return buffer.getvalue()


# ════════════════════════════════════════
# 내부 헬퍼
# ════════════════════════════════════════

def _text_px_width(text: str, font) -> int:
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


def _count_lines(text: str, font, max_px: int) -> int:
    """텍스트가 max_px 폭에서 몇 줄인지 계산"""
    if not text or max_px <= 0:
        return 1
    w = _text_px_width(text, font)
    if w <= max_px:
        return 1
    return min((w // max_px) + 1, 3)


def _draw_wrapped_text(draw, x: int, y: int, text: str, font, max_px: int,
                       color, line_h: int, max_lines: int = 3):
    """텍스트를 max_px 폭에 맞춰 줄바꿈하여 그리기 (최대 max_lines줄)"""
    if not text:
        return
    w = _text_px_width(text, font)
    if w <= max_px:
        draw.text((x, y), text, fill=color, font=font)
        return

    chars_per_line = max(1, int(len(text) * max_px / w))
    lines = []
    remaining = text
    for _ in range(max_lines):
        if not remaining:
            break
        if _text_px_width(remaining, font) <= max_px:
            lines.append(remaining)
            remaining = ""
            break
        cut = chars_per_line
        while cut > 0 and _text_px_width(remaining[:cut], font) > max_px:
            cut -= 1
        cut = max(1, cut)
        lines.append(remaining[:cut])
        remaining = remaining[cut:]

    if remaining:
        last = lines[-1] if lines else ""
        lines[-1] = last[: max(1, len(last) - 1)] + "…"

    for i, line in enumerate(lines):
        draw.text((x, y + i * line_h), line, fill=color, font=font)


def _draw_result_tag(draw, center_x, row_y, row_h, text, color, font):
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    p = 4
    tag_w = tw + p * 2
    tag_h = th + p * 2
    tx = center_x - tag_w // 2
    tag_y = row_y + (row_h - tag_h) // 2
    light = tuple(min(255, c + 180) for c in color[:3])
    draw.rounded_rectangle([tx, tag_y, tx + tag_w, tag_y + tag_h], radius=4,
                           fill=light, outline=color, width=1)
    draw.text((tx + p, tag_y + p - 1), text, fill=color, font=font)


def _draw_text_centered(draw, center_x, y, text, color, font):
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    draw.text((center_x - tw // 2, y), text, fill=color, font=font)


def _get_font(size: int):
    """시스템 폰트 로드 (캐시) - 한글 폰트 우선"""
    if size in _font_cache:
        return _font_cache[size]

    font_paths = [
        os.path.join(os.path.dirname(__file__), "fonts", "NotoSansKR-Regular.otf"),
        os.path.join(os.path.dirname(__file__), "..", "fonts", "NotoSansKR-Regular.otf"),

        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
        "/usr/share/fonts/truetype/noto/NotoSansCJKkr-Regular.otf",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
        "/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf",
        "/usr/share/fonts/truetype/unfonts-core/UnDotum.ttf",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/nhn-nanum/NanumGothic.ttf",
        "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/NanumGothic.ttf",
        "C:/Windows/Fonts/gulim.ttc",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/Library/Fonts/NanumGothic.ttf",
    ]

    noto_dirs = [
        "/usr/share/fonts/opentype/noto",
        "/usr/share/fonts/truetype/noto",
        "/usr/share/fonts/google-noto-cjk",
        "/usr/share/fonts/noto",
    ]
    for d in noto_dirs:
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith((".ttf", ".ttc", ".otf")):
                    full = os.path.join(d, f)
                    if full not in font_paths:
                        font_paths.insert(0, full)

    for path in font_paths:
        try:
            font = ImageFont.truetype(path, size)
            _font_cache[size] = font
            if size == 38:
                logger.info(f"[Font] 한글 폰트 로드 성공: {path}")
            return font
        except (OSError, IOError):
            continue

    logger.warning("[Font] 한글 폰트를 찾지 못했습니다. 기본 폰트를 사용합니다.")
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font
