-- ============================================================
-- 학생관리 137차 긴급복구
-- 증상: attendance_records INSERT/UPSERT 401/42501 (RLS 차단)
-- 목적: 메인 앱 출석 저장/수정/삭제 경로 복구
-- ============================================================

begin;

alter table public.attendance_records enable row level security;

-- 앱(현재 owner 기반 클라이언트 흐름) 읽기 복구
drop policy if exists "attendance_app_owner_read" on public.attendance_records;
create policy "attendance_app_owner_read" on public.attendance_records
  for select
  using (
    owner_user_id is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = attendance_records.owner_user_id
    )
  );

-- 앱 쓰기 복구 (INSERT)
drop policy if exists "attendance_app_owner_insert" on public.attendance_records;
create policy "attendance_app_owner_insert" on public.attendance_records
  for insert
  with check (
    owner_user_id is not null
    and teacher_id is not null
    and attendance_date is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = attendance_records.owner_user_id
    )
  );

-- 앱 쓰기 복구 (UPDATE)
drop policy if exists "attendance_app_owner_update" on public.attendance_records;
create policy "attendance_app_owner_update" on public.attendance_records
  for update
  using (
    owner_user_id is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = attendance_records.owner_user_id
    )
  )
  with check (
    owner_user_id is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = attendance_records.owner_user_id
    )
  );

-- 앱 쓰기 복구 (DELETE: 미처리 전환/정리 경로)
drop policy if exists "attendance_app_owner_delete" on public.attendance_records;
create policy "attendance_app_owner_delete" on public.attendance_records
  for delete
  using (
    owner_user_id is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = attendance_records.owner_user_id
    )
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증 1) attendance_records 정책 확인
-- ============================================================
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'attendance_records'
order by policyname, cmd;

-- ============================================================
-- 검증 2) RLS 활성화 상태 확인
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'attendance_records';
