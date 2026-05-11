-- =====================================================================
-- 0039_weakness_analysis_slots_20260511.sql
--
-- 학생별 취약점 분석을 위한 메타 컬럼 추가.
--
-- 운영 흐름 (Phase 5, 2026-05-11):
--   풀이 검토 조교가 오답에 한해 mistake_category 를 자동 분류해 저장.
--   answer_keys.question_meta_json 은 문항별 단원/난이도 슬롯(추후 자동 추출).
--   GET /api/students/{id}/weakness-report 가 이 두 컬럼을 누적 집계.
--
-- 컬럼:
--   grading_items.mistake_category TEXT
--     'conceptual' | 'computational' | 'careless' | 'transcription' | 'time_pressure' | 'unknown'
--     NULL = 정답이거나 분류 불필요.
--
--   answer_keys.question_meta_json JSONB
--     문항별 메타데이터. 예:
--       {
--         "1": {"topic":"이차함수","difficulty":"easy","unit":"고1-수학상"},
--         "5": {"topic":"근의공식","difficulty":"medium"}
--       }
--     NULL/빈객체 = 메타 없음(취약점 분석 시 단원별 집계 생략).
--
-- 적용: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.grading_items DROP COLUMN IF EXISTS mistake_category;
--   ALTER TABLE public.answer_keys   DROP COLUMN IF EXISTS question_meta_json;
-- =====================================================================
BEGIN;

SELECT current_database() AS db,
       inet_server_addr() AS server_addr,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables;

-- ── 1. grading_items.mistake_category ──────────────────────────────
ALTER TABLE public.grading_items
    ADD COLUMN IF NOT EXISTS mistake_category TEXT;

COMMENT ON COLUMN public.grading_items.mistake_category IS
    '오답일 때의 실수 유형(취약점 분석용). NULL=정답 또는 미분류.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grading_items_mistake_category_check'
  ) THEN
    ALTER TABLE public.grading_items
      ADD CONSTRAINT grading_items_mistake_category_check
      CHECK (mistake_category IS NULL OR mistake_category IN (
        'conceptual','computational','careless','transcription','time_pressure','unknown'
      ));
  END IF;
END $$;

-- 학생별 누적 집계용 부분 인덱스(이 컬럼은 대부분 NULL 이라 partial 이 효율적)
CREATE INDEX IF NOT EXISTS idx_grading_items_mistake_category
  ON public.grading_items (mistake_category)
  WHERE mistake_category IS NOT NULL;

-- ── 2. answer_keys.question_meta_json ──────────────────────────────
ALTER TABLE public.answer_keys
    ADD COLUMN IF NOT EXISTS question_meta_json JSONB;

COMMENT ON COLUMN public.answer_keys.question_meta_json IS
    '문항별 메타. 예: {"1":{"topic":"이차함수","difficulty":"easy","unit":"고1-수학상"}}. NULL=메타 없음.';

-- ── 3. 검증 ────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='grading_items' AND column_name='mistake_category')
       OR (table_name='answer_keys' AND column_name='question_meta_json'))
ORDER BY table_name, column_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
