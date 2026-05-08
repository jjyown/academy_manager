-- 학부모 포털 종합평가 공개 스위치 + AI 생성 연동 준비
-- 적용 후: parent_portal_visible = true 인 행만 anon(학부모) SELECT 허용
-- 기존 작성된 평가는 공개 유지(내용이 있는 행만 true로 보정)
--
-- 운영 체크리스트(권장 순서):
-- 1) 본 SQL을 Supabase SQL Editor에서 실행
-- 2) `GEMINI_API_KEY`(및 선택 `GEMINI_EVAL_MODEL`) 시크릿 설정
-- 3) `npx supabase functions deploy generate-student-eval-report` (줄바꿈·2000자 상한 등 Edge 로직 반영)
-- 4) 정적 사이트(index·parent-portal) 배포 후 브라우저 강력 새로고침
-- 참고: `student_evaluations.comment`는 프로젝트 기본 스키마에서 TEXT(긴 본문 허용)

ALTER TABLE public.student_evaluations
  ADD COLUMN IF NOT EXISTS parent_portal_visible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.student_evaluations.parent_portal_visible IS 'true일 때만 학부모 포털(anon)에서 종합평가 본문 조회 허용';

UPDATE public.student_evaluations
SET parent_portal_visible = TRUE
WHERE comment IS NOT NULL
  AND length(trim(comment)) > 0;

DROP POLICY IF EXISTS "evaluations_public_read" ON public.student_evaluations;
CREATE POLICY "evaluations_public_read" ON public.student_evaluations
  FOR SELECT USING (
    COALESCE(parent_portal_visible, false) = true
    AND EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = student_evaluations.student_id
        AND s.status = 'active'
        AND s.parent_code IS NOT NULL
        AND btrim(s.parent_code) <> ''
    )
  );
