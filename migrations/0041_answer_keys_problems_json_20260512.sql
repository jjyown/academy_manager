-- =====================================================================
-- 0041_answer_keys_problems_json_20260512.sql
--
-- answer_keys 테이블에 problems_json (jsonb) 컬럼 추가.
-- 문제 단위 통합 데이터(번호·이미지·정답·유형·해설·페이지)를 한 배열에 보관.
--
-- 배경(2026-05-12):
--   - 기존엔 answers_json{Q:A}, question_types_json{Q:type}, page_images_json[]
--     세 컬럼이 분산 저장 → 학생 채점·오답 분석 시 문제번호 기준 조인이 불편.
--   - 해설지 제작 프로젝트의 questionVisuals.ts Map<questionNo, image> 패턴 도입.
--   - 문제·정답·해설을 한 묶음으로 보관해 채점·해설 노출·학생별 약점 분석을 단순화.
--
-- 스키마:
--   problems_json JSONB
--     형식: [{"num":"1","image_url":"...","answer":"②","type":"mc",
--              "explanation":"...","page":1}, ...]
--   기존 answers_json / question_types_json 은 호환을 위해 유지 (deprecate 검토 별도).
--
-- 검증:
--   기본값 = '[]'::jsonb (NOT NULL 강제는 단계별 도입 — 우선 NULL 허용 유지)
--   인덱스: problem 개수 카운트가 빈번하면 추후 GIN 추가
--
-- 적용: Supabase Dashboard → SQL Editor 에 본 파일 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.answer_keys DROP COLUMN IF EXISTS problems_json;
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db, inet_server_addr() AS server_addr;

-- ── 1. problems_json 컬럼 추가 ──────────────────────────────────────
ALTER TABLE public.answer_keys
    ADD COLUMN IF NOT EXISTS problems_json JSONB;

COMMENT ON COLUMN public.answer_keys.problems_json IS
    '문제 단위 통합 데이터 배열. 각 요소: {num, image_url, answer, type(mc|short|essay), explanation, page}.
     해설지 제작 프로젝트의 questionVisuals 패턴 도입. answers_json / question_types_json 은 호환 유지.';

-- ── 2. (선택) 부분 인덱스 — 비어있지 않은 row 만 ──────────────────
-- 풀이·분석 쿼리에서 problems_json IS NOT NULL 조건이 자주 들어가면 유용.
CREATE INDEX IF NOT EXISTS idx_answer_keys_problems_present
    ON public.answer_keys ((problems_json IS NOT NULL))
    WHERE problems_json IS NOT NULL;

-- ── 3. 검증 ────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='answer_keys'
  AND column_name = 'problems_json';

NOTIFY pgrst, 'reload schema';

COMMIT;
