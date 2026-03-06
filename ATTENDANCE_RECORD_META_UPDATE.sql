-- ============================================================
-- 출석기록 메타 정규화 컬럼 추가(학생관리 66차)
-- 실행일: 2026-03-06
-- ============================================================
-- 목적:
-- 1) 출석 처리 방식(source) 명시
-- 2) 인증 시각(auth_time)과 최종 처리 시각(processed_at) 분리
-- 3) 자리확인 여부(presence_checked) 명시
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_records' AND column_name = 'attendance_source'
    ) THEN
        ALTER TABLE attendance_records
            ADD COLUMN attendance_source TEXT
            CHECK (attendance_source IN ('qr', 'phone', 'teacher', 'emergency', 'unknown'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_records' AND column_name = 'auth_time'
    ) THEN
        ALTER TABLE attendance_records
            ADD COLUMN auth_time TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_records' AND column_name = 'presence_checked'
    ) THEN
        ALTER TABLE attendance_records
            ADD COLUMN presence_checked BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attendance_records' AND column_name = 'processed_at'
    ) THEN
        ALTER TABLE attendance_records
            ADD COLUMN processed_at TIMESTAMPTZ;
    END IF;
END $$;

-- 기존 데이터 백필(안전하게 여러 번 실행 가능)
UPDATE attendance_records
SET
    attendance_source = COALESCE(
        attendance_source,
        CASE
            WHEN COALESCE(qr_judgment, '') LIKE '%임시출석%' THEN 'emergency'
            WHEN qr_scanned = TRUE THEN 'qr'
            WHEN COALESCE(qr_judgment, '') LIKE '%전화번호인증%' OR COALESCE(memo, '') LIKE '%[전화번호인증]%' THEN 'phone'
            WHEN check_in_time IS NOT NULL THEN 'teacher'
            ELSE 'unknown'
        END
    ),
    auth_time = COALESCE(auth_time, qr_scan_time, check_in_time),
    presence_checked = COALESCE(
        presence_checked,
        CASE
            WHEN COALESCE(qr_judgment, '') ~ '(재석 확인|지각 확인|부재 확인|보강 처리)' THEN TRUE
            ELSE FALSE
        END
    ),
    processed_at = COALESCE(processed_at, check_in_time, created_at, now());

CREATE INDEX IF NOT EXISTS idx_attendance_source ON attendance_records(attendance_source);
CREATE INDEX IF NOT EXISTS idx_attendance_processed_at ON attendance_records(processed_at);

-- PostgREST 캐시 갱신
NOTIFY pgrst, 'reload schema';
