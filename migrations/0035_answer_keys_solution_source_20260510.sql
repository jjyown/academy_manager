-- =====================================================================
-- 0032_answer_keys_solution_source_20260510.sql
--
-- answer_keys 에 외부 해설 시스템 매핑 컬럼 추가.
--
-- 배경:
--   별도 Supabase 프로젝트(시험지 해설 제작 = highroad-math-solution,
--   ref=gsdhwuoyiboyzvtokrao)의 검수 완료 해설(exam_solutions / analysis_records)
--   을 채점 결과 화면·학생 포털에서 그대로 재사용하기 위함.
--   채점 서버(grading-server)가 SUPABASE_SERVICE_KEY 로 answer_keys 를 읽을 때
--   이 컬럼을 보고 해당 해설 프로젝트의 PostgREST 를 추가 호출함.
--
-- 컬럼:
--   solution_source jsonb
--     예) {"system":"highroad","exam_name":"2026 모의고사 1회"}
--         {"system":"highroad","pair_series":"쎈 대수"}
--   둘 다 비어 있거나 NULL 이면 「매핑 없음」(현재와 동일 동작).
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.answer_keys DROP COLUMN IF EXISTS solution_source;
-- =====================================================================
BEGIN;

-- ── 정체성 검증(다른 프로젝트에 잘못 붙여넣지 않도록) ────────────────
SELECT current_database() AS db,
       inet_server_addr() AS server_addr,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public') AS public_tables;

-- ── 1. 컬럼 추가 ────────────────────────────────────────────────────
ALTER TABLE public.answer_keys
    ADD COLUMN IF NOT EXISTS solution_source jsonb;

COMMENT ON COLUMN public.answer_keys.solution_source IS
    '외부 해설 시스템 매핑. 예: {"system":"highroad","exam_name":"..."} | {"system":"highroad","pair_series":"..."}';

-- ── 2. 검증 ────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='answer_keys'
  AND column_name='solution_source';

NOTIFY pgrst, 'reload schema';

COMMIT;
