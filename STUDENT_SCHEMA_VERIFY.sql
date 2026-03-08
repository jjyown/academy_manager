-- 학생 스키마 확장 운영 검증 쿼리
-- 실행 위치: Supabase SQL Editor (운영)
-- 전제: STUDENT_SCHEMA_UPDATE.sql 실행 완료

-- 1) 컬럼 존재 여부 확인
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'students'
  and column_name in ('guardian_name', 'enrollment_start_date', 'enrollment_end_date')
order by column_name;

-- 2) status 체크 제약 확인
select conname, pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid = 'public.students'::regclass
  and conname = 'students_status_check';

-- 3) 인덱스 확인
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'students'
  and (indexname like '%enroll_start%' or indexname like '%enroll_end%')
order by indexname;

-- 4) 확장 필드 샘플 확인(운영 체크)
-- owner_user_id를 치환하지 않아도 실행되도록 안전 파라미터 처리
-- (치환 시 해당 owner만 필터링, 미치환 시 최근 학생 샘플)
with owner_param as (
    select nullif('REPLACE_WITH_OWNER_UUID', 'REPLACE_WITH_OWNER_UUID')::uuid as owner_id
)
select id, name, status, guardian_name, enrollment_start_date, enrollment_end_date
from public.students
where (select owner_id from owner_param) is null
   or owner_user_id = (select owner_id from owner_param)
order by id desc
limit 20;

