-- =====================================================================
-- 0037_answer_keys_source_type_20260511.sql
--
-- answer_keys 에 "정답 PDF 출처 구분" 컬럼 추가 + 자체제작 숙제 PDF Drive
-- 메타데이터 컬럼 보강. 운영 워크플로우 분기를 단일 테이블에서 식별 가능.
--
-- 운영 워크플로우 (2026-05-11 합의):
--   1) 시중교재 (source_type='book')
--      - 미리 파싱된 answer_keys 풀에서 선택만, 새 PDF 업로드 없음
--      - 정답 PDF 는 기존 "숙제 관리/교재/{학년}/{교재}/" 폴더에 존재
--      - 페이지 이미지: "숙제 관리/교재/.../page_NNN.jpg"
--      - grading_assignments 가 answer_key_id + page_range 로 매핑
--
--   2) 자체제작 (source_type='custom')
--      - 선생님이 직접 PDF 업로드
--      - 새 폴더: "숙제 관리/학생들에게 나간숙제 자료/{YYYY}년/{M}월/{D}일/"
--      - 파일명 규칙: {YYYY}-{MM}-{DD}-{숙제명}.pdf  (사용자 요청)
--      - 파싱 결과는 동일하게 answer_keys 에 등록 → 자동채점 파이프라인 공유
--
--   3) 수동 (source_type='manual')
--      - PDF 없이 선생님이 정답을 직접 answers_json 으로 입력만 한 경우
--      - drive_file_id 가 NULL 이어도 안전하게 식별
--
-- 컬럼:
--   source_type TEXT
--     'book' | 'custom' | 'manual'  — NULL 허용(레거시 row 호환, 애플리케이션에서 'book' 기본)
--
-- 검증:
--   기본값 강제 X (레거시 NULL 보존). 신규 INSERT 는 애플리케이션이 명시.
--   CHECK 제약: 값이 있을 때만 화이트리스트 검사.
--
-- 적용 방법: Supabase Dashboard → SQL Editor 에 본 파일 전체 붙여넣고 Run.
-- 롤백:
--   ALTER TABLE public.answer_keys DROP COLUMN IF EXISTS source_type;
-- =====================================================================
BEGIN;

-- ── 정체성 검증(다른 프로젝트에 잘못 붙여넣지 않도록) ────────────────
SELECT current_database() AS db,
       inet_server_addr() AS server_addr,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public') AS public_tables;

-- ── 1. answer_keys.source_type 컬럼 추가 ───────────────────────────
ALTER TABLE public.answer_keys
    ADD COLUMN IF NOT EXISTS source_type TEXT;

COMMENT ON COLUMN public.answer_keys.source_type IS
    '정답 PDF 출처. ''book''=시중교재(교재/ 폴더), ''custom''=자체제작(학생들에게 나간숙제 자료/ 폴더), ''manual''=PDF 없이 정답만 입력. NULL=레거시(애플리케이션에서 book 으로 해석).';

-- ── 2. CHECK 제약(값이 있을 때만 화이트리스트) ─────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'answer_keys_source_type_check'
  ) THEN
    ALTER TABLE public.answer_keys
      ADD CONSTRAINT answer_keys_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('book', 'custom', 'manual'));
  END IF;
END $$;

-- ── 3. 자체제작 숙제 PDF: 마감일·표시명·업로더 메타(선택) ───────────
-- drive_file_id / drive_folder_id 는 기존 컬럼 재사용. 추가 메타만 보강.
ALTER TABLE public.answer_keys
    ADD COLUMN IF NOT EXISTS custom_material_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.answer_keys.custom_material_uploaded_at IS
    'source_type=''custom'' 일 때 PDF 업로드 시각. 폴더 경로 빌딩에 사용된 기준일(년/월/일).';

-- ── 4. 부분 인덱스(필요 시 빠른 필터링) ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_answer_keys_source_type
  ON public.answer_keys (source_type)
  WHERE source_type IS NOT NULL;

-- ── 5. 검증 ────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='answer_keys'
  AND column_name IN ('source_type', 'custom_material_uploaded_at')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'answer_keys_source_type_check';

NOTIFY pgrst, 'reload schema';

COMMIT;
