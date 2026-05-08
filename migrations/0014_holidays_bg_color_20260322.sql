-- holidays: 캘린더 셀 배경(글자색 color와 별도)
-- Supabase SQL Editor에서 실행 후 앱에서 일정 저장 시 bg_color가 반영됩니다.

ALTER TABLE holidays ADD COLUMN IF NOT EXISTS bg_color TEXT;

COMMENT ON COLUMN holidays.bg_color IS '캘린더 셀 배경 틴트 (글자색은 color)';
