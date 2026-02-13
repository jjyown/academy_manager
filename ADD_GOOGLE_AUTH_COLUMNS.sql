-- ============================================================
-- teachers 테이블에 Google OAuth 관련 컬럼 추가
-- 선생님 등록 시 구글 이메일 인증 및 향후 Google Drive 연동용
-- ============================================================

-- 1. google_sub 컬럼 추가 (Google 고유 사용자 ID)
DO $$
BEGIN
    BEGIN
        ALTER TABLE teachers ADD COLUMN google_sub TEXT;
    EXCEPTION
        WHEN duplicate_column THEN
            RAISE NOTICE 'Column google_sub already exists in teachers table.';
    END;
END $$;

-- 2. google_email 컬럼 추가 (Google에서 인증된 이메일)
DO $$
BEGIN
    BEGIN
        ALTER TABLE teachers ADD COLUMN google_email TEXT;
    EXCEPTION
        WHEN duplicate_column THEN
            RAISE NOTICE 'Column google_email already exists in teachers table.';
    END;
END $$;

-- 완료 확인
SELECT id, name, email, google_email, google_sub FROM teachers ORDER BY name;
