# Vercel 배포 가이드

## 📋 배포 전 체크리스트

### 1️⃣ 환경 변수 설정 (필수)

**로컬 개발:**
- `.env.local` 파일 자동으로 로드됨
- 파일 내용:
  ```
  REACT_APP_SUPABASE_URL=https://your-project.supabase.co
  REACT_APP_SUPABASE_ANON_KEY=your-anon-key
  ```

**Vercel 배포:**
1. Vercel 대시보드 접속 → 프로젝트 선택
2. Settings → Environment Variables
3. 다음 2개 변수 추가:
   - `REACT_APP_SUPABASE_URL`: Supabase URL
   - `REACT_APP_SUPABASE_ANON_KEY`: Supabase Anon Key

### 2️⃣ Supabase CORS 설정

**문제:** Vercel 배포 후 CORS 오류 발생 가능

**해결 방법:**
1. Supabase 대시보드 → Settings → API
2. API Settings에서 CORS 허용 오리진 추가:
   ```
   https://your-domain.vercel.app
   ```

### 3️⃣ Git 저장소 설정

**필수 확인:**
```bash
# .gitignore에 .env.local이 있는지 확인
cat .gitignore | grep ".env"
```

**.env.local은 절대 커밋하면 안 됨!**

### 4️⃣ 배포 단계

1. **GitHub 저장소 푸시:**
   ```bash
   git add .
   git commit -m "Vercel 배포 설정"
   git push origin main
   ```

2. **Vercel에서 배포:**
   - vercel.com 접속
   - "New Project" → GitHub 저장소 선택
   - Framework: "Static"
   - Build Command: (비워둔 상태로 OK)
   - Deploy 클릭

3. **배포 후 환경 변수 설정:**
   - Vercel 대시보드 → Settings → Environment Variables
   - `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` 추가
   - Redeploy 클릭

## ✅ 배포 후 확인

### 로컬 vs Vercel 동작 차이

| 항목 | 로컬 | Vercel |
|------|------|--------|
| 환경 변수 | .env.local | Vercel Settings |
| Supabase | ✅ 직연결 | ⚠️ CORS 설정 필요 |
| 파일 로드 | ✅ 모든 형식 | ⚠️ 정적 파일만 |

### 배포 후 테스트

```
1. 배포된 URL 접속
2. 로그인/회원가입 테스트
3. 브라우저 콘솔에서 오류 확인 (F12)
4. Supabase 대시보드에서 데이터 확인
```

## 🚨 문제 해결

### "Environment variables not found"
- ✅ Vercel Settings → Environment Variables 재확인
- ✅ 변수명이 정확한지 확인 (오타 체크)
- ✅ Redeploy 실행

### CORS 오류
- ✅ Supabase Settings → API에서 CORS 추가
- ✅ 오리진: `https://your-domain.vercel.app` (정확한 도메인)

### 특정 기능 작동 안 함
- ✅ 브라우저 개발자 도구 (F12) → Console 확인
- ✅ Supabase 대시보드에서 권한 설정 확인
- ✅ 데이터베이스 테이블 존재 확인

## 📚 참고 링크

- [Vercel 공식 문서](https://vercel.com/docs)
- [Supabase CORS 설정](https://supabase.com/docs/guides/api/cors)
- [정적 사이트 배포](https://vercel.com/docs/concepts/deployments/overview)
