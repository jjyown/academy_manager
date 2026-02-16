# 자동 채점 서버

학생 숙제 사진을 OCR + AI로 자동 채점하는 Python 서버입니다.

## 기능

- **OCR 더블체크**: EasyOCR + PaddleOCR로 객관식 답안 인식
- **AI 서술형 채점**: Google Gemini로 서술형 답안 평가
- **채점 이미지 생성**: 원본 위에 ⭕/✘/❓ 표시
- **Google Drive 연동**: 정답 PDF 검색, 채점 결과 저장
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

## 환경변수

| 변수 | 설명 |
|------|------|
| SUPABASE_URL | Supabase 프로젝트 URL |
| SUPABASE_SERVICE_KEY | Supabase Service Role Key |
| GOOGLE_CLIENT_ID | Google OAuth Client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth Client Secret |
| GEMINI_API_KEY | Google Gemini API Key |
