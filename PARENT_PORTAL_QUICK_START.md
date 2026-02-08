# 학부모 포털 - 빠른 시작 가이드

## 🎯 4단계 배포 프로세스 (15분)

### 0️⃣ Supabase 설정 (선행 작업, 5분)

**⚠️ 먼저 수행하세요!**

```bash
# 1. SUPABASE_SETUP_PARENT_PORTAL.md 읽기
# 2. Supabase SQL Editor에서:
#    - ATTENDANCE_SETUP.md의 SQL 실행
#    - SUPABASE_TABLES_SQL.md 섹션 4 SQL 실행

# 3. 테이블 생성 확인:
#    Supabase Dashboard → Table Editor
#    ✅ students
#    ✅ attendance_records
#    ✅ student_evaluations
```

---

### 1️⃣ 로컬 테스트 (5분)

```bash
# 프로젝트 폴더로 이동
cd "c:\Users\전재윤\Desktop\출석관리 앱"

# 로컬 서버 시작 (Python 사용)
python -m http.server 8000

# 브라우저에서 접속
http://localhost:8000/학부모%20출결체크/report.html
```

**테스트 항목:**
- ✅ 페이지 로드 확인
- ✅ 학생 검색 기능
- ✅ QR 카메라 (카메라 권한 필요)
- ✅ 출결 조회
- ✅ 평가 저장

---

### 2️⃣ GitHub에 푸시 (2분)

```bash
# 모든 파일 추가
git add .

# 커밋
git commit -m "feat: 학부모 포탈 추가 - 출결조회, QR스캔, 평가기능"

# GitHub에 푸시
git push origin main
```

---

### 3️⃣ Vercel에 배포 (2분)

#### 옵션 A: Vercel CLI 사용
```bash
# Vercel CLI 설치
npm install -g vercel

# 배포
vercel

# 메뉴 선택
1. Link to existing project? → N (새 프로젝트)
2. Project name: academy-manager
3. 나머지는 기본값 Enter
```

#### 옵션 B: Vercel 웹 사이트 사용
1. https://vercel.com 방문
2. "New Project" 클릭
3. GitHub 저장소 선택
4. Deploy 버튼 클릭

---

## 🔗 배포 완료 후

### 학부모 포털 URL
```
https://[프로젝트명].vercel.app/학부모%20출결체크/report.html
```

### 메인 관리자 페이지에서도 접근 가능
```
메인 메뉴 → "학부모 포탈" 버튼 클릭
```

---

## 📱 모바일 앱처럼 사용

### iOS (Safari)
1. Safari에서 포탈 URL 접속
2. 공유 버튼 (↑) → 홈 화면에 추가
3. 앱처럼 사용 가능

### Android (Chrome)
1. Chrome에서 포탈 URL 접속
2. ⋮ 메뉴 → "설치" 또는 "홈 화면에 추가"
3. 앱처럼 사용 가능

---

## 💡 팁

### 학부모에게 공유하기
```
QR 코드 생성: https://qr-code-generator.com에서
URL → QR 코드 생성

또는 직접 링크 공유:
https://[프로젝트명].vercel.app/학부모%20출결체크/report.html
```

### 여러 학원 운영 시
```
Vercel 조직 → 여러 프로젝트로 구분
각 프로젝트마다 환경 변수 설정

academy-A.vercel.app
academy-B.vercel.app
academy-C.vercel.app
```

### 커스터마이징
`report.html` 열기:
- 색상 변경: `:root { --primary: #색상코드 }`
- 학원명 변경: `<h1>학원명</h1>`
- 로고 추가: CSS 배경 이미지 설정

---

## 🆘 배포 중 문제

| 문제 | 해결방법 |
|------|--------|
| 404 에러 | `vercel.json`에 `rewrites` 설정 |
| 한글 경로 인식 안됨 | 경로를 URL 인코딩: `%20` |
| QR 카메라 작동 안함 | HTTPS 필요 (Vercel 자동 제공) |
| Supabase 연결 실패 | 환경 변수 확인 및 RLS 정책 검토 |

---

## 📊 배포 후 통계

Vercel 대시보드에서 확인 가능:
- 페이지 방문 수
- 응답 시간
- 에러율
- 사용자 환경 (브라우저, OS)

---

## 🎉 완료!

이제 학부모들이 언제 어디서나 자녀의 출결을 확인할 수 있습니다!

**기능:**
- 📊 실시간 출결 현황
- 📸 QR 코드 스캔
- 💬 종합 평가
- 📱 모바일 완벽 최적화

---

**배포 예상 시간**: 총 15분 ⏱️
(Supabase 설정 5분 + 로컬 테스트 5분 + GitHub/Vercel 배포 5분)
