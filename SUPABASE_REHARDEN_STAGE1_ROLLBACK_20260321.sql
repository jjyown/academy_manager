-- ============================================================
-- 안전 재강화 1단계 롤백 (학생관리 139차)
-- 목적: 1단계 적용 후 기능 이상 시 즉시 긴급복구 정책으로 복귀
-- ============================================================

begin;

alter table public.teachers enable row level security;

drop policy if exists "teachers_public_read" on public.teachers;
create policy "teachers_public_read" on public.teachers
  for select
  using (owner_user_id is not null);

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증) 롤백 정책 확인
-- ============================================================
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname='public' and tablename='teachers'
order by policyname, cmd;
