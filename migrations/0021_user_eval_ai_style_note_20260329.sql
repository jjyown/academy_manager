-- 종합평가 AI: 원장 계정별 "항상 적용" 지침 (매 Edge 호출 시 시스템 프롬프트에 주입)
-- 누적 저장은 `SUPABASE_STUDENT_EVAL_AI_STYLE_ENTRIES_20260329.sql` 테이블을 사용한다.
-- 본 컬럼은 레거시·폴백용이며, 항목 테이블 이전 데이터는 마이그레이션 시 비울 수 있다.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS student_eval_ai_style_note TEXT;

COMMENT ON COLUMN public.users.student_eval_ai_style_note IS '레거시: 고정 지침(선택). 신규는 student_eval_ai_style_entries 행으로 저장';
