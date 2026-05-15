# 출석관리앱 체크리스트

- 문서 기준일: 2026-05-16
## 문의 답변 처리
- [x] 메인 앱 콘솔 빨강/노랑 완화(2026-04-04): `index.html`(env는 루프백만 fetch·비밀번호 구간 `<form>`·`autocomplete`/숨은 `username`·복구·선생님 비번 변경·강제초기화·선생님 인증 모달), `script.js`(`unload` 제거·username 동기화·`openModal` teacher-password), `auth.js`(`initializeAuth` debug·`openAdminPasswordUpdateModal` 이메일→username), `qr-attendance.js`(QR 모달)
- [x] 숙제·학부모 관리자 로그인(2026-04-04): `homework/index.html`·`parent-portal/report.js`·`parent-portal/index.html` — `auth.flowType: pkce`, `normalizeSupabaseProjectUrl`(오타 호스트 교정), 인증 실패·`teachers` 없음 메시지 구분, 관리자 모달 `<form>` 래핑 · `node --check parent-portal/report.js` 권장
- [x] 학부모/숙제 env·선생님 인증(2026-04-05): `parent-portal`·`homework` — `env.local` 단일 fetch·로더 1회·`academy_skip_local_env_fetch` 스킵·선생님 인증 `<form>`(`report.js` username 동기화)
- [x] 학부모 포털 점수 탭 제거(2026-04-05): 탭은 출결·숙제·종합평가만 — `parent-portal/index.html`, `parent-portal/report.js` · `node --check parent-portal/report.js` PASS
- [x] 선생님 등록 이메일 직접 입력·채점관리 원장 UUID 통일(2026-04-05): `index.html`·`script.js`(등록 폼)·`grading/index.html`(`gradingOwnerId`·jjyown 이메일 폴백·세션 `owner_user_id`)·`grading-server`(선택 `GRADING_CANONICAL_OWNER_USER_ID`) · `node --check script.js`·`python -m compileall grading-server` PASS · Railway env·재배포 후 채점 로그인 스모크 권장
- [x] 관리자·선생님 로그인 Enter(2026-04-04): `#login-password`→`signIn()`, `#teacher-select-password`→`confirmTeacher()` — `index.html`
- [x] 로그인 Enter 체감 속도(2026-04-05): 비밀번호 `onkeydown` 제거(이중 호출 방지)·`signIn`/`confirmTeacher` in-flight 가드·`showMainApp` 로그인 직후 `users.role` 생략·`loadTeachers` 재시도 180ms — `index.html`, `auth.js`, `script.js` · `node --check` PASS
- [x] 즉시 채점 연결 오류(2026-04-05): `gradingOwnerId` 재귀 버그·로컬에서 `shouldTryRemote`로 즉시 채점 차단 제거 — `grading/index.html`
- [x] 즉시 채점 UI 이관(2026-04-05): `homework/index.html` 플로팅 제거·`grading/index.html` 상단「교재 관리」우측 버튼·`openInstantGradeCamera` — 실기기 `/api/grade` 스모크 권장
- [x] 즉시 채점 고도화(2026-04-05): 다중 이미지 드래그·교재 선택·폴더명·`mode=instant`·Drive `즉시채점/년/월/일/이름` — `grading/index.html`, `grading-server`(grade·results·drive·config)·백그라운드 시작 토스트 수정 · Railway 재배포 후 스모크
- [x] 채점관리 로그인(2026-04-05): 선생님 선택 UI 제거·비밀번호만·입장 계정 자동(원장·jjyown·단일·첫 행)·세션 복원 시 `gradingLoginTeacher` 정렬 — `grading/index.html`
- [x] 메인→채점관리 동선(2026-04-05): 메뉴「채점 관리」클릭 시 새 탭 대신 **같은 창** `grading/` 이동 — `js/payment.js` `openGradingPage`
- [x] 채점관리 자동 입장(2026-04-05): `session-open`·`tryAutoEnterGrading`·로그아웃 시「다시 입장」·OPEN 비활성 시 PIN 폴백 — Railway 재배포·공개 배포 시 `GRADING_ALLOW_OPEN_GRADING_SESSION` 검토
- [x] Railway 로그 CSV 분석 + 고아 제출 복구(2026-04-05): `homework_submissions.updated_at` 미존재로 400 → `grading-server/main.py`에서 `created_at` 사용 · 재배포 후 기동 시 `[Recovery]` 로그 스모크
- [x] 채점 확정 게이트 1단계(2026-04-05): AI 완료 시 `grading_results.status` 항상 `review_needed` · `PUT /api/results/{id}/confirm` 시 `homework_submissions.grading_status` → `confirmed` 동기화 · `_recalculate_result_totals`·재채점 완료 시 자동 확정 제거 — `grading-server/routers/grading.py`, `results.py` · `python -m compileall grading-server` · Railway 재배포 후 확정 동선 스모크
- [x] 채점 확정 게이트 2단계(2026-04-05): **숙제 제출 연결 건** — AI 중 채점본 Drive 업로드 생략 · **확정 시** ZIP 재처리+`grading_items`로 이미지 생성·업로드(`confirm_drive_publish.py`) · Supabase에 `SUPABASE_GRADING_CONFIRM_DRIVE_20260405.sql` 적용 필수 · 즉시 채점(제출 ID 없음)은 기존처럼 AI 중 업로드
- [x] `GET /api/results` 500: `homework_submissions`에 없는 `zip_drive_id` 컬럼 select 제거(2026-04-06) · `results.py`, `confirm_drive_publish.py` · Railway 재배포
- [x] 채점 상세 문항 그리드: 빈 안내 문구 세로 깨짐 수정 — `.question-grid-empty` 전열 spanning(2026-04-06) · `grading/index.html`
- [x] 숙제 채점 상세: `GET /api/results`에 ZIP Drive URL·file id 병합 + 미리보기 404 시 세션 토스트·Drive 링크(2026-04-06) — 구버전 서버에서도 원본 열기 가능 · `results.py`, `grading/index.html`
- [x] 숙제 채점 상세: 확정 전 원본 미리보기 API + 과제 검토 UI(2026-04-06): `GET /api/results/{id}/source-pages-count`·`source-image/{i}` · ZIP 캐시 10분 · `central_drive_file_id` 재채점 폴백 · `grading/index.html` 과제 검토·문항 빈 안내 — **Railway 재배포** 후 스모크
- [x] 재석확인(출석) 알림 모달 제거(2026-04-07): `attendance-check-modal` DOM 삭제 + 재석확인 큐/팝업/스누즈 no-op — `index.html`, `qr-attendance.js`
- [x] 채점 확정 게이트 3단계(2026-04-05): 학생·학부모 화면에서 확정 채점 이미지·점수·문항(`GET /api/public-portal-grading/...` + `grading_status`·세션 인증코드) · 관리자 모드는 채점 블록 생략 · 운영 시 `CORS_ORIGINS`·Railway 스모크 권장
- [x] 월간 학원 일정 글자색(2026-04-04): `style.css`에서 `.grid-cell.custom-holiday .holiday-name`의 `color !important` 제거 — 줄별 인라인 색 복구
- [x] 월간 캘린더 「집계중」 고착(2026-04-04): `loadAllTeachersScheduleData` finally에 `renderCalendar(true)` — 디바운스 렌더×로딩 플래그 경합 제거; `_generateScheduleCore`/`updateClassTime`/`setTimetableScope` 보강
- [x] 선생님 선택→메인 체감 속도(2026-04-04): `loadAndCleanData`∥`fetchSchedulesForOwnerPaged`, owner `schedules` 단일 패치→`loadAllTeachersScheduleData(prefetched)` + `skipOwnerPagedHydrate`, `autoMarkAbsentForPastSchedules`는 idle 지연·이중 rAF로 100ms 제거
- [x] 과거 기기 ZIP 참고 범위(2026-04-03): **일정 데이터** 동기화가 아니라 일정관리 **코드·진입 동선** 참고 — 현재 `schedules`/스키마와 예전 일정은 다를 수 있음
- [x] Supabase에서 숙제 배정/제출/채점 기록 확인 테이블 위치 정리(2026-04-03)
- [x] 숙제 달력·상태: `schedules` 폴백 제거, 마감은 `grading_assignments`/`/api/homework-assignments`만 사용(2026-04-03, `parent-portal/report.js`, `homework/index.html`)
- [x] Vercel 관리자 로그인 400·메인 캘린더 일정 누락(2026-04-03): `supabase-config.js` `flowType: pkce`, `script.js` 전체 선생님 요약 빈 맵 제거·`loadAllTeachersScheduleData` finally 정리, `index.html` `__envLoadPromise`
- [x] 메인 캘린더 일정 누락 보강(2026-04-03): `start_time` NULL→`09:00` 보정, `schedules` 조회 1000행 페이지네이션(`fetchSchedulesForOwnerPaged`, `getSchedulesByTeacher`)
- [x] 메인 캘린더 일정 누락 보강 2차(2026-04-03): `getActiveStudentsForTeacher` 일정 전용 학생 합성, 날짜 키 정규화, `getTeacherIdsForTimetableScope`+`teacherList`
- [x] 메인 캘린더 일정 누락 보강 3차(2026-04-03): `normalizeScheduleDateKey` ISO·날짜시간→로컬 YYYY-MM-DD, 퇴원/휴원+종료일 미입력 학생 목록 포함·`shouldShowScheduleForStudent` 정규화 비교
- [x] 선생님 선택 시 배정 학생(2026-04-03): `setCurrentTeacher` 2~3단계를 `getAssignedStudentIdsForTeacher`로 통일(로컬 매핑만 보던 경로 제거)
- [x] 메인 캘린더 일정 누락 보강 4차(2026-04-03): `loadAllTeachersScheduleData`에서 `otherTeachers[currentTeacherId]`→`teacherScheduleData` 합집합 병합(`mergeScheduleBucketsIntoTeacherScheduleData`)·`finally`에서 `refreshCurrentTeacherStudents`
- [x] Supabase 운영 점검 SQL(2026-04-03): `qa-artifacts/supabase_calendar_schedule_check.sql` — RLS·월별·teacher별·고아·출석만 있는 날
- [x] 메인 캘린더 일정 소실 회귀(2026-04-03): `setCurrentTeacher`에서 `loadAllTeachersScheduleData` 병렬 시작 제거·`loadTeacherScheduleData` 이후 순차
- [x] `setCurrentTeacher` 자동결석·미스캔(2026-04-04 갱신): `scheduleKstMidnightAutoAbsent`·`initMissedScanChecks`는 `MAIN_APP` **전** — `autoMarkAbsentForPastSchedules`는 **첫 렌더 후 idle**(진입 속도). 구 ZIP 전부 진입 전이었으나 2026-04-04에 분리
## 공통 품질 체크
- [x] 교재 상세 페이지 화살표/북마크 가시성 보강(2026-04-01): `grading/index.html`에서 `.kd-pages-wrap` 높이(일반/영역모드)를 재조정하고 `ensureKdPreviewControlsVisible()`를 추가해 `toggleRegionMode`/`renderKdPageImages` 시 `#kd-page-nav`/`#kd-bookmarks` 표시를 재보정
- [x] 교재 상세 영역 표시 UX(2026-04-01): `grading/index.html`에서 영역 표시 모드(`kdRegionMode`) 중에도 드래그 팬을 유지하고 클릭 임계값 기반으로만 마킹 처리, 하단 페이지 네비게이션 `.image-nav` z-index 보강으로 앞/뒤 이동 버튼 접근성 개선
- [x] 채점 삭제 버튼 터치 전파 차단(2026-03-31): `grading/index.html` 결과 행 클릭을 `handleResultRowClick`으로 게이트하고, 삭제 버튼에 `pointerdown/mousedown/touchstart` 전파 차단을 추가해 모바일/버셀 환경에서 휴지통 터치 시 상세로 이동하지 않도록 보강
- [x] 채점 결과 삭제 Supabase 동기화(2026-03-31): `grading-server/routers/results.py`에서 `DELETE /api/results/{id}` 성공 판정을 안정화하고, 연결된 `homework_submission_id`의 `homework_submissions.grading_status`를 `pending`으로 복구. `grading/index.html` `deleteResult`는 `res.ok + success` 기준 처리 및 삭제 후 `await loadResults()`로 UI 동기화
- [x] 채점관리 탭 반응속도 1단계(2026-03-31): `grading/index.html` 요청 경합 제어(`loadResults`/`loadHomeworkMonthForSelected` 최신 요청 우선), 제출 월 조회 캐시(TTL 15초), 진행률 폴링 조건부 실행(`main+homework-mgmt+visible`, 5초), 의도된 `AbortError` 로그 레벨 하향(`debug`)
- [x] QR 전화번호 인증 입력창 소프트 키패드 차단(2026-03-31): `#qr-phone-last4-input`을 `readonly` + `inputmode=none` + `onfocus=blur`로 변경하고 `submitPhoneAttendanceAuth`의 입력 포커스 제어를 `blur`로 통일해, 태블릿에서 입력칸 터치 시 시스템 키패드가 뜨지 않고 화면 숫자 키패드만 사용되도록 조정
- [x] 숙제 제출 `upload-homework` 학생 인증(2026-03-30): Edge에 `student_code` 검증 경로 추가·`homework/index.html` Form 전달 · **`supabase functions deploy upload-homework`** 후 학생 경로 제출 스모크 필수
- [x] 숙제 업로드 `upload-homework` 401 원인 확인/대응(2026-03-30): DevTools Response에 “원장 계정 로그인 또는 학생 인증코드(student_code)가 필요”가 확인됨. Edge의 Bearer(owner JWT) 인증에 실패 시 `student_code`로만 본인 검증을 수행하므로, `homework/index.html`에서 `currentStudent.student_code`가 비어있으면 학생 포털에서 입력한 인증코드(정규화값)로 fallback하여 Edge에 `student_code`가 누락되지 않도록 보강(배포 후 스모크 필요)
- [x] 과제 배정 모달 즉시 오픈·타임아웃(2026-03-30): `showAssignModal`/`editAssignment` — `answer-keys` 대기로 모달이 늦게 뜨던 UX 완화(25s Abort·토스트), `createAssignment` 60s Abort·busy — 브라우저 배정 버튼·저장 스모크 권장
- [x] 과제 배정 마감 시간 `due_time`(2026-03-30): SQL `SUPABASE_GRADING_ASSIGNMENTS_DUE_TIME_20260330.sql`·`assignments.py`·`grading/index.html` — **프론트**: `commitAssignDuePickers`·`dataset.committedTime`·**기본 `GRADING_SERVER_URL`=Railway** · `python -m compileall grading-server` PASS · **Railway 최신 배포**(구버전은 `due_time` 미수신)·Supabase SQL 적용 후 **시간 저장→Table Editor** 스모크 권장
- [x] Drive 루트 해석·HML 미리보기 JPEG(2026-03-30): `resolve_central_root_folder_id`(검색/생성 시 `숙제 관리` 우선)·`CENTRAL_ROOT_FOLDER_LEGACY_ALIASES`·`build_hml_answer_preview_images` — Railway/환경값 불일치가 있어도 신규 업로드 폴더는 `숙제 관리`로 통일, 프론트/백엔드에서 `.hwp`도 HML 계열로 판별. 또한 Pillow 미설치/미리보기 생성 실패 시에도 placeholder JPEG로 최소 1장 생성해 “페이지 이미지 0장” 케이스를 방지. 교재 페이지 이미지는 `grade_level` 폴더(예: `고3`) 우선 업로드, 없으면 레거시(`교재 페이지 이미지`) 폴백 · `python -m compileall grading-server` PASS · HML/HWP 파싱 후 Drive 스모크 권장
- [x] OCR 수식 답안 표시 아티팩트 제거(2026-03-30): `grading/grader.py` — `student_answer` 저장 직전 `$$`, backtick(`` ` ``), 끝 apostrophe(`'`) 등 잡문자 정리로 `{1}over{6}` $$, 256' 같은 케이스 UI 표시 개선. `ast.parse` 문법 파싱 OK. 실데이터 재채점 스모크 권장
- [x] Google Drive 숙제 폴더 자동 생성(2026-03-30): `숙제 관리`·`교재/{중1~고3}`·`제출 과제 원본`·`채점 결과` — `upload-homework/index.ts`·`grading-server/integrations/drive.py` · `python -m compileall grading-server` PASS · **Edge·Railway 재배포** 후 실제 업로드 스모크 권장
- [x] 숙제 제출–배정 FK 스키마(2026-03-30): `SUPABASE_HOMEWORK_SUBMISSION_GRADING_ASSIGNMENT_20260330.sql` — `grading_assignments` 선행·SQL Editor 적용 후 제출 UI 연동
- [x] 숙제 제출 시 배정 선택 + Edge `upload-homework`·`homework/index.html` insert 연동(2026-04-03 완료, 마감=배정 `due_date`+`due_time` 기준)
- [x] 학부모 포털 숙제 O/X/△·제출 시각(배정 단위, 동일 마감 규칙)(2026-04-03 완료, 배정 없는 날은 비움(Q1))
- [x] 채점관리(제출 탭)에서 O/△/X 및 제출 시각 표시 + 배정 없는 날짜 점/아이콘 없음(2026-04-03 완료)
- [x] `DELETE /api/homework-submissions/{id}`로 제출 삭제 시 `grading_results/items`까지 동기화 + UI 캐시/렌더 갱신(2026-04-03 완료)
- [ ] Drive 레거시 루트(`과제 관리`) 통합 정리(2026-03-30): `과제 관리` 하위(`교재/제출 과제 원본/채점 결과`)를 `숙제 관리`로 병합(또는 가장 안전한 수동 병합+검증) 후 Supabase/URL 스모크
- [x] 채점관리 숙제 탭 기능 분리(2026-03-30): 배정=`assignments`/제출=`homework_submissions`/채점=`results`·`refreshHomeworkMgmtFromServerLists`·안내·범례 · 브라우저 3탭 스모크 권장
- [x] 학생 「평가」모달 평가 월 선택(2026-03-29): `#student-eval-month-picker`·`loadStudentEvalModalContent`·`onStudentEvalModalMonthChange`·`openStudentEvalModal(..., { evalMonth })` · `node --check script.js` PASS · 실기기: 과거 월 전환·저장·AI 생성 스모크 권장
- [x] 종합평가 본문 선행 0·０·빈줄 제거 이중 방어(2026-03-29): Edge `stripLeadingArtifactLines`+프롬프트·`script.js` `stripLeadingEvalArtifact` · `node --check script.js` PASS · **Edge 재배포**
- [x] 종합평가 고정 지침 UI — 저장 목록 숨김(2026-03-29): 「저장된 지침 전체」·`refreshStudentEvalAiStyleHistoryUi` 제거 · `node --check script.js` PASS
- [x] 종합평가 고정 지침 항목 삭제(API)·AI 선행 0 제거(2026-03-29): `deleteOwnerStudentEvalAiStyleEntry`·Edge `postProcessEvalText` · `node --check` PASS · **Edge 재배포**
- [x] 종합평가 AI 고정 지침 `student_eval_ai_style_entries` 테이블(2026-03-29): SQL `SUPABASE_STUDENT_EVAL_AI_STYLE_ENTRIES_20260329.sql` 적용·RLS·레거시 이관 · `database.js`·Edge 합산·`admin` 생성 순서 수정 · `npx supabase functions deploy generate-student-eval-report` · `node --check database.js` `script.js` PASS
- [x] 종합평가 AI 고정 지침 누적 저장(2026-03-29): `appendOwnerStudentEvalAiStyleNote`·UI 분리(저장 전체 표시+추가란)·전체 8000자 상한 · `node --check database.js` `script.js` PASS
- [x] 종합평가 AI 고정 지침 저장 검증+`users` RLS(2026-03-29): `database.js` — 갱신 후 `.select`로 행 검증·0행 시 실패 토스트 · Supabase에 `SUPABASE_USERS_RLS_STUDENT_EVAL_STYLE_NOTE_20260329.sql` 적용(본인 SELECT/UPDATE) · `node --check database.js` PASS · 적용 후 Table Editor에서 `student_eval_ai_style_note` 스모크
- [x] 종합평가 AI 고정 지침 DB+메타말투 금지(2026-03-29): `users.student_eval_ai_style_note`·평가 모달 UI·Edge 주입·시스템 지시 보강 · SQL `SUPABASE_USER_EVAL_AI_STYLE_NOTE_20260329.sql` 적용 · Edge 재배포 · `node --check script.js` `database.js` 권장
- [x] 종합평가 AI 전문 리포트 프롬프트+출결·숙제 요약(2026-03-29): Edge `generate-student-eval-report` — 01~04 섹션·15년 컨설턴트 톤·월별 출결·숙제 집계 → user 프롬프트 · **함수 재배포** 필요
- [x] 채점관리 숙제 관리 탭 통합(2026-03-29): `grading/index.html` — 상단 3탭·숙제 관리 내 배정·채점/제출 현황·`grading_nav.hwSub`·구 탭 복원 호환 · 브라우저 탭/서브탭·새로고침 스모크 권장
- [x] 종합평가 본문 2000자·번호 항목 줄바꿈(2026-03-29): Edge `EVAL_MAX_CHARS`·`postProcessEvalText`·프롬프트 1~4항목 새 줄·`maxOutputTokens` 4096 · UI `maxlength`/카운터 2000 · `script.js` `STUDENT_EVAL_COMMENT_MAX_CHARS`·SQL 파일 운영 체크리스트 주석 · **Edge 함수 재배포** 필수 · `node --check script.js` `parent-portal/report.js` PASS
- [x] 종합평가 AI Edge 401 대응(2026-03-29): `config.toml` `generate-student-eval-report` verify_jwt=false + `script.js` 세션 갱신·Bearer 명시 · 함수 **재배포** 필요 · `node --check script.js` PASS
- [x] 학부모 포털 종합평가 추가 인증 제거(2026-03-29): 인증코드 조회 성공 시 종합평가 즉시 표시·잠금 UI·`parent-auth-modal` 제거 · `node --check parent-portal/report.js` PASS
- [x] 학생 평가 AI·학부모 공개(2026-03-29): `script.js` 전역 핸들러 보강(ReferenceError 해소)·`parent_portal_visible` 저장·학부모 포털 placeholder·`node --check script.js` `report.js` PASS · SQL·Edge 배포는 운영에서 확인
- [x] 채점 숙제 세션 JWT(2026-03-29): `POST /api/grading-auth/session`(Edge PIN)·시크릿 설정 시 `homework-submissions` Bearer 필수·auth 미들웨어 해당 경로 스킵·`grading/index.html` 세션 저장·401 처리 · `python -m compileall grading-server` PASS · Railway에 `GRADING_SESSION_SECRET`·`SUPABASE_ANON_KEY` 설정 후 스모크 권장
- [x] 채점관리 숙제 제출+API(2026-03-29): `GET /api/homework-submissions`(소속 검증+Service Role)·프론트 API 우선·로컬 무URL 시 Supabase 폴백 · `python -m compileall grading-server` PASS · 배포 후 Network 스모크 권장
- [x] 관리자 Supabase 비밀번호 변경 422 완화(2026-03-29): `confirmAdminPasswordChange` — 8자·문자군 사전검증(`getMissingPasswordCharacterClasses`)·신규≠기존·`setSession` 후 `updateUser`·`AuthWeakPasswordError` 전용 토스트·모달 네 조건 안내·특수문자 정규식 `/` 이스케이프 · `node --check auth.js` PASS · `ReadLints` PASS
- [x] 학생관리 그래프 탭 라인차트/툴팁 통일(2026-03-28): 하단 막대 박스 제거, 라인차트 단일화, 점 hover 시 `시험명/시험일/점수` 커스텀 툴팁 즉시 표시(커서 근처) · `node --check script.js` PASS · `ReadLints(script.js, style.css, index.html)` PASS
- [x] 학생관리 그래프 탭 조회방식 통일(2026-03-28): `시작월~종료월` 조회 입력으로 전환, 최대 12개월 보정, 그래프 영역 좌우 드래그 월 이동 적용 · `node --check script.js` PASS · `ReadLints(index.html, style.css, script.js)` PASS
- [x] 학생 평가 점수 저장 월 제한 해제(2026-03-28): 시험일이 현재 월이 아니어도 저장 허용, 저장 후 시험일 월로 목록 재렌더, 월 전환 안내 토스트 추가 · `node --check script.js` PASS · `ReadLints(script.js)` PASS
- [x] 학부모 포털 점수 조회 연/월 + 드래그 이동(2026-03-28): `시작월~종료월` 조회, 최대 12개월 제한, 그래프 좌우 드래그(월 단위 이동), x축 규칙(1개월=날짜/초과=월) 반영 · `node --check parent-portal/report.js` PASS · `ReadLints(parent-portal/index.html, parent-portal/report.js)` PASS
- [x] 점수 그래프 툴팁 좌표 보정(2026-03-28): `.score-chart-wrap` relative 기준 + 상/하 동적 배치로 커서 근처 표시 · `node --check parent-portal/report.js` PASS · `ReadLints` PASS
- [x] 학부모 포털 점수툴팁 즉시 표시(2026-03-28): SVG `<title>` 대신 커스텀 툴팁으로 점 hover 즉시 `시험명/시험일/점수` 표시, 카드형 스타일 적용 · `node --check parent-portal/report.js` PASS · `ReadLints` PASS
- [x] 학부모 포털 점수 그래프 툴팁/라벨 정리(2026-03-27): 하단 날짜 라벨 제거, 점 hover 시 `시험명·시험일·점수` SVG `<title>` 툴팁 표시 · `node --check parent-portal/report.js` PASS · `ReadLints` PASS
- [x] 학부모 포털 점수 그래프 레이아웃 정렬(2026-03-27): 레퍼런스와 동일하게 조회 N개월 입력 + 라인차트 단일 구성(막대/목록 제거), Y축 100/50/0 라벨 · `node --check parent-portal/report.js` PASS · `ReadLints` PASS
- [x] 학부모 포털 점수 탭 전환(2026-03-27): `채점`→`점수` 탭명 변경, `student_test_scores` 기반 점수 추이 그래프(선+막대)+최근 점수 목록 렌더 · `node --check parent-portal/report.js` PASS · `ReadLints(parent-portal/index.html, report.js)` PASS
- [x] 출석기록 미처리 고정 보정(2026-03-27): 출석기록 대표 레코드 선택을 상태우선순위+최신시각으로 보정(`pickBetterRecord`), 상태 재저장 시 타 teacher_id stale `none/absent` 정리(`cleanupLegacyAbsentShadowRecord`) · `node --check script.js` `qr-attendance.js` PASS · `ReadLints` PASS
- [x] 점수 저장·QR 전화인증 입력 초기화(2026-03-25): `saveTestScoreFromHistory` 시험명 비움 · `submitPhoneAttendanceAuth` 4자리 제출 직후 `#qr-phone-last4-input` 비움 · `node --check script.js` `qr-attendance.js` PASS
- [x] 그래프 탭 조회 입력·영역 확대(2026-03-25): 드롭다운→숫자 입력·안내·메타·빈상태 문구 제거·`silentEmpty`/`suppressVizHead`/`test-score-viz--chart-tab` · `node --check script.js` PASS · 실기기: 1~12개월 입력·그래프 크기 확인 권장
- [x] 학생 평가 모달 점수 Supabase·그래프 탭(2026-03-25): `saveStudentTestScore` → `_resolveOwnerUserId` · 그래프 탭 1~12개월·`getStudentTestScoresByDateRange` · 점수 탭 차트 제거 · `node --check script.js` `database.js` PASS · 실기기: 점수 저장 후 Supabase 반영·그래프 탭 조회 권장
- [x] 점수 탭 그래프 고도화(2026-03-25): 만점 대비 % SVG 라인·막대 %·시험일 순·빈 달 안내 · `node --check script.js` PASS · `ReadLints(style.css)` PASS · 실기기: 점수 2건+ 시 라인·막대 일치 확인 권장
- [x] 학생목록 「평가」모달·기록/점수 탭(2026-03-25): `student-eval-modal`·`openStudentEvalModal`·기록=수업관리 월별 메모·점수=테스트점수·하단 종합평가 고정·카드 버튼 `평가` 단일화 · `node --check script.js` PASS · `ReadLints(index.html, style.css)` PASS · 실기기: 평가→기록/점수·종합저장 권장
- [x] 수업관리 이번달 기록에서 종합평가 숨김(2026-03-25): `openHistoryModal(true)`·`#eval-section` display none · `node --check script.js` PASS · 실기기: 수업관리→이번달 기록=메모만 확인 권장
- [x] 재석확인 1분 내 재노출 보강(2026-03-24): `qr-attendance.js` 시간키를 `normalizeAttendanceTimeKey(HH:MM)`로 통일해 큐/스누즈/미스캔 `alertKey`·`timerKey` 포맷 불일치(`HH:MM` vs `HH:MM:SS`) 제거 · `node --check qr-attendance.js` PASS · `ReadLints(qr-attendance.js)` PASS
- [x] 결제 증빙 업로드+AI 추출 모달 통일(2026-03-24): `payment-ai-modal` 안내 문구를 `카드/계좌이체/QR코드` 기준으로 변경, 증빙 유형 옵션을 `카드결제 화면/계좌이체 내역/QR결제 내역/기타`로 재정의, 기본값을 `카드결제 화면`으로 수정 · `node --check js/payment.js` PASS · `ReadLints(index.html, js/payment.js)` PASS
- [x] 재석확인 스누즈/일정변경 기준시각 보정(2026-03-24): `qr-attendance.js`에 일정 유효성 기반 큐 prune + 일정 변경 훅(`onScheduleSlotChangedForAttendanceCheck`) 추가, `script.js` `updateClassTime` 연동 · `node --check qr-attendance.js` `script.js` PASS · `ReadLints(qr-attendance.js, script.js)` PASS
- [x] 수납관리 대사(차이) 영역 제거(2026-03-24): `index.html`에서 수단별 대사 카드(`pay-channel-grid`)와 합계 차이 박스(`pay-reconcile-total-wrap`), CSV 차이 옵션(`pay-csv-option-reconcile`) 제거 · `ReadLints(index.html)` PASS
- [x] 수납 결제수단 옵션/용어 통일(2026-03-24): 메인 원장+AI 검토 모달의 결제수단을 `카드/계좌이체/QR코드`로 통일, AI 결제경로 입력 제거, 거래확인번호 placeholder를 결제수단 예시로 명확화, 채널 자동 매핑(`계좌이체→통장`, `카드/QR코드→기타`) 반영 · `node --check js/payment.js` PASS · `ReadLints(index.html, js/payment.js)` PASS
- [x] Vercel `highroad-math` 배포(2026-03-23): `vercel.json` — `name` · `outputDirectory: "."`(`public` 미사용)·`installCommand` · `package.json` engines · `docs/VERCEL_HIGHROAD_PARENT_PORTAL.md` — 푸시 후 Redeploy·`https://highroad-math.vercel.app/parent-portal` 스모크 권장
- [x] 학부모 포털 Vercel 경로(2026-03-23): `cleanUrls`·`/parent-portal` 무슬래시 시 상대 `report.js`→`/report.js` 404 방지 — `parent-portal/index.html`에 `/parent-portal/report.js`·`/css/`·`/js/` 절대 경로 · `homework/index.html` CSS·env 후보 보강 · 배포 후 조회·Network `report.js` 200 확인 권장
- [x] Vercel `.env` fetch 404 콘솔(2026-03-23): 프로덕션에서 `fetch` 시도 자체를 생략 — `localhost`/`127.0.0.1`에서만 env 파일 로드 · `parent-portal`·`homework` · 배포 후 콘솔 빨강 404 감소 확인 권장
- [x] 학생 수업관리 `이번달 기록` 메모 중심화(2026-03-23): `openHistoryModal`에서 통계·통합요약 제거, 날짜별 **개인메모/공유메모**만 리스트 노출(메모 있는 날짜만) + 종합평가는 하단 유지 · `ReadLints(script.js)` PASS
- [x] 학생 수업관리 `이번달 기록` 상단/테스트 점수 제거(2026-03-23): 카운트(`hist-stats`)·요약 4박스(`hist-overview`) DOM 제거 + 테스트 점수 섹션 DOM 제거(`index.html`) · 실기기에서 상단/테스트 미노출, 하단 종합평가 노출 확인 권장
- [x] 학부모 포털 출결 일별 카드(2026-03-23): 수업+인증·지각 시 N분 지각·결석은 수업만 — `parent-portal/report.js`·`index.html` · `node --check parent-portal/report.js` PASS · 실제 데이터로 인증·지각 분 표시 확인 권장
- [x] 학부모 포털 지각 가로 정렬(2026-03-23): `att-meta-late-row`로 수업·인증 열 `nowrap` — 모바일에서 지그재그 줄바꿈 방지 · `node --check parent-portal/report.js` PASS
- [x] 학부모 포털 지각 베이스라인(2026-03-23): `align-items: flex-end` — 수업·인증이 출석과 같이 한 줄, N분 지각은 인증 위만 · 브라우저 확인 권장
- [x] 기간 일정 삭제 await·중복 제거(2026-03-23): `executePeriodDelete` + `deleteSchedulesByRange`/`deleteSchedulesByTeacherRange` throw 정책 · `node --check script.js` `database.js` PASS · 2월 전체 삭제 후 캘린더·DB 건수 확인 권장
- [x] 기간 삭제 정책(2026-03-23): **내 등록 vs 다른 선생님 등록**만(`hasAnyOtherTeacherScheduleInPeriod`·로컬 `hasOtherTeacherSchedulesLocalInRange`) · 타 선생님 있음 → `showConfirm` 후 `targetMode: 'owner'` · 내 일정만 → 확인 없이 `targetMode: 'currentTeacherOnly'`·`fetchDistinctStudentIdsFromSchedulesInRangeForTeacher` · 담당 외 모달·원장 PIN 제거 · `index.html` 안내 문구 · `node --check script.js` `database.js` PASS · 실기기 2케이스 권장
- [x] schedule_date 비정규 문자열(2월 삭제·단건 복귀)(2026-03-23): `normalizeScheduleDateKey`·로컬 키 병합 · `node --check database.js` `script.js` PASS · 2월 기간·단건 삭제 후 새로고침 확인 권장
- [x] 일정 단건 삭제 Supabase 정합(2026-03-23): `deleteScheduleFromDatabase` owner·시간 변형 · `deleteSingleSchedule` DB 선행 · `node --check database.js` `script.js` PASS · Network에서 `schedules` DELETE 확인 권장
- [x] 전체 선생님 보기 + 기간 삭제 동기화(2026-03-23): 삭제 후 `reloadScheduleDataAfterOwnerMutation` · `loadAllTeachersScheduleData`에서 알려진 선생님 빈 버킷 stale 제거 · `executeBulkDelete` 동일 경로 · `node --check script.js` PASS · **전체 선생님** 표시에서 2월 전체 삭제 후 캘린더·콘솔 건수 감소 확인 권장
- [x] 학부모 포털 인증시간=이력 authIso(2026-03-23): `resolveParentPortalAuthIso` + `qr_judgment`/`attendance_source` 조회 · `node --check parent-portal/report.js` PASS · 원장 인증시간 수정 후 학부모와 대조 권장
- [x] 학부모 포털 출결 메모(2026-03-23): 지각·결석·보강·기타만 `memo` 하단 박스 · `node --check parent-portal/report.js` PASS · 보강+메모 등 확인 권장
- [x] 출석 이력 처리·인증시간 Enter 저장(2026-03-23): `qr-attendance.js` — 수정 버튼 제거·Enter 적용 · `node --check qr-attendance.js` PASS · 관리자에서 실제 저장 동선 확인 권장
- [x] 채점 서버 Docker·Compose(2026-03-23): 루트 `docker compose up --build`, `grading-server/.env` 필요 — 이미지 빌드·`/health` 헬스체크·`README.md` 배포 안내 · 클라우드 푸시 전 `docker compose` 스모크 권장
- [x] 월간 캘린더 공휴일·학원일정 배경(2026-03-22): `public-holiday-cell`·`custom-holiday` 글자/배경 분리·`bg_color` SQL — `node --check script.js` PASS · Supabase 마이그레이션 적용 후 저장 확인 권장
- [x] 캘린더 배경 **선택안함**·연한 톤(2026-03-22): `custom-holiday-no-bg`·파스텔 칩·`style.css` `color-mix` 완화 — `node --check script.js` PASS · 실기기에서 배경 없음/공휴일 농도 확인 권장
- [x] **국가 공휴일** 칸 배경 추가 연화(2026-03-22): `public-holiday-cell`만 `color-mix` 비율 재하향 — 브라우저에서 삼일절 등 법정 공휴일 셀 확인 권장
- [x] 출석 이력 **처리시간·인증시간** 한 줄 배치(2026-03-22): `qr-attendance.js` — `node --check qr-attendance.js` PASS · 출석 기록 패널에서 레이아웃 확인 권장
- [x] 출석 이력 시간 **수정 버튼(변경 시만 활성화)**(2026-03-22): `qr-attendance.js` — `node --check qr-attendance.js` PASS · 관리자에서 적용·저장 동선 확인 권장
- [x] 선생님 선택 화면 QR → 스캔 → 닫기 → 선생님 선택 복귀(2026-03-22): 상단 QR → **`showQRPasswordModal`** → 모달에서 PIN → **`confirmQRPassword`** → `setCurrentTeacher` → **`openQRScanPage()`**(배포본/ZIP 동일)·`openedFromTeacherSelect`·닫기 시 `TEACHER_SELECT` — `node --check qr-attendance.js` PASS · 실기기 확인 권장
- [x] `isQRScanPageOpen` 오판으로 토스트·확인창 전부 차단(2026-03-22): **인라인 `display`만** 판별(GitHub `origin/main`과 동일 원칙, `getComputedStyle` 단독은 CSS flex 오판 가능)·미선택 시 `showConfirm`+드롭다운 포커스 — `node --check script.js` + `qr-attendance.js` PASS · 미선택/미입력 시 안내 노출 실기기 확인 권장
- [x] 선생님 선택 QR 버튼(2026-03-22): **`onclick="showQRPasswordModal()"`** + `.qr-teacher-select-top-btn`·`z-index:100`(ZIP·Vercel과 동일) — 별도 `teacher-select-qr-btn` / `bindTeacherSelectQrButton` 없음
- [x] 선생님 선택 QR 가시성·readerWidth(2026-03-22): 일정 로드 전 **QR 페이지 선표시**·`scheduleStartQRScanner`·폭 폴백·`qrAttendanceTeacherIdOverride`·`ensureQrScanFullyClosed`/닫기 복구 — `node --check qr-attendance.js` PASS · 실기기 선생님 선택→QR·메인→QR·닫기 동선 확인 권장
- [x] QR 오버레이·카메라 메인 잔류 방지(2026-03-22): `ensureQrScanFullyClosed` + `navigateToPage`/`setCurrentTeacher` + video 트랙 보조 정지 + 닫기 PIN 폴백 — `node --check` PASS · 실기기 입장·닫기 재확인 권장
- [x] QR 닫기 CSS 충돌 해결(2026-03-22): `#qr-scan-page.auth-page` `display:flex !important` 제거 + `setQrScanPageDisplayVisible`/`setProperty` · `isQRScanPageOpen`·재석확인 computed 보강 — `node --check script.js` + `node --check qr-attendance.js` PASS · 실기기 닫기·새로고침 확인 권장
- [x] 자동결석 보정 출석 조회 병합(2026-03-22): `getMergedAttendanceRecordForAutoAbsentSlot`로 슬롯당 1회 조회 — `node --check script.js` PASS · Network 스팸 완화 실기기 확인 권장
- [x] 출석 `attendance_records` **N+1·묶음 조회 개선** — **문서 인지**(2026-03-22): `docs/plan.md`·`docs/context.md`에 확장 대비 권장 방향·후속 기록. **구현은 후속**(미스캔·핫 패스 우선 등). 체감 시 Gate A~B로 범위 확정
- [x] 선생님 선택 비밀번호 후 자동 QR·카메라 방지(2026-03-22): `qr-attendance.js` — `confirmQRPassword`/세션 경로에서 `openQRScanPage` 제거, `closeQRScanPage`에서 `await stopQRScannerForModeChange`; 실기기 입장→메인만·QR 버튼으로 카메라 확인 권장
- [x] QR 스캔 전체화면 시 닫기 숨김(2026-03-22): `qr-attendance.js`·`style.css`·`index.html` — `fullscreenchange`·페이지 오픈 동기화; 실기기 전체화면 전환 후 닫기 노출 확인 권장
- [x] QR 스캔 헤더 여백·안내 문구 제거(2026-03-22): `index.html`·`style.css`·`mobile.css` — 제목·닫기 상단 패딩, 「상단 제목을…」힌트 삭제; 실기기 여백 확인 권장
- [x] QR 스캔 종료·카메라 전환 PIN + 2열 레이아웃(2026-03-22): `qr-attendance.js`(`resolveQrPinVerificationTarget`, `requireAdmin`, 원장+일반교사 프로필)·`style.css`(560px+ dual-mode, 키보드 1열은 599px 이하만) — `node --check qr-attendance.js` PASS · 실기기 관리자 PIN·태블릿 좌우 배치 확인 권장
- [x] QR 스캔 태블릿 가로 중앙 정렬(2026-03-22): `style.css`/`index.html` — 11인치 등에서 레이아웃·헤더 정돈; 실기기 가로 모드 확인 권장
- [x] QR 스캔 카메라 영역 붕괴 회귀 수정(2026-03-22): `.qr-reader-host` min-height·모바일 레이아웃 min-height 완화 — 실기기에서 카메라+전화 패널 동시 노출 확인 권장
- [x] QR 스캔 페이지 모바일 세로 스크롤(2026-03-22): `style.css`/`mobile.css`/`qr-attendance.js`/`index.html` — 스크롤 여유·스페이서·카메라 높이·video touch 보정; 실기기 스와이프·주소창 접기 확인 권장
- [x] 재석 확인 이중(5분 전+정각)·지각 후 QR/무인증 결석·수업종료 후 임시(2026-03-22): `qr-attendance.js` — `node --check qr-attendance.js` PASS · **실기기 시나리오**(이중 알림·지각→QR 메모·지각→종료 결석·종료 후 스캔)는 운영에서 확인 권장
- [x] 출석 이력 처리방식·임시 체크 UX(2026-03-22): 4종 라벨·자리확인 배지 제거·원장만 처리/인증시간 편집·임시 체크 빨간 테두리·문구 통일 — `node --check script.js` + `node --check qr-attendance.js` PASS
- [x] `verify-teacher-pin` **144~148차**(응답 정책·배포·JWT 설정·`invokeVerifyTeacherPin`): 코드·배포·대시보드 설정·**메인 진입 사용자 확인** (2026-03-22)
- [x] `verify-teacher-pin` CORS: `npx supabase@latest functions deploy verify-teacher-pin` 후 로컬에서 preflight(OPTIONS **200** + CORS 헤더) 확인, `SUPABASE_URL` ref 오타 점검 (2026-03-22) — **배포 완료 확인(프로젝트 jzcrpdeomjmytfekcgqu)**
- [x] 요구사항 재확인 후 구현 시작
- [x] `python qa-artifacts/sync_doc_dates.py` 실행 후 작업 시작
- [x] 문서 기준일을 작업 당일로 갱신
- [x] 다음날 작업 시 `문서 기준일`을 다음 날짜로 재갱신(고정 날짜 사용 금지)
- [x] 문서 3종(`plan/context/checklist`)의 `문서 기준일` 완전 일치 확인
- [x] 변경 파일/영향 범위 확인
- [x] 연속 작업 진행현황(시작/중간/완료) 사용자 공유 + docs 동기화 반영
- [x] 페이지 전환 링크 회귀 점검(메인 ↔ 숙제 제출 ↔ 채점 ↔ 학부모 포털) — **사용자 실기기 스모크 PASS** (2026-03-22)
- [x] 인증코드 조회 회귀 점검(숙제 제출 `student_code` ↔ 학부모 포털 `parent_code`) — 상기 동선 포함 **사용자 스모크 PASS** (2026-03-22, 심층 엣지는 필요 시 추가)
- [ ] 에러 처리(실패 응답/예외) 포함
- [ ] 장애 원인분류 3단계 기록 완료(코드/데이터·정책/외부플랫폼)
- [ ] 원인분류 근거 스냅샷 기록(콘솔/네트워크 + SQL 결과)
- [ ] 최종 조치가 원인분류와 1:1로 일치하는지 확인(코드문제면 코드, 정책문제면 SQL 우선)
- [x] 회귀 가능 구간 점검
- [x] 문서(`plan/context/checklist`) 업데이트
- [x] 작업 1건 완료 시 문서 3종 즉시 동기화
- [x] 엔터프라이즈 플레이북(`docs/enterprise_workflow.md`) 기준으로 작업 게이트 적용 여부 확인
- [x] 엔터프라이즈 자동로그 스크립트(`qa-artifacts/append_enterprise_log.py`) 실행 확인
- [ ] 중요 작업 전문가 토론 기록 확인(보안/백엔드/프론트/운영QA)

## 엔터프라이즈 Gate 체크(필수)
- [ ] Gate A(설계/영향분석): 목표/범위/리스크/완료기준 명시
- [ ] Gate B(구현): 작은 단위 수정 + 단위 검증
- [x] Gate C(통합회귀): 페이지 연결/인증코드/권한/데이터 정합성 확인 — **사용자 스모크 PASS**(메인 일정·출석 저장·4화면 연결) (2026-03-22)
- [ ] Gate D(운영준비): 원인분류 확정 + SQL/배포 순서 고정
- [ ] Gate E(사후기록): plan/context/checklist 동시 갱신

## 장애 원인분류 체크리스트 (오진 방지)
- [ ] 증상과 재현절차를 1줄로 고정 기록
- [ ] 클라이언트 증거 확보(콘솔 에러 1개 + Network 요청 1개)
- [ ] Supabase 증거 확보(해당 테이블 조회 결과 + 관련 정책 조회 결과)
- [ ] 외부플랫폼 증거 확보(배포 URL/환경변수/경로/캐시 상태)
- [ ] 최종 원인분류 확정(`코드`/`Supabase`/`외부플랫폼`/`복합`)
- [ ] 조치 후 동일 재현절차로 재검증(PASS/FAIL)

## 장애 기록 템플릿 (복붙용)
`장애ID: | 증상: | 재현절차: | 클라이언트증거: | Supabase증거: | 외부플랫폼증거: | 최종원인분류: 코드/Supabase/외부플랫폼/복합 | 조치범위: 코드/SQL/배포설정/운영가이드 | 결과: PASS/FAIL`

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
| 2026-05-16 | AUTO-20260516(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-16 | AUTO-20260516(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-15 | AUTO-20260515(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-14 | AUTO-20260514(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-13 | AUTO-20260513(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-12 | AUTO-20260512(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 9개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-11 | AUTO-20260511(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 9개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 8개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-10 | AUTO-20260510(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 3개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 101개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 166개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-05-09 | AUTO-20260509(staged 9개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-11 | AUTO-20260411(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-07 | AUTO-20260407(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-06 | AUTO-20260406(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-06 | AUTO-20260406(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-06 | AUTO-20260406(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-06 | 학생 숙제: 달력 배정 뱃지·복수 배정 체크·순차 제출·교재 체크박스 | `homework/index.html` 정적 검토 | PASS(코드) | 실제 기기에서 복수 배정·Drive 파일명 스모크 |
| 2026-04-06 | 채점관리 PIN 로그인 `<form>` 래핑 | 수동: `grading/index.html` DOM 구조 확인 | PASS(코드) | 브라우저 콘솔 DOM 경고 감소 기대 |
| 2026-04-06 | 과제 배정 API `insert().select` 제거(supabase-py 2.x) | `python -m compileall grading-server` | PASS(코드) | Railway 배포 후 `POST /api/assignments` 스모크 |
| 2026-04-05 | AUTO-20260405(staged 16개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-05 | AUTO-20260405(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-05 | 채점 확정 게이트 3단계(UI: 학부모·학생 숙제 + `public-portal-grading` API) | `python -m compileall grading-server` · `node --check parent-portal/report.js` | PASS(코드) | 배포 후 CORS·실제 이미지 로드 스모크 권장 |
| 2026-04-05 | AUTO-20260405(staged 10개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-05 | AUTO-20260405(staged 8개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-05 | AUTO-20260405(staged 15개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-04 | AUTO-20260404(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-04 | AUTO-20260404(staged 9개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-03 | AUTO-20260403(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-03 | AUTO-20260403(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-03 | AUTO-20260403(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-01 | AUTO-20260401(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-04-01 | AUTO-20260401(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 1개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-31 | AUTO-20260331(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-30 | AUTO-20260330(staged 17개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-30 | AUTO-20260330(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-30 | AUTO-20260330(staged 13개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-29 | AUTO-20260329(staged 30개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-25 | AUTO-20260325(staged 15개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 10개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 2개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 4개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 6개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | AUTO-20260323(staged 18개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-23 | 기간 삭제 owner 전체·다른 선생님 확인 (`deleteSchedulesByOwnerRange` 등) | `node --check script.js` `database.js` · `runPeriodDeleteExecute` 경로 정적 검토 | PASS(코드) | 전체 선생님 보기·타 선생님 칸 일정이 있는 기간에서 삭제·다른 선생님 확인창 브라우저 확인 권장 |
| 2026-03-23 | 기간 삭제「전체」집계 로컬∪DB (`getPeriodDeleteMergedStats`) | `node --check script.js` · 실행 루프(`runPeriodDeleteExecute`)와 동일 학생·건수 기준 정적 검토 | PASS(코드) | 담당 외 학생 일정만 DB에 있는 월에서 삭제 예정 건수·확인 모달 노출 브라우저 확인 권장 |
| 2026-03-23 | 기간 삭제 담당 외 모달 오탐·푸터 UI | `studentHasDifferentPrimaryTeacherThan` + `period-del-footer*` 정적 검토 · `node --check script.js` | PASS(코드) | 담당 학생만 선택·기간 삭제 시 담당 외 모달 미표시·관리자 모달 취소 버튼 폭 브라우저 확인 권장 |
| 2026-03-23 | 학부모 포털 인증시간(authIso 정합) | `resolveParentPortalAuthIso` + `select` 확장 + `node --check parent-portal/report.js` | PASS(코드) | 출석 이력 인증시간 수정 후 학부모 포털과 시각 일치 확인 권장 |
| 2026-03-23 | 학부모 포털 출결 메모(지각·결석·보강·기타) | `showAttDateDetail` 조건 분기 + `node --check parent-portal/report.js` | PASS(코드) | 보강 등 `memo` 있는 행에서 하단 박스 확인 권장 |
| 2026-03-23 | 학부모 포털 지각 레이아웃(`att-meta-late-row`) | `node --check parent-portal/report.js` + CSS `nowrap` 정적 검토 | PASS(코드) | 좁은 화면에서 수업·인증 나란히 표시 확인 권장 |
| 2026-03-23 | 학부모 포털 출결 일별 카드(수업·인증·지각분) | `node --check parent-portal/report.js` + `attendance_records`에 `auth_time` 조회 필드 추가 정적 검토 | PASS(코드) | 브라우저에서 출석/지각/결석·인증 시각 없는 레거시 행 확인 권장 |
| 2026-03-22 | AUTO-20260322(staged 8개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 172개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | QR 스캔 관리자 PIN·2열 레이아웃 | `node --check qr-attendance.js` + `mapVerifyTeacherPinFailureToMessage` 연동 | PASS(코드) | 실기기: 원장+일반교사 프로필·태블릿 좌우 배치 확인 권장 |
| 2026-03-22 | AUTO-20260322(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 5개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 7개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | AUTO-20260322(staged 12개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | 재석 확인 이중·지각/QR·종료 후 임시 | `node --check qr-attendance.js` + 코드 경로 점검(`pendingTimersDetail`, `scheduleLateFinalizeAbsentIfNoScan`, `saveEmergencyAttendanceAfterAllClassesEnded`) | PASS(코드) | 실기기: 5분 전/정각 알림·지각 후 스캔 메모·무스캔 결석·마지막 종료 후 스캔 권장 |
| 2026-03-22 | 날짜 일정 다중+글자크기 | `node --check script.js database.js` + SQL 마이그레이션 파일 정적 검토 | PASS(코드) | **운영**: `SUPABASE_HOLIDAYS_MULTI_FONT_20260322.sql` 실행 후 다중 저장·`font_size` 조회 확인 |
| 2026-03-22 | 관리자 로그인→메인 진입 속도 점검·개선 | 코드 경로 추적(`signIn`→`showMainApp`→`setCurrentTeacher`→`loadAndCleanData`) + `node --check script.js auth.js` | PASS(코드) | 병렬화·중복조회 제거·로딩 UI; 실제 체감은 네트워크·데이터량에 따름 |
| 2026-03-22 | 전문가 2차 정적 검사(패턴·인증 구조) | `rg`로 `eval`/`new Function` 미검출, `grading-server/auth.py`·`main.py` JWT·CORS·레이트리밋 경로 확인, `innerHTML` 사용 범위 grep | PASS(정적) | 운영 JWT 미설정 시 API 인증 약화 가능 — 환경변수 필수. XSS는 보간 경로별 수동 점검 권장 |
| 2026-03-22 | 종합 점검(에이전트): 정적·E2E·스모크 | `sync_doc_dates.py` + `node --check`(핵심 JS) + `compileall grading-server` + 머지 충돌 마커 없음 + `localhost:8000`에서 `npm run test:e2e`(tmp-e2e-runner) + HTTP 200 4경로 | PASS | E2E는 정적 서버 미기동 시 ERR_CONNECTION_REFUSED — 선기동 필수 |
| 2026-03-22 | AUTO-20260322(staged 69개 파일 기준 문서 연동 자동기록) | 통합 문서 연동 스크립트 실행 + 문서 기준일/삽입 결과 확인 | PASS | 연동 자동 기록 |
| 2026-03-22 | 통합 스모크(입장 후 운영 동선) | 사용자 실기기: 오늘 일정 표시·학생 출석 1건 저장·메인↔숙제↔채점↔학부모 포털 진입 | PASS | 로그인/입장 트랙 후속 회귀, Gate C 근거 |
| 2026-03-22 | 학생관리 148차(401·Bearer·대시보드 문서) | `invoke-verify-teacher-pin.js` Bearer 정책 + `SUPABASE_VERIFY_TEACHER_PIN_DASHBOARD.md` | PASS(코드) | **Supabase 대시보드**에서 verify-teacher-pin JWT 검증 OFF 후 입장 재시도 |
| 2026-03-22 | 학생관리 147차(`invokeVerifyTeacherPin` fetch 폴백) | `js/invoke-verify-teacher-pin.js` + 페이지 스크립트 로드 + `node --check` | PASS(코드) | 브라우저에서 선생님 입장·채점/포털 PIN 경로 재검증 |
| 2026-03-22 | 학생관리 146차(`verify-teacher-pin` verify_jwt) | `supabase/config.toml`에 `verify_jwt = false` 추가 + 문서 동기화 | PASS(코드) | **배포 완료 확인:** 사용자 터미널 `npx supabase@latest functions deploy verify-teacher-pin` → `jzcrpdeomjmytfekcgqu` 성공(Docker 미실행 경고는 원격 배포에 보통 무관) → 브라우저에서 선생님 입장 재검증 |
| 2026-03-22 | 학생관리 145차(관리자 로그인·권한 검증) | `node --check`(auth/script/teacher-manage/parent-portal) + 정적 검토 | PASS(코드) | 운영에서 `users.role`·RLS 정책으로 본인 행 조회 가능해야 함; 포털 관리자 로그인·권한 변경 모달 재검증 권장 |
| 2026-03-22 | 학생관리 144차(`verify-teacher-pin` HTTP 200 정책) | `index.ts` 정적 검토 + `python qa-artifacts/sync_doc_dates.py`로 문서 기준일 일치 | PASS(코드) | **운영 반영**은 `npx supabase@latest functions deploy verify-teacher-pin` 재배포 후 브라우저에서 선생님 입장·PIN 불일치 시 콘솔 401 혼선 감소 확인 |
| 2026-03-22 | 학생관리 143차(`verify-teacher-pin` 운영 배포) | 사용자 터미널에서 `npx supabase@latest functions deploy verify-teacher-pin` 성공 스크린샷(프로젝트 `jzcrpdeomjmytfekcgqu`) | PASS | Docker 미실행 경고는 원격 배포에 보통 무관, 브라우저에서 선생님 입장 재검증 권장 |
| 2026-03-22 | 학생관리 143차(`verify-teacher-pin` 배포/CORS) | Edge Function OPTIONS CORS 헤더 보강 + 정적 검토, `npx supabase@latest functions deploy` 안내 반영 | PASS | 사용자 PC에서 실제 배포 후 `npx supabase@latest functions list`로 확인, `SUPABASE_URL` ref 오타 점검 |
| 2026-03-21 | 학생관리 141차 운영적용(재강화 3단계 실행 + 스모크) | 사용자 SQL 실행 결과(RLS enabled 확인) + 사용자 스모크 결과 `pass` 확인 | PASS | `students`, `schedules` 재강화 적용 후 운영 정상 확인 |
| 2026-03-21 | 학생관리 142차(PIN 서버검증 전환) | `pin_hash` 패턴 재검색 + `node --check`(script/qr-attendance/parent-portal) + `ReadLints` + Edge Function 추가 정적점검 | PASS | 클라이언트 `pin_hash` 직접 조회/비교 경로 제거, `verify-teacher-pin` 배포 필요 |
| 2026-03-21 | 학생관리 141차(안전 재강화 3단계 SQL 세트) | students/schedules 공개 읽기 2개 정책의 적용 SQL/롤백 SQL 분리 작성 + 정책/rls 검증 쿼리 포함 + 문서 동기화 확인 | PASS | 운영 적용 전 사전 준비 완료(실행은 사용자 SQL Editor에서 진행) |
| 2026-03-21 | 학생관리 140차(안전 재강화 2단계 SQL 세트) | attendance 앱 owner read/write 4개 정책의 적용 SQL/롤백 SQL 분리 작성 + 정책/rls 검증 쿼리 포함 + 문서 동기화 확인 | PASS | 운영 적용 전 사전 준비 완료(실행은 사용자 SQL Editor에서 진행) |
| 2026-03-21 | 학생관리 139차(안전 재강화 1단계 SQL 세트) | 적용 SQL/롤백 SQL 분리 작성 + 정책/rls 검증 쿼리 포함 + 문서 동기화 확인 | PASS | 재강화 적용 전 사전 준비 완료(실행은 운영 확인 후) |
| 2026-03-21 | 학생관리 138차(긴급복구 후 스모크 3종 확인) | 사용자 실기기 확인(일정 추가/출석 변경/미처리 전환) | PASS | 기준선 정상 복구 확인, 다음 단계는 재강화 작업으로 전환 |
| 2026-03-21 | 학생관리 137차(attendance_records RLS 42501 긴급복구) | 콘솔 에러(`new row violates row-level security policy`) 기준 원인 확정 + attendance 앱 read/write 정책 핫픽스 SQL 작성 + 검증 쿼리 포함 확인 | PASS | Supabase SQL 실행 후 출석 저장/자동결석 에러 재발 여부 확인 필요 |
| 2026-03-20 | 학생관리 136차(DB 401 요청 선차단) | `database.js` 일정 저장 경로 세션 사전검증 추가 + ReadLints 확인 | PASS | 세션 만료 시 DB 요청 전에 차단해 연속 401/후속 예외 전파 완화 |
| 2026-03-20 | 학생관리 135차(일정 추가 알림 누락/중복 오해 방지) | 콘솔 에러 라인(`script.js:4907`, `database.js:387`) 기준 경로 분석 + 일정생성 예외/토스트 분기 패치 + ReadLints 확인 | PASS | DB 동기화 실패 시에도 생성 성공 안내와 경고 안내를 분리해 재시도 오해 방지 |
| 2026-03-20 | 학생관리 134차(메인 일정 미노출 긴급복구) | 정책 충돌 경로 분석(`teachers_public_read`) + 핫픽스 SQL 작성 + 검증 쿼리 포함 여부 확인 | PASS | Supabase SQL 실행 후 메인 일정 재표시 확인 필요 |
| 2026-03-20 | 학생관리 133차(Supabase 실행용 정책/검증 SQL 추가 + 연속 진행현황 공유 규칙 반영) | SQL 파일 정적 점검 + 문서 규칙 반영 확인 + 기준일 일치 확인 | PASS | 다음 단계 Supabase SQL 실행/검증 준비 완료 |
| 2026-03-20 | 학생관리 132차(잔여 중요 보안 보강(teachers 정책 축소+PIN 해시 로그 제거)) | 정적 diff 점검 + ReadLints + 과허용/해시로그 패턴 재검색 | PASS | 중요작업 연속 보강 |
| 2026-03-20 | 학생관리 131차(Critical 보안 우선 패치(RLS 안전화+Edge Function 인증검증)) | 수정 파일 정적 점검 + ReadLints + 과허용 패턴(owner_user_id IS NOT NULL/USING(true)/WITH CHECK(true)) 재검색 | PASS | Critical 2건 선조치 완료 |
| 2026-03-20 | 학생관리 130차(보안 내용.zip(26장) 기준 재점검) | ZIP 26장 내용 확인 + 코드/RLS 패턴 재스캔 + 고위험 항목 분류 | PASS | 수정 우선순위(Critical 2건, High 2건) 도출 |
| 2026-03-20 | 학생관리 129차(중요작업 전문가 토론 선행 규칙 고정) | 문서 규칙 반영 + 4문서 연동 기록 확인 | PASS | 중요작업 토론 상시 적용 |
| 2026-03-20 | 학생관리 128차(완전 자동(커밋 시) 문서 연동 훅 적용) | pre-commit 훅 파일/자동 스크립트 경로 확인 + append_linked_docs_log 실행 결과 확인 | PASS | 완전 자동 모드 활성화 |
| 2026-03-20 | 학생관리 127차(docs 4종 연동 자동기록 기능 추가) | append_linked_docs_log 실행 + 4문서 기준일/기록 삽입 확인 | PASS | 연동 자동화 1회 실행 검증 |
| 2026-03-20 | 학생관리 126차(엔터프라이즈 문서 자동화: 날짜+로그 자동화) | `py qa-artifacts/sync_doc_dates.py` 실행(4문서 동기화) + `py qa-artifacts/append_enterprise_log.py ...` 실행(자동 로그 추가) + 로그 섹션 단일화 확인 | PASS | `enterprise_workflow.md`도 날짜 자동동기화 대상에 포함, 작업 로그 자동 append 기능 도입 및 중복 섹션 이슈 보정 |
| 2026-03-20 | 학생관리 125차(엔터프라이즈 작업방식 도입) | `docs/enterprise_workflow.md` 신규 작성 + `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 상호 연결 반영 + 문서 기준일 정합성 확인 | PASS | Gate A~E, PRD-lite, Risk-based 테스트, 장애 트리아지, KPI를 이 앱 기본 절차로 고정 |
| 2026-03-20 | 오진 방지 문서 규칙 추가(코드/Supabase/외부플랫폼 원인분류) | `docs/plan.md`, `docs/context.md`, `docs/checklist.md` 동시 반영 + 상호 정합성 점검 | PASS | 장애 발생 시 원인분류 확정 전 수정범위 고정 금지, 증거 기반 기록 템플릿/체크리스트를 표준화 |
| 2026-03-18 | 일정관리 118차(중/고 일정 등록 기본시간 100분 통일) | `node --check script.js` + `ReadLints(script.js, index.html)` + 등록시간 로직 점검(`sch-duration-min`, `updateDurationByGrade`) | PASS | 학년별(중 90/고 100) 자동 분기를 제거하고 100분 고정으로 통일해 운영 정책과 UI 기본값을 일치시킴 |
| 2026-03-15 | 수납관리 117차(`원장 입력` 버튼 hover 전 텍스트 가독성 보정) | `ReadLints(style.css)` + 스타일 경로 점검(`.pay-ledger-btn` 기본 텍스트 색상) | PASS | hover 전 희미하게 보이던 `원장 입력` 버튼 텍스트를 고정 대비 색으로 조정해 즉시 식별 가능하도록 개선 |
| 2026-03-15 | 수납관리 116차(일/월마감 요약 카드 텍스트 가독성 보정) | `ReadLints(style.css)` + 스타일 경로 점검(`.pay-close-label`, `.pay-close-card strong`) | PASS | 다크 테마에서 희게 보이던 요약 카드 텍스트를 대비 중심 색상으로 고정해 `오늘 수납액/오늘 수납건수/월 미수금/미확인입금` 가독성 개선 |
| 2026-03-15 | 수납관리 115차(학생카드 상세 우측 텍스트 대비/가독성 보정) | `ReadLints(style.css)` + 스타일 경로 점검(`.pay-ledger-row span/strong` 색상) | PASS | 다크 테마에서 과도하게 희게 보이던 우측 값 텍스트를 배경 대비 중심 색상으로 고정해 결제경로/결제수단/수납일 등 상세값 가독성 개선 |
| 2026-03-15 | 수납관리 114차(수납 원장 수정값 새로고침 유실 보정) | `node --check script.js` + `node --check js/payment.js` + `ReadLints(script.js, js/payment.js)` + 저장 경로 점검(`saveData(true)`, `payments` 병합) | PASS | 수납 수정 직후 즉시 저장을 강제하고, 학생 재로드 시 `payments`를 로컬 캐시에서 병합해 새로고침 유실 경로를 차단 |
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

## 2026-03-20 관리자 인증 교차 편집 전면 허용 보강
- [x] 관리자 인증 성공 시 교차 편집 세션 TTL(30분) 유지 로직 추가
- [x] 권한 검증(`verifyScheduleEditPermission`)에 관리자 세션 허용 분기 통합
- [x] 모달 진입 시 관리자 세션 유효하면 비밀번호 재입력 없이 교차 편집 모드 진입
- [x] 단일 일정 삭제(`deleteSingleSchedule`)를 owner 후보군 기반 로컬/DB 삭제로 확장
- [x] 출석이력 상태 변경 로컬 반영 조건에 관리자 세션/모달 관리자 모드 허용
- [x] 정적 검증: `node --check script.js`, `node --check qr-attendance.js` PASS
- [x] 정적 검증: `ReadLints(script.js, qr-attendance.js)` PASS
- [ ] 실기기 검증: 관리자 인증 후 타 교사 슬롯 `출석 변경/시간 변경/일정 삭제` 3개 경로 연속 동작 확인

## 2026-03-20 라이브서버 학부모 포털 진입 보정
- [x] `openParentPortal` 기본 경로를 `.../parent-portal/`(trailing slash 포함)로 수정
- [x] 저장된 커스텀 URL이 `.../parent-portal`이면 열기 시점에 `.../parent-portal/`로 정규화
- [x] 정적 검증: `node --check js/payment.js` PASS
- [x] 정적 검증: `ReadLints(js/payment.js)` PASS
- [ ] 실기기 검증: 메뉴 `학부모 포털` 클릭 시 새 탭 URL이 `.../parent-portal/`로 열리고 랜딩 화면 진입 성공

## 2026-03-20 페이지 연결 상시 점검 규칙 반영
- [x] 문서 운영원칙에 페이지 전환 회귀 점검(메인/숙제/채점/학부모) 항목 추가
- [x] 의사결정 로그에 페이지 연결 점검을 기본 게이트로 고정
- [ ] 패치 완료마다 4개 페이지 전환 링크 수동 점검 기록 남기기

## 2026-03-20 학부모 인증코드 유효성 판정 보강
- [x] 인증코드 정규화 유틸 추가(공백/하이픈/대소문자/전각 문자 보정)
- [x] 포털 랜딩 조회를 정규화 기반 다단계 조회 + 최종 정규화 일치 검증으로 보강
- [x] 평가 탭 학부모 인증 비교도 정규화 기준으로 통일
- [x] 다건 매칭 이상 상황에서 재발급 안내 에러를 명시 노출
- [x] 정적 검증: `node --check parent-portal/report.js` PASS
- [x] 정적 검증: `ReadLints(parent-portal/report.js)` PASS
- [ ] 실기기 검증: `정상/공백/하이픈/소문자·전각` 입력 케이스별 포털 진입 결과 확인

## 2026-03-20 학생관리 122차 인증코드 동시 실패 대응
- [x] 원인분리 점검: Railway와 인증코드 조회 경로 분리 확인(조회 직접 경로는 Supabase `students`)
- [x] 숙제 제출 검색 로직을 정규화 기반 다단계 조회로 보강(`homework/index.html`)
- [x] 운영 복구 SQL 추가: `SUPABASE_AUTH_CODE_PUBLIC_ACCESS_RESTORE.sql`
- [x] 정적 검증: `ReadLints(homework/index.html)` PASS
- [ ] 운영 실행: Supabase SQL Editor에서 `SUPABASE_AUTH_CODE_PUBLIC_ACCESS_RESTORE.sql` 실행
- [ ] 실기기 검증: 숙제 제출/학부모 포털에서 동일 코드 정책(`정상/공백/하이픈/소문자·전각`)으로 조회 성공 확인

## 2026-03-20 학생관리 123차 포털 연결 경로 통일 + 진단 보강
- [x] `parent-portal` env 로더 추가(`../.env.local`, `../env.local`, `.env.local`, `env.local`)
- [x] `homework` env 로더 추가(`../.env.local`, `../env.local`, `.env.local`, `env.local`)
- [x] 두 포털 Supabase 초기화를 `window.env + localStorage` 기반 런타임 설정 우선으로 보강
- [x] 인증코드 미매칭 시 public 조회 프로브 기반 진단 메시지(오입력 vs 조회차단 가능성) 분리
- [x] 정적 검증: `ReadLints(homework/index.html, parent-portal/index.html, parent-portal/report.js)` PASS
- [ ] 운영 실행: `SUPABASE_AUTH_CODE_PUBLIC_ACCESS_RESTORE.sql` 적용 후 포털 2종 재검증
- [ ] 실기기 검증: `숙제 제출(student_code)`/`학부모 포털(parent_code)` 동시 성공 확인

## 2026-03-20 학생관리 124차 학부모 포털 출결 미노출(Supabase 정책) 대응
- [x] 원인 분리 확인: `students` 조회 성공 상태에서 `attendance_records` anon 조회가 빈 결과(`[]`)로 확인됨
- [x] 정책 복구 SQL 추가: `SUPABASE_PARENT_PORTAL_ATTENDANCE_READ_RESTORE.sql`
- [x] 복구 SQL에 전/후 점검 쿼리 + 정책 재적용(`students_public_read`, `attendance_public_read`) 포함
- [ ] 운영 실행: Supabase SQL Editor에서 `SUPABASE_PARENT_PORTAL_ATTENDANCE_READ_RESTORE.sql` 실행
- [ ] 실기기 검증: 학부모 포털 `출결` 탭 달력/일자 상세가 실제 기록 기준으로 노출되는지 확인
