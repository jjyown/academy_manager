# 출석관리앱 작업 계획서

## 프로젝트 목표
- 학생/수업 기준으로 출석 상태를 정확히 기록하고 조회한다.
- 교사 권한으로만 수정 가능하도록 접근 제어를 적용한다.
- 변경 이력을 남겨 추적 가능한 운영 상태를 유지한다.

## 현재 스프린트 목표
- [ ] 출석 입력/조회 기본 흐름 안정화
- [ ] 결과 화면(`grading/index.html`) 동작 및 UX 점검
- [ ] 결과 API(`grading-server/routers/results.py`) 검증 강화

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

상태 기준: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED`

## 작업 인계 메모 (휴식 후 재개용)
- 현재 상태: 사용자 요청으로 작업 잠시 중단(코드 안정화/E2E 검증까지 완료 상태)
- 재개 시작점: `docs/context.md`의 "다음 1순위 작업"부터 진행
- 다음 작업(우선순위): `results.py` 전체 재채점 경로의 대용량 ZIP/Drive 오류 시나리오 검증
- 재개 시 권장 순서:
  1) 오류 시나리오 케이스 정의(다운로드 실패/압축 해제 실패/이미지 추출 0건)
  2) API 응답/로그/프론트 토스트 정합성 확인
  3) 검증 결과를 `context.md`/`checklist.md`에 즉시 반영

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
