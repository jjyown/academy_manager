"""정답 PDF 파싱: Mathpix 1순위 → Gemini Vision 폴백으로 정답 추출

엔진 우선순위 (PDF_EXTRACTION_PRIMARY로 강제 가능):
1) Mathpix /v3/pdf (인쇄된 수식·텍스트에 강점, 충전량 부족 시 자동 비활성)
2) Gemini Vision (이미지 변환 → 비전 OCR + 정답 JSON 직접 생성)
3) pdfplumber 텍스트 → Gemini 텍스트 파싱 (둘 다 실패 시)

지원하는 교재 구조:
- 프린트 과제: 문제 → 빠른정답 → 해설
- 시중 교재: 문제 → 해설 (해설에 정답 포함)

페이지 범위가 지정되면 해당 페이지만 처리 (시중 교재 200p+ 대응)
"""
import logging
import json
import re
import base64
import io
import fitz  # PyMuPDF
import pdfplumber
from integrations.gemini import parse_answers_from_pdf
from ocr import mathpix

logger = logging.getLogger(__name__)

# 정답/해설 페이지를 식별하는 키워드
ANSWER_PAGE_KEYWORDS = [
    "빠른정답", "빠른 정답", "정답", "답안", "해설", "풀이",
    "정답 및 해설", "정답과 해설", "Answer", "Solutions",
    "정답·해설", "정답과풀이", "정답및풀이",
]


def _detect_essay_problem_numbers(full_text: str, candidate_numbers: list[str]) -> set:
    """주어진 문제 번호들 중 "서술형"으로 추정되는 것을 식별.

    문제 텍스트 본문에 다음 마커 중 하나라도 있으면 essay:
      - "풀이 과정을 자세히 쓰시오" (가장 흔함)
      - "[서술형]" / "(서술형)"
      - "서술하시오"
      - "이유를 설명하시오" / "이유를 쓰시오"
      - "과정을 쓰시오" / "과정을 서술하시오"

    감지 방법: 각 문제 번호의 텍스트 영역(다음 문제 번호 전까지)을 잘라
    공백·줄바꿈 정규화 후 마커 substring 매칭.
    """
    ESSAY_MARKERS_COMPACT = [
        "풀이과정을자세히쓰시오",
        "풀이과정을자세히",
        "[서술형]",
        "(서술형)",
        "서술하시오",
        "이유를설명하시오",
        "이유를쓰시오",
        "과정을쓰시오",
        "과정을서술하시오",
    ]
    essay_set: set = set()
    if not full_text or not candidate_numbers:
        return essay_set
    text = full_text
    for num in candidate_numbers:
        try:
            n = int(num)
        except (TypeError, ValueError):
            continue
        # 문제 시작 위치 — "\nNN." 또는 "\nNN)" 형식
        start_idx = -1
        for pat in [f"\n{n}.", f"\n{n})"]:
            idx = text.find(pat)
            if idx >= 0 and (start_idx < 0 or idx < start_idx):
                start_idx = idx
        if start_idx < 0:
            continue
        # 다음 문제 시작 위치
        next_idx = len(text)
        for nn in range(n + 1, n + 4):  # 다음 3개 번호까지만 탐색
            for pat in [f"\n{nn}.", f"\n{nn})"]:
                idx = text.find(pat, start_idx + 1)
                if idx >= 0 and idx < next_idx:
                    next_idx = idx
        block = text[start_idx:next_idx]
        block_compact = re.sub(r"\s+", "", block)
        for marker in ESSAY_MARKERS_COMPACT:
            if marker in block_compact:
                essay_set.add(num)
                break
    return essay_set


def _is_corrupted_pdf_glyphs(s: str) -> bool:
    """PDF 텍스트 레이어가 수학·특수 폰트의 글리프 매핑 실패로 깨진 문자열인지 판별.

    증상: "ºåå, ˜å å", "ò̀, åå" 같이 라틴 확장 영역(å, Å, ò, Ò, ˜, º 등)이 다수 등장.
    실제 답은 한글·숫자·수식이어야 하므로, 그 외 글자가 일정 비율 이상이면 깨진 것으로 본다.

    판정 기준 (둘 중 하나라도 만족하면 깨진 것):
      a) 라틴 확장(U+0080~U+02FF, ASCII 외 첫 블록) 문자가 1자 이상
      b) "정상 문자(한글·영숫자·일반 수학기호·원형숫자·공백·구두점)" 비율이 60% 미만
    """
    if not s:
        return True
    s = s.strip()
    if not s:
        return True

    # (a) 라틴 확장/IPA/결합기호가 다수 — 깨진 글리프로 판정 (단순 1자 임계값은 너무 엄격해
    # AI Vision 응답에 가끔 섞이는 비ASCII 1~2자(예: nbsp, soft hyphen)로 정상 답을 잘못 거르는
    # 사례 발생. 30% 이상일 때만 깨진 것으로 보수적으로 판단.
    suspicious_count = 0
    for c in s:
        cp = ord(c)
        if 0x0080 <= cp <= 0x024F or 0x02B0 <= cp <= 0x036F:
            suspicious_count += 1
    if suspicious_count / max(1, len(s)) > 0.30:
        return True

    # (b) 정상 문자 비율 — 50% 미만이면 깨진 것 (60% 보다 관대)
    allowed_extra = set(" ,.()-+*/=:;√π^_<>≤≥≠×÷±°∠△□○●◇◆⋅⋯…⟨⟩〈〉《》『』「」、，·ㆍ?!~@#$%&'\"\\")
    normal = 0
    for c in s:
        if c.isalnum():  # 한글·영문·숫자 모두 포함
            normal += 1
        elif '가' <= c <= '힯':  # 한글 음절(중복이지만 명시)
            normal += 1
        elif c in "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮":
            normal += 1
        elif c in allowed_extra:
            normal += 1
    ratio = normal / max(1, len(s))
    return ratio < 0.50


def _extract_simple_answer_table_from_text(text: str) -> dict | None:
    """텍스트 레이어에서 명확한 답안표 패턴을 정규식으로 즉시 추출 (AI 불필요).

    지원 패턴 (한 줄 단위 매칭):
      - "1) [정답] ②"            ← 사용자 표준 양식
      - "1) [정답] -3"
      - "1. [정답] ③"
      - "1번 정답: ②"
      - "1: ③"  /  "1.③"  (compact, 보수적으로만 매칭)

    답 형식:
      - 원형숫자(①②③④⑤) → mc
      - 그 외 토큰 (숫자/수식/콤마구분 다답) → short

    임계값: 최소 3문항 이상 매칭 시에만 채택 (오탐 방지).
    """
    if not text:
        return None

    CIRCLE_NUMS = {"①", "②", "③", "④", "⑤"}

    # 패턴별 정규식 — 한 번에 (문제번호, 정답토큰) 캡처
    # 정답은 가능한 한 넓게 잡되, 공백/괄호/탭 등은 토큰 끝으로 처리
    patterns = [
        # "1) [정답] ②"  /  "1) [정답] -3"  /  "1) [정답] (1) 14 (2) -3"
        r"^\s*(\d+)\s*[\)\.]\s*\[\s*정답\s*\]\s*(.+?)(?:\s*$)",
        # "1번 정답: ②"  /  "1번 정답 ②"
        r"^\s*(\d+)\s*번?\s*정답\s*[:：]?\s*(.+?)(?:\s*$)",
        # "1. ③" (콤팩트, 보기 없이 답만)
        r"^\s*(\d+)\s*[\)\.]\s*([①②③④⑤])\s*$",
    ]

    best: dict | None = None
    for pat in patterns:
        try:
            matches = re.findall(pat, text, flags=re.MULTILINE)
        except re.error:
            continue
        if len(matches) < 3:
            continue
        answers: dict[str, str] = {}
        types: dict[str, str] = {}
        for num, raw in matches:
            q = str(num).strip()
            ans = str(raw).strip()
            # 답 정제: 후행 잡음(페이지표 등) 컷
            ans = ans.split("\n")[0].strip()
            # 너무 길면 잡음 — 60자 초과는 거름
            if not ans or len(ans) > 60:
                continue
            # 콤마·공백·구두점만 있는 답은 PDF 텍스트 레이어가 수학 수식·숫자를
            # 못 읽은 케이스 (예: "17) [정답] , , " ← 실제 답은 "5, 7, 13" 류).
            # 이런 항목은 저장하지 않아 빈 답으로 채점·표시되는 혼란을 막는다.
            ans_no_noise = re.sub(r"[\s,，·、ㆍ;:.]", "", ans)
            if not ans_no_noise:
                continue
            # 깨진 글리프(라틴 확장·결합 기호로 가득 찬 답) 도 제외 — 사용자가
            # + 문제 추가 로 수동 입력하도록 유도. 잘못된 답으로 채점되는 것보다 안전.
            if _is_corrupted_pdf_glyphs(ans):
                continue
            answers[q] = ans
            if any(c in ans for c in CIRCLE_NUMS) and len(ans) <= 3:
                types[q] = "mc"
            else:
                types[q] = "short"
        if len(answers) < 3:
            continue
        # 가장 많이 잡은 패턴 결과 채택
        if best is None or len(answers) > len(best.get("answers", {})):
            best = {"answers": answers, "types": types, "total": len(answers)}

    if best:
        # 서술형 자동 감지 — 문제 본문에 "풀이 과정을 자세히 쓰시오" 등 마커가
        # 있으면 short → essay 로 격상. 객관식(mc)은 격상하지 않음.
        essay_nums = _detect_essay_problem_numbers(text, list(best["answers"].keys()))
        if essay_nums:
            for q in essay_nums:
                if best["types"].get(q) == "short":
                    best["types"][q] = "essay"
            logger.info(
                f"[FastPath] 텍스트 정규식 {best['total']}문제 추출 "
                f"(서술형 마커 감지: {sorted(essay_nums)})"
            )
        else:
            logger.info(f"[FastPath] 텍스트 정규식으로 {best['total']}문제 즉시 추출")
        return best
    return None


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
        {"answers": {...}, "types": {...}, "total": int,
         "page_images": [{"page": 1, "image_bytes": bytes}, ...]}
    """
    # 0차 fast path: 텍스트 레이어에 명확한 답안표 패턴이 있으면 정규식으로 즉시 추출
    # AI 호출 없이 결정적·즉각적 — 사용자 표준 양식("1) [정답] ②") 100% 회수.
    try:
        text_for_fast = _extract_text_from_pdf(pdf_bytes, page_range)
        fast = _extract_simple_answer_table_from_text(text_for_fast) if text_for_fast.strip() else None
    except Exception as e:
        logger.warning(f"[FastPath] 실패(무시): {e}")
        fast = None

    if fast:
        # Fast path 가 잡지 못한 번호(보통 PDF 수학 폰트 깨짐으로 텍스트 추출
        # 실패한 단답·서술형)를 Tail Vision 으로 보강. 마지막 페이지 이미지는
        # 정상 렌더링되니 AI 가 직접 보고 채울 수 있다.
        try:
            fast_keys = set(fast["answers"].keys())
            max_fast = max((int(k) for k in fast_keys if k.isdigit()), default=0)

            # 예상 최대 번호 추정:
            #  - total_hint 우선
            #  - 없으면 max_fast + 5 (4~5문항 추가 가능성 보수적 추정)
            expected_max = total_hint or (max_fast + 5)
            missing = [str(n) for n in range(1, expected_max + 1) if str(n) not in fast_keys]

            if missing and len(missing) >= 1:
                logger.info(
                    f"[FastPath] {len(fast_keys)}건 추출, "
                    f"누락 추정 {len(missing)}건({missing[:5]}{'...' if len(missing)>5 else ''}) "
                    f"→ 페이지별 Vision 으로 보강 시도"
                )
                # 빠른정답은 보통 PDF 최후 1페이지에 있음. vision-diagnose 와 동일하게
                # 마지막 1페이지만 호출 (이전 2페이지 호출은 LLM 컨텍스트 혼선으로
                # 일부만 반환되는 stochastic regression 야기).
                total_pages = _get_total_pages(pdf_bytes)
                tail_count = 1
                tail_indices = list(range(total_pages - tail_count, total_pages))
                tail = await _extract_answers_per_page_vision(
                    pdf_bytes, tail_indices, expected_numbers=missing,
                )
                if tail and tail.get("answers"):
                    merged_answers = dict(fast["answers"])
                    merged_types = dict(fast["types"])
                    added = 0
                    for q, ans in tail["answers"].items():
                        # fast 가 이미 잡은 건 신뢰(텍스트 레이어는 깨끗했단 의미).
                        # 누락 분만 채움.
                        if q in merged_answers:
                            continue
                        # Tail 결과도 깨진 글리프면 제외
                        if _is_corrupted_pdf_glyphs(str(ans)):
                            continue
                        merged_answers[q] = ans
                        merged_types[q] = tail.get("types", {}).get(q, "short")
                        added += 1
                    if added > 0:
                        # 보강 후 서술형 재감지
                        essay_nums = _detect_essay_problem_numbers(
                            text_for_fast, list(merged_answers.keys())
                        )
                        for q in essay_nums:
                            if merged_types.get(q) == "short":
                                merged_types[q] = "essay"
                        logger.info(
                            f"[FastPath+Tail] 보강 {added}건 → 총 {len(merged_answers)}문제"
                        )
                        fast = {
                            "answers": merged_answers,
                            "types": merged_types,
                            "total": len(merged_answers),
                        }
        except Exception as e:
            logger.warning(f"[FastPath+Tail merge] 실패(fast 결과만 사용): {e}")

        # 정규식으로 답안표를 잡은 경우, 페이지 썸네일 추가해 반환
        page_images = _pdf_to_thumbnails(pdf_bytes)
        fast["page_images"] = page_images
        return fast

    primary = await _resolve_primary_engine()
    result = None

    # 1차: Mathpix (primary=mathpix일 때만)
    if primary == "mathpix":
        try:
            result = await _extract_with_mathpix(pdf_bytes, total_hint, page_range)
            if result and result.get("total", 0) > 0:
                logger.info(f"[Mathpix] 정답 추출 완료: {result['total']}문제")
            else:
                logger.warning("[Mathpix] 정답 0건 → Gemini Vision 폴백")
                result = None
        except Exception as e:
            logger.warning(f"[Mathpix] 예외 발생, Gemini Vision 폴백: {e}")
            result = None

    # 2차: Gemini Vision (primary=gemini이거나 Mathpix가 실패/소진된 경우)
    if not result:
        try:
            result = await _extract_with_gemini_vision(pdf_bytes, total_hint, page_range)
            if result.get("total", 0) > 0:
                logger.info(f"[Vision] 정답 추출 완료: {result['total']}문제")
            else:
                logger.warning("[Vision] 정답을 찾지 못함, 마지막 페이지 답안표 전용 재시도")
                result = None
        except Exception as e:
            logger.warning(f"[Vision] 실패: {e}, 마지막 페이지 답안표 전용 재시도")

    # 2.5차 fallback: 마지막 1~3 페이지를 "답안표 전용" 프롬프트로 재시도.
    # 일반 Vision 프롬프트는 "보기(①②③④⑤)가 있는 문제만 mc"로 보수적이라
    # 빠른정답 페이지처럼 "1) [정답] ② / 2) [정답] ①" 형태(보기 없음, 답만 나열)
    # 에서 0건 반환하는 경우가 있어 답안표 전용 프롬프트로 회수율 보강.
    # page_range가 명시되지 않은 경우만 발동 (사용자가 범위 지정했으면 그 안에서만).
    if not result and not page_range:
        try:
            result = await _extract_tail_answer_table(pdf_bytes, total_hint)
            if result and result.get("total", 0) > 0:
                logger.info(f"[Tail] 마지막 페이지 답안표 추출 완료: {result['total']}문제")
            else:
                result = None
        except Exception as e:
            logger.warning(f"[Tail] 실패: {e}, 텍스트 방식으로 재시도")

    # 3차 fallback: pdfplumber 텍스트 추출 → Gemini 텍스트 파싱
    if not result:
        text = _extract_text_from_pdf(pdf_bytes, page_range)
        if not text.strip():
            logger.warning("PDF에서 텍스트를 추출할 수 없습니다")
            result = {"answers": {}, "types": {}, "total": 0}
        else:
            result = await parse_answers_from_pdf(text, total_hint)
            logger.info(f"[Text] 정답 추출 완료: {result.get('total', 0)}문제")

    # 정답 추출 후 전체 페이지 썸네일 생성 (백그라운드 Drive 업로드용)
    page_images = _pdf_to_thumbnails(pdf_bytes)
    logger.info(f"[Thumbnails] {len(page_images)}페이지 썸네일 생성 완료")
    result["page_images"] = page_images

    return result


async def _resolve_primary_engine() -> str:
    """PDF 정답 추출 1순위 엔진 결정.

    PDF_EXTRACTION_PRIMARY 명시값 > Mathpix 가용성 > "gemini"
    """
    from config import PDF_EXTRACTION_PRIMARY
    forced = (PDF_EXTRACTION_PRIMARY or "").strip().lower()
    if forced in ("mathpix", "gemini"):
        if forced == "mathpix" and not await mathpix.is_usable_for_ocr():
            logger.info("[Engine] PDF_EXTRACTION_PRIMARY=mathpix 지정됐으나 사용 불가 → gemini 사용")
            return "gemini"
        return forced

    if await mathpix.is_usable_for_ocr():
        return "mathpix"
    return "gemini"


async def _extract_with_mathpix(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict | None:
    """Mathpix /v3/pdf 로 PDF → MMD 텍스트 추출 후 Gemini로 정답 JSON 파싱.

    page_range가 지정되면 해당 페이지만 잘라 보내 Mathpix 호출 비용을 줄인다.
    quota 에러는 mathpix 모듈이 자동으로 exhausted 마킹하므로 호출자는
    None만 반환받으면 다음 엔진(Gemini Vision)으로 자연 폴백된다.
    """
    target_bytes = pdf_bytes
    if page_range:
        sliced = _slice_pdf(pdf_bytes, page_range)
        if sliced:
            target_bytes = sliced
            logger.info(f"[Mathpix] page_range {page_range} 슬라이스: "
                        f"{len(pdf_bytes)//1024}KB → {len(target_bytes)//1024}KB")
        else:
            logger.warning(f"[Mathpix] page_range 슬라이스 실패, 전체 PDF로 진행")

    res = await mathpix.ocr_pdf(target_bytes, output_format="mmd")
    if not res.get("ok"):
        if res.get("quota_exceeded"):
            logger.warning(f"[Mathpix] 충전량 소진 감지 → 이후 호출 자동 차단: {res.get('error')}")
        else:
            logger.warning(f"[Mathpix] PDF OCR 실패: {res.get('error')}")
        return None

    mmd_text = (res.get("text") or "").strip()
    if not mmd_text:
        logger.warning("[Mathpix] 빈 결과 텍스트")
        return None

    parsed = await parse_answers_from_pdf(mmd_text, total_hint)
    answers = parsed.get("answers") or {}
    types = parsed.get("types") or {}
    answers, types = _validate_answer_types(answers, types)
    return {
        "answers": answers,
        "types": types,
        "total": len(answers),
    }


def _slice_pdf(pdf_bytes: bytes, page_range: tuple[int, int]) -> bytes | None:
    """page_range(1-based, 양끝 포함)에 해당하는 페이지만 가진 PDF 바이트 반환."""
    try:
        src = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            total = len(src)
            start = max(0, page_range[0] - 1)
            end = min(total, page_range[1]) - 1
            if start > end:
                return None
            dst = fitz.open()
            try:
                dst.insert_pdf(src, from_page=start, to_page=end)
                return dst.tobytes()
            finally:
                dst.close()
        finally:
            src.close()
    except Exception as e:
        logger.warning(f"[Mathpix] PDF 슬라이스 실패: {e}")
        return None


async def _extract_with_gemini_vision(
    pdf_bytes: bytes,
    total_hint: int | None = None,
    page_range: tuple[int, int] | None = None,
) -> dict:
    """PDF 페이지를 이미지로 변환 후 Gemini Vision으로 정답 추출"""
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

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
            if total_pages <= 10:
                page_indices = list(range(total_pages))
                logger.info(f"전체 {total_pages}p 처리 (10p 이하)")
            else:
                # 정답 페이지를 못 찾으면 뒤쪽 5p만 처리
                page_indices = list(range(max(0, total_pages - 5), total_pages))
                logger.info(f"전체 {total_pages}p 중 뒤쪽 5p 처리 (정답은 보통 뒷부분)")

    CHUNK_SIZE = 15

    # 15페이지 이하면 한 번에 처리, 초과하면 청크 분할
    if len(page_indices) <= CHUNK_SIZE:
        chunks = [page_indices]
    else:
        chunks = [
            page_indices[i:i + CHUNK_SIZE]
            for i in range(0, len(page_indices), CHUNK_SIZE)
        ]
        logger.info(f"대용량 PDF: {len(page_indices)}페이지 → {len(chunks)}개 청크로 분할 처리")

    all_answers = {}
    all_types = {}

    for chunk_idx, chunk_indices in enumerate(chunks):
        page_images = _pdf_to_images(pdf_bytes, page_indices=chunk_indices)
        if not page_images:
            logger.warning(f"청크 {chunk_idx+1}: 이미지 변환 실패, 건너뜀")
            continue

        chunk_label = f"청크 {chunk_idx+1}/{len(chunks)}" if len(chunks) > 1 else "단일"
        logger.info(f"[{chunk_label}] {len(page_images)}페이지 이미지 변환 완료")

        hint_text = ""
        if total_hint and len(chunks) == 1:
            hint_text = f"예상 총 문제 수: {total_hint}"
        elif len(chunks) > 1:
            hint_text = f"이 이미지는 전체 답지의 일부입니다 ({chunk_label}). 보이는 문제의 정답만 추출하세요."

        parts = []
        parts.append(f"""이 이미지들은 수학 교재/프린트의 정답 또는 해설 페이지입니다.

각 문제의 **최종 정답만** 추출해주세요. 풀이 과정은 무시하세요.

정답 찾는 방법:
- "빠른정답" 표가 있으면 → 거기서 바로 추출 (가장 효율적)
- 해설 페이지에서 → 각 문제 번호 옆의 최종 답만 추출
- 정답이 보이지 않는 문제는 건너뛰세요 (추론하지 마세요)

문제번호 규칙:
- "001", "002" 같은 번호 → "1", "2"로 변환
- 소문제가 있으면 → "1(1)", "1(2)" 형태로 (하이픈: "1-1" → "1(1)")
- 단원별로 번호가 초기화되더라도 그대로 유지

★★★ 유형 판별 기준 (매우 중요 - 반드시 따르세요) ★★★
판별 핵심: "문제에 보기(①②③④⑤)가 있고, 그 중 하나를 고르는 문제인가?"

mc (객관식):
- 보기 ①②③④⑤가 있고 하나를 고르는 문제
- 정답을 반드시 원형 숫자로 기록: "①", "②", "③", "④", "⑤"
- 절대 "3"이라고 쓰지 마세요 → 반드시 "③"

short (단답형):
- 숫자, 수식, 단어를 직접 써넣는 문제 (빈칸, "구하시오", "값은?" 등)
- 정답을 있는 그대로 기록: "3", "-5", "2√3", "14", "(1) 14 (2) -3"
- ★ 정답이 1~5 사이 숫자여도, 보기 선택이 아니면 short!
- 프린트/워크시트의 빈칸 채우기, 답 구하기는 모두 short

essay (서술형): 풀이 과정을 서술하는 문제

{hint_text}

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{{"answers": {{"1": "③", "2": "12", "3": "-3", "4(1)": "14", "4(2)": "2√3"}}, "types": {{"1": "mc", "2": "short", "3": "short", "4(1)": "short", "4(2)": "short"}}, "total": 문제수}}""")

        for i, img_bytes in enumerate(page_images):
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            parts.append({"mime_type": "image/jpeg", "data": b64})
            logger.info(f"  [{chunk_label}] 페이지 {i+1}: {len(img_bytes)//1024}KB")

        total_size = sum(len(b) for b in page_images)
        logger.info(f"[{chunk_label}] Gemini Vision 요청: {len(page_images)}페이지, 총 {total_size//1024}KB")

        response = model.generate_content(parts)
        text = response.text.strip()
        logger.info(f"[{chunk_label}] Gemini Vision 응답: {text[:200]}")

        from ocr.engines import _robust_json_parse
        chunk_result = _robust_json_parse(text)
        if not chunk_result or not isinstance(chunk_result, dict):
            logger.warning(f"[{chunk_label}] JSON 파싱 실패, 건너뜀")
            continue

        # 청크별 결과 병합
        chunk_answers = chunk_result.get("answers", {})
        chunk_types = chunk_result.get("types", {})
        all_answers.update(chunk_answers)
        all_types.update(chunk_types)
        logger.info(f"[{chunk_label}] {len(chunk_answers)}문제 추출 (누적: {len(all_answers)}문제)")

    all_answers, all_types = _validate_answer_types(all_answers, all_types)

    result = {
        "answers": all_answers,
        "types": all_types,
        "total": len(all_answers),
    }
    return result


async def extract_markdown_per_page_vision(
    pdf_bytes: bytes,
    page_indices: list[int] | None = None,
) -> dict:
    """페이지별로 Gemini Vision 호출 → 마크다운 텍스트 반환 (Phase 5a 정제).

    각 페이지를 단일 이미지로 보내고, "수학 문제 페이지를 마크다운으로 변환"하는
    프롬프트로 정제된 텍스트를 받음. 수식은 $...$ LaTeX, 객관식 보기는 - ① 형식.

    반환: {1: "# 문제 1\\n...", 2: "...", ...}  (page_num → markdown)
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    if not pdf_bytes:
        return {}

    # 페이지 인덱스 기본값 — 전체
    if page_indices is None:
        try:
            page_indices = list(range(_get_total_pages(pdf_bytes)))
        except Exception:
            return {}
    if not page_indices:
        return {}

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    PROMPT = """이 이미지는 한국 수학 문제집 / 시험지 페이지입니다.
페이지 내용을 **정제된 마크다운(GitHub Flavored Markdown + LaTeX 수식)** 으로 변환하세요.

규칙:
1. 문제 번호로 시작하는 라인은 다음 형식:
   `## 문제 N` (문제 번호만, 본문 X)
   바로 다음 줄부터 본문.
2. 객관식 보기 ①②③④⑤ 는 마크다운 리스트:
   ```
   - ① 보기 1 내용
   - ② 보기 2 내용
   ...
   ```
3. 수식은 **LaTeX 형식 $...$ 또는 $$...$$** — 예: `\\frac{1}{2}`, `\\sqrt{x}`, `x^2`
4. 표·도형은 텍스트로 설명 — 예: `[그림: 한 변 5cm 정사각형]`
5. 페이지 헤더/푸터(페이지번호, 교시명 등)는 무시
6. 빠른정답 페이지면: `# 빠른정답` 후 `- 1) ②` 같은 리스트
7. 해설 페이지면: `## 해설 N` 후 풀이 본문

반드시 마크다운 텍스트만 출력. JSON 감싸지 마세요."""

    result_md: dict = {}
    for page_idx in page_indices:
        try:
            images = _pdf_to_images(pdf_bytes, page_indices=[page_idx])
            if not images:
                continue
            b64 = base64.b64encode(images[0]).decode("utf-8")
            parts = [PROMPT, {"mime_type": "image/jpeg", "data": b64}]
            logger.info(f"[Markdown] page {page_idx+1} Vision OCR 호출 ({len(images[0])//1024}KB)")
            response = model.generate_content(parts)
            text = (response.text or "").strip()
            if not text:
                continue
            # 코드블록(```markdown ... ``` 또는 ``` ... ```) 감쌌으면 벗기기
            if text.startswith("```"):
                lines = text.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                text = "\n".join(lines).strip()
            result_md[page_idx + 1] = text
            logger.info(f"[Markdown] page {page_idx+1} → {len(text)} chars")
        except Exception as e:
            logger.warning(f"[Markdown] page {page_idx+1} 실패: {e}")
            continue
    return result_md


def split_markdown_by_problem(page_md: dict, problem_numbers: list[str]) -> dict:
    """페이지별 마크다운 → 문제별 분리.

    인자:
      page_md: {1: "# 문제 1\\n...\\n## 문제 2\\n...", 2: "..."} (page → md)
      problem_numbers: ['1', '2', ..., '20']

    반환: {'1': "## 문제 1\\n본문...", '2': "..."}
    """
    if not page_md or not problem_numbers:
        return {}

    # 모든 페이지 합치기 (페이지 순서대로)
    all_md = "\n\n".join(page_md[k] for k in sorted(page_md.keys()))

    # 문제 헤더 패턴: "## 문제 N" 또는 "# 문제 N" 또는 줄 시작 "N." / "N)"
    # 가장 안정적: "## 문제 N\\n" 또는 "# 문제 N\\n"
    main_nums = sorted(set(n.split("(")[0] for n in problem_numbers if n.split("(")[0].isdigit()),
                        key=lambda s: int(s))

    # 각 문제 헤더 위치 찾기
    header_positions: list[tuple[str, int]] = []
    for num in main_nums:
        # 우선순위: "## 문제 N\\n" > "# 문제 N\\n" > 줄시작 "N. " > 줄시작 "N) "
        patterns = [
            (f"\n## 문제 {num}\n", "##"),
            (f"\n# 문제 {num}\n", "#"),
            (f"\n{num}. ", "raw."),
            (f"\n{num}) ", "raw)"),
        ]
        # 시작에 있으면 \n 없이도 매치
        also_patterns = [(p[len("\n"):], k) for p, k in patterns]
        positions = []
        for pat, kind in patterns + also_patterns:
            idx = all_md.find(pat)
            if idx >= 0:
                positions.append((idx, kind, pat))
        if not positions:
            continue
        # 가장 빠른 위치 (첫 등장) 선택
        positions.sort(key=lambda x: x[0])
        header_positions.append((num, positions[0][0]))

    if not header_positions:
        return {}

    # 위치순 정렬
    header_positions.sort(key=lambda x: x[1])

    # 각 문제 영역 = 이 헤더 위치 ~ 다음 헤더 직전
    result: dict = {}
    for i, (num, pos) in enumerate(header_positions):
        end = header_positions[i + 1][1] if i + 1 < len(header_positions) else len(all_md)
        block = all_md[pos:end].strip()
        if block:
            result[num] = block
    return result
    """페이지를 **하나씩** Gemini Vision 으로 보내 답안 추출 (단일 이미지 호출).

    배경: 멀티 이미지 + 복잡 프롬프트로 보내면 모델이 컨텍스트 혼란을 일으켜
    빈 객체를 반환하는 경우가 잦음. 페이지별 단일 호출 + 최소 프롬프트로
    안정성·회수율을 끌어올린다.

    반환: {"answers": {...}, "types": {...}, "total": int}  (실패 시 total=0)
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # vision-diagnose 와 동일 prompt 통일 — expected_hint 제거. LLM 이 expected
    # 범위를 좁게 해석해서 일부만 반환하는 stochastic regression 회피.
    all_answers: dict[str, str] = {}
    all_types: dict[str, str] = {}

    from ocr.engines import _robust_json_parse

    for page_idx in page_indices:
        try:
            images = _pdf_to_images(pdf_bytes, page_indices=[page_idx])
            if not images:
                continue
            img_bytes = images[0]

            prompt = """이 이미지에서 "N) [정답] X" 패턴을 모두 찾아 JSON 으로 반환하세요.

예시:
- "1) [정답] ②"            → {"num": "1", "ans": "②", "type": "mc"}
- "17) [정답] a=3, b=7, c=1" → {"num": "17", "ans": "a=3, b=7, c=1", "type": "short"}
- "18) [정답] 45, 75"       → {"num": "18", "ans": "45, 75", "type": "short"}

JSON 만 출력 (다른 텍스트 X):
{"items": [{"num": "1", "ans": "②", "type": "mc"}, ...]}"""

            b64 = base64.b64encode(img_bytes).decode("utf-8")
            parts = [prompt, {"mime_type": "image/jpeg", "data": b64}]

            logger.info(f"[PerPage] page {page_idx+1} Vision 호출 (이미지 {len(img_bytes)//1024}KB)")
            response = model.generate_content(parts)
            text = (response.text or "").strip()
            logger.info(f"[PerPage] page {page_idx+1} 응답: {text[:200]}")

            data = _robust_json_parse(text)
            if not data or not isinstance(data, dict):
                continue
            items = data.get("items")
            if not isinstance(items, list):
                continue

            page_added = 0
            for item in items:
                if not isinstance(item, dict):
                    continue
                num = str(item.get("num", "")).strip()
                ans = str(item.get("ans", "")).strip()
                qtype = str(item.get("type", "short")).strip().lower()
                if not num or not ans:
                    continue
                if _is_corrupted_pdf_glyphs(ans):
                    continue
                if num in all_answers:
                    continue
                all_answers[num] = ans
                all_types[num] = qtype if qtype in ("mc", "short", "essay") else "short"
                page_added += 1
            logger.info(f"[PerPage] page {page_idx+1} → {page_added}건 추출 (누적 {len(all_answers)}건)")
        except Exception as e:
            logger.warning(f"[PerPage] page {page_idx+1} 예외(다음 페이지로): {e}")
            continue

    if not all_answers:
        return {"answers": {}, "types": {}, "total": 0}
    all_answers, all_types = _validate_answer_types(all_answers, all_types)
    return {
        "answers": all_answers,
        "types": all_types,
        "total": len(all_answers),
    }


async def _extract_tail_answer_table(
    pdf_bytes: bytes,
    total_hint: int | None = None,
) -> dict | None:
    """마지막 2~3 페이지를 "답안표 전용" 프롬프트로 시도하는 fallback.

    배경: 일반 Vision 추출은 "정답이 안 보이면 건너뛰라"는 보수적 프롬프트라
    빠른정답 페이지에 헤더("빠른정답" 등)가 없거나 컴팩트한 표만 있으면
    Gemini 가 답을 안 뽑는 경우가 있다. 사용자 양식이 보통 "문제+빠른정답"
    구조라, 마지막 1~3 페이지를 답안표 전용 프롬프트로 한 번 더 시도해
    회수율을 끌어올린다.
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY, GEMINI_MODEL

    total = _get_total_pages(pdf_bytes)
    if total == 0:
        return None
    # 마지막 1~3 페이지 (전체 페이지 수에 따라)
    tail_count = min(3, total)
    tail_indices = list(range(total - tail_count, total))

    images = _pdf_to_images(pdf_bytes, page_indices=tail_indices)
    if not images:
        return None

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    hint_line = f"예상 총 문제 수: {total_hint}" if total_hint else ""
    prompt = f"""이 이미지는 수학 문제집 PDF의 **마지막 {tail_count}페이지**입니다.
여기에 **빠른정답표 / 답안표 / 정답표**가 있는지 보고, 있다면 **모든 답**을 추출하세요.

답안표는 보통 이런 형태입니다 (자주 등장하는 패턴 순):

**패턴 1 — `[정답]` 표기 (가장 흔함):**
- "1) [정답] ②"  ← 객관식
- "17) [정답] a=3, b=7, c=1"  ← 단답형 (변수+값 형식)
- "18) [정답] 45, 75"  ← 단답형 (다답)
- "19) [정답] 2√3"  ← 단답형 (수식)

**패턴 2 — 간결 표기:**
- "1. ③  2. ①  3. ②" / "1) ③  2) ①" / "1 ③  2 ①"

**패턴 3 — 헤더 변형:**
- "빠른정답", "정답표", "정답 및 해설" 헤더가 있을 수도, 없을 수도 있음

★ 헤더가 없어도 됩니다 — **번호 + 답이 짝지어진 패턴**만 보이면 추출.
★ 풀이/해설 본문은 무시 — 답안표(또는 [정답] 표기)가 우선.
★ 단답형이 다답("45, 75" / "a=3, b=7, c=1")이면 **그대로 콤마 포함해 추출**.

문제번호 규칙:
- 1, 2, 3, ..., 20 그대로
- 소문제는 "1(1)", "1(2)" 형식
- 단원/교시별로 번호가 초기화되더라도 그대로 유지

답 형식·유형 규칙:
- 객관식 원형숫자 보기(①②③④⑤): 그대로 "①" "②" "③" "④" "⑤" → type=mc
- 단답형 (숫자/수식/변수=값/콤마구분 다답): 그대로 "3", "-5", "14", "2√3", "a=3, b=7, c=1", "45, 75" → type=short
- 숫자만 적혀 있으면 short, 원형숫자면 mc

{hint_line}

**답안표가 전혀 안 보이면 빈 객체 반환**:
{{"answers": {{}}, "types": {{}}, "total": 0}}

답안표가 있으면 JSON 형식으로만 응답 (다른 텍스트 X):
{{"answers": {{"1": "③", "17": "a=3, b=7, c=1", "18": "45, 75", ...}}, "types": {{"1": "mc", "17": "short", "18": "short", ...}}, "total": 문제수}}"""

    parts = [prompt]
    for img_bytes in images:
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        parts.append({"mime_type": "image/jpeg", "data": b64})

    total_size = sum(len(b) for b in images)
    logger.info(f"[Tail] 마지막 {tail_count}p 답안표 전용 추출 시도 ({total_size//1024}KB)")

    try:
        response = model.generate_content(parts)
        text = (response.text or "").strip()
        logger.info(f"[Tail] 응답: {text[:200]}")

        from ocr.engines import _robust_json_parse
        result = _robust_json_parse(text)
        if not result or not isinstance(result, dict):
            logger.warning("[Tail] JSON 파싱 실패")
            return None

        answers = result.get("answers") or {}
        types = result.get("types") or {}
        if not answers:
            logger.info("[Tail] 답안표 미발견 (빈 응답)")
            return None
        answers, types = _validate_answer_types(answers, types)
        logger.info(f"[Tail] 답안표 추출 성공: {len(answers)}문제")
        return {
            "answers": answers,
            "types": types,
            "total": len(answers),
        }
    except Exception as e:
        logger.warning(f"[Tail] 추출 실패: {e}")
        return None


def crop_problems_from_pdf(
    pdf_bytes: bytes,
    problem_numbers: list[str],
    dpi: int = 220,
) -> list[dict]:
    """PDF 페이지에서 각 문제 영역을 자동 검출 + 크롭 (해설지 제작 questionVisuals 패턴).

    동작:
      1) 각 페이지에서 fitz.Page.search_for 로 문제 번호 헤더("N." / "N)") bbox 검출
      2) 페이지 내 헤더들을 y 좌표 오름차순 정렬
      3) 문제 N 영역 = [헤더 y0] ~ [다음 헤더 y0] (또는 페이지 끝)
      4) 그 영역만 220 DPI JPEG 으로 렌더링

    반환: [{"num": "1", "image_bytes": b"...", "page_num": 1}, ...]
    """
    if not problem_numbers:
        return []
    # 메인 번호만 추출 (소문제 1(1) 은 main=1 그룹)
    main_nums = sorted(set(
        n.split("(")[0] for n in problem_numbers if n.split("(")[0].isdigit()
    ), key=lambda s: int(s))
    if not main_nums:
        return []

    from PIL import Image
    HEADER_RE = re.compile(r"^\s*(\d+)\s*[\)\.]")
    main_set = set(main_nums)
    crops: list[dict] = []
    seen_global: set = set()  # 한 num 은 PDF 전체에서 첫 헤더 한 번만 사용
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                # 페이지를 텍스트 블록으로 분해 후, 블록 내 어느 라인이든 "N." 또는 "N)"
                # 패턴으로 시작하면 그 라인의 bbox 를 헤더로 인정.
                # 블록 단위 + 라인 단위 양쪽을 동시에 보기 위해 dict 모드 사용.
                headers: list[tuple[str, "fitz.Rect"]] = []
                try:
                    page_dict = page.get_text("dict")
                except Exception:
                    page_dict = {"blocks": []}

                def _try_match_text_to_header(text: str, bbox):
                    if not text or not bbox or len(bbox) < 4:
                        return None
                    m = HEADER_RE.match(text)
                    if not m:
                        return None
                    num = m.group(1)
                    if num not in main_set or num in seen_global:
                        return None
                    return num, fitz.Rect(*bbox)

                for blk in page_dict.get("blocks", []):
                    if blk.get("type") != 0:
                        continue
                    # 블록 첫 라인 시도
                    lines = blk.get("lines", [])
                    if not lines:
                        continue
                    first_line = lines[0]
                    first_text = "".join(s.get("text", "") for s in first_line.get("spans", []))
                    result_match = _try_match_text_to_header(first_text, blk.get("bbox"))
                    if result_match:
                        num, rect = result_match
                        headers.append((num, rect))
                        seen_global.add(num)
                        continue
                    # 폴백: 블록 내 다른 라인이 헤더 패턴인 경우
                    for line in lines:
                        line_text = "".join(s.get("text", "") for s in line.get("spans", []))
                        result_match = _try_match_text_to_header(line_text, line.get("bbox"))
                        if result_match:
                            num, rect = result_match
                            headers.append((num, rect))
                            seen_global.add(num)
                            break  # 한 블록에 같은 헤더 여러 번 매칭 방지

                if not headers:
                    continue

                # 동일 페이지에 같은 번호가 여러 곳에 나오는 경우(보기 안 등) 거름:
                # y0 오름차순 정렬 + 중복 num 시 최상단 1개만
                headers.sort(key=lambda x: x[1].y0)
                seen: set = set()
                deduped: list[tuple[str, "fitz.Rect"]] = []
                for num, rect in headers:
                    if num in seen:
                        continue
                    seen.add(num)
                    deduped.append((num, rect))
                deduped.sort(key=lambda x: x[1].y0)

                page_rect = page.rect
                mat = fitz.Matrix(dpi / 72, dpi / 72)

                for i, (num, rect) in enumerate(deduped):
                    top = max(page_rect.y0, rect.y0 - 6)  # 위 여유 6pt
                    if i + 1 < len(deduped):
                        bottom = min(page_rect.y1, deduped[i + 1][1].y0 - 4)
                    else:
                        bottom = page_rect.y1
                    if bottom - top < 20:  # 너무 작은 영역은 skip (잘못된 매칭)
                        continue
                    clip = fitz.Rect(page_rect.x0, top, page_rect.x1, bottom)
                    try:
                        pix = page.get_pixmap(matrix=mat, clip=clip)
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=82)
                        crops.append({
                            "num": num,
                            "image_bytes": buf.getvalue(),
                            "page_num": page_idx + 1,
                        })
                    except Exception as e:
                        logger.warning(f"[Crop] page {page_idx+1} 문제 {num} 영역 렌더 실패: {e}")
        finally:
            doc.close()
    except Exception as e:
        logger.warning(f"[Crop] 전체 실패(빈 리스트 반환): {e}")
        return []

    logger.info(f"[Crop] 총 {len(crops)} 문제 영역 크롭 완료")
    return crops


# ============================================================
# 해설 페이지 추출 (Phase 4)
# ============================================================
EXPLANATION_PROBLEM_PATTERNS = [
    # "1. 답 ... 해설:" / "1) ... [해설]" 처럼 답 라벨 뒤에 풀이가 오는 형태
    r"(?:^|\n)\s*(\d+)\s*[\)\.]\s*(?:\[?해설\]?[:：]?|풀이[:：]?)\s*(.+?)(?=(?:\n\s*\d+\s*[\)\.])|$)",
    # "[1] 해설" 형태
    r"(?:^|\n)\s*\[\s*(\d+)\s*\]\s*(?:해설|풀이)[:：]?\s*(.+?)(?=(?:\n\s*\[\s*\d+\s*\])|$)",
    # 가장 일반적: 문제 번호로 시작하고 다음 번호 전까지 모두 해설로 간주
    r"(?:^|\n)\s*(\d+)\s*[\)\.]\s*(.+?)(?=(?:\n\s*\d+\s*[\)\.])|$)",
]


def extract_explanations_from_pdf_text(pdf_bytes: bytes) -> dict:
    """해설 페이지가 있으면 각 문제번호의 해설 텍스트 추출.

    동작:
      1) _find_answer_page_indices 의 해설 시작 페이지(explanation_start)부터
      2) 그 페이지들의 텍스트 추출
      3) 위 정규식으로 "번호 + 해설 본문" 매칭, 가장 많이 잡힌 패턴 채택
      4) 깨진 글리프 답은 제외

    반환: {"1": "해설 본문...", "2": "...", ...}  (해설 없으면 빈 dict)
    """
    if not pdf_bytes:
        return {}
    # 해설 페이지 식별 — _find_answer_page_indices 가 ranges 만 반환하므로
    # 여기선 직접 키워드 스캔으로 해설 시작 페이지 찾는다.
    EXPLANATION_KEYWORDS = ["해설", "풀이"]
    QUICK_KEYWORDS = ["빠른정답", "빠른 정답", "정답표"]
    explanation_start = -1
    quick_start = -1
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            for i, page in enumerate(doc):
                text = page.get_text("text") or ""
                if not text:
                    continue
                first_300 = text[:300].replace(" ", "")
                if quick_start < 0:
                    for kw in QUICK_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            quick_start = i
                            break
                if explanation_start < 0:
                    for kw in EXPLANATION_KEYWORDS:
                        if kw in first_300:
                            explanation_start = i
                            break
            # 해설 시작은 빠른정답 뒤에 있어야 의미 있음(시험지 본문의 "풀이 과정" 마커 회피)
            if explanation_start >= 0 and quick_start >= 0 and explanation_start < quick_start:
                # 시험지 본문의 "풀이 과정을 쓰시오" 같은 마커일 가능성 — 그 다음 풀이 페이지 탐색
                for i in range(quick_start + 1, len(doc)):
                    t = (doc[i].get_text("text") or "")[:300].replace(" ", "")
                    if any(kw in t for kw in EXPLANATION_KEYWORDS):
                        explanation_start = i
                        break
                else:
                    explanation_start = -1

            if explanation_start < 0:
                logger.info("[Explanations] 해설 페이지 미감지 — 빈 dict 반환")
                return {}

            # 해설 페이지부터 끝까지 텍스트 모음
            tail_text_parts = []
            for i in range(explanation_start, len(doc)):
                t = doc[i].get_text("text") or ""
                if t:
                    tail_text_parts.append(t)
            tail_text = "\n".join(tail_text_parts)
        finally:
            doc.close()
    except Exception as e:
        logger.warning(f"[Explanations] PDF 처리 실패: {e}")
        return {}

    if not tail_text.strip():
        return {}

    # 패턴별 매칭 시도 — 가장 많이 잡힌 결과 채택
    best: dict[str, str] = {}
    for pat in EXPLANATION_PROBLEM_PATTERNS:
        try:
            matches = re.findall(pat, tail_text, flags=re.MULTILINE | re.DOTALL)
        except re.error:
            continue
        if not matches:
            continue
        explanations: dict[str, str] = {}
        for num, body in matches:
            n = str(num).strip()
            text = str(body).strip()
            # 후행 잡음 컷 (페이지 번호, 단위 라벨 등 첫 ~600자 제한)
            text = re.sub(r"\s+", " ", text)[:600]
            if not text or len(text) < 5:
                continue
            if _is_corrupted_pdf_glyphs(text):
                continue
            if n not in explanations or len(text) > len(explanations[n]):
                explanations[n] = text
        if len(explanations) > len(best):
            best = explanations

    if best:
        logger.info(f"[Explanations] {len(best)} 문제 해설 추출")
    return best


def _validate_answer_types(answers: dict, types: dict) -> tuple[dict, dict]:
    """AI가 분류한 문제 유형을 검증·보정

    규칙:
    - 정답이 ①②③④⑤ → mc 확정
    - type=mc인데 정답이 "1"~"5" → mc 유지 + 원형 숫자로 변환
    - type=mc인데 정답이 6 이상 / 음수 / 수식 → short로 보정
    - type=short인데 정답이 ①②③④⑤ → mc로 보정
    """
    CIRCLE_NUMS = {"①", "②", "③", "④", "⑤"}
    NUM_TO_CIRCLE = {"1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤"}

    fixed_answers = dict(answers)
    fixed_types = dict(types)
    fix_count = 0

    for q, ans in answers.items():
        raw = str(ans).strip()
        qtype = fixed_types.get(q, "mc")

        if qtype == "essay":
            continue

        has_circle = any(c in raw for c in CIRCLE_NUMS)

        if qtype == "mc":
            if has_circle:
                pass
            elif raw in NUM_TO_CIRCLE:
                fixed_answers[q] = NUM_TO_CIRCLE[raw]
            else:
                fixed_types[q] = "short"
                fix_count += 1

        elif qtype == "short" and has_circle and len(raw) <= 2:
            fixed_types[q] = "mc"
            fix_count += 1

    if fix_count:
        logger.info(f"[TypeFix] {fix_count}건 유형 보정 완료")

    return fixed_answers, fixed_types


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

    우선순위:
    1. "빠른정답" 페이지 → 해당 페이지 + 2페이지 (보통 1~3p)
    2. "정답" 페이지 → 해당 페이지 + 4페이지
    3. "해설" 페이지 → 해당 페이지 + 7페이지 (해설은 좀 더 필요)
    """
    QUICK_ANSWER_KEYWORDS = ["빠른정답", "빠른 정답", "정답과풀이", "정답및풀이", "정답·해설"]
    ANSWER_KEYWORDS = ["정답", "답안", "Answer", "Solutions", "정답 및 해설", "정답과 해설"]
    EXPLANATION_KEYWORDS = ["해설", "풀이"]

    quick_start = None
    answer_start = None
    explanation_start = None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            total = len(doc)

            for i, page in enumerate(doc):
                text = page.get_text("text")
                if not text:
                    continue

                first_300 = text[:300].replace(" ", "")

                if quick_start is None:
                    for kw in QUICK_ANSWER_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            quick_start = i
                            break

                if answer_start is None and quick_start is None:
                    for kw in ANSWER_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            answer_start = i
                            break

                if explanation_start is None:
                    for kw in EXPLANATION_KEYWORDS:
                        if kw.replace(" ", "") in first_300:
                            explanation_start = i
                            break
        finally:
            doc.close()

        # ── 케이스 1: 빠른정답 발견 → 해설 시작 전까지 ──
        if quick_start is not None:
            if explanation_start and explanation_start > quick_start:
                end = explanation_start
            else:
                end = min(quick_start + 10, total)
            indices = list(range(quick_start, end))
            logger.info(f"[빠른정답] 발견: {quick_start+1}p ~ {end}p (전체 {total}p, {len(indices)}페이지 처리)")
            return indices

        # ── 케이스 2: 답지 전용 PDF 감지 ──
        # 정답/해설 키워드가 첫 2페이지 내에서 발견되면
        # PDF 전체가 답지인 것으로 판단 → 전체 페이지 사용
        is_answer_only_pdf = False
        if answer_start is not None and answer_start <= 1:
            is_answer_only_pdf = True
        elif explanation_start is not None and explanation_start <= 1:
            is_answer_only_pdf = True

        if is_answer_only_pdf:
            indices = list(range(total))
            logger.info(f"[답지 전용 PDF] 감지: 전체 {total}p 처리 (정답이 1p부터 시작)")
            return indices

        # ── 케이스 3: 전체 교재 (문제+정답 합본) ──
        # 정답 섹션이 교재 뒷부분에 있으면 → 정답 시작부터 끝까지 전부
        if answer_start is not None:
            end = total
            indices = list(range(answer_start, end))
            logger.info(f"[전체교재→정답섹션] {answer_start+1}p ~ {end}p (전체 {total}p, 정답 {len(indices)}페이지 처리)")
            return indices

        # ── 케이스 4: 해설만 발견 → 해설부터 끝까지 ──
        if explanation_start is not None:
            end = total
            indices = list(range(explanation_start, end))
            logger.info(f"[전체교재→해설섹션] {explanation_start+1}p ~ {end}p (전체 {total}p, 해설 {len(indices)}페이지 처리)")
            return indices

    except Exception as e:
        logger.error(f"정답 페이지 탐색 실패: {e}")

    return []


def _pdf_to_images(
    pdf_bytes: bytes,
    page_indices: list[int] | None = None,
) -> list[bytes]:
    """PDF 특정 페이지들을 JPEG 이미지로 변환 (PyMuPDF 사용)"""
    from PIL import Image
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
            mat = fitz.Matrix(220 / 72, 220 / 72)  # 220 DPI (수학 기호/분수 정확도 향상)
            pix = page.get_pixmap(matrix=mat)
            # PNG → JPEG 변환 (파일 크기 대폭 감소)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=80)
            images.append(buf.getvalue())

        doc.close()
        logger.info(f"PDF→이미지 변환: {len(images)}페이지 (전체 {total}p 중)")
    except Exception as e:
        logger.error(f"PDF→이미지 변환 실패 (PyMuPDF): {e}")
    return images


def _pdf_to_thumbnails(
    pdf_bytes: bytes,
) -> list[dict]:
    """PDF 전체 페이지를 썸네일로 변환 (base64 data URL로 DB 직접 저장용)

    Returns:
        [{"page": 1, "image_bytes": bytes}, ...]  (page는 1-based)
    """
    from PIL import Image
    thumbnails = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total = len(doc)

        for i in range(total):
            page = doc[i]
            mat = fitz.Matrix(200 / 72, 200 / 72)  # 200 DPI
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            thumbnails.append({
                "page": i + 1,
                "image_bytes": buf.getvalue(),
            })

        doc.close()
        logger.info(f"PDF→썸네일: 전체 {total}페이지 변환 완료")
    except Exception as e:
        logger.error(f"PDF→썸네일 변환 실패: {e}")
    return thumbnails


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
