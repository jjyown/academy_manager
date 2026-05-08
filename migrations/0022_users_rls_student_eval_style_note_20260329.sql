-- public.users: 로그인 사용자가 본인 행의 student_eval_ai_style_note 만 읽기·수정 가능하도록 RLS 보강
-- 증상: 고정 지침 저장 시 토스트는 성공인데 DB가 NULL → UPDATE가 0행이거나 RLS 차단인 경우가 많음
-- (Table Editor는 postgres로 보면 되지만, 앱은 anon+JWT로 UPDATE 함)

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 기존에 본인 SELECT 정책이 있어도 이름이 다르면 공존 가능. 동일 이름이면 교체.
DROP POLICY IF EXISTS "users_select_own_row" ON public.users;
CREATE POLICY "users_select_own_row" ON public.users
  FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "users_update_own_row" ON public.users;
CREATE POLICY "users_update_own_row" ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT는 회원가입 트리거 등에서 처리하는 경우가 많아 여기서는 다루지 않음.
