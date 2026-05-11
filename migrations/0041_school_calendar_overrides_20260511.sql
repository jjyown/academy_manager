-- =====================================================================
-- 0041_school_calendar_overrides_20260511.sql
--
-- 학교 홈페이지 조사 결과 보관 테이블.
-- NEIS Open API 에 누락된 학사일정(특히 자체 시험·방학)을 학교 홈페이지
-- 에서 직접 스크래핑·Gemini 추출해 보강하기 위한 글로벌 테이블.
--
-- 설계 의도:
--   - 학교 학사일정은 공개 정보이므로 학원장(owner) 별로 격리하지 않고
--     (atpt, school_code) 키로 전역 공유. 한 학원장이 조사한 결과를
--     다른 학원장도 그대로 활용할 수 있어 NEIS 미등록 학교 커버리지 ↑.
--   - 조사 트리거(투입 비용)는 인증 원장만 가능하므로 abusive write 차단은
--     RLS 가 아닌 Edge Function (service role) 으로 게이트.
--   - 학부모 포털 / 숙제관리(익명 학생 페이지)에서도 읽어야 하므로
--     SELECT 는 anon + authenticated 모두 허용.
--   - UNIQUE(atpt, school_code, event_date, event_name) 로 재조사 시
--     upsert(ON CONFLICT DO UPDATE) 가능 — 동일 행사가 다시 수집되면
--     content/source_url/investigated_at 만 최신화.
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public') AS public_tables;

-- ── 1. 본 테이블 생성 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_calendar_overrides (
    id BIGSERIAL PRIMARY KEY,

    -- NEIS 표준 키 — atpt(시도교육청) + school_code(SD_SCHUL_CODE) 가 학교 PK
    atpt TEXT NOT NULL,
    school_code TEXT NOT NULL,
    school_name TEXT NOT NULL,

    -- 일정 정보
    event_date DATE NOT NULL,
    event_name TEXT NOT NULL,           -- 예: '1학기 중간고사', '여름방학'
    event_content TEXT DEFAULT '',      -- 상세 (예: '국어/수학')
    event_kind TEXT DEFAULT 'event',    -- 'exam' | 'vacation' | 'event' | 'other'

    -- 추적: 어디서·언제·누가 끌어왔는지
    source_url TEXT,                    -- 조사 대상 학교 홈페이지(또는 학사일정 페이지)
    investigated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    investigated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_calendar_overrides_unique
        UNIQUE (atpt, school_code, event_date, event_name)
);

COMMENT ON TABLE public.school_calendar_overrides IS
    '학교 홈페이지 조사 결과로 보강한 학사일정 (NEIS 미등록 시험·방학 등). 공개 데이터 — 전역 공유.';

CREATE INDEX IF NOT EXISTS idx_school_calendar_overrides_school_month
    ON public.school_calendar_overrides (atpt, school_code, event_date);

CREATE INDEX IF NOT EXISTS idx_school_calendar_overrides_recent
    ON public.school_calendar_overrides (investigated_at DESC);

-- ── 2. updated_at 자동 갱신 트리거 ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._school_calendar_overrides_set_updated_at()
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

DROP TRIGGER IF EXISTS trg_school_calendar_overrides_updated_at
    ON public.school_calendar_overrides;
CREATE TRIGGER trg_school_calendar_overrides_updated_at
    BEFORE UPDATE ON public.school_calendar_overrides
    FOR EACH ROW
    EXECUTE FUNCTION public._school_calendar_overrides_set_updated_at();

REVOKE EXECUTE ON FUNCTION public._school_calendar_overrides_set_updated_at() FROM PUBLIC;

-- ── 3. RLS ─────────────────────────────────────────────────────────
-- 읽기: anon + authenticated (학부모 포털 · 학생 페이지 포함)
-- 쓰기: Edge Function 의 service role 만 — 일반 클라이언트는 RLS 차단
ALTER TABLE public.school_calendar_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_calendar_overrides_public_read" ON public.school_calendar_overrides;
CREATE POLICY "school_calendar_overrides_public_read"
ON public.school_calendar_overrides
FOR SELECT
TO anon, authenticated
USING (true);

-- INSERT/UPDATE/DELETE 정책은 의도적으로 생성하지 않음 → service role 만 통과

-- ── 4. 테이블 권한 ─────────────────────────────────────────────────
GRANT SELECT ON public.school_calendar_overrides TO anon, authenticated;
-- 쓰기 권한은 service role(GRANT 불필요, postgres 슈퍼유저로 통과) 에만 위임

-- ── 5. 검증 ────────────────────────────────────────────────────────
SELECT 'table_created' AS check_name,
       EXISTS(
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name='school_calendar_overrides'
       ) AS ok;

SELECT polname, polcmd
FROM pg_policy
WHERE polrelid = 'public.school_calendar_overrides'::regclass
ORDER BY polname;

SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='school_calendar_overrides'
ORDER BY indexname;

COMMIT;
