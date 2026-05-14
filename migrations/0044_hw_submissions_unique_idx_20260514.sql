begin;

-- 활성(uploaded) 제출은 학생+과제 조합이 유일해야 함
-- Stage 1-B에서 409 체크 제거 후 동시 요청 race 방지
create unique index if not exists hw_submissions_active_unique
  on homework_submissions (student_id, grading_assignment_id)
  where status = 'uploaded';

commit;

-- 검증
select indexname, indexdef
from pg_indexes
where tablename = 'homework_submissions'
  and indexname = 'hw_submissions_active_unique';
