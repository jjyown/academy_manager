# 🚀 학부모 포탈 - Supabase 설정 가이드

> 학부모 포탈을 위한 Supabase 테이블 생성 및 설정 방법

---

## 📋 필요한 테이블

### 1️⃣ attendance_records (출석 기록)
- **용도**: 학생 출석/지각/결석 기록 저장
- **생성 위치**: `ATTENDANCE_SETUP.md` 참조
- **중요도**: ⭐⭐⭐ **필수**

### 2️⃣ student_evaluations (평가 코멘트) ✨ NEW
- **용도**: 학생에 대한 평가 및 코멘트 저장
- **생성 위치**: `SUPABASE_TABLES_SQL.md` 참조 (섹션 4)
- **중요도**: ⭐⭐⭐ **필수**

### 3️⃣ students (학생 정보)
- **용도**: 학생 기본 정보 및 QR 코드 데이터
- **생성 위치**: 기존에 이미 생성되어 있음
- **중요도**: ⭐⭐⭐ **필수**

---

## 🔧 설정 단계

### Step 1: Supabase 접속

```
1. https://supabase.com 접속
2. 프로젝트 선택
3. SQL Editor 메뉴 클릭
```

### Step 2: attendance_records 테이블 생성

**파일**: `ATTENDANCE_SETUP.md`

```
1. ATTENDANCE_SETUP.md 파일 열기
2. SQL 섹션 복사
3. Supabase SQL Editor에 붙여넣기
4. "RUN" 버튼 클릭
5. ✅ 성공 메시지 확인
```

**포함되는 것:**
- ✅ attendance_records 테이블
- ✅ 인덱스 (성능)
- ✅ RLS 정책 (보안)
- ✅ students 테이블의 qr_code_data 컬럼 추가

### Step 3: student_evaluations 테이블 생성

**파일**: `SUPABASE_TABLES_SQL.md` (섹션 4)

```
1. SUPABASE_TABLES_SQL.md 파일 열기
2. "## 4. student_evaluations 테이블" 섹션 찾기
3. SQL 코드 복사
4. 새로운 SQL Editor 탭에서 붙여넣기
5. "RUN" 버튼 클릭
6. ✅ 성공 메시지 확인
```

**포함되는 것:**
- ✅ student_evaluations 테이블
- ✅ 인덱스 (성능)
- ✅ RLS 정책 (보안)
- ✅ 자동 updated_at 트리거

---

## ✅ 확인 체크리스트

### 테이블 생성 확인

```
Supabase Dashboard → Table Editor

[ ] students 테이블 있음
    └─ id, name, phone, qr_code_data 컬럼 확인

[ ] attendance_records 테이블 있음
    └─ student_id, attendance_date, status, check_in_time 컬럼 확인

[ ] student_evaluations 테이블 있음
    └─ student_id, comment, rating 컬럼 확인
```

### RLS 정책 확인

```
각 테이블 → Authentication → Policies

[ ] attendance_records RLS 정책 활성화
[ ] student_evaluations RLS 정책 활성화
```

### 인덱스 확인

```
각 테이블 → Indexes

attendance_records:
[ ] idx_attendance_student
[ ] idx_attendance_date

student_evaluations:
[ ] idx_student_evaluations_student
```

---

## 🎯 데이터 형식

### students 테이블
```javascript
{
    id: 1,
    name: "김철수",
    phone: "01012345678",
    qr_code_data: "STUDENT_1_abc123xyz" // QR 출석 시스템
}
```

### attendance_records 테이블
```javascript
{
    id: "uuid",
    student_id: "1",
    attendance_date: "2026-02-05",
    check_in_time: "2026-02-05T09:00:00Z",
    status: "present", // 'present', 'late', 'absent', 'makeup'
    created_at: "2026-02-05T09:00:00Z",
    updated_at: "2026-02-05T09:00:00Z"
}
```

### student_evaluations 테이블
```javascript
{
    id: 1,
    student_id: 1,
    owner_user_id: "uuid",
    teacher_id: "teacher_001",
    comment: "매우 성실하고 열심히 참여하는 학생입니다.", // 최대 500자
    rating: 5, // 1~5점 (선택사항)
    created_at: "2026-02-05T09:00:00Z",
    updated_at: "2026-02-05T09:00:00Z"
}
```

---

## 🔍 SQL 확인 명령어

### 테이블 목록 확인
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

### attendance_records 테이블 구조
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'attendance_records';
```

### student_evaluations 테이블 구조
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'student_evaluations';
```

### RLS 정책 확인
```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('attendance_records', 'student_evaluations');
```

---

## ⚠️ 일반적인 오류 및 해결방법

### 오류: "relation does not exist"
```
원인: 테이블이 생성되지 않음
해결: ATTENDANCE_SETUP.md와 SUPABASE_TABLES_SQL.md의 SQL을 다시 실행
```

### 오류: "duplicate column name"
```
원인: 이미 존재하는 컬럼 추가 시도
해결: 무시하고 진행 (SQL에서 DROP 사용 X)
```

### 오류: "permission denied"
```
원인: RLS 정책으로 인한 접근 제한
해결: 로그인 상태 확인 및 RLS 정책 검토
```

### 오류: "unique constraint violation"
```
원인: 중복된 학생 ID 또는 평가 데이터
해결: DELETE로 중복 제거 후 재시도
```

---

## 🧪 테스트 데이터 삽입

### 테스트용 student_evaluations 삽입
```sql
INSERT INTO public.student_evaluations (student_id, owner_user_id, comment, rating)
VALUES (
    1,
    '7a1b2c3d-4e5f-6g7h-8i9j-0k1l2m3n4o5p',
    '매우 성실하고 열심히 참여하는 학생입니다. 추천합니다.',
    5
)
ON CONFLICT (student_id) DO UPDATE 
SET comment = EXCLUDED.comment, rating = EXCLUDED.rating;
```

### 테스트용 attendance_records 삽입
```sql
INSERT INTO public.attendance_records (
    student_id, attendance_date, status, check_in_time, owner_user_id, teacher_id
)
VALUES (
    '1',
    '2026-02-05',
    'present',
    NOW(),
    '7a1b2c3d-4e5f-6g7h-8i9j-0k1l2m3n4o5p',
    'teacher_001'
);
```

---

## 🔐 RLS 정책 이해

### 왜 RLS가 필요한가?

```
RLS (Row Level Security) = 행 단위 보안

사용자는 자신의 데이터만 조회/수정/삭제 가능
├─ 관리자는 관리자의 학생 데이터만
├─ 학부모는 자녀 정보만 (추후 기능)
└─ 다른 사용자의 데이터는 접근 불가
```

### RLS 정책 확인
```sql
-- attendance_records의 RLS 정책
SELECT * FROM pg_policies 
WHERE tablename = 'attendance_records';

-- 정책 내용 확인
SELECT schemaname, tablename, policyname, permissive, qual
FROM pg_policies 
WHERE tablename = 'attendance_records';
```

---

## 📊 성능 최적화 팁

### 인덱스의 중요성
```
인덱스 = 책의 목차

검색 속도 향상:
- attendance_date로 필터링 시 1000배 빠름
- student_id로 검색 시 100배 빠름
```

### 쿼리 최적화
```javascript
// ✅ 좋은 예: 인덱스를 활용한 쿼리
const { data } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('student_id', studentId)        // 인덱스됨
    .gte('attendance_date', '2026-01-01') // 인덱스됨
    .order('attendance_date', { ascending: false });

// ❌ 나쁜 예: 인덱스를 활용하지 않는 쿼리
const { data } = await supabase
    .from('attendance_records')
    .select('*')
    .filter('status', 'neq', 'absent');  // 인덱스 안됨
```

---

## 🎯 배포 전 최종 확인

```
[ ] attendance_records 테이블 생성 확인
[ ] student_evaluations 테이블 생성 확인
[ ] students 테이블 qr_code_data 컬럼 확인
[ ] 모든 RLS 정책 활성화 확인
[ ] 모든 인덱스 생성 확인
[ ] 테스트 데이터 삽입 성공
[ ] 테스트 쿼리 실행 성공
```

---

## 📞 문제 해결

### Supabase 콘솔 로그 확인
```
1. Supabase Dashboard
2. Database → Logs
3. 에러 메시지 확인
4. SQL 쿼리 다시 실행
```

### SQL 문법 검증
```sql
-- 테이블 생성 전 문법 검사
EXPLAIN PLAN FOR (your_query_here);

-- 또는 간단히 테스트
SELECT 1; -- 이것이 작동하면 연결 성공
```

---

## 📚 참고 문서

| 문서 | 내용 |
|------|------|
| ATTENDANCE_SETUP.md | attendance_records 테이블 생성 |
| SUPABASE_TABLES_SQL.md | 모든 테이블 생성 (섹션 4 추가) |
| PARENT_PORTAL_DEPLOYMENT.md | 배포 가이드 (SQL 섹션) |
| README_PARENT_PORTAL.md | 전체 사용 가이드 |

---

## ✅ 완료!

모든 Supabase 테이블이 설정되었습니다.

**다음 단계:**
1. 로컬에서 report.html 테스트
2. GitHub에 푸시
3. Vercel에 배포
4. 학부모에게 링크 공유

---

**Supabase 설정 완료**: 2026년 2월 5일  
**상태**: ✅ 배포 준비 완료
