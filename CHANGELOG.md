# 출석관리 앱 - 변경 사항 및 수정 기록

## 🔧 주요 수정 사항 (2026-01-24)

### 1. **선생님 등록 기능 수정**
**문제**: 선생님 등록 시 Supabase 에러가 발생하고 실패함
**원인**: 에러 처리 및 로그 부재로 디버깅 불가

**해결책**:
- `registerTeacher()` 함수에 상세 콘솔 로그 추가
- 각 단계별 에러 정보 출력 (`error.message`, `error.code`, `error.details`)
- 성공/실패 메시지 명확화
- 페이지 네비게이션 간소화

**코드 변경**:
```javascript
// 변경 전: 단순 에러 메시지만 출력
if (error) { 
    console.error('Supabase 에러:', error);
    return alert('선생님 등록 실패: ' + error.message); 
}

// 변경 후: 상세 에러 로깅
if (error) {
    console.error('[registerTeacher] Supabase 에러:', error);
    console.error('[registerTeacher] 에러 상세:', error.message, error.code, error.details);
    return alert('선생님 등록 실패:\n' + error.message); 
}
```

---

### 2. **페이지 상태 관리 시스템 도입** ⭐
**문제**: 새로고침 시 로그인 페이지로 돌아감 (페이지 상태 미보존)

**해결책**: 전역 페이지 상태 관리 함수 추가
```javascript
// 페이지 상수 정의
const pageStates = {
    AUTH: 'auth-page',
    TEACHER_SELECT: 'teacher-select-page',
    MAIN_APP: 'main-app'
};

// 현재 활성 페이지 저장
setActivePage(pageKey) → localStorage에 저장

// 현재 활성 페이지 조회
getActivePage() → localStorage에서 읽기

// 페이지 이동 (상태 저장 + UI 업데이트)
navigateToPage(pageKey) → 모든 페이지 숨김 + 대상 페이지만 표시 + 상태 저장
```

**적용 지점**:
- 로그인 성공 → `setActivePage('TEACHER_SELECT')`
- 선생님 선택 → `navigateToPage('MAIN_APP')`
- 로그아웃 → `navigateToPage('AUTH')` + localStorage.removeItem('active_page')
- 선생님 변경 → `navigateToPage('TEACHER_SELECT')`

---

### 3. **초기화 로직 개선**

#### `initializeAuth()` 개선
```javascript
// 변경 전
if (session) {
    localStorage.setItem('current_owner_id', session.user.id);
    showMainApp();  // 선생님 선택 페이지로 이동
    return;
}

// 변경 후
if (session) {
    localStorage.setItem('current_owner_id', session.user.id);
    const lastTeacherId = localStorage.getItem('current_teacher_id');
    if (lastTeacherId) {
        // 이전 선생님이 있으면 자동으로 선택 → 메인 앱 진입
        await showMainApp();
    } else {
        // 처음이면 선생님 선택 페이지만 표시
        navigateToPage('TEACHER_SELECT');
    }
    return;
}
```

---

### 4. **페이지별 동작 흐름**

#### 이메일 로그인 페이지
```
페이지 로드 (새로고침)
    ↓
initializeAuth() 실행
    ↓
Supabase 세션 확인
    ├─ 세션 있음 → 선생님 선택 페이지로
    └─ 세션 없음 → 로그인 페이지 표시 (active_page = 'AUTH')

사용자 로그인 성공
    ↓
signIn() 실행
    ↓
localStorage에 current_owner_id 저장
    ↓
setActivePage('TEACHER_SELECT') → 상태 저장
    ↓
showMainApp() → 선생님 선택 페이지 표시
    ↓
새로고침하면 → initializeAuth() → 선생님 선택 페이지 복원 ✅
```

#### 선생님 선택 페이지
```
선생님 선택 페이지 진입
    ↓
loadTeachers() → 드롭다운 채우기
    ↓
이전 선생님 기록 있으면 → setCurrentTeacher() → 자동 선택 → 메인 앱 진입
    또는 사용자가 직접 선택

새로고침하면
    ↓
initializeAuth() → current_teacher_id 확인
    ↓
있으면 → showMainApp() → 자동 선택 → 메인 앱 진입 ✅
없으면 → 선생님 선택 페이지 유지
```

#### 일정관리 페이지 (메인 앱)
```
선생님 선택 완료
    ↓
setCurrentTeacher() 실행
    ↓
navigateToPage('MAIN_APP') → 상태 저장
    ↓
메인 앱 표시

새로고침하면
    ↓
initializeAuth() → current_owner_id 확인
    ↓
있으면 → showMainApp() → 이전 선생님 자동 선택 → 메인 앱 진입 ✅
```

---

### 5. **localStorage 상태 정보**

| 키 | 설명 | 예시 |
|---|---|---|
| `current_owner_id` | 로그인한 관리자 ID | `uuid...` |
| `current_teacher_id` | 선택한 선생님 ID | `uuid...` |
| `current_teacher_name` | 선택한 선생님 이름 | `김선생` |
| `active_page` | **[NEW]** 현재 활성 페이지 | `MAIN_APP` or `TEACHER_SELECT` |
| `remember_login` | 로그인 유지 여부 | `true` or 없음 |

---

## 🧪 테스트 시나리오

### 시나리오 1: 로그인 페이지 → 새로고침
```
1. 로그인 페이지에서 이메일/비밀번호 입력
2. 로그인 버튼 클릭
3. 선생님 선택 페이지로 이동
4. F5 새로고침
✅ 결과: 선생님 선택 페이지 유지
```

### 시나리오 2: 선생님 선택 페이지 → 새로고침
```
1. 선생님 선택 페이지에서 선생님 선택 (아직 선택하지 않은 상태)
2. F5 새로고침
✅ 결과: 선생님 선택 페이지 유지
```

### 시나리오 3: 메인 앱 (일정관리) → 새로고침
```
1. 선생님을 선택하여 메인 앱 (일정관리 페이지) 진입
2. F5 새로고침
✅ 결과: 메인 앱 유지 + 이전 선생님 자동 선택
```

### 시나리오 4: 로그아웃
```
1. 메인 앱의 로그아웃 버튼 클릭
2. localStorage 초기화 확인
✅ 결과: 로그인 페이지로 이동, active_page 초기화
```

### 시나리오 5: 선생님 등록 테스트
```
1. 선생님 선택 페이지에서 "선생님 등록" 클릭
2. 선생님 이름 입력, "등록하기" 클릭
3. 브라우저 개발자 도구 (F12) → Console 탭에서 로그 확인
✅ 결과: 
   - [registerTeacher] 시작
   - [registerTeacher] 입력 값 - name: ...
   - [registerTeacher] Supabase insert 시작...
   - [registerTeacher] 등록 성공: {...}
   - 선생님 등록됨 메시지
   - 드롭다운에 새 선생님 추가
```

---

## 📊 Supabase 구조 (현재 상태 - 변경 없음)

### Teachers 테이블 (기존 구조 유지)
```sql
CREATE TABLE teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  pin_hash text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
```

**RLS 정책** (활성화됨):
- SELECT: 자신이 등록한 선생님만 조회
- INSERT: 자신의 선생님만 등록
- UPDATE: 자신의 선생님만 수정
- DELETE: 자신의 선생님만 삭제

---

## 🚀 배포 시 확인 사항

1. **콘솔 로그 활성화** (개발 모드)
   - `console.log()` 제거 필요 시 프로덕션 빌드 단계에서 처리

2. **localStorage 용량 확인**
   - 현재 사용량: ~200 bytes (safe)
   - localStorage 최대: ~5MB

3. **Supabase RLS 정책 확인**
   - 선생님 등록 시 RLS 정책이 작동하는지 확인
   - owner_user_id와 현재 사용자 ID 일치 여부

4. **크로스 브라우저 테스트**
   - Chrome, Firefox, Safari 모두 테스트

---

## 📝 향후 개선사항

1. **Supabase 구조 개선** (선택사항)
   - students, schedules 테이블도 현재 RLS 구조로 통일

2. **offline-first 지원** (선택사항)
   - IndexedDB 추가로 로컬 캐싱
   - 네트워크 오프라인 상태에서도 기본 기능 제공

3. **에러 복구 자동화** (선택사항)
   - 세션 만료 시 자동 로그인 재시도

---

## 📌 주의사항

**localStorage 핵심 정보**:
```javascript
// 이것들이 없으면 페이지 초기화됨
localStorage.getItem('current_owner_id')        // 필수
localStorage.getItem('current_teacher_id')      // 선택 (없으면 선생님 선택 페이지)
localStorage.getItem('active_page')             // 선택 (없으면 initializeAuth 로직으로 판단)
```

**주의**: 개발자 도구에서 localStorage를 수동 삭제하면 상태 초기화되므로, 테스트 시 주의!

---

**마지막 수정**: 2026년 1월 24일
**상태**: ✅ 완료 및 테스트 준비 완료
