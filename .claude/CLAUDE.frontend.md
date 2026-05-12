# 프론트엔드 세부 매뉴얼

> 루트 [CLAUDE.md](../CLAUDE.md) 보충. 정적 사이트(HTML/CSS/Vanilla JS) 관련 작업 시 참조.

## 구조
- [index.html](../index.html): 메인 SPA(라우터·뷰 한 파일). 거대 파일이지만 패턴 유지.
- [script.js](../script.js), [auth.js](../auth.js), [database.js](../database.js), [supabase-config.js](../supabase-config.js): 메인 앱 로직
- [academic-calendar.js](../academic-calendar.js): 학사 일정
- [qr-attendance.js](../qr-attendance.js): QR 출석
- [parent-portal/](../parent-portal/): 학부모 포털 (별도 빌드 없는 별도 정적 페이지)
- [homework/](../homework/): 학생 숙제 제출
- [grading/](../grading/): 채점·해설 결과 보기 (`index.html` 1개)
- [css/](../css/), [style.css](../style.css), [mobile.css](../mobile.css)

## 검증
1. `python -m http.server 8000` → 브라우저로 변경 화면 직접 클릭
2. DevTools 콘솔 에러 0개 확인
3. Supabase RLS 영향이 있으면 일반 사용자/관리자/선생님 3가지 역할로 각각 테스트
4. 모바일 뷰포트 시뮬레이션 확인 (mobile.css 반응형)

## 주의
- ES 모듈/번들러 없음. `<script src="...">`로 직접 로드. import/export 새로 도입 금지.
- 전역 객체로 모듈 간 통신. 이 패턴 임의 변경 금지.
- Supabase 클라이언트는 [supabase-config.js](../supabase-config.js)에서 init. 다른 곳에서 새로 만들지 말 것.
- `current_owner_id` 추적 로직(소유자 컨텍스트)을 건드리지 말 것 — RLS 회귀 원인.
