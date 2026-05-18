-- ============================================================
-- 0045 anon role DELETE 권한 명시적 회수 — 숙제관리 보안 다층 방어
-- 작성일: 2026-05-18
-- 출처: DISCUSSIONS.md 2026-05-18 17:00 숙제관리 토의 [종결] / plan v3 작업 ①
-- 목적:
--   * 현재 homework_submissions / grading_results / schedules 의 anon DELETE 는
--     RLS 정책 (owner_user_id = auth.uid()) 으로 이미 차단됨.
--   * 본 마이그레이션은 명시적 GRANT 권한 자체를 회수해 다층 방어 추가.
--   * 미래 RLS 정책 변경 시 실수로 anon DELETE 가 통과하는 사고 방지 안전망.
-- 사전 점검:
--   * SQL Editor 상단에서 운영 프로젝트 연결 확인:
--       select current_database(), inet_server_addr();
--     기대 database: postgres / 운영 프로젝트 ref: jzcrpdeomjmytfekcgqu
-- 영향:
--   * 운영자 (authenticated) DELETE 흐름 무손상 — authenticated role 에는 권한 유지
--   * 학생 포털 (anon) — INSERT/SELECT 만 사용, DELETE 사용 안 함 (검증: homework/index.html 에서
--     supabase-js `.delete()` 직통 호출 없음 확인됨)
-- 롤백 (문제 발생 시):
--   begin;
--   grant delete on public.homework_submissions to anon;
--   grant delete on public.grading_results to anon;
--   grant delete on public.schedules to anon;
--   commit;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) homework_submissions — anon DELETE 명시적 회수
-- ------------------------------------------------------------
revoke delete on public.homework_submissions from anon;

-- ------------------------------------------------------------
-- 2) grading_results — anon DELETE 명시적 회수
-- ------------------------------------------------------------
revoke delete on public.grading_results from anon;

-- ------------------------------------------------------------
-- 3) schedules — anon DELETE 명시적 회수
--    homework_schedules_read 정책으로 anon SELECT 만 허용된 테이블.
--    DELETE 권한 자체를 anon 에서 회수해 다층 방어.
-- ------------------------------------------------------------
revoke delete on public.schedules from anon;

commit;

-- ============================================================
-- 검증 SELECT — 적용 후 SQL Editor 에서 실행해 결과 확인
-- 기대: anon_can_delete = false (3행 모두)
-- ============================================================
select
  'homework_submissions' as table_name,
  has_table_privilege('anon', 'public.homework_submissions', 'DELETE') as anon_can_delete
union all
select
  'grading_results' as table_name,
  has_table_privilege('anon', 'public.grading_results', 'DELETE') as anon_can_delete
union all
select
  'schedules' as table_name,
  has_table_privilege('anon', 'public.schedules', 'DELETE') as anon_can_delete
order by table_name;

-- ============================================================
-- 추가 검증 — 운영자 (authenticated) DELETE 권한 유지 확인
-- 기대: authenticated_can_delete = true (3행 모두)
-- ============================================================
select
  'homework_submissions' as table_name,
  has_table_privilege('authenticated', 'public.homework_submissions', 'DELETE') as authenticated_can_delete
union all
select
  'grading_results' as table_name,
  has_table_privilege('authenticated', 'public.grading_results', 'DELETE') as authenticated_can_delete
union all
select
  'schedules' as table_name,
  has_table_privilege('authenticated', 'public.schedules', 'DELETE') as authenticated_can_delete
order by table_name;
