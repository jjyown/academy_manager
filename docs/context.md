# 출석관리앱 컨텍스트 노트

## 제품/운영 컨텍스트
- 대상 사용자: 교사(관리), 학생(조회)
- 핵심 데이터: 학생, 반, 수업, 날짜, 출석상태, 수정자, 수정시각
- 운영 제약: 중복 기록 방지, 권한 분리, 이력 추적

## 현재 구조 요약
- 프론트엔드: 정적 HTML 기반 화면(`index.html`, `grading/index.html` 등), `supabase-js` 사용
- 백엔드: `FastAPI` 기반(`grading-server`), 결과/채점 관련 라우터 운영
- DB/스토리지: `Supabase` 연동(클라우드 데이터 저장/조회)

## 최근 의사결정 로그
| 날짜 | 결정 | 이유 | 영향 범위 |
|---|---|---|---|
| 2026-03-01 | 문서 3종 중심 워크플로우 고정 | 채팅이 바뀌어도 작업 연속성 확보 | 전체 개발 프로세스 |
| 2026-03-01 | 재채점 시 문항 데이터가 없으면 전체 재채점 fallback 허용 | 재채점 실패 케이스를 복구 가능하게 처리 | 결과 API, 재채점 UX |
| 2026-03-01 | 브랜드명을 `하이로드 수학`으로 1차 통일 | 향후 `학원` 표기 전환 전, 브랜드 인지 우선 | 메인/결과/서브 주요 타이틀 |
| 2026-03-01 | 리디자인 톤을 네이비 기반 + 골드 포인트로 확정 | 로고 톤을 반영하되 과도한 장식은 지양 | `style.css`, `grading/index.html`, `css/sub-shared.css` |
| 2026-03-01 | 인라인 하드코딩 색상/문구를 2차 정리 | 1차 반영 후 잔여 색상/문구 일관성 보강 | `index.html`, `parent-portal/index.html`, `send-reset-code` |
| 2026-03-01 | 리디자인 QA는 공개 페이지 기준(비로그인) 데스크톱+모바일(390px)으로 수행 | 배포 전 사용자 첫 진입 품질을 우선 검증 | `/`, `/grading/`, `/parent-portal/`, `/homework/` |
| 2026-03-01 | 패치 후 빠른 재검증을 동일 조건(로컬, 390px 포함)으로 수행 | 회귀 여부를 즉시 확인해 이슈 상태를 최신화 | `/grading/`, `/homework/` |
| 2026-03-01 | 최종 패치 재검증에서 CORS 재발은 미재현으로 판단 | `/grading/` 최초 진입 경로에서 `corsSignals`가 비어 있고 콘솔 에러도 미관측 | `/grading/` |
| 2026-03-01 | `mathlive`를 초기 로딩에서 제거하고 수식 편집 시 지연 로딩으로 전환 | 첫 진입 안정성을 우선 확보하고 외부 스크립트 실패 영향을 기능 진입 시점으로 축소 | `grading/index.html` |
| 2026-03-01 | `mathlive` `HEAD net::ERR_ABORTED`는 기능 차단 이슈가 아닌 경고성 신호로 분류 | 실제 모달 오픈/입력/저장/닫기 경로가 성공했고, CDN 차단 시 raw fallback 자동 전환도 확인 | `/grading/` |
| 2026-03-01 | 서브 화면 헤더에 골드 디바이더를 추가해 브랜드 포인트를 강화 | 네이비 중심 톤 유지하면서 시그니처 색(골드) 인지성을 보완 | `/parent-portal/`, `/homework/` |
| 2026-03-01 | `update_item` API를 허용 필드/타입 검증 방식으로 제한 | 과도한 필드 업데이트/잘못된 타입 입력으로 인한 데이터 오염 위험을 낮춤 | `grading-server/routers/results.py` |
| 2026-03-01 | `/grading/` 첫 진입 스모크는 로컬 실접속 + 최신 리체크 리포트 기준으로 PASS 판정 | 실시간 검증에서 HTTP 200을 확인했고, `quick-recheck-report.json`에 콘솔/페이지 에러 없음 및 탭 기본 동작 PASS가 기록됨 | `/grading/`, `qa-artifacts/quick-recheck-report.json` |
| 2026-03-01 | 결과 화면 진행률/상세 폴링에 timeout + 연속 실패 카운트 경고를 추가 | 네트워크 지연/간헐 실패 시 조용히 멈추는 문제를 줄이고 사용자에게 지연 상태를 명확히 전달 | `grading/index.html` |
| 2026-03-01 | `regrade`/`feedback` 입력을 양의 정수/허용 타입 기반으로 정제 | 무효 ID/오류 유형/과도한 문자열 입력으로 인한 저장 오염과 예외 케이스를 초기 단계에서 차단 | `grading-server/routers/results.py` |
| 2026-03-01 | 장시간 채점/대용량 E2E를 격리 Playwright 러너로 실행 | 루트 `package.json` 의존성 충돌을 우회해 실브라우저 계측을 완료하기 위함 | `tmp-e2e-runner`, `/grading/` |
| 2026-03-01 | 상세 폴링 경고 토스트는 `results`만 실패할 때는 발생하지 않음을 확인 | `_pollDetailResult` 내부에서 진행률 요청 성공 시 실패 카운트가 먼저 0으로 리셋되어 경고 조건(4회)에 도달하지 못하는 경로가 있음 | `grading/index.html` 상세 폴링 |
| 2026-03-01 | 상세 폴링 실패 카운트를 “요청 단위”가 아니라 “폴링 주기 단위(any fail)”로 누적 | `results` 단독 실패가 반복돼도 사용자 경고가 누락되지 않도록 하기 위함 | `grading/index.html` 상세 폴링 |
| 2026-03-01 | 상세 완료 성공 토스트에 `result_id` 기준 중복 방지 가드를 적용 | 폴링 타이머 경합/연속 완료 감지 시 동일 결과에 대한 성공 토스트 반복 노출을 방지하기 위함 | `grading/index.html` 상세 폴링 |
| 2026-03-01 | 전체 재채점(full_regrade) 시작→진행률 폴링→완료 반영 경로를 E2E로 확인 | `regradeWithKey` 분기와 `pollGradingProgress` 완료 반영(`loadResults`) 정합성을 실제 실행으로 검증하기 위함 | `grading/index.html`, `tmp-e2e-runner` |
| 2026-03-01 | full regrade 오류를 유형별로 분리해 HTTP 상태/메시지를 명확화 | 운영 시 원인 파악 속도를 높이고 프론트 토스트가 사용자에게 더 정확한 안내를 하도록 개선 | `grading-server/routers/results.py` |
| 2026-03-01 | full regrade 실패 분기를 모킹 하네스로 선검증 | 실데이터 대용량 검증 전에 API 상태코드/메시지 계약(502/400/400)을 빠르게 고정하기 위함 | `grading-server/routers/results.py` |
| 2026-03-01 | 실데이터 full regrade 1건(`result_id=34`)을 재실행해 실패 신호를 확인 | 코드/모킹 검증 이후 실제 운영 데이터에서 진행률/에러메시지 반영이 일관적인지 점검하기 위함 | `/api/results/34/regrade`, `/api/grading-progress` |
| 2026-03-01 | 브랜드 리디자인 트랙과 재채점 안정화 트랙을 문서상 분리 명시 | 사용자 관점에서 "현재 작업이 디자인 관련인지" 혼선 방지 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 채점 전체 timeout을 고정 5분에서 이미지 수 기반 동적 timeout으로 전환 | 대용량 이미지 채점에서 불필요한 timeout 실패를 줄이고, timeout 기준을 로그/메시지에 명시해 운영 분석성을 높이기 위함 | `grading-server/routers/grading.py`, `grading-server/config.py` |
| 2026-03-01 | 작업 단위 완료 시 문서 3종을 매번 즉시 업데이트하는 운영 규칙을 고정 | 작업 맥락 유실 방지 및 다음 세션/다음 작업자 인계 품질 유지 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 동적 timeout 적용 후 실데이터 재검증을 진행했으나 운영 API 응답 지연으로 판정을 보류 | 검증 자체가 서비스 지연 영향을 받는지 먼저 분리해 판단해야 오판을 줄일 수 있음 | `/api/results`, `/api/grading-progress`, `/api/results/{id}/items` |
| 2026-03-01 | 운영 API 응답성 재측정(5/10/20초 probe)으로 ReadTimeout이 일시 해소됨을 확인 | 네트워크/서버 지연 이슈와 채점 로직 이슈를 분리해 다음 검증 단계의 신뢰도를 높이기 위함 | `/api/results`, `/api/grading-progress`, `/api/results/34/items` |
| 2026-03-01 | `/health/runtime` 엔드포인트를 추가해 런타임 timeout 설정을 외부에서 확인 가능하게 함 | 운영에서 코드 반영/환경변수 반영 여부를 추정이 아닌 값으로 확인하기 위함 | `grading-server/main.py` |
| 2026-03-01 | 운영 서버 `/health/runtime`가 404임을 확인 | 동적 timeout 코드가 운영에 아직 배포되지 않았을 가능성을 실측으로 확인하기 위함 | `https://academymanager-production.up.railway.app/health/runtime` |
| 2026-03-01 | 오류 유형별 검증을 위한 재현 픽스처 파일을 사전 생성 | 운영 샘플 부족 상태에서 동일 입력으로 반복 검증 가능하게 준비하기 위함 | `qa-artifacts/generate_regrade_fixtures.py`, `qa-artifacts/regrade-fixtures` |
| 2026-03-01 | 런타임/재채점 통합 점검 스크립트로 운영 상태를 리포트화 | 수동 점검 반복 시 누락을 줄이고 동일 포맷으로 이력 비교하기 위함 | `qa-artifacts/run_runtime_regrade_check.py`, `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | 배포 반영 검증 절차를 문서로 고정 | 배포 이후 누구나 동일 순서로 `/health/runtime` 반영 여부를 판정하기 위함 | `qa-artifacts/deploy-and-verify-runtime.md` |
| 2026-03-01 | 배포 후 검증을 원클릭으로 수행하는 PowerShell 스크립트를 추가 | 배포 직후 반복 실행 비용을 줄이고 점검 누락을 방지하기 위함 | `qa-artifacts/verify_runtime_after_deploy.ps1` |
| 2026-03-01 | 원클릭 검증 재실행에서도 `/health/runtime` 404가 지속됨을 확인 | 일시적 장애가 아닌 미배포 상태일 가능성을 높이고 배포 확인 작업을 우선순위로 고정하기 위함 | `qa-artifacts/verify_runtime_after_deploy.ps1`, `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | 5분 내 실행 가능한 배포 체크리스트를 별도 문서로 제공 | 사용자/작업자가 즉시 따라할 수 있는 최소 절차를 분리해 커뮤니케이션 비용을 줄이기 위함 | `qa-artifacts/deployment-checklist-quick.md` |
| 2026-03-01 | 배포 사전점검에서 로컬 변경 미커밋/미푸시 상태를 확인 | GitHub 기반 배포가 최신 코드를 반영하지 못하는 근본 원인 후보를 명시하기 위함 | `qa-artifacts/predeploy-readiness.md`, `git status -sb` |
| 2026-03-01 | 운영 `/health/runtime` 200과 timeout 런타임 값을 확인해 배포 반영을 확정 | 동적 timeout 코드 반영 여부를 추정이 아닌 운영 응답값으로 확정하기 위함 | `https://academymanager-production.up.railway.app/health/runtime`, `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | `trigger_regrade` 포함 통합 점검을 재실행하고 폴링 구간 ReadTimeout을 별도 리스크로 분리 | 재채점 로직 실패와 운영 응답 지연 이슈를 분리해야 후속 조치 우선순위를 정확히 정할 수 있음 | `qa-artifacts/run_runtime_regrade_check.py`, `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | timeout 30초/6회 poll 재검증으로 "진행 신호는 있으나 응답이 간헐 타임아웃" 상태를 확정 | 재채점 로직 자체와 인프라/네트워크 지연을 분리해 추적하기 위함 | `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | Railway 로그 근거를 반영해 timeout 분석을 "외부 호출 지연"보다 "내부 채점 단계 장기 실행" 우선으로 전환 | `result #34`에서 `[TIMEOUT] ... 400s`가 직접 관측되어, 단계별 소요시간 가시화가 우선 과제가 됨 | Railway 운영 로그, `grading-server/routers/grading.py` |
| 2026-03-01 | 채점 단계 컨텍스트(stage/detail/elapsed)를 타임아웃·치명오류 메시지에 포함 | 재현 시 "어느 단계에서 오래 걸렸는지"를 즉시 식별해 대응 시간을 줄이기 위함 | `grading-server/routers/grading.py` |
| 2026-03-01 | OCR 타이브레이크에 시간 보호장치(항목 상한/재시도 상한/거부응답 즉시 fallback) 추가 | 거부 응답/저신뢰 대량 케이스에서 타이브레이크가 장시간 누적되는 것을 방지하기 위함 | `grading-server/ocr/engines.py`, `grading-server/config.py` |

## 변경 방향/범위 변경 기록
- 2026-03-01 - 임시 채팅 맥락 중심 -> 문서 중심 운영으로 변경, 이유: AI 작업 방향 일탈 방지
- 2026-03-01 - 리디자인 범위를 메인 -> 결과 -> 서브 화면 순으로 확장, 이유: 의뢰인 요청(우선순위 순차 완료)

## 알려진 이슈/리스크
- [ ] `grading/index.html`의 선생님 목록 병렬 로딩 로직에 대해 실제 네트워크 환경(서버 지연/실패)에서 동작 확인 필요
- [ ] `grading-server/routers/results.py`의 전체 재채점 경로에 대해 대용량 ZIP/Drive 오류 시나리오 실검증 필요 (모킹 검증 완료, 실데이터 1건 부분 검증 완료)
- [ ] 실데이터 `result_id=34` full regrade 재실행에서 채점 시간 초과로 `failed/review_needed` 종료됨 - 동적 timeout 적용 후 재측정 필요
- [ ] 실데이터 `result_id=34`의 `error_message`가 여전히 "채점 시간 5분 초과"로 남음 - 동적 timeout 코드가 운영에 반영되었는지(배포 반영/실행 경로) 확인 필요
- [ ] Railway 로그에서 `result #34` 내부 timeout(400s)이 관측됨 - 단계별 소요시간 로그가 반영된 최신 코드 배포 후 동일 케이스 재측정 필요
- [ ] 로컬 변경사항이 아직 원격에 반영되지 않음(미커밋/미푸시) - 배포 전 커밋/푸시 필요
- [ ] 생성된 픽스처(`no_images.zip`, `empty.zip`, `not_a_zip.bin`)를 실제 제출/재채점 경로에 연결해 400/400/400(또는 502) 계약 검증 필요
- [ ] 통합 점검 리포트에서 `result_id=34`가 여전히 `review_needed` + `채점 시간 5분 초과`로 확인됨 - 배포 반영 후 동일 스크립트로 재비교 필요
- [ ] timeout 30초 재실행에서도 API poll은 간헐 실패 - 다만 내부 timeout 로그가 확인된 만큼, 우선 최신 패치 배포 후 stage별 병목 지점 확정 필요
- [x] 전체 재채점 시작 후 진행률 폴링/완료 반영이 프론트와 일치하는지 E2E 확인 필요
- [x] 리디자인 반영 후 일부 인라인 스타일(구 색상값) 잔존 가능성 확인 필요
- [x] 다크 톤 화면(`grading/index.html`)에서 골드 포인트 대비(접근성) 수동 점검 필요
- [x] `grading/index.html` 첫 진입 시 `/api/teachers` CORS 오류 재현 여부 확인 필요
- [x] 골드 버튼(`#c9a74a`) + 흰색 텍스트 대비가 낮아 가독성 저하(특히 `grading`, `homework`)
- [ ] `parent-portal`, `homework` 첫 화면 골드 포인트 체감은 추가 사용자 피드백 기반 미세조정 필요
- [x] `grading/index.html`에서 `https://cdn.jsdelivr.net/npm/mathlive` `HEAD` 요청이 `net::ERR_ABORTED`로 관측되나, 수식 편집 기능 자체는 정상 동작(기능 영향도 없음) 확인
- [x] 결과 API의 나머지 엔드포인트(`regrade`, `feedback`)도 동일 수준의 입력 검증 규칙 정리 필요
- [ ] 운영 로그에서 새 400 응답 증가 여부 모니터링 필요(클라이언트 호출 파라미터 정합성 확인)
- [x] 진행률 폴링 보강 후 실제 장시간 채점(5분+) 시나리오에서 경고 토스트 노이즈/복구 동작 체감 확인 필요
- [ ] 로컬 자동화 런타임(Python `playwright`/`greenlet` DLL) 환경 정리 필요 - 직접 재실행 경로 안정화 과제
- [x] 현재 세션에서 브라우저 자동화 도구 미가용(`cursor-ide-browser` 미등록) - 브라우저 계측 E2E 재실행 환경 확보 필요
- [x] 상세 폴링 경고가 `results` 단독 실패 구간에서도 필요한지 정책 결정 필요(현행: 진행률도 함께 실패해야 경고 발생)
- [x] 상세 폴링 성공 토스트 중복 노출 가능성(빠른 연속 호출 시) 추가 점검 필요

## 다음 작업자가 바로 알아야 할 것
- 현재 브랜치: `main`
- 진행 중 작업: 1순위 코드 보강 + 모킹 하네스 검증 완료, 실데이터 검증 1건(`result_id=34`) 수행
- 다음 1순위 작업: `result_id=34` 재채점 후속 상태를 안정적으로 수집(폴링 timeout 완화)하고, 이후 ZIP/Drive 오류 유형별 실데이터 케이스를 확장 검증
- 현재 차단 요인: 운영 데이터셋에 오류 유형(다운로드 실패/ZIP 손상/이미지 0건)을 분리 재현할 샘플이 부족함
- 추가 차단 요인: 동적 timeout 코드와 운영 실행 결과(`5분 초과` 문구) 사이 불일치 가능성
- 추가 차단 요인(최신): 내부 timeout(400s) 발생 단계가 아직 운영 로그에서 충분히 세분화되지 않아 병목 지점을 한 번에 특정하기 어려움
- 재개 체크포인트:
  - 모킹 검증 결과: Drive 다운로드 실패 502, ZIP 형식 오류 400, 이미지 0건 400
  - 실데이터 검증 결과: `POST /api/results/34/regrade`는 시작 200 반환 후 진행률 `failed`, 결과 `review_needed`, `error_message=채점 시간 5분 초과`로 수렴
  - 운영 API 응답성 probe: 5/10/20초 구간 모두 200 응답 확인(일시적 ReadTimeout 해소)
  - timeout 30초 재검증에서 `POST /api/results/34/regrade`는 200이며, 중간 poll에서 `result34=status=grading`, `progress=cross_validate 40%`를 1회 관측
  - 같은 실행에서 `health/runtime/results/progress/items`가 다수 ReadTimeout(30초)으로 실패해 최종 수렴값은 미확정
  - 운영 `/health/runtime` 200 이력과 timeout 값 노출은 확인된 상태(배포 반영 자체는 완료)
  - Railway 로그 근거: `[TIMEOUT] 채점 시간 초과 (result #34, 400s)`가 직접 관측됨
  - 최신 코드 반영사항: timeout/예외 시 마지막 단계(stage/detail)와 단계 경과시간 로그를 남기도록 패치 완료
  - 픽스처 경로: `qa-artifacts/regrade-fixtures/no_images.zip`, `empty.zip`, `not_a_zip.bin`
  - 통합 점검 리포트: `qa-artifacts/runtime-regrade-check-report.json`
  - 배포/검증 표준 절차: `qa-artifacts/deploy-and-verify-runtime.md`
  - 원클릭 점검 스크립트: `qa-artifacts/verify_runtime_after_deploy.ps1`
  - 빠른 체크리스트: `qa-artifacts/deployment-checklist-quick.md`
  - 사전점검 리포트: `qa-artifacts/predeploy-readiness.md`
  - `/api/results/{id}/regrade`의 full regrade 경로를 오류 유형별 데이터셋으로 추가 호출해 502/400/400 계약을 실데이터에서도 재확인
  - 실패 시 프론트 토스트/상태 배너/진행률 폴링 동작이 사용자 관점에서 일관적인지 확인
  - 검증 완료 즉시 `checklist.md` 테스트 기록에 PASS/FAIL과 근거를 남길 것
