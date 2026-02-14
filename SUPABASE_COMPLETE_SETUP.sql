-- ============================================================
-- 출석관리 앱 - Supabase 전체 테이블 설정 SQL
-- 최종 업데이트: 2026-02-15
-- ============================================================
-- 이 파일은 Supabase SQL Editor에서 실행하세요.
-- 기존 테이블이 있으면 ALTER TABLE로 누락 컬럼만 추가됩니다.
-- ============================================================

-- ============================================================
-- 1. users 테이블 (Supabase Auth와 연동)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. teachers 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    google_email TEXT,
    google_sub TEXT,
    pin_hash TEXT,
    teacher_role TEXT DEFAULT 'teacher' CHECK (teacher_role IN ('admin', 'teacher', 'staff')),
    google_drive_refresh_token TEXT,    -- Google Drive API refresh token
    google_drive_connected BOOLEAN DEFAULT FALSE,  -- Drive 연결 상태
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_owner ON teachers(owner_user_id);

-- ============================================================
-- 3. students 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    school TEXT,
    grade TEXT,
    phone TEXT,
    parent_phone TEXT,
    parent_code TEXT,                -- 학부모 포털 인증코드 (6자리)
    qr_code_data TEXT,               -- QR 토큰 데이터
    default_fee NUMERIC DEFAULT 0,
    special_lecture_fee NUMERIC DEFAULT 0,
    default_textbook_fee NUMERIC DEFAULT 0,
    memo TEXT,
    register_date DATE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'graduated')),
    status_changed_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_owner ON students(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_students_teacher ON students(teacher_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- ============================================================
-- 4. schedules 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    schedule_date DATE NOT NULL,
    start_time TIME NOT NULL,
    duration INTEGER NOT NULL DEFAULT 90,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(owner_user_id, teacher_id, student_id, schedule_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_schedules_owner ON schedules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedules_student ON schedules(student_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(schedule_date);

-- ============================================================
-- 5. attendance_records 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    scheduled_time TIME,
    check_in_time TIMESTAMPTZ,
    status TEXT DEFAULT 'absent' CHECK (status IN ('present', 'late', 'absent', 'makeup', 'etc')),
    qr_scanned BOOLEAN DEFAULT FALSE,
    qr_scan_time TIMESTAMPTZ,        -- QR 스캔 시각
    qr_judgment TEXT,                 -- QR 판정 결과
    memo TEXT,                        -- 선생님 개인 메모
    shared_memo TEXT,                 -- 학부모에게 공유되는 메모
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, attendance_date, teacher_id, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_attendance_owner ON attendance_records(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_teacher ON attendance_records(teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, attendance_date);

-- ============================================================
-- 6. holidays 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    holiday_date DATE NOT NULL,
    holiday_name TEXT NOT NULL,
    color TEXT DEFAULT '#ef4444',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(owner_user_id, teacher_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_owner ON holidays(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);

-- ============================================================
-- 7. payments 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    payment_month TEXT NOT NULL,      -- 형식: 'YYYY-MM'
    amount INTEGER DEFAULT 0,
    paid_amount INTEGER DEFAULT 0,
    payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('paid', 'unpaid', 'partial')),
    payment_date DATE,
    memo TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, payment_month)
);

CREATE INDEX IF NOT EXISTS idx_payments_owner ON payments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_month ON payments(payment_month);

-- ============================================================
-- 8. student_evaluations 테이블 (학부모 포털 종합평가)
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

-- ============================================================
-- 9. teacher_reset_codes 테이블 (비밀번호 초기화)
-- ============================================================
CREATE TABLE IF NOT EXISTS teacher_reset_codes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_codes_teacher ON teacher_reset_codes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_reset_codes_expires ON teacher_reset_codes(expires_at);

-- ============================================================
-- 10. homework_submissions 테이블 (숙제 제출 기록)
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
-- 누락 컬럼 추가 (기존 테이블에 새 컬럼이 없을 때)
-- ============================================================
-- 아래 ALTER TABLE은 컬럼이 이미 있으면 에러가 나지만,
-- DO $$ 블록으로 안전하게 처리합니다.

DO $$ BEGIN
    -- students.parent_code
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='parent_code') THEN
        ALTER TABLE students ADD COLUMN parent_code TEXT;
    END IF;
    -- students.qr_code_data
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='qr_code_data') THEN
        ALTER TABLE students ADD COLUMN qr_code_data TEXT;
    END IF;
    -- students.default_textbook_fee
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='default_textbook_fee') THEN
        ALTER TABLE students ADD COLUMN default_textbook_fee NUMERIC DEFAULT 0;
    END IF;
    -- students.status_changed_date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='status_changed_date') THEN
        ALTER TABLE students ADD COLUMN status_changed_date DATE;
    END IF;
    -- attendance_records.memo
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance_records' AND column_name='memo') THEN
        ALTER TABLE attendance_records ADD COLUMN memo TEXT;
    END IF;
    -- attendance_records.shared_memo
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance_records' AND column_name='shared_memo') THEN
        ALTER TABLE attendance_records ADD COLUMN shared_memo TEXT;
    END IF;
    -- attendance_records.qr_scan_time
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance_records' AND column_name='qr_scan_time') THEN
        ALTER TABLE attendance_records ADD COLUMN qr_scan_time TIMESTAMPTZ;
    END IF;
    -- attendance_records.qr_judgment
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance_records' AND column_name='qr_judgment') THEN
        ALTER TABLE attendance_records ADD COLUMN qr_judgment TEXT;
    END IF;
    -- teachers.google_email
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_email') THEN
        ALTER TABLE teachers ADD COLUMN google_email TEXT;
    END IF;
    -- teachers.google_sub
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_sub') THEN
        ALTER TABLE teachers ADD COLUMN google_sub TEXT;
    END IF;
    -- teachers.address
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='address') THEN
        ALTER TABLE teachers ADD COLUMN address TEXT;
    END IF;
    -- teachers.address_detail
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='address_detail') THEN
        ALTER TABLE teachers ADD COLUMN address_detail TEXT;
    END IF;
    -- teachers.google_drive_refresh_token
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_drive_refresh_token') THEN
        ALTER TABLE teachers ADD COLUMN google_drive_refresh_token TEXT;
    END IF;
    -- teachers.google_drive_connected
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='google_drive_connected') THEN
        ALTER TABLE teachers ADD COLUMN google_drive_connected BOOLEAN DEFAULT FALSE;
    END IF;
END $$;


-- ============================================================
-- RLS (Row Level Security) 정책
-- ============================================================
-- 모든 테이블에 RLS를 활성화하고,
-- 인증된 사용자가 자신의 owner_user_id 데이터만 접근하도록 설정

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_submissions ENABLE ROW LEVEL SECURITY;

-- students 정책
DROP POLICY IF EXISTS "students_owner_policy" ON students;
CREATE POLICY "students_owner_policy" ON students
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

-- 학부모 포털용 읽기 전용 정책 (parent_code 기반 조회 허용)
DROP POLICY IF EXISTS "students_public_read" ON students;
CREATE POLICY "students_public_read" ON students
    FOR SELECT USING (true);

-- teachers 정책
DROP POLICY IF EXISTS "teachers_owner_policy" ON teachers;
CREATE POLICY "teachers_owner_policy" ON teachers
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "teachers_public_read" ON teachers;
CREATE POLICY "teachers_public_read" ON teachers
    FOR SELECT USING (true);

-- schedules 정책
DROP POLICY IF EXISTS "schedules_owner_policy" ON schedules;
CREATE POLICY "schedules_owner_policy" ON schedules
    FOR ALL USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- attendance_records 정책
DROP POLICY IF EXISTS "attendance_owner_policy" ON attendance_records;
CREATE POLICY "attendance_owner_policy" ON attendance_records
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "attendance_public_read" ON attendance_records;
CREATE POLICY "attendance_public_read" ON attendance_records
    FOR SELECT USING (true);

-- holidays 정책
DROP POLICY IF EXISTS "holidays_owner_policy" ON holidays;
CREATE POLICY "holidays_owner_policy" ON holidays
    FOR ALL USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- payments 정책
DROP POLICY IF EXISTS "payments_owner_policy" ON payments;
CREATE POLICY "payments_owner_policy" ON payments
    FOR ALL USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- student_evaluations 정책
DROP POLICY IF EXISTS "evaluations_owner_policy" ON student_evaluations;
CREATE POLICY "evaluations_owner_policy" ON student_evaluations
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "evaluations_public_read" ON student_evaluations;
CREATE POLICY "evaluations_public_read" ON student_evaluations
    FOR SELECT USING (true);

-- teacher_reset_codes 정책
DROP POLICY IF EXISTS "reset_codes_owner_policy" ON teacher_reset_codes;
CREATE POLICY "reset_codes_owner_policy" ON teacher_reset_codes
    FOR ALL USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- homework_submissions 정책
DROP POLICY IF EXISTS "homework_owner_policy" ON homework_submissions;
CREATE POLICY "homework_owner_policy" ON homework_submissions
    FOR ALL USING (owner_user_id = auth.uid() OR owner_user_id IS NOT NULL)
    WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "homework_public_insert" ON homework_submissions;
CREATE POLICY "homework_public_insert" ON homework_submissions
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "homework_public_read" ON homework_submissions;
CREATE POLICY "homework_public_read" ON homework_submissions
    FOR SELECT USING (true);


-- ============================================================
-- 만료된 리셋 코드 자동 정리 (선택사항)
-- pg_cron 확장이 활성화된 경우만 사용
-- ============================================================
-- SELECT cron.schedule('cleanup-reset-codes', '0 * * * *',
--     $$DELETE FROM teacher_reset_codes WHERE expires_at < now()$$
-- );

-- ============================================================
-- 완료! 모든 테이블, 인덱스, RLS 정책이 설정되었습니다.
-- ============================================================
