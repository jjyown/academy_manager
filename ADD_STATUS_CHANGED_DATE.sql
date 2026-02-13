-- ============================================================
-- students 테이블에 status_changed_date 컬럼 추가
-- 퇴원/휴원 시 상태 변경 날짜를 기록하여
-- 변경일 이전의 일정은 캘린더에 계속 표시합니다.
-- ============================================================

-- 1. status_changed_date 컬럼 추가 (이미 있으면 무시)
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE students ADD COLUMN status_changed_date DATE;
    EXCEPTION
        WHEN duplicate_column THEN 
            RAISE NOTICE 'Column status_changed_date already exists in students table.';
    END;
END $$;

-- 2. 기존 퇴원/휴원 학생에 대해 현재 날짜로 status_changed_date 설정
-- (이미 퇴원/휴원 상태인 학생들의 이전 일정도 보이도록)
UPDATE students 
SET status_changed_date = CURRENT_DATE 
WHERE status IN ('archived', 'paused') 
  AND status_changed_date IS NULL;

-- 완료 확인
SELECT id, name, status, status_changed_date 
FROM students 
WHERE status IN ('archived', 'paused')
ORDER BY name;
