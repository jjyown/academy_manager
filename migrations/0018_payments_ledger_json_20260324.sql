-- ============================================================
-- payments: 원장 JSON + 수납 모달 필드 정규화 컬럼
-- 실행: Supabase SQL Editor
-- 날짜: 2026-03-24
-- ============================================================
-- ledger_json: 앱 원장 전체 스냅샷(JSONB)
-- 아래 컬럼: Table Editor·SQL 조회용(모달 입력과 1:1 매핑)

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS ledger_json JSONB DEFAULT NULL;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS supply_amount INTEGER DEFAULT 0;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS vat_amount INTEGER DEFAULT 0;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS refund_amount INTEGER DEFAULT 0;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS refund_reason TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS channel TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS method TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS reference_id TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS evidence_type TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS evidence_number TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS evidence_name TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS unmatched_deposit BOOLEAN DEFAULT FALSE;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS paid_at_text TEXT;

COMMENT ON COLUMN public.payments.ledger_json IS '수납관리 원장 스냅샷(앱 구조, updatedAt 포함)';
COMMENT ON COLUMN public.payments.supply_amount IS '공급가액(원)';
COMMENT ON COLUMN public.payments.vat_amount IS '부가세(원)';
COMMENT ON COLUMN public.payments.refund_amount IS '환불금액(원)';
COMMENT ON COLUMN public.payments.paid_at_text IS '수납일시 원문(날짜·시간)';
