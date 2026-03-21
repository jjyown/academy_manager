-- ============================================================
-- 안전 재강화 1단계 (학생관리 139차)
-- 목적: 긴급복구 후 임시 완화된 teachers 공개 읽기 범위를 최소권한으로 축소
-- 원칙: 기능 영향 최소(메인 운영 + 포털 조회 유지), 즉시 롤백 가능
-- ============================================================

begin;

alter table public.teachers enable row level security;

-- 현재 정책(핫픽스): owner_user_id is not null
-- 1단계 목표: 로그인 owner 조회 + 포털 코드 연계 조회만 허용
drop policy if exists "teachers_public_read" on public.teachers;
create policy "teachers_public_read" on public.teachers
  for select
  using (
    owner_user_id = auth.uid()
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
-- 검증 1) teachers 정책 확인
-- ============================================================
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname='public' and tablename='teachers'
order by policyname, cmd;

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
where n.nspname='public' and c.relname='teachers';
