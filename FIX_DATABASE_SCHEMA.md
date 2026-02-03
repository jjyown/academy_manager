# 데이터베이스 스키마 수정 가이드

## ⚠️ 문제 요약
- 기존 테이블(teachers, students, attendance_records)의 `owner_user_id`가 **TEXT** 타입
- 새로 만든 schedules 테이블의 `owner_user_id`는 **UUID** 타입
- 타입 불일치로 인해 사용자 삭제 시 CASCADE가 작동하지 않음
- RLS 정책이 `owner_user_id`를 사용하고 있어 바로 타입 변경 불가능

## ✅ 해결 방법
아래 SQL을 **순서대로** 수파베이스 SQL Editor에서 실행하세요.

---

## 1단계: 모든 RLS 정책 삭제

```sql
-- attendance_records 테이블 정책 삭제
DROP POLICY IF EXISTS "Users can view own attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Users can insert own attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Users can update own attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Users can delete own attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Users can manage their own attendance records" ON public.attendance_records;

-- teachers 테이블 정책 삭제
DROP POLICY IF EXISTS "Users can view own teachers" ON public.teachers;
DROP POLICY IF EXISTS "Users can insert own teachers" ON public.teachers;
DROP POLICY IF EXISTS "Users can update own teachers" ON public.teachers;
DROP POLICY IF EXISTS "Users can delete own teachers" ON public.teachers;
DROP POLICY IF EXISTS "사용자는 자신의 선생님 정보만 조회 가능" ON public.teachers;
DROP POLICY IF EXISTS "사용자는 자신의 선생님 정보만 추가 가능" ON public.teachers;
DROP POLICY IF EXISTS "사용자는 자신의 선생님 정보만 수정 가능" ON public.teachers;
DROP POLICY IF EXISTS "사용자는 자신의 선생님 정보만 삭제 가능" ON public.teachers;

-- students 테이블 정책 삭제
DROP POLICY IF EXISTS "Users can view own students" ON public.students;
DROP POLICY IF EXISTS "Users can insert own students" ON public.students;
DROP POLICY IF EXISTS "Users can update own students" ON public.students;
DROP POLICY IF EXISTS "Users can delete own students" ON public.students;
DROP POLICY IF EXISTS "사용자는 자신의 학생 정보만 조회 가능" ON public.students;
DROP POLICY IF EXISTS "사용자는 자신의 학생 정보만 추가 가능" ON public.students;
DROP POLICY IF EXISTS "사용자는 자신의 학생 정보만 수정 가능" ON public.students;
DROP POLICY IF EXISTS "사용자는 자신의 학생 정보만 삭제 가능" ON public.students;
```

**실행 후 "Success. No rows returned" 메시지 확인**

---

## 2단계: owner_user_id 컬럼 타입을 TEXT → UUID로 변경

```sql
-- attendance_records 테이블
ALTER TABLE public.attendance_records 
ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::UUID;

-- teachers 테이블
ALTER TABLE public.teachers 
ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::UUID;

-- students 테이블
ALTER TABLE public.students 
ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::UUID;
```

**실행 후 "Success. No rows returned" 메시지 확인**

---

## 3단계: 외래키 제약조건 추가 (CASCADE 삭제 설정)

```sql
-- attendance_records 외래키 추가
ALTER TABLE public.attendance_records 
ADD CONSTRAINT fk_attendance_owner 
FOREIGN KEY (owner_user_id) 
REFERENCES auth.users(id) 
ON DELETE CASCADE;

-- teachers 외래키 추가
ALTER TABLE public.teachers 
ADD CONSTRAINT fk_teachers_owner 
FOREIGN KEY (owner_user_id) 
REFERENCES auth.users(id) 
ON DELETE CASCADE;

-- students 외래키 추가
ALTER TABLE public.students 
ADD CONSTRAINT fk_students_owner 
FOREIGN KEY (owner_user_id) 
REFERENCES auth.users(id) 
ON DELETE CASCADE;
```

**실행 후 "Success. No rows returned" 메시지 확인**

---

## 4단계: RLS 정책 재생성

```sql
-- attendance_records 정책
CREATE POLICY "사용자는 자신의 출석기록만 조회 가능" ON public.attendance_records
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 출석기록만 추가 가능" ON public.attendance_records
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 출석기록만 수정 가능" ON public.attendance_records
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 출석기록만 삭제 가능" ON public.attendance_records
    FOR DELETE USING (auth.uid() = owner_user_id);

-- teachers 정책
CREATE POLICY "사용자는 자신의 선생님 정보만 조회 가능" ON public.teachers
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 선생님 정보만 추가 가능" ON public.teachers
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 선생님 정보만 수정 가능" ON public.teachers
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 선생님 정보만 삭제 가능" ON public.teachers
    FOR DELETE USING (auth.uid() = owner_user_id);

-- students 정책
CREATE POLICY "사용자는 자신의 학생 정보만 조회 가능" ON public.students
    FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 학생 정보만 추가 가능" ON public.students
    FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 학생 정보만 수정 가능" ON public.students
    FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "사용자는 자신의 학생 정보만 삭제 가능" ON public.students
    FOR DELETE USING (auth.uid() = owner_user_id);
```

**실행 후 "Success. No rows returned" 메시지 확인**

---

## 5단계: 확인

```sql
-- 테이블 구조 확인
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('attendance_records', 'teachers', 'students', 'schedules')
AND column_name = 'owner_user_id';

-- 외래키 확인
SELECT
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name IN ('attendance_records', 'teachers', 'students', 'schedules');
```

**예상 결과:**
- 모든 `owner_user_id` 컬럼이 **uuid** 타입으로 표시됨
- 외래키의 `delete_rule`이 **CASCADE**로 표시됨

---

## ✅ 완료 후 테스트

1. **Authentication** 메뉴에서 테스트 이메일 삭제 시도
2. "User has been deleted" 메시지 확인
3. **Table Editor**에서 해당 사용자의 모든 데이터가 자동 삭제되었는지 확인

---

## 📝 다음 단계

스키마 수정 완료 후:
1. [SUPABASE_TABLES_SQL.md](SUPABASE_TABLES_SQL.md)의 **payments 테이블 SQL** 실행
2. [SUPABASE_TABLES_SQL.md](SUPABASE_TABLES_SQL.md)의 **holidays 테이블 SQL** 실행
3. 로컬에서 일정 등록 후 수파베이스 Table Editor에서 데이터 확인
4. 깃허브 푸시 + 버셀 배포
5. 배포된 사이트에서 데이터 동기화 확인
