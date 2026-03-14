# 출석관리앱 체크리스트

- 문서 기준일: 2026-03-15
## 공통 품질 체크
- [x] 요구사항 재확인 후 구현 시작
- [x] `python qa-artifacts/sync_doc_dates.py` 실행 후 작업 시작
- [x] 문서 기준일을 작업 당일로 갱신
- [x] 다음날 작업 시 `문서 기준일`을 다음 날짜로 재갱신(고정 날짜 사용 금지)
- [x] 문서 3종(`plan/context/checklist`)의 `문서 기준일` 완전 일치 확인
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
| 2026-03-15 | 학생관리 113차(record_id UUID 파싱 오류로 인한 미처리 전환 실패 보정) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` + id 처리 경로 점검(`parseInt` 제거, UUID/숫자 문자열 허용) | PASS | UUID id를 숫자로 잘라 쿼리하던 경로를 제거해 `invalid input syntax for type uuid` 재발 조건을 차단 |
| 2026-03-15 | 학생관리 112차(출석상태->미처리 전환 시 이전 상태 롤백 방지) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` + 미처리 분기 삭제 경로 점검(단건 삭제 + 슬롯 잔존 정리) | PASS | `record_id` 삭제만으로 남을 수 있는 중복 슬롯 레코드를 추가 정리해, 상태 선택 후 다시 과거 상태로 복귀하는 경로를 차단 |
| 2026-03-15 | 학생관리 111차(출석->미처리 전환 시 `attendance_records` 400 방지) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` + 삭제 경로 코드 점검(`record_id` 우선 삭제, owner fallback uuid 제한) | PASS | `record_id` 존재 시 직접 삭제로 분기해 슬롯 조건 오차를 줄였고, `ensureOwnerId`의 비-uuid fallback을 차단해 owner 필터 타입 불일치 400 재발 경로를 축소 |
| 2026-03-14 | 학생관리 110차(수납/출석/학생 통합 E2E 점검 정리) | `tmp-e2e-runner`에서 `npm run test:e2e` + `node --check script.js/qr-attendance.js/js/payment.js` + `ReadLints` | PASS | 자동 러너(폴링/재채점) PASS, 핵심 도메인 스크립트 문법/린트 PASS. 권한·실데이터 교차 시나리오는 실기기 수동검증 항목으로 분리 |
| 2026-03-14 | 학생관리 109차(상단 담당 칩 기준키 정합성: 조회교사 의존 제거) | `node --check qr-attendance.js` + 기준키 경로 점검(`primaryTeacherId`, `normalizedPrimaryTeacherId` 우선순위) | PASS | 상단 담당 칩의 우선 기준을 `assignedTeacherId`로 고정해, 서로 다른 교사 계정에서 같은 학생을 조회해도 담당명이 일관되게 표시되도록 보정 |
| 2026-03-14 | 학생관리 108차(복수 담당 시 담당 칩 실명 노출 보정) | `node --check qr-attendance.js` + UI 문구 경로 점검(`teacherChip` 복수 담당 분기에서 assigned teacher name 해석) | PASS | 고정 안내 문구를 제거하고 `담당 선생님 : {현재 배정 담당교사 이름}` 형식으로 변경, 이름 해석 실패 시 `담당 미확인` fallback 적용 |
| 2026-03-14 | 학생관리 107차(담당 칩 복수 담당 문구 변경) | `node --check qr-attendance.js` + UI 문구 경로 점검(`teacherChip` 복수 담당 분기) | PASS | 복수 담당 안내 문구를 `담당 선생님 : 날짜별 상이`에서 `담당 선생님 : 현재 담당선생님`으로 교체 |
| 2026-03-14 | 학생관리 106차(출석이력 담당선생님 날짜별 동적 판정) | `node --check qr-attendance.js` + 코드 경로 점검(`loadStudentAttendanceHistory`의 날짜별 `dayPrimaryTeacherId`/메인슬롯/툴팁 분기) | PASS | 고정 `currentTeacherId` 분류를 제거하고 날짜별 일정/기록 분포로 담당교사를 재선정해 메인/툴팁이 날짜마다 바뀌도록 보정 |
| 2026-03-13 | 학생관리 105차(Supabase 테이블 체크: READ ONLY 헬스체크 SQL 추가) | `SUPABASE_TABLE_HEALTH_CHECK.sql` 정적 검토(테이블/타입/FK/고아데이터/RLS/정책/인덱스 섹션) | PASS | 운영 점검 전용 SQL로 분리해 변경 SQL과 혼용 리스크를 줄이고, 한 번 실행으로 보정 필요 영역을 식별 가능하도록 구성 |
| 2026-03-13 | 학생관리 104차(Supabase 타입 정합성 2차: `teachers.id` 기준 동적 변환) | 운영 오류 메시지(`incompatible types: text and uuid`) 대조 + `SUPABASE_CORE_SECURITY_MAINTENANCE.sql` B-3 구간 정적 검토 | PASS | `homework_submissions.teacher_id`를 고정 text 변환 대신 `teachers.id` 실제 타입(`uuid/text`) 기준으로 정렬하도록 수정하고, UUID 변환 전 비정상 값을 NULL 정리해 캐스팅 실패를 차단 |
| 2026-03-13 | 학생관리 103차(Supabase 타입보정 실패 재발 방지: policy 의존성 선해제) | 운영 에러 메시지(`cannot alter type of a column used in a policy`) 대조 + `SUPABASE_CORE_SECURITY_MAINTENANCE.sql` B-3 구간 정적 검토 | PASS | `homework_submissions` 정책을 임시 제거한 뒤 `teacher_id` 타입/FK 보정, 이후 기본 정책 복구 단계를 추가해 동일 실패 재발 경로 차단 |
| 2026-03-13 | 학생관리 102차(Supabase SQL 정돈: core 보안/정합성 통합 유지보수 스크립트 추가) | `SUPABASE_CORE_SECURITY_MAINTENANCE.sql` 정적 검토(점검/반영/재점검 구간, DRY-RUN 기본값, 옵션 플래그) + 위험 패턴 탐지 결과 대조 | PASS | RLS 과허용/공개 정책/teacher_id 타입 정합성 점검과 선택 보정을 한 파일로 표준화. 운영 실행은 SQL Editor에서 `apply_changes=true`로 별도 수행 필요 |
| 2026-03-13 | 학생관리 101차(내 학생 필터 정합성: 타교사 학생 혼입 차단) | `node --check script.js` + `ReadLints(script.js)` | PASS | `내 학생` 필터를 `students.teacher_id` 우선으로 전환하고, 로컬 매핑은 `teacher_id` 공백 학생에만 보조 사용하도록 보강해 stale 매핑 혼입 경로를 차단 |
| 2026-03-13 | 학생관리 100차(툴팁 범위 정책 반영: 같은 날짜 타교사 다른 시간 표시) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 타교사 툴팁 집계를 날짜 단위로 확장하고 `teacher+time` 기준으로 중복 제거해, 담당교사 메인카드와 타교사 보조정보(툴팁) 분리 정책을 구현 |
| 2026-03-13 | 학생관리 99차(툴팁 노출 조건 명확화: 유효 타교사 행 0건이면 비노출) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | `validOtherTeachers` 선계산 후 길이가 0이면 툴팁 자체를 비활성화하도록 변경해, 주담당 단독 상태에서 불필요한 툴팁 노출을 차단 |
| 2026-03-13 | 학생관리 98차 실기기 회귀(담당선생님 불일치 + 일정수정 중복생성) | 사용자 실기기 재현(모달 담당표시 확인 + 일정 변경 저장 후 중복 여부 확인) | PASS | 모달 담당선생님이 슬롯 owner와 일치, 일정 변경은 기존 슬롯 갱신으로 반영되고 신규 중복 생성 미발생 확인 |
| 2026-03-13 | Security Advisor 경고 해소 확인(`RLS Disabled in Public`) | Supabase Security Advisor Refresh + 재점검 쿼리(`backup_* rls_enabled`) | PASS | `public.backup_attendance_teacher_fix_20260309`의 `rls_enabled=true` 확인, Security Advisor 경고 소거 확인 |
| 2026-03-13 | Security Advisor 일괄 점검/보정 SQL 추가(`public.backup_*`) | `SUPABASE_BACKUP_RLS_BATCH_MAINTENANCE.sql` 작성 + 정적 검토(점검쿼리, DRY-RUN, 유지+잠금, 삭제 옵션, 재점검 쿼리) | PASS | 다수 백업 테이블에 대해 수동 반복 없이 동일 절차로 RLS/권한 상태를 일괄 점검하고 보정할 수 있는 표준 스크립트 확보 |
| 2026-03-13 | Security Advisor 경고 대응 SQL 추가(`RLS Disabled in Public`) | `SUPABASE_BACKUP_TABLE_RLS_FIX.sql` 작성 + 정적 검토(삭제/유지+잠금 분기, 대상테이블 존재 체크, owner 정책 조건부 생성) | PASS | `public.backup_attendance_teacher_fix_20260309` 같은 백업 테이블에 대해 1회 실행으로 삭제 또는 RLS+권한잠금을 선택할 수 있도록 표준화 |
| 2026-03-13 | 학생관리 98차(담당선생님 불일치 + 일정수정 중복생성 동시 보정) | `node --check script.js` + `ReadLints(script.js, index.html)` | PASS | 모달에서 슬롯 owner를 실체 기준으로 재확정하고 `att-original-owner-teacher-id` 추적값을 도입. 일정 변경 시 구 슬롯 삭제를 owner 후보군에 대해 수행해 "수정 시 신규 일정 추가" 경로 차단 |
| 2026-03-13 | 학생관리 97차(툴팁 generic 교사키 필터: `선생님` 유령행 제외) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 타교사 툴팁 후보 중 이름 해석이 `선생님/미확인/담당 미확인`인 generic teacher key를 제외해 `미처리` 유령행 노출 경로를 추가 차단 |
| 2026-03-13 | 학생관리 96차(주담당 기준키 우선순위 보정: currentTeacher 우선) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 출석이력 주담당 분류를 `currentTeacherId` 우선으로 고정하고 정규화 순서를 보강해 owner/id 혼합 저장 계정에서 타교사 오분류 및 툴팁 `미처리` 유령행 재발 경로를 축소 |
| 2026-03-13 | 학생관리 95차(타교사 `미처리` 유령 툴팁 보정: owner/id 교사키 정규화 보강) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | `resolveKnownTeacherId` 실패 시 주담당 교사의 `owner_user_id` 동치로 teacher key를 보정하고, 스케줄 실체 없는 타교사 후보를 툴팁에서 제외해 유령 `미처리` 행 경로 차단 |
| 2026-03-13 | 학생관리 94차(출석이력 툴팁 타교사 노출 조건 정합화) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 툴팁 타교사 노출을 같은 슬롯의 `otherSchedules` 기준으로 제한해, 타교사 일정이 없는 슬롯에서 타교사가 보이던 혼선 경로를 차단 |
| 2026-03-13 | 학생관리 93차(출석 `청구됨` 오표기 수정: 상태 라벨 함수 충돌 분리) | `node --check qr-attendance.js` + `node --check js/payment.js` + `ReadLints(qr-attendance.js, js/payment.js)` | PASS | 출석 상태 유틸을 `attendance*`로 분리, 수납 상태 유틸을 `payment*`로 분리해 출석 툴팁에 수납 라벨이 섞이는 경로 차단 |
| 2026-03-13 | 학생관리 91/92차 실기기 회귀(카드 X삭제/조회400 재발) | 사용자 실기기 재현(불일치 즉시삭제 + 일치 경고삭제 + QR/이력 반복 진입) | PASS | 카드 삭제 정책 분기 정상 동작, `attendance_records GET 400` 재발 없음 |
| 2026-03-13 | 학생관리 92차(출석조회 400 재발 방지 파라미터 가드) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | `studentId/dateStr` 비정상값은 DB 조회를 생략하도록 가드 적용, 일정없음 분기 중복조회에도 동일 가드 반영 |
| 2026-03-13 | 학생관리 91차(출석기록 카드 X삭제 + 시간표 일치 경고) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 카드별 `X` 삭제 버튼 추가, 시간표 불일치 즉시삭제/일치 경고삭제 분기 반영 |
| 2026-03-13 | 학생관리 90차(출석기록 담당 선생님 배지 상시 노출) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 카드 헤더에 담당 배지를 전 슬롯 상시 노출로 전환, UUID/raw key 노출은 사용자용 라벨로 대체 |
| 2026-03-13 | 학생관리 88/89차 실기기 회귀(육효원 3/5) | 사용자 실기기 재현(미처리 변경 + 콘솔 확인) | PASS | `미처리` 변경 즉시 반영 확인, `attendance_records 400` 재발 없음 확인 |
| 2026-03-13 | 학생관리 89차(출석 조회 400 방지: 시간 필터 검증) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | `scheduled_time` 필터를 시간값만 허용하도록 제한하고, 비시간 값은 필터 생략/`is null` 분기로 처리해 PostgREST 400 재발 경로를 축소 |
| 2026-03-13 | 학생관리 88차(출석이력 `미처리` 변경 미반영 핫픽스) | `node --check qr-attendance.js` + `ReadLints(qr-attendance.js)` | PASS | 상태변경 시 `record_id/teacher_id` 힌트 우선 삭제, `scheduled_time is null` 삭제 분기, 로컬 `default` 슬롯 정리 보강 |
| 2026-03-09 | 학생관리 87차(출석기록 `미처리` 선택 시 슬롯 레코드 실삭제) | `node --check qr-attendance.js` + `node --check script.js` + `ReadLints(qr-attendance.js, script.js)` | PASS | `미처리`를 상태 보정이 아닌 DB/로컬 슬롯 삭제로 처리해 이전 테스트 레코드 잔존 경로 차단 |
| 2026-03-09 | 학생관리 86차(출석이력 슬롯 중복 레코드 우선순위 정렬) | `node --check qr-attendance.js` + `node --check script.js` + `ReadLints(qr-attendance.js, script.js)` | PASS | 동일 슬롯 중복 레코드를 교사별 대표값으로 압축(상태 우선순위+최신시각)해 시간표/이력 정합성 보강 |
| 2026-03-09 | 학생관리 85차(일정-출석 슬롯 정합성 보강: 시간키/교사키 정규화) | `node --check script.js` + `node --check qr-attendance.js` + `ReadLints(script.js, qr-attendance.js)` | PASS | 시간표 상태 조회를 정규화 조회로 통일, 출석이력 교사/시간 슬롯 분류 정규화 반영 |
| 2026-03-09 | 66차 운영 적용 상태 API 검증(출석 메타 컬럼) | `python qa-artifacts/verify_attendance_meta_columns.py` 실행 (`attendance_source/auth_time/presence_checked/processed_at` 조회) | PASS | STATUS 200 + 컬럼 4종 응답 확인 |
| 2026-03-09 | 문서 기준일 자동 동기화 스크립트 추가 | `python qa-artifacts/sync_doc_dates.py` 실행 및 기준일 3문서 일치 확인 | PASS | 다음 작업일부터 당일 날짜 자동 반영 가능 |
| 2026-03-09 | 문서 기준일 당일 정합성 보정(`plan/context/checklist`) | 세 문서 `문서 기준일` 교차 확인 및 일괄 갱신 | PASS | 기준일을 2026-03-09로 통일 |
| 2026-03-08 | 실기기 회귀 1순위 3건 검증(묶음 본인 인증/메인 진입 속도/초기 배지 집계) | 실기기 수동 점검(사용자 보고) | PASS | 1,2,3 모두 문제없음 확인 |
| 2026-03-08 | 숙제 제출 페이지 모바일 접속 불가 긴급 점검(URL 경로 확인) | 외부 접속 확인(`.../academy_manager/homework/`=200 컨텐츠, `.../academy-manager/homework/`=404, Railway `/homework/`=404) | PASS | 배포 장애 아님, 경로 오기 이슈로 확정 |
| 2026-03-08 | 학부모 포털 모바일 접속 불가 긴급 점검(URL 오기 수정) | 외부 접속 확인(`.../academy_manager/parent-portal/`=200 컨텐츠, `.../academy-manager/...`=404) + 문서 링크 수정 | PASS | 배포 장애 아님, 경로 오기 이슈로 확정 |
| 2026-03-08 | 머지 충돌 마커 긴급 복구(`script.js`, `qr-attendance.js`, `index.html`, `docs/*`) | 충돌 패턴 검색(`rg`) + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | 충돌 마커 미검출, 프론트 문법 에러 복구 확인 |
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
| 2026-03-04 | 학생관리 23차(운영 검증 SQL placeholder 오류 방지) | `STUDENT_TEST_SCORE_VERIFY.sql`, `STUDENT_SCHEMA_VERIFY.sql`, `docs/*` 수정 + 정적 검토 | PASS | `REPLACE_WITH_OWNER_UUID` 미치환 상태에서도 검증 쿼리가 안전하게 실행되도록 `nullif(... )::uuid` 파라미터 패턴으로 보강. SQL Editor 복붙 실행 시 UUID 캐스팅 오류 재발을 차단 |
| 2026-03-04 | 학생관리 24차(스키마 검증 쿼리 컬럼 호환 보강) | `STUDENT_SCHEMA_VERIFY.sql`, `docs/*` 수정 + 정적 검토 | PASS | `students.updated_at` 미존재 환경에서 검증 쿼리가 실패하던 문제를 제거하기 위해 샘플 조회 컬럼/정렬 기준을 공통 컬럼(`id`) 기반으로 수정 |
| 2026-03-04 | 학생관리 25차(운영 SQL 반영 최종 검증 결과 확정) | Supabase SQL Editor 실행 결과 확인(SETUP/UPDATE success + VERIFY 결과 테이블 확인) + 문서 동기화 | PASS | `STUDENT_TEST_SCORE_SETUP.sql`/`STUDENT_SCHEMA_UPDATE.sql` 실행 성공, 테스트 점수 정책 조회 4건 확인, 학생 스키마 샘플 조회 성공으로 SQL 운영 반영 검증을 완료 처리 |
| 2026-03-04 | 학생관리 26차(학생 목록 이력/점수 퀵 액션 추가) | `script.js`, `style.css`, `mobile.css`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 학생 목록 카드에 `이력`/`점수` 버튼을 추가해 학생 정보 수정 외에도 이력/점수 입력으로 즉시 진입 가능하게 보강. 점수 버튼은 이력 모달 오픈 후 점수 섹션 자동 포커스로 연결 |
| 2026-03-04 | 학생관리 27차(재석확인 오탐 팝업 방지: 일정 유효성 재검증) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 재석확인 팝업 오픈 전에 큐 항목의 일정 유효성(오늘 날짜/해당 시각 일정 존재)을 재확인하고 무효 항목을 즉시 제거하도록 수정. 일정 이동/삭제 직후 발생하던 "학생이 자리에 있나요?" 오탐 팝업을 차단 |
| 2026-03-04 | 학생관리 28차 준비(테스트 점수 앱 실데이터 운영 검증 범위 고정) | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 동기화 | PASS | 다음 우선 작업을 앱 실데이터 저장/조회/삭제 검증으로 고정하고, SQL 반영 완료 상태를 문서 리스크와 우선순위에 일치시키도록 정리 |
| 2026-03-04 | 학생관리 28차 실검증 1차 시도(브라우저 자동화) | 로컬 서버(`http://127.0.0.1:4173/`) 접속 후 학생관리→점수 저장/조회/삭제 시나리오 자동 실행 시도 | BLOCKED | 초기 화면이 `auth-page` 로그인 단계라 학생관리 화면 진입 불가. 운영 계정(또는 테스트 계정) 제공 후 동일 시나리오 재실행 필요 |
| 2026-03-04 | 학생관리 29차(학생용 QR 화면 종료 PIN 잠금 1차) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | QR 학생 화면 닫기 버튼에 선생님 PIN 재인증을 필수화하고, `current_teacher_id` 기반 `pin_hash` 검증이 성공할 때만 종료되도록 적용. 인증 취소/실패 시 화면 유지로 학생의 운영 화면 이탈을 차단 |
| 2026-03-04 | 학생관리 30차(재석확인 팝업 미종료 버그 수정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 팝업 자동닫힘이 "전체 대기 큐 완료" 기준이라 타 선생님/타 시간 미처리건이 있으면 창이 남음. 조치: 현재 선생님+현재 timeKey 완료 기준으로 닫힘 판정 및 큐 정리를 분리해 `출석` 처리 후 창이 정상 종료되도록 보정 |
| 2026-03-04 | 학생관리 30차 보강(재석확인 팝업 DOM 기준 보조 닫힘 판정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | `출석/지각/결석/보강` 공통 경로에서 큐 상태와 UI 상태가 순간 불일치할 때를 대비해, 팝업 내 미선택 체크박스가 없으면 닫힘 처리하도록 보강 |
| 2026-03-04 | 학생관리 31차(일정 재등록 후 `이미 출석` 오탐 보정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: QR 중복 판정에서 `scheduled_time` 미일치 시 최신 레코드 폴백을 사용해 과거 기록이 현재 수업에 매칭됨. 조치: QR 경로는 엄격한 `scheduled_time` 일치 조회(`allowScheduledFallback=false`)로 변경해 같은 시간 재등록 오탐을 차단 |
| 2026-03-04 | 학생관리 32차(하루 다중 일정 운영 점검 시나리오 정의) | 문서 3종에 A~D 시나리오(정상 다중/재등록/시간경계/임시혼합) 추가 | PASS | 다음 실기기 점검 시 동일 기준으로 PASS/FAIL을 남길 수 있도록 테스트 표준을 고정 |
| 2026-03-04 | 학생관리 33차(번호인증 `만료 QR` 오탐 보정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 전화번호 인증도 QR 토큰 검증(DB/로컬 비교)을 타면서 `만료된 QR코드` 오탐 발생. 조치: `phone_last4` 경로는 토큰 만료 검증을 스킵하고 출석 엔진만 실행하도록 분리 |
| 2026-03-04 | 학생관리 32차-시나리오 A (정상 다중 일정) | `18:00/20:00` 등록 후 18:00 스캔 | TODO | 기대: 18:00만 처리되고 20:00은 재석확인 대기(또는 후속 확인)로 남아야 함 |
| 2026-03-04 | 학생관리 32차-시나리오 B (재등록 오탐 방지) | `20:00 출석 -> 삭제 -> 20:00 재등록 -> 재스캔` | TODO | 기대: `already_processed` 오탐 없이 정상 출석 처리 |
| 2026-03-04 | 학생관리 32차-시나리오 C (시간 경계) | `19:59/20:00/20:01` 순차 스캔 | TODO | 기대: 출석/출석/지각 판정 일관 + 재석확인 팝업 정책 일치 |
| 2026-03-04 | 학생관리 32차-시나리오 D (임시출석 혼합) | 일정 미등록 임시출석 후 같은날 정규 일정 등록/스캔 | TODO | 기대: 임시출석 레코드와 정규 출석 레코드 충돌 없음 |
| 2026-03-04 | 학생관리 33차(전화번호 인증 `만료` 오탐 보정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 전화번호 인증도 QR 토큰 만료 검증을 타서 `student_code`/토큰 불일치 시 `만료된 QR코드` 오탐이 발생. 조치: `phone_last4` 모드는 토큰 만료 검증을 스킵하고 payload 토큰 fallback을 추가 |
| 2026-03-04 | 학생관리 34차(출석 판정 그레이스 2분 도입) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 수업 시작 후 2분까지를 출석으로 처리하도록 정책 반영. 2분 초과~종료 전은 지각, 종료 후는 결석으로 유지해 현장 체감과 판정 일관성을 개선 |
| 2026-03-04 | 학생관리 36차(무일정 스캔 결석/이미처리 오탐 보정) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: `absent`도 이미처리로 간주 + 일정 조회가 타 선생님 일정까지 포함되어 무일정 상황에서 결석/이미처리 오탐 발생. 조치: 처리완료 상태를 `present/late/makeup`으로 제한하고 일정 조회를 현재 선생님 기준으로 필터링 |
| 2026-03-04 | 학생관리 37차(임시출석 시간표 가시화) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 원인: 임시출석은 일정(`schedules`) 블록이 없어 시간표가 비어 보임. 조치: 시간표 상단에 `임시출석 n건` 배너를 표시해 학생명/학년을 즉시 확인 가능하게 보강 |
| 2026-03-04 | 학생관리 38차(무일정 `이미처리` 오탐 축소: 임시출석 기준) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 무일정 분기 중복판정이 넓게 적용돼 일정 기반 기록까지 `already_processed`로 오탐될 여지가 있었음. 조치: 현재 교사 기준 조회 + 임시출석 기록(`scheduled_time` 없음/임시출석 로그)일 때만 중복 차단 |
| 2026-03-04 | 학생관리 39차(무일정 `이미처리` 재오탐 추가 보정: 임시출석 쿼리/owner 필터) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 무일정 중복조회가 일반 출석/타원장 레코드까지 참조할 여지가 남아 `already_processed`가 재발할 수 있었음. 조치: 무일정 분기 조회를 `scheduled_time is null` + `owner_user_id` + `currentTeacherId`로 고정하고 공통 조회함수에도 owner 필터 추가 |
| 2026-03-04 | 학생관리 40차(무일정 스캔 정책 전환: 미처리 저장 + 자동일정 생성) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 무일정 스캔이 즉시 `출석`으로 저장되어 후속 확인 전 상태 확정이 이뤄지는 운영 혼선. 조치: 무일정 스캔을 `status=none(미처리)`로 저장하고 QR 시각 기록, 현재 시각 일정 자동 생성으로 시간표 즉시 반영 |
| 2026-03-04 | 학생관리 41차(전화번호 인증 패널 소형 숫자패드 추가) | `index.html`, `style.css`, `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 태블릿에서 번호 4자리 입력 시 가상키보드 의존으로 입력 동선이 길고 가림 이슈가 반복됨. 조치: 입력창 하단에 숫자패드(0~9/초기화/지우기)와 전용 핸들러를 추가해 터치 입력만으로 인증 가능하도록 보강 |
| 2026-03-04 | 학생관리 42차(숫자패드 확인 버튼 일체화) | `index.html`, `style.css`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 숫자패드 입력 후 상단 인증 버튼으로 다시 이동해야 하는 터치 왕복이 남아 있었음. 조치: 숫자패드 하단에 `키패드 확인` 버튼을 추가해 숫자패드 영역에서 바로 인증 실행 가능하도록 보강 |
| 2026-03-04 | 학생관리 43차(4자리 입력 즉시 자동 인증) | `index.html`, `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 숫자 4자리 입력 완료 후 추가 탭(인증)이 필요해 반복 입력 효율이 떨어짐. 조치: 입력창/숫자패드 모두 4자리 완성 시 자동 인증을 실행하고, `phoneAuthSubmitting` 가드로 중복 요청을 차단 |
| 2026-03-04 | 학생관리 44차(전화번호 인증 버튼 제거: 상단 `인증`/하단 `키패드 확인`) | `index.html`, `style.css`, `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 4자리 자동인증 도입 후 수동 인증 버튼 2개가 UI 중복/혼선을 유발. 조치: 두 버튼을 제거하고 숫자 입력 즉시 인증 흐름만 유지해 학생 화면 조작 포인트를 단순화 |
| 2026-03-04 | 학생관리 45차(전화번호 인증 대상 제한: 학생 연락처만 허용) | `qr-attendance.js`, `index.html`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 기존 로직이 학생/보호자 번호 모두 인증해 운영 정책과 불일치. 조치: 뒷자리 매칭을 학생 연락처 전용으로 변경하고 안내 문구/토스트를 동일 정책으로 동기화 |
| 2026-03-04 | 학생관리 45차 문서 보강(인계/리스크 동기화) | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 정리 + 상호 참조 확인 | PASS | 변경 이력에 44/45차를 명시하고, 학생번호 전용 인증 정책의 실기기 확인 필요 리스크를 추가해 다음 검증 포인트를 고정 |
| 2026-03-04 | 학생관리 46차(상단 제어 버튼 숨김 + 더블탭 전체화면 토글) | `index.html`, `style.css`, `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 학생이 `전체화면/카메라전환` 버튼을 탭해 화면 상태를 임의 변경할 수 있는 운영 리스크. 조치: 버튼은 학생 화면에서 숨기고 상단 제목 더블탭 제스처로만 전체화면을 전환하도록 변경, 닫기 PIN 정책은 유지 |
| 2026-03-04 | 학생관리 47차(모서리 3초 롱프레스 카메라 버튼 + 카메라전환 PIN 인증) | `index.html`, `style.css`, `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 카메라 버튼 상시 노출 시 학생 오조작 우려가 큼. 조치: 모서리 3초 롱프레스 때만 카메라 전환 버튼을 12초간 노출하고, 실제 전환 시 선생님 비밀번호를 매번 검증하도록 보강 |
| 2026-03-01 | 학생관리 48차(다중 시간대 이력 분리 + 겹침 오탐 보정) | `script.js`, `qr-attendance.js`, `docs/*` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인1: 출석 이력이 날짜 단위 1건 렌더여서 같은 날 다중 시간대가 사라진 것처럼 보임. 조치1: `날짜+시간` 슬롯 단위 렌더로 분리. 원인2: 겹침 판정에서 문자열 duration 계산 오류로 인접 시간대 오탐 발생. 조치2: duration 숫자 정규화 후 겹침 계산 |
| 2026-03-01 | 학생관리 49차(다교사 시간표 스코프 + 후속 알림 라우팅 보강) | `index.html`, `style.css`, `script.js`, `qr-attendance.js`, `docs/*` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | 시간표 상세에 `내 학생만/전체 선생님` 범위 토글을 추가하고 캘린더 배지/시간표 렌더를 스코프 기반으로 분기. 전체 보기에서 교사 배지/레이아웃 키 충돌을 보정했고, QR/번호인증 일정 조회를 전체 선생님 기준으로 확장해 후속 큐 생성을 정확화. 알림 팝업은 기존 teacher 필터를 유지해 담당 선생님에게만 노출되도록 유지 |
| 2026-03-01 | 학생관리 50차(메인 토글 상시노출 + 일정 수정 권한/메모 정책 보강) | `index.html`, `style.css`, `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 월/주간 헤더에 시간표 범위 토글을 상시 노출해 전환 접근성을 개선. 일정 소유 teacher 기준으로 수정/삭제 권한을 고정하고(본인만), 관리자만 PIN 재인증 후 예외 허용하도록 보강. 메모 안내 문구를 개인/공유 운영정책형으로 정리 |
| 2026-03-01 | 학생관리 51차(등록 일정 전체 공유 기본화) | `script.js`, `index.html`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 시간표 기본 스코프를 `all`로 전환하고 선생님 전환 시에도 `전체 선생님` 보기로 재설정되도록 고정. 메인/상세 스코프 선택 UI 기본 순서와 힌트를 공유 정책 기준으로 동기화 |
| 2026-03-01 | 학생관리 52차(시간표 선생님 라벨 UUID 노출 보정) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 선생님 이름 조회 fallback에서 `선생님(UUID)` 형태를 제거하고 사용자용 라벨(`선생님`)로 통일. 현재 로그인 선생님 ID는 세션 이름으로 보강해 전체보기 텍스트 깨짐 체감을 완화 |
| 2026-03-01 | 학생관리 53차(담당 선생님 이름 표시 보강: owner UUID 호환) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | `getTeacherNameById`에서 `teacher.id` 외 `teacher.owner_user_id` 보조 매핑을 추가하고 owner UUID 케이스를 세션 선생님명으로 2차 보정해 `선생님` 일반 라벨로 떨어지던 블록의 담당명 복원을 강화 |
| 2026-03-01 | 학생관리 54차(다중 일정 중 1건 삭제 시 타 시간대 상태 초기화 버그 보정) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 원인: 단건 삭제에서 `attendance[date]`/`records[date]` 날짜 전체를 삭제해 다른 시간대 상태까지 `미처리`로 초기화됨. 조치: 해당 시간 슬롯(`date+startTime`)만 제거하고, 남은 슬롯이 없을 때만 날짜 키 삭제 |
| 2026-03-01 | 학생관리 55차(묶음 일정 블록 담당 선생님명 복원 보강) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 묶음 블록용 선생님명 해석 함수에서 `teacher.id` 매칭 실패 시 학생 `teacher_id` 및 로컬 학생-선생님 매핑(`getAssignedTeacherId`) fallback을 추가. 그룹 라벨이 `선생님`일 때 후속 이벤트 이름으로 승격해 담당명 노출률을 개선 |
| 2026-03-01 | 학생관리 56차(타 교사 일정 조회전 관리자 인증 + 완전 보기 전용) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 타 교사 일정 클릭 시 관리자 비밀번호 인증을 추가하고, 모달을 읽기 전용으로 고정해 출석/일정/메모/삭제 편집 액션을 전면 비활성화. 권한 함수도 타 교사 편집을 관리자 포함 차단하도록 단순화 |
| 2026-03-01 | 학생관리 57차(기간/일괄 삭제 경로 소유자 가드 + 정책 문구 고정) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | `executeBulkDelete`/`executePeriodDelete` 시작 시 선생님 컨텍스트 가드를 추가하고, 확인창에 `대상: 내가 등록한 일정만` 문구를 반영해 삭제 경로에서도 소유자 전용 정책을 명확히 고정 |
| 2026-03-01 | 학생관리 58차(상태 적용 범위 팝업 제거 + 담당 선생님 단일 반영) | `script.js`, `qr-attendance.js`, `docs/*` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` | PASS | `상태 적용 범위` 선택 팝업을 제거하고 상태 변경을 현재 선생님 일정에만 즉시 반영하도록 고정. 수업 관리 모달/출석 이력 모달 모두 동일 정책으로 통일해 다교사 동시 반영 혼선을 제거 |
| 2026-03-01 | 학생관리 59차(묶음 일정 클릭 시 관리자 인증 과노출 보정) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 모달 진입 전 owner teacher id를 정규화해 legacy 식별자 혼입으로 인한 타교사 오판정을 완화. 본인 담당 학생 클릭 시 불필요한 관리자 인증 팝업 반복을 줄이고, 인증 문구의 `선생님 선생님` 중복도 제거 |
| 2026-03-01 | 학생관리 60차(묶음 규칙 보정: 교사별 분리 + 동일교사만 묶기) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 전체 보기 묶음 키를 교사 정규화 키로 전환해 동시간대 A/B 교사 일정은 분리하고, 동일 교사 동시간 다건만 묶이도록 보정. legacy teacher_id 혼입 케이스에서도 학생 매핑 fallback으로 그룹 분리를 강화 |
| 2026-03-01 | 학생관리 61차(시간표 교사 배지 가시성 강화) | `style.css`, `docs/*` 수정 + `ReadLints` | PASS | `evt-teacher` 배지를 고대비 캡슐형(그라데이션/테두리/그림자)으로 강화하고 `담당` 프리픽스를 추가해 다교사 분리 화면에서 블록 담당 교사를 더 빠르게 식별할 수 있도록 보강 |
| 2026-03-01 | 학생관리 62차(교사 수 무관 배지 색상 자동화) | `script.js`, `style.css`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 교사 식별자 해시 기반으로 배지 색상을 동적 생성해 교사 수 증가 시에도 별도 수동 매핑 없이 구분성을 유지. CSS 변수(`--evt-teacher-bg/border/shadow`)로 스타일 주입 구조를 표준화 |
| 2026-03-01 | 학생관리 63차(교사 배지 유사색 충돌 완화) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 동일 화면의 교사 배지 hue 간격(최소 각도)을 강제해 색상 유사도를 낮춤. 동일 교사는 고정색을 유지하면서도 동시 노출 교사 간 색상 충돌을 완화 |
| 2026-03-01 | 학생관리 64차(출석 완료 일정이 결석으로 재변경되는 회귀 보정) | `script.js`, `docs/*` 수정 + `node --check script.js` + `ReadLints` | PASS | 원인: `scheduled_time` 포맷(`HH:MM:SS`)과 로컬 키(`HH:MM`) 불일치로 자동 결석 경로가 기존 출석 상태를 미인식. 조치: 시간키 정규화 유틸을 추가하고 자동결석/동기화/로딩 전 구간에 적용해 이미 처리된 슬롯 덮어쓰기를 차단 |
| 2026-03-06 | 학생관리 65차(출석기록 메타 가시화: 처리방식/인증시간/자리확인/처리시간) | `qr-attendance.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `ReadLints` | PASS | 원인: 출석기록 카드가 `QR 스캔 시간` 중심으로만 보여 처리 경로(번호입력/재석확인/수동확정) 설명이 어려움. 조치: 기존 저장 필드 조합으로 처리방식/인증시간/자리확인/처리시간을 카드에 동시 표기 |
| 2026-03-06 | 학생관리 66차(출석기록 메타 DB 정규화 2단계) | `ATTENDANCE_RECORD_META_UPDATE.sql`, `SUPABASE_COMPLETE_SETUP.sql`, `qr-attendance.js`, `database.js`, `docs/*` 수정 + `node --check qr-attendance.js` + `node --check script.js` + `node --check database.js` + `ReadLints` | PASS | 조치1: 메타 컬럼(`attendance_source/auth_time/presence_checked/processed_at`) 추가 및 백필 SQL 작성. 조치2: 앱 저장 로직이 신규 컬럼 우선 저장하고 미마이그레이션 DB에서는 레거시 payload로 자동 재시도. 조치3: 이력 화면은 신규 컬럼 우선, 구형 필드 폴백으로 해석 |
| 2026-03-06 | 파일 정리 1차(66차 후속 안정성 점검) | `node --check qr-attendance.js; node --check script.js; node --check database.js` + 문서 3종 동기화 확인 | PASS | 세 파일 모두 문법 오류 없음. 코드 추가 변경 없이 정리 단계로 마감하고, 남은 작업은 운영 SQL 적용 + 실기기 회귀로 고정 |
| 2026-03-06 | 학생관리 67차(관리자 인증 시 타교사 일정 수정/삭제 허용 복원) | `script.js` 권한 분기 수정 + `node --check script.js` + 문서 3종 동기화 | PASS | 타교사 일정 진입 시 관리자 PIN 인증 성공하면 읽기전용을 해제해 상태/메모/일정변경/삭제 가능. 인증 실패/취소 시 기존처럼 차단 유지 |
| 2026-03-06 | 학생관리 68차(묶음 블록 담당 라벨 `선생님` 폴백 축소) | `script.js`(`getTeacherNameById`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | teacher id/owner id 해석을 대소문자/공백 무시로 보강하고, UUID/난독화 키가 아닌 레거시 식별자는 라벨로 유지해 묶음 블록의 `담당 선생님` 일반 표기를 줄임 |
| 2026-03-06 | 학생관리 69차(전체 일정 로드시 타교사 이름맵 동기화) | `script.js`(`loadAllTeachersScheduleData`, `getTeacherNameById`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | owner 범위 `teachers` 조회로 `teacherNameLookup`를 갱신하고 라벨 해석 우선순위에 반영해, `teacherList` 지연 시에도 묶음 블록 담당 라벨 복원률을 높임 |
| 2026-03-06 | 학생관리 70차(묶음 블록 담당 라벨 별칭 보강: `선생님A/B`) | `script.js`(`renderDayEvents`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 실제 선생님명 해석 실패 시에도 교사 키별 별칭(`선생님A/B/C...`)을 표시해 묶음 블록 간 담당 구분이 유지되도록 보강 |
| 2026-03-06 | 학생관리 70차(묶음 담당 라벨 실명 우선 복원: 학생-교사 매핑 점수화) | `script.js`(`renderDayEvents`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 묶음 멤버 학생집합을 기준으로 등록 선생님 매핑(teacher_students_mapping + student.teacher_id) 점수를 계산해 담당명을 추론하고, 이름 매칭 실패 시 별칭 fallback 전에 실명 복원을 우선 적용 |
| 2026-03-06 | 학생관리 71차(결석->출석 후 결석 역전 회귀 보정) | `script.js`(`autoMarkAbsentForPastSchedules`, `setAttendance`, `saveOnlyMemo`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 자동결석 전에 DB 최신 상태를 확인해 처리완료 상태 덮어쓰기를 차단하고, 관리자 모드 타교사 일정 편집 시 저장 `teacher_id`를 owner 기준으로 통일해 상태가 작업 후 결석으로 되돌아가는 구조 문제를 보정 |
| 2026-03-06 | 학생관리 72차(레거시 teacher key 정규화 + 자동결석 슬롯 매칭 보강) | `script.js`(`normalizeLegacyTeacherScheduleOwnership`, `autoMarkAbsentForPastSchedules`, schedule load 경로) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | `teacherScheduleData`의 미등록 teacher key를 등록 teacher id로 병합해 라벨/권한 정합성을 복원하고, 자동결석 DB 확인에서 `HH:MM`/`HH:MM:00`를 함께 조회해 시간포맷 차이로 인한 `출석->결석` 역전을 추가 차단 |
| 2026-03-06 | 학생관리 73차(묶음 라벨 실명 우선 고정 + `선생님A/B` fallback 제거) | `script.js`(`resolveKnownTeacherId`, `renderDayEvents`) 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 레거시 teacher key를 렌더 단계에서 등록 teacher id로 즉시 해석하고, 묶음 라벨의 별칭 fallback(`선생님A/B`)을 제거해 등록 선생님명 우선 정책을 강화. 복원 실패 시 `담당 미확인`으로 명시 |
| 2026-03-06 | 학생관리 74차(출석 역전 재발 차단: 날짜동기화 병합 + 결석 그림자 정리) | `script.js`, `qr-attendance.js` 수정 + `node --check script.js` + `node --check qr-attendance.js` + `ReadLints` + 문서 3종 동기화 | PASS | 날짜별 출석 보강 조회를 owner 전체 teacher 병합으로 확장하고 슬롯 중복 상태를 우선순위/최신시각으로 통합. 관리자 모드 타교사 저장 시 남아 있던 과거 결석 그림자 레코드를 조건부 정리해 `출석->결석` 재역전 경로를 추가 차단 |
| 2026-03-06 | 학생관리 75차(단건 조회 우선순위 + 메모저장 결석 강제저장 차단) | `qr-attendance.js`, `script.js` 수정 + `node --check qr-attendance.js` + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 단건 조회 다중 레코드에서 `maybeSingle` 복수결과를 `teacher_id 일치 > scheduled_time 일치 > 상태 우선순위 > 최신시각`으로 점수화 선택하고, fallback 조회도 동일 규칙으로 통일. 메모 저장 시 `absent` 강제 업서트를 제거해 재역전 가능성을 추가 축소 |
| 2026-03-06 | 학생관리 76차(묶음 담당 라벨 미복원 보정 + `담당 담당` 중복 제거) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 라벨 해석 실패 시 멤버 후보(`member.teacherId`, `student.teacher_id`, 배정 teacher)를 재해석해 다수결로 실명 복원을 보강하고, 모달 owner 해석 우선순위 fallback을 추가해 모달/블록 불일치를 줄임. 최종 폴백은 `미확인`으로 조정해 배지 접두어 중복 문구를 제거 |
| 2026-03-06 | 학생관리 77차(시간표 렌더 중단 긴급복구: 라벨 fallback 참조 오류) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | `resolveTeacherNameByModalPolicy`가 함수 내부에서 미정의 `ev`를 참조해 `renderDayEvents`가 중단되던 문제를 수정. 이벤트 객체를 인자로 받도록 함수/호출부를 정정해 시간축/일정 블록 미표시 현상 복구 |
| 2026-03-06 | 학생관리 78차(출석 재역전 보강: 초기 동기화 범위/병합 규칙 수정) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | `loadAndCleanData` 출석 동기화를 current teacher 필터에서 owner 전체 조회로 변경하고, 동일 슬롯 병합을 상태 우선순위(`present/late/makeup > absent > none`) + 동률 최신시각으로 보강해 결석 그림자 레코드 역선택 가능성을 축소 |
| 2026-03-06 | 학생관리 79차(로그 분석 기반 핫픽스: owner 전체 조회 필터 명시 지원) | `database.js` 수정 + `node --check database.js` + `ReadLints` + 문서 3종 동기화 | PASS | `getAttendanceRecordsByOwner(null)`이 내부 fallback으로 현재교사 필터를 타던 문제를 수정. `undefined`일 때만 현재교사 fallback, `null/''`은 owner 전체 조회로 명시 처리해 동기화 필터 오동작을 제거 |
| 2026-03-06 | 학생관리 80차(묶음 일정 재역전 보강: 자동결석 비교/그림자 정리 확장) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 자동결석 사전확인을 owner teacher + owner 전체 조회 병합(상태 우선순위+최신시각)으로 보강하고, stale absent 정리 대상을 owner teacher 외 전체 teacher_id로 확장해 묶음 일정의 `출석->결석` 재역전 경로를 추가 차단 |
| 2026-03-06 | 학생관리 82차(묶음 일정 저장 슬롯 가드: owner 슬롯 강제 보정) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | `setAttendance/saveOnlyMemo` 저장 직전에 `resolveAttendanceSlotStartTime`으로 owner teacher 슬롯을 재확인해 `scheduled_time` 오저장을 방지. 묶음 일정에서 상태/메모가 다른 시간 슬롯으로 기록되며 재역전되는 경로를 추가 차단 |
| 2026-03-06 | 학생관리 82차(자정 넘김 수업 자동결석 판정 보정) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 자동결석 판정을 날짜 단순비교에서 실제 수업 종료시각(`dateStr+startTime+duration`) 기준으로 변경해 23:30~01:10 같은 야간 묶음 수업의 조기 결석 처리 경로를 차단 |
| 2026-03-06 | 학생관리 83차(묶음 일정 재현 로그 보강) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 상태 저장/자동결석 write 지점에 `[ATT-BOX]` 로그를 추가해 `teacherId/scheduledTime/status` write 순서를 즉시 추적 가능하게 보강 |
| 2026-03-06 | 학생관리 81차(묶음 일정 owner/start 정합성 보강) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 묶음 모달 진입 시 owner/slot 재매칭과 시간키 정규화 비교를 적용해 `23:30` 클릭이 `18:00` 등 다른 슬롯으로 저장되는 경로를 차단 |
| 2026-03-06 | 학생관리 81차(묶음 일정 owner 폴백 수정: 현재교사 강제치환 제거) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | `resolveOwnerTeacherIdForModal`에서 known teacher 미해석 시 currentTeacherId로 강제치환되던 fallback을 제거하고, 슬롯 일치 owner를 우선 유지하도록 보강해 묶음 일정 저장 `teacher_id` 불일치를 완화 |
| 2026-03-01 | 학생관리 84차(일정 삭제 시 출석기록 동시 삭제) | `script.js` 수정 + `node --check script.js` + `ReadLints` + 문서 3종 동기화 | PASS | 단건/기간/기간별 일정 삭제 경로에서 같은 시간 슬롯 출석기록(DB/로컬 캐시)도 함께 정리하고, 기간 삭제는 DB `schedules` 슬롯 조회 기반으로 동일 슬롯만 정밀 삭제해 타기기 생성 레코드까지 정리 |
| 2026-03-01 | 학생관리 84차 후속 안정화 점검(커서 불안정 재확인) | `node --check script.js` + `ReadLints(script.js)` + 삭제 확인문구/삭제경로 코드 재대조 | PASS | 일정 삭제 시 출석 동시삭제 정책 문구가 `단건/기간/기간별` 경로에 일치하고, 정적 검증 결과 오류 없음 |

## 학생관리 58~64차 실기기 회귀 결과 템플릿 (복붙용)
- 아래 1줄을 복붙해서 PASS/FAIL만 채워 주세요.
`58: PASS/FAIL (상태범위 팝업 제거/담당선생님 단일반영) | 59: PASS/FAIL (묶음 블록 관리자 인증 과노출 보정) | 60: PASS/FAIL (동시간대 타교사 분리+동일교사 묶음) | 61: PASS/FAIL (교사 배지 가독성) | 62: PASS/FAIL (다교사 색상 자동화) | 63: PASS/FAIL (유사색 충돌 완화) | 64: PASS/FAIL (출석완료 후 결석 재변경 없음)`
- 예시
`58: PASS (담당선생님 일정만 즉시 반영) | 59: PASS (본인학생 클릭 시 인증 팝업 없음) | 60: PASS (A/B 분리, A동시간 2건 묶음) | 61: PASS (태블릿에서도 배지 식별 양호) | 62: PASS (5명 동시 노출 색상 구분됨) | 63: PASS (비슷한 색상 체감 없음) | 64: PASS (새로고침/재진입 후에도 출석 유지)`

## 학생관리 58~64차 실기기 점검 순서 (1->7)
1) **58차**: 다교사 학생 상태 변경 시 `상태 적용 범위` 팝업이 뜨지 않고 현재 담당 선생님 일정만 즉시 반영되는지 확인
2) **59차**: 묶음 블록에서 본인 담당 학생 클릭 시 관리자 인증 없이 열리고, 타교사 학생 클릭 시에만 관리자 인증이 뜨는지 확인
3) **60차**: 같은 시간에 A/B 교사 일정은 분리되고, 같은 교사의 동시간 다건은 1개 묶음 블록으로 보이는지 확인
4) **61차**: 태블릿/PC에서 교사 배지(담당 라벨) 글자/대비가 충분히 읽히는지 확인
5) **62차**: 교사 5명 이상 동시 노출 시에도 배지 색이 자동으로 구분되고 텍스트 대비가 유지되는지 확인
6) **63차**: 같은 화면에서 서로 비슷한 교사 배지 색이 과도하게 겹치지 않는지 확인
7) **64차**: 출석 또는 지각 처리 후 자동타이머, 재진입, 새로고침을 거쳐도 상태가 결석으로 바뀌지 않는지 확인
- 결과 보고 형식(복붙): 위 템플릿 1줄 + 실패 시 재현 순서 1줄(학생/시간/교사/기기/브라우저)

## 학생관리 32차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`A: PASS/FAIL (메모) | B: PASS/FAIL (메모) | C: PASS/FAIL (메모) | D: PASS/FAIL (메모)`
- 예시
`A: PASS (18:00 처리, 20:00 대기 확인) | B: FAIL (재등록 후 still already_processed) | C: PASS (19:59/20:00 출석, 20:03 지각) | D: PASS (임시출석과 정규출석 충돌 없음)`

## 학생관리 71차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`71: PASS/FAIL (결석->출석 변경 후 시간수정/메모저장/재진입/새로고침/수업종료 이후에도 출석 유지 여부)`
- 예시
`71: PASS (결석->출석 변경 후 시간수정/메모저장/재진입/새로고침/수업종료 경과 모두 출석 유지)`

## 학생관리 74차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`74: PASS/FAIL (묶음 일정/관리자모드에서 결석->출석 변경 후 재진입/자동타이머 이후에도 출석 유지 + 담당라벨 실명 표시 여부)`

## 학생관리 75차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`75: PASS/FAIL (묶음 일정/관리자모드에서 결석->출석 변경 후 메모저장/재진입/자동타이머 이후에도 결석 재역전 없음)`

## 학생관리 76차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`76: PASS/FAIL (동일 담당 묶음 블록에서 담당 라벨이 등록 선생님명으로 표시되고 '담당 담당 미확인' 중복 문구가 사라졌는지)`

## 학생관리 77차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`77: PASS/FAIL (전체 선생님 보기에서 시간축/일정 블록이 정상 렌더되고, 검색/스크롤/묶음라벨이 함께 정상 동작하는지)`

## 학생관리 78차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`78: PASS/FAIL (묶음 일정/타교사 수정에서 결석->출석 변경 후 재진입/새로고침 시 결석 재역전이 없는지)`

## 학생관리 79차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`79: PASS/FAIL (결석->출석 변경 후 강력새로고침 시 owner 전체 동기화가 적용되어 결석으로 재역전되지 않는지)`

## 학생관리 80차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`80: PASS/FAIL (묶음 일정에서 결석->출석 변경 후 메모저장/재진입/새로고침/자동타이머 이후에도 결석 재역전이 없는지)`

## 학생관리 81차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`81: PASS/FAIL (묶음 일정 모달 진입 시 owner teacher가 현재교사로 강제치환되지 않고, 상태 저장 teacher_id가 실제 일정 owner와 일치하는지)`

## 학생관리 82차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`82: PASS/FAIL (묶음 일정에서 상태/메모 저장 후 콘솔 startTime/DB scheduled_time이 실제 슬롯으로 유지되고, 23:30~01:10 같은 자정 넘김 수업에서 종료시각 전 재역전 없이 종료시각 이후에만 자동결석 동작하는지)`

## 학생관리 83차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`83: PASS/FAIL (재역전 재현 시 [ATT-BOX][persist][write]와 [ATT-BOX][autoAbsent][write] 로그 시간순서가 캡처되고, 마지막 absent write 경로를 특정할 수 있는지)`

## 학생관리 84차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`84: PASS/FAIL (일정 단건삭제/기간삭제/기간별삭제 후 출석기록에서도 같은 날짜·시간 슬롯 기록이 함께 삭제되고, 재진입/새로고침 후에도 복원되지 않는지)`

## 학생관리 66차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`66: PASS/FAIL (QR/번호입력/수동/임시/재석확인 경로에서 출석기록 카드의 처리방식/인증시간/자리확인/처리시간이 DB 값과 일치하는지)`
- 상세 보고 템플릿(선택)
`QR: PASS/FAIL (메모) | 번호입력: PASS/FAIL (메모) | 수동: PASS/FAIL (메모) | 임시: PASS/FAIL (메모) | 재석확인: PASS/FAIL (메모)`
- 실패 시 필수 기록
`실패경로/학생/날짜/시간/교사/기기/브라우저 + 화면값/DB값 차이 1줄`

## 학생관리 85차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`85: PASS/FAIL (시간표 일정 상태와 출석기록 카드 상태/시간이 같은 슬롯 기준으로 일치하는지 - 다중시간대/레거시 교사키 케이스 포함)`
- 실패 시 필수 기록
`실패경로/학생/날짜/시간/교사/기기/브라우저 + 시간표표시값/출석기록값/DB값 차이 1줄`

## 학생관리 86차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`86: PASS/FAIL (3/5 재현 케이스에서 시간표 상태와 출석기록 카드/툴팁 상태가 같은 슬롯 기준으로 일치하는지)`
- 실패 시 필수 기록
`학생/날짜/시간슬롯/교사 + 시간표값/카드값/툴팁값/DB값 차이 1줄`

## 다음 체크 순서 (2026-03-13 기준)
1) `86` 실기기 회귀
2) `85` 실기기 회귀
3) `66` 실기기 회귀

## 학생관리 87차 결과 입력 템플릿 (복붙용)
- 아래 1줄을 복붙해서 결과만 수정
`87: PASS/FAIL (육효원 3/5 케이스에서 출석기록을 미처리로 바꿀 때 슬롯 레코드가 실제 삭제되고, 시간표/출석기록이 재진입 후에도 일치하는지)`
- 실패 시 필수 기록
`학생/날짜/시간슬롯/교사 + 삭제직후값/재진입값/DB잔존레코드 여부 1줄`

## 릴리즈 전 최종 확인
- [x] 치명 이슈 없음
- [x] 미해결 이슈는 `context.md`에 기록
- [x] 다음 액션이 `plan.md`에 반영됨

## 2026-03-08 로컬 환경설정 체크
- [x] `grading-server/.env`에 `SUPABASE_URL` 실제 프로젝트 값 반영
- [x] `grading-server/.env`에 `SUPABASE_SERVICE_KEY` 서버용 시크릿 키 반영
- [x] 백엔드 실행 확인(`python main.py`) 및 `/health` 200 응답 확인

## 2026-03-08 운영 SQL 반영 점검(API 기반)
- [x] `attendance_records` 메타 컬럼(`attendance_source/auth_time/presence_checked/processed_at`) 조회 성공(200)
- [x] `students` 확장 컬럼(`guardian_name/enrollment_start_date/enrollment_end_date`) 조회 성공(200)
- [x] `student_test_scores` 핵심 컬럼(`exam_name/exam_date/score/max_score`) 조회 성공(200)
- [x] `expense_ledgers` 세무 컬럼(`supply_amount/vat_amount/evidence_type/evidence_number`) 조회 성공(200) - `EXPENSE_LEDGER_SETUP.sql` 운영 반영 확인

## 2026-03-08 묶음 일정 관리자 인증 오탐 보정
- [x] `script.js` 모달 진입 분기에 owner id 정규화(`resolveKnownTeacherId`) 반영
- [x] 본인 일정 보조 판별 함수(`isScheduleOwnedByCurrentTeacher`) 추가
- [x] 2차 보정: 슬롯 owner 재해석(`resolveScheduleOwnerTeacherId`) + 학생 담당교사 기대치(`resolveExpectedOwnerTeacherIdForStudent`) 반영
- [x] 3차 보정: 슬롯 owner 후보 전체 조회(`getScheduleOwnerCandidatesBySlot`) + owner 비교 정규화(`normalizeTeacherIdForCompare`) + owner 미해석 케이스 본인 일정 최종 보정 반영
- [x] 4차 보정: 묶음/단일 클릭에서 모달로 전달하는 owner를 그룹 키가 아닌 실제 owner(`member.ownerTeacherId`) 우선으로 고정
- [x] 5차 보정: 모달 권한 판정에 owner 라벨 힌트(`ownerTeacherNameHint`) 기반 최종 본인 보정 추가
- [x] 6차 보정: 모달 라벨 힌트를 `getTeacherNameById(ownerId)` 대신 화면 배지 라벨(`resolveTeacherLabelForEvent`)로 통일 전달
- [x] 6차 보정: 관리자 인증 분기 진입 디버그 로그 추가
- [x] 7차 보정: owner 판정을 라벨 힌트 의존에서 슬롯 owner 후보 정규화 우선 정책으로 일원화
- [x] 7차 보정: `getScheduleOwnerCandidatesBySlot`에서 정규화 owner 후보까지 포함 수집
- [x] 7차 보정: 묶음 멤버 owner를 canonical teacher id 우선으로 저장
- [x] 8차 보정: 모달 owner fallback의 `currentTeacherId` 제거(뷰어 의존 차단)
- [x] 8차 보정: 라벨 후보 계산에서 `currentTeacherId` 제거
- [x] 8차 보정: `resolveTeacherIdByExactName` 추가 + 묶음/단일 클릭 owner 전달에 라벨->id(유일매칭) 보강
- [x] 8차 보정: 모달 owner 확정 시 슬롯 후보와 owner 라벨 id 교차검증 추가
- [x] 정적 점검: `ReadLints(script.js)` 오류 없음
- [x] 정적 점검: `node --check script.js` 통과
- [x] 실기기 회귀: 본인 담당 묶음 일정 클릭 시 관리자 인증 없이 진입되는지 확인
- [x] 실기기 회귀: 타교사 묶음 일정 클릭 시에는 기존대로 관리자 인증이 뜨는지 확인
- [x] 실기기 재현 케이스 확인: `육효원/조민준`, `2026-03-03`, `23:30~01:10`, 담당 `전재윤` 클릭 시 관리자 인증 미노출 확인

## 2026-03-08 `maybeSingle` 로그 노이즈 보정
- [x] `qr-attendance.js`에서 `maybeSingle` 에러 후 재조회 분기 추가(0건/1건/복수건 구분)
- [x] 0건 케이스 경고 로그 제거(정상 fallback 경로 유지)
- [x] 복수건 케이스만 경고 로그 + 우선순위 선택 유지
- [x] 정적 점검: `ReadLints(qr-attendance.js)` 오류 없음
- [x] 다교사(owner 전체) 조회에서 teacher_id가 다른 다건은 중복 경고 생략, 동일 teacher_id 다건만 경고하도록 조건 축소

## 2026-03-08 공휴일 API 키 반영
- [x] 루트 `.env.local` 생성
- [x] `DATA_GO_KR_API_KEY` 설정
- [x] 루트 `env.local` 생성(dotfile 미서빙 환경 대응)
- [x] 브라우저 강력 새로고침 후 공휴일 경고 로그 미출력 확인

## 2026-03-08 공휴일 키 로더 레이스 보정
- [x] `fetchPublicHolidays` 키 조회를 `window.DATA_GO_KR_API_KEY` + `window.env.DATA_GO_KR_API_KEY` 병행 조회로 보강
- [x] 키 미검출 시 180ms 지연 후 1회 재확인 로직 추가
- [x] `index.html` env 로더를 `.env.local` + `env.local` 순차 로드로 보강
- [x] 정적 점검: `ReadLints(script.js)` 오류 없음
- [x] 실기기/브라우저 재확인: 강력 새로고침 후 공휴일 키 미설정 경고가 재발하지 않는지 확인

## 2026-03-08 선생님 선택 -> 메인 진입 속도 보정
- [x] 병목 분석: `setCurrentTeacher` 내 직렬 `await`(전체 일정 로드/자동결석)로 첫 렌더 지연 확인
- [x] 구조 보정: 초기 렌더(메인 전환/캘린더) 우선, 무거운 동기화는 백그라운드 실행으로 이관
- [x] 성능 계측 로그 추가: `[setCurrentTeacher][perf] first-render/background-complete`
- [x] 2차 최적화: 캘린더 날짜 셀별 요약 반복 계산을 화면 범위 1회 선계산(`buildCalendarSummaryMap`)으로 전환
- [x] 3차 보정: 전체범위 일정 로딩 상태 플래그(`allScopeScheduleHydrated/loading`) 도입 + 초기 오집계 숫자 노출 방지(`집계중` 배지)
- [x] 3차 보정: owner 정규화에서 `owner_user_id` 다중 매칭 시 단일 teacher로 강제 수렴하지 않도록 보정(`resolveKnownTeacherId`)
- [x] 4차 보정: 전체범위 hydration 패스 카운트(`allScopeHydrationPassCount`) 도입, 2회 패스 전 집계 확정 금지
- [x] 4차 보정: 1차 패스 완료 후 자동 재동기화(지연 재호출) 추가
- [x] 5차 보정: 전체범위(`all`)는 메인 첫 렌더 전 `loadAllTeachersScheduleData` 완료 대기로 전환(정확성 우선)
- [x] 5차 보정: hydration 2패스/자동 재호출 로직 제거, 단일 확정 로드 기준으로 단순화
- [x] 6차 보정: 학생 컨텍스트 기반 teacher id 재해석 함수(`resolveTeacherIdFromStudentContext`) 추가
- [x] 6차 보정: `loadTeacherScheduleData`에 owner 전체 보강 조회를 추가해 레거시/미배정 혼합 데이터 누락 슬롯 보정
- [x] 6차 보정: `loadAllTeachersScheduleData`에서 teacher key 정규화(`resolveKnownTeacherId -> student context -> raw`) 적용
- [x] 6차 보정: `getTeacherNameById` owner 매칭을 단일 매칭에만 허용(다중 owner 임의 수렴 차단)
- [x] 정적 점검: `node --check script.js` 통과
- [x] 정적 점검: `ReadLints(script.js)` 오류 없음
- [x] 실기기 검증: 선생님 선택 후 메인 캘린더가 체감상 즉시 표시되는지 확인
- [x] 실기기 회귀: 백그라운드 동기화 완료 후 전체 선생님 보기/자동결석 타이머 동작 이상 없는지 확인
- [x] 실기기 회귀: 월간 뱃지 인원수/툴팁(학생명·교사명) 표시 정확성 유지 확인
- [x] 실기기 회귀: `3/3`, `3/5`에서 초기 배지가 오집계(1명) 없이 `집계중 -> 정확명수`로 전환되는지 확인
- [x] 실기기 회귀: `육효원/조민준`, `23:30~01:10`, 담당 `전재윤` 본인 클릭 시 관리자 인증 미노출 확인
