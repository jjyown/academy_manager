-- =====================================================================
-- 0032_admissions_knowledge_weekly_cron_20260510.sql
--
-- collect-admissions-knowledge Edge Function 을 매주 월요일 06:00 KST
-- (= UTC 일요일 21:00) 에 자동 호출하도록 pg_cron 스케줄 등록.
--
-- 호출 본문은 mode='auto' 고, 헤더에 x-cron-secret 과 x-target-owner UUID 를 실어
-- Edge 함수가 인증·소유자 식별을 처리.
--
-- 사전 조건:
--   1) migrations/0031_admissions_knowledge_20260510.sql 적용 완료
--   2) pg_cron, pg_net 익스텐션 활성화 (Supabase Dashboard → Database → Extensions)
--      pg_cron     : 스케줄러
--      pg_net      : SQL 에서 HTTP POST 호출
--   3) Supabase Edge Function 시크릿에 CRON_SECRET 설정
--      ex) npx supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
--   4) 본 SQL 의 :owner_uuid / :cron_secret 자리에 실제값 채워서 실행
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에서 본 파일 전체 붙여넣고,
--   _OWNER_UUID_HERE_  와  _CRON_SECRET_HERE_  를 실제값으로 바꿔 Run.
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       (SELECT COUNT(*) FROM pg_extension WHERE extname='pg_cron')   AS has_pg_cron,
       (SELECT COUNT(*) FROM pg_extension WHERE extname='pg_net')    AS has_pg_net;

-- ── 익스텐션 확인 (없으면 즉시 실패) ────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron extension 미설치 — Dashboard → Database → Extensions 에서 활성화하세요.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RAISE EXCEPTION 'pg_net extension 미설치 — Dashboard → Database → Extensions 에서 활성화하세요.';
    END IF;
END $$;

-- ── 기존 같은 이름 잡 제거(재적용 안전) ────────────────────────────
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('admissions_knowledge_weekly');

-- ── 잡 등록 ────────────────────────────────────────────────────────
-- 매주 월요일 06:00 KST = 일요일 21:00 UTC
-- cron 표기: 분 시 일 월 요일 (UTC 기준)
SELECT cron.schedule(
    'admissions_knowledge_weekly',
    '0 21 * * 0',
    $cron_body$
    SELECT net.http_post(
        url      := 'https://jzcrpdeomjmytfekcgqu.supabase.co/functions/v1/collect-admissions-knowledge',
        headers  := jsonb_build_object(
            'Content-Type',     'application/json',
            'x-cron-secret',    '_CRON_SECRET_HERE_',
            'x-target-owner',   '_OWNER_UUID_HERE_'
        ),
        body     := jsonb_build_object('mode', 'auto'),
        timeout_milliseconds := 90000
    );
    $cron_body$
);

-- ── 검증 ────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'admissions_knowledge_weekly';

-- 최근 잡 실행 이력 (실행 후 확인용)
-- SELECT * FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='admissions_knowledge_weekly')
-- ORDER BY start_time DESC LIMIT 5;

COMMIT;

-- =====================================================================
-- 즉시 1회 테스트(스케줄을 기다리지 않고 동작 확인). 위 BEGIN/COMMIT 외부.
-- _OWNER_UUID_HERE_ / _CRON_SECRET_HERE_ 가 정상이면 1행이 반환되고,
-- 곧 admissions_knowledge 에 6행이 삽입됨.
-- =====================================================================
-- SELECT net.http_post(
--     url := 'https://jzcrpdeomjmytfekcgqu.supabase.co/functions/v1/collect-admissions-knowledge',
--     headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret',  '_CRON_SECRET_HERE_',
--         'x-target-owner', '_OWNER_UUID_HERE_'
--     ),
--     body := jsonb_build_object('mode', 'auto'),
--     timeout_milliseconds := 90000
-- );
