-- ============================================================
-- holidays: 하루 여러 건 + 글자 크기 (2026-03-22)
-- Supabase SQL Editor에 붙여넣어 한 번에 실행하세요.
-- ============================================================

-- 1) 글자 크기 (캘린더 표시용, px)
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS font_size INTEGER NOT NULL DEFAULT 13;

-- 2) 날짜당 1건만 허용하던 UNIQUE 제약 제거 → 같은 날 여러 일정 가능
-- (제약 이름이 다르면 Dashboard → Table holidays → Constraints에서 UNIQUE 이름 확인 후 DROP)
ALTER TABLE public.holidays
  DROP CONSTRAINT IF EXISTS holidays_owner_user_id_teacher_id_holiday_date_key;

CREATE INDEX IF NOT EXISTS idx_holidays_owner_teacher_date
  ON public.holidays (owner_user_id, teacher_id, holiday_date);

-- 3) 검증
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'holidays' AND column_name = 'font_size';
