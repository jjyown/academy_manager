import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

PORT = int(os.getenv("PORT", "8000"))

# 중앙 드라이브(jjyown@gmail.com) 폴더 이름
CENTRAL_SUBMIT_FOLDER = os.getenv("CENTRAL_SUBMIT_FOLDER", "숙제 제출")
CENTRAL_GRADING_MATERIAL_FOLDER = os.getenv("CENTRAL_GRADING_MATERIAL_FOLDER", "숙제 채점 자료")
CENTRAL_GRADED_RESULT_FOLDER = os.getenv("CENTRAL_GRADED_RESULT_FOLDER", "채점 결과")

# 선생님 드라이브 채점 결과 폴더
TEACHER_RESULT_FOLDER = os.getenv("TEACHER_RESULT_FOLDER", "채점 결과")

ORIGINAL_KEEP_DAYS = int(os.getenv("ORIGINAL_KEEP_DAYS", "30"))
IMAGE_QUALITY = int(os.getenv("IMAGE_QUALITY", "80"))
