-- ============================================================
-- 안전 재강화 2단계 롤백 (학생관리 140차)
-- 대상: attendance_records 앱 owner write 정책
-- 목적: 기능 이상 시 긴급복구 정책(owner_user_id is not null)으로 즉시 복귀
-- ============================================================

begin;

alter table public.attendance_records enable row level security;

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
