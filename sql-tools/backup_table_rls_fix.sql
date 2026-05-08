-- 목적:
--   Security Advisor 경고
--   "RLS Disabled in Public" (예: public.backup_attendance_teacher_fix_20260309) 대응
--
-- 사용 방법:
--   1) 아래 target_table 값을 실제 경고 테이블명으로 확인
--   2) keep_backup_table 값을 선택
--      - false: 백업 테이블 삭제 (권장: 더 이상 필요 없을 때)
--      - true : 백업 테이블 유지 + RLS/권한 잠금
--   3) Supabase SQL Editor에서 실행
--
-- 주의:
--   - 이 스크립트는 "백업 테이블" 대응용이다.
--   - 운영 테이블(attendance_records, schedules 등)에 적용하지 않는다.

DO $$
DECLARE
    target_table text := 'public.backup_attendance_teacher_fix_20260309';
    keep_backup_table boolean := true; -- false=삭제, true=유지+잠금
    table_exists boolean;
    has_owner_user_id boolean;
BEGIN
    table_exists := to_regclass(target_table) IS NOT NULL;

    IF NOT table_exists THEN
        RAISE NOTICE '[RLS_FIX] 대상 테이블 없음: %', target_table;
        RETURN;
    END IF;

    IF keep_backup_table = false THEN
        EXECUTE format('DROP TABLE IF EXISTS %s', target_table);
        RAISE NOTICE '[RLS_FIX] 백업 테이블 삭제 완료: %', target_table;
        RETURN;
    END IF;

    -- 유지하는 경우: RLS 활성화 + API 역할 접근 최소화
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);

    -- PostgREST 기본 역할 접근 잠금
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', target_table);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', target_table);

    -- 기존 정책 제거(있을 때만)
    EXECUTE format('DROP POLICY IF EXISTS backup_table_owner_select ON %s', target_table);
    EXECUTE format('DROP POLICY IF EXISTS backup_table_owner_mod ON %s', target_table);

    -- owner_user_id 컬럼이 있으면 owner 기준 정책, 없으면 정책 미생성(=사실상 차단)
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = split_part(target_table, '.', 1)
          AND table_name = split_part(target_table, '.', 2)
          AND column_name = 'owner_user_id'
    ) INTO has_owner_user_id;

    IF has_owner_user_id THEN
        EXECUTE format(
            'CREATE POLICY backup_table_owner_select ON %s FOR SELECT USING (owner_user_id = auth.uid())',
            target_table
        );
        EXECUTE format(
            'CREATE POLICY backup_table_owner_mod ON %s FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid())',
            target_table
        );
        RAISE NOTICE '[RLS_FIX] owner_user_id 정책 적용 완료: %', target_table;
    ELSE
        RAISE NOTICE '[RLS_FIX] owner_user_id 없음 -> 정책 미생성(anon/authenticated 접근 차단 상태): %', target_table;
    END IF;

    RAISE NOTICE '[RLS_FIX] 백업 테이블 유지+잠금 완료: %', target_table;
END $$;

