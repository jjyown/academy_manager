-- SUPABASE_PARENT_PORTAL_ATTENDANCE_READ_RESTORE.sql
-- 목적:
-- 1) 학부모 포털의 출결 달력/상세 조회에서 사용하는 attendance_records anon SELECT 경로를 복구한다.
-- 2) 정책 적용 전/후 상태를 같은 파일에서 점검한다.
--
-- 사용 순서:
-- [A] 점검 쿼리 실행 -> [B] 복구 블록 실행 -> [C] 재점검 실행

-- ============================================================
-- [A] 현재 상태 점검
-- ============================================================
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('students', 'attendance_records')
order by c.relname;

select schemaname,
       tablename,
       policyname,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('students', 'attendance_records')
order by tablename, policyname;

-- 운영 데이터 확인
select
  (select count(*) from public.students where status = 'active') as active_students,
  (select count(*) from public.students where parent_code is not null and btrim(parent_code) <> '') as parent_code_rows,
  (select count(*) from public.attendance_records) as attendance_rows;

-- ============================================================
-- [B] 정책 복구
-- ============================================================
begin;

alter table public.students enable row level security;
alter table public.attendance_records enable row level security;

-- students: 포털 코드 조회용 public read (이미 적용되어 있어도 덮어씀)
drop policy if exists "students_public_read" on public.students;
create policy "students_public_read" on public.students
for select using (
  status = 'active'
  and (
    (parent_code is not null and btrim(parent_code) <> '')
    or
    (student_code is not null and btrim(student_code) <> '')
  )
);

-- attendance_records: 학부모 포털 출결 조회용 public read
drop policy if exists "attendance_public_read" on public.attendance_records;
drop policy if exists "attendance_records_public_read" on public.attendance_records;
create policy "attendance_public_read" on public.attendance_records
for select using (
  exists (
    select 1
    from public.students s
    where s.id = attendance_records.student_id
      and s.status = 'active'
      and (
        (s.parent_code is not null and btrim(s.parent_code) <> '')
        or
        (s.student_code is not null and btrim(s.student_code) <> '')
      )
  )
);

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
  and tablename in ('students', 'attendance_records')
order by tablename, policyname;
