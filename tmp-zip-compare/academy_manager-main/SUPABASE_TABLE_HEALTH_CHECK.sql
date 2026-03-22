-- 목적:
--   운영 DB 핵심 테이블의 구조/정합성/보안 상태를 한 번에 점검한다.
--   (READ ONLY: 데이터 변경 없음)
--
-- 점검 항목:
--   1) 테이블 존재 여부/행 수
--   2) 핵심 컬럼 타입 정합성
--   3) FK 제약/고아 데이터 여부
--   4) RLS 활성화/정책 상태
--   5) 인덱스 상태

/* =========================================================
   [1] 핵심 테이블 존재 + 행 수
   ========================================================= */
WITH target_tables AS (
    SELECT * FROM (VALUES
        ('public','users'),
        ('public','teachers'),
        ('public','students'),
        ('public','schedules'),
        ('public','attendance_records'),
        ('public','homework_submissions'),
        ('public','student_test_scores'),
        ('public','expense_ledgers'),
        ('public','student_evaluations'),
        ('public','payments'),
        ('public','holidays')
    ) AS t(schema_name, table_name)
),
existing_tables AS (
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
)
SELECT
    tt.schema_name,
    tt.table_name,
    (et.oid IS NOT NULL) AS table_exists,
    CASE
        WHEN et.oid IS NULL THEN NULL
        ELSE (SELECT reltuples::bigint FROM pg_class WHERE oid = et.oid)
    END AS approx_rows
FROM target_tables tt
LEFT JOIN existing_tables et
  ON et.schema_name = tt.schema_name
 AND et.table_name = tt.table_name
ORDER BY tt.schema_name, tt.table_name;

/* =========================================================
   [2] 핵심 컬럼 타입 정합성
   ========================================================= */
SELECT table_schema, table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'teachers' AND column_name IN ('id', 'owner_user_id'))
      OR (table_name = 'students' AND column_name IN ('id', 'owner_user_id', 'teacher_id'))
      OR (table_name = 'homework_submissions' AND column_name IN ('owner_user_id', 'teacher_id', 'student_id'))
      OR (table_name = 'attendance_records' AND column_name IN ('owner_user_id', 'teacher_id', 'student_id', 'scheduled_time'))
      OR (table_name = 'student_test_scores' AND column_name IN ('owner_user_id', 'teacher_id', 'student_id'))
      OR (table_name = 'expense_ledgers' AND column_name IN ('id', 'owner_user_id'))
  )
ORDER BY table_name, column_name;

/* teachers.id vs homework_submissions.teacher_id 타입 비교 */
WITH t AS (
    SELECT data_type AS teachers_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'id'
),
h AS (
    SELECT data_type AS homework_teacher_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'homework_submissions' AND column_name = 'teacher_id'
)
SELECT
    t.teachers_id_type,
    h.homework_teacher_id_type,
    (t.teachers_id_type = h.homework_teacher_id_type) AS type_match
FROM t CROSS JOIN h;

/* =========================================================
   [3] FK 제약 상태
   ========================================================= */
SELECT
    n.nspname AS schema_name,
    t.relname AS table_name,
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
      'students',
      'schedules',
      'attendance_records',
      'homework_submissions',
      'student_test_scores',
      'expense_ledgers',
      'student_evaluations',
      'payments',
      'holidays'
  )
  AND c.contype = 'f'
ORDER BY t.relname, c.conname;

/* =========================================================
   [4] 고아 데이터(참조 무결성) 점검
   ========================================================= */
SELECT 'students.teacher_id -> teachers.id' AS check_name, count(*) AS orphan_count
FROM public.students s
LEFT JOIN public.teachers t ON s.teacher_id = t.id
WHERE s.teacher_id IS NOT NULL
  AND t.id IS NULL
UNION ALL
SELECT 'schedules.student_id -> students.id', count(*)
FROM public.schedules sc
LEFT JOIN public.students s ON sc.student_id = s.id
WHERE sc.student_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'schedules.teacher_id -> teachers.id', count(*)
FROM public.schedules sc
LEFT JOIN public.teachers t ON sc.teacher_id = t.id
WHERE sc.teacher_id IS NOT NULL
  AND t.id IS NULL
UNION ALL
SELECT 'attendance_records.student_id -> students.id', count(*)
FROM public.attendance_records ar
LEFT JOIN public.students s ON ar.student_id = s.id
WHERE ar.student_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'attendance_records.teacher_id -> teachers.id', count(*)
FROM public.attendance_records ar
LEFT JOIN public.teachers t ON ar.teacher_id = t.id
WHERE ar.teacher_id IS NOT NULL
  AND t.id IS NULL
UNION ALL
SELECT 'homework_submissions.student_id -> students.id', count(*)
FROM public.homework_submissions hs
LEFT JOIN public.students s ON hs.student_id = s.id
WHERE hs.student_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'homework_submissions.teacher_id -> teachers.id', count(*)
FROM public.homework_submissions hs
LEFT JOIN public.teachers t ON hs.teacher_id = t.id
WHERE hs.teacher_id IS NOT NULL
  AND t.id IS NULL;

/* =========================================================
   [5] RLS 활성 상태 + 정책 점검
   ========================================================= */
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname IN (
      'users',
      'teachers',
      'students',
      'schedules',
      'attendance_records',
      'homework_submissions',
      'student_test_scores',
      'expense_ledgers',
      'student_evaluations',
      'payments',
      'holidays'
  )
ORDER BY c.relname;

SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check,
    CASE
        WHEN COALESCE(qual, '') ILIKE '%owner_user_id = auth.uid()%'
             AND COALESCE(qual, '') ILIKE '%owner_user_id is not null%'
            THEN 'RISK: owner 과허용'
        WHEN COALESCE(qual, '') = 'true'
            THEN 'RISK: 공개 read'
        WHEN COALESCE(with_check, '') = 'true'
            THEN 'RISK: 공개 insert/update'
        ELSE 'OK/REVIEW'
    END AS review_tag
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'teachers',
      'students',
      'schedules',
      'attendance_records',
      'homework_submissions',
      'student_test_scores',
      'expense_ledgers',
      'student_evaluations',
      'payments',
      'holidays'
  )
ORDER BY tablename, policyname;

/* =========================================================
   [6] 인덱스 점검
   ========================================================= */
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
      'teachers',
      'students',
      'schedules',
      'attendance_records',
      'homework_submissions',
      'student_test_scores',
      'expense_ledgers'
  )
ORDER BY tablename, indexname;
