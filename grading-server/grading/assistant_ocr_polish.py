"""전문 채점조교 모듈 #1 — OCR 정제 조교.

학생 답안 OCR 결과의 수식·기호·부호를 표준화한다.
글씨체 편차로 인한 OCR 오인식(예: 'x2+1' → 'x²+1', '루트2' → '√2',
'1/2' → 1/2 분수 표기 통일)을 사전에 잡아 후속 채점 정확도를 끌어올림.

파이프라인 위치: cross_validate_ocr 직후, agent_verify 직전.
입력: ocr_results 리스트(각 이미지당 dict: {"answers": {q: "..."}, ...})
출력: 같은 구조에 normalized_answers 필드가 추가된 리스트.
       원본 answers 는 보존 — 채점 로직은 정제본을 우선 사용하되 폴백 가능.

비용: Gemini 2.5 Flash 1회 호출(전 이미지 답안 배치). 텍스트만 입력 → 저렴.
폴백: API 실패 시 regex 기반 보수적 변환으로 대체.
"""
import asyncio
import json
import logging
import re

from config import (
    OCR_POLISHER_BATCH_LIMIT,
    OCR_POLISHER_HARD_TIMEOUT_SECONDS,
)
from integrations.gemini import _gemini_call_with_retry

logger = logging.getLogger(__name__)


# regex 기반 1차 안전 변환 — LLM 실패해도 최소 효과 보장.
# 의도적으로 보수적: 모호한 케이스는 손대지 않는다.
_RE_SAFE_POWER = re.compile(r"\b([a-zA-Z])\s*\^?\s*([2-9])\b")  # x2, x ^ 2 → x²
_SUPERSCRIPT_MAP = {"2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"}
_RE_ROOT_WORD = re.compile(r"루트\s*(-?\d+(?:\.\d+)?)")
_RE_FRACTION_WORD = re.compile(r"(\d+)\s*분의\s*(\d+)")
_RE_TIMES_X = re.compile(r"(\d)\s*[xX×]\s*(\d)")  # 3x4 → 3×4 (변수 x 와 구분 필요)
_RE_MULTI_SPACE = re.compile(r"\s+")


def _regex_polish(text: str) -> str:
    """LLM 폴백용 보수적 정규화. 모호한 케이스는 건드리지 않음."""
    if not text:
        return text
    s = str(text)

    # x2 → x², x3 → x³ (변수 한 글자 + 숫자만 안전)
    def _pow_repl(m: re.Match) -> str:
        var, num = m.group(1), m.group(2)
        sup = _SUPERSCRIPT_MAP.get(num)
        return f"{var}{sup}" if sup else m.group(0)
    s = _RE_SAFE_POWER.sub(_pow_repl, s)

    # 루트 N → √N
    s = _RE_ROOT_WORD.sub(lambda m: f"√{m.group(1)}", s)

    # N분의 M → M/N
    s = _RE_FRACTION_WORD.sub(lambda m: f"{m.group(2)}/{m.group(1)}", s)

    # 다중 공백 정리
    s = _RE_MULTI_SPACE.sub(" ", s).strip()
    return s


def _flatten_answers_for_batch(ocr_results: list[dict]) -> list[tuple[int, str, str]]:
    """OCR 결과 리스트에서 (image_idx, question_key, raw_answer) 튜플로 평탄화.

    answer 값이 dict({"answer": "..."}) 형태일 수도 있고 str 직접일 수도 있어 양쪽 대응.
    """
    rows: list[tuple[int, str, str]] = []
    for i, r in enumerate(ocr_results or []):
        ans_dict = (r or {}).get("answers") or {}
        for qk, av in ans_dict.items():
            if isinstance(av, dict):
                raw = av.get("answer") or av.get("ocr1") or av.get("ocr2") or ""
            else:
                raw = av or ""
            raw = str(raw).strip()
            if raw:
                rows.append((i, str(qk), raw))
    return rows


def _build_prompt(rows: list[tuple[int, str, str]]) -> str:
    """Gemini 배치 프롬프트 — JSON in, JSON out."""
    pairs = [{"id": f"{i}:{qk}", "raw": raw} for (i, qk, raw) in rows]
    return (
        "당신은 한국 수학 학원의 전문 채점조교입니다. 학생들의 OCR 인식 답안을 수학 표기 표준에 맞게 "
        "정제(normalize)하는 작업을 합니다.\n\n"
        "규칙:\n"
        "1) 의미를 절대 바꾸지 마세요. 표기만 표준화합니다.\n"
        "2) 'x2' → 'x²', 'a3' → 'a³' (지수 표기 통일)\n"
        "3) '루트2', '루트 5', 'sqrt(3)' → '√2', '√5', '√3'\n"
        "4) '2분의 1', '1/2' → '1/2' (분수 표기 통일)\n"
        "5) 명백한 OCR 오인식(예: 'l' → '1', 'O' → '0')만 보정 — 모호하면 원본 유지\n"
        "6) 객관식 마킹(①②③④⑤, 1~5)은 숫자(1,2,3,4,5)로 통일\n"
        "7) 답이 비어 있거나 정제할 게 없으면 원본 그대로 반환\n\n"
        "아래는 학생 답안 목록입니다. 각 항목의 raw 를 normalized 로 정제한 결과를 JSON 으로 반환하세요.\n"
        "응답은 반드시 JSON 배열 한 개만, 다른 텍스트 없이:\n"
        '  [{"id":"<원래 id>","normalized":"<정제된 답>"}, ...]\n\n'
        f"입력:\n{json.dumps(pairs, ensure_ascii=False)}\n"
    )


def _parse_response(text: str) -> dict[str, str]:
    """모델 응답 JSON 을 dict[id → normalized] 로 변환. 실패 시 빈 dict."""
    if not text:
        return {}
    s = text.strip()
    # 마크다운 코드펜스 제거
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        data = json.loads(s)
    except Exception:
        # JSON 배열만 추출 시도
        m = re.search(r"\[.*\]", s, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {}
    out: dict[str, str] = {}
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                k = item.get("id")
                v = item.get("normalized")
                if k is not None and v is not None:
                    out[str(k)] = str(v)
    return out


async def polish_ocr_results(ocr_results: list[dict]) -> list[dict]:
    """OCR 결과 정제. 원본 answers 보존 + 새 키 normalized_answers 부착.

    실패 시(API 오류/timeout) regex 폴백으로 최대한 정제하여 절대 빈 손으로 돌아가지 않음.
    """
    if not ocr_results:
        return ocr_results

    rows = _flatten_answers_for_batch(ocr_results)
    if not rows:
        return ocr_results

    # 배치 크기 제한 — 너무 큰 입력은 분할
    chunks: list[list[tuple[int, str, str]]] = []
    limit = OCR_POLISHER_BATCH_LIMIT if OCR_POLISHER_BATCH_LIMIT > 0 else len(rows)
    for i in range(0, len(rows), limit):
        chunks.append(rows[i:i + limit])

    normalized_map: dict[str, str] = {}
    use_llm = True
    for chunk in chunks:
        prompt = _build_prompt(chunk)
        try:
            resp = await asyncio.wait_for(
                _gemini_call_with_retry(prompt, label="OCR-Polish"),
                timeout=OCR_POLISHER_HARD_TIMEOUT_SECONDS,
            )
            text = getattr(resp, "text", "") or ""
            parsed = _parse_response(text)
            normalized_map.update(parsed)
        except asyncio.TimeoutError:
            logger.warning(
                f"[OCR-Polish] timeout({OCR_POLISHER_HARD_TIMEOUT_SECONDS}s) — 이 청크는 regex 폴백"
            )
            use_llm = False
            for (i, qk, raw) in chunk:
                normalized_map[f"{i}:{qk}"] = _regex_polish(raw)
        except Exception as e:
            logger.warning(f"[OCR-Polish] LLM 호출 실패 — regex 폴백: {e}")
            use_llm = False
            for (i, qk, raw) in chunk:
                normalized_map[f"{i}:{qk}"] = _regex_polish(raw)

    # 결과 부착 — normalized_answers 보조 키 + 채점에 실제 영향 주도록 answers 도 정제본으로 교체.
    # 원본 OCR 텍스트는 보존 위해 answers[q] = {"answer": normalized, "ocr1": ..., "ocr2": ..., "raw": 원본}
    # 형태로 강제 dict 변환 — grader 가 dict.answer 를 읽도록 이미 설계됨.
    polished: list[dict] = []
    for i, r in enumerate(ocr_results or []):
        new_r = dict(r) if isinstance(r, dict) else {"answers": {}}
        ans_dict = dict(new_r.get("answers") or {})
        norm_dict: dict[str, str] = {}
        for qk, av in list(ans_dict.items()):
            key = f"{i}:{qk}"
            if isinstance(av, dict):
                raw_original = str(av.get("answer") or av.get("ocr1") or "")
            else:
                raw_original = str(av or "")
            normalized = normalized_map.get(key, raw_original)
            norm_dict[str(qk)] = normalized
            if isinstance(av, dict):
                av_new = dict(av)
                av_new["raw"] = av_new.get("raw", raw_original)
                av_new["answer"] = normalized
                ans_dict[qk] = av_new
            else:
                # 단순 str 값을 dict 로 승격해서 raw 보존
                ans_dict[qk] = {"answer": normalized, "raw": raw_original}
        new_r["answers"] = ans_dict
        new_r["normalized_answers"] = norm_dict
        polished.append(new_r)

    logger.info(
        f"[OCR-Polish] 정제 완료: 이미지 {len(polished)}장, 답안 {len(rows)}개 "
        f"(엔진: {'LLM+폴백' if not use_llm else 'LLM'})"
    )
    return polished
