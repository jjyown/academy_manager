-- ============================================
-- Expense Ledger (수납/비용 관리 - 비용 원장) 설정
-- ============================================
-- 실행 위치: Supabase SQL Editor
-- 목적:
-- 1) expense_ledgers 테이블 생성
-- 2) owner_user_id 기반 RLS 정책 적용
-- 3) PostgREST 스키마 캐시 갱신

create table if not exists public.expense_ledgers (
    id text primary key,
    owner_user_id uuid not null references public.users(id) on delete cascade,
    month_key text not null,
    expense_date date not null,
    category text not null,
    amount integer not null default 0,
    method text,
    vendor text,
    vat_type text,
    supply_amount integer not null default 0,
    vat_amount integer not null default 0,
    evidence_type text,
    evidence_number text,
    note text,
    created_at timestamptz not null default now()
);

alter table public.expense_ledgers
    add column if not exists supply_amount integer not null default 0,
    add column if not exists vat_amount integer not null default 0,
    add column if not exists evidence_type text,
    add column if not exists evidence_number text;

create index if not exists idx_expense_ledgers_owner_month
    on public.expense_ledgers(owner_user_id, month_key);

create index if not exists idx_expense_ledgers_owner_date
    on public.expense_ledgers(owner_user_id, expense_date desc);

alter table public.expense_ledgers enable row level security;

do $$
begin
    if exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'expense_ledgers'
          and policyname = 'expense_ledgers_owner_all'
    ) then
        execute 'drop policy expense_ledgers_owner_all on public.expense_ledgers';
    end if;
end $$;

create policy expense_ledgers_owner_all
    on public.expense_ledgers
    for all
    using (owner_user_id = auth.uid())
    with check (owner_user_id = auth.uid());

notify pgrst, 'reload schema';
