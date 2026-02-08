# 학부모 포털 배포 가이드

## 📋 개요
학부모들이 학생의 출결 현황을 확인할 수 있는 독립적인 포털 페이지를 구축하고 배포합니다.

- **페이지**: 출석 조회, QR 스캔, 종합 평가
- **기술**: Vanilla JavaScript, Supabase, CSS3 (모바일 우선)
- **배포**: GitHub + Vercel

---

## 🚀 배포 단계

### 1단계: GitHub에 코드 푸시

#### 1.1 GitHub 저장소 설정
```bash
# 기존 저장소가 있다면 스킵
git init
git add .
git commit -m "feat: 학부모 출결체크 포탈 추가"
git remote add origin https://github.com/[your-username]/[repository-name].git
git branch -M main
git push -u origin main
```

#### 1.2 파일 구조 확인
```
출석관리 앱/
├── index.html (메인 관리자 페이지)
├── script.js (메인 기능)
├── style.css (스타일)
├── supabase-config.js (DB 설정)
├── 학부모 출결체크/
│   ├── report.html ✨ NEW
│   └── report.js ✨ NEW
└── package.json
```

---

### 2단계: Vercel 배포 설정

#### 2.1 Vercel 계정 생성
1. [https://vercel.com](https://vercel.com) 방문
2. GitHub 계정으로 로그인
3. "New Project" 클릭

#### 2.2 프로젝트 임포트
```
1. GitHub 저장소 선택
2. Project name: "academy-manager" (또는 원하는 이름)
3. Framework: Other (Vanilla JS)
```

#### 2.3 환경 변수 설정
Vercel 대시보드 → Settings → Environment Variables에서 추가:

```
REACT_APP_SUPABASE_URL=https://jzcrpdeomjmytfekcgqu.supabase.co
REACT_APP_SUPABASE_ANON_KEY=sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu
```

#### 2.4 배포 실행
```
Deploy 버튼 클릭 → 자동으로 배포 시작
```

---

## 🔗 학부모 포털 접근

### 배포 후 URL
```
https://[your-vercel-project].vercel.app/학부모%20출결체크/report.html
```

### 학부모에게 링크 공유
```
QR 코드 생성 (온라인 QR 코드 생성 도구 사용):
https://[your-vercel-project].vercel.app/학부모%20출결체크/report.html

또는 직접 링크 공유
```

---

## 📱 주요 기능

### 1. 학생 검색
- 이름 또는 전화번호로 검색
- 실시간 검색 결과

### 2. QR 스캔
- 학생 QR 코드 스캔
- 카메라 자동 인식 (전방/후방)

### 3. 출결 현황
- 최근 30일 출결 기록 표시
- 출석/지각/결석 상태 시각화
- 출석률 통계 (%)

### 4. 종합 평가
- 학생에 대한 코멘트 작성
- 최대 500자 제한
- 자동 저장 기능

---

## 🔧 로컬 테스트

### 개발 환경 실행
```bash
# Node.js 기반 로컬 서버 실행
python -m http.server 8000
# 또는
npx http-server

# 브라우저에서 접속
http://localhost:8000/학부모%20출결체크/report.html
```

### 환경 변수 설정 (로컬)
`.env.local` 파일 생성:
```
REACT_APP_SUPABASE_URL=https://jzcrpdeomjmytfekcgqu.supabase.co
REACT_APP_SUPABASE_ANON_KEY=sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu
```

---

## 🛠️ 필요한 Supabase 테이블

### ⚠️ 중요: SQL 실행 순서

**1. 먼저 실행할 것:**
- `ATTENDANCE_SETUP.md` - attendance_records 테이블 (QR 출석용)
- `SUPABASE_TABLES_SQL.md` - schedules, payments, holidays, student_evaluations 테이블

**2. Supabase SQL Editor에서:**
1. Supabase 대시보시 → SQL Editor
2. 위의 SQL을 복사하여 실행
3. 각 테이블 생성 완료 확인

### students 테이블 (기존)
```sql
-- 이미 생성되어 있어야 함
CREATE TABLE students (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    qr_code_data TEXT UNIQUE  -- QR 출석 시스템용
);
```

### attendance_records 테이블 (출석 기록)
**파일**: `ATTENDANCE_SETUP.md`에서 SQL 실행
```sql
-- 예시 (상세 SQL은 ATTENDANCE_SETUP.md 참조)
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id TEXT NOT NULL,
    attendance_date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL, -- 'present', 'late', 'absent', 'makeup'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, attendance_date, teacher_id)
);

CREATE INDEX idx_attendance_student ON attendance_records(student_id);
CREATE INDEX idx_attendance_date ON attendance_records(attendance_date);
```

### student_evaluations 테이블 (평가 코멘트)
**파일**: `SUPABASE_TABLES_SQL.md`에서 SQL 실행 (섹션 4)
```sql
-- 예시 (상세 SQL은 SUPABASE_TABLES_SQL.md 참조)
CREATE TABLE student_evaluations (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL UNIQUE REFERENCES students(id),
    owner_user_id UUID NOT NULL REFERENCES auth.users(id),
    comment TEXT, -- 최대 500자
    rating INTEGER CHECK (rating >= 1 AND rating <= 5), -- 1~5점 (선택)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_student_evaluations_student ON student_evaluations(student_id);
```

---

## 📊 성능 최적화

### 1. 캐싱 전략
```javascript
// report.js에서 학생 데이터 캐싱
const studentCache = new Map();
```

### 2. 이미지 최적화
- QR 코드 SVG 형식 사용
- 아이콘은 Font Awesome 활용

### 3. 모바일 최적화
- 터치 이벤트 최적화
- 44px 이상 버튼 크기
- 뷰포트 메타 태그 설정

---

## 🔐 보안 권장사항

### 1. CORS 설정
Supabase RLS (Row Level Security) 활성화:
```sql
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_evaluations ENABLE ROW LEVEL SECURITY;
```

### 2. API 키 보호
- 공개 키(ANON_KEY)만 프론트엔드에 노출
- 비밀 키는 서버에서만 사용

### 3. HTTPS 강제
Vercel에서 자동으로 HTTPS 제공

---

## 📝 커스터마이징 가이드

### 색상 변경
`report.html` 스타일의 CSS 변수 수정:
```css
:root {
    --primary: #4f46e5;      /* 주요 색상 */
    --success: #22c55e;      /* 성공 색상 */
    --warning: #f59e0b;      /* 경고 색상 */
}
```

### 학원명 변경
`report.html` 헤더 수정:
```html
<h1>📚 [학원명] 학생 출결 조회</h1>
```

### 언어 변경
HTML lang 속성 수정:
```html
<html lang="en"> <!-- "ko" → "en" -->
```

---

## 🆘 문제 해결

### 1. QR 카메라 작동 안 함
- HTTPS 환경 필요
- 사용자 권한 확인
- `html5-qrcode` 라이브러리 버전 확인

### 2. Supabase 연결 오류
```javascript
// report.js 콘솔에서 확인
console.log('Supabase 연결:', supabaseClient);
```

### 3. 배포 후 404 에러
```
Vercel 설정 → Build & Development
Root Directory: ./ (기본값)
Install Command: npm install (필요 시)
```

---

## 📧 학부모 공지 템플릿

```
안녕하세요, [학원명]입니다.

학부모님들의 편의를 위해 학생 출결 조회 포털을 오픈했습니다.

🔗 포탈 링크: [https://your-domain.vercel.app/...]

📱 이용 방법:
1. 링크 접속
2. 학생 이름 또는 전화번호로 검색
3. 출결 현황 확인
4. QR 코드 스캔도 가능합니다

📞 문의: [contact@academy.com]
```

---

## ✅ 체크리스트

- [ ] GitHub 저장소에 코드 푸시
- [ ] Vercel 프로젝트 생성
- [ ] 환경 변수 설정
- [ ] 배포 성공 확인
- [ ] 로컬에서 테스트
- [ ] 학부모에게 링크 공유
- [ ] QR 코드 생성 (선택사항)
- [ ] 학부모 피드백 수집

---

## 📚 추가 리소스

- [Supabase 문서](https://supabase.com/docs)
- [Vercel 배포 가이드](https://vercel.com/docs)
- [HTML5 QR Code](https://davidshimjs.github.io/qrcodejs/)
- [CSS Variables](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)

---

**최종 수정**: 2026년 2월 5일
**담당자**: AI Assistant
