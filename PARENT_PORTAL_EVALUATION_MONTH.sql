-- 종합평가를 월 단위로 저장하기 위한 스키마 변경
-- Supabase SQL Editor에서 실행하세요

-- 1) 월 컬럼 추가 (YYYY-MM)
ALTER TABLE public.student_evaluations
ADD COLUMN IF NOT EXISTS eval_month TEXT;

-- 2) 기존 데이터가 있으면 현재 달로 채움 (선택)
UPDATE public.student_evaluations
SET eval_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
WHERE eval_month IS NULL;

-- 3) 월 단위 유니크 제약 추가
DROP INDEX IF EXISTS idx_student_evaluations_student_month;
CREATE UNIQUE INDEX idx_student_evaluations_student_month
ON public.student_evaluations(student_id, eval_month);

-- 4) 기존 단일 유니크 제약이 있으면 제거
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'student_evaluations_student_id_key'
    ) THEN
        ALTER TABLE public.student_evaluations
        DROP CONSTRAINT student_evaluations_student_id_key;
    END IF;
END$$;
