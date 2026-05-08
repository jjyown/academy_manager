-- 학생 테스트 점수 동기화 테이블 + RLS 설정
-- 실행 위치: Supabase SQL Editor

create table if not exists public.student_test_scores (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null,
    student_id bigint not null references public.students(id) on delete cascade,
    teacher_id text,
    exam_name text not null,
    exam_date date not null,
    score numeric(8,2) not null default 0,
    max_score numeric(8,2) not null default 100,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint student_test_scores_score_check check (score >= 0),
    constraint student_test_scores_max_score_check check (max_score > 0),
    constraint student_test_scores_score_max_check check (score <= max_score)
);

create index if not exists idx_student_test_scores_owner_student_date
    on public.student_test_scores (owner_user_id, student_id, exam_date desc);

create index if not exists idx_student_test_scores_owner_teacher
    on public.student_test_scores (owner_user_id, teacher_id);

alter table public.student_test_scores enable row level security;

drop policy if exists "student_test_scores_select_owner" on public.student_test_scores;
create policy "student_test_scores_select_owner"
on public.student_test_scores
for select
using (owner_user_id = auth.uid());

drop policy if exists "student_test_scores_insert_owner" on public.student_test_scores;
create policy "student_test_scores_insert_owner"
on public.student_test_scores
for insert
with check (owner_user_id = auth.uid());

drop policy if exists "student_test_scores_update_owner" on public.student_test_scores;
create policy "student_test_scores_update_owner"
on public.student_test_scores
for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "student_test_scores_delete_owner" on public.student_test_scores;
create policy "student_test_scores_delete_owner"
on public.student_test_scores
for delete
using (owner_user_id = auth.uid());

notify pgrst, 'reload schema';
