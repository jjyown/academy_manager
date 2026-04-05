# 자동 채점 서버

학생 숙제 사진을 OCR + AI로 자동 채점하는 Python 서버입니다.

## 기능

- **OCR 더블체크**: Gemini Vision 2회 독립 호출로 객관식 답안 인식
- **AI 서술형 채점**: Google Gemini로 서술형 답안 평가
- **채점 이미지 생성**: 원본 위에 ⭕/✘/❓ 표시
- **Google Drive 연동**: 정답 PDF 검색, 채점 결과 저장  
  - 중앙 드라이브 기본 트리(자동 생성): `숙제 관리` → `교재`(하위 `중1`~`고3`), `제출 과제 원본`, `채점 결과`, `즉시채점`(즉시 채점 전용: `년/월/일/폴더명` 하위 저장) — 환경변수 `CENTRAL_*`로 이름 변경 가능(`.env.example` 참고)
  - **Railway `CENTRAL_ROOT_FOLDER`는 Edge와 동일하게 `숙제 관리` 권장**. 예전 `과제 관리`만 있으면 `integrations/drive.resolve_central_root_folder_id`가 레거시 루트를 재사용(중복 루트 완화). Drive에서 폴더명·파일은 한쪽으로 통합하는 것이 최종 정리.
- **자동 정리**: 원본 사진 1개월 후 삭제
- **종합평가 자동 생성**: 매월 28일 AI로 생성 (선생님 승인 후 공개)

## 설치 및 실행

```bash
# 가상환경 생성
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux

# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정
cp .env.example .env
# .env 파일에 실제 값 입력

# 서버 실행
python main.py
```

## Railway 배포

1. [Railway](https://railway.app) 가입
2. New Project → Deploy from GitHub repo
3. `grading-server` 폴더를 Root Directory로 설정
4. Environment Variables에 .env 값 입력
5. Deploy

## 과제 배정 `POST /api/assignments` 400 — `'SyncQueryRequestBuilder' object has no attribute 'select'`

- **원인**: 예전 코드가 `supabase-py` 2.x에서 지원하지 않는 `insert(...).select(...)` 체인을 사용함. 현재 저장소는 `insert(...).execute()`만 사용하도록 수정됨.
- **조치**: GitHub에 해당 수정이 반영된 커밋이 올라갔는지 확인한 뒤, **Railway에서 grading-server 서비스를 최신 커밋으로 재배포**(Redeploy)한다. 프론트만 배포하고 API 서버를 올리지 않으면 증상이 그대로 남는다.
- **배포 확인**: 재배포 후 과제 배정을 한 번 시도하고, Railway 로그에 `grading_assignments insert ok id=... (api=insert.execute` 가 보이면 신규 코드가 동작 중인 것이다.

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | /health | 헬스체크 |
| POST | /api/grade | 채점 실행 |
| GET | /api/results | 채점 결과 목록 |
| GET | /api/results/student/{id} | 학생별 결과 |
| PUT | /api/results/{id}/confirm | 결과 확정 |
| POST | /api/answer-keys/parse | 정답 PDF 파싱 |
| POST | /api/assignments | 과제 배정 |
| POST | /api/evaluations/generate | 종합평가 생성 |
| POST | /api/grading-auth/session | 채점 관리 로그인 후 단기 JWT 발급(PIN·Edge 검증) |
| POST | /api/grading-auth/session-open | PIN 없이 JWT 발급(선택, `GRADING_ALLOW_OPEN_GRADING_SESSION=true`일 때만 — 공개 배포 시 비활성화 권장) |
| GET | /api/homework-submissions | 숙제 제출 목록(세션 JWT 또는 개발 폴백) |
| GET | /api/public-portal-grading/student-results | 학생·학부모 포털용: 인증코드(`student_code`/`parent_code`) 검증 후 `confirmed` 채점만(공개 필드) |
| GET | /api/public-portal-grading/results/{id}/items | 동일 인증코드로 해당 결과가 `confirmed`일 때 문항 일부 필드만 |

## 환경변수

| 변수 | 설명 |
|------|------|
| SUPABASE_URL | Supabase 프로젝트 URL |
| SUPABASE_SERVICE_KEY | Supabase Service Role Key |
| SUPABASE_ANON_KEY | Edge `verify-teacher-pin` 호출용(anon). `POST /api/grading-auth/session`에 필요 |
| GRADING_SESSION_SECRET | 숙제 조회 등 채점 브라우저용 단기 JWT 서명 키(16자 이상 권장). 없으면 `homework-submissions`는 `teacher_id` 쿼리 폴백 |
| GRADING_SESSION_TTL_HOURS | 채점 세션 만료(시간). 기본 12 |
| GOOGLE_CLIENT_ID | Google OAuth Client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth Client Secret |
| GEMINI_API_KEY | Google Gemini API Key |
