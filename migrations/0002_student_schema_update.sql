-- 학생 스키마 확장 (재원상태/시작일/종료일/보호자)
-- 실행 위치: Supabase SQL Editor

alter table if exists public.students
    add column if not exists guardian_name text,
    add column if not exists enrollment_start_date date,
    add column if not exists enrollment_end_date date;

-- 상태값 체크 제약이 이미 있고 값이 오래된 경우 교체
do $$
begin
    if exists (
        select 1
        from pg_constraint
        where conname = 'students_status_check'
    ) then
        alter table public.students drop constraint students_status_check;
    end if;

    alter table public.students
        add constraint students_status_check
        check (status in ('active', 'paused', 'archived', 'inactive', 'graduated'));
exception
    when duplicate_object then null;
end $$;

create index if not exists idx_students_enroll_start on public.students (enrollment_start_date);
create index if not exists idx_students_enroll_end on public.students (enrollment_end_date);

notify pgrst, 'reload schema';
