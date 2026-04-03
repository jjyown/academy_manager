-- =============================================================================
-- 메인 캘린더 일정(schedules) vs 출석(attendance_records) — Supabase SQL Editor 점검용
-- READ ONLY (SELECT). 아래 UUID·날짜를 본인 환경에 맞게 수정한 뒤 실행하세요.
-- =============================================================================
-- Railway: 메인 앱의 `schedules` 조회는 하지 않습니다. 프론트가 Supabase에 직접 요청합니다.
-- 일정 누락이면 Supabase(데이터·RLS·프로젝트·키)를 먼저 확인하는 것이 맞습니다.
-- =============================================================================

-- [0] 원장(Owner) UUID — 앱 localStorage current_owner_id 또는 auth.users / public.users 와 동일한지 확인
-- 예시: '509b3497-2923-4c16-b220-5099092dab76'

-- ---------------------------------------------------------------------------
-- [1] RLS 활성 여부
-- ---------------------------------------------------------------------------
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('schedules', 'attendance_records', 'students', 'teachers')
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- [2] 원장별 schedules 월별 건수 (최근 24개월)
--     : 아래 owner_user_id 를 수정
-- ---------------------------------------------------------------------------
SELECT date_trunc('month', schedule_date)::date AS month_start, count(*) AS schedule_rows
FROM public.schedules
WHERE owner_user_id = 'REPLACE_WITH_YOUR_OWNER_UUID'::uuid
GROUP BY 1
ORDER BY 1 DESC
LIMIT 24;

-- ---------------------------------------------------------------------------
-- [3] 특정 월 teacher_id 별 schedules 건수 (앱에서 고른 선생님 id 와 일치하는지 비교)
--     : owner_user_id, 기간 수정
-- ---------------------------------------------------------------------------
SELECT teacher_id, count(*) AS cnt
FROM public.schedules
WHERE owner_user_id = 'REPLACE_WITH_YOUR_OWNER_UUID'::uuid
  AND schedule_date >= '2026-03-01'::date
  AND schedule_date <  '2026-04-01'::date
GROUP BY teacher_id
ORDER BY cnt DESC;

-- ---------------------------------------------------------------------------
-- [4] schedules.teacher_id 가 teachers 에 없는 경우(고아) — UI 집계에서 누락될 수 있음
--     : owner 수정
-- ---------------------------------------------------------------------------
SELECT sc.teacher_id, count(*) AS orphan_rows
FROM public.schedules sc
LEFT JOIN public.teachers t ON t.id::text = sc.teacher_id::text
WHERE sc.owner_user_id = 'REPLACE_WITH_YOUR_OWNER_UUID'::uuid
  AND t.id IS NULL
  AND sc.teacher_id IS NOT NULL
  AND btrim(sc.teacher_id::text) <> ''
GROUP BY sc.teacher_id;

-- ---------------------------------------------------------------------------
-- [5] 출석 행은 있는데 동일 owner·학생·날짜·teacher 로 schedules 가 없는 샘플
--     (출석만 있고 시간표 행이 없는 케이스 / teacher_id 불일치 포함)
--     : owner·기간 수정
-- ---------------------------------------------------------------------------
SELECT ar.attendance_date, ar.student_id, ar.teacher_id::text AS attendance_teacher_id
FROM public.attendance_records ar
LEFT JOIN public.schedules sc
  ON sc.owner_user_id = ar.owner_user_id
 AND sc.student_id = ar.student_id
 AND sc.schedule_date = ar.attendance_date
 AND sc.teacher_id::text = ar.teacher_id::text
WHERE ar.owner_user_id = 'REPLACE_WITH_YOUR_OWNER_UUID'::uuid
  AND ar.attendance_date >= '2026-03-01'::date
  AND ar.attendance_date <  '2026-04-01'::date
  AND sc.id IS NULL
LIMIT 50;

-- ---------------------------------------------------------------------------
-- [6] RLS 정책 확인 (schedules) — owner 본인 데이터만 허용하는지
--     레포 기본: schedules_owner_policy → USING (owner_user_id = auth.uid())
-- ---------------------------------------------------------------------------
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'schedules';

-- ---------------------------------------------------------------------------
-- [7] 수동 체크리스트 (SQL 아님)
--     - Dashboard → Authentication → Users: 로그인 uid 가 schedules.owner_user_id 와 같은지
--     - Vercel/배포: SUPABASE_URL·anon key 가 이 프로젝트 것인지 (다른 프로젝트 키면 행 0건)
--     - 브라우저 DevTools → Network → schedules 요청: status 200, 응답 JSON 행 수
-- ---------------------------------------------------------------------------
