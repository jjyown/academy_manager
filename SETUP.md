# 📚 Supabase 연동 설정 가이드

## 🔑 Step 1: Supabase URL과 API 키 복사하기

### 당신이 복사한 정보:
```
Project URL: YOUR_SUPABASE_URL  (예: https://xxxxx.supabase.co)
Anon Key: YOUR_ANON_KEY  (예: eyJhbGci...)
```

---

## ✏️ Step 2: supabase-config.js 수정하기

1. **VS Code에서** `supabase-config.js` 파일 열기
2. 아래 코드에서 `YOUR_SUPABASE_URL`과 `YOUR_ANON_KEY`를 **당신이 복사한 값**으로 변경:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';     // ← 여기에 Project URL 붙여넣기
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';   // ← 여기에 Anon Key 붙여넣기
```

**예시:**
```javascript
const SUPABASE_URL = 'https://abcdef123456.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

3. **파일 저장** (Ctrl + S)

---

## 🚀 Step 3: 앱 실행하기

### 로컬에서 테스트하기:
```bash
# VS Code의 Terminal에서:
python -m http.server 8000
```

그 후 브라우저에서: `http://localhost:8000` 열기

### 또는 Live Server 사용:
- VS Code 확장 프로그램: **Live Server** 설치
- index.html 우클릭 → "Open with Live Server"

---

## 📋 테스트 계정 만들기

앱을 열면 로그인 페이지가 나옵니다:

1. **회원가입** 클릭
2. 테스트 정보 입력:
   ```
   이름: 테스트 선생님
   이메일: teacher1@example.com
   비밀번호: 1234567890
   ```
3. 회원가입 완료!
4. **로그인**으로 로그인

---

## ✅ 확인 사항

이것들이 정상 작동하는지 확인하세요:

- [ ] 로그인 페이지가 보인다
- [ ] 회원가입 가능하다
- [ ] 로그인 후 달력이 보인다
- [ ] 학생 추가 가능하다
- [ ] 일정 추가 가능하다

---

## 🐛 문제 해결

### "Cannot find variable: supabase"
→ Supabase CDN 로드 실패
→ 인터넷 연결 확인, 브라우저 새로고침

### "Unauthorized"
→ API 키가 잘못됨
→ supabase-config.js의 키 다시 확인

### 로그인이 작동 안 함
→ Supabase SQL 명령이 제대로 실행되지 않음
→ Supabase 대시보드 → SQL Editor에서 모든 SQL 재실행

---

## 📞 필요한 경우 다시 도움받기

다음 정보를 준비하면 도움받기 쉬워집니다:
- 어떤 기능이 안 되는가?
- 브라우저 콘솔의 에러 메시지 (F12 → Console)
- supabase-config.js가 제대로 저장되었는가?
