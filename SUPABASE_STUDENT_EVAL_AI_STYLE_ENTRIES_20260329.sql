-- 종합평가 AI 고정 지침: 행 단위 누적 (users 컬럼 대신 별도 테이블)
-- 적용 후: 앱은 INSERT만 하며, 레거시 컬럼은 비어 있을 때만 읽기 폴백용으로 유지

CREATE TABLE IF NOT EXISTS public.student_eval_ai_style_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_eval_ai_style_entries_content_len CHECK (
    char_length(content) >= 1 AND char_length(content) <= 1200
  )
);

CREATE INDEX IF NOT EXISTS student_eval_ai_style_entries_owner_created_idx
  ON public.student_eval_ai_style_entries (owner_user_id, created_at);

COMMENT ON TABLE public.student_eval_ai_style_entries IS '원장별 종합평가 AI 고정 지침(한 줄=한 번 저장·시간순 합침)';
COMMENT ON COLUMN public.student_eval_ai_style_entries.content IS '해당 시점에 추가한 지침 본문(최대 1200자)';

ALTER TABLE public.student_eval_ai_style_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_eval_ai_style_entries_select_own" ON public.student_eval_ai_style_entries;
CREATE POLICY "student_eval_ai_style_entries_select_own" ON public.student_eval_ai_style_entries
  FOR SELECT USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "student_eval_ai_style_entries_insert_own" ON public.student_eval_ai_style_entries;
CREATE POLICY "student_eval_ai_style_entries_insert_own" ON public.student_eval_ai_style_entries
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "student_eval_ai_style_entries_delete_own" ON public.student_eval_ai_style_entries;
CREATE POLICY "student_eval_ai_style_entries_delete_own" ON public.student_eval_ai_style_entries
  FOR DELETE USING (owner_user_id = auth.uid());

-- 기존 users.student_eval_ai_style_note → 첫 행으로 1회 이관(이미 항목이 있으면 스킵)
-- 한 행 최대 1200자: 초과분은 이관 전에 Table Editor에서 나누거나, 이관 후 앱에서 항목 추가로 보완
INSERT INTO public.student_eval_ai_style_entries (owner_user_id, content)
SELECT u.id, left(btrim(u.student_eval_ai_style_note::text), 1200)
FROM public.users u
WHERE u.student_eval_ai_style_note IS NOT NULL
  AND length(btrim(u.student_eval_ai_style_note::text)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.student_eval_ai_style_entries e WHERE e.owner_user_id = u.id
  );

-- 이관된 행은 컬럼 비워 중복 표시 방지(미이관 계정은 컬럼 그대로 폴백)
UPDATE public.users u
SET student_eval_ai_style_note = NULL
WHERE u.student_eval_ai_style_note IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.student_eval_ai_style_entries e WHERE e.owner_user_id = u.id);
