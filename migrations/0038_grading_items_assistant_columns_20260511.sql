-- =====================================================================
-- 0038_grading_items_assistant_columns_20260511.sql
--
-- grading_items 에 "전문 채점조교 모듈 2개" 결과 저장용 컬럼 추가.
--
-- 운영 흐름 (2026-05-11, Phase 4):
--   /api/grade 자동채점 파이프라인 안에서 두 조교 모듈이 즉시 실행되어
--   선생님이 채점 화면을 열 때는 검수가 끝난 상태로 보인다.
--
-- 컬럼:
--   student_answer_normalized   TEXT
--     "OCR 정제 조교" 결과 — 학생 답안 수식/기호 표준화 후 텍스트
--     (예: 'x2+1' → 'x²+1', '루트2' → '√2'). NULL=정제 미수행/실패.
--
--   process_feedback            TEXT
--     "풀이 검토 조교" 의 자연어 코멘트 — 정답·오답 무관, 풀이 과정 진단.
--     (예: "최종 답은 맞으나 3번째 줄에서 부호 누락(- 빠짐), 사실상 -3.")
--
--   suggested_partial_score     NUMERIC(5,1)
--     "풀이 검토 조교" 의 부분점수 제안 (서답형/uncertain 대상). 선생님 확정 시 참고.
--     NULL=제안 없음 / 검토 대상 아님.
--
--   process_review_flags        JSONB
--     탐지된 풀이 이슈 카테고리 배열. 예: ["sign_error","exponent_lost","unit_missing"].
--     UI에서 배지로 표시. NULL/빈배열=이슈 없음.
--
-- RLS: grading_items 의 기존 정책(선생님 본인 result_id 만) 그대로 적용 — 새 컬럼은 nullable 보강이라 영향 없음.
--
-- 적용: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.grading_items
--       DROP COLUMN IF EXISTS student_answer_normalized,
--       DROP COLUMN IF EXISTS process_feedback,
--       DROP COLUMN IF EXISTS suggested_partial_score,
--       DROP COLUMN IF EXISTS process_review_flags;
-- =====================================================================
BEGIN;

-- ── 정체성 검증(다른 프로젝트에 잘못 붙여넣지 않도록) ────────────────
SELECT current_database() AS db,
       inet_server_addr() AS server_addr,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables;

-- ── 1. 4개 컬럼 추가 (모두 nullable) ────────────────────────────────
ALTER TABLE public.grading_items
    ADD COLUMN IF NOT EXISTS student_answer_normalized TEXT;

ALTER TABLE public.grading_items
    ADD COLUMN IF NOT EXISTS process_feedback TEXT;

ALTER TABLE public.grading_items
    ADD COLUMN IF NOT EXISTS suggested_partial_score NUMERIC(5,1);

ALTER TABLE public.grading_items
    ADD COLUMN IF NOT EXISTS process_review_flags JSONB;

COMMENT ON COLUMN public.grading_items.student_answer_normalized IS
    'OCR 정제 조교 결과: 학생 답안의 수식/기호 표준화 후 텍스트. NULL=미수행.';
COMMENT ON COLUMN public.grading_items.process_feedback IS
    '풀이 검토 조교 자연어 코멘트: 풀이 과정의 부호/지수/단위/중간계산 진단.';
COMMENT ON COLUMN public.grading_items.suggested_partial_score IS
    '풀이 검토 조교 부분점수 제안(서답형/uncertain). NULL=제안 없음/검토 대상 아님.';
COMMENT ON COLUMN public.grading_items.process_review_flags IS
    '탐지된 풀이 이슈 카테고리 배열. 예: ["sign_error","exponent_lost","unit_missing"].';

-- ── 2. 부분 인덱스(필요 시 빠른 필터링) ────────────────────────────
-- 풀이 이슈가 있는 항목만 빠르게 조회(선생님 검수 우선순위)
CREATE INDEX IF NOT EXISTS idx_grading_items_has_process_flags
  ON public.grading_items USING gin (process_review_flags)
  WHERE process_review_flags IS NOT NULL;

-- ── 3. 검증 ────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='grading_items'
  AND column_name IN ('student_answer_normalized','process_feedback','suggested_partial_score','process_review_flags')
ORDER BY column_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
