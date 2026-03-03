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
| 2026-03-01 | 배포 후 `/health/runtime`에서 `ocr_tiebreak` 설정 노출을 확인 | 코드 반영 여부를 운영에서 즉시 판정하고, 이후 이슈를 배포 문제와 분리하기 위함 | `https://academymanager-production.up.railway.app/health/runtime` |
| 2026-03-01 | 배포 후 재검증에서 `regrade_trigger=200`이지만 `results` poll 실패가 지속됨을 확정 | 채점 잡 시작 성공과 조회 API 안정성 문제를 분리해 후속 대응 포인트를 명확히 하기 위함 | `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | 긴급 우회(`USE_GRADING_AGENT=false`) 후 timeout 미재발을 확인 | 운영 안정화를 먼저 확보하고, 이후 에이전트 단계의 근본 수정을 안전하게 진행하기 위함 | `/health/runtime`, `qa-artifacts/runtime-regrade-check-report.json` |
| 2026-03-01 | `agent_verify`에 hard timeout/문제수 상한/잔여시간 fallback을 동시 적용 | 내부 `agent_verify` 장기 실행이 전체 timeout을 유발한 로그 근거가 있어, 에이전트 단계를 "제한된 보조 검증"으로 고정하기 위함 | `grading-server/routers/grading.py`, `grading-server/ocr/agent.py`, `grading-server/config.py`, `grading-server/main.py` |
| 2026-03-01 | 세션 재개 시 실행 순서를 커밋/배포/검증 기준으로 고정 | 다음 세션에서 "어디서부터 다시 시작할지" 혼선을 줄이고 복구 시간을 단축하기 위함 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | `USE_GRADING_AGENT=true` 복귀 검증에서 timeout 이전에 DB 스키마 오류를 우선 해결하기로 결정 | 재채점 트리거가 `500/PGRST204(grading_items.error_type 미존재)`로 실패하면 agent timeout 검증 자체가 성립하지 않기 때문 | `qa-artifacts/runtime-regrade-check-report.json`, `/api/results/{id}/regrade` |
| 2026-03-01 | DB 스키마(`grading_items.error_type`) 복구 후 trigger 200 복귀를 확인 | 스키마 불일치 차단요인을 제거해 재검증을 재개하기 위함 | `qa-artifacts/runtime-regrade-check-report.json`, `grading_items` |
| 2026-03-01 | 장시간 관측(20회 poll)에서 `results/progress` 응답 안정성을 확인 | 재채점 조회 API 불안정성(ReadTimeout 반복) 리스크가 완화되었는지 확인하기 위함 | `qa-artifacts/runtime-regrade-check-report-long.json` |
| 2026-03-01 | 신규 제출(`result_id=35`)로 장시간 관측(30회 poll)을 추가 수행 | 기존 결과(`34`)의 즉시 확정 편향을 줄이고 실제 운영 신규 제출 경로의 안정성을 확인하기 위함 | `qa-artifacts/runtime-agent-verify-long.json` |
| 2026-03-01 | StageTiming 직접 캡처는 로그 노이즈로 보류하고 운영 안정성 지표로 안정화 트랙을 PASS 마감 | 의사결정 지연보다 운영 안정성 확보와 다음 핵심 기능(학생/수납) 전환이 더 중요하다고 판단 | `qa-artifacts/runtime-agent-verify-long.json`, `docs/plan.md` |
| 2026-03-01 | 수납관리 설계의 1차 기준을 "세무 신고 편의 + 운영 실무성"으로 확정 | 교습소 초기 운영에서는 자동화보다 누락 없는 원장(ledger)과 증빙 추적성이 더 중요하기 때문 | `docs/plan.md`, 수납관리 차기 트랙 |
| 2026-03-01 | 결제 채널(결제선생/Bizzle)은 기능 우위보다 월마감 대사 효율 기준으로 선택 | 초기 운영 리스크는 결제 실패보다 정산/증빙 불일치가 크므로, 대사 시간과 오류율을 1차 KPI로 둠 | 수납관리 트랙, 결제 채널 파일럿 |
| 2026-03-01 | API 미도입 초기안으로 3채널(결제선생/비즐/사업자통장) 역할 분리 운영을 채택 | 결제선생 초기 비용/비즐 비대면 제약을 고려해 비용 최소화 + 운영 안정성을 우선 확보하기 위함 | 수납관리 트랙, 운영 원장(v1) |
| 2026-03-01 | 수납 화면은 "원장 입력/상태배지"를 1순위, "사진+AI 보조입력"을 2순위로 단계 적용 | 초기에는 누락 없는 원장 확정이 핵심이며, AI는 보조입력으로 도입해 오인식 리스크를 통제하기 위함 | 학생/수납 화면 설계, 운영 SOP |
| 2026-03-01 | 1순위 구현에서 카드 상태를 `청구됨/부분수납/완납/미확인입금`으로 고정하고 원장 모달 입력 흐름을 추가 | 세무/운영 관점에서 월마감 누락을 줄이려면 상태 가시성과 거래참조 입력 강제가 선행되어야 하기 때문 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 2순위 구현으로 `증빙+AI` 업로드→AI 추출→검토 팝업→사용자 확정 저장 흐름을 적용 | AI는 입력 보조로만 사용하고 최종 확정권한은 사용자에게 유지해 오인식 리스크를 통제하기 위함 | `index.html`, `js/payment.js`, `grading-server/routers/misc.py` |
| 2026-03-01 | 3순위 구현에서 일마감 요약/채널별 합계/월마감 CSV를 모두 프론트에서 즉시 생성 가능하게 적용 | 사업자/실결제 연동 전에도 내부 원장 데이터만으로 운영 리허설과 세무 산출물 검증을 진행할 수 있게 하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 미확인입금 상태에서는 학생 미선택 저장을 허용하고 별도 큐(localStorage)로 분리 저장 | 미확인입금의 정의(입금은 있으나 학생 미매칭)와 UI 동작을 일치시키기 위함 | `js/payment.js`, `index.html` |
| 2026-03-01 | UI 잘림 이슈는 대규모 리디자인 대신 즉시 패치(펼침 자동 스크롤/overflow/모바일 높이)로 처리 | 운영 빈도가 높은 수납 화면에서 입력 필드 가려짐은 데이터 누락 리스크가 크므로 빠른 안정화가 우선 | `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 노트북 좁은 높이/너비에서는 마감 요약 패널을 기본 접힘(컴팩트)으로 시작하도록 보강 | 상단 요약 패널이 리스트 가시영역을 과도하게 차지하는 문제를 줄여 카드 가독성과 스크롤 접근성을 확보하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 수납 모달 기본 폭을 데스크톱/노트북 중심으로 확대(900~960px) | 모바일 사용 빈도보다 데스크톱 수납 작업 중요도가 높아, 한 화면에서 카드/요약/버튼 가시성을 우선 확보하기 위함 | `style.css` |
| 2026-03-01 | 미확인입금 큐 목록에서 학생 매칭/삭제 액션을 직접 처리하는 UI를 추가 | 미확인입금 저장 후 후속 정리를 화면 내에서 바로 끝낼 수 있어 운영 누락을 줄이기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 카드 상세 영역에 내부 세로 스크롤을 추가해 겹침/잘림 상황을 완화 | 카드 높이를 무한 확장하기보다 안정적으로 스크롤 가능한 입력 영역으로 만들어 노트북 화면에서도 조작성을 보장하기 위함 | `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 카드를 아코디언(동시 1개 펼침)으로 바꾸고 펼침 카드 시각 강조를 추가 | 여러 카드를 동시에 열 때 목록이 밀리고 잘림처럼 보이는 체감 문제가 커서, 동시 펼침을 제한해 조작 안정성을 높이기 위함 | `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 카드 상세를 오버레이 표시로 전환하고 자동 스크롤 계산을 상세 높이 기준으로 재조정 | 카드 확장 시 하단 학생 카드가 밀리는 구조적 문제를 줄이고, 하단 잘림 체감을 완화하기 위함 | `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | AI 수납 추출에 선택형 다건 모드(`single`/`multi`)를 추가하고 검토/일괄 저장 흐름을 분리 | 한 장 이미지에 결제내역이 여러 건인 실사용 케이스를 개별 업로드 없이 처리하기 위함 | `grading-server/routers/misc.py`, `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 문서 기준 현재 메인 트랙을 학생/수납 대규모 업데이트로 재확정 | 재채점 안정화 트랙은 PASS 마감 상태이며, 실제 구현 우선순위는 수납 운영/세무 편의 기능으로 이동했기 때문 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 수납(매출)과 비용(지출)을 화면 탭으로 분리하고 월마감 관점에서 연결하기로 결정 | 입력 필드/검증 규칙이 다른 데이터를 한 화면에 섞으면 실수와 복잡도가 증가하기 때문 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 비용 원장은 Supabase 테이블이 준비된 경우 자동 동기화하고, 미구성 환경에서는 로컬 폴백으로 유지 | 초기 배포 환경 편차(테이블 미생성)에서도 기능 중단 없이 운영을 지속하기 위함 | `js/payment.js` |
| 2026-03-01 | 비용 원장 DB/RLS 적용 절차를 별도 SQL 파일로 고정 | 운영 적용 시 누락(테이블 생성, RLS 활성화, 정책 생성, schema reload)을 한 번에 방지하기 위함 | `EXPENSE_LEDGER_SETUP.sql` |
| 2026-03-01 | 롤플레잉 요청 시 관련 전문가 의견을 기본 포함하고 문서 3종에도 반영하기로 결정 | 사용자 요구사항(전문가 의견 상시 기록)과 세션 간 일관성을 유지하기 위함 | `.cursor/rules/expert-roleplay-doc-logging.mdc`, `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 사용자 상황이 명시되지 않아도 요청 맥락에 맞는 전문가를 자동 선택하기로 결정 | 사용자의 추가 설정 부담을 줄이고, 롤플레잉 품질/일관성을 높이기 위함 | `.cursor/rules/expert-roleplay-doc-logging.mdc`, `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 탭 숨김은 공통 `.hidden` 유틸에 의존하도록 명시하고, 누락된 유틸을 추가하기로 결정 | 비용 탭에서 수납 영역이 동시에 보이는 UI 혼선을 즉시 제거하고 탭 전환 동작을 일관화하기 위함 | `style.css`, `index.html`, `js/payment.js` |
| 2026-03-01 | 일마감 대사는 외부 채널 실합계를 월 기준 수동 입력받고 내부 원장 대비 차이를 즉시 계산해 표시하기로 결정 | API 미연동 초기 운영 단계에서 대사 누락을 줄이되, 사용자가 채널별 불일치를 즉시 확인/정정할 수 있게 하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 인건비/강사비는 비용 탭에서 조건부 상세 필드를 노출하고, 상세값은 메모에 구조화 문자열로 저장하기로 결정 | 기존 `expense_ledgers` 스키마 호환을 유지하면서 지급대상/지급월/공제 정보를 누락 없이 함께 기록하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 수납/비용 모두 세무 공통 필드(공급가액/세액/증빙유형/증빙번호)를 필수 입력 흐름에 포함하기로 결정 | 월마감 후 세금신고 자료를 별도 재정리하지 않고 CSV로 바로 검토 가능하게 하기 위함 | `index.html`, `js/payment.js` |
| 2026-03-01 | 비용 원장 세무 필드는 Supabase 컬럼(`supply_amount/vat_amount/evidence_type/evidence_number`)으로 우선 동기화하고, 미마이그레이션 환경은 메모 메타 fallback으로 유지 | 운영 DB 반영 전에도 기능 중단 없이 동작하면서, 반영 후에는 메모 파싱 의존을 줄여 다중 기기 동기화 정확도를 높이기 위함 | `js/payment.js`, `EXPENSE_LEDGER_SETUP.sql` |
| 2026-03-01 | 월 원장/수단별 CSV에 선택형 부가섹션(대사차이/인건비상세 메타)을 추가 | 원장 기본 컬럼은 유지하면서 운영자가 필요할 때만 정산 보조정보를 함께 내보내 회계 전달 편의성을 높이기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 수납/비용 입력 모달에서 직접입력/자동계산/AI추출을 시각적으로 분리하고, 자동 계산값은 읽기전용으로 고정 | 사용자가 “어디를 입력해야 하는지” 즉시 이해하고 세무 핵심값 오입력을 줄이기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 어려운 세무 용어는 쉬운 라벨로 병기하고, 주요 용어는 마우스오버 툴팁으로 즉시 설명 제공 | 일반 사용자(비회계)도 입력 지점을 이해해 입력 누락/오해를 줄이고, 회계사 전달 전에 용어 혼선을 낮추기 위함 | `index.html`, `style.css`, `mobile.css` |
| 2026-03-01 | 용어 도움말을 클릭형 팝업으로 확장하고 모바일/키보드 접근(Enter/Space/Esc)을 지원 | 터치 환경에서 hover 한계를 보완하고, 접근성/사용성을 함께 확보하기 위함 | `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 실사용 빈도가 높은 텍스트를 일반 표현으로 통일(`결제채널→결제경로`, `거래참조ID→거래확인번호`, `미확인입금 큐→입금 확인대기함`) | 비회계/비개발 사용자도 용어 의미를 직관적으로 이해하도록 하기 위함 | `index.html`, `js/payment.js` |
| 2026-03-01 | `대사 차이 합계`를 `장부와 실제 합계 차이`로 바꾸고 보조 설명을 함께 노출 | 운영자가 “대사” 용어를 몰라도 숫자의 의미(장부-실제 차이)를 즉시 이해하도록 하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 인건비 신고친화 설계는 주민번호 미저장 원칙으로 유지하고, 앱에는 최소 신고 필드만 저장하기로 결정 | 개인정보/보안 리스크를 줄이면서도 회계사 제출 준비에 필요한 데이터(지급대상/소득유형/지급월/세액)를 확보하기 위함 | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` |
| 2026-03-01 | 면세/과세 기본값은 고정 강제가 아니라 거래 성격 기반 선택 + 저장 검증 방식으로 운영하기로 결정 | 업종/거래별 과세 처리 차이를 반영하지 않으면 월마감 정합성 오류가 누적될 수 있기 때문 | 수납/비용 저장 검증 로직(후속 구현) |
| 2026-03-01 | 수납 화면에 교습소 기준 신고 일정 안내를 상시 노출하고, 기간/대상(인건비 지급 여부) 기반으로 신고 완료 확인창을 자동 표시 | 초보 운영자가 신고 시점을 놓치지 않게 하고, “완료 처리” 기록을 남겨 반복 알림 피로를 줄이기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 수납 모달 요약 패널 자동 접힘 기준을 보수적으로 조정하고, 사용자 선택(접기/펼치기)을 owner 기준으로 기억하도록 변경 | 노트북/일반 해상도에서 요약이 과도하게 접히고 학생 목록 스크롤이 안 되는 체감 이슈를 줄이기 위함 | `js/payment.js`, `style.css` |
| 2026-03-01 | 월별 세무 체크카드(비용 증빙 정리/인건비 지급/전월 원천세 확인)를 추가하고 monthKey 기준으로 저장 | “연간 일정”만으로는 월 운영 누락이 생기므로 월 체크 루틴을 화면에서 바로 처리하도록 하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 비용 모달 인건비 입력을 소득유형(비율제강사/월급제강사) 기반으로 분기하고, 비율제는 3.3%(원천세 3.0 + 지방소득세 0.3) 자동 계산 규칙을 기본 적용 | 사용자(비전문가)가 어떤 항목을 직접 입력해야 하는지 혼동하지 않도록 입력 책임(직접/자동)을 분리하고, 세무상 자주 틀리는 원천세 계산을 기본 자동화하기 위함 | `index.html`, `js/payment.js`, `style.css`, `mobile.css` |
| 2026-03-01 | 수납 탭을 데스크톱 기준 2열로 재배치(좌측 운영/세무 블록, 우측 학생목록 독립 스크롤)하고 결제 모달 폭을 확대 | 세무/요약 정보가 늘어나 학생카드가 하단으로 밀리는 문제를 해소하고, 수납 실작업(학생 선택/수정) 가시성을 최우선으로 유지하기 위함 | `index.html`, `style.css`, `mobile.css` |
| 2026-03-01 | 2열 레이아웃의 좌측 패널에 독립 스크롤을 추가해 요약 확장 시 하단 잘림을 방지 | 일마감/월마감 요약과 신고 안내가 길어져도 좌측 영역 전체를 스크롤로 탐색할 수 있어 정보 누락/가려짐을 줄이기 위함 | `style.css` |
| 2026-03-01 | 요약 패널에 월별 노무 체크리스트/회계 체크리스트를 추가하고 기존 monthKey 저장맵(`payment_tax_monthly_checklist`)으로 함께 관리 | 초보 운영자가 월말에 놓치기 쉬운 노무(소득유형/원천세/보험)와 회계(대사/증빙/CSV/전달) 확인 절차를 화면에서 즉시 점검하도록 하기 위함 | `index.html`, `js/payment.js`, `style.css` |
| 2026-03-01 | 세무/노무/회계 체크리스트를 “현재 월 + 인건비 지급 여부 + 원천세 점검기간(매월 1~20일)” 조건으로 활성화하고, 비활성 항목은 이유 문구를 노출 | 사용자가 “지금 무엇을 체크해야 하는지”만 보게 해 초보 운영 환경에서 선택 피로와 오판을 줄이기 위함 | `js/payment.js` |
| 2026-03-01 | AI 수납 증빙 추출 시 원본 이미지를 Google Drive `수납증빙/YYYY/MM/DD/항목` 경로로 자동 저장하고, 저장 경로를 원장 메모(`[드라이브증빙]`)에 남기도록 결정 | AI 추출 결과와 원본 증빙의 연결성을 확보해 월마감 누락/오입력 재검증을 쉽게 하기 위함 | `grading-server/routers/misc.py`, `js/payment.js` |
| 2026-03-01 | Drive 자동 저장 경로에 학원/owner 상위 폴더를 추가(`수납증빙/학원명또는owner/YYYY/MM/DD/항목`) | 다수 사용자 운영 시 증빙이 섞이지 않게 분리하고, 회계사 전달/감사 추적 시 소유자 구분을 명확히 하기 위함 | `grading-server/routers/misc.py` |

## 변경 방향/범위 변경 기록
- 2026-03-01 - 임시 채팅 맥락 중심 -> 문서 중심 운영으로 변경, 이유: AI 작업 방향 일탈 방지
- 2026-03-01 - 리디자인 범위를 메인 -> 결과 -> 서브 화면 순으로 확장, 이유: 의뢰인 요청(우선순위 순차 완료)

## 알려진 이슈/리스크
- [ ] `grading/index.html`의 선생님 목록 병렬 로딩 로직에 대해 실제 네트워크 환경(서버 지연/실패)에서 동작 확인 필요
- [ ] `grading-server/routers/results.py`의 전체 재채점 경로에 대해 대용량 ZIP/Drive 오류 시나리오 실검증 필요 (모킹 검증 완료, 실데이터 1건 부분 검증 완료)
- [ ] 실데이터 `result_id=34` full regrade 재실행에서 채점 시간 초과로 `failed/review_needed` 종료됨 - 동적 timeout 적용 후 재측정 필요
- [ ] 실데이터 `result_id=34`의 `error_message`가 여전히 "채점 시간 5분 초과"로 남음 - 동적 timeout 코드가 운영에 반영되었는지(배포 반영/실행 경로) 확인 필요
- [ ] 근본 수정 코드는 반영됨. `USE_GRADING_AGENT=true` 복귀 상태에서 운영 재검증(동일 `result_id=34`) 필요
- [ ] 로컬 변경사항이 아직 원격에 반영되지 않음(미커밋/미푸시) - 배포 전 커밋/푸시 필요
- [ ] 생성된 픽스처(`no_images.zip`, `empty.zip`, `not_a_zip.bin`)를 실제 제출/재채점 경로에 연결해 400/400/400(또는 502) 계약 검증 필요
- [ ] 통합 점검 리포트에서 `result_id=34`가 여전히 `review_needed` + `채점 시간 5분 초과`로 확인됨 - 배포 반영 후 동일 스크립트로 재비교 필요
- [ ] 긴급 우회 후 poll은 후반부 회복됐으나, 에이전트 비활성 상태 기반 결과이므로 원복 조건 검증 필요
- [ ] 재개 시점에 로컬 커밋/푸시/배포 적용 여부가 달라질 수 있으므로 `git status`와 `/health/runtime`를 첫 단계에서 재확인 필요
- [ ] 사진/OCR 보조입력에서 학생명/금액 오인식 가능성 존재 - "검토 후 확정" UX와 미확인 큐 분리 정책 필수
- [x] 최신 재검증에서 `regrade_trigger=500` (`PGRST204: grading_items.error_type` 컬럼 미존재) 발생 - DB 마이그레이션/스키마 캐시 정합성 복구 필요
- [x] 스키마 복구 후 실행은 `status=confirmed` 즉시 확정 경로로 종료됨 - 신규 제출(`result_id=35`) 장시간 관측으로 보완 검증 완료
- [x] 장시간 관측 실행(20 polls)에서 `results/progress` 오류 0건 확인 - 조회 API 안정성 리스크는 완화됨
- [x] 신규 제출(`result_id=35`) 장시간 관측(30 polls)에서도 `results/progress` 오류 0건 확인
- [ ] `agent_verify` 단계 StageTiming 직접 캡처는 로그 노이즈로 미확정. 다만 운영 안정성 지표(30/30, 에러 0) 기준으로는 PASS 마감 후 모니터링 유지
- [x] 전체 재채점 시작 후 진행률 폴링/완료 반영이 프론트와 일치하는지 E2E 확인 필요
- [x] 리디자인 반영 후 일부 인라인 스타일(구 색상값) 잔존 가능성 확인 필요
- [x] 다크 톤 화면(`grading/index.html`)에서 골드 포인트 대비(접근성) 수동 점검 필요
- [x] `grading/index.html` 첫 진입 시 `/api/teachers` CORS 오류 재현 여부 확인 필요
- [x] 골드 버튼(`#c9a74a`) + 흰색 텍스트 대비가 낮아 가독성 저하(특히 `grading`, `homework`)
- [ ] `parent-portal`, `homework` 첫 화면 골드 포인트 체감은 추가 사용자 피드백 기반 미세조정 필요
- [ ] 결제선생/Bizzle 중 단일 채널 통일 여부 결정 필요(SMS 간편결제 + 현장결제 + 정산/환불 지원성 검증)
- [x] `grading/index.html`에서 `https://cdn.jsdelivr.net/npm/mathlive` `HEAD` 요청이 `net::ERR_ABORTED`로 관측되나, 수식 편집 기능 자체는 정상 동작(기능 영향도 없음) 확인
- [x] 결과 API의 나머지 엔드포인트(`regrade`, `feedback`)도 동일 수준의 입력 검증 규칙 정리 필요
- [ ] 운영 로그에서 새 400 응답 증가 여부 모니터링 필요(클라이언트 호출 파라미터 정합성 확인)
- [ ] 3채널 운영 시 통장 입금자명 미매칭(학생 식별 실패) 리스크 관리 필요(입금 규칙/미확인 큐)
- [ ] 원장 기반 상태와 기존 과목별(수강료/교재비/특강비) 데이터가 혼재할 때 사용자 혼선 가능 - 안내 문구/헬프텍스트 보완 필요
- [ ] `POST /api/payments/extract`는 서버 JWT 인증이 활성화된 환경에서 Authorization 헤더가 필요함 - 토큰 누락 시 401 발생 가능
- [x] 현재 일마감은 내부 원장 합계 기준 요약만 제공함. 외부 채널(결제선생/비즐/통장) 실합계 입력 대비 "대사 차이" 계산 UI는 후속 구현 필요
- [ ] 외부 채널 실합계 입력값은 현재 월 기준 로컬 저장(localStorage) 방식임. 다중 기기 동기화가 필요하면 Supabase 테이블 확장 후 원격 동기화 설계가 필요
- [ ] 인건비/강사비 상세값은 현재 메모 문자열에 포함해 저장됨. 조회/집계 자동화를 위해서는 별도 컬럼(또는 JSON 필드) 확장 설계가 후속 필요
- [x] 비용 원장 세무 공통 필드(공급가액/세액/증빙유형/증빙번호)는 현재 Supabase 테이블 컬럼이 없어 `note` 메타 라인으로 동기화 중 - 컬럼 확장 전까지 메모 파싱 의존 리스크 존재
- [ ] `EXPENSE_LEDGER_SETUP.sql`의 컬럼 확장 SQL을 운영 Supabase SQL Editor에서 실제 실행해야 완전 전환됨(미실행 환경은 fallback 동작)
- [ ] 월 원장/수단별 CSV의 부가섹션(`추가섹션/추가항목`)은 1차 운영 포맷이며, 회계사 제출 고정 포맷 합의 전까지 수기 후처리 가능성 존재
- [ ] 수납 모달의 공급가액/세액은 현재 `수납금액 -> 공급가액 전액, 세액 0` 기본 규칙으로 자동 채움. 과세사업자 기준 고정 산식이 필요하면 과세구분 필드 추가 후 재정의 필요
- [ ] 용어집은 현재 핵심 용어 위주(귀속월/공급가액/세액/부가세구분/증빙)만 적용됨. 전체 세무 필드 확장은 사용자 피드백 기반 후속 반영 필요
- [ ] 인건비 신고에 필요한 민감 식별정보(주민번호 등)는 앱 비저장 원칙. 별도 보안 채널 운영 절차가 없으면 제출 직전 수기 보완이 필요
- [ ] 신고 일정 확인창은 법정신고 전용 캘린더가 아니라 “기본 안내 + 사용자 완료 체크” 보조장치임. 실제 신고대상/기한은 세무사/홈택스 공지로 최종 확인 필요
- [ ] 접힘 상태를 localStorage에 저장하므로 브라우저/기기별 상태가 다를 수 있음(다중 기기 동기화가 필요하면 원격 설정 저장 후속 설계 필요)
- [ ] 월별 체크카드 역시 localStorage 기반이므로 기기 간 공유되지 않음. 공동운영 환경은 원격 동기화 후속 필요
- [ ] 인건비 소득유형/원천세/지방소득세/실지급액은 현재 로컬 row + 메모 라인(`[인건비상세]`) 기반 저장임. 원격 동기화 완전일치를 위해 `expense_ledgers` 컬럼(또는 JSON) 확장이 후속 필요
- [ ] 수납 2열 레이아웃은 데스크톱(넓은 화면) 최적화 기준이며, 1100px 전후 구간에서는 카드/버튼 폭 체감 차이가 있을 수 있어 실사용 피드백 기반 미세조정이 필요
- [ ] 좌측/우측 이중 스크롤 구조이므로 터치패드/마우스휠 환경에서 스크롤 포커스 체감 차이가 있을 수 있음(사용자 피드백 기반 감도 조정 필요)
- [ ] 노무/회계 체크리스트는 현재 “확인 여부 체크” 중심으로 설계되어 법정 제출물 자동판정 기능은 없음(최종 신고대상/기한은 세무사/홈택스 재확인 필요)
- [ ] 조건부 활성화는 앱 로컬 날짜/월 선택 기준으로 동작하므로, 휴일/신고기한 변경/개별 사업장 예외는 자동 반영되지 않음(최종 판단은 외부 공지 확인 필요)
- [ ] AI 추출은 Drive 저장 실패 시에도 추출 결과를 우선 반환하도록 설계되어, `drive_reason` 안내를 확인하고 월마감 전 업로드 누락 여부를 재점검해야 함
- [ ] 학원명 폴더는 `teachers` 테이블 값(academy_name/academy/name) 우선이며, 값이 없으면 owner id로 fallback됨(초기 운영 시 폴더명이 owner 기반으로 보일 수 있음)
- [ ] AI 다건 모드는 OCR 품질에 따라 행 분리/학생 매칭 오차가 발생할 수 있어, 다건 검토 모달에서 수동 확인이 필요
- [ ] 비용 원격 동기화는 `expense_ledgers` 테이블 존재를 전제로 함 - 미구성 시 로컬 저장만 동작하므로 운영 DB 스키마 반영 필요
- [ ] RLS 정책은 `owner_user_id = auth.uid()` 기준이므로, 다중 계정/공동운영 권한 모델이 필요한 경우 정책 확장 설계가 후속 필요
- [ ] 단순/즉답 요청에서는 전문가 섹션 생략 규칙을 유지하되, "전문가 의견 포함" 요청을 놓치지 않도록 응답 템플릿 일관성 유지 필요
- [x] 미확인입금 큐 매칭 리스트 UI 반영 완료(월 기준 목록/학생 연결/큐 삭제)
- [ ] 잘림 패치는 CSS/스크롤 보정 중심으로 적용됨. 다양한 화면 크기에서 실사용 시나리오(데스크톱/모바일) 수동 확인 필요
- [x] 진행률 폴링 보강 후 실제 장시간 채점(5분+) 시나리오에서 경고 토스트 노이즈/복구 동작 체감 확인 필요
- [ ] 로컬 자동화 런타임(Python `playwright`/`greenlet` DLL) 환경 정리 필요 - 직접 재실행 경로 안정화 과제
- [x] 현재 세션에서 브라우저 자동화 도구 미가용(`cursor-ide-browser` 미등록) - 브라우저 계측 E2E 재실행 환경 확보 필요
- [x] 상세 폴링 경고가 `results` 단독 실패 구간에서도 필요한지 정책 결정 필요(현행: 진행률도 함께 실패해야 경고 발생)
- [x] 상세 폴링 성공 토스트 중복 노출 가능성(빠른 연속 호출 시) 추가 점검 필요

## 다음 작업자가 바로 알아야 할 것
- 현재 브랜치: `main`
- 진행 중 작업: 1순위 코드 보강 + 모킹 하네스 검증 완료, 실데이터 검증 1건(`result_id=34`) 수행
- 다음 1순위 작업: 학생 관리 + 수납 관리 대규모 업데이트(세무/교육/UX 통합 설계) 착수
- 수납/비용 최신 완료 스냅샷(학생관리 시작 전 참고):
  - 수납/비용 탭 분리 + 데스크톱 2열(우측 학생목록) + 좌측 독립 스크롤 반영
  - 세무/노무/회계 체크리스트와 조건부 활성화(현재월/지급여부/기간) 반영
  - 인건비 소득유형 분기(비율제/월급제), 자동계산/검증 반영
  - AI 수납 증빙 추출 시 Drive 자동 저장 + 원장 메모에 경로 기록 반영
  - Drive 경로 규칙: `수납증빙/학원명또는owner/YYYY/MM/DD/항목/파일`
- 재개 시작 순서(고정):
  1) `git status --short`로 로컬 변경 확인
  2) 수납관리의 세무 필수 데이터 항목 확정(수납일/수단/공급가/세액/증빙종류/환불이력)
  3) 학생관리-수납관리 공통 식별자/상태모델 설계
  4) 1주차 MVP 범위(학생 탭 + 수납 ledger + 월 리포트 CSV) 확정
  5) 결과를 `checklist.md` 테스트 기록에 PASS/BLOCKED로 즉시 반영
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
  - 배포 후 확인사항: `health_runtime_ok=True`, `ocr_tiebreak={max_items_per_image:6,max_retries_per_question:1,fallback_on_refusal:true}`
  - 긴급 우회 확인사항: `features.use_grading_agent=false` 반영 확인
  - 긴급 우회 재검증 요약: `regrade_trigger=200(grading)`, poll 후반부 `results/progress` 회복, `result_id=34` 최종 `review_needed`(score 100/500, uncertain 3), timeout 실패 문구 미재발
  - 최신 복귀 검증 요약: `features.use_grading_agent=true`/`agent_verify` 설정 노출은 정상이나, `regrade_trigger=500` (`PGRST204`, `grading_items.error_type` 컬럼 미존재)으로 본검증 BLOCKED
  - 스키마 복구 후 재검증 요약: `regrade_trigger=200`, `status=confirmed`, `error_message=null` 확인(차단요인 해소)
  - 장시간 관측 요약(20 polls): `results_ok=20/20`, `progress_ok=20/20`, 에러 0건, `result_id=34` 상태는 전 구간 `confirmed`
  - 신규 제출 관측 요약(30 polls): `result_id=35` 상태는 전 구간 `review_needed`, `results_ok=30/30`, `progress_ok=30/30`, 에러 0건
  - 픽스처 경로: `qa-artifacts/regrade-fixtures/no_images.zip`, `empty.zip`, `not_a_zip.bin`
  - 통합 점검 리포트: `qa-artifacts/runtime-regrade-check-report.json`
  - 배포/검증 표준 절차: `qa-artifacts/deploy-and-verify-runtime.md`
  - 원클릭 점검 스크립트: `qa-artifacts/verify_runtime_after_deploy.ps1`
  - 빠른 체크리스트: `qa-artifacts/deployment-checklist-quick.md`
  - 사전점검 리포트: `qa-artifacts/predeploy-readiness.md`
  - `/api/results/{id}/regrade`의 full regrade 경로를 오류 유형별 데이터셋으로 추가 호출해 502/400/400 계약을 실데이터에서도 재확인
  - 실패 시 프론트 토스트/상태 배너/진행률 폴링 동작이 사용자 관점에서 일관적인지 확인
  - 검증 완료 즉시 `checklist.md` 테스트 기록에 PASS/FAIL과 근거를 남길 것

## 학생관리 전환 메모
- 목표: 수납/비용 기능 위에 "학생 중심 운영" 레이어를 추가
- 시작 우선순위:
  1) 학생 필수 필드 표준화(재원상태/시작·종료/보호자 연락처/반코스)
  2) 학생 상세 화면에서 수납·비용 요약 진입(월별/기간별)
  3) 학생 기준 누락 알림(미수금/미확인입금/증빙 미연결) 도입
- 범위 외(후속): PG 실시간 정산, 전자세금계산서 발행, 고급 회계 분개 자동화
