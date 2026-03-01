# 출석관리앱 작업 계획서

## 프로젝트 목표
- 학생/수업 기준으로 출석 상태를 정확히 기록하고 조회한다.
- 교사 권한으로만 수정 가능하도록 접근 제어를 적용한다.
- 변경 이력을 남겨 추적 가능한 운영 상태를 유지한다.

## 작업 운영 원칙
- 작업 1개가 끝날 때마다 `docs/plan.md`, `docs/context.md`, `docs/checklist.md`를 즉시 동기화한다.
- 문서 업데이트가 끝나기 전에는 해당 작업을 완료로 간주하지 않는다.

## 현재 스프린트 목표
- [ ] 출석 입력/조회 기본 흐름 안정화
- [ ] 결과 화면(`grading/index.html`) 동작 및 UX 점검
- [x] 결과 API(`grading-server/routers/results.py`) 검증 강화

## 작업 트랙 분리 (중요)
- 브랜드/디자인 트랙: 간판 기준 리디자인 반영 작업(메인/결과/서브 화면)은 1차 완료 상태
- 현재 진행 트랙: 재채점 안정화/검증 트랙(결과 API, 오류 시나리오, 진행률/실패 처리)
- 즉, 지금 작업은 디자인 개편의 후속이 아니라 운영 안정화 목적의 백엔드/검증 작업

## 현재 우선 작업 (재개 후)
1. [x] `results.py` full regrade 오류 분기 보강(Drive 다운로드 실패 / ZIP 손상 / 이미지 0건)
2. [x] 오류 시나리오 모킹 검증(Drive 실패 502 / ZIP 형식 오류 400 / 이미지 0건 400)
3. [ ] 대용량 ZIP/Drive 실데이터 시나리오 검증(토스트/진행률 포함 E2E 정합성)
   - 진행상태: 일부 수행(`result_id=34` full regrade 재실행 시 채점 시간 초과 실패 관측)
   - 남은범위: 생성된 픽스처(`qa-artifacts/regrade-fixtures`)로 실데이터 제출을 만들고 케이스별 재현
   - 최신상태: Railway 로그에서 내부 timeout(`result #34, 400s`)이 직접 관측되었고, 코드에 단계별 타이밍 로그/타이브레이크 상한 보호를 반영함. 다음은 배포 후 동일 케이스 재측정
4. [x] 채점 타임아웃 동적화(이미지 수 기반, 상한 포함) 적용
5. [x] 운영 반영 판별용 런타임 헬스 엔드포인트 추가(`/health/runtime`)
6. [x] 채점 단계 추적/타이브레이크 안전장치 추가(시간초과 원인 분석용)

## 브랜드 리디자인 스프린트 (하이로드 수학)
- [x] 브랜드 토큰(네이비/골드, 깔끔한 톤) 정의 및 공통 스타일 반영
- [x] 메인/출석 화면(`index.html`, `style.css`, `mobile.css`) 1차 리디자인
- [x] 결과 화면(`grading/index.html`) 브랜드 정합성 반영
- [x] 서브 화면(`parent-portal`, `homework`, `css/sub-shared.css`) 톤 통일

## 오늘 할 일 (Top 3)
1. [x] 하이로드 수학 브랜드 토큰 정의 및 주요 문구 통일
2. [x] 메인/결과/서브 화면 브랜드 스타일 일괄 반영
3. [x] 리디자인 진행 상태를 `context.md`와 `checklist.md`에 반영

## 후속 작업 (2차 정합성)
1. [x] 인라인 하드코딩 브랜드 색상(`index.html`) 2차 정리
2. [x] 사용자 알림/메일 템플릿 브랜드 문구 통일(`parent-portal`, `send-reset-code`)
3. [x] 브라우저 실동작 수동 QA(데스크톱/모바일) 수행 및 캡처 기록

## 작업 상태
| 항목 | 상태 | 담당 | 비고 |
|---|---|---|---|
| 브랜드 토큰 정립 (`style.css`, `css/sub-shared.css`) | DONE | me/ai | 네이비/골드 기반 토큰 적용 |
| 메인/출석 UI 브랜딩 (`index.html`) | DONE | me/ai | 제품명 `하이로드 수학` 반영 |
| 결과 화면 브랜딩 (`grading/index.html`) | DONE | me/ai | 채점 화면 테마/타이틀 정합성 반영 |
| 서브 화면 브랜딩 (`parent-portal`, `homework`) | DONE | me/ai | 공통 톤 통일 |
| 인라인 색상/문구 2차 정합성 (`index.html`, 메일 템플릿) | DONE | me/ai | 구 보라/구브랜드 문구 추가 정리 |
| 시나리오 기반 수동 QA | DONE | me/ai | `/`, `/grading/`, `/parent-portal/`, `/homework/` 데스크톱/모바일 점검 및 캡처 완료 |
| 최종 패치 재검증 (`/grading`, `/parent-portal`, `/homework`) | DONE | me/ai | CORS 재발 없음, 390px 레이아웃 깨짐 없음, `mathlive` 요청 실패/헤더 골드 포인트 약함은 잔존 |
| 안정화 후속 패치 (`mathlive` 지연 로딩, 헤더 골드 디바이더) | DONE | me/ai | 첫 진입 안정성 강화 및 서브 화면 브랜드 포인트 보강 |
| `grading` 수식 편집 영향도 검증 (`mathlive` `net::ERR_ABORTED(HEAD)`) | DONE | me/ai | 강제 모달 오픈/입력/저장/닫기 PASS, CDN 차단 시 raw fallback 자동 전환 확인 |
| 결과 API 검증 강화 (`results.py` 입력 검증) | DONE | me/ai | `update_item` 허용 필드/타입 검증 + 음수/잘못된 타입 차단 |
| `/grading/` 첫 진입 스모크 재확인 (렌더/탭/콘솔) | DONE | me/ai | 로컬 실접속 200 + `quick-recheck` 대조로 PASS, 콘솔 에러 없음 |
| 결과 화면 폴링 안정성 보강 (`grading/index.html`) | DONE | me/ai | 폴링 fetch timeout/실패 카운트/지연 경고 토스트 추가 |
| 결과 API 입력 검증 2차 (`regrade`, `feedback`) | DONE | me/ai | 양의 정수/허용 타입/문자열 정제 검증 추가, 무효 입력 400 처리 |
| 장시간 채점/대용량 E2E (경고 노이즈/자동복구) | DONE | me/ai | 격리 러너(`tmp-e2e-runner`)로 실측 완료, 진행률 경고 1회/복구 후 노이즈 없음 확인 |
| 상세 폴링 경고 트리거 보강 (`grading/index.html`) | DONE | me/ai | `results` 단독 실패 누적도 경고 대상으로 반영 |
| 상세 완료 토스트 중복 방지 (`grading/index.html`) | DONE | me/ai | 동일 `result_id` 완료 이벤트 반복에서도 성공 토스트 1회만 허용 |
| 전체 재채점 시작→진행률/완료 반영 E2E 정합성 | DONE | me/ai | `regradeWithKey(full_regrade)` 분기, 진행률 폴링 시작, 완료 시 결과 재로딩까지 실측 PASS |
| full regrade 오류 분기 보강 (`results.py`) | DONE | me/ai | Drive 실패(502), ZIP 형식/손상/빈 파일(400), 이미지 0건(400) 구분 처리 |
| full regrade 오류 분기 모킹 검증 | DONE | me/ai | 함수 하네스로 3개 케이스 상태코드/메시지 확인(502/400/400) |
| full regrade 실데이터 검증 (`result_id=34`) | DONE | me/ai | API 시작 응답 200 확인, 이후 진행률 `failed`/결과 `review_needed` + timeout 에러메시지 관측 |
| 오류 유형별 실데이터 케이스 재현(다운로드/ZIP손상/이미지0건) | TODO | me/ai | 테스트용 제출 데이터셋 준비 필요(현재 운영 데이터 1건으로는 케이스 분리가 어려움) |
| 채점 타임아웃 동적화 (`grading.py`, `config.py`) | DONE | me/ai | 고정 300초 대신 `base + per_image * n`(max 제한) 적용, timeout 메시지에 기준 시간/이미지 수 반영 |
| 운영 API 응답성 재측정(5/10/20초) | DONE | me/ai | `results`/`grading-progress`/`items` 모두 200 응답 확인(일시적 ReadTimeout 해소) |
| 동적 timeout 적용 효과 실측(`result_id=34`) | IN_PROGRESS | me/ai | Railway 로그에서 `[TIMEOUT] result #34, 400s`가 직접 관측됨. 단계별 타이밍/타이브레이크 상한 패치 반영 후 재측정 대기 |
| 운영 반영 확인용 런타임 헬스 엔드포인트 (`main.py`) | DONE | me/ai | `/health/runtime`에 timeout/feature 플래그 노출(배포 후 동적 timeout 값 반영 여부 즉시 확인 가능) |
| 운영 반영 여부 확인(`/health/runtime`) | DONE | me/ai | 운영 서버 200 확인 + `grading_timeout_base/per_image/max` 값 노출 확인(배포 반영 완료) |
| 채점 단계 타이밍 로그/timeout 원인 표시 보강 | DONE | me/ai | `preprocess→ocr→cross_validate→agent_verify→grading→saving` 단계 전환/소요를 로그에 남기고 timeout 메시지에 마지막 단계 포함 |
| OCR 타이브레이크 안전장치 보강 | DONE | me/ai | 이미지당 타이브레이크 항목 상한 + 문제당 재시도 상한 + 거부응답 즉시 fallback 추가 |
| 오류 재현 픽스처 생성(`qa-artifacts/regrade-fixtures`) | DONE | me/ai | `no_images.zip`, `empty.zip`, `not_a_zip.bin` 생성 + 사용 가이드 문서화 완료 |
| 런타임/재채점 통합 점검 스크립트 추가 | DONE | me/ai | `qa-artifacts/run_runtime_regrade_check.py` 추가, 운영 리포트(`runtime-regrade-check-report.json`) 생성 |
| 배포/반영 검증 절차 문서화 | DONE | me/ai | `qa-artifacts/deploy-and-verify-runtime.md`에 배포→`/health/runtime`→통합점검 재실행 절차 고정 |
| 배포 후 검증 실행 스크립트 추가/실행 | DONE | me/ai | `qa-artifacts/verify_runtime_after_deploy.ps1`/통합 스크립트로 재검증 수행(`health_runtime=200`, `result34`는 기존 `review_needed`) |
| 5분 배포 체크리스트 제공 | DONE | me/ai | `qa-artifacts/deployment-checklist-quick.md` 작성(배포 전/배포 확인/운영 판정/실패 조치) |
| 배포 사전 준비상태 점검 | DONE | me/ai | `predeploy-readiness.md` 작성: 로컬 변경 미커밋/미푸시 상태 확인(배포 전 커밋·푸시 필요) |

상태 기준: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED`

## 작업 인계 메모 (다음 단계)
- 현재 상태: 코드 보강 + 모킹 검증 완료, 운영 배포 반영(`/health/runtime` 200)까지 확인
- 다음 작업(우선순위): 방금 반영한 단계추적/타이브레이크 보호 코드 배포 후 `result_id=34` 재실행으로 timeout 원인 단계와 최종 수렴 상태를 확정
- 다음 단계 권장 순서:
  1) 코드 배포 후 `/health/runtime`에서 신규 `ocr_tiebreak` 설정값 노출 확인
  2) `result_id=34` 재실행 + Railway 로그 대조로 마지막 단계/소요시간/timeout 지점 확정
  3) 오류 유형별 테스트 픽스처 확보 후 `/api/results/{id}/regrade` 실호출로 HTTP 코드/메시지 + 진행률/에러메시지 대조

## 완료 기준 (Definition of Done)
- [ ] 기능이 요구사항대로 동작한다.
- [ ] 예외/에러 처리 경로가 확인되었다.
- [ ] 관련 체크리스트 항목을 완료했다.
- [ ] 다음 작업자가 바로 이어서 할 수 있게 문서가 갱신되었다.

## 변경 이력
- 2026-03-01 - 초기 템플릿 생성
- 2026-03-01 - 문서 기반 워크플로우 적용 및 현재 작업 상태 반영
- 2026-03-01 - 기존 코드 변경분(`grading/index.html`, `grading-server/routers/results.py`) 리뷰 결과 반영
- 2026-03-01 - 하이로드 수학 브랜드 리디자인(메인/결과/서브 화면) 1차 반영
- 2026-03-01 - 후속 2차 정합성 반영(인라인 색상 및 메일/토스트 브랜드 문구 정리)
- 2026-03-01 - 리디자인 QA 수행(데스크톱/모바일) 및 이슈 정리
- 2026-03-01 - 패치 후 빠른 재검증 수행(`/grading`, `/homework`): CORS/버튼 대비/390px 레이아웃 확인
- 2026-03-01 - 최종 패치 재검증 수행(`/grading`, `/parent-portal`, `/homework`): CORS 재발 여부, `mathlive` 에러, 헤더 톤 골드 포인트, 390px 레이아웃 점검
- 2026-03-01 - 안정화 후속 패치 반영(`grading` mathlive 지연 로딩, `parent-portal`/`homework` 헤더 골드 디바이더)
- 2026-03-01 - `grading` 수식 편집 영향도 실검증: `mathlive` `HEAD` abort 경고와 편집 기능 성공/실패 fallback 경로 확인
- 2026-03-01 - 결과 API 검증 강화: `results.py`의 `update_item` 허용 필드/타입/범위 검증 추가
- 2026-03-01 - `/grading/` 첫 진입 스모크 재확인: 로컬 접속 200 및 `quick-recheck` 결과 대조로 렌더/탭/콘솔 PASS 판정
- 2026-03-01 - `grading/index.html` 폴링 안정성 보강: timeout 기반 fetch 공통화, 연속 실패 경고, 상세/진행률 폴링 회복성 향상
- 2026-03-01 - 결과 API 검증 2차: `regrade`/`feedback` 입력 정제(양의 정수, 허용 오류유형, 텍스트 길이 제한) 적용
- 2026-03-01 - 장시간 채점/대용량 E2E 실측 완료: 격리 Playwright 러너로 경고/복구 계측, 상세 경고 트리거 조건 추가 관찰 기록
- 2026-03-01 - 상세 폴링 경고 트리거 보강: 상세 요청 2개 중 하나라도 실패한 주기를 누적해 `results` 단독 실패에서도 경고 노출되도록 조정
- 2026-03-01 - 상세 완료 토스트 중복 방지: 동일 결과의 완료 상태가 연속 감지되어도 성공 토스트 중복 노출을 차단하는 가드 추가
- 2026-03-01 - 전체 재채점 E2E 정합성 검증: full regrade 시작 토스트/진행률 폴링 시작/완료 후 결과 재로딩 경로까지 격리 러너로 확인
- 2026-03-01 - 사용자 휴식 요청에 따라 인계 메모 보강: 다음 1순위/재개 절차를 문서에 고정
- 2026-03-01 - `results.py` full regrade 오류 분기 보강: Drive 다운로드 실패(502), ZIP 형식/손상/빈 파일(400), 이미지 0건(400) 구분 처리
- 2026-03-01 - full regrade 오류 분기 모킹 검증: 함수 하네스로 3개 실패 케이스(502/400/400) 응답코드/메시지 확인
- 2026-03-01 - full regrade 실데이터 검증 1건 수행: `result_id=34` 재실행 후 진행률 `failed` 및 timeout 에러메시지 확인
- 2026-03-01 - 문서 3종 정합성 업데이트: 실데이터 검증 범위를 "부분 완료 + 유형별 재현 대기"로 명확화
- 2026-03-01 - 채점 타임아웃 동적화 적용: 이미지 수 기반 timeout 계산(`base/per_image/max`) 및 timeout 안내 메시지 개선
- 2026-03-01 - 동적 timeout 적용 후 실데이터 재측정 시도: 운영 API ReadTimeout으로 상태 확인 BLOCKED, 서버 응답 안정화 후 재시도 필요
- 2026-03-01 - 운영 API 응답성 재측정: 5/10/20초 probe에서 핵심 endpoint 3종 모두 200 확인(ReadTimeout 일시 해소)
- 2026-03-01 - 운영 반영 판별용 `/health/runtime` 엔드포인트 추가: timeout/feature 런타임 설정 조회 경로 확보
- 2026-03-01 - 운영 서버 `/health/runtime` 확인 결과 404: 최신 코드 미배포 정황 문서화
- 2026-03-01 - 오류 유형 재현용 픽스처 생성: `qa-artifacts/regrade-fixtures`에 ZIP/비ZIP 샘플 및 README 추가
- 2026-03-01 - 런타임/재채점 통합 점검 스크립트 추가 및 실행: `/health/runtime` 404, `result_id=34` 상태/에러메시지 리포트 파일 생성
- 2026-03-01 - 배포/반영 검증 절차 문서화: 운영 반영 판정 기준을 `deploy-and-verify-runtime.md`로 표준화
- 2026-03-01 - 배포 검증 실행 스크립트 추가/실행: `verify_runtime_after_deploy.ps1`로 원클릭 점검(여전히 `/health/runtime` 404)
- 2026-03-01 - 원클릭 검증 재실행: `/health/runtime` 404 지속, `result_id=34` 상태 `review_needed` 유지 확인
- 2026-03-01 - 빠른 배포 점검 체크리스트 작성: `deployment-checklist-quick.md`로 즉시 실행 가능한 확인 순서 제공
- 2026-03-01 - 배포 사전점검 수행: 로컬 변경사항이 아직 원격에 반영되지 않았음을 문서화(`predeploy-readiness.md`)
- 2026-03-01 - 운영 반영 재확인: `/health/runtime` 200 및 timeout 런타임 값 노출 확인
- 2026-03-01 - 통합 점검 재실행(`trigger_regrade` 포함): 시작 200 확인, 후속 폴링 구간 ReadTimeout 반복으로 최종 판정 보류
- 2026-03-01 - 타임아웃 상향(30초) 재검증: 시작 200 + 중간 `grading(40%)` 관측, 그러나 동일 실행 내 endpoint 다수가 ReadTimeout으로 불안정
- 2026-03-01 - Railway 로그 분석 반영: `result #34` 내부 timeout(400s) 직접 관측, 단계별 타이밍 로그 + timeout 마지막 단계 노출 보강
- 2026-03-01 - OCR 타이브레이크 보호 로직 추가: 이미지당 항목 상한/재시도 상한/거부응답 즉시 fallback 및 런타임 설정 노출
