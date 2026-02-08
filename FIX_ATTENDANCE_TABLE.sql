-- ⚠️ attendance_records 테이블 수정
-- Supabase SQL Editor에서 실행하세요

-- 1️⃣ 현재 테이블 구조 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'attendance_records'
ORDER BY ordinal_position;

-- 2️⃣ 현재 unique constraint 확인
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'attendance_records'::regclass
AND contype = 'u';

-- 3️⃣ student_id가 TEXT라면 BIGINT로 변경 (데이터 백업 후 실행)
-- ⚠️ 주의: 기존 데이터가 있으면 에러 발생 가능
ALTER TABLE attendance_records 
ALTER COLUMN student_id TYPE BIGINT USING student_id::BIGINT;

-- 4️⃣ 기존 UNIQUE constraint 제거 (이름은 확인 후 수정)
ALTER TABLE attendance_records 
DROP CONSTRAINT IF EXISTS attendance_records_student_id_attendance_date_key;

-- 5️⃣ 새로운 UNIQUE constraint 추가 (teacher_id 포함하지 않음 - 동일 학생 동일 날짜는 1건만)
ALTER TABLE attendance_records 
ADD CONSTRAINT attendance_records_student_date_unique 
UNIQUE (student_id, attendance_date);

-- 6️⃣ teacher_id도 BIGINT로 (현재 TEXT라면)
-- ⚠️ teachers 테이블이 없어서 TEXT로 사용 중이라면 이 줄은 건너뛰기
-- ALTER TABLE attendance_records 
-- ALTER COLUMN teacher_id TYPE BIGINT USING teacher_id::BIGINT;

-- 7️⃣ qr_judgment 컬럼 추가 (없다면)
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS qr_judgment TEXT;

-- 8️⃣ 최종 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'attendance_records'
ORDER BY ordinal_position;
