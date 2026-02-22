import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# JWT 검증용 시크릿 (Supabase Dashboard → Settings → API → JWT Secret)
# 설정하지 않으면 인증이 비활성화됩니다 (개발 모드)
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# AI 모델 설정
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

PORT = int(os.getenv("PORT", "8000"))

# CORS 허용 도메인 (쉼표 구분, 비어있으면 localhost만 허용)
# 예: "https://your-app.vercel.app,https://your-domain.com"
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")

# 중앙 드라이브 폴더 구조: 과제 관리 / {교재, 제출 과제, 채점 결과}
CENTRAL_ROOT_FOLDER = os.getenv("CENTRAL_ROOT_FOLDER", "과제 관리")
CENTRAL_GRADING_MATERIAL_FOLDER = os.getenv("CENTRAL_GRADING_MATERIAL_FOLDER", "교재")
CENTRAL_GRADED_RESULT_FOLDER = os.getenv("CENTRAL_GRADED_RESULT_FOLDER", "채점 결과")
CENTRAL_SUBMIT_FOLDER = os.getenv("CENTRAL_SUBMIT_FOLDER", "제출 과제")

# Rate Limiting (채점 API: 분당 최대 요청 수)
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))

# AI API 타임아웃 (초)
AI_API_TIMEOUT = int(os.getenv("AI_API_TIMEOUT", "120"))

# AI 채점 에이전트 (개별 문제 집중 검증) - "true"이면 활성화
USE_GRADING_AGENT = os.getenv("USE_GRADING_AGENT", "true").lower() in ("true", "1", "yes")
