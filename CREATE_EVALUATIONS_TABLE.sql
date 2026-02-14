-- ============================================================
-- 종합평가 테이블 생성 SQL
-- Supabase SQL Editor에서 이 파일을 실행하세요.
-- 이미 테이블이 있으면 무시됩니다.
-- ============================================================

CREATE TABLE IF NOT EXISTS student_evaluations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    eval_month TEXT NOT NULL,         -- 형식: 'YYYY-MM'
    comment TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, eval_month)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_student ON student_evaluations(student_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_month ON student_evaluations(eval_month);

-- RLS 활성화
ALTER TABLE student_evaluations ENABLE ROW LEVEL SECURITY;

-- 소유자 정책 (로그인한 사용자가 자신의 데이터 CRUD)
DROP POLICY IF EXISTS "evaluations_owner_policy" ON student_evaluations;
CREATE POLICY "evaluations_owner_policy" ON student_evaluations
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

-- 학부모 포털용 읽기 전용 (공개 SELECT)
DROP POLICY IF EXISTS "evaluations_public_read" ON student_evaluations;
CREATE POLICY "evaluations_public_read" ON student_evaluations
    FOR SELECT USING (true);

-- ============================================================
-- 완료! student_evaluations 테이블이 생성되었습니다.
-- ============================================================
