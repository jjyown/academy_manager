-- =====================================================================
-- 0033_student_eval_image_url_20260510.sql
--
-- 종합평가를 학부모에게 「전문가 양식 이미지」 로 보여주기 위한
--   1) student_evaluations.image_url TEXT 컬럼 추가
--   2) Supabase Storage 버킷 'student-eval-reports' 생성 (public read)
--   3) 버킷 RLS 정책: owner 본인만 INSERT/UPDATE/DELETE,
--      누구나 SELECT(URL 알면 읽기 가능 — 학부모 포털용)
--
-- 적용: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 정책 ID 가 이미 있으면 conflict 없이 idempotent 하게 동작.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='student_evaluations') AS has_eval_table;

-- ── 1) image_url 컬럼 추가 ──────────────────────────────────────────
ALTER TABLE public.student_evaluations
    ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN public.student_evaluations.image_url IS
    '학부모 발송용 종합평가 이미지(PNG) 의 Storage public URL — 학부모 포털은 이 이미지를 우선 표시';

-- ── 2) Storage 버킷 생성 (idempotent) ───────────────────────────────
-- public=true: URL 알면 인증 없이 GET 가능 (학부모 포털 공유에 필요).
--             파일 경로에 owner_user_id + student_id + eval_month 들어가
--             외부에서 임의 추측 매우 어려움.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'student-eval-reports',
    'student-eval-reports',
    true,
    5242880,                           -- 5MB 상한
    ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
    SET public = true,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/png', 'image/jpeg'];

-- ── 3) Storage RLS 정책 ────────────────────────────────────────────
-- 누구나 SELECT(공개 읽기) — 학부모 포털 호환. INSERT/UPDATE/DELETE 는
-- 인증된 사용자가 자신 소유의 학생 평가 파일만 접근 가능.
-- 파일 path 규칙: {owner_user_id}/{student_id}_{eval_month}.png
-- → split_part(name, '/', 1) = owner_uuid

DROP POLICY IF EXISTS "student_eval_reports_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "student_eval_reports_owner_insert"  ON storage.objects;
DROP POLICY IF EXISTS "student_eval_reports_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "student_eval_reports_owner_delete"  ON storage.objects;

CREATE POLICY "student_eval_reports_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'student-eval-reports');

CREATE POLICY "student_eval_reports_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'student-eval-reports'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);

CREATE POLICY "student_eval_reports_owner_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'student-eval-reports'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
)
WITH CHECK (
    bucket_id = 'student-eval-reports'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);

CREATE POLICY "student_eval_reports_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'student-eval-reports'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);

-- ── 검증 ────────────────────────────────────────────────────────────
SELECT 'image_url_column' AS check_name,
       EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='student_evaluations' AND column_name='image_url'
       ) AS ok;

SELECT 'bucket' AS check_name, id, public, file_size_limit
FROM storage.buckets WHERE id='student-eval-reports';

SELECT polname, polcmd FROM pg_policy
WHERE polrelid = 'storage.objects'::regclass
  AND polname LIKE 'student_eval_reports_%'
ORDER BY polname;

COMMIT;
