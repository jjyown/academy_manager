"""pdf_parser 스모크 테스트 — 함수 정의 자체가 사라지는 회귀 방지.

2026-05-13 회귀: `_extract_answers_per_page_vision()` 정의가 commit 9d096b1
(Phase 5a)에서 삭제됐는데 호출(pdf_parser.py:274)은 그대로 남아 NameError 발생.
try/except 가 흡수해 fast path 결과(16문제)만 저장. 함수 시그니처/존재 여부만
검증해도 같은 종류 회귀 즉시 차단된다.
"""
import inspect


def test_perpage_vision_function_exists():
    """_extract_answers_per_page_vision 정의 존재 + 호출 사이트와 시그니처 일치."""
    from grading.pdf_parser import _extract_answers_per_page_vision

    sig = inspect.signature(_extract_answers_per_page_vision)
    params = sig.parameters
    assert "pdf_bytes" in params
    assert "page_indices" in params
    assert "expected_numbers" in params
    assert inspect.iscoroutinefunction(_extract_answers_per_page_vision)
