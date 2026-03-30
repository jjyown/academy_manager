-- =============================================================================
-- homework_submissions ↔ grading_assignments 연결 (2026-03-30)
-- =============================================================================
-- 선행: public.grading_assignments 존재(예: GRADING_SETUP.sql 적용).
--
-- 목적
--   - 학생이 제출 시 "어느 배정(마감일 기준 과제)"에 대한 제출인지 식별.
--   - O / △ / X 는 애플리케이션에서 계산(저장 컬럼은 선택 사항).
--   - 마감 시각(운영 정책): 학생 schedules 기준, 배정 due_date에 대응하는 **다음 수업 시작 시각의 정각(시 단위, 분 0)**.
--       예: 다음 수업 start_time이 18:30이면 마감 18:00. created_at과 비교.
--       O: 마감 이전 제출 / △: 마감 후 제출 / X: 미제출.
--
-- RLS: 기존 homework_submissions 정책 유지(새 컬럼은 nullable).
-- =============================================================================

ALTER TABLE public.homework_submissions
  ADD COLUMN IF NOT EXISTS grading_assignment_id BIGINT
  REFERENCES public.grading_assignments (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homework_submissions_grading_assignment_id
  ON public.homework_submissions (grading_assignment_id)
  WHERE grading_assignment_id IS NOT NULL;

COMMENT ON COLUMN public.homework_submissions.grading_assignment_id IS
  '채점 배정(grading_assignments) FK. O/△/X는 created_at vs 마감(학생 다음 일정 정각)으로 계산.';
