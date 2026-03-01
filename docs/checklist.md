# 출석관리앱 체크리스트

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

## 릴리즈 전 최종 확인
- [ ] 치명 이슈 없음
- [x] 미해결 이슈는 `context.md`에 기록
- [x] 다음 액션이 `plan.md`에 반영됨
