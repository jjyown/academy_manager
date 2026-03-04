# 출석관리앱 체크리스트

- 문서 기준일: 2026-03-04

## 공통 품질 체크
- [x] 요구사항 재확인 후 구현 시작
- [x] 변경 파일/영향 범위 확인
- [ ] 에러 처리(실패 응답/예외) 포함
- [x] 회귀 가능 구간 점검
- [x] 문서(`plan/context/checklist`) 업데이트
- [x] 작업 1건 완료 시 문서 3종 즉시 동기화

## 기능 체크 (출석 도메인)
- [ ] 학생 등록/수정/삭제 시 출석 연관 데이터 영향 확인
- [ ] 동일 학생/동일 수업/동일 날짜 중복 저장 방지
- [ ] 출석 상태 전환 규칙(출석/지각/조퇴/결석) 검증
- [ ] 반/수업/기간 필터 조회 정확성 확인
- [ ] 대량 입력 또는 반복 입력 시 성능/오류 점검

## 권한/보안 체크
- [ ] 교사만 수정 가능, 학생은 조회만 가능
- [ ] 인증 없는 요청 차단
- [ ] 권한 우회(타 반/타 교사 데이터 수정) 차단
- [ ] 민감 데이터 노출 여부 점검

## 데이터 무결성 체크
- [ ] 필수값 누락 저장 방지
- [ ] 잘못된 상태값 저장 방지
- [ ] 트랜잭션/동시성 이슈 점검
- [ ] 변경 이력(누가/언제/무엇을) 저장 확인

## 테스트/검증 결과 기록
| 날짜 | 작업 | 검증 방법 | 결과 | 비고 |
|---|---|---|---|---|
| 2026-03-01 | 문서 기반 워크플로우 초기 세팅 | 파일 생성/규칙 적용 확인 | PASS | `.cursor/rules` + `docs` 3종 반영 |
| 2026-03-01 | 기존 변경 파일 점검 계획 수립 | `git status` 기반 영향 범위 확인 | PASS | `grading/index.html`, `grading-server/routers/results.py` |
| 2026-03-01 | 기존 변경 코드 리뷰 | `git diff` 기반 정적 점검 | PASS | 기능 수정 없이 리뷰 결과만 문서화 |
| 2026-03-01 | 하이로드 수학 브랜드 리디자인 1차 반영 | 변경 파일 정적 검토 + 변수/문구 반영 확인 | PASS | 브라우저 수동 QA는 후속 수행 필요 |
| 2026-03-01 | 하이로드 수학 브랜드 후속 2차 정합성 | 잔여 인라인 색상/문구 검색(`rg`) + 린트 확인 | PASS | 실브라우저 시나리오 QA는 여전히 필요 |
| 2026-03-01 | 리디자인 수동 QA(공개 4개 페이지) | Playwright 기반 데스크톱/모바일(390px) 캡처 + 콘솔/대비 점검 | FAIL | `grading` CORS 오류, 골드 버튼 대비 저하 이슈 확인 |
| 2026-03-01 | 패치 후 빠른 재검증(`/grading`, `/homework`) | Playwright 기반 데스크톱/모바일(390px) 캡처 + 콘솔/CORS/레이아웃 자동 점검 | PASS | CORS 미재현, 골드 버튼 어두운 글자 확인, 390px 가로 깨짐 미발견 |
| 2026-03-01 | 최종 패치 재검증(`/grading`, `/parent-portal`, `/homework`) | 최신 QA 리포트(`quick-recheck-report.json`, `report.json`) 기반 항목별 대조 | FAIL | `mathlive` 요청 실패 잔존, `parent/homework` 헤더 골드 포인트 체감 약함(정성) |
| 2026-03-01 | 안정화 후속 패치(`mathlive` 지연 로딩 + 헤더 골드 디바이더) | 코드 반영 후 린트 확인 + 기존 QA 리포트 비교 검토 | PASS | 첫 진입 안정성 개선 반영, 수식 편집 진입 시나리오 영향도는 후속 확인 |
| 2026-03-01 | `grading` 수식 편집 영향도 실검증(`mathlive` `HEAD net::ERR_ABORTED`) | Chrome CDP 실브라우저 자동화: 모달 오픈/입력/저장/닫기 + CDN 차단 fallback 확인 | PASS | 일반 경로 진입은 데이터 부재로 미실행, 강제 `kdQuestions` 주입 경로에서 기능 영향 없음 |
| 2026-03-01 | 결과 API 입력 검증 강화(`results.py:update_item`) | 허용 필드/타입/범위 정적 검토 + 린트 확인 | PASS | 무제한 payload 업데이트 차단, 빈/무효 payload는 400 처리 |
| 2026-03-01 | `/grading/` 첫 진입 스모크(렌더/탭/콘솔) 재확인 | 로컬 서버 실접속(HTTP 200) + 최신 `quick-recheck-report.json` 대조 | PASS | 콘솔 에러/페이지 에러 0, 메인 탭 기본 전환 항목 PASS 기록 유지. `mathlive` `HEAD net::ERR_ABORTED`는 요청 실패 신호로만 잔존 |
| 2026-03-01 | 결과 화면 폴링 안정성 보강(`grading/index.html`) | timeout 기반 fetch 공통 함수 + 연속 실패 경고 로직 정적 검토 + 린트 확인 | PASS | 진행률/상세 폴링 침묵 실패 완화, 장시간 실채점 시나리오 체감 검증은 후속 |
| 2026-03-01 | 결과 API 입력 검증 2차(`regrade`, `feedback`) | `compileall` + 정적 검토(양의 정수/허용 타입/텍스트 정제/400 처리) | PASS | 무효 `answer_key_id`/feedback 식별자 차단, 수동 오류유형 화이트리스트 적용 |
| 2026-03-01 | 장시간 채점/대용량 E2E(경고 노이즈/복구 체감) 착수 | 브라우저 자동화 실행 시도(세션 내 도구/런타임 확인) | BLOCKED | 브라우저 자동화 도구 미가용 및 로컬 러너 비정상 종료로 실브라우저 계측 미완료 |
| 2026-03-01 | 장시간 채점/대용량 E2E(경고/복구 실측) 완료 | 격리 Playwright 러너(`tmp-e2e-runner`)로 시나리오 실행, 토스트/카운터 계측 | PASS | 진행률 경고 3회 실패 시 1회 노출, 복구 후 노이즈 0회. 상세 경고는 progress+results 동시 실패 구간에서만 발생 확인 |
| 2026-03-01 | 상세 폴링 경고 트리거 보강(`grading/index.html`) | 코드 수정 + 격리 러너 재실행(`node polling-e2e-runner.js`) | PASS | `results` 단독 실패 반복 시 상세 경고 1회 노출 확인, 복구 후 추가 경고 스팸 없음 |
| 2026-03-01 | 상세 완료 토스트 중복 방지(`grading/index.html`) | 완료 토스트 가드 추가 + 격리 러너 재실행(동일 `result_id` 완료 5회 연속 주입) | PASS | 동일 결과에 대해 성공 토스트 1회만 노출(`duplicateCompletionToastsForSameResult = 1`) |
| 2026-03-01 | 전체 재채점 시작→진행률/완료 반영 정합성 E2E(`regradeWithKey`, `pollGradingProgress`) | 격리 러너 재실행(전체 재채점 분기 모킹 + 진행률 active→empty 전이 확인) | PASS | full regrade 시작 토스트 1회, 진행률 폴링 시작 1회, 상세 재오픈 1회, 완료 시 결과 재로딩 1회 확인 |
| 2026-03-01 | 작업 일시중단 인계 문서화(`plan/context/checklist`) | 다음 1순위/재개 절차/검증 체크포인트를 3개 문서에 반영 | PASS | 휴식 후 바로 이어서 작업 가능하도록 시작점 고정 완료 |
| 2026-03-01 | full regrade 오류 분기 보강(`results.py`) | 코드 수정 + `python -m compileall grading-server/routers/results.py` + 린트 확인 | PASS | Drive 실패(502), ZIP 형식/손상/빈 파일 및 이미지 0건(400) 분기 추가. 실브라우저/실데이터 시나리오 검증은 후속 |
| 2026-03-01 | full regrade 오류 시나리오 모킹 검증(3종) | Python 하네스 실행(`_full_regrade_from_submission` 모킹 호출)으로 실패 케이스 응답 확인 | PASS | Drive 다운로드 실패=502, ZIP 형식 오류=400, 이미지 0건=400. 프론트 토스트는 서버 `detail` 사용 구조로 메시지 전달 가능 |
| 2026-03-01 | full regrade 실데이터 검증(`result_id=34`) | 운영 API 실호출(`POST /api/results/34/regrade`) + `/api/grading-progress`, `/api/results` 후속 조회 | FAIL | 시작 응답은 200(`full_regrade=true`)이나, 최종 진행률 `failed`/결과 `review_needed`, `error_message=채점 시간 5분 초과` 확인 |
| 2026-03-01 | 문서 3종 정합성 업데이트(`plan/context/checklist`) | 현재 상태/남은범위/차단요인 문구 정리 및 상호 참조 확인 | PASS | 실데이터 검증 상태를 "부분 완료"로 명확화, 다음 액션을 오류 유형별 실데이터 재현으로 고정 |
| 2026-03-01 | 작업 트랙 분리 명시(디자인 vs 안정화) | 사용자 질문 기준으로 현재 작업 성격을 문서에 명시 확인 | PASS | 현재 작업은 간판 리디자인 후속이 아닌 재채점 API 안정화/검증 트랙으로 정리 |
| 2026-03-01 | 채점 타임아웃 동적화(`grading.py`, `config.py`) | 코드 수정 + `python -m compileall grading-server/config.py grading-server/routers/grading.py` + 린트 확인 | PASS | 고정 300초를 이미지 수 기반 timeout(`base + per_image * n`, max 제한)으로 교체, timeout 실패 메시지에 기준 시간/이미지 수 반영 |
| 2026-03-01 | 작업 완료 시 문서 3종 즉시 업데이트 규칙 고정 | 문서 체크 항목/운영 원칙/결정 로그 동시 반영 확인 | PASS | 앞으로 각 작업 종료 시 `plan/context/checklist`를 동일 사이클에서 함께 갱신 |
| 2026-03-01 | 동적 timeout 적용 후 실데이터 재측정(`result_id=34`) | 운영 API 재호출(`POST /api/results/34/regrade`) 후 `results/progress/items` 조회 재시도 | BLOCKED | `results`/`grading-progress`/`items` 모두 ReadTimeout(8~20s) 발생으로 상태 판정 보류. 서버 응답 안정화 후 재측정 필요 |
| 2026-03-01 | 운영 API 응답성 재측정(5/10/20초 probe) | `results`/`grading-progress`/`items` endpoint 단계별 timeout 호출 | PASS | 3개 endpoint 모두 200 응답 확인(약 0.7~1.6s). 단, `result_id=34`는 여전히 `review_needed` + `채점 시간 5분 초과` 상태 |
| 2026-03-01 | 운영 반영 판별용 런타임 헬스 엔드포인트 추가(`main.py`) | 코드 수정 + `python -m compileall grading-server/main.py` + 린트 확인 | PASS | `/health/runtime`에서 timeout/feature 설정값을 조회 가능하도록 추가(배포 후 반영 여부 판별용) |
| 2026-03-01 | 운영 `/health/runtime` 반영 확인 | 운영 URL 직접 조회(`curl`) | BLOCKED | `/health/runtime`가 404로 반환됨. 최신 코드(동적 timeout 포함)가 운영에 아직 반영되지 않았을 가능성 높음 |
| 2026-03-01 | 오류 유형 재현용 픽스처 생성 | `python qa-artifacts/generate_regrade_fixtures.py` 실행 + 생성물 확인 + 스크립트 컴파일 확인 | PASS | `qa-artifacts/regrade-fixtures`에 `no_images.zip`, `empty.zip`, `not_a_zip.bin`, `README.md` 생성 완료 |
| 2026-03-01 | 런타임/재채점 통합 점검 스크립트 추가 및 실행 | `python qa-artifacts/run_runtime_regrade_check.py ...` 실행 후 JSON 리포트 확인 | PASS | 리포트에서 `/health/runtime`=404, `result_id=34`의 `review_needed` + `채점 시간 5분 초과` 상태를 동일 포맷으로 기록 |
| 2026-03-01 | 배포/반영 검증 절차 문서화 | `qa-artifacts/deploy-and-verify-runtime.md` 작성 후 단계/판정 기준 점검 | PASS | 배포 후 `/health/runtime` 확인 및 통합점검 재실행 절차를 표준화해 후속 작업자가 바로 실행 가능 |
| 2026-03-01 | 배포 검증 원클릭 스크립트 추가 및 실행 | `powershell -File qa-artifacts/verify_runtime_after_deploy.ps1` 실행 | PASS | health=200, health_runtime=404, 통합 리포트 갱신 및 `result_id=34`가 여전히 `review_needed`임을 동일 명령으로 재확인 |
| 2026-03-01 | 원클릭 검증 재실행(운영 반영 재확인) | `powershell -ExecutionPolicy Bypass -File qa-artifacts/verify_runtime_after_deploy.ps1` 재실행 | BLOCKED | 이전과 동일하게 health_runtime=404 지속. `result_id=34` 상태/에러도 변화 없음(`review_needed`, `채점 시간 5분 초과`) |
| 2026-03-01 | 5분 배포 확인 체크리스트 제공 | `qa-artifacts/deployment-checklist-quick.md` 작성 후 절차/판정 항목 검토 | PASS | 배포 전→배포 확인→운영 판정→실패 조치 흐름을 최소 단계로 고정해 즉시 실행 가능 |
| 2026-03-01 | 배포 사전 준비상태 점검 | `git status -sb`, `git remote -v`, 최신 커밋 확인 후 `predeploy-readiness.md` 작성 | PASS | 로컬 변경 미커밋/미푸시 상태를 확인. GitHub 기반 배포 전 커밋/푸시가 선행돼야 함을 명시 |
| 2026-03-01 | 운영 `/health/runtime` 재확인(배포 반영 판정) | 통합 리포트 단건 조회 + 수동 요약 출력(`health_runtime`, timeout 값) 확인 | PASS | `health_runtime=200`, `grading_timeout_base/per_image/max` 노출 확인으로 운영 반영 판정 완료 |
| 2026-03-01 | `trigger_regrade` 포함 통합 재검증(`result_id=34`) | `python qa-artifacts/run_runtime_regrade_check.py --trigger-regrade ...` 실행 후 `polls` 분석 | BLOCKED | 시작 응답 200(`full_regrade=true`)은 확인. 하지만 후속 poll 4회가 모두 ReadTimeout(10s)으로 최종 상태 수렴 판정 보류 |
| 2026-03-01 | timeout 상향 재검증(`result_id=34`, timeout=30/poll=6) | `python qa-artifacts/run_runtime_regrade_check.py --trigger-regrade --timeout 30 --poll-count 6 --poll-interval 8 ...` 실행 후 리포트 분석 | BLOCKED | 시작 응답 200 및 중간 `grading(cross_validate 40%)` 관측. 그러나 동일 실행에서 `health/runtime/results/progress/items` 다수가 ReadTimeout(30s)으로 실패해 최종 상태 확정 불가 |
| 2026-03-01 | timeout 원인 분석용 로깅/보호 로직 보강 | 코드 수정(`grading.py`, `engines.py`, `config.py`, `main.py`) + `python -m compileall` + 린트 확인 | PASS | 단계별 소요시간 로깅, timeout 시 마지막 단계 표시, 타이브레이크 항목/재시도 상한, 거부응답 즉시 fallback, `/health/runtime` 설정 노출 반영 |
| 2026-03-01 | 배포 후 런타임 설정 반영 검증 | `curl /health/runtime` 응답 확인 | PASS | `health_runtime=200`, `ocr_tiebreak(max_items=6,max_retries=1,fallback_on_refusal=true)` 노출 확인 |
| 2026-03-01 | 배포 후 통합 재검증(`result_id=34`) | `run_runtime_regrade_check.py` 재실행 + 요약 스크립트 확인 | BLOCKED | `regrade_trigger=200(grading)` 확인. 다만 `poll_ok_pairs`에서 `results`는 6회 모두 실패, `progress`는 1회만 성공해 최종 수렴 판정 불가 |
| 2026-03-01 | 긴급 우회 적용(`USE_GRADING_AGENT=false`) 및 재검증 | Railway 변수 변경 + Redeploy + `/health/runtime` 확인 + 통합 재검증 실행 | PASS | `features.use_grading_agent=false` 반영 확인. `result_id=34`가 `review_needed`(score 100/500, uncertain 3)로 수렴, timeout 실패 메시지 재발 없음 |
| 2026-03-01 | `agent_verify` 근본 수정(하드 timeout/문제수 상한/잔여시간 fallback) | 코드 수정(`config.py`, `grading.py`, `agent.py`, `main.py`, `.env.example`) + `python -m compileall` + 린트 확인 | PASS | 에이전트 단계에 hard timeout/질문 상한/잔여시간 부족 시 생략 로직 추가. 운영 재검증(`USE_GRADING_AGENT=true`)은 후속 |
| 2026-03-01 | 세션 재개 대비 문서 3종 인계 업데이트 | `plan/context/checklist` 동시 갱신 + 재개용 실행 순서 고정 확인 | PASS | 다음 세션 시작 시 `git status` → `/health/runtime` → `run_runtime_regrade_check.py` 순서로 즉시 재개 가능 |
| 2026-03-01 | `USE_GRADING_AGENT=true` 복귀 후 통합 재검증(`result_id=34`) | `/health/runtime` 확인 + `run_runtime_regrade_check.py --trigger-regrade` 실행 | BLOCKED | 런타임 반영은 정상(`use_grading_agent=true`, `agent_verify` 설정 노출). 하지만 `regrade_trigger`가 500으로 실패(`PGRST204`: `grading_items.error_type` 컬럼 미존재)하여 timeout 재검증 단계로 진행 불가 |
| 2026-03-01 | DB 스키마 복구 후 통합 재검증 재실행(`result_id=34`) | Supabase SQL(`error_type` 컬럼 보정 + `NOTIFY pgrst`) 후 `run_runtime_regrade_check.py` 재실행 | PASS | `regrade_trigger=200`, `status=confirmed`, `error_message=null`로 500 차단요인 해소. 단, 장시간 `agent_verify` 경로 timeout 검증은 별도 케이스 필요 |
| 2026-03-01 | 장시간 관측 재검증(`result_id=34`, poll 20회) | `run_runtime_regrade_check.py --trigger-regrade --poll-count 20 --poll-interval 10` + 리포트 요약 | PASS | `trigger=200`, `results_ok=20/20`, `progress_ok=20/20`, 에러 0건. 상태는 `confirmed` 유지로 API 안정성은 확인, `agent_verify` 장시간 경로는 미진입 |
| 2026-03-01 | 신규 제출 장시간 관측(`result_id=35`, poll 30회) | `run_runtime_regrade_check.py --result-id 35 --poll-count 30 --poll-interval 10` + 리포트 요약 | PASS | `results_ok=30/30`, `progress_ok=30/30`, `error_count=0`, 상태 `review_needed`로 안정 수렴. 다만 `agent_verify` 단계 진입 여부는 Railway StageTiming 로그로 추가 확인 필요 |
| 2026-03-01 | 재채점 안정화 트랙 마감 판정 | 장시간 관측 결과 + 문서 3종 리스크/후속 기록 점검 | PASS | StageTiming 직접 캡처는 로그 노이즈로 보류했으나 운영 안정성 지표(30/30, 에러 0) 충족으로 마감. 다음 트랙은 학생/수납 대규모 업데이트 |
| 2026-03-01 | 차기 트랙 킥오프 검토(학생/수납, 세무/교육/UX 관점) | 전문가 관점 롤플레잉 검토 + 1주차 MVP 범위/완료기준 정의 | PASS | 수납 ledger 필수 필드, 상태모델, 월 리포트/CSV를 1차 범위로 확정. 자동 세무연동은 2차로 이연 |
| 2026-03-01 | 결제 채널 의사결정 비교표 정리(결제선생 vs Bizzle) | 세무/운영/UX 관점의 평가축과 파일럿 판정기준 정의 | PASS | 단일 채널 우선 원칙 + 월마감 대사 KPI(시간/오류율) 기준으로 선택하도록 정리 |
| 2026-03-01 | API 미도입 3채널 수납 운영안 확정(결제선생/비즐/통장) | 채널별 역할 분리 + 공통 ledger + 일/월 마감 루틴 설계 | PASS | 비대면(결제선생), 대면/동백전(비즐), 계좌이체(통장)로 시작. 월마감 대사시간 KPI 충족 전까지 API 연동은 보류 |
| 2026-03-01 | 수납 화면 정보구조 우선순위 확정(원장폼/상태배지 -> 사진+AI 보조입력) | 입력 누락 방지 관점의 단계 설계 검토 | PASS | 1단계는 수기 확정 중심, 2단계는 AI 추출값 제안 + 사용자 최종확정으로 운영 리스크 통제 |
| 2026-03-01 | 1순위 구현(학생/원장 입력폼 + 상태배지) 반영 | 정적 코드 검토 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 원장 입력 모달/학생별 원장 수정 동선 추가, 상태배지 4종(청구됨/부분수납/완납/미확인입금) 적용, 린트 에러 없음 |
| 2026-03-01 | 2순위 구현(증빙 업로드 + AI 추출 + 검토 팝업) 반영 | 코드 수정 + `node --check js/payment.js` + `python -m compileall grading-server/routers/misc.py` + `ReadLints` | PASS | `증빙+AI` 모달/검토 팝업 및 `POST /api/payments/extract` 구현. AI는 초안 제안만 하고 사용자 확정 저장 구조로 적용 |
| 2026-03-01 | 3순위 구현(일마감/월마감 요약 + CSV 4종) 반영 | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 일마감 요약(오늘 수납/월 미수금/미확인입금), 채널별 합계, 월 원장/미수금/수단별/환불 CSV 다운로드 추가. 환불금액/사유 필드 반영 |
| 2026-03-01 | 미확인입금 저장 규칙 정합화(학생 미선택 허용) | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 미확인입금 체크 시 학생 미선택 저장 가능. 별도 큐(localStorage) 저장 후 요약/CSV 집계에 포함되도록 반영 |
| 2026-03-01 | 수납 카드 펼침 잘림 이슈 즉시 패치 | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 카드 펼침 시 자동 스크롤, pay-list overflow/scroll-padding 보정, 모바일 payment 모달 높이(`100dvh` 기반) 보정 적용 |
| 2026-03-01 | 노트북 화면 가시성 보강(요약 패널 컴팩트 모드) | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | `일마감/월마감 요약` 섹션 접기/펼치기 버튼 추가, 좁은 화면에서 기본 접힘 적용으로 카드 리스트 가시영역 확보 |
| 2026-03-01 | 데스크톱/노트북 수납 모달 폭 확대 | CSS 수정 + `ReadLints` 점검 | PASS | 수납 모달 폭을 900~960px로 확장해 카드/요약/조작 버튼이 한 화면에서 더 안정적으로 보이도록 개선 |
| 2026-03-01 | 미확인입금 큐 매칭 UI 추가 | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 월 기준 미확인입금 목록 표시, 학생 선택 후 원장 연결(큐 제거), 큐 삭제 기능 추가 |
| 2026-03-01 | 카드 상세영역 스크롤 보강(잘림/겹침 완화) | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 카드 상세 콘텐츠를 내부 스크롤 컨테이너로 전환하고 화면 크기별 max-height를 적용해 노트북/모바일에서 잘림을 완화 |
| 2026-03-01 | 카드 동시 펼침으로 인한 밀림/겹침 체감 보정(아코디언화) | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 한 번에 1개 카드만 펼치도록 변경, 펼침 카드 강조(z-index/shadow) 및 상세영역 높이 상향으로 밀림 체감 완화 |
| 2026-03-01 | 카드 상세 오버레이 전환(하단 카드 눌림/잘림 구조 개선) | 코드 수정 + `node --check js/payment.js` + `ReadLints` 점검 | PASS | 상세를 오버레이로 띄워 하단 카드 흐름을 유지하고, 자동 스크롤 계산을 상세 높이 기준으로 보정 |
| 2026-03-01 | AI 수납 다건 추출 모드(선택형) + 일괄 저장 모달 | `node --check js/payment.js`, `python -m compileall grading-server/routers/misc.py`, `ReadLints` | PASS | `extract_mode(single/multi)`와 `drafts[]` 응답 지원, 프론트 다건 검토/일괄 저장(학생 지정/미확인입금) 동작 추가 |
| 2026-03-01 | 문서 3종 재동기화(현재 우선 트랙 명시) | `plan/context/checklist` 상호 참조 점검 및 상태 정렬 | PASS | 재채점 안정화는 완료/모니터링으로 유지, 현재 우선순위를 학생/수납 대규모 업데이트로 명시 |
| 2026-03-01 | 수납/비용 탭 분리 1차 구현 | 코드 수정(`index.html`, `js/payment.js`, `style.css`, `mobile.css`) + `node --check js/payment.js` + `ReadLints` | PASS | 수납 탭과 비용 탭을 분리하고 비용 등록 모달/월별 목록/요약/비용 CSV를 추가. 기존 수납 기능 회귀 없이 유지 |
| 2026-03-01 | 비용 원장 Supabase 동기화 1차 구현(로컬 폴백 포함) | 코드 수정(`js/payment.js`) + `node --check js/payment.js` + `ReadLints` | PASS | `expense_ledgers` 테이블 사용 가능 시 동기화, 미구성/오류 시 로컬 저장으로 자동 폴백되도록 적용 |
| 2026-03-01 | 비용 원장 DB/RLS SQL 스크립트 추가 | `EXPENSE_LEDGER_SETUP.sql` 작성 + 기존 Supabase SQL 패턴 대조(`rg`) | PASS | 테이블/인덱스/RLS 정책/`notify pgrst`를 1파일로 고정. 실제 DB 적용은 Supabase SQL Editor 수동 실행 필요 |
| 2026-03-01 | 롤플레잉 전문가 의견 기록 규칙 상시화 | 규칙 파일 추가(`.cursor/rules/*.mdc`) + 문서 3종 동기화 | PASS | 롤플레잉 요청 시 관련 전문가 의견과 문서 기록을 기본화하고, 불필요 요청은 전문가 섹션 생략 규칙을 명시 |
| 2026-03-01 | 롤플레잉 전문가 자동선택 규칙 보강 | 규칙 파일 수정 + 문서 3종 동기화 | PASS | 사용자가 전문가 구성을 별도로 지정하지 않아도 요청 맥락에 맞는 전문가를 자동 선택해 의견을 포함하도록 반영 |
| 2026-03-01 | 비용 탭에서 학생 목록 노출되는 탭 숨김 버그 수정 | `style.css` 공통 `.hidden` 유틸 추가 + `ReadLints(style.css)` 확인 | PASS | 비용 탭 전환 시 수납 영역(학생 카드/필터/요약)이 숨김 처리되어 비용 목록만 노출되도록 보정 |
| 2026-03-01 | 일마감 대사 차이 계산 UI 구현(외부 실합계 입력 대비 차이) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 결제선생/비즐/통장/기타별 외부 실합계 입력, 내부 원장 대비 차이(채널별/합계) 표시, 월 기준 localStorage 저장 반영 |
| 2026-03-01 | 인건비/강사비 조건부 입력 필드 추가(비용 모달) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 인건비/강사비 선택 시 지급대상/지급월/원천세/공제 입력 노출, 저장 시 메모에 구조화 상세 라인 추가 |
| 2026-03-01 | 수납/비용 세무 공통 필드 및 CSV 확장 | `index.html/js/payment.js` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 수납/비용에 공급가액·세액·증빙유형·증빙번호를 입력/저장/목록/CSV(월 원장·미수금·환불·비용)에 반영 |
| 2026-03-01 | 비용 원장 세무 필드 Supabase 구조화 저장 전환(+legacy fallback) | `js/payment.js`, `EXPENSE_LEDGER_SETUP.sql` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 원격은 컬럼 우선(`supply_amount/vat_amount/evidence_type/evidence_number`) 저장/조회, 미마이그레이션 환경은 `note` 메타 fallback 유지 |
| 2026-03-01 | 월 원장/수단별 CSV 옵션 확장(대사차이 + 인건비상세 메타) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | CSV 옵션 체크 시 부가섹션 컬럼(`추가섹션/추가항목/추가값1~3`)으로 대사차이 및 인건비상세를 함께 내보내도록 반영 |
| 2026-03-01 | 수납/비용 모달 입력가이드 강화(입력/자동/AI 구분 + 자동계산 + 누락 하이라이트) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 자동계산 필드를 읽기전용으로 분리하고, 저장 시 필수 누락 필드를 빨간 테두리/포커스로 안내해 입력 실수를 줄이도록 반영 |
| 2026-03-01 | 쉬운 용어 병기 + 마우스오버 툴팁 추가(세무 용어) | `index.html/style.css/mobile.css` 수정 + `ReadLints` | PASS | 귀속월/공급가액/세액/부가세구분/증빙유형/증빙번호를 쉬운 라벨로 병기하고 `?` 툴팁 설명을 추가해 비회계 사용자 이해도를 개선 |
| 2026-03-01 | 클릭형 도움말 팝업 추가(모바일/키보드 접근) | `js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | `?` 클릭 시 설명 팝업 노출, 바깥 클릭/ESC 닫기, Enter/Space 토글을 지원해 터치 환경에서도 용어 설명 접근성을 확보 |
| 2026-03-01 | 자주 쓰는 UI 용어 통일(결제채널/거래참조ID/미확인입금 큐) | `index.html/js/payment.js` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 화면/카드/CSV 헤더 용어를 `결제경로`, `거래확인번호`, `입금 확인대기함`으로 일괄 정리해 사용자 친화성을 높임 |
| 2026-03-01 | `대사 차이 합계` 용어 단순화 + 설명 추가 | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 문구를 `장부와 실제 합계 차이`로 바꾸고 보조 설명/도움말을 넣어 개념 이해 부담을 낮춤 |
| 2026-03-01 | 전문가 의견 반영 문서 확정(주민번호 미저장/세무검증 우선/면세 고정 지양) | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 동기화 + 상호 참조 점검 | PASS | 회계·보안·운영 관점 합의사항을 구현 전 기준으로 고정해 다음 단계(월 신고팩/저장검증 강화)의 방향 일탈을 방지 |
| 2026-03-01 | 신고 일정 안내 + 신고 완료 확인창(기간/대상 기반) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 사업장현황/종합소득/원천세(인건비 지급 시) 기준 안내를 추가하고, 해당 기간에 미완료 항목만 자동 확인창으로 완료 체크 가능하도록 반영 |
| 2026-03-01 | 수납 모달 스크롤/가시성 이슈 수정(요약 자동 접힘 + 학생 목록 미노출) | `js/payment.js/style.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 요약 자동 접힘 기준을 완화하고 접힘 상태를 사용자별로 저장, 수납/비용 섹션을 flex 영역으로 고정해 학생 카드 리스트 스크롤이 정상 동작하도록 보정 |
| 2026-03-01 | 월별 세무 체크카드 추가(비용 정리/인건비 지급/전월 원천세 확인) | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | monthKey 기준 체크 상태를 저장하고, 전월 인건비 지급이 없으면 원천세 확인 항목을 자동 비활성 처리하도록 반영 |
| 2026-03-01 | 인건비 소득유형 분기 + 비율제 3.3% 자동계산 + 실지급액 자동계산 | `index.html/js/payment.js/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 인건비/강사비 입력 시 소득유형을 필수로 받고, 비율제는 원천세/지방소득세 자동계산, 월급제는 직접입력 + 공제합계 검증, 저장 메타에 소득유형/실지급액 반영 |
| 2026-03-01 | 수납 탭 데스크톱 2열 레이아웃(우측 학생목록 고정) 적용 | `index.html/style.css/mobile.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 좌측에 요약/세무/작업도구, 우측에 학생목록 독립 스크롤을 배치해 학생카드가 하단으로 밀리는 가시성 문제를 완화 |
| 2026-03-01 | 요약 펼침 시 좌측 패널 하단 잘림 보정(독립 스크롤) | `style.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 데스크톱 2열에서 좌측 요약/세무 영역에 세로 스크롤을 부여해 확장 콘텐츠가 잘리지 않고 끝까지 탐색 가능하도록 조정 |
| 2026-03-01 | 월별 노무/회계 체크리스트 추가 | `index.html/js/payment.js/style.css` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 월별 세무 체크 저장맵을 재사용해 노무/회계 체크항목을 추가하고, 요약이 접힘 상태여도 체크리스트를 확인/저장할 수 있도록 반영 |
| 2026-03-01 | 체크리스트 조건부 활성화(현재 필요한 항목만 체크 가능) | `js/payment.js` 수정 + `node --check js/payment.js` + `ReadLints` | PASS | 현재 월/인건비 지급 여부/원천세 점검 기간 조건으로 항목을 자동 활성화하고, 비활성 항목에는 “왜 비활성인지” 안내 문구를 표시 |
| 2026-03-01 | AI 증빙 추출 이미지 Drive 자동 저장 + 경로 메모 연결 | `grading-server/routers/misc.py`, `js/payment.js` 수정 + `python -m compileall grading-server/routers/misc.py` + `node --check js/payment.js` + `ReadLints` | PASS | `/api/payments/extract`에서 `수납증빙/학원명또는owner/YYYY/MM/DD/항목` 폴더 업로드를 수행하고, 응답 Drive 경로를 원장 메모(`[드라이브증빙]`)에 자동 기록해 누락 추적성을 강화 |
| 2026-03-01 | 학생관리 전환 대비 문서 인계 정리(수납/비용 최신 상태) | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 동기화 + 내용 대조 | PASS | 수납/비용 완료 스냅샷과 학생관리 시작 우선순위를 문서에 명시해 다음 세션에서 바로 학생관리 구현을 이어갈 수 있도록 정리 |
| 2026-03-01 | 학생등록 폼 UX 1차 보강(필수검증/연락처형식/중복차단) | `index.html`, `script.js` 수정 + `node --check script.js` + `ReadLints` | PASS | 저장 기준을 이름/등록일/연락처 1개 이상으로 통일하고, 01x 연락처 형식검증 및 이름+학년+연락처 일치 중복 저장 차단을 반영 |
| 2026-03-01 | 학생관리 2차(일정삭제 영향 미리보기 + 테스트 점수/추이) | `index.html`, `script.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `ReadLints` | PASS | 일정 삭제 전 예상 건수 확인 UI를 추가하고, 학생 이력 모달에서 테스트 점수 입력/삭제와 월별 변화 추이(평균·변화·막대)를 확인 가능하도록 반영 |
| 2026-03-03 | 문서 날짜 갱신 + 다음 작업 우선순위 정리 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 동기화 | PASS | 문서 기준일을 2026-03-03으로 반영하고 학생관리 3차 작업 순서(점수 동기화→스키마 확장→통합 상세)를 고정 |
| 2026-03-04 | 학생관리 3차(테스트 점수 Supabase 동기화 + 폴백) | `database.js`, `script.js`, `STUDENT_TEST_SCORE_SETUP.sql` 수정 + `node --check script.js` + `ReadLints` | PASS | 원격 저장/조회/삭제 함수를 추가하고 UI 로직을 원격 우선+로컬 폴백으로 전환. 운영 적용을 위해 SQL Editor에서 setup 스크립트 실행이 추가 필요 |
| 2026-03-04 | 학생관리 4차(학생 스키마 확장: 재원상태/시작일/종료일/보호자) | `index.html`, `script.js`, `database.js`, `SUPABASE_COMPLETE_SETUP.sql`, `STUDENT_SCHEMA_UPDATE.sql` 수정 + `node --check script.js; node --check database.js` + `ReadLints` | PASS | 등록폼 필드/검증을 확장하고 DB 저장 필드를 연결. DB 컬럼 미반영 환경은 메모 메타 폴백으로 저장 지속, 운영 적용을 위해 SQL Editor에서 스키마 업데이트 실행 필요 |
| 2026-03-04 | 학생관리 5차(학생 상세 통합 뷰: 출석/숙제/수납/테스트) | `index.html`, `script.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `ReadLints` | PASS | 이력 모달에 통합 요약 카드를 추가하고 숙제/수납/테스트 월 집계를 연결. 기록이 없는 달에도 요약/평가/점수 섹션이 유지되도록 흐름 보강 |
| 2026-03-04 | 학생관리 6차(일정 삭제 UX 보강: 범위 경고/월 범위 안내) | `index.html`, `script.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `ReadLints` | PASS | 일괄/기간 삭제 모달에 실시간 영향 경고를 추가하고, 삭제 확인창에 기간·건수·월 범위·복구불가 안내를 포함해 오삭제 위험을 낮춤 |
| 2026-03-04 | 학생관리 우선순위 재정렬(전체 시스템 관점) 문서 반영 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 수정 + 내용 정합성 점검 | PASS | 우선순위를 "현장 실패 방지→데이터 신뢰성→운영 효율→고도화"로 재정의하고, QR 긴급출석/확정 워크플로우를 최우선 항목으로 고정 |
| 2026-03-04 | 학생관리 7차(출석 주체 구분: 학생 QR vs 선생님 체크) | `index.html`, `style.css`, `script.js`, `qr-attendance.js` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | 수업관리 모달에 출석 방식 배지를 추가하고, 수동 출석 시 `check_in_time` 자동 기록으로 구분 정확도를 보강. 이력 배지 문구를 `학생 QR`/`선생님 체크`로 통일 |
| 2026-03-04 | 학생관리 8차(QR 긴급출석 1차 + 중복스캔 보호) | `qr-attendance.js` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 일정 미등록 시 임시출석으로 흐름을 유지하고, 동일 날짜 기존 처리기록이 있으면 임시출석 대신 `already_processed`로 판정해 중복 생성 위험을 차단 |
| 2026-03-04 | 학생관리 9차(임시출석 확정 대기함/건별 확정/사유 기록 1차) | `index.html`, `style.css`, `mobile.css`, `script.js`, `qr-attendance.js` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | QR 모달에 임시출석 확정 대기함을 추가하고, 건별 사유 입력 후 확정 시 `qr_judgment`/`memo`를 갱신하여 이력 추적성을 확보. 확정 후 목록 즉시 갱신으로 중복 확정 방지 |
| 2026-03-04 | 학생관리 10차(임시출석 확정 2차: 확정자 기록/기간 필터/일괄확정) | `qr-attendance.js`, `style.css`, `mobile.css` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 확정 시 교사명을 감사로그에 남기고, 대기함에 기간 필터 및 다중 선택 일괄확정을 추가해 대량 처리 효율을 개선. 확정 후 목록/요약 동기화와 선택 초기화로 중복 처리 위험을 낮춤 |
| 2026-03-04 | 학생관리 11차(일정 누락 사전 예방 1차: 당일 경고/QR 진입 전 확인/일정등록 빠른제안) | `script.js`, `qr-attendance.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | QR 모달에 일정 누락 경고와 빠른 등록 CTA를 추가하고, QR 스캔 진입 직전에 일정 미등록 경고 확인창을 표시. 확인 시 일정 모달을 오늘 날짜/미등록 학생 기준으로 즉시 열어 누락 복구 동선을 단축 |
| 2026-03-04 | 학생관리 12차(학생 상세 통합 화면 액션화 1차) | `script.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `ReadLints` | PASS | 통합 요약 카드에 출석/평가/수납/테스트 즉시 조치 버튼을 추가해 조회 중심 흐름을 조치 중심으로 확장. 학생·월 컨텍스트를 유지한 채 관련 모달/섹션으로 바로 이동되도록 연결 |
| 2026-03-04 | 학생관리 13차(테스트 점수 원격 동기화 운영 검증 1차) | `index.html`, `script.js`, `style.css`, `mobile.css` 수정 + `node --check script.js` + `node --check database.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | 테스트 점수 섹션에 동기화 상태 배지와 자동 점검 버튼을 추가하고, 저장/조회/삭제 경로에서 원격 성공·실패를 즉시 표시. 점검은 임시 레코드 원격 저장→조회→삭제 스모크로 구성해 운영 검증 진입 장벽을 낮춤 |
| 2026-03-04 | 학생관리 14차(출석 긴급 운영: 전화번호 뒷자리 인증 추가) | `index.html`, `qr-attendance.js`, `style.css`, `mobile.css` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 태블릿 가로모드 QR 화면 우측에 뒷자리 4자리 인증 패널을 추가하고, 단일/다중 매칭 처리 후 기존 출석 엔진으로 연결. 기존 `already_processed` 보호를 유지해 중복 임시출석 생성 리스크를 차단 |
| 2026-03-04 | 학생관리 15차(일정생성 모달 선택 학생 `x` 중복 표시 수정) | `style.css` 수정 + `ReadLints(style.css)` | PASS | `.schedule-selected-chip` 텍스트의 `×`와 `::after`의 `×`가 중복 노출되던 문제를 `::after` 제거로 해결. 일정생성/기간삭제 모달 칩 UI 일관성 확인 |
| 2026-03-04 | 학생관리 16차(운영 SQL 실행 점검 패키지 추가) | `STUDENT_TEST_SCORE_VERIFY.sql`, `STUDENT_SCHEMA_VERIFY.sql`, `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 수정 + `ReadLints(docs)` | PASS | 운영 SQL 수동 실행 전/후 검증을 위한 표준 쿼리 파일 2종을 추가해 판정 기준을 고정. 실제 SQL 실행은 Supabase 콘솔 권한이 필요한 수동 단계로 다음 액션에 유지 |
| 2026-03-04 | 학생관리 17차(오늘 운영 대시보드 1차 + 즉시조치 버튼) | `script.js`, `qr-attendance.js`, `style.css`, `mobile.css`, `docs/*` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | QR 출석 모달 상단에 운영 대시보드를 추가해 일정 누락/임시출석 미확정/다음 수업을 즉시 노출하고, 스캔·누락등록·임시확정으로 바로 이동하도록 연결. 대기함 렌더 후 요약 자동 갱신으로 카운트 최신성 유지 |
| 2026-03-04 | 학생관리 18차(출석체크 화면 탭 단순화 1차) | `index.html`, `qr-attendance.js`, `style.css`, `mobile.css`, `docs/*` 수정 + `node --check qr-attendance.js` + `node --check script.js` + `ReadLints` | PASS | QR 스캔 페이지를 `QR/전화번호/수동체크` 3탭으로 분리하고, 탭 전환 시 카메라 리소스를 자동 중지/재시작하도록 제어. 수동체크 탭에 운영 요약과 즉시조치 버튼을 배치해 모드 인지성과 동선을 단순화 |
| 2026-03-04 | 학생관리 19차(10인치 태블릿 전체화면 듀얼 표시 1차) | `index.html`, `qr-attendance.js`, `style.css`, `docs/*` 수정 + `node --check qr-attendance.js` + `node --check script.js` + `ReadLints` | PASS | 화면 폭 900~1400px에서 `QR 스캔` 모드 시 카메라와 전화번호 입력 패널을 동시 표시하도록 적용. resize 시 자동 재판정으로 가로/세로 전환에도 레이아웃이 즉시 동기화되며 기존 출석 처리 로직은 유지 |
| 2026-03-04 | 학생관리 20차(학생용 출석화면 고정형 분리: 수동체크 제거 + 2패널 단순화) | `index.html`, `qr-attendance.js`, `style.css`, `docs/*` 수정 + `node --check qr-attendance.js` + `node --check script.js` + `ReadLints` | PASS | 학생 화면에서 수동체크 UI를 제거하고 QR+전화번호 2패널 고정 구조로 재정렬. 가로는 좌우, 세로는 상하 자동 배치로 10인치 태블릿 전체화면 사용성을 높였고 탭 전환 오조작 가능성을 제거 |
| 2026-03-04 | 학생관리 21차(10인치 터치 최적화 2차: 버튼/입력 확대) | `index.html`, `style.css`, `docs/*` 수정 + `ReadLints` | PASS | 상단 제어 버튼을 클래스 기반으로 정리해 터치 영역을 확대하고, 900~1400px 구간에서 입력/버튼/타이포를 확장해 오터치와 가독성 문제를 완화. 기존 출석 처리 로직 영향 없이 UI 레이어만 조정 |
| 2026-03-04 | 학생관리 22차(키보드 오버레이 대응 1차: 번호입력 가림 보정) | `qr-attendance.js`, `style.css`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 전화번호 입력 포커스 시 `visualViewport`로 키보드 높이를 감지해 하단 여백을 동적으로 보정하고, 키보드 오픈 중 듀얼 레이아웃을 단일열로 전환해 입력창/버튼 가림을 완화. 페이지 종료 시 이벤트 해제로 누수 방지 |

## 릴리즈 전 최종 확인
- [x] 치명 이슈 없음
- [x] 미해결 이슈는 `context.md`에 기록
- [x] 다음 액션이 `plan.md`에 반영됨
