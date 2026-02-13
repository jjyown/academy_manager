# Supabase 데이터베이스 구조 및 설정

## 📊 데이터베이스 테이블 구조

### 1. `users` 테이블 (관리자 계정)
Supabase Auth에서 자동 생성되는 테이블입니다.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);
```

**컬럼 설명:**
- `id`: 관리자 고유 ID (Supabase Auth와 연동)
- `email`: 관리자 이메일 (로그인 ID)
- `name`: 관리자 이름
- `created_at`: 계정 생성일

---

### 2. `teachers` 테이블 (선생님 정보)
각 관리자가 등록한 선생님들의 정보를 저장합니다.

```sql
CREATE TABLE teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  pin_hash text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- 인덱스 생성
CREATE INDEX idx_teachers_owner ON teachers(owner_user_id);
```

**컬럼 설명:**
- `id`: 선생님 고유 ID
- `owner_user_id`: 이 선생님을 등록한 관리자의 ID
- `name`: 선생님 이름
- `phone`: 연락처 (선택)
- `pin_hash`: PIN 해시 (현재 미사용, 향후 확장용)
- `created_at`: 등록일

**중요:** `ON DELETE CASCADE`가 설정되어 있어 관리자가 삭제되면 해당 선생님도 자동 삭제됩니다.

---

### 3. `students` 테이블 (학생 정보)
각 선생님이 등록한 학생들의 정보를 저장합니다.

```sql
CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade text,
  phone text,
  parent_phone text,
  default_fee integer DEFAULT 0,
  special_lecture_fee integer DEFAULT 0,
  default_textbook_fee integer DEFAULT 0,
  memo text,
  register_date date,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- 인덱스 생성
CREATE INDEX idx_students_teacher ON students(teacher_id);
```

**컬럼 설명:**
- `id`: 학생 고유 ID
- `teacher_id`: 이 학생을 등록한 선생님의 ID
- `name`: 학생 이름
- `grade`: 학년
- `phone`: 학생 연락처
- `parent_phone`: 학부모 연락처
- `default_fee`: 기본 수업료 (정수, 원 단위)
- `special_lecture_fee`: 특강 수업료 (정수, 원 단위)
- `default_textbook_fee`: 교재비 (정수, 원 단위)
- `memo`: 메모
- `register_date`: 학생 등록일
- `status`: 상태 ('active', 'archived', 'paused' 등)
- `created_at`: 레코드 생성일

---

### 4. `schedules` 테이블 (일정 정보)
각 선생님의 수업 일정을 저장합니다.

```sql
CREATE TABLE IF NOT EXISTS public.schedules (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL,
  student_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_user_id, teacher_id, student_id, schedule_date, start_time)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_schedules_owner ON public.schedules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON public.schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedules_student ON public.schedules(student_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON public.schedules(schedule_date);
```

**컬럼 설명:**
- `id`: 일정 고유 ID
- `owner_user_id`: 관리자(소유자) ID
- `teacher_id`: 담당 선생님 ID
- `student_id`: 학생 ID
- `schedule_date`: 수업 날짜
- `start_time`: 시작 시간
- `duration`: 수업 시간(분)
- `created_at`: 일정 생성일
- `updated_at`: 일정 수정일

---

### 5. `holidays` 테이블 (휴일 정보)
휴일 정보를 저장합니다.

```sql
CREATE TABLE holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  name text NOT NULL
);

-- 인덱스 생성
CREATE INDEX idx_holidays_date ON holidays(date);
```

**컬럼 설명:**
- `id`: 휴일 고유 ID
- `date`: 휴일 날짜 (중복 불가)
- `name`: 휴일 이름 (예: "설날", "추석" 등)

---

## 🔐 Row Level Security (RLS) 정책

### Teachers 테이블 RLS 정책

```sql
-- RLS 활성화
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- SELECT: 자신이 등록한 선생님만 조회
CREATE POLICY "Users can view their own teachers"
ON teachers FOR SELECT
USING (auth.uid() = owner_user_id);

-- INSERT: 자신의 선생님만 등록
CREATE POLICY "Users can insert their own teachers"
ON teachers FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

-- UPDATE: 자신의 선생님만 수정
CREATE POLICY "Users can update their own teachers"
ON teachers FOR UPDATE
USING (auth.uid() = owner_user_id);

-- DELETE: 자신의 선생님만 삭제
CREATE POLICY "Users can delete their own teachers"
ON teachers FOR DELETE
USING (auth.uid() = owner_user_id);
```

### Students 테이블 RLS 정책

```sql
-- RLS 활성화
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- SELECT: 자신이 소유한 선생님의 학생만 조회
CREATE POLICY "Users can view students of their teachers"
ON students FOR SELECT
USING (
  teacher_id IN (
    SELECT id FROM teachers WHERE owner_user_id = auth.uid()
  )
);

-- INSERT, UPDATE, DELETE도 동일한 패턴으로 설정
```

---

## 🚀 초기 설정 가이드

### 1. Supabase 프로젝트 생성
1. [Supabase](https://supabase.com/)에 접속하여 프로젝트 생성
2. Project Settings → API에서 URL과 anon key 복사
3. `supabase-config.js`에 입력

### 2. 테이블 생성
SQL Editor에서 위의 CREATE TABLE 문을 순서대로 실행:
1. users 테이블
2. teachers 테이블
3. students 테이블
4. schedules 테이블
5. holidays 테이블

### 3. RLS 정책 설정
각 테이블에 대한 RLS 정책을 SQL Editor에서 실행

### 4. Authentication 설정
1. Authentication → Settings
2. Email Auth 활성화
3. Confirm Email 비활성화 (개발 단계에서)

---

## 📝 현재 애플리케이션의 데이터 저장 방식

### LocalStorage 사용 항목
- `current_owner_id`: 현재 로그인한 관리자 ID
- `remember_login`: 로그인 유지 여부
- `academy_students__[ownerUserId]`: 학생 목록 (캐시)
- `teacher_schedule_data__[teacherId]`: 선생님별 일정 데이터
- `teacher_students_mapping__[teacherId]`: 선생님-학생 매핑
- `academy_holidays__[teacherId]`: 휴일 정보

### 데이터 흐름
1. **로그인**: Supabase Auth → localStorage에 `current_owner_id` 저장
2. **선생님 선택**: teachers 테이블 조회 → 선택
3. **학생 관리**: localStorage와 Supabase 동기화
4. **일정 관리**: localStorage에 저장 (향후 Supabase 동기화 가능)

---

## 🔧 문제 해결

### Q: 로그아웃 후에도 선생님 선택 페이지가 나타남
**원인**: `onAuthStateChange` 이벤트가 페이지를 새로고침하면서 localStorage가 정리되기 전에 세션을 다시 체크

**해결**: 
1. `onAuthStateChange` 이벤트 리스너 제거
2. `signOut` 함수에서 localStorage를 먼저 정리한 후 UI 업데이트
3. DOMContentLoaded에서 선생님 선택 페이지를 명시적으로 숨김

### Q: 선생님 등록 시 "로그인 세션이 만료되었습니다" 오류
**원인**: `current_owner_id`가 localStorage에 제대로 저장되지 않음

**해결**:
1. `setCurrentTeacher`에서 불필요한 Supabase 세션 체크 제거
2. localStorage 기반 인증으로 통일

---

## 📌 주의사항

1. **Cascade 삭제 설정 확인**
   - 관리자 삭제 시 선생님, 학생, 일정이 모두 삭제됨
   - 데이터 백업 중요

2. **RLS 정책 필수**
   - 다른 관리자의 데이터 접근 방지
   - 모든 테이블에 RLS 설정 필요

3. **인덱스 최적화**
   - 자주 조회되는 컬럼에 인덱스 생성
   - 성능 향상

4. **LocalStorage 한계**
   - 브라우저당 최대 5-10MB
   - 중요 데이터는 Supabase에 저장
