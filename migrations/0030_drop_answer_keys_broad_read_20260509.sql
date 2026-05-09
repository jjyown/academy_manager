-- ============================================================
-- 0030 answer_keys 광역 SELECT 정책 제거
-- 작성일: 2026-05-09
-- 목적: Supabase advisor `multiple_permissive_policies` + 보안 위생
--   * 기존 정책:
--     - answer_keys_read  (SELECT, auth.role()='authenticated')  ← 너무 광범위
--     - answer_keys_write (ALL,    auth.uid() = teacher_id)       ← owner 본인만
--   * answer_keys_read 는 인증된 모든 사용자에게 모든 owner 의 정답지를
--     노출했음. 클라이언트(브라우저 supabase-js) 직접 접근 0건 확인 —
--     모든 answer_keys 접근은 grading-server(SUPABASE_SERVICE_KEY) 경유로
--     RLS 자체를 우회하므로 정책 축소가 클라이언트 동작에 영향 없음.
--   * answer_keys.teacher_id 는 실제로 auth.users.id(=teachers.owner_user_id)
--     를 저장 — 컬럼명만 teacher_id 일 뿐 owner 와 동치(샘플 데이터 검증).
-- 위험도: 매우 낮음. answer_keys_write 가 owner SELECT 도 커버하므로
--        본인 정답지 조회는 정상.
-- 롤백:
--   create policy "answer_keys_read" on public.answer_keys
--     for select using (auth.role() = 'authenticated');
-- ============================================================

begin;

drop policy if exists "answer_keys_read" on public.answer_keys;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 검증) answer_keys 잔존 정책 (answer_keys_write 만 남아야 함)
-- ============================================================
select policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'answer_keys'
order by policyname;
