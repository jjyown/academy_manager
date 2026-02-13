# 수파베이스 테이블 추가 SQL

아래 SQL을 수파베이스 SQL Editor에서 실행하세요.

## 1. schedules 테이블 (일정 데이터)

```sql
-- schedules 테이블 생성
CREATE TABLE IF NOT EXISTS public.schedules (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    student_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    schedule_date DATE NOT NULL,
    start_time TIME NOT NULL,
    duration INTEGER NOT NULL, -- 분 단위
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_user_id, teacher_id, student_id, schedule_date, start_time)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_schedules_owner ON public.schedules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON public.schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedules_student ON public.schedules(student_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON public.schedules(schedule_date);

-- RLS 활성화
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- RLS 정책
CREATE POLICY "사용자는 자신의 일정만 조회 가능" ON public.schedules
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 일정만 추가 가능" ON public.schedules
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 일정만 수정 가능" ON public.schedules
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 일정만 삭제 가능" ON public.schedules
    FOR DELETE USING (auth.uid() = owner_user_id);

-- 업데이트 트리거
CREATE OR REPLACE FUNCTION update_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_schedules_updated_at
    BEFORE UPDATE ON public.schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_schedules_updated_at();
```

## 2. payments 테이블 (결제 데이터)

```sql
-- payments 테이블 생성
CREATE TABLE IF NOT EXISTS public.payments (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    student_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    payment_month TEXT NOT NULL, -- YYYY-MM 형식
    amount INTEGER NOT NULL, -- 금액
    paid_amount INTEGER DEFAULT 0, -- 실제 납부 금액
    payment_status TEXT DEFAULT 'unpaid', -- unpaid, partial, paid
    payment_date DATE, -- 납부 날짜
    memo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, payment_month)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_payments_owner ON public.payments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_payments_teacher ON public.payments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON public.payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_month ON public.payments(payment_month);

-- RLS 활성화
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- RLS 정책
CREATE POLICY "사용자는 자신의 결제정보만 조회 가능" ON public.payments
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 결제정보만 추가 가능" ON public.payments
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 결제정보만 수정 가능" ON public.payments
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 결제정보만 삭제 가능" ON public.payments
    FOR DELETE USING (auth.uid() = owner_user_id);

-- 업데이트 트리거
CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_payments_updated_at();
```

## 3. holidays 테이블 (커스텀 휴일 데이터)

```sql
-- holidays 테이블 생성
CREATE TABLE IF NOT EXISTS public.holidays (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    holiday_date DATE NOT NULL,
    holiday_name TEXT NOT NULL,
    color TEXT DEFAULT '#ef4444',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_user_id, teacher_id, holiday_date)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_holidays_owner ON public.holidays(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_holidays_teacher ON public.holidays(teacher_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(holiday_date);

-- RLS 활성화
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- RLS 정책
CREATE POLICY "사용자는 자신의 휴일정보만 조회 가능" ON public.holidays
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 휴일정보만 추가 가능" ON public.holidays
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 휴일정보만 수정 가능" ON public.holidays
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 휴일정보만 삭제 가능" ON public.holidays
    FOR DELETE USING (auth.uid() = owner_user_id);

-- 업데이트 트리거
CREATE OR REPLACE FUNCTION update_holidays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_holidays_updated_at
    BEFORE UPDATE ON public.holidays
    FOR EACH ROW
    EXECUTE FUNCTION update_holidays_updated_at();
```

## 4. student_evaluations 테이블 (학생 평가 데이터)

```sql
-- student_evaluations 테이블 생성
CREATE TABLE IF NOT EXISTS public.student_evaluations (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL UNIQUE REFERENCES public.students(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    teacher_id TEXT,
    comment TEXT, -- 최대 500자
    rating INTEGER CHECK (rating >= 1 AND rating <= 5), -- 1~5점 평가 (선택사항)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_student_evaluations_student ON public.student_evaluations(student_id);
CREATE INDEX IF NOT EXISTS idx_student_evaluations_owner ON public.student_evaluations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_student_evaluations_teacher ON public.student_evaluations(teacher_id);

-- RLS 활성화
ALTER TABLE public.student_evaluations ENABLE ROW LEVEL SECURITY;

-- RLS 정책
CREATE POLICY "사용자는 자신의 평가정보만 조회 가능" ON public.student_evaluations
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 평가정보만 추가 가능" ON public.student_evaluations
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 평가정보만 수정 가능" ON public.student_evaluations
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 평가정보만 삭제 가능" ON public.student_evaluations
    FOR DELETE USING (auth.uid() = owner_user_id);

-- 업데이트 트리거
CREATE OR REPLACE FUNCTION update_student_evaluations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_student_evaluations_updated_at
    BEFORE UPDATE ON public.student_evaluations
    FOR EACH ROW
    EXECUTE FUNCTION update_student_evaluations_updated_at();
```

## 실행 순서

1. 수파베이스 대시보드 접속
2. SQL Editor 메뉴 선택
3. 위의 SQL을 순서대로 복사하여 실행
4. 각 테이블이 정상적으로 생성되었는지 Table Editor에서 확인

## 확인 사항

- [x] schedules 테이블 생성 완료
- [x] payments 테이블 생성 완료
- [x] holidays 테이블 생성 완료
- [x] student_evaluations 테이블 생성 완료 ✨ NEW
- [x] 각 테이블의 RLS 정책 활성화 완료
- [x] 인덱스 생성 완료

## 참고 사항

### attendance_records 테이블
- `ATTENDANCE_SETUP.md` 파일에서 SQL 실행
- 학생의 출석/지각/결석 기록 저장
- QR 코드 스캔 시 자동 저장

### student_evaluations 테이블
- 학생별 평가 코멘트 저장
- 최대 500자 제한
- 선택사항으로 1~5점 평가 기능

## DB 최적화 (OPTIMIZE_DB.sql)

테이블 생성 후 `OPTIMIZE_DB.sql`을 실행하면 다음이 적용됩니다:

### 1. attendance_records UNIQUE 제약 수정
- 기존: `UNIQUE(student_id, attendance_date)` → 같은 날 1건만 가능
- 변경: `UNIQUE(student_id, attendance_date, teacher_id, scheduled_time)` → 같은 날 다른 수업 출석 가능

### 2. 복합 인덱스 추가 (성능 개선)
- `schedules`: owner+teacher+date, owner+student+date
- `attendance_records`: owner+teacher+date, owner+student+date, student+date
- `payments`: owner+teacher+month, owner+student+month
- `holidays`: owner+teacher+date
- `teachers`: owner_user_id
- `students`: owner_user_id

### 3. 트리거 함수 보안
- 모든 `updated_at` 트리거 함수에 `SET search_path = public` 적용
