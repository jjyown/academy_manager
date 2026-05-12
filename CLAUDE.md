# Academy Manager — 매뉴얼

> 글로벌 룰(`~/.claude/CLAUDE.md`)에 더해 이 프로젝트 한정 규칙. **이 파일이 항상 우선.**

## 1. 정체성 — 뭘 만드는 프로젝트인지
학원 운영 통합 시스템. 출석/일정/수납/학생/숙제/채점·해설 자동화를 한 코드베이스에서 처리.

- **클라이언트**: 정적 사이트 (HTML/CSS/Vanilla JS) — 운영자/선생님·학부모(`parent-portal/`)·학생 숙제 제출(`homework/`)·자동채점(`grading/`)
- **백엔드**: FastAPI ([grading-server/](grading-server/)) — Gemini Vision + Google Drive + Supabase 연동, 시험지 해설 자동 제작
- **DB/인프라**: Supabase (Auth + Postgres + Edge Functions + Storage)
- **배포**: 프론트는 Vercel(`highroad-math`), 채점 서버는 Docker(로컬/클라우드 동일 이미지)

## 2. 도구 — 어떤 스택·외부 서비스
- Node `20.x` (정적 사이트, 빌드 단계 없음)
- Python `>=3.11` (`grading-server/requirements.txt` 참고: FastAPI 0.115, supabase 2.7, google-generativeai 0.8, pdfplumber, PyMuPDF)
- Supabase 프로젝트 ref: `jzcrpdeomjmytfekcgqu` (운영)
- Google Drive API (숙제 제출/해설 인덱스 저장)
- MCP: Supabase (read-only) — 위험 명령(`apply_migration` 등)은 글로벌 deny

## 3. 검증 방법 — **가장 중요**. 변경 후 반드시 해당 항목 실행

### 프론트엔드 (정적 사이트)
- 로컬 띄우기: `python -m http.server 8000` 후 브라우저에서 `http://localhost:8000`
- 변경한 화면을 실제 브라우저로 클릭해 확인. 콘솔 에러 0개 확인.
- Vanilla JS이므로 타입체크 없음 — `node -c <file>.js`로 구문 체크 가능

### 백엔드 (FastAPI / `grading-server/`)
- 의존성: `cd grading-server && pip install -r requirements.txt`
- 로컬 실행: `cd grading-server && uvicorn main:app --reload --port 8000`
- 변경 모듈 import 검증: `cd grading-server && python -c "import main"` (최소한)
- 헬스 체크: `curl http://localhost:8000/` 또는 라우터별 엔드포인트
- Docker 전체 검증: `docker compose up --build` (루트에서)

### Supabase 마이그레이션
- **MCP `apply_migration` 절대 사용 금지** (deny 처리됨). SQL Editor 직접 실행 패턴.
- 신규 파일은 `migrations/NNNN_*_YYYYMMDD.sql`, BEGIN/COMMIT으로 감싸기, 하단에 검증 SELECT 포함.
- 적용 전 SQL Editor 상단에서 `select current_database(), inet_server_addr()`로 운영 프로젝트(`jzcrpdeomjmytfekcgqu`) 연결 확인.
- 작성 후 사용자에게 "SQL Editor에 붙여넣고 Run" 안내, 결과 확인 후 다음 단계.

## 4. DO
- 변경 후 위 검증 명령어 **반드시 실행**. 못 돌리면 못 돌렸다고 명시.
- 새 일 시작 시 `/memory`로 관련 기억 확인 후 진행.
- 시크릿은 `.env.local` / Supabase Secrets / Vercel 환경변수에. 코드/커밋/로그에 절대 X.
- 마이그레이션은 트랜잭션 + 적용 후 검증 SELECT 포함.
- 커밋 메시지는 한국어 + Conventional Commits (`feat(grading): ...`, `fix(rls): ...`).

## 5. DON'T
- **RLS `auth.uid()` → `(select auth.uid())` 래핑 금지** (advisor `auth_rls_initplan` 경고는 수용). 본 코드베이스에서 클라이언트가 `current_owner_id`를 잃고 `?owner_user_id=eq.null` 400 에러 대량 발생 회귀 사례 있음(2026-05-09 0028 마이그레이션 롤백).
- Supabase MCP `apply_migration` / `execute_sql`(DDL) / `reset_branch` / `delete_branch` 호출 금지. read-only SELECT만 사용.
- `.mcp.json` 토큰을 새 위치로 옮기지 말 것 — gitignore 처리 여부 먼저 확인 후 사용자에게 보고.
- `index.html` 같은 거대 단일 파일을 임의 분할 금지. 사용자 동의 후 진행.
- 새로운 빌드 도구(webpack, vite 등) 무단 도입 금지. "정적 사이트, 빌드 없음" 패턴 유지.

## 6. 분할 매뉴얼 (필요시 자동 로드)
- 프론트엔드 세부: [.claude/CLAUDE.frontend.md](.claude/CLAUDE.frontend.md)
- 백엔드 세부: [.claude/CLAUDE.backend.md](.claude/CLAUDE.backend.md)
- 학부모 포털: [docs/VERCEL_HIGHROAD_PARENT_PORTAL.md](docs/VERCEL_HIGHROAD_PARENT_PORTAL.md)

## 7. 트리거 단어 (이 단어가 나오면 정해진 동작)
- "**검증해줘**" → 위 §3 검증 절차 전체 실행
- "**마이그레이션 만들어줘**" → `migrations/NNNN_*_YYYYMMDD.sql` 템플릿(트랜잭션+검증 SELECT)으로 작성 후 SQL Editor 안내
- "**해설 제작**" / "**채점**" → `grading-server/` 모듈 우선 탐색
- "**숙제 제출 흐름**" → `homework/` + Edge Function `upload-homework` / `exchange-google-token`
