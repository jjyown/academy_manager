-- grading_assignments: 선생님이 배정 시 지정하는 마감 시각 (마감일과 함께 사용)
-- 채점 UI·API는 due_date + due_time 조합으로 마감 시각을 해석한다.

ALTER TABLE public.grading_assignments
  ADD COLUMN IF NOT EXISTS due_time TIME;

COMMENT ON COLUMN public.grading_assignments.due_time IS
  '과제 마감 시각(로컬). NULL이면 해당 마감일의 종료 시각 등은 애플리케이션 규칙으로 해석.';
