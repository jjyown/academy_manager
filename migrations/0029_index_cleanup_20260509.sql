-- ============================================================
-- 0029 인덱스 정리 (중복 1개 DROP + FK 미인덱스 7개 ADD)
-- 작성일: 2026-05-09
-- 목적: Supabase advisor `duplicate_index` 1건 + `unindexed_foreign_keys` 7건 해소
-- 위험도: 낮음. CREATE INDEX IF NOT EXISTS 사용 (작은 테이블이라 즉시 완료).
--        DROP INDEX 는 동일 정의의 다른 인덱스가 남아있어 쿼리 영향 없음.
-- 참고: 본 환경 데이터 규모 작음(가장 큰 attendance_records=195행) →
--       CONCURRENTLY 옵션 없이 단일 트랜잭션으로 안전.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) 중복 인덱스 제거
-- teacher_reset_codes 에 동일 정의의 인덱스 2개 존재:
--   * idx_reset_codes_teacher    (teacher_id)
--   * idx_reset_codes_teacher_id (teacher_id)
-- 컨벤션 일치하는 _teacher_id 를 남기고 _teacher 제거
-- ------------------------------------------------------------
drop index if exists public.idx_reset_codes_teacher;

-- ------------------------------------------------------------
-- 2) FK 미인덱스 추가 (advisor unindexed_foreign_keys 7건)
-- 모두 small/medium 카디널리티. JOIN 성능 / 외래키 무결성 검사 가속.
-- ------------------------------------------------------------
create index if not exists idx_grading_assignments_answer_key_id
  on public.grading_assignments (answer_key_id);

create index if not exists idx_grading_feedback_item_id
  on public.grading_feedback (item_id);

create index if not exists idx_grading_feedback_result_id
  on public.grading_feedback (result_id);

create index if not exists idx_grading_results_answer_key_id
  on public.grading_results (answer_key_id);

create index if not exists idx_grading_stats_answer_key_id
  on public.grading_stats (answer_key_id);

create index if not exists idx_student_books_answer_key_id
  on public.student_books (answer_key_id);

create index if not exists idx_student_test_scores_student_id
  on public.student_test_scores (student_id);

commit;

-- ============================================================
-- 검증) 변경된 인덱스 목록 확인
-- 기대:
--   * teacher_reset_codes 에 idx_reset_codes_teacher 가 없어야 함
--   * 7개 새 인덱스가 존재해야 함
-- ============================================================
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and (
    indexname = 'idx_reset_codes_teacher'  -- 없어야 함
    or indexname in (
      'idx_grading_assignments_answer_key_id',
      'idx_grading_feedback_item_id',
      'idx_grading_feedback_result_id',
      'idx_grading_results_answer_key_id',
      'idx_grading_stats_answer_key_id',
      'idx_student_books_answer_key_id',
      'idx_student_test_scores_student_id'
    )
  )
order by tablename, indexname;
