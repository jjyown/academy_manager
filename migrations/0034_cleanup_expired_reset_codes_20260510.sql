-- =====================================================================
-- 0034_cleanup_expired_reset_codes_20260510.sql
--
-- teacher_reset_codes 테이블의 만료 코드를 매시간 자동 삭제하는
-- pg_cron 잡 등록.
--
-- 배경:
--   migrations/0001_supabase_complete_setup.sql:539-544 에 동일 의도의
--   주석 처리된 cron 스니펫이 있었으나 실제로는 활성화되지 않아
--   만료된 비밀번호 리셋 코드가 무한 누적되고 있었다.
--   인증 토큰류는 사용 후 또는 만료 후 즉시 폐기하는 것이 보안 원칙.
--
-- 사전 조건:
--   1) pg_cron 익스텐션 활성화 (Supabase Dashboard → Database → Extensions)
--      0032 가 이미 적용되었다면 이미 활성 상태.
--   2) teacher_reset_codes 테이블 존재 (0001 에서 생성됨)
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 별도 시크릿이나 자리표시자 치환 불필요.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM pg_extension WHERE extname='pg_cron') AS has_pg_cron,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='teacher_reset_codes') AS has_table;

-- ── 익스텐션 확인 ──────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron extension 미설치 — Dashboard → Database → Extensions 에서 활성화하세요.';
    END IF;
END $$;

-- ── 기존 같은 이름 잡 제거(재적용 안전) ────────────────────────────
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('cleanup_expired_reset_codes');

-- ── 잡 등록 ────────────────────────────────────────────────────────
-- 매시간 정각(UTC) 실행 — 만료(expires_at < now()) 또는 사용된(used=true)
-- 24시간 이상 경과 코드 삭제. used 코드는 감사 로그 목적으로 24h 보존.
SELECT cron.schedule(
    'cleanup_expired_reset_codes',
    '0 * * * *',
    $cron_body$
    DELETE FROM teacher_reset_codes
    WHERE expires_at < now()
       OR (used = TRUE AND created_at < now() - interval '24 hours');
    $cron_body$
);

-- ── 검증 ────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'cleanup_expired_reset_codes';

-- 즉시 1회 실행(첫 정리)
DELETE FROM teacher_reset_codes
WHERE expires_at < now()
   OR (used = TRUE AND created_at < now() - interval '24 hours');

COMMIT;

-- =====================================================================
-- 적용 후 확인:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='cleanup_expired_reset_codes')
--   ORDER BY start_time DESC LIMIT 5;
-- =====================================================================
