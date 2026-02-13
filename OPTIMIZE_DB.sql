-- ============================================================
-- 출석관리 앱 DB 최적화 SQL
-- Supabase SQL Editor에서 실행하세요
-- ============================================================
-- 이 스크립트는 기존 데이터를 유지하면서 성능을 개선합니다.
-- 안전하게 여러 번 실행해도 문제없습니다 (IF NOT EXISTS 사용).
-- ============================================================

-- ************************************************************
-- 1. attendance_records 테이블 - UNIQUE 제약조건 수정
-- ************************************************************
-- 문제: 현재 UNIQUE(student_id, attendance_date) → 같은 날 다른 선생님/다른 시간 수업 출결 저장 불가
-- 해결: UNIQUE(student_id, attendance_date, teacher_id, scheduled_time) → 같은 날 여러 수업 출결 가능

-- 1-1. 기존 UNIQUE constraint 확인 및 제거
DO $$
DECLARE
    _constraint_name TEXT;
BEGIN
    -- student_id + attendance_date만으로 된 기존 constraint 찾기
    FOR _constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'attendance_records'::regclass
        AND contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS %I', _constraint_name);
        RAISE NOTICE '기존 UNIQUE constraint 제거: %', _constraint_name;
    END LOOP;
END $$;

-- 1-2. scheduled_time 컬럼이 없으면 추가
ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS scheduled_time TIME;

-- 1-3. qr_judgment 컬럼이 없으면 추가
ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS qr_judgment TEXT;

-- 1-4. 새 UNIQUE constraint 추가 (다중 수업 지원)
-- scheduled_time이 NULL인 기존 레코드 처리: 기본값 '00:00' 설정
UPDATE attendance_records SET scheduled_time = '00:00:00' WHERE scheduled_time IS NULL;

ALTER TABLE attendance_records
ADD CONSTRAINT attendance_records_student_date_teacher_time_unique
UNIQUE (student_id, attendance_date, teacher_id, scheduled_time);


-- ************************************************************
-- 2. 복합 인덱스 추가 - schedules 테이블
-- ************************************************************
-- 가장 자주 사용되는 쿼리 패턴에 맞춤

-- 선생님별 일정 조회 (getSchedulesByTeacher)
CREATE INDEX IF NOT EXISTS idx_schedules_owner_teacher_date
ON public.schedules(owner_user_id, teacher_id, schedule_date);

-- 학생별 일정 조회 (getSchedulesByStudent, QR 스캔 시 일정 검색)
CREATE INDEX IF NOT EXISTS idx_schedules_owner_student_date
ON public.schedules(owner_user_id, student_id, schedule_date);

-- UPSERT 충돌 해결 최적화 (이미 UNIQUE 제약조건이 있지만 명시적 인덱스 추가)
CREATE INDEX IF NOT EXISTS idx_schedules_upsert_conflict
ON public.schedules(owner_user_id, teacher_id, student_id, schedule_date, start_time);


-- ************************************************************
-- 3. 복합 인덱스 추가 - attendance_records 테이블
-- ************************************************************

-- 소유자+선생님+날짜 기준 조회 (getAttendanceRecordsByOwner, getAttendanceRecordsByDate)
CREATE INDEX IF NOT EXISTS idx_attendance_owner_teacher_date
ON public.attendance_records(owner_user_id, teacher_id, attendance_date);

-- 소유자+학생+날짜 기준 조회 (getStudentAttendanceRecordsByMonth)
CREATE INDEX IF NOT EXISTS idx_attendance_owner_student_date
ON public.attendance_records(owner_user_id, student_id, attendance_date);

-- 학생+날짜 기준 조회 (getAttendanceRecordByStudentAndDate, QR 중복 체크)
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
ON public.attendance_records(student_id, attendance_date);


-- ************************************************************
-- 4. 복합 인덱스 추가 - payments 테이블
-- ************************************************************

-- 월별 결제 조회 (getPaymentsByMonth)
CREATE INDEX IF NOT EXISTS idx_payments_owner_teacher_month
ON public.payments(owner_user_id, teacher_id, payment_month);

-- 학생별 결제 조회 (getPaymentsByStudent)
CREATE INDEX IF NOT EXISTS idx_payments_owner_student_month
ON public.payments(owner_user_id, student_id, payment_month);


-- ************************************************************
-- 5. 복합 인덱스 추가 - holidays 테이블
-- ************************************************************

-- 선생님별 휴일 조회 (getHolidaysByTeacher)
CREATE INDEX IF NOT EXISTS idx_holidays_owner_teacher_date
ON public.holidays(owner_user_id, teacher_id, holiday_date);


-- ************************************************************
-- 6. 복합 인덱스 추가 - teachers 테이블
-- ************************************************************

-- 소유자별 선생님 조회 (getMyTeachers)
CREATE INDEX IF NOT EXISTS idx_teachers_owner
ON public.teachers(owner_user_id);


-- ************************************************************
-- 7. 복합 인덱스 추가 - students 테이블
-- ************************************************************

-- 소유자별 학생 조회 (RLS 최적화)
CREATE INDEX IF NOT EXISTS idx_students_owner
ON public.students(owner_user_id);


-- ************************************************************
-- 8. 트리거 함수 search_path 보안 수정 (경고 제거)
-- ************************************************************
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_schedules_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_holidays_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ************************************************************
-- 9. 불필요한 단일 컬럼 인덱스 정리 (복합 인덱스가 대체)
-- ************************************************************
-- 복합 인덱스의 첫 번째 컬럼이 동일하면 단일 인덱스는 불필요
-- 하지만 안전을 위해 기존 단일 인덱스는 유지합니다.
-- (Postgres는 복합 인덱스의 첫 번째 컬럼으로도 검색 가능)


-- ************************************************************
-- 10. ANALYZE 실행 (인덱스 통계 갱신)
-- ************************************************************
ANALYZE public.schedules;
ANALYZE public.attendance_records;
ANALYZE public.payments;
ANALYZE public.holidays;
ANALYZE public.teachers;
ANALYZE public.students;


-- ============================================================
-- 실행 결과 확인
-- ============================================================
-- 아래 쿼리로 생성된 인덱스를 확인할 수 있습니다:

-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;
