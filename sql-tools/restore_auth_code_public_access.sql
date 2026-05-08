-- SUPABASE_AUTH_CODE_PUBLIC_ACCESS_RESTORE.sql
-- 목적:
-- 1) 숙제제출(student_code), 학부모포털(parent_code) 인증코드 조회가 anon 환경에서 다시 동작하도록
--    public read 정책을 복구한다.
-- 2) 최근 정책 상태를 먼저 확인하고, 복구 후 재확인한다.
--
-- 사용 순서:
-- [A] 점검 쿼리 실행 -> [B] 복구 블록 실행 -> [C] 재점검 쿼리 실행

-- ============================================================
-- [A] 현재 정책/상태 점검
-- ============================================================
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('students', 'homework_submissions')
order by c.relname;

select schemaname,
       tablename,
       policyname,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('students', 'homework_submissions')
order by tablename, policyname;

-- 데이터 존재 여부(운영 데이터 유무 확인)
select
  (select count(*) from public.students where status = 'active') as active_students,
  (select count(*) from public.students where parent_code is not null and trim(parent_code) <> '') as parent_code_rows,
  (select count(*) from public.students where student_code is not null and trim(student_code) <> '') as student_code_rows;

-- ============================================================
-- [B] 정책 복구 (트랜잭션)
-- ============================================================
begin;

alter table public.students enable row level security;
alter table public.homework_submissions enable row level security;

drop policy if exists "students_public_read" on public.students;
create policy "students_public_read" on public.students
for select using (true);

drop policy if exists "homework_public_read" on public.homework_submissions;
create policy "homework_public_read" on public.homework_submissions
for select using (true);

drop policy if exists "homework_public_insert" on public.homework_submissions;
create policy "homework_public_insert" on public.homework_submissions
for insert with check (true);

commit;

notify pgrst, 'reload schema';

-- ============================================================
-- [C] 복구 후 재점검
-- ============================================================
select schemaname,
       tablename,
       policyname,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('students', 'homework_submissions')
order by tablename, policyname;

