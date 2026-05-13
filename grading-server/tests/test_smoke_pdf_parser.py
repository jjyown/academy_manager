"""스모크 테스트 — 정적 정의가 사라지는 회귀 방지.

2026-05-13: `_extract_answers_per_page_vision()` 정의가 commit 9d096b1
(Phase 5a)에서 삭제됐는데 호출(pdf_parser.py:274)은 그대로 남아 NameError 발생.
try/except 가 흡수해 fast path 결과(16문제)만 저장.

2026-05-14: 진단 엔드포인트 URL prefix 가 메모리에서 누락돼 404 헛삽질
(`/drive-diagnose` 호출했는데 실제는 `/api/answer-keys/drive-diagnose`).
라우트 등록 자체가 회귀하지 않도록 정적 검증.
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


def test_diagnose_routes_registered():
    """drive-diagnose / vision-diagnose 라우트가 router 에 등록돼 있어야 함.

    이 라우트들은 운영 디버깅 1차 도구라 사라지면 안 됨 (메모리
    reference_vision_diagnose_endpoint.md 참조).
    """
    from routers import answer_keys

    paths = {r.path for r in answer_keys.router.routes}
    assert "/api/answer-keys/drive-diagnose" in paths
    # vision-diagnose 는 {key_id} path param 포함
    assert any(p.startswith("/api/answer-keys/vision-diagnose") for p in paths)
