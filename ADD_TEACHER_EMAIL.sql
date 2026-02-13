-- ============================================================
-- teachers 테이블에 email 컬럼 추가
-- 선생님 이메일 (비밀번호 초기화 안내 발송용)
-- ============================================================

DO $$ 
BEGIN
    BEGIN
        ALTER TABLE teachers ADD COLUMN email TEXT;
    EXCEPTION
        WHEN duplicate_column THEN 
            RAISE NOTICE 'Column email already exists in teachers table.';
    END;
END $$;

-- 완료 확인
SELECT id, name, email FROM teachers ORDER BY name;
