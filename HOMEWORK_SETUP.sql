-- ============================================================
-- 숙제 관리 시스템 - 데이터베이스 설정 SQL
-- 날짜: 2026-02-15
-- ============================================================
-- 이 파일을 Supabase SQL Editor에서 실행하세요.
-- 기존 출석관리 앱 DB에 숙제 관리 관련 테이블/컬럼을 추가합니다.
-- ============================================================
--
-- ★★★ 설정 가이드 (반드시 먼저 완료하세요!) ★★★
--
-- [1단계] Google Cloud Console 설정
--   1. https://console.cloud.google.com/ 접속
--   2. API 및 서비스 → 라이브러리 → "Google Drive API" 검색 → 사용 설정
--   3. API 및 서비스 → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID 클릭
--   4. "클라이언트 보안 비밀번호" (Client Secret) 복사해 두기
--   5. "승인된 리디렉션 URI"에 아래 추가 (없으면):
--      - https://your-domain.vercel.app (배포 도메인)
--      - http://localhost:8000 (로컬 개발용)
--   6. OAuth 동의 화면 → 범위(Scopes) → "Google Drive API - .../auth/drive.file" 추가
--
-- [2단계] Supabase Edge Function Secrets 설정
--   1. Supabase Dashboard → Edge Functions → Secrets
--   2. 아래 값들을 추가:
--      GOOGLE_CLIENT_ID = (Google Cloud Console의 클라이언트 ID)
--      GOOGLE_CLIENT_SECRET = (위에서 복사한 클라이언트 보안 비밀번호)
--
-- [3단계] 이 SQL 파일 실행
--   1. Supabase Dashboard → SQL Editor
--   2. 이 파일의 내용을 전체 복사-붙여넣기 → Run
--
-- [4단계] Edge Functions 배포
--   터미널에서:
--   supabase functions deploy exchange-google-token
--   supabase functions deploy upload-homework
--
-- [5단계] 선생님 앱에서 Google Drive 연결
--   1. 메인 앱 로그인 → 내 정보수정
--   2. "Google Drive 연결하기" 버튼 클릭
--   3. Google 계정으로 인증 (Drive 파일 접근 권한 허용)
--   4. "Drive 연결됨" 표시 확인
--
-- [6단계] 학생에게 숙제 제출 페이지 공유
--   URL: https://your-domain.vercel.app/homework/
--   학생은 이름 + 전화번호로 본인 확인 후 파일을 업로드합니다.
--   업로드된 파일은 자동으로 담당 선생님의 Google Drive에
--   "숙제 제출" 폴더 아래 "과제-2026년-2월-20일-김민철.zip" 형태로 저장됩니다.
--
-- ============================================================

-- ============================================================
-- 1. teachers 테이블에 Google Drive 연동 컬럼 추가
-- ============================================================
DO $$ BEGIN
    -- teachers.google_drive_refresh_token (Google Drive API refresh token)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_drive_refresh_token') THEN
        ALTER TABLE teachers ADD COLUMN google_drive_refresh_token TEXT;
    END IF;
    -- teachers.google_drive_connected (Drive 연결 상태)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_drive_connected') THEN
        ALTER TABLE teachers ADD COLUMN google_drive_connected BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ============================================================
-- 2. homework_submissions 테이블 (숙제 제출 기록)
-- ============================================================
CREATE TABLE IF NOT EXISTS homework_submissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    submission_date DATE NOT NULL,
    file_name TEXT NOT NULL,              -- 압축 파일명 (과제-2026년-2월-20일-김민철.zip)
    drive_file_id TEXT,                   -- Google Drive 파일 ID
    drive_file_url TEXT,                  -- Google Drive 파일 URL
    file_size INTEGER,                    -- 파일 크기 (bytes)
    status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'failed', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_homework_owner ON homework_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_homework_teacher ON homework_submissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_homework_student ON homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_homework_date ON homework_submissions(submission_date);

-- ============================================================
-- 3. RLS 정책
-- ============================================================
ALTER TABLE homework_submissions ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자가 자신의 데이터만 관리
DROP POLICY IF EXISTS "homework_owner_policy" ON homework_submissions;
CREATE POLICY "homework_owner_policy" ON homework_submissions
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

-- 숙제 제출 페이지에서 INSERT 허용 (anon 사용자도 제출 가능)
DROP POLICY IF EXISTS "homework_public_insert" ON homework_submissions;
CREATE POLICY "homework_public_insert" ON homework_submissions
    FOR INSERT WITH CHECK (true);

-- 숙제 제출 페이지에서 읽기 허용 (제출 확인용)
DROP POLICY IF EXISTS "homework_public_read" ON homework_submissions;
CREATE POLICY "homework_public_read" ON homework_submissions
    FOR SELECT USING (true);

-- ============================================================
-- 4. schedules 테이블 - 숙제 페이지에서 읽기 허용
-- ============================================================
DROP POLICY IF EXISTS "homework_schedules_read" ON schedules;
CREATE POLICY "homework_schedules_read" ON schedules
    FOR SELECT USING (true);

-- ============================================================
-- 5. homework_submissions status 컬럼 - 'manual' 값 허용
-- ============================================================
-- 기존 CHECK 제약조건 제거 후 재생성 (manual 추가)
DO $$ BEGIN
    ALTER TABLE homework_submissions DROP CONSTRAINT IF EXISTS homework_submissions_status_check;
    ALTER TABLE homework_submissions ADD CONSTRAINT homework_submissions_status_check
        CHECK (status IN ('uploaded', 'failed', 'deleted', 'manual'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update status check constraint: %', SQLERRM;
END $$;

-- homework_submissions 삭제 정책 (관리자 수동 확인 취소용)
DROP POLICY IF EXISTS "homework_public_delete" ON homework_submissions;
CREATE POLICY "homework_public_delete" ON homework_submissions
    FOR DELETE USING (true);

-- ============================================================
-- 완료! 숙제 관리 테이블이 설정되었습니다.
-- ============================================================
