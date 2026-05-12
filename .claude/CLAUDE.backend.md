# 백엔드 세부 매뉴얼

> 루트 [CLAUDE.md](../CLAUDE.md) 보충. `grading-server/` (FastAPI) 관련 작업 시 참조.

## 구조
- [grading-server/main.py](../grading-server/main.py): FastAPI 앱 엔트리
- [grading-server/routers/](../grading-server/routers/): 라우터 모음
- [grading-server/grading/](../grading-server/grading/): 채점·해설 로직 (Gemini Vision 사용)
- [grading-server/ocr/](../grading-server/ocr/): OCR 보조
- [grading-server/integrations/](../grading-server/integrations/): Google Drive / Supabase 연동
- [grading-server/scheduler/](../grading-server/scheduler/): APScheduler 백그라운드 작업
- [grading-server/auth.py](../grading-server/auth.py), [grading-server/config.py](../grading-server/config.py)

## 환경 변수
- `grading-server/.env.example` 참고. Supabase URL/Key, Google OAuth, Gemini API Key 필수.
- 절대 코드에 하드코딩 금지. `config.py`를 통해서만 접근.

## 검증
1. `cd grading-server && pip install -r requirements.txt` (venv 권장: `grading-server/.venv/`)
2. 변경 모듈 import 검증: `python -c "from main import app"`
3. 로컬 실행: `uvicorn main:app --reload --port 8000`
4. 라우터별 curl 또는 FastAPI `/docs` Swagger UI로 동작 확인
5. Docker 통합: 루트에서 `docker compose up --build`

## 채점 흐름 (Phase 1~5a)
1. **Phase 1**: `problems_json` 통합 데이터 모델 (b1bc142)
2. **Phase 2 + 4**: 문제별 이미지 크롭, 해설 자동 추출 (1b2c142)
3. **Phase 5a**: Gemini Vision 마크다운 정제 + Drive `index.md` 저장 (9d096b1)
4. 페이지별 Vision 보강은 `vision-diagnose`와 동일 흐름 (33a8214)
5. `_is_corrupted_pdf_glyphs` 필터는 **완화 상태** 유지 — Vision 응답 false-negative 회피 (1153373)

## 주의
- Gemini 응답 파싱 시 false-negative 회피 로직(`_is_corrupted_pdf_glyphs` 등)을 임의로 강화 금지. 회귀 위험.
- Drive 업로드 후 `index.md`는 사람이 읽을 정제본 — 정제 룰 변경 시 기존 산출물 호환성 확인.
- Supabase 클라이언트는 `integrations/`를 통해서만 사용. 직접 import 금지.
