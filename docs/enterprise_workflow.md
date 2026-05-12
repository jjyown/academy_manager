# 엔터프라이즈 개발 운영 플레이북

- 문서 기준일: 2026-05-12
- 적용 범위: 메인 페이지, 숙제 제출, 채점 페이지, 학부모 포털, Supabase 연동 전 구간

## 1) 작업 단위 정의 (Work Item)
- 모든 변경은 "작업 단위 1개" 기준으로 수행한다.
- 작업 단위마다 아래 5가지를 반드시 남긴다.
  - 목표(왜 하는지)
  - 변경 범위(어디를 바꾸는지)
  - 위험(무엇이 깨질 수 있는지)
  - 검증 계획(어떻게 확인하는지)
  - 완료 기준(무엇을 PASS로 볼지)

## 2) 단계별 게이트 (대기업식 경량화)
### Gate A. 설계/영향 분석
- 요구사항을 1~2문장으로 재정의한다.
- 영향 파일/화면/DB 정책을 먼저 식별한다.
- 변경 범위를 넘어서는 항목은 `docs/context.md`에 "범위 변경"으로 기록한다.

### Gate B. 구현
- 작은 단위로 수정하고 각 단위마다 문법/린트 검증을 수행한다.
- 권한/데이터 정합성 관련 로직은 "기능 추가"와 "안전장치"를 같이 넣는다.

### Gate C. 통합 회귀
- 최소 회귀 세트(필수):
  - 페이지 연결: 메인 ↔ 숙제 제출 ↔ 채점 ↔ 학부모 포털
  - 인증코드 흐름: `student_code`, `parent_code`
  - 권한 흐름: 일반교사/관리자 인증 분기
  - 데이터 흐름: UI 표시값과 DB 조회 결과 일치

### Gate D. 배포/운영 준비
- 코드 문제인지, Supabase 문제인지, 외부 플랫폼 문제인지 원인분류를 확정한다.
- SQL 반영이 필요한 경우 실행 순서를 문서에 고정한다(점검 -> 반영 -> 재점검).

### Gate E. 사후 기록
- `docs/plan.md`: 이번 작업 상태/다음 단계
- `docs/context.md`: 핵심 의사결정과 이유
- `docs/checklist.md`: PASS/FAIL 체크와 미완료 항목

## 3) PRD-lite(간단 요구사항 정의) 템플릿
- 문제:
- 사용자 영향:
- 성공 기준:
- 제외 범위:
- 위험/가정:

## 4) 테스트 전략 (Risk-Based)
- High Risk: 권한, 출석 상태 변경, DB 정책(RLS), 인증코드
- Medium Risk: UI/문구/스타일, 요약 집계
- Low Risk: 라벨 텍스트, 안내 문구

- 규칙:
  - High Risk 변경은 기능 테스트 + 회귀 테스트를 둘 다 수행한다.
  - Medium Risk 변경은 관련 화면 회귀를 최소 1회 수행한다.
  - Low Risk 변경도 관련 화면 스모크 테스트는 수행한다.

## 5) 장애 대응 표준 (Triaging)
- 1단계: 재현/로그 확보(콘솔, 네트워크, API 응답)
- 2단계: Supabase 정책/데이터 확인(RLS, 정책, 행 존재 여부)
- 3단계: 외부 플랫폼 상태 확인(배포, 환경변수, 경로, 캐시)
- 4단계: 원인 확정 후 단일 축 수정(코드 또는 SQL 또는 배포설정)

## 6) 운영 품질 지표 (간단 KPI)
- 변경 실패율: 핫픽스가 필요한 작업 비율
- 회귀 발생률: 기존 기능 재고장 비율
- 검증 누락률: 체크리스트 누락 항목 비율
- 복구 시간: 장애 인지부터 원인 확정까지 소요 시간

## 7) 이 앱 전용 필수 수칙
- 패치 중 페이지 연결 상태를 항상 확인한다.
- 패치 중 인증코드 연결 상태를 항상 확인한다.
- 상태/권한/정책 변경 시 "UI 값 = DB 값"을 반드시 교차 확인한다.
- 연속 작업에서는 시작/중간/완료 진행현황을 사용자에게 단계별로 공유하고, 동일 작업 사이클에 docs에도 즉시 기록한다.
- 문서 업데이트 없는 완료 보고를 금지한다.
- 중요 작업(보안/권한/DB정책/배포)은 작업 전에 전문가 토론(보안, 백엔드, 프론트, 운영QA)을 먼저 수행하고, 합의 요약을 `docs/context.md`에 기록한다.

## 8) 자동 업데이트 운영 규칙
- 날짜 자동 동기화:
  - `py qa-artifacts/sync_doc_dates.py`
  - `plan/context/checklist/enterprise_workflow`의 `문서 기준일`을 당일로 자동 동기화한다.
- 완전 자동(커밋 시 자동 연동):
  - `.git/hooks/pre-commit`에서 `append_linked_docs_log.py --auto-from-git`를 자동 실행한다.
  - 커밋 시 staged 파일 기준으로 문서 4종 기록이 자동 추가되고, 훅 내부에서 docs 4종을 다시 `git add`한다.
  - 임시 비활성화가 필요하면: `SKIP_LINKED_DOCS_AUTOMATION=1 git commit -m "..."`.
- 문서 4종 연동 기록(권장):
  - `py qa-artifacts/append_linked_docs_log.py --task-id "학생관리 127차" --summary "문서 연동 자동기록" --decision "문서 4종 연동 기록 자동화 적용" --reason "수동 기록 누락 방지와 문서 일관성 확보" --impact "docs/plan.md, docs/context.md, docs/checklist.md, docs/enterprise_workflow.md" --note "연동 자동 기록"`
  - 1회 실행으로 `plan/context/checklist/enterprise_workflow` 기록을 동시에 추가한다.
- 엔터프라이즈 로그 자동 추가:
  - `py qa-artifacts/append_enterprise_log.py --task-id "학생관리 126차" --summary "엔터프라이즈 자동로그 도입" --gates "A:PASS,B:PASS,C:PASS,D:PASS,E:PASS"`
  - 작업 단위 1건 완료 시 자동 로그를 본 문서 상단에 추가한다.

## 9) 자동 업데이트 로그
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-12 | AUTO-20260512 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 9개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-11 | AUTO-20260511 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 9개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 8개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-10 | AUTO-20260510 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 3개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 101개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 166개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-05-09 | AUTO-20260509 | staged 9개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-11 | AUTO-20260411 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-07 | AUTO-20260407 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-06 | AUTO-20260406 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-06 | AUTO-20260406 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-06 | AUTO-20260406 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-05 | AUTO-20260405 | staged 16개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-05 | AUTO-20260405 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-05 | AUTO-20260405 | staged 10개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-05 | AUTO-20260405 | staged 8개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-05 | AUTO-20260405 | staged 15개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-04 | AUTO-20260404 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-04 | AUTO-20260404 | staged 9개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-03 | AUTO-20260403 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-03 | AUTO-20260403 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-03 | AUTO-20260403 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-01 | AUTO-20260401 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-04-01 | AUTO-20260401 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 1개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-31 | AUTO-20260331 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-30 | AUTO-20260330 | staged 17개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-30 | AUTO-20260330 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-30 | AUTO-20260330 | staged 13개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-29 | 종합평가-AI고정지침-20260329 | users.student_eval_ai_style_note·모달 저장·Edge 주입·메타말투 금지 | gates: A:PASS,B:PASS,C:부분,E:PASS | note: SQL+함수 재배포
- 2026-03-29 | 종합평가-AI프롬프트전문화-20260329 | Gemini 시스템 01~04섹션·출결·숙제요약 주입 | gates: A:PASS,B:PASS,C:부분,E:PASS | note: generate-student-eval-report redeploy
- 2026-03-29 | 채점관리-숙제관리통합-20260329 | 숙제 관리 단일 탭·배정·채점/제출 현황 서브·grading_nav hwSub | gates: A:PASS,B:PASS,C:부분,E:PASS | note: grading/index.html
- 2026-03-29 | AUTO-20260329 | staged 30개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-29 | 종합평가-본문2000-20260329 | AI 종합평가 2000자·줄바꿈 보존·번호항목 개행·UI maxlength 정렬·script 상수 통일 | gates: A:PASS,B:PASS,C:부분,E:PASS | note: Edge generate-student-eval-report 재배포·SQL SUPABASE_EVAL_PARENT_VISIBLE_AI 적용
- 2026-03-29 | 채점관리-숙제세션JWT-20260329 | PIN 후 단기 JWT 발급 및 homework-submissions Bearer 보호 | gates: A:PASS,B:PASS,C:스모크권장,D:RAILWAY_ENV,E:PASS | note: GRADING_SESSION_SECRET SUPABASE_ANON_KEY
- 2026-03-29 | 채점관리 2026-03-29c | 숙제 제출 GET /api/homework-submissions Service Role | gates: A:PASS,B:PASS,C:부분,E:PASS | note: 소속 검증+grading/index fetch
- 2026-03-29 | 채점관리 2026-03-29 | 통계 탭 제거·숙제 제출 달력 탭(homework_submissions) | gates: A:PASS,B:PASS,C:부분,E:PASS | note: grading/index.html
- 2026-03-29 | 관리자Auth 2026-03-29b | WeakPasswordError 안내·문자군 사전검증·모달 문구 | gates: A:PASS,B:PASS,C:부분,E:PASS | note: AuthWeakPasswordError 문자군 4종
- 2026-03-29 | 관리자Auth 2026-03-29 | 관리자 비밀번호 변경: 8자·setSession·422 매핑·이메일 프리필 | gates: A:PASS,B:PASS,C:부분,D:부분,E:PASS | note: Supabase 정책 불일치·세션 레이스 완화
- 2026-03-25 | AUTO-20260325 | staged 15개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 10개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 2개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 4개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 6개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-23 | AUTO-20260323 | staged 18개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 8개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 172개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 5개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 7개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | AUTO-20260322 | staged 12개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-22 | QA-20260322-EXPERT2 | 전문가 2차 정적 검사(eval·JWT·CORS·innerHTML 패턴, 문서 반영) | gates: A:PASS,C:PARTIAL,D:N/A,E:PASS | note: 코드 변경 없음
- 2026-03-22 | QA-20260322 | 종합점검: node--check, compileall, E2E(tmp-e2e-runner), HTTP스모크 4경로 | gates: C:PASS,E:PASS | note: E2E는127.0.0.1:8000선기동필요
- 2026-03-22 | AUTO-20260322 | staged 69개 파일 기준 문서 연동 자동기록 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동 기록
- 2026-03-21 | 학생관리 139차 | 안전 재강화 1단계 SQL 세트(적용/롤백) 추가 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 단일 정책 축소 + 즉시 복귀 경로 확보
- 2026-03-21 | 학생관리 138차 | 긴급복구 후 스모크 3종 PASS 기준선 고정 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 다음 단계는 재강화 SQL(적용/롤백 세트)
- 2026-03-21 | 학생관리 137차 | attendance_records RLS 42501 긴급복구 SQL 추가 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 출석 write 경로 복구 우선
- 2026-03-20 | 학생관리 136차 | 일정 DB 동기화 세션 사전검증 추가(401 요청 선차단) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 세션 만료 시 네트워크 요청 전 차단
- 2026-03-20 | 학생관리 135차 | 일정 추가 알림 누락/중복 오해 방지 패치(로컬반영/DB동기화 안내 분리) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: DB 실패 시 사용자 피드백 누락 경로 차단
- 2026-03-20 | 학생관리 134차 | 메인 일정 미노출 긴급복구(teachers 공개읽기 정책 임시완화) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 일정/담당교사 표시 경로 우선 복구
- 2026-03-20 | 학생관리 133차 | Supabase 실행용 정책/검증 SQL 추가 + 연속 진행현황 공유 규칙 반영 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 다음 단계 Supabase SQL 실행/검증 준비 완료
- 2026-03-20 | 학생관리 132차 | 잔여 중요 보안 보강(teachers 정책 축소+PIN 해시 로그 제거) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 중요작업 연속 보강
- 2026-03-20 | 학생관리 131차 | Critical 보안 우선 패치(RLS 안전화+Edge Function 인증검증) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: Critical 2건 선조치 완료
- 2026-03-20 | 학생관리 130차 | 보안 내용.zip(26장) 기준 재점검 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 수정 우선순위(Critical 2건, High 2건) 도출
- 2026-03-20 | 학생관리 129차 | 중요작업 전문가 토론 선행 규칙 고정 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 중요작업 토론 상시 적용
- 2026-03-20 | 학생관리 128차 | 완전 자동(커밋 시) 문서 연동 훅 적용 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 완전 자동 모드 활성화
- 2026-03-20 | 학생관리 127차 | docs 4종 연동 자동기록 기능 추가 | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: 연동 자동화 1회 실행 검증
- 2026-03-20 | 학생관리 126차 | enterprise 문서 자동화 스크립트 추가(sync+append) | gates: A:PASS,B:PASS,C:PASS,D:PASS,E:PASS | note: sync_doc_dates 대상 확장 + 자동 로그 스크립트 신설
