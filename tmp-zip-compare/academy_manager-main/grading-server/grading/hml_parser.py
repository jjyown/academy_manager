"""HML(HWPML) 파일 정답 추출: 수학비서 등 한글 XML에서 미주(ENDNOTE) 파싱

수학비서 HML의 미주 구조 (실제 XML 분석 결과):
- <ENDNOTE> 안에 [정답] 마커 + 정답값 + [해설] + 풀이
- 문제 번호는 <AUTONUM> 태그가 자동 생성 (텍스트에 없음) → 순번 사용
- 숫자형 정답은 <EQUATION><SCRIPT>22</SCRIPT></EQUATION> 안에 있을 수 있음
- 객관식 정답(①②③④⑤)은 <CHAR> 텍스트에 직접 포함

AI 호출 없이 XML 직접 파싱 → 100% 정확
"""
import re
import logging

logger = logging.getLogger(__name__)

CIRCLE_NUMS = {"①", "②", "③", "④", "⑤"}


async def extract_answers_from_hml(hml_bytes: bytes) -> dict:
    """HML 파일에서 미주(ENDNOTE)의 정답+해설 자동 추출

    Returns:
        {"answers": {"1": "③", "2": "22", ...},
         "types":   {"1": "mc", "2": "short", ...},
         "explanations": {"1": "f'(x)=...", "2": "..."},
         "total": N}
    """
    raw = hml_bytes.decode("utf-8")

    answers: dict[str, str] = {}
    types: dict[str, str] = {}
    explanations: dict[str, str] = {}

    endnote_blocks = _split_endnote_blocks(raw)
    logger.info(f"[HML] ENDNOTE 블록 {len(endnote_blocks)}개 발견")

    if not endnote_blocks:
        footnote_blocks = _split_note_blocks(raw, "FOOTNOTE")
        if footnote_blocks:
            logger.info(f"[HML] FOOTNOTE 블록 {len(footnote_blocks)}개 발견 (fallback)")
            endnote_blocks = footnote_blocks

    seq = 0
    for block in endnote_blocks:
        answer, expl = _parse_endnote_block(block)
        if answer is None:
            continue

        seq += 1
        q_num = str(seq)
        answers[q_num] = answer
        types[q_num] = _determine_type(answer)
        if expl:
            explanations[q_num] = expl

    if answers:
        logger.info(f"[HML] 정답 추출 완료: {len(answers)}문제")
        for q in sorted(answers.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            logger.info(f"  [{q}번] 정답: {answers[q]} ({types.get(q, '?')})")
    else:
        logger.warning("[HML] 미주에서 정답을 찾지 못했습니다. "
                       "ENDNOTE 블록은 있으나 [정답] 마커가 없을 수 있습니다.")

    return {
        "answers": answers,
        "types": types,
        "explanations": explanations,
        "total": len(answers),
    }


def _split_endnote_blocks(raw: str) -> list[str]:
    """ENDNOTE 블록을 split 방식으로 추출 (대용량 파일 대응)"""
    return _split_note_blocks(raw, "ENDNOTE")


def _split_note_blocks(raw: str, tag: str) -> list[str]:
    """XML에서 지정 태그 블록을 split으로 추출

    re.findall의 (.*?) 패턴은 수 MB 단일 라인에서 느릴 수 있어
    split 기반으로 처리.
    """
    open_tag = f"<{tag}"
    close_tag = f"</{tag}>"

    blocks = []
    parts = raw.split(open_tag)

    for part in parts[1:]:
        close_idx = part.find(close_tag)
        if close_idx == -1:
            continue
        gt_idx = part.find(">")
        if gt_idx == -1 or gt_idx >= close_idx:
            continue
        block_content = part[gt_idx + 1:close_idx]
        blocks.append(block_content)

    return blocks


def _parse_endnote_block(block: str) -> tuple[str | None, str | None]:
    """미주 블록에서 정답값과 해설 추출

    패턴 (실제 XML 분석 기반):
    - CHAR 텍스트에 "[정답]" 마커 존재
    - 마커 뒤에 정답값: CHAR 텍스트(③) 또는 EQUATION>SCRIPT(22)
    - "[해설]" 마커 뒤에 풀이

    Returns: (answer, explanation) or (None, None)
    """
    if "정답" not in block:
        return None, None

    chars = _extract_all_text(block)
    combined = " ".join(chars)

    answer = _find_answer_value(block, chars, combined)
    if not answer:
        return None, None

    explanation = _find_explanation(combined)
    return answer, explanation


def _extract_all_text(block: str) -> list[str]:
    """블록에서 CHAR 텍스트 + EQUATION/SCRIPT 텍스트 모두 추출

    순서를 유지하여 [정답] 마커 뒤의 값을 올바르게 찾을 수 있게 함.
    태그 종류에 따라 마커를 삽입하여 구분.
    """
    fragments = []

    for m in re.finditer(
        r"<CHAR[^>]*?>([^<]*)</CHAR>"
        r"|<SCRIPT[^>]*?>([^<]*)</SCRIPT>",
        block,
    ):
        char_text = m.group(1)
        script_text = m.group(2)

        if char_text is not None and char_text.strip():
            fragments.append(char_text.strip())
        elif script_text is not None and script_text.strip():
            fragments.append(f"[EQ:{script_text.strip()}]")

    return fragments


def _find_answer_value(block: str, fragments: list[str], combined: str) -> str | None:
    """[정답] 마커 뒤에서 정답값 추출

    Case 1: "[정답] ③" - CHAR 텍스트에 정답이 바로 포함
    Case 2: "[정답]" 다음 EQUATION/SCRIPT에 "22" - 수식 안에 정답
    Case 3: "[정답]" 다음 CHAR에 정답값
    """
    for i, frag in enumerate(fragments):
        if "정답" not in frag:
            continue

        after = re.sub(r".*정답[」\]）\s]*", "", frag).strip()
        after = after.strip("[]）」 ")

        if after:
            clean = _clean_answer(after)
            if clean:
                return clean

        for j in range(i + 1, min(i + 4, len(fragments))):
            next_frag = fragments[j]
            if "해설" in next_frag:
                break

            eq_m = re.match(r"\[EQ:(.+?)\]", next_frag)
            if eq_m:
                clean = _clean_answer(eq_m.group(1))
                if clean:
                    return clean

            clean = _clean_answer(next_frag)
            if clean and clean not in ("[EQ]", "해설"):
                return clean

    return None


def _find_explanation(combined: str) -> str | None:
    """[해설] 마커 뒤에서 풀이 텍스트 추출"""
    m = re.search(r"해설[」\]）\s]*[:：·\s]*(.*)", combined, re.DOTALL)
    if not m:
        return None

    expl = m.group(1).strip()
    expl = re.sub(r"\[EQ:[^\]]*\]", "[수식]", expl)

    if len(expl) > 500:
        expl = expl[:500] + "..."
    return expl if expl else None


def _clean_answer(raw: str) -> str | None:
    """정답 텍스트 정리"""
    s = raw.strip()
    s = re.sub(r"\[EQ:([^\]]*)\]", r"\1", s)
    s = s.strip("[]）」·: ")

    if not s or s in ("해설", "풀이", "정답"):
        return None

    if "해설" in s:
        s = re.sub(r"\s*해설.*", "", s).strip()

    return s if s else None


def _determine_type(answer: str) -> str:
    """정답값으로 문제 유형 판별"""
    if not answer:
        return "short"

    ans = answer.strip()
    if ans in CIRCLE_NUMS or any(c in ans for c in CIRCLE_NUMS):
        return "mc"

    return "short"
