-- =====================================================================
-- 0042_school_calendar_files_20260512.sql
--
-- 학교 홈페이지에서 다운받은 학사일정 PDF·이미지 파일을 Supabase Storage
-- 에 영구 보관하기 위한 메타데이터 테이블 + 버킷 RLS 정책.
--
-- 동작:
--   - 학원장이 학사일정 직접입력 모달에서 파일 선택 → Storage 버킷
--     'school-calendar-files' 에 업로드 → 본 테이블에 메타 INSERT/UPSERT.
--   - 다음 세션에 모달 열 때 (atpt, school_code) 로 파일 조회 → 자동
--     미리보기 로드.
--   - 학교당 1개 파일만 유지 (UNIQUE) — 새 업로드는 덮어쓰기.
--
-- 데이터 공개 범위:
--   - 학사일정 자료는 공개 정보 (학교 홈페이지에 게시된 것) 이므로
--     anon + authenticated 모두 SELECT 가능. 다른 원장이 조사한 PDF 를
--     재활용해 학교 커버리지 ↑.
--   - 업로드(INSERT/UPDATE/DELETE) 는 authenticated 만.
--
-- 사전 조건:
--   1) Dashboard → Storage → 버킷 'school-calendar-files' 수동 생성 (Public OFF — RLS 로 제어).
--      또는 본 SQL 의 (선택) 섹션 주석 해제로 SQL 에서 생성.
--   2) 0041_school_calendar_overrides 적용 완료.
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public') AS public_tables;

-- ── 1. 메타데이터 테이블 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_calendar_files (
    id BIGSERIAL PRIMARY KEY,

    -- 학교 식별 (NEIS 표준 키)
    atpt TEXT NOT NULL,
    school_code TEXT NOT NULL,
    school_name TEXT NOT NULL,

    -- Storage 경로 (버킷 내부 경로). 예: '{atpt}_{school_code}/2026.pdf'
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,         -- 원본 파일명 (UI 표시용)
    mime_type TEXT NOT NULL,
    file_size BIGINT,                -- 바이트, 표시·진단용

    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 학교당 1개만 유지 — 재업로드 시 ON CONFLICT 로 덮어쓰기
    CONSTRAINT school_calendar_files_unique UNIQUE (atpt, school_code)
);

COMMENT ON TABLE public.school_calendar_files IS
    '학교 학사일정 PDF·이미지 파일 메타. 실제 파일은 Storage 버킷 school-calendar-files 에. 학교당 1개.';

CREATE INDEX IF NOT EXISTS idx_school_calendar_files_school
    ON public.school_calendar_files (atpt, school_code);

-- ── 2. updated_at 트리거 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._school_calendar_files_set_updated_at()
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

DROP TRIGGER IF EXISTS trg_school_calendar_files_updated_at
    ON public.school_calendar_files;
CREATE TRIGGER trg_school_calendar_files_updated_at
    BEFORE UPDATE ON public.school_calendar_files
    FOR EACH ROW
    EXECUTE FUNCTION public._school_calendar_files_set_updated_at();

REVOKE EXECUTE ON FUNCTION public._school_calendar_files_set_updated_at() FROM PUBLIC;

-- ── 3. 테이블 RLS ───────────────────────────────────────────────────
-- 읽기: anon + authenticated
-- 쓰기: authenticated (어느 원장이든 학교 학사일정 자료 공유 가능)
ALTER TABLE public.school_calendar_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_calendar_files_public_read" ON public.school_calendar_files;
DROP POLICY IF EXISTS "school_calendar_files_auth_write" ON public.school_calendar_files;
DROP POLICY IF EXISTS "school_calendar_files_auth_update" ON public.school_calendar_files;
DROP POLICY IF EXISTS "school_calendar_files_auth_delete" ON public.school_calendar_files;

CREATE POLICY "school_calendar_files_public_read"
ON public.school_calendar_files FOR SELECT
TO anon, authenticated USING (true);

CREATE POLICY "school_calendar_files_auth_write"
ON public.school_calendar_files FOR INSERT
TO authenticated
WITH CHECK (uploaded_by = (SELECT auth.uid()));

CREATE POLICY "school_calendar_files_auth_update"
ON public.school_calendar_files FOR UPDATE
TO authenticated
USING (true)                            -- 누구나(인증된 원장) 갱신 가능
WITH CHECK (uploaded_by = (SELECT auth.uid())); -- 단, 본인 uid 로 갱신

CREATE POLICY "school_calendar_files_auth_delete"
ON public.school_calendar_files FOR DELETE
TO authenticated USING (true);

GRANT SELECT ON public.school_calendar_files TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.school_calendar_files TO authenticated;
GRANT USAGE ON SEQUENCE public.school_calendar_files_id_seq TO authenticated;

-- ── 4. Storage 버킷 RLS (storage.objects 정책) ─────────────────────
-- ⚠️ 버킷 'school-calendar-files' 는 Dashboard → Storage 에서 미리 생성 필요
--    (Public 토글 OFF — 우리가 정책으로 직접 제어)
-- 파일 경로 구조: '{atpt}_{school_code}/{originalFileName}' 예) 'C10_7150216/2026.pdf'

-- 기존 동일 이름 정책 제거 후 재생성(재실행 안전)
DROP POLICY IF EXISTS "school_calendar_files_public_read" ON storage.objects;
DROP POLICY IF EXISTS "school_calendar_files_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "school_calendar_files_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "school_calendar_files_auth_delete" ON storage.objects;

-- 읽기: anon + authenticated 모두 — 학부모 포털·숙제관리에서도 미리보기 가능
CREATE POLICY "school_calendar_files_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'school-calendar-files');

-- 업로드: authenticated 만
CREATE POLICY "school_calendar_files_auth_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'school-calendar-files');

-- 교체(같은 경로 덮어쓰기): authenticated 만
CREATE POLICY "school_calendar_files_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'school-calendar-files');

-- 삭제: authenticated 만
CREATE POLICY "school_calendar_files_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'school-calendar-files');

-- ── 5. (선택) 버킷 자동 생성 ────────────────────────────────────────
-- Dashboard 에서 수동 생성을 권장하지만, SQL 으로도 생성 가능.
-- 주석 해제 후 실행하면 버킷이 없을 때만 생성됨. file_size_limit = 30MB.
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--     'school-calendar-files',
--     'school-calendar-files',
--     false,
--     31457280,  -- 30MB
--     ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif']
-- ) ON CONFLICT (id) DO NOTHING;

-- ── 6. 검증 ──────────────────────────────────────────────────────────
SELECT 'table_created' AS check_name,
       EXISTS(
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name='school_calendar_files'
       ) AS ok;

SELECT polname, polcmd
FROM pg_policy
WHERE polrelid = 'public.school_calendar_files'::regclass
ORDER BY polname;

SELECT polname, polcmd
FROM pg_policy
WHERE polrelid = 'storage.objects'::regclass
  AND polname LIKE 'school_calendar_files%'
ORDER BY polname;

COMMIT;
