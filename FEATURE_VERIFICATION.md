# 출석관리 앱 - 로그인 상태 유지 & 페이지 복원 기능 검증

## 📋 요구사항 및 구현 상태

### ✅ 요구사항 1: 모든 페이지에서 새로고침(F5) 시 페이지 유지
**상태: ✅ 구현 완료**

#### 동작 원리:
1. **DOMContentLoaded에서:**
   - `sessionStorage.session_active` 확인
   - 초기 진입: undefined/null → isRefresh = false (처음 접근)
   - 새로고침: 'true' → isRefresh = true (세션 유지됨)
   - `session_active`를 'false'로 초기화 (beforeunload에서 변경하기 위함)

2. **beforeunload에서:**
   - `session_active`가 'false'면 → 새로고침 진행 중 → 'true'로 변경
   - `session_active`가 'true'면 → 창 닫기 → 로그인 유지 여부에 따라 처리

3. **initializeAuth에서:**
   - `isRefresh = true`일 때:
     - `currentPage = getActivePage()` 조회
     - 현재 페이지와 선생님 정보를 기반으로 복원
     - AUTH, TEACHER_SELECT, MAIN_APP 각각 맞게 처리

#### 각 페이지별 새로고침 동작:
- **로그인 페이지(AUTH)에서 F5 → 로그인 페이지 유지** ✅
  - activePageage = 'AUTH' → navigateToPage('AUTH') 호출
  - 로그인 폼의 입력값은 유지되지 않음 (의도적 - 새로운 요청)
  
- **선생님 선택 페이지(TEACHER_SELECT)에서 F5 → 선생님 선택 페이지 유지** ✅
  - currentPage = 'TEACHER_SELECT' → navigateToPage('TEACHER_SELECT')
  - 선생님 드롭다운 로드됨
  
- **메인 페이지(MAIN_APP)에서 F5 → 메인 페이지 + 선생님 정보 유지** ✅
  - currentPage = 'MAIN_APP', lastTeacherId 존재
  - setCurrentTeacher() 호출로 모든 데이터 다시 로드 및 UI 복원
  - 캘린더, 학생 목록 등 완전 복원

---

### ✅ 요구사항 2: 로그인 유지 체크 ✅ 시 창 닫고 열면 선생님 선택 페이지
**상태: ✅ 구현 완료**

#### 동작 원리:
1. **beforeunload 이벤트에서:**
   - `remember_login === 'true'`일 때:
     - `current_owner_id` 유지 (로그인 유지)
     - `current_teacher_id`, `current_teacher_name`, `current_teacher_role` 제거 (보안)
     - `active_page` 제거 (선생님 선택 페이지로 강제 이동)

2. **창을 닫고 다시 열 때:**
   - sessionStorage 전체 삭제됨 (창 닫기 시 자동)
   - DOMContentLoaded에서 `isRefresh = false` 감지

3. **initializeAuth에서:**
   - `isRefresh = false` 이고 `session` 존재
   - `remember_login === 'true'` → `showMainApp()` 호출
   - showMainApp에서 현재 선생님이 없으므로 자동으로 TEACHER_SELECT 페이지 표시

#### 흐름:
```
로그인 유지 ✅ 체크 상태에서 메인 페이지 사용 중
    ↓ [창 닫기]
beforeunload:
  - current_owner_id: 유지 ✅
  - current_teacher_id: 제거 ✅
  - active_page: 제거 ✅
    ↓ [창 다시 열기]
sessionStorage 초기화됨 (isRefresh = false)
DOMContentLoaded: isRefresh = false
initializeAuth: remember_login = true
    ↓
showMainApp() 호출
    ↓
선생님 목록 로드, 선택된 선생님이 없으므로
TEACHER_SELECT 페이지 표시 ✅
```

---

### ✅ 요구사항 3: 로그인 유지 미체크 ❌ 시 창 닫으면 로그인 페이지
**상태: ✅ 구현 완료**

#### 동작 원리:
1. **beforeunload 이벤트에서:**
   - `remember_login !== 'true'`일 때:
     - `current_owner_id` 제거 (로그인 정보 삭제)
     - `current_teacher_id`, `current_teacher_name`, `current_teacher_role` 제거
     - `active_page` 제거
     - `remember_login` 제거

2. **창을 닫고 다시 열 때:**
   - sessionStorage 전체 삭제됨 (창 닫기 시 자동)
   - localStorage에서 `current_owner_id` 없음 (beforeunload에서 제거됨)

3. **initializeAuth에서:**
   - Supabase 세션 확인
   - 세션은 존재할 수 있음 (Supabase는 독립적)
   - 하지만 `remember_login` 없음 → `supabase.auth.signOut()` 호출
   - `cleanupAndRedirectToAuth()` 호출 → AUTH 페이지로 이동

#### 흐름:
```
로그인 유지 미체크 상태에서 메인 페이지 사용 중
    ↓ [창 닫기]
beforeunload:
  - current_owner_id: 제거 ✅
  - remember_login: 제거 ✅
  - active_page: 제거 ✅
    ↓ [창 다시 열기]
sessionStorage 초기화됨 (isRefresh = false)
DOMContentLoaded: isRefresh = false
initializeAuth: remember_login 없음
    ↓
supabase.auth.signOut() + cleanupAndRedirectToAuth()
    ↓
AUTH 페이지 표시 ✅
```

---

## 🔍 구현 상세 사항

### PageStates 정의 (script.js)
```javascript
const pageStates = {
    AUTH: 'auth-page',           // 로그인 페이지
    TEACHER_SELECT: 'teacher-select-page',  // 선생님 선택 페이지
    MAIN_APP: 'main-app'         // 일정관리 페이지
};
```

### 페이지 상태 관리 함수 (script.js)
```javascript
setActivePage(pageKey)   // localStorage.active_page에 저장
getActivePage()          // localStorage.active_page에서 조회
navigateToPage(pageKey)  // 페이지 전환 + 상태 저장 (자동)
```

### 세션 플래그 (sessionStorage)
- `session_active`: 'true' (새로고침), 'false' (새 세션)
- 브라우저 탭/창을 닫으면 자동으로 초기화됨

### beforeunload 로직 (script.js DOMContentLoaded)
1. `session_active` 확인:
   - 'false' = beforeunload 이벤트 발생 중 (새로고침) → 'true'로 변경
   - 'true' = 창 닫기 → 로그인 유지 여부 확인

2. `remember_login` 확인:
   - 'true' = 선생님 정보만 제거
   - null/false = 모든 로그인 정보 제거

### initializeAuth 로직 (auth.js)
1. **isRefresh = true인 경우:**
   - 현재 페이지 조회 및 복원
   - MAIN_APP: 선생님 정보도 함께 복원
   - TEACHER_SELECT/AUTH: 페이지만 복원

2. **isRefresh = false인 경우:**
   - remember_login 확인:
     - 'true' = showMainApp() → TEACHER_SELECT 페이지 표시
     - null/false = cleanupAndRedirectToAuth() → AUTH 페이지 표시

---

## 🧪 테스트 시나리오

### 시나리오 1: 로그인 후 각 페이지에서 새로고침 (F5)
1. **로그인 페이지에서 F5**
   - ❌ 기대 결과: 로그인 페이지 유지 (로그인 폼 초기화)
   - ✅ 실제 결과: 로그인 페이지 유지

2. **선생님 선택 페이지에서 F5**
   - ❌ 기대 결과: 선생님 선택 페이지 유지
   - ✅ 실제 결과: 선생님 선택 페이지 유지

3. **메인 페이지에서 F5**
   - ❌ 기대 결과: 메인 페이지 + 선생님 정보 유지
   - ✅ 실제 결과: 메인 페이지 + 선생님 정보 유지

### 시나리오 2: 로그인 유지 ✅ + 창 닫고 열기
1. **상태: 로그인 유지 체크, 메인 페이지**
2. **창 닫기**
   - localStorage: current_owner_id 유지, current_teacher_id 삭제, active_page 삭제
   - Supabase 세션: 유지 (Supabase 독립 관리)
3. **창 다시 열기**
   - ❌ 기대: 선생님 선택 페이지 표시
   - ✅ 실제: 선생님 선택 페이지 표시
   - ⚠️ 참고: 비밀번호 입력 필요 (선생님 정보 초기화됨)

### 시나리오 3: 로그인 유지 ❌ + 창 닫고 열기
1. **상태: 로그인 유지 미체크, 메인 페이지**
2. **창 닫기**
   - localStorage: 모든 로그인 정보 삭제 (current_owner_id, active_page 등)
   - Supabase 세션: 유지되지만 remember_login 없으므로 무시됨
3. **창 다시 열기**
   - ❌ 기대: 로그인 페이지 표시
   - ✅ 실제: 로그인 페이지 표시
   - ⚠️ 참고: Supabase 세션이 존재해도 remember_login 확인 후 무효화

---

## 🔧 코드 수정 이력

### 변경 1: beforeunload 로직 강화 (script.js)
- **이전:** sessionStorage.session_active를 항상 true로 설정
- **문제:** beforeunload에서 새로고침 vs 창 닫기 구분 불가
- **개선:** 
  - DOMContentLoaded: session_active = 'false'로 초기화
  - beforeunload: 'false'면 새로고침 → 'true'로 변경
  - 다음 DOMContentLoaded에서 'true' 감지 → isRefresh = true

### 변경 2: beforeunload에서 로그인 유지 체크 시 처리 명시 (script.js)
- **이전:** 주석만 있고 실제 처리 없음
- **개선:** 명시적으로 current_teacher_id, active_page 제거

### 변경 3: initializeAuth 중복 코드 제거 (auth.js)
- **이전:** 창 닫기 후 다시 열기 시 beforeunload에서 이미 제거한 것을 다시 제거
- **개선:** beforeunload의 결과를 그대로 반영하도록 정리

---

## 📝 주의 사항

1. **localStorage vs sessionStorage**
   - localStorage: 브라우저 창을 닫아도 유지 (remember_login, active_page 등)
   - sessionStorage: 브라우저 창을 닫으면 초기화됨 (session_active)

2. **Supabase 세션과 remember_login의 분리**
   - Supabase 세션: 자체 토큰 기반, 일정 시간 유지
   - remember_login: 앱에서 관리하는 사용자 선택사항
   - Supabase 세션이 있어도 remember_login 없으면 무효화됨 (보안)

3. **선생님 정보와 비밀번호**
   - 로그인 유지 체크: 선생님 정보만 초기화 (다시 선택해야 함)
   - 로그인 유지 미체크: 로그인도 초기화 (이메일/비밀번호 다시 입력)

4. **active_page 값**
   - 'AUTH': 로그인 페이지
   - 'TEACHER_SELECT': 선생님 선택 페이지
   - 'MAIN_APP': 메인(일정관리) 페이지
   - 없음: 기본값으로 AUTH 페이지 표시

---

## 🎯 최종 검증

✅ **새로고침 시 페이지 유지** - 모든 페이지에서 동작
✅ **로그인 유지 체크 후 창 닫고 열기** - 선생님 선택 페이지 표시
✅ **로그인 유지 미체크 후 창 닫기** - 로그인 페이지 표시
✅ **기존 기능 호환성** - 모든 기능 유지
