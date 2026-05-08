-- ============================================================
-- 안전 재강화 3단계 롤백 (학생관리 141차)
-- 대상: students/schedules 공개 읽기 정책
-- 목적: 이상징후 시 긴급복구 완화 정책으로 즉시 복귀
-- ============================================================

begin;

alter table public.students enable row level security;
alter table public.schedules enable row level security;

-- students 공개 읽기 롤백(핫픽스 완화 상태)
drop policy if exists "students_public_read" on public.students;
create policy "students_public_read" on public.students
  for select
  using (
    owner_user_id is not null
    or (
      status = 'active'
      and (
        (parent_code is not null and btrim(parent_code) <> '')
        or (student_code is not null and btrim(student_code) <> '')
      )
    )
  );

-- schedules 공개 읽기 롤백(핫픽스 완화 상태)
drop policy if exists "homework_schedules_read" on public.schedules;
create policy "homework_schedules_read" on public.schedules
  for select
  using (owner_user_id is not null);

notify pgrst, 'reload schema';

commit;

select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname='public'
  and (
    (tablename='students' and policyname='students_public_read')
    or (tablename='schedules' and policyname='homework_schedules_read')
  )
order by tablename, policyname, cmd;
