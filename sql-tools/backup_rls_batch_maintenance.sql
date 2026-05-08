-- 목적:
--   public.backup_* 테이블에 대해 RLS/권한 상태를 일괄 점검하고
--   필요 시 일괄 보정(유지+잠금 또는 삭제)한다.
--
-- 사용 순서:
--   1) [A] 점검 쿼리 먼저 실행 (변경 없음)
--   2) [B] 조치 블록의 옵션 설정
--   3) [B] 조치 블록 실행
--   4) [C] 재점검 쿼리로 결과 확인
--
-- 안전 기본값:
--   apply_changes=false (기본: 실제 변경 없음)
--   drop_backups=false (기본: 삭제하지 않고 유지+잠금)

/* =========================================================
   [A] 점검(READ ONLY)
   ========================================================= */

-- 1) public.backup_* 테이블 목록 + RLS 활성 상태
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname LIKE 'backup\_%' ESCAPE '\'
ORDER BY c.relname;

-- 2) anon/authenticated 권한(테이블 단위)
SELECT
    table_schema,
    table_name,
    grantee,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'backup\_%' ESCAPE '\'
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_schema, table_name, grantee
ORDER BY table_name, grantee;

-- 3) 현재 정책 상태
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'backup\_%' ESCAPE '\'
ORDER BY tablename, policyname;

/* =========================================================
   [B] 조치(APPLY)
   ========================================================= */

DO $$
DECLARE
    apply_changes boolean := false; -- true면 실제 반영
    drop_backups boolean := false;  -- true면 backup_* 테이블 삭제
    rec record;
    fq_table text;
    has_owner_user_id boolean;
BEGIN
    FOR rec IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND c.relname LIKE 'backup\_%' ESCAPE '\'
        ORDER BY c.relname
    LOOP
        fq_table := format('public.%I', rec.table_name);

        IF apply_changes IS FALSE THEN
            RAISE NOTICE '[DRY-RUN] 대상: %', fq_table;
            IF drop_backups THEN
                RAISE NOTICE '[DRY-RUN] DROP TABLE %', fq_table;
            ELSE
                RAISE NOTICE '[DRY-RUN] ENABLE RLS + REVOKE anon/authenticated + owner 정책(조건부) %', fq_table;
            END IF;
            CONTINUE;
        END IF;

        IF drop_backups THEN
            EXECUTE format('DROP TABLE IF EXISTS %s', fq_table);
            RAISE NOTICE '[APPLY] 삭제 완료: %', fq_table;
            CONTINUE;
        END IF;

        -- 유지+잠금 모드
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', fq_table);
        EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', fq_table);
        EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', fq_table);

        -- 정책 초기화(테이블별)
        EXECUTE format('DROP POLICY IF EXISTS backup_owner_select ON %s', fq_table);
        EXECUTE format('DROP POLICY IF EXISTS backup_owner_mod ON %s', fq_table);

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = rec.table_name
              AND column_name = 'owner_user_id'
        ) INTO has_owner_user_id;

        IF has_owner_user_id THEN
            EXECUTE format(
                'CREATE POLICY backup_owner_select ON %s FOR SELECT USING (owner_user_id = auth.uid())',
                fq_table
            );
            EXECUTE format(
                'CREATE POLICY backup_owner_mod ON %s FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid())',
                fq_table
            );
            RAISE NOTICE '[APPLY] 유지+잠금(owner 정책 포함): %', fq_table;
        ELSE
            RAISE NOTICE '[APPLY] 유지+잠금(owner_user_id 없음, 정책 미생성): %', fq_table;
        END IF;
    END LOOP;
END $$;

/* =========================================================
   [C] 재점검(READ ONLY)
   ========================================================= */

-- 조치 후 다시 확인
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname LIKE 'backup\_%' ESCAPE '\'
ORDER BY c.relname;

