-- ============================================================
-- 학생관리 134차 긴급복구
-- 증상: 메인 페이지에서 학생/특정일 일정이 갑자기 안 보임
-- 원인: teachers_public_read 정책 축소 후 현재 클라이언트 조회 경로와 충돌
-- 목적: 일정/담당교사 표시를 즉시 복구 (읽기 경로 한정)
-- ============================================================

begin;

alter table public.teachers enable row level security;

-- 읽기 경로 긴급 복구: 기존 UI 조회 호환을 위해 공개 읽기 범위를 임시 완화
drop policy if exists "teachers_public_read" on public.teachers;
create policy "teachers_public_read" on public.teachers
  for select
  using (owner_user_id is not null);

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증 1) 정책 확인
-- ============================================================
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
from pg_policies
where schemaname = 'public'
  and tablename = 'teachers'
order by policyname, cmd;

-- ============================================================
-- 검증 2) teachers 기본 조회 스모크 테스트
-- ============================================================
select id, name, teacher_role
from public.teachers
order by created_at desc
limit 20;
