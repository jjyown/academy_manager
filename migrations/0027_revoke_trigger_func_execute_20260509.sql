-- ============================================================
-- 0027 SECURITY DEFINER 트리거 함수 EXECUTE 권한 회수 (v2)
-- 작성일: 2026-05-09
-- 목적: Supabase advisor 보안 경고 5건 해소
--   * 5개 함수가 SECURITY DEFINER 로 정의되어 있어 anon/authenticated 가
--     /rest/v1/rpc/<func> 로 직접 호출 가능했음 (의도 아님 — 트리거 전용).
--   * 함수 본문 확인 결과 모두 단순 트리거 함수:
--     - handle_new_user: auth.users → public.users 미러링 (auth 트리거)
--     - update_*_updated_at (4개): NEW.updated_at = NOW() 한 줄
-- 권한 현황:
--   * proacl: =X/postgres | postgres=X | anon=X | authenticated=X | service_role=X
--     → PUBLIC 롤에도 EXECUTE 가 부여돼 있어 anon/authenticated 만 회수해도
--       PUBLIC 상속으로 여전히 호출 가능. PUBLIC 까지 회수 필요.
-- 위험도: 매우 낮음 — 트리거 호출은 SECURITY DEFINER 로 owner(postgres) 권한
--        으로 실행되므로 EXECUTE 권한 회수와 무관하게 정상 동작.
-- 롤백:
--   GRANT EXECUTE ON FUNCTION public.<name>() TO anon, authenticated;
-- 변경 이력:
--   v1: 정적 REVOKE 5줄 → SQL Editor 에서 42883 (function does not exist) 발생
--   v2: pg_proc 조회 기반 DO 블록 동적 처리 + PUBLIC 도 함께 회수
-- ============================================================

do $$
declare
  rec record;
  func_count int := 0;
begin
  for rec in
    select
      n.nspname as schema_name,
      p.proname as func_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'handle_new_user',
        'update_attendance_updated_at',
        'update_holidays_updated_at',
        'update_payments_updated_at',
        'update_schedules_updated_at'
      )
  loop
    -- PUBLIC 롤(기본 상속) + 명시적 anon/authenticated 모두 회수
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      rec.schema_name, rec.func_name, rec.args
    );
    raise notice 'Revoked EXECUTE on %.%(%)',
      rec.schema_name, rec.func_name, rec.args;
    func_count := func_count + 1;
  end loop;
  raise notice 'Total functions processed: %', func_count;
end $$;

-- ============================================================
-- 검증) anon/authenticated 가 더 이상 EXECUTE 권한 없는지 확인
-- 기대: has_execute 컬럼 모두 false (총 10행: 5함수 × 2롤)
-- ============================================================
select
  r.rolname,
  p.proname,
  has_function_privilege(r.rolname, p.oid, 'execute') as has_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'),('authenticated')) as r(rolname)
where n.nspname = 'public'
  and p.proname in (
    'handle_new_user',
    'update_attendance_updated_at',
    'update_holidays_updated_at',
    'update_payments_updated_at',
    'update_schedules_updated_at'
  )
order by p.proname, r.rolname;

-- ============================================================
-- 검증 2) ACL 상태 (PUBLIC/anon/authenticated 가 빠지고 postgres/service_role 만 남아야 함)
-- ============================================================
select
  p.proname,
  array_to_string(p.proacl::text[], ' | ') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'handle_new_user',
    'update_attendance_updated_at',
    'update_holidays_updated_at',
    'update_payments_updated_at',
    'update_schedules_updated_at'
  )
order by p.proname;
