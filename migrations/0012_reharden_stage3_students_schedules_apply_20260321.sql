-- ============================================================
-- 안전 재강화 3단계 (학생관리 141차)
-- 대상: students/schedules 공개 읽기 정책
-- 목표: 긴급복구 시 완화한 공개 읽기 범위를 포털 코드 기반 최소권한으로 재축소
-- ============================================================

begin;

alter table public.students enable row level security;
alter table public.schedules enable row level security;

-- 1) students 공개 읽기 재강화
drop policy if exists "students_public_read" on public.students;
create policy "students_public_read" on public.students
  for select
  using (
    status = 'active'
    and (
      (parent_code is not null and btrim(parent_code) <> '')
      or (student_code is not null and btrim(student_code) <> '')
    )
  );

-- 2) schedules 공개 읽기 재강화(포털 코드 연계 학생 일정만 허용)
drop policy if exists "homework_schedules_read" on public.schedules;
create policy "homework_schedules_read" on public.schedules
  for select
  using (
    exists (
      select 1
      from public.students s
      where s.id = schedules.student_id
        and s.status = 'active'
        and (
          (s.student_code is not null and btrim(s.student_code) <> '')
          or (s.parent_code is not null and btrim(s.parent_code) <> '')
        )
    )
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증 1) 정책 확인
-- ============================================================
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname='public'
  and (
    (tablename='students' and policyname='students_public_read')
    or (tablename='schedules' and policyname='homework_schedules_read')
  )
order by tablename, policyname, cmd;

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
where n.nspname='public'
  and c.relname in ('students', 'schedules')
order by c.relname;
