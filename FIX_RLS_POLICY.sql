-- ⚠️ RLS 정책 완전 초기화 (PL/pgSQL 동적 삭제)
-- Supabase SQL Editor에서 실행하세요

-- ========== 1️⃣ 모든 기존 정책을 동적으로 삭제 ==========
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname, tablename FROM pg_policies 
        WHERE tablename IN ('attendance_records', 'students')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON ' || pol.tablename;
        RAISE NOTICE 'Dropped policy: % on table %', pol.policyname, pol.tablename;
    END LOOP;
END $$;

-- ========== 2️⃣ RLS 비활성화 (안전장치) ==========
ALTER TABLE attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE students DISABLE ROW LEVEL SECURITY;

-- ========== 3️⃣ RLS 재활성화 ==========
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- ========== 4️⃣ 깨끗한 새 정책 추가 ==========
CREATE POLICY "att_select" ON attendance_records FOR SELECT
USING (owner_user_id = auth.uid());

CREATE POLICY "att_insert" ON attendance_records FOR INSERT
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "att_update" ON attendance_records FOR UPDATE
USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "att_delete" ON attendance_records FOR DELETE
USING (owner_user_id = auth.uid());

CREATE POLICY "stu_select" ON students FOR SELECT
USING (owner_user_id = auth.uid());

CREATE POLICY "stu_insert" ON students FOR INSERT
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "stu_update" ON students FOR UPDATE
USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "stu_delete" ON students FOR DELETE
USING (owner_user_id = auth.uid());

-- ========== 5️⃣ 최종 확인 (정책 개수: 8개여야 함) ==========
SELECT COUNT(*) as total_policies FROM pg_policies 
WHERE tablename IN ('attendance_records', 'students');

SELECT tablename, policyname, cmd
FROM pg_policies 
WHERE tablename IN ('attendance_records', 'students')
ORDER BY tablename, policyname;
