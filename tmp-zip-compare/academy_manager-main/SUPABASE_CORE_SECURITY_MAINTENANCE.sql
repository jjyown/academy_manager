-- 목적:
--   core 테이블 RLS 정책/스키마 일관성을 점검하고, 필요 시 안전하게 보정한다.
--
-- 포함 범위:
--   1) owner 정책 과허용 패턴( owner_user_id IS NOT NULL ) 점검/보정
--   2) 공개 read 정책(USING true) 점검/선택 제한
--   3) homework_submissions.teacher_id 타입 일관성 점검/보정(TEXT -> teachers.id)
--
-- 안전 기본값:
--   apply_changes = false (DRY-RUN)
--
-- 사용 순서:
--   [A] 점검 실행
--   [B] apply_changes=true 로 변경 후 보정 실행(필요한 옵션만 켜기)
--   [C] 재점검 실행

/* =========================================================
   [A] 점검(READ ONLY)
   ========================================================= */

-- A-1) public 테이블 RLS 활성 상태
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname IN (
      'students',
      'teachers',
      'schedules',
      'attendance_records',
      'student_evaluations',
      'homework_submissions',
      'payments',
      'holidays'
  )
ORDER BY c.relname;

-- A-2) 정책 점검(과허용/공개정책 탐지)
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
      'students',
      'teachers',
      'schedules',
      'attendance_records',
      'student_evaluations',
      'homework_submissions',
      'payments',
      'holidays'
  )
ORDER BY tablename, policyname;

-- A-3) homework_submissions.teacher_id 타입 점검
SELECT
    table_schema,
    table_name,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'homework_submissions'
  AND column_name = 'teacher_id';

-- A-4) homework_submissions.teacher_id 관련 FK 점검
SELECT
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'homework_submissions'
  AND c.contype = 'f'
ORDER BY c.conname;

/* =========================================================
   [B] 보정(APPLY)
   ========================================================= */

DO $$
DECLARE
    apply_changes boolean := false;                  -- true면 실제 반영
    harden_owner_policies boolean := true;           -- owner 과허용 정책 보정
    restrict_public_read_policies boolean := false;  -- 공개 read 정책 제한
    keep_homework_public_flow boolean := true;       -- homework 공개 흐름 유지
    normalize_homework_teacher_id_type boolean := true; -- teacher_id 타입 정합성 보정

    rec record;
    teacher_id_data_type text;
    teachers_id_data_type text;
    homework_has_owner_policy boolean;
    homework_has_public_insert_policy boolean;
    homework_has_public_read_policy boolean;
BEGIN
    -- B-1) owner 정책 보정
    IF harden_owner_policies THEN
        FOR rec IN
            SELECT * FROM (VALUES
                ('public','students','students_owner_policy'),
                ('public','teachers','teachers_owner_policy'),
                ('public','attendance_records','attendance_owner_policy'),
                ('public','student_evaluations','evaluations_owner_policy'),
                ('public','homework_submissions','homework_owner_policy')
            ) AS t(schema_name, table_name, policy_name)
        LOOP
            IF apply_changes THEN
                EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policy_name, rec.schema_name, rec.table_name);
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid())',
                    rec.policy_name, rec.schema_name, rec.table_name
                );
                RAISE NOTICE '[APPLY] owner 정책 보정 완료: %.%.%', rec.schema_name, rec.table_name, rec.policy_name;
            ELSE
                RAISE NOTICE '[DRY-RUN] owner 정책 보정 대상: %.%.%', rec.schema_name, rec.table_name, rec.policy_name;
            END IF;
        END LOOP;
    END IF;

    -- B-2) 공개 read 정책 제한(옵션)
    IF restrict_public_read_policies THEN
        FOR rec IN
            SELECT * FROM (VALUES
                ('public','students','students_public_read'),
                ('public','teachers','teachers_public_read'),
                ('public','attendance_records','attendance_public_read'),
                ('public','student_evaluations','evaluations_public_read'),
                ('public','homework_submissions','homework_public_read'),
                ('public','schedules','homework_schedules_read')
            ) AS t(schema_name, table_name, policy_name)
        LOOP
            IF keep_homework_public_flow
               AND rec.table_name IN ('homework_submissions', 'schedules')
               AND rec.policy_name IN ('homework_public_read', 'homework_schedules_read') THEN
                RAISE NOTICE '[SKIP] homework 공개 흐름 유지: %.%.%', rec.schema_name, rec.table_name, rec.policy_name;
                CONTINUE;
            END IF;

            IF apply_changes THEN
                EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policy_name, rec.schema_name, rec.table_name);
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I FOR SELECT USING (auth.role() = ''authenticated'')',
                    rec.policy_name, rec.schema_name, rec.table_name
                );
                RAISE NOTICE '[APPLY] 공개 read 정책 제한 완료: %.%.%', rec.schema_name, rec.table_name, rec.policy_name;
            ELSE
                RAISE NOTICE '[DRY-RUN] 공개 read 제한 대상: %.%.%', rec.schema_name, rec.table_name, rec.policy_name;
            END IF;
        END LOOP;
    END IF;

    -- B-3) homework_submissions.teacher_id 타입 정합성 보정
    IF normalize_homework_teacher_id_type THEN
        SELECT data_type
        INTO teachers_id_data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'teachers'
          AND column_name = 'id';

        SELECT data_type
        INTO teacher_id_data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'homework_submissions'
          AND column_name = 'teacher_id';

        IF teacher_id_data_type IS NULL THEN
            RAISE NOTICE '[SKIP] homework_submissions.teacher_id 컬럼 없음';
        ELSIF teachers_id_data_type IS NULL THEN
            RAISE NOTICE '[SKIP] teachers.id 컬럼 타입 확인 실패';
        ELSIF teacher_id_data_type <> teachers_id_data_type THEN
            IF apply_changes THEN
                -- teacher_id를 참조하는 정책이 있으면 타입 변경이 실패하므로
                -- homework_submissions 정책을 먼저 안전하게 정리한다.
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'homework_submissions'
                      AND policyname = 'homework_owner_policy'
                ) INTO homework_has_owner_policy;

                SELECT EXISTS (
                    SELECT 1
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'homework_submissions'
                      AND policyname = 'homework_public_insert'
                ) INTO homework_has_public_insert_policy;

                SELECT EXISTS (
                    SELECT 1
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'homework_submissions'
                      AND policyname = 'homework_public_read'
                ) INTO homework_has_public_read_policy;

                FOR rec IN
                    SELECT policyname
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'homework_submissions'
                LOOP
                    EXECUTE format('DROP POLICY IF EXISTS %I ON public.homework_submissions', rec.policyname);
                END LOOP;

                -- teacher_id 컬럼에 걸린 FK 제약 제거
                FOR rec IN
                    SELECT c.conname
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
                    WHERE n.nspname = 'public'
                      AND t.relname = 'homework_submissions'
                      AND c.contype = 'f'
                      AND a.attname = 'teacher_id'
                LOOP
                    EXECUTE format('ALTER TABLE public.homework_submissions DROP CONSTRAINT IF EXISTS %I', rec.conname);
                END LOOP;

                IF teachers_id_data_type = 'uuid' THEN
                    -- UUID 형식이 아닌 값은 NULL로 정리해 타입 변환 실패를 방지
                    EXECUTE $sql$
                        UPDATE public.homework_submissions
                        SET teacher_id = NULL
                        WHERE teacher_id IS NOT NULL
                          AND btrim(teacher_id::text) <> ''
                          AND NOT (
                              teacher_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                          )
                    $sql$;
                    EXECUTE $sql$
                        ALTER TABLE public.homework_submissions
                        ALTER COLUMN teacher_id TYPE uuid
                        USING CASE
                            WHEN teacher_id IS NULL OR btrim(teacher_id::text) = '' THEN NULL
                            ELSE teacher_id::text::uuid
                        END
                    $sql$;
                ELSIF teachers_id_data_type = 'text' THEN
                    EXECUTE 'ALTER TABLE public.homework_submissions ALTER COLUMN teacher_id TYPE text USING teacher_id::text';
                ELSE
                    RAISE NOTICE '[SKIP] 미지원 teachers.id 타입: %', teachers_id_data_type;
                END IF;

                BEGIN
                    EXECUTE 'ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE';
                EXCEPTION
                    WHEN duplicate_object THEN NULL;
                END;

                -- 타입 변경 후 기본 정책 재생성
                IF homework_has_owner_policy THEN
                    EXECUTE 'CREATE POLICY homework_owner_policy ON public.homework_submissions FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid())';
                END IF;

                IF keep_homework_public_flow AND homework_has_public_insert_policy THEN
                    EXECUTE 'CREATE POLICY homework_public_insert ON public.homework_submissions FOR INSERT WITH CHECK (true)';
                END IF;

                IF homework_has_public_read_policy THEN
                    IF keep_homework_public_flow AND NOT restrict_public_read_policies THEN
                        EXECUTE 'CREATE POLICY homework_public_read ON public.homework_submissions FOR SELECT USING (true)';
                    ELSE
                        EXECUTE 'CREATE POLICY homework_public_read ON public.homework_submissions FOR SELECT USING (auth.role() = ''authenticated'')';
                    END IF;
                END IF;

                RAISE NOTICE '[APPLY] homework_submissions.teacher_id 타입 보정 완료 (% -> %)', teacher_id_data_type, teachers_id_data_type;
            ELSE
                RAISE NOTICE '[DRY-RUN] homework_submissions.teacher_id 타입 보정 대상 (% -> %)', teacher_id_data_type, teachers_id_data_type;
            END IF;
        ELSE
            RAISE NOTICE '[SKIP] homework_submissions.teacher_id 타입 이미 teachers.id와 일치(%)', teacher_id_data_type;
        END IF;
    END IF;
END $$;

/* =========================================================
   [C] 재점검(READ ONLY)
   ========================================================= */

SELECT
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'students',
      'teachers',
      'schedules',
      'attendance_records',
      'student_evaluations',
      'homework_submissions'
  )
ORDER BY tablename, policyname;

SELECT
    table_schema,
    table_name,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'homework_submissions'
  AND column_name = 'teacher_id';
