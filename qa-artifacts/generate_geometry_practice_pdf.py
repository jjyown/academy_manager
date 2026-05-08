# -*- coding: utf-8 -*-
"""초·중 수준 기하 공식 연습 문제 PDF (단원 상단 공식 1회, 정답은 말미 모음)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\malgun.ttf",
    r"C:\Windows\Fonts\malgunsl.ttf",
]


def _pick_font() -> str:
    for p in _FONT_CANDIDATES:
        if os.path.isfile(p):
            return p
    print("한글 폰트(malgun.ttf)를 찾지 못했습니다.", file=sys.stderr)
    sys.exit(1)


# (제목, 핵심 공식 한 줄, 부가 설명 줄들, 문제 10개, 정답 10개 — 순서 대응)
SECTIONS: list[tuple[str, str, list[str], list[str], list[str]]] = [
    (
        "1. 삼각형의 넓이 (예각·둔각)",
        "넓이 = (1/2) × 밑변 × 높이",
        [
            "예각·둔각 삼각형 모두 같은 공식을 씁니다.",
            "둔각 삼각형은 높이가 밑변의 연장선 위에 있을 수 있습니다.",
        ],
        [
            "(예각) 밑변 8 cm, 높이 5 cm일 때 넓이를 구하시오.",
            "(예각) 밑변 12 cm, 높이 6 cm일 때 넓이를 구하시오.",
            "(예각) 밑변 14 cm, 높이 4 cm일 때 넓이를 구하시오.",
            "(예각) 밑변 10 cm, 높이 9 cm일 때 넓이를 구하시오.",
            "(예각) 밑변 16 cm, 높이 5 cm일 때 넓이를 구하시오.",
            "(둔각) 밑변 11 cm, 해당 밑변에 내린 높이 8 cm일 때 넓이를 구하시오.",
            "(둔각) 밑변 15 cm, 해당 밑변에 내린 높이 4 cm일 때 넓이를 구하시오.",
            "(둔각) 밑변 13 cm, 해당 밑변에 내린 높이 6 cm일 때 넓이를 구하시오.",
            "(둔각) 밑변 20 cm, 해당 밑변에 내린 높이 3 cm일 때 넓이를 구하시오.",
            "(둔각) 밑변 18 cm, 해당 밑변에 내린 높이 5 cm일 때 넓이를 구하시오.",
        ],
        [
            "20 cm²",
            "36 cm²",
            "28 cm²",
            "45 cm²",
            "40 cm²",
            "44 cm²",
            "30 cm²",
            "39 cm²",
            "30 cm²",
            "45 cm²",
        ],
    ),
    (
        "2. 원기둥의 부피",
        "V = πr²h (부피 = π × 반지름² × 높이)",
        [],
        [
            "반지름 3 cm, 높이 10 cm인 원기둥의 부피를 구하시오.",
            "반지름 5 cm, 높이 8 cm인 원기둥의 부피를 구하시오.",
            "반지름 4 cm, 높이 6 cm인 원기둥의 부피를 구하시오.",
            "반지름 7 cm, 높이 2 cm인 원기둥의 부피를 구하시오.",
            "반지름 6 cm, 높이 5 cm인 원기둥의 부피를 구하시오.",
            "지름 10 cm, 높이 9 cm인 원기둥의 부피를 구하시오.",
            "지름 8 cm, 높이 12 cm인 원기둥의 부피를 구하시오.",
            "반지름 2 cm, 높이 15 cm인 원기둥의 부피를 구하시오.",
            "반지름 9 cm, 높이 4 cm인 원기둥의 부피를 구하시오.",
            "반지름 5 cm, 높이 5 cm인 원기둥의 부피를 구하시오.",
        ],
        [
            "90π cm³",
            "200π cm³",
            "96π cm³",
            "98π cm³",
            "180π cm³",
            "225π cm³",
            "192π cm³",
            "60π cm³",
            "324π cm³",
            "125π cm³",
        ],
    ),
    (
        "3. 원기둥의 겉넓이",
        "S = 2πr² + 2πrh = 2πr(r + h)",
        ["겉넓이 = 2×(밑면 원 넓이) + (옆면 넓이)."],
        [
            "반지름 3 cm, 높이 7 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 4 cm, 높이 5 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 5 cm, 높이 10 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 2 cm, 높이 8 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 6 cm, 높이 3 cm인 원기둥의 겉넓이를 구하시오.",
            "지름 6 cm, 높이 4 cm인 원기둥의 겉넓이를 구하시오.",
            "지름 10 cm, 높이 2 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 1 cm, 높이 20 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 8 cm, 높이 8 cm인 원기둥의 겉넓이를 구하시오.",
            "반지름 5 cm, 높이 1 cm인 원기둥의 겉넓이를 구하시오.",
        ],
        [
            "60π cm²",
            "72π cm²",
            "150π cm²",
            "40π cm²",
            "108π cm²",
            "42π cm²",
            "70π cm²",
            "42π cm²",
            "256π cm²",
            "60π cm²",
        ],
    ),
    (
        "4. 원뿔의 부피",
        "V = (1/3)πr²h",
        [],
        [
            "반지름 3 cm, 높이 12 cm인 원뿔의 부피를 구하시오.",
            "반지름 6 cm, 높이 5 cm인 원뿔의 부피를 구하시오.",
            "반지름 4 cm, 높이 9 cm인 원뿔의 부피를 구하시오.",
            "반지름 5 cm, 높이 6 cm인 원뿔의 부피를 구하시오.",
            "반지름 2 cm, 높이 15 cm인 원뿔의 부피를 구하시오.",
            "반지름 9 cm, 높이 4 cm인 원뿔의 부피를 구하시오.",
            "지름 8 cm, 높이 3 cm인 원뿔의 부피를 구하시오.",
            "반지름 10 cm, 높이 3 cm인 원뿔의 부피를 구하시오.",
            "반지름 3 cm, 높이 3 cm인 원뿔의 부피를 구하시오.",
            "반지름 7 cm, 높이 6 cm인 원뿔의 부피를 구하시오.",
        ],
        [
            "36π cm³",
            "60π cm³",
            "48π cm³",
            "50π cm³",
            "20π cm³",
            "108π cm³",
            "16π cm³",
            "100π cm³",
            "9π cm³",
            "98π cm³",
        ],
    ),
    (
        "5. 원뿔의 겉넓이",
        "S = πr² + πrℓ (ℓ은 모선, ℓ = √(r²+h²))",
        [],
        [
            "반지름 3 cm, 모선의 길이 5 cm인 원뿔의 겉넓이를 구하시오.",
            "반지름 5 cm, 모선의 길이 13 cm인 원뿔의 겉넓이를 구하시오.",
            "반지름 6 cm, 모선의 길이 10 cm인 원뿔의 겉넓이를 구하시오.",
            "반지름 4 cm, 모선의 길이 5 cm인 원뿔의 겉넓이를 구하시오.",
            "반지름 8 cm, 모선의 길이 10 cm인 원뿔의 겉넓이를 구하시오.",
            "반지름 3 cm, 높이 4 cm인 원뿔입니다. 모선 ℓ을 먼저 구한 뒤 겉넓이를 구하시오.",
            "반지름 5 cm, 높이 12 cm인 원뿔입니다. 모선 ℓ을 먼저 구한 뒤 겉넓이를 구하시오.",
            "반지름 9 cm, 높이 12 cm인 원뿔입니다. 모선 ℓ을 먼저 구한 뒤 겉넓이를 구하시오.",
            "반지름 6 cm, 높이 8 cm인 원뿔입니다. 모선 ℓ을 먼저 구한 뒤 겉넓이를 구하시오.",
            "반지름 7 cm, 높이 24 cm인 원뿔입니다. 모선 ℓ을 먼저 구한 뒤 겉넓이를 구하시오.",
        ],
        [
            "24π cm² (ℓ=5)",
            "90π cm²",
            "96π cm²",
            "36π cm²",
            "144π cm²",
            "24π cm² (ℓ=5)",
            "90π cm² (ℓ=13)",
            "216π cm² (ℓ=15)",
            "96π cm² (ℓ=10)",
            "224π cm² (ℓ=25)",
        ],
    ),
    (
        "6. 평행사변형의 넓이",
        "넓이 = 밑변 × 높이",
        ["밑변과 높이는 서로 직각이어야 합니다."],
        [
            "밑변 9 cm, 높이 4 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 12 cm, 높이 5 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 15 cm, 높이 6 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 8 cm, 높이 7 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 20 cm, 높이 3 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 11 cm, 높이 8 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 14 cm, 높이 5 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 10 cm, 높이 10 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 7 cm, 높이 9 cm인 평행사변형의 넓이를 구하시오.",
            "밑변 18 cm, 높이 4 cm인 평행사변형의 넓이를 구하시오.",
        ],
        [
            "36 cm²",
            "60 cm²",
            "90 cm²",
            "56 cm²",
            "60 cm²",
            "88 cm²",
            "70 cm²",
            "100 cm²",
            "63 cm²",
            "72 cm²",
        ],
    ),
    (
        "7. 사다리꼴의 넓이",
        "넓이 = (윗변 + 아랫변) × 높이 ÷ 2",
        [],
        [
            "윗변 4 cm, 아랫변 10 cm, 높이 5 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 6 cm, 아랫변 14 cm, 높이 4 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 5 cm, 아랫변 9 cm, 높이 8 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 8 cm, 아랫변 12 cm, 높이 3 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 7 cm, 아랫변 15 cm, 높이 6 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 10 cm, 아랫변 20 cm, 높이 2 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 3 cm, 아랫변 11 cm, 높이 7 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 9 cm, 아랫변 9 cm, 높이 5 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 12 cm, 아랫변 18 cm, 높이 5 cm인 사다리꼴의 넓이를 구하시오.",
            "윗변 2 cm, 아랫변 8 cm, 높이 10 cm인 사다리꼴의 넓이를 구하시오.",
        ],
        [
            "35 cm²",
            "40 cm²",
            "56 cm²",
            "30 cm²",
            "66 cm²",
            "30 cm²",
            "49 cm²",
            "45 cm²",
            "75 cm²",
            "50 cm²",
        ],
    ),
    (
        "8. 원의 둘레의 길이",
        "둘레 = 2πr = πd",
        [],
        [
            "반지름 5 cm인 원의 둘레를 구하시오.",
            "반지름 8 cm인 원의 둘레를 구하시오.",
            "지름 12 cm인 원의 둘레를 구하시오.",
            "지름 7 cm인 원의 둘레를 구하시오.",
            "반지름 10 cm인 원의 둘레를 구하시오.",
            "반지름 3 cm인 원의 둘레를 구하시오.",
            "지름 20 cm인 원의 둘레를 구하시오.",
            "반지름 1 cm인 원의 둘레를 구하시오.",
            "지름 15 cm인 원의 둘레를 구하시오.",
            "반지름 6 cm인 원의 둘레를 구하시오.",
        ],
        [
            "10π cm",
            "16π cm",
            "12π cm",
            "7π cm",
            "20π cm",
            "6π cm",
            "20π cm",
            "2π cm",
            "15π cm",
            "12π cm",
        ],
    ),
    (
        "9. 원의 넓이",
        "넓이 = πr²",
        [],
        [
            "반지름 4 cm인 원의 넓이를 구하시오.",
            "반지름 7 cm인 원의 넓이를 구하시오.",
            "지름 10 cm인 원의 넓이를 구하시오.",
            "반지름 6 cm인 원의 넓이를 구하시오.",
            "반지름 9 cm인 원의 넓이를 구하시오.",
            "지름 8 cm인 원의 넓이를 구하시오.",
            "반지름 2 cm인 원의 넓이를 구하시오.",
            "반지름 11 cm인 원의 넓이를 구하시오.",
            "지름 14 cm인 원의 넓이를 구하시오.",
            "반지름 5 cm인 원의 넓이를 구하시오.",
        ],
        [
            "16π cm²",
            "49π cm²",
            "25π cm²",
            "36π cm²",
            "81π cm²",
            "16π cm²",
            "4π cm²",
            "121π cm²",
            "49π cm²",
            "25π cm²",
        ],
    ),
    (
        "10. 사각형(직사각형)의 둘레",
        "둘레 = 2(a + b) = 2 × (가로 + 세로)",
        [],
        [
            "가로 6 cm, 세로 4 cm인 직사각형의 둘레를 구하시오.",
            "가로 10 cm, 세로 3 cm인 직사각형의 둘레를 구하시오.",
            "가로 8 cm, 세로 8 cm인 직사각형의 둘레를 구하시오.",
            "가로 12 cm, 세로 5 cm인 직사각형의 둘레를 구하시오.",
            "가로 7 cm, 세로 9 cm인 직사각형의 둘레를 구하시오.",
            "가로 15 cm, 세로 2 cm인 직사각형의 둘레를 구하시오.",
            "가로 11 cm, 세로 6 cm인 직사각형의 둘레를 구하시오.",
            "가로 5 cm, 세로 14 cm인 직사각형의 둘레를 구하시오.",
            "가로 20 cm, 세로 1 cm인 직사각형의 둘레를 구하시오.",
            "가로 9 cm, 세로 9 cm인 직사각형의 둘레를 구하시오.",
        ],
        [
            "20 cm",
            "26 cm",
            "32 cm",
            "34 cm",
            "32 cm",
            "34 cm",
            "34 cm",
            "38 cm",
            "42 cm",
            "36 cm",
        ],
    ),
    (
        "11. 사각형(직사각형)의 넓이",
        "넓이 = 가로 × 세로 = ab",
        [],
        [
            "가로 6 cm, 세로 4 cm인 직사각형의 넓이를 구하시오.",
            "가로 10 cm, 세로 3 cm인 직사각형의 넓이를 구하시오.",
            "가로 8 cm, 세로 7 cm인 직사각형의 넓이를 구하시오.",
            "가로 12 cm, 세로 5 cm인 직사각형의 넓이를 구하시오.",
            "가로 9 cm, 세로 9 cm인 직사각형의 넓이를 구하시오.",
            "가로 14 cm, 세로 2 cm인 직사각형의 넓이를 구하시오.",
            "가로 5 cm, 세로 11 cm인 직사각형의 넓이를 구하시오.",
            "가로 15 cm, 세로 4 cm인 직사각형의 넓이를 구하시오.",
            "가로 7 cm, 세로 8 cm인 직사각형의 넓이를 구하시오.",
            "가로 13 cm, 세로 6 cm인 직사각형의 넓이를 구하시오.",
        ],
        [
            "24 cm²",
            "30 cm²",
            "56 cm²",
            "60 cm²",
            "81 cm²",
            "28 cm²",
            "55 cm²",
            "60 cm²",
            "56 cm²",
            "78 cm²",
        ],
    ),
    (
        "12. 마름모의 넓이",
        "넓이 = (대각선1 × 대각선2) ÷ 2",
        [],
        [
            "두 대각선의 길이가 각각 6 cm, 8 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 10 cm, 12 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 4 cm, 14 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 5 cm, 16 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 8 cm, 8 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 9 cm, 6 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 20 cm, 3 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 7 cm, 10 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 12 cm, 9 cm인 마름모의 넓이를 구하시오.",
            "두 대각선의 길이가 각각 15 cm, 8 cm인 마름모의 넓이를 구하시오.",
        ],
        [
            "24 cm²",
            "60 cm²",
            "28 cm²",
            "40 cm²",
            "32 cm²",
            "27 cm²",
            "30 cm²",
            "35 cm²",
            "54 cm²",
            "60 cm²",
        ],
    ),
    (
        "13. 마름모의 둘레의 길이",
        "둘레 = 4 × (한 변의 길이)",
        [],
        [
            "한 변의 길이가 5 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 8 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 3 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 12 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 7 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 10 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 6 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 15 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 4 cm인 마름모의 둘레를 구하시오.",
            "한 변의 길이가 11 cm인 마름모의 둘레를 구하시오.",
        ],
        [
            "20 cm",
            "32 cm",
            "12 cm",
            "48 cm",
            "28 cm",
            "40 cm",
            "24 cm",
            "60 cm",
            "16 cm",
            "44 cm",
        ],
    ),
    (
        "14. 회전체의 부피 (반원·직사각형 회전)",
        "반원(지름 축) → 구: V = (4/3)πr³　직사각형(한 변 축) → 원기둥: V = πR²h",
        [
            "반원은 직경(지름)을 축으로 360° 돌리면 구가 됩니다. r는 반원의 반지름입니다.",
            "직사각형은 한 변을 축으로 360° 돌리면 원기둥이 됩니다. R은 축에 수직인 변의 길이, h는 축이 되는 변의 길이입니다.",
        ],
        [
            "반지름 3 cm인 반원을 그 지름(직경)을 축으로 한 바퀴 돌려 생긴 입체의 부피를 구하시오.",
            "반지름 6 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 부피를 구하시오.",
            "한 변의 길이가 8 cm, 다른 변의 길이가 5 cm인 직사각형을 5 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 부피를 구하시오.",
            "한 변의 길이가 4 cm, 다른 변의 길이가 6 cm인 직사각형을 4 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 부피를 구하시오.",
            "반지름 9 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 부피를 구하시오.",
            "한 변의 길이가 10 cm, 다른 변의 길이가 7 cm인 직사각형을 7 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 부피를 구하시오.",
            "한 변의 길이가 2 cm, 다른 변의 길이가 15 cm인 직사각형을 2 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 부피를 구하시오.",
            "반지름 5 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 부피를 구하시오.",
            "한 변의 길이가 9 cm, 다른 변의 길이가 4 cm인 직사각형을 9 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 부피를 구하시오.",
            "반지름 10 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 부피를 구하시오.",
        ],
        [
            "36π cm³",
            "288π cm³",
            "320π cm³",
            "144π cm³",
            "972π cm³",
            "700π cm³",
            "450π cm³",
            "(500/3)π cm³",
            "144π cm³",
            "(4000/3)π cm³",
        ],
    ),
    (
        "15. 회전체의 겉넓이 (반원·직사각형 회전)",
        "반원(지름 축) → 구: S = 4πr²　직사각형(한 변 축) → 원기둥: S = 2πR(R + h)",
        [
            "반원을 지름 축으로 돌리면 구이므로 겉넓이는 4πr² 입니다.",
            "직사각형을 한 변 축으로 돌리면 원기둥이므로 겉넓이는 2πR(R+h) 입니다. (R: 축에 수직인 변, h: 축 변)",
        ],
        [
            "반지름 3 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 겉넓이를 구하시오.",
            "반지름 5 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 겉넓이를 구하시오.",
            "한 변의 길이가 8 cm, 다른 변의 길이가 5 cm인 직사각형을 5 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 겉넓이를 구하시오.",
            "한 변의 길이가 4 cm, 다른 변의 길이가 6 cm인 직사각형을 4 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 겉넓이를 구하시오.",
            "반지름 7 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 겉넓이를 구하시오.",
            "한 변의 길이가 3 cm, 다른 변의 길이가 10 cm인 직사각형을 3 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 겉넓이를 구하시오.",
            "반지름 2 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 겉넓이를 구하시오.",
            "한 변의 길이가 12 cm, 다른 변의 길이가 5 cm인 직사각형을 5 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 겉넓이를 구하시오.",
            "반지름 10 cm인 반원을 지름을 축으로 한 바퀴 돌려 생긴 입체의 겉넓이를 구하시오.",
            "한 변의 길이가 6 cm, 다른 변의 길이가 9 cm인 직사각형을 6 cm인 변을 축으로 한 바퀴 돌렸을 때 생기는 입체의 겉넓이를 구하시오.",
        ],
        [
            "36π cm²",
            "100π cm²",
            "208π cm²",
            "120π cm²",
            "196π cm²",
            "260π cm²",
            "16π cm²",
            "408π cm²",
            "400π cm²",
            "270π cm²",
        ],
    ),
]


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_pdf(out_path: Path, font_path: str) -> None:
    pdfmetrics.registerFont(TTFont("Malgun", font_path))

    base = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "T",
        parent=base["Normal"],
        fontName="Malgun",
        fontSize=16,
        leading=20,
        alignment=TA_CENTER,
        spaceAfter=8,
    )
    hint_style = ParagraphStyle(
        "H",
        parent=base["Normal"],
        fontName="Malgun",
        fontSize=9,
        leading=12,
        alignment=TA_CENTER,
        textColor=colors.grey,
        spaceAfter=10,
    )
    h2_style = ParagraphStyle(
        "H2",
        parent=base["Normal"],
        fontName="Malgun",
        fontSize=12,
        leading=17,
        spaceBefore=12,
        spaceAfter=8,
    )
    body = ParagraphStyle(
        "B",
        parent=base["Normal"],
        fontName="Malgun",
        fontSize=10,
        leading=16,
        alignment=TA_LEFT,
    )
    problem_style = ParagraphStyle(
        "Prob",
        parent=body,
        spaceBefore=2,
        spaceAfter=4,
    )
    formula_line = ParagraphStyle(
        "FL",
        parent=body,
        textColor=colors.darkblue,
        leftIndent=8,
        spaceAfter=5,
    )
    answer_style = ParagraphStyle(
        "Ans",
        parent=body,
        leftIndent=10,
        leading=15,
        spaceAfter=7,
    )

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    story: list = []

    story.append(Paragraph(_esc("기하 공식 연습 문제집 (초·중 쉬운 난이도)"), title_style))
    story.append(
        Paragraph(
            _esc(
                "각 단원 상단에 공식이 한 번 정리되어 있습니다. "
                "단위는 cm입니다 (둘레·한 변의 길이는 cm, 넓이·겉넓이는 cm², 부피는 cm³). "
                "정답은 문서 맨 뒤에 모아 두었습니다."
            ),
            hint_style,
        )
    )

    for title, short_formula, extra_lines, problems, _answers in SECTIONS:
        story.append(Paragraph(_esc(title), h2_style))
        story.append(
            Paragraph(
                f'<font color="darkblue"><b>【공식】</b> {_esc(short_formula)}</font>',
                formula_line,
            )
        )
        for el in extra_lines:
            story.append(Paragraph(_esc(f"※ {el}"), formula_line))
        story.append(Spacer(1, 10))

        for i, q in enumerate(problems, 1):
            story.append(Paragraph(f"<b>문제 {i}.</b> {_esc(q)}", problem_style))
            story.append(Spacer(1, 10))

        story.append(Spacer(1, 16))

    story.append(PageBreak())
    story.append(Paragraph(_esc("정답"), title_style))
    story.append(
        Paragraph(
            _esc("앞쪽 문제 1번~15단원 순서와 동일하게, 단원별 1~10번 정답입니다."),
            hint_style,
        )
    )

    for title, _sf, _extra, _problems, answers in SECTIONS:
        story.append(Paragraph(_esc(title), h2_style))
        for i, ans in enumerate(answers, 1):
            story.append(
                Paragraph(
                    f"<b>{i}.</b> {_esc(ans)}",
                    answer_style,
                )
            )
        story.append(Spacer(1, 14))

    doc.build(story)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out = root / "qa-artifacts" / "geometry_formula_practice_easy.pdf"
    font = _pick_font()
    build_pdf(out, font)
    print(f"생성 완료: {out}")


if __name__ == "__main__":
    main()
