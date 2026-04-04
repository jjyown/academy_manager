import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
# Edge Function verify-teacher-pin 호출용 (서버 → Supabase)
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

# 채점 브라우저 세션 JWT 서명용 (숙제 조회 API 등). 16자 이상 난수 권장. 미설정 시 숙제 API는 teacher_id 쿼리 폴백(개발용).
GRADING_SESSION_SECRET = os.getenv("GRADING_SESSION_SECRET", "")
GRADING_SESSION_TTL_HOURS = int(os.getenv("GRADING_SESSION_TTL_HOURS", "12"))

# 운영 단일 원장(jjyown@gmail.com 등): 모든 선생님 채점 세션 JWT의 sub·응답 owner_user_id를 이 UUID로 고정.
# 비우면 기존대로 teachers.owner_user_id 사용. 설정 시 채점관리 프론트의 과제 API teacher_id와 반드시 동일해야 함.
GRADING_CANONICAL_OWNER_USER_ID = os.getenv("GRADING_CANONICAL_OWNER_USER_ID", "").strip()

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

# 중앙 드라이브 폴더 구조:
#   숙제 관리 / 교재 / {중1,중2,중3,고1,고2,고3}
#   숙제 관리 / 제출 과제 원본 / {N년}/{N월}/{N일}/{학생이름}
#   숙제 관리 / 채점 결과 / {N년}/{N월}/{N일}/{학생이름}
# (기존 배포는 .env로 이전 이름 유지 가능)
CENTRAL_ROOT_FOLDER = os.getenv("CENTRAL_ROOT_FOLDER", "숙제 관리")
# Edge upload-homework는 "숙제 관리" 고정. Railway에 과거 루트만 있으면 drive.resolve_central_root_folder_id가 여기서 대체 검색.
CENTRAL_ROOT_FOLDER_LEGACY_ALIASES = tuple(
    x.strip()
    for x in os.getenv("CENTRAL_ROOT_FOLDER_LEGACY_ALIASES", "과제 관리").split(",")
    if x.strip()
)
CENTRAL_GRADING_MATERIAL_FOLDER = os.getenv("CENTRAL_GRADING_MATERIAL_FOLDER", "교재")
CENTRAL_GRADED_RESULT_FOLDER = os.getenv("CENTRAL_GRADED_RESULT_FOLDER", "채점 결과")
CENTRAL_SUBMIT_FOLDER = os.getenv("CENTRAL_SUBMIT_FOLDER", "제출 과제 원본")
# 교재 파싱 시 페이지 이미지 저장 위치: 숙제 관리 / 교재 / 이 이름 / {교재제목}
CENTRAL_PAGE_IMAGES_FOLDER = os.getenv("CENTRAL_PAGE_IMAGES_FOLDER", "교재 페이지 이미지")
# 교재 하위 학년 구분 폴더(자동 생성)
CENTRAL_GRADE_LEVEL_FOLDERS = tuple(
    x.strip()
    for x in os.getenv("CENTRAL_GRADE_LEVEL_FOLDERS", "중1,중2,중3,고1,고2,고3").split(",")
    if x.strip()
) or ("중1", "중2", "중3", "고1", "고2", "고3")

# Rate Limiting (채점 API: 분당 최대 요청 수)
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))

# AI API 타임아웃 (초)
AI_API_TIMEOUT = int(os.getenv("AI_API_TIMEOUT", "120"))

# AI 채점 에이전트 (개별 문제 집중 검증) - "true"이면 활성화
USE_GRADING_AGENT = os.getenv("USE_GRADING_AGENT", "true").lower() in ("true", "1", "yes")

# 채점 백그라운드 전체 타임아웃(초)
# 기본: 300초 + 이미지당 20초, 최대 900초
GRADING_TIMEOUT_BASE_SECONDS = int(os.getenv("GRADING_TIMEOUT_BASE_SECONDS", "300"))
GRADING_TIMEOUT_PER_IMAGE_SECONDS = int(os.getenv("GRADING_TIMEOUT_PER_IMAGE_SECONDS", "20"))
GRADING_TIMEOUT_MAX_SECONDS = int(os.getenv("GRADING_TIMEOUT_MAX_SECONDS", "900"))

# OCR 타이브레이크 안전장치
# 이미지당 타이브레이크 수행 최대 문제 수 (낮출수록 지연 감소)
OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE = int(os.getenv("OCR_TIEBREAK_MAX_ITEMS_PER_IMAGE", "6"))
# 문제당 타이브레이크 재시도 횟수 (1이면 재시도 없이 1회만 시도)
OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION = int(os.getenv("OCR_TIEBREAK_MAX_RETRIES_PER_QUESTION", "1"))
# 모델이 정책/거부 문구를 반환하면 즉시 OCR1 fallback
OCR_TIEBREAK_FALLBACK_ON_REFUSAL = os.getenv("OCR_TIEBREAK_FALLBACK_ON_REFUSAL", "true").lower() in ("true", "1", "yes")

# AI 에이전트 검증 보호장치
# agent_verify 단계 자체 hard timeout(초)
AGENT_VERIFY_HARD_TIMEOUT_SECONDS = int(os.getenv("AGENT_VERIFY_HARD_TIMEOUT_SECONDS", "180"))
# agent_verify에서 이미지당 최대 검증 문제 수
AGENT_VERIFY_MAX_QUESTIONS = int(os.getenv("AGENT_VERIFY_MAX_QUESTIONS", "12"))
# 전체 채점 timeout 대비 잔여시간이 이 값보다 작으면 agent_verify 건너뜀(초)
AGENT_VERIFY_MIN_REMAINING_SECONDS = int(os.getenv("AGENT_VERIFY_MIN_REMAINING_SECONDS", "45"))
# 잔여시간 계산 시 안전 여유(초)
AGENT_VERIFY_TIMEOUT_GUARD_SECONDS = int(os.getenv("AGENT_VERIFY_TIMEOUT_GUARD_SECONDS", "20"))
