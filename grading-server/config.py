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

# 중앙 드라이브(jjyown@gmail.com) 폴더 이름
CENTRAL_GRADING_MATERIAL_FOLDER = os.getenv("CENTRAL_GRADING_MATERIAL_FOLDER", "숙제 채점 자료")
CENTRAL_GRADED_RESULT_FOLDER = os.getenv("CENTRAL_GRADED_RESULT_FOLDER", "채점 결과")

# Rate Limiting (채점 API: 분당 최대 요청 수)
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))

# AI API 타임아웃 (초)
AI_API_TIMEOUT = int(os.getenv("AI_API_TIMEOUT", "120"))
