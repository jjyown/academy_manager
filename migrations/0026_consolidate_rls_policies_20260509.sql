-- ============================================================
-- 0026 RLS 정책 통합 / 중복 제거 (학생관리 운영 점검 후속)
-- 작성일: 2026-05-09
-- 목적: 0009~0013 reharden 과정에서 누적된 PERMISSIVE 중복 정책 정리
-- 원칙:
--   * 의미상 동일하거나(weak == weak) 더 강한 정책에 가려지는 약한 중복만 제거
--   * 포털 공개 읽기 정책(*_public_read, homework_schedules_read 등) 보존
--   * 새 정책 생성/조건 변경은 하지 않음 (기존 정책 DROP 만 수행)
--   * 검증 가능하도록 BEGIN/COMMIT 으로 단일 트랜잭션 처리
-- 사전 점검:
--   * 본 파일은 검토용 초안. 실제 운영 적용 전 staging/branch 에서 재현 필수.
--   * 적용 전 백업: pg_dump --schema-only --no-owner public > backup_pre_0026.sql
--   * 적용 후 메인 앱(출석 저장/수정/삭제, 일정/결제/휴일 CRUD)과
--     포털(parent_code/student_code 조회 경로) 스모크 테스트 필수.
-- 롤백:
--   * 본 파일 DROP 들이 실패하면 트랜잭션 통째로 롤백.
--   * 적용 후 문제 발생 시: 0009~0013 의 CREATE POLICY 절을 다시 실행하면 복구.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) attendance_records (10 → 5)
-- 유지: attendance_app_owner_{read|insert|update|delete} (0011), attendance_public_read
-- 제거: att_{select|insert|update|delete} (단순 owner-only, 더 강한 _app_owner_* 가 가림)
-- 제거: attendance_owner_policy (ALL, 단순 owner-only, 위와 동일 사유)
-- 효과: 0011 reharden 의도 완성 (students 소유자 일치 필수)
-- ------------------------------------------------------------
alter table public.attendance_records enable row level security;

drop policy if exists "att_select"              on public.attendance_records;
drop policy if exists "att_insert"              on public.attendance_records;
drop policy if exists "att_update"              on public.attendance_records;
drop policy if exists "att_delete"              on public.attendance_records;
drop policy if exists "attendance_owner_policy" on public.attendance_records;

-- ------------------------------------------------------------
-- 2) students (6 → 2)
-- 유지: students_owner_policy (ALL), students_public_read (포털)
-- 제거: stu_{select|insert|update|delete} — students_owner_policy 와 의미 동일
-- ------------------------------------------------------------
alter table public.students enable row level security;

drop policy if exists "stu_select" on public.students;
drop policy if exists "stu_insert" on public.students;
drop policy if exists "stu_update" on public.students;
drop policy if exists "stu_delete" on public.students;

-- ------------------------------------------------------------
-- 3) schedules (6 → 2)
-- 유지: schedules_owner_policy (ALL), homework_schedules_read (포털)
-- 제거: 한글명 4개 — schedules_owner_policy 와 의미 동일
-- ------------------------------------------------------------
alter table public.schedules enable row level security;

drop policy if exists "사용자는 자신의 일정만 조회 가능" on public.schedules;
drop policy if exists "사용자는 자신의 일정만 추가 가능" on public.schedules;
drop policy if exists "사용자는 자신의 일정만 수정 가능" on public.schedules;
drop policy if exists "사용자는 자신의 일정만 삭제 가능" on public.schedules;

-- ------------------------------------------------------------
-- 4) student_evaluations (6 → 2)
-- 유지: evaluations_owner_policy (ALL), evaluations_public_read (포털, parent_visible AND parent_code)
-- 제거: se_owner_{read|insert|update|delete} — evaluations_owner_policy 와 의미 동일
-- ------------------------------------------------------------
alter table public.student_evaluations enable row level security;

drop policy if exists "se_owner_read"   on public.student_evaluations;
drop policy if exists "se_owner_insert" on public.student_evaluations;
drop policy if exists "se_owner_update" on public.student_evaluations;
drop policy if exists "se_owner_delete" on public.student_evaluations;

-- ------------------------------------------------------------
-- 5) holidays (5 → 1)
-- 유지: holidays_owner_policy (ALL)
-- 제거: 한글명 4개 — 의미 동일
-- ------------------------------------------------------------
alter table public.holidays enable row level security;

drop policy if exists "사용자는 자신의 휴일정보만 조회 가능" on public.holidays;
drop policy if exists "사용자는 자신의 휴일정보만 추가 가능" on public.holidays;
drop policy if exists "사용자는 자신의 휴일정보만 수정 가능" on public.holidays;
drop policy if exists "사용자는 자신의 휴일정보만 삭제 가능" on public.holidays;

-- ------------------------------------------------------------
-- 6) payments (5 → 1)
-- 유지: payments_owner_policy (ALL)
-- 제거: 한글명 4개 — 의미 동일
-- ------------------------------------------------------------
alter table public.payments enable row level security;

drop policy if exists "사용자는 자신의 결제정보만 조회 가능" on public.payments;
drop policy if exists "사용자는 자신의 결제정보만 추가 가능" on public.payments;
drop policy if exists "사용자는 자신의 결제정보만 수정 가능" on public.payments;
drop policy if exists "사용자는 자신의 결제정보만 삭제 가능" on public.payments;

-- ------------------------------------------------------------
-- 7) teacher_reset_codes (5 → 1)
-- 유지: reset_codes_owner_policy (ALL)
-- 제거: owner_{select|insert|update|delete}_reset_codes — 의미 동일
-- ------------------------------------------------------------
alter table public.teacher_reset_codes enable row level security;

drop policy if exists "owner_select_reset_codes" on public.teacher_reset_codes;
drop policy if exists "owner_insert_reset_codes" on public.teacher_reset_codes;
drop policy if exists "owner_update_reset_codes" on public.teacher_reset_codes;
drop policy if exists "owner_delete_reset_codes" on public.teacher_reset_codes;

-- ------------------------------------------------------------
-- 본 파일에서 손대지 않은 항목 (별도 검토 필요):
--   * teachers.teachers_read_all
--       qual: auth.role() = 'authenticated'
--       → 로그인한 모든 사용자가 모든 교사를 SELECT 가능. 의도 확인 필요.
--   * answer_keys.answer_keys_read
--       qual: auth.role() = 'authenticated'
--       → 로그인한 모든 사용자가 모든 정답지를 SELECT 가능. 공유 의도면 OK,
--         아니면 (auth.uid() = teacher_id) 로 축소 필요.
--   * RLS initplan 최적화: 본 통합 후 attendance_app_owner_*, *_owner_policy,
--     *_public_read 등 잔존 정책의 auth.uid() / auth.role() 호출을
--     (select auth.uid()) / (select auth.role()) 로 래핑 (advisor 69건 해소).
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증 1) 정책 수 변화 확인 (예상치)
-- ------------------------------------------------------------
-- attendance_records       : 10 → 5
-- students                 :  6 → 2
-- schedules                :  6 → 2
-- student_evaluations      :  6 → 2
-- holidays                 :  5 → 1
-- payments                 :  5 → 1
-- teacher_reset_codes      :  5 → 1
-- ============================================================
select tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
  and tablename in (
    'attendance_records',
    'students',
    'schedules',
    'student_evaluations',
    'holidays',
    'payments',
    'teacher_reset_codes'
  )
group by tablename
order by tablename;

-- ============================================================
-- 검증 2) 잔존 정책 목록 (의도한 정책만 남았는지 육안 확인)
-- ============================================================
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in (
    'attendance_records',
    'students',
    'schedules',
    'student_evaluations',
    'holidays',
    'payments',
    'teacher_reset_codes'
  )
order by tablename, policyname;

-- ============================================================
-- 검증 3) RLS 활성화 상태 (모두 true 여야 함)
-- ============================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'attendance_records',
    'students',
    'schedules',
    'student_evaluations',
    'holidays',
    'payments',
    'teacher_reset_codes'
  )
order by c.relname;
