-- =====================================================================
-- 0036_tighten_student_eval_reports_bucket_listing_20260511.sql
--
-- 목적:
--   Storage 버킷 `student-eval-reports` 의 광역 SELECT 정책
--   (`student_eval_reports_public_read`) 을 제거하고, owner 본인만
--   storage.objects 행을 SELECT(=list/download API)할 수 있도록 축소한다.
--
-- 배경 (Supabase Security Advisor: public_bucket_allows_listing):
--   0033 마이그레이션에서 `student_eval_reports_public_read` 정책을
--   `TO public USING (bucket_id = 'student-eval-reports')` 로 너무 광범위하게
--   부여하여, 누구나 storage.objects 행을 SELECT 할 수 있어 버킷 내 모든
--   파일을 list/검색하는 것이 가능했다. 버킷 자체는 public=true 이므로
--   이미지 표시는 `/storage/v1/object/public/<bucket>/<path>` 공용 CDN
--   엔드포인트를 통해 이루어지며, 이 경로는 RLS 와 무관하게 작동한다.
--   따라서 광역 정책은 listing 위험만 만들고 실제 학부모 포털 동작에는
--   기여하지 않는다.
--
-- 코드 검증 (2026-05-11):
--   1) parent-portal/report.js:986 — `<img src={image_url}>` 로 URL 문자열만 사용
--      (storage.from().download() / list() 호출 없음 — public CDN 경로로 GET)
--   2) database.js:1545 — `.upload()` 는 owner_insert 정책으로 동작
--   3) database.js:1562 — `.getPublicUrl()` 은 클라이언트 측 URL 구성으로 RLS 미경유
--   4) 코드베이스 전체에 student-eval-reports 버킷에 대한 .list() / .download()
--      호출 없음 — 광역 SELECT 정책 제거가 안전.
--
-- 효과:
--   - 학부모 포털: image_url 의 public CDN GET 으로 표시 → 영향 없음
--   - 원장 업로드/덮어쓰기/삭제: owner_* 정책으로 계속 동작
--   - 외부에서 버킷 listing/임의 객체 탐색: 차단됨
--   - 향후 원장이 자신 파일을 list/download API 로 조회해야 한다면 (현재 코드에는
--     없음) 본 마이그레이션에서 새로 추가한 owner_select 정책으로 자기 파일만
--     접근 가능.
--
-- 적용: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 0033 적용 후 idempotent.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       inet_server_addr() AS server_addr,
       (SELECT public FROM storage.buckets WHERE id='student-eval-reports') AS bucket_is_public,
       (SELECT COUNT(*) FROM pg_policy
          WHERE polrelid='storage.objects'::regclass
            AND polname='student_eval_reports_public_read')                  AS broad_policy_present;

-- 안전장치: 버킷이 아직 public=true 인 상태여야 학부모 포털이 CDN 경로로 동작.
-- (만약 누가 실수로 비공개 전환했다면 본 마이그레이션을 중단해 사용자에게 통지.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id='student-eval-reports' AND public = true
    ) THEN
        RAISE EXCEPTION
            'student-eval-reports 버킷이 public=true 가 아닙니다. 학부모 포털 CDN 경로 동작 보장을 위해 본 마이그레이션을 중단합니다. 버킷을 public 으로 되돌리거나 정책 설계를 다시 검토하세요.';
    END IF;
END $$;

-- ── 1) 광역 public SELECT 정책 제거 ────────────────────────────────
DROP POLICY IF EXISTS "student_eval_reports_public_read" ON storage.objects;

-- ── 2) owner-only SELECT 정책 추가 (인증 사용자가 자기 파일만 조회) ──
-- 학부모 포털은 RLS 를 거치지 않는 public CDN URL 로 표시하므로 영향 없음.
-- 원장 측에서 향후 .list() / .download() 가 필요할 때 owner 본인 파일만 접근 가능.
DROP POLICY IF EXISTS "student_eval_reports_owner_select" ON storage.objects;
CREATE POLICY "student_eval_reports_owner_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'student-eval-reports'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);

-- ── 검증 ────────────────────────────────────────────────────────────
-- (A) 광역 정책 제거 확인 (0건이어야 정상)
SELECT 'broad_policy_removed' AS check_name,
       COUNT(*) = 0 AS ok
FROM pg_policy
WHERE polrelid='storage.objects'::regclass
  AND polname='student_eval_reports_public_read';

-- (B) owner_* 정책 4종 (select/insert/update/delete) 존재 확인 (4건이어야 정상)
SELECT 'owner_policies_present' AS check_name,
       COUNT(*) AS owner_policy_count,
       COUNT(*) = 4 AS ok
FROM pg_policy
WHERE polrelid='storage.objects'::regclass
  AND polname IN (
      'student_eval_reports_owner_select',
      'student_eval_reports_owner_insert',
      'student_eval_reports_owner_update',
      'student_eval_reports_owner_delete'
  );

-- (C) 버킷은 여전히 public=true 인지 (학부모 포털 CDN GET 보장)
SELECT 'bucket_still_public' AS check_name,
       public AS ok
FROM storage.buckets WHERE id='student-eval-reports';

-- (D) 현재 부착된 student_eval_reports_* 정책 전체 나열 (육안 점검용)
SELECT polname, polcmd
FROM pg_policy
WHERE polrelid='storage.objects'::regclass
  AND polname LIKE 'student_eval_reports_%'
ORDER BY polname;

COMMIT;

-- =====================================================================
-- 롤백 (필요 시 — 광역 public SELECT 복구):
--   BEGIN;
--   DROP POLICY IF EXISTS "student_eval_reports_owner_select" ON storage.objects;
--   CREATE POLICY "student_eval_reports_public_read"
--       ON storage.objects FOR SELECT TO public
--       USING (bucket_id = 'student-eval-reports');
--   COMMIT;
--
-- 적용 후 확인 (Dashboard → Database → Linter):
--   `public_bucket_allows_listing` 경고가 사라져야 함.
--
-- 학부모 포털 회귀 점검:
--   1) image_url 가 채워진 학생 1명의 학부모 포털 진입
--   2) 종합평가 이미지가 정상 표시되는지 (브라우저 네트워크 탭에서
--      `/storage/v1/object/public/student-eval-reports/...` 200 응답 확인)
--   3) 원장 측에서 새 종합평가 이미지 발송 시도 → 업로드 성공
-- =====================================================================
