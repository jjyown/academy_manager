-- ============================================================
-- Supabase 보안 에러/경고 수정 SQL
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- ============================================================
-- [ERROR 1,2] student_evaluations 테이블 RLS 활성화
-- 정책은 이미 존재하지만 RLS가 꺼져 있어서 발생하는 에러
-- ============================================================
ALTER TABLE public.student_evaluations ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- [WARNING 1~4] Function Search Path Mutable 경고 해결
-- search_path를 명시적으로 설정하여 보안 강화
-- ============================================================

-- 1) update_attendance_updated_at
CREATE OR REPLACE FUNCTION public.update_attendance_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 2) update_schedules_updated_at
CREATE OR REPLACE FUNCTION public.update_schedules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 3) update_payments_updated_at
CREATE OR REPLACE FUNCTION public.update_payments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 4) update_holidays_updated_at
CREATE OR REPLACE FUNCTION public.update_holidays_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- ============================================================
-- [WARNING 5] Leaked Password Protection
-- 이것은 SQL로 해결할 수 없습니다.
-- Supabase Dashboard에서 수동으로 설정해야 합니다:
--   Authentication → Settings → Security → 
--   "Enable Leaked Password Protection" 토글 ON
-- ============================================================
