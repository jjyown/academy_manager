# 🏫 Academy Manager - 학원 관리 시스템

학원 운영을 위한 통합 관리 시스템입니다. 출석 관리, 수납 관리, 일정 관리 등 다양한 기능을 제공합니다.

## ✨ 주요 기능

- **출석 관리**: 학생별 수업 출석/결석 기록
- **일정 관리**: 수업 일정 등록 및 공휴일 설정
- **수납 관리**: 학비, 교재비, 특강비 수납 현황 관리
- **학생 관리**: 학생 정보 및 성적 기록
- **선생님 관리**: 역할별 권한 설정 (관리자/선생님/직원)
- **색상 커스터마이징**: 일정 색상 선택 가능
- **숙제 제출 시스템**: 학생이 파일 업로드 → 자동 압축 → 담당 선생님 Google Drive에 전송

## 🚀 시작하기

### 요구사항
- 모던 웹 브라우저 (Chrome, Firefox, Safari 등)
- Supabase 계정

### 설치
```bash
# 저장소 클론
git clone https://github.com/jjyown/academy-manager.git
cd academy-manager

# supabase-config.js 설정 (Supabase 프로젝트 정보 입력)
# 그 후 index.html을 브라우저로 열기
```

## 🔐 로그인

1. **관리자 로그인**: 이메일/비밀번호로 로그인
2. **선생님 선택**: 등록된 선생님 목록에서 선택
3. **기능 사용**: 메뉴에서 원하는 기능 선택

## 📚 숙제 제출 시스템

학생이 파일(사진, 문서 등)을 업로드하면 자동으로 압축되어 담당 선생님의 Google Drive에 전송됩니다.

### 설정 방법
1. Google Cloud Console에서 **Google Drive API** 활성화
2. OAuth 클라이언트의 **Client Secret** 복사
3. Supabase Edge Function secrets에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 추가
4. `HOMEWORK_SETUP.sql`을 Supabase SQL Editor에서 실행
5. Edge Functions 배포:
   ```bash
   supabase functions deploy exchange-google-token
   supabase functions deploy upload-homework
   ```
6. 메인 앱 → 내 정보수정 → **Google Drive 연결하기** 클릭
7. 학생에게 숙제 제출 페이지 URL 공유: `/homework/`

### 파일 형식
- 자동 압축: `과제-{년}년-{월}월-{일}일-{학생이름}.zip`
- Google Drive "숙제 제출" 폴더에 자동 저장

자세한 설정 방법은 `HOMEWORK_SETUP.sql` 파일 상단의 가이드를 참고하세요.

## 🐳 채점 서버 Docker (로컬 / 클라우드 동일 이미지)

채점 백엔드는 `grading-server/` (FastAPI)입니다. 로컬에서 venv로 실행하거나, 아래처럼 컨테이너로 띄울 수 있습니다.

1. `cp grading-server/.env.example grading-server/.env` 후 Supabase·Google·API 키 등을 채웁니다.
2. 저장소 루트에서:

   ```bash
   docker compose up --build
   ```

3. 기본 주소: `http://localhost:8000` (호스트 포트는 `GRADING_PORT=9000 docker compose up` 등으로 변경 가능).

클라우드에 올릴 때는 같은 이미지를 레지스트리에 푸시하고, 플랫폼 시크릿에 `.env`와 동일한 변수를 넣으면 됩니다. 일부 플랫폼은 `PORT`를 자동 지정합니다(`Dockerfile`의 `CMD`가 이를 따릅니다).

## ☁️ Vercel 배포 (highroad-math · 학부모 포털)

- 프로젝트 이름을 **`highroad-math`** 로 두면 기본 주소가 `https://highroad-math.vercel.app` 형태가 됩니다.
- 학부모 포털: **`https://highroad-math.vercel.app/parent-portal`**
- 상세 절차·도메인·Supabase 안내: [`docs/VERCEL_HIGHROAD_PARENT_PORTAL.md`](docs/VERCEL_HIGHROAD_PARENT_PORTAL.md)

## 📊 기술 스택

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **APIs**: Google Drive API, Google OAuth 2.0
- **Storage**: Browser LocalStorage

## 📝 라이센스

Copyright © 2026 jjyown@gmail.com

## 👨‍💻 개발자

- jjyown (jjyown@gmail.com)

## 🤝 피드백

버그 리포트 및 기능 제안은 Issues에 등록해주세요.

---

**웹에서 사용하기**: [Academy Manager 바로가기](https://jjyown.github.io/academy_manager)
