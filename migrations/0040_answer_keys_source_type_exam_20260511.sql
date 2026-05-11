-- =====================================================================
-- 0040_answer_keys_source_type_exam_20260511.sql
--
-- answer_keys.source_type CHECK 제약에 'exam' 값 추가.
--
-- 배경(2026-05-11):
--   교재 등록 시 "정답 자동 추출"을 전제로 PDF를 받아왔으나, 사용자가
--   시험지(문제만 있고 정답 페이지 없는 PDF, 예: 내신·모의고사)를 올리는
--   케이스에서 추출 0건임에도 parsed=True 로 저장돼 UI에 "파싱완료 · 0문제"
--   라는 모순 표시가 발생. 시험지 모드를 명시적으로 도입해 UX 모호성을
--   제거하고 자동채점 매핑 흐름(해설지 매핑 또는 + 문제 추가)으로 유도.
--
-- 변경 사항:
--   source_type CHECK 화이트리스트에 'exam' 추가.
--     - 'book'   : 시중교재 (기존)
--     - 'custom' : 자체제작 숙제 PDF (기존)
--     - 'manual' : PDF 없이 정답만 입력 (기존)
--     - 'exam'   : 시험지/모의고사 — PDF 파싱 skip, 페이지 이미지만 생성 (신규)
--                   정답은 + 문제 추가 또는 외부 해설(solution_source) 매핑으로 보강.
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.answer_keys DROP CONSTRAINT IF EXISTS answer_keys_source_type_check;
--   ALTER TABLE public.answer_keys
--     ADD CONSTRAINT answer_keys_source_type_check
--     CHECK (source_type IS NULL OR source_type IN ('book', 'custom', 'manual'));
-- =====================================================================
BEGIN;

-- ── 정체성 검증 ─────────────────────────────────────────────────────
SELECT current_database() AS db,
       inet_server_addr() AS server_addr;

-- ── 기존 CHECK 제약 제거 후 재생성 ─────────────────────────────────
ALTER TABLE public.answer_keys
    DROP CONSTRAINT IF EXISTS answer_keys_source_type_check;

ALTER TABLE public.answer_keys
    ADD CONSTRAINT answer_keys_source_type_check
    CHECK (source_type IS NULL OR source_type IN ('book', 'custom', 'manual', 'exam'));

COMMENT ON COLUMN public.answer_keys.source_type IS
    '정답 PDF 출처. ''book''=시중교재, ''custom''=자체제작 숙제, ''manual''=정답만 입력(PDF X), ''exam''=시험지/모의고사(파싱 skip, 정답 수동·매핑). NULL=레거시(book 으로 해석).';

-- ── 검증 ────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'answer_keys_source_type_check';

NOTIFY pgrst, 'reload schema';

COMMIT;
