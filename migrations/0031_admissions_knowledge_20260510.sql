-- =====================================================================
-- 0031_admissions_knowledge_20260510.sql
--
-- 종합평가 AI 보강용 「입시 정보·트렌드 지식 베이스」 테이블.
-- collect-admissions-knowledge Edge Function 이 주기적으로(또는 수동) 채우고,
-- generate-student-eval-report 의 Stage 1 (입시 전문가 사전 분석) 에서
-- 학년별로 매칭해 컨텍스트로 주입함.
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- =====================================================================
BEGIN;

-- ── 정체성 검증(다른 프로젝트에 잘못 붙여넣지 않도록) ────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public') AS public_tables;

-- ── 1. 본 테이블 생성 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admissions_knowledge (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- 분류 키. 같은 키로 새 행이 들어오면 최신 것이 사용됨(테이블 자체는 append-only).
    -- 예) 'general_trend', 'high1_trend', 'high2_mock', 'high3_susi', 'high3_jungsi',
    --     'middle_naeshin', 'elementary_habit'
    topic_key TEXT NOT NULL,

    -- 적용 학년대(매칭용). NULL 또는 'all' 이면 모든 학년에 매칭.
    -- 가능한 값: 'elementary', 'middle', 'high1', 'high2', 'high3', 'retake', 'all'
    grade_band TEXT,

    title TEXT NOT NULL,        -- 짧은 제목 (UI 표시용)
    content TEXT NOT NULL,      -- 본문 (마크다운 가능)

    -- 출처 라벨. 'ai_generated' | 'manual' | URL 등
    source TEXT DEFAULT 'manual',

    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,            -- NULL 이면 만료 없음. 보통 60~90일 정도로 두고 갱신.

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.admissions_knowledge IS
    '종합평가 AI 가 학년별 분석에 활용하는 입시 정보·트렌드 지식 베이스(원장별 격리)';

CREATE INDEX IF NOT EXISTS idx_admissions_knowledge_owner_recent
    ON public.admissions_knowledge (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admissions_knowledge_grade_valid
    ON public.admissions_knowledge (owner_user_id, grade_band, valid_until DESC);

-- ── 2. updated_at 자동 갱신 트리거 ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._admissions_knowledge_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admissions_knowledge_updated_at
    ON public.admissions_knowledge;
CREATE TRIGGER trg_admissions_knowledge_updated_at
    BEFORE UPDATE ON public.admissions_knowledge
    FOR EACH ROW
    EXECUTE FUNCTION public._admissions_knowledge_set_updated_at();

-- 트리거 함수의 직접 EXECUTE 권한은 회수(다른 트리거 패턴과 동일)
REVOKE EXECUTE ON FUNCTION public._admissions_knowledge_set_updated_at() FROM PUBLIC;

-- ── 3. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.admissions_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admissions_knowledge_owner_select" ON public.admissions_knowledge;
DROP POLICY IF EXISTS "admissions_knowledge_owner_insert" ON public.admissions_knowledge;
DROP POLICY IF EXISTS "admissions_knowledge_owner_update" ON public.admissions_knowledge;
DROP POLICY IF EXISTS "admissions_knowledge_owner_delete" ON public.admissions_knowledge;

CREATE POLICY "admissions_knowledge_owner_select"
ON public.admissions_knowledge
FOR SELECT
TO authenticated
USING (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "admissions_knowledge_owner_insert"
ON public.admissions_knowledge
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "admissions_knowledge_owner_update"
ON public.admissions_knowledge
FOR UPDATE
TO authenticated
USING (owner_user_id = (SELECT auth.uid()))
WITH CHECK (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "admissions_knowledge_owner_delete"
ON public.admissions_knowledge
FOR DELETE
TO authenticated
USING (owner_user_id = (SELECT auth.uid()));

-- ── 4. 테이블 권한 ─────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions_knowledge TO authenticated;
GRANT USAGE ON SEQUENCE public.admissions_knowledge_id_seq TO authenticated;

-- ── 5. 검증 ────────────────────────────────────────────────────────
SELECT 'table_created' AS check_name,
       EXISTS(
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name='admissions_knowledge'
       ) AS ok;

SELECT polname, polcmd
FROM pg_policy
WHERE polrelid = 'public.admissions_knowledge'::regclass
ORDER BY polname;

SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='admissions_knowledge'
ORDER BY indexname;

COMMIT;
