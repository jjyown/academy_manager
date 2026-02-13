-- ============================================================
-- 선생님 비밀번호 초기화 인증번호 테이블
-- 이메일로 발송된 인증번호를 저장하고 검증합니다.
-- ============================================================

-- 1. teacher_reset_codes 테이블 생성
CREATE TABLE IF NOT EXISTS teacher_reset_codes (
    id SERIAL PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 인덱스 추가 (빠른 조회용)
CREATE INDEX IF NOT EXISTS idx_reset_codes_teacher_id ON teacher_reset_codes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_reset_codes_expires ON teacher_reset_codes(expires_at);

-- 3. 만료된 코드 자동 정리용 (선택사항 - 주기적으로 실행)
-- DELETE FROM teacher_reset_codes WHERE expires_at < NOW() OR used = TRUE;

-- 4. RLS 정책 설정
ALTER TABLE teacher_reset_codes ENABLE ROW LEVEL SECURITY;

-- 관리자가 자신의 선생님 코드만 조회/삽입/삭제 가능
CREATE POLICY "owner_select_reset_codes" ON teacher_reset_codes
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "owner_insert_reset_codes" ON teacher_reset_codes
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "owner_update_reset_codes" ON teacher_reset_codes
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "owner_delete_reset_codes" ON teacher_reset_codes
    FOR DELETE USING (auth.uid() = owner_user_id);

-- 완료 확인
SELECT 'teacher_reset_codes 테이블 생성 완료' AS result;
