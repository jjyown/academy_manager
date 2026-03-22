-- ============================================================
-- 안전 재강화 2단계 (학생관리 140차)
-- 대상: attendance_records 앱 owner write 정책
-- 목표: 긴급복구 정책(owner_user_id is not null)에서 auth.uid() 기반 최소권한으로 축소
-- 주의: 포털 공개 조회 정책(attendance_public_read)은 건드리지 않는다.
-- ============================================================

begin;

alter table public.attendance_records enable row level security;

-- 앱 읽기(로그인 사용자) 재강화
drop policy if exists "attendance_app_owner_read" on public.attendance_records;
create policy "attendance_app_owner_read" on public.attendance_records
  for select
  using (
    owner_user_id = auth.uid()
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = auth.uid()
    )
  );

-- 앱 쓰기(INSERT) 재강화
drop policy if exists "attendance_app_owner_insert" on public.attendance_records;
create policy "attendance_app_owner_insert" on public.attendance_records
  for insert
  with check (
    owner_user_id = auth.uid()
    and teacher_id is not null
    and attendance_date is not null
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = auth.uid()
    )
  );

-- 앱 쓰기(UPDATE) 재강화
drop policy if exists "attendance_app_owner_update" on public.attendance_records;
create policy "attendance_app_owner_update" on public.attendance_records
  for update
  using (
    owner_user_id = auth.uid()
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = auth.uid()
    )
  )
  with check (
    owner_user_id = auth.uid()
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = auth.uid()
    )
  );

-- 앱 쓰기(DELETE) 재강화
drop policy if exists "attendance_app_owner_delete" on public.attendance_records;
create policy "attendance_app_owner_delete" on public.attendance_records
  for delete
  using (
    owner_user_id = auth.uid()
    and exists (
      select 1
      from public.students s
      where s.id = attendance_records.student_id
        and s.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증 1) 대상 정책 확인
-- ============================================================
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename='attendance_records'
  and policyname in (
    'attendance_app_owner_read',
    'attendance_app_owner_insert',
    'attendance_app_owner_update',
    'attendance_app_owner_delete'
  )
order by policyname, cmd;

-- ============================================================
-- 검증 2) RLS 상태 확인
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname='attendance_records';
