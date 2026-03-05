-- 학생 테스트 점수 동기화 운영 검증 쿼리
-- 실행 위치: Supabase SQL Editor (운영)
-- 전제: STUDENT_TEST_SCORE_SETUP.sql 실행 완료

-- 1) 테이블/인덱스/RLS 기본 상태 확인
select
    exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'student_test_scores'
    ) as table_exists;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'student_test_scores'
order by indexname;

select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid = 'public.student_test_scores'::regclass;

select policyname, permissive, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'student_test_scores'
order by policyname;

-- 2) 앱 계정 기준 owner별 데이터 건수 확인(운영 체크)
-- owner_user_id를 치환하지 않아도 실행되도록 안전 파라미터 처리
-- (치환 시 해당 owner만 필터링, 미치환 시 전체 owner 요약)
with owner_param as (
    select nullif('REPLACE_WITH_OWNER_UUID', 'REPLACE_WITH_OWNER_UUID')::uuid as owner_id
)
select owner_user_id, count(*) as score_count
from public.student_test_scores
where (select owner_id from owner_param) is null
   or owner_user_id = (select owner_id from owner_param)
group by owner_user_id;

-- 3) 최근 데이터 샘플 확인(운영 체크)
-- exam_name/score/max_score 값이 앱 입력과 일치하는지 확인
with owner_param as (
    select nullif('REPLACE_WITH_OWNER_UUID', 'REPLACE_WITH_OWNER_UUID')::uuid as owner_id
)
select id, owner_user_id, student_id, teacher_id, exam_name, exam_date, score, max_score, created_at, updated_at
from public.student_test_scores
where (select owner_id from owner_param) is null
   or owner_user_id = (select owner_id from owner_param)
order by created_at desc
limit 20;

-- 4) 제약조건 확인(음수/만점초과 차단)
-- 주의: 아래는 "실패가 정상"인 테스트. 필요 시 트랜잭션으로 롤백 가능.
-- begin;
-- insert into public.student_test_scores
-- (owner_user_id, student_id, teacher_id, exam_name, exam_date, score, max_score)
-- values
-- ('REPLACE_WITH_OWNER_UUID'::uuid, REPLACE_WITH_STUDENT_ID, 'teacher-test', 'invalid-score-check', current_date, 110, 100);
-- rollback;

