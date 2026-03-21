-- ============================================================
-- 학생관리 133차 - teachers 정책 보강 + 검증 쿼리
-- 실행 위치: Supabase SQL Editor
-- ============================================================

begin;

alter table public.teachers enable row level security;

drop policy if exists "teachers_owner_policy" on public.teachers;
create policy "teachers_owner_policy" on public.teachers
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "teachers_public_read" on public.teachers;
create policy "teachers_public_read" on public.teachers
  for select
  using (
    teacher_role = 'admin'
    or exists (
      select 1
      from public.students s
      where s.teacher_id = teachers.id
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
-- 검증 1) 정책 정의 확인
-- ============================================================
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'teachers'
order by policyname, cmd;

-- ============================================================
-- 검증 2) RLS 활성화 확인
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'teachers';

-- ============================================================
-- 검증 3) 공개 조회 허용 대상 교사 샘플 확인
-- (정책식을 이해하기 위한 점검용 조회)
-- ============================================================
select
  t.id,
  t.name,
  t.teacher_role,
  exists (
    select 1
    from public.students s
    where s.teacher_id = t.id
      and s.status = 'active'
      and (
        (s.student_code is not null and btrim(s.student_code) <> '')
        or (s.parent_code is not null and btrim(s.parent_code) <> '')
      )
  ) as has_portal_active_students
from public.teachers t
order by t.created_at desc
limit 50;
