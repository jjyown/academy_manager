# 구현 가이드 - 선생님/직원 관리 및 권한 시스템

## 📋 구현된 기능

### 1. 로그인 방식 변경
- **관리자 로그인**: 이메일과 비밀번호로 Supabase 인증
- **선생님/직원 로그인**: 이름과 비밀번호로 로그인 (관리자가 등록한 정보 사용)
- 로그인 페이지에 두 가지 로그인 방식 모두 표시

### 2. 선생님/직원 관리 (관리자 전용)
- **위치**: 메뉴 > 선택 페이지 (선생님 선택 화면에서 "선생님 등록" 버튼)
- **기능**:
  - 역할 선택 (선생님 또는 직원)
  - 비밀번호 설정
  - 연락처 입력 (선택)
  - 선생님/직원 삭제

### 3. 권한 시스템
- **관리자 (Admin)**:
  - 이메일/비밀번호로 로그인
  - 선생님/직원 관리 가능
  - 수납 관리 접근 가능
  - 학생 관리 가능
  
- **선생님 (Teacher)**:
  - 이름/비밀번호로 로그인
  - 자신의 학생 관리 가능
  - 자신의 일정 관리 가능
  - 수납 관리 **불가**
  
- **직원 (Staff)**:
  - 이름/비밀번호로 로그인
  - 제한된 기능만 사용 가능
  - 수납 관리 **불가**

### 4. 수납관리 접근 제한
- **제한 사항**: 관리자(`admin`) 역할만 수납 관리 접근 가능
- **동작**:
  - 비관리자가 수납 관리 버튼을 클릭하면 안내 메시지 표시
  - 수납 관리 메뉴 버튼은 권한이 없으면 자동 숨김
  - 페이지 새로고침 후에도 권한 유지

## 🔧 코드 구조

### 데이터 저장 구조
```javascript
// LocalStorage에 저장되는 정보
localStorage.getItem('current_owner_id')     // 관리자 ID
localStorage.getItem('current_user_role')    // 사용자 역할 ('admin', 'teacher', 'staff')
localStorage.getItem('current_user_name')    // 사용자 이름
localStorage.getItem('current_teacher_id')   // 선생님 ID (선생님/직원 로그인 시)
```

### auth.js

#### 관리자 로그인
```javascript
window.signIn() // 이메일/비밀번호 로그인
```

#### 선생님/직원 로그인
```javascript
window.staffSignIn() // 이름/비밀번호 로그인
```

### script.js

#### 권한 확인 함수
```javascript
function canAccessPayment() {
    const role = localStorage.getItem('current_user_role') || 'teacher';
    return role === 'admin';
}
```

#### 메뉴 가시성 업데이트
```javascript
function updatePaymentMenuVisibility() {
    const btn = document.getElementById('payment-menu-btn');
    if (btn) {
        btn.style.display = canAccessPayment() ? 'flex' : 'none';
    }
}
```

#### 역할 라벨 업데이트
```javascript
function updateUserRoleLabel() {
    const role = localStorage.getItem('current_user_role') || 'teacher';
    // UI에 역할 표시
}
```

#### 선생님 관리 모달 함수
```javascript
window.openTeacherModal()           // 모달 열기
window.renderTeacherListModal()     // 선생님/직원 목록 렌더링
window.deleteTeacherFromModal()     // 선생님/직원 삭제
window.addStaffMember()             // 선생님/직원 추가
```

## 🧪 테스트 방법

### 1. 관리자 로그인
1. 앱 실행
2. "관리자 로그인" - 이메일/비밀번호 입력
3. 로그인 성공 시 선생님 선택 페이지로 이동
4. 메뉴에서 "수납 관리" 버튼이 보임

### 2. 선생님/직원 추가
1. 관리자로 로그인
2. "선생님 등록" 클릭
3. 정보 입력:
   - 이름: 예) "홍길동"
   - 연락처: (선택)
   - 비밀번호: 예) "1234"
4. 등록 완료

### 3. 선생님/직원 로그인
1. 로그인 페이지에서 "선생님/직원 로그인" 섹션
2. 이름 입력: "홍길동"
3. 비밀번호 입력: "1234"
4. 로그인 성공 시 메인 앱으로 바로 이동
5. 메뉴에서 "수납 관리" 버튼이 보이지 않음

### 4. 권한 제한 테스트
1. 선생님으로 로그인
2. 메뉴 확인 - "수납 관리" 버튼 없음
3. 헤더에 "선생님" 표시됨

## 📝 주요 변경 사항 요약

### 파일별 수정 내역

#### index.html
- 로그인 페이지에 "선생님/직원 로그인" 섹션 추가
- "선생님 관리" 메뉴 버튼 제거 (선택 페이지에서만 관리)
- 선생님 변경 버튼 제거
- 헤더에 역할 라벨 추가 (`current-user-role-label`)
- 선생님 관리 모달 추가
- 선생님/직원 추가 모달 추가

#### auth.js
- 관리자 로그인 시 `current_user_role='admin'` 설정
- `staffSignIn()` 함수 추가 (선생님/직원 로그인)
- `showMainApp()` 함수 수정 (역할에 따라 다른 페이지로 이동)
- 로그아웃 시 모든 역할 정보 제거

#### script.js
- `canAccessPayment()` 함수 유지
- `updatePaymentMenuVisibility()` 함수 유지
- `updateUserRoleLabel()` 함수 추가
- 선생님 관리 모달 함수 수정
- `addStaffMember()` 함수 추가
- `renderTeacherListModal()` 함수 수정 (역할 표시 추가)

## ⚠️ 주의 사항

### 보안 고려사항
1. **현재 방식**: 비밀번호가 평문으로 저장됨
   - **권장**: bcrypt 또는 argon2로 해싱 처리
   
2. **클라이언트 권한**: LocalStorage에 역할 정보 저장
   - **권장**: 서버 세션에서 역할 관리
   
3. **데이터 검증**: 클라이언트 측에서만 검증
   - **권장**: 서버 측(Supabase RLS) 정책으로 데이터 보호

### 비밀번호 최소 요구사항
- 최소 4자 이상
- 영문, 숫자, 특수문자 혼합 권장

## 💡 향후 개선 사항

1. **비밀번호 암호화**
   ```sql
   -- Supabase Edge Functions로 bcrypt 사용
   ```

2. **역할별 기능 세분화**
   ```javascript
   // 직원용 메뉴 추가
   function getMenuByRole(role) {
       if (role === 'staff') {
           return ['학생 관리']; // 제한된 메뉴
       }
   }
   ```

3. **세션 타임아웃**
   ```javascript
   // 일정 시간 후 자동 로그아웃
   ```

4. **관리자 설정 페이지**
   ```javascript
   // 선생님/직원의 권한 세부 설정
   ```

## 🔄 로그인 흐름도

```
로그인 시작
    ↓
관리자? → YES → 이메일/비밀번호 입력 → Supabase 인증
    ↓ NO
    선생님/직원? → YES → 이름/비밀번호 입력 → teachers 테이블 조회
    
관리자 로그인 성공 → current_user_role='admin' → 선생님 선택 페이지
선생님/직원 로그인 성공 → current_user_role='teacher/staff' → 메인 앱
```

---
**마지막 업데이트**: 2026년 1월 25일
