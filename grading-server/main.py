"""자동 채점 서버 - FastAPI
전체 흐름:
1. 학생이 숙제 제출 → 중앙 드라이브(jjyown@gmail.com)에 저장
2. Python 서버가 중앙 드라이브에서 ZIP 다운로드 → OCR 채점
3. 채점 결과 이미지를 중앙 드라이브 + 담당 선생님 드라이브에 저장
4. 선생님이 채점 관리 페이지에서 검토/수정
"""
import logging
import io
import json
import re
import time
import zipfile
from collections import defaultdict
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import (
    PORT, CENTRAL_GRADING_MATERIAL_FOLDER, CENTRAL_GRADED_RESULT_FOLDER,
    TEACHER_RESULT_FOLDER, CORS_ORIGINS, RATE_LIMIT_PER_MINUTE
)
from ocr.engines import ocr_gpt4o_batch, cross_validate_ocr
from ocr.preprocessor import preprocess_batch
from grading.grader import grade_submission
from grading.image_marker import create_graded_image
from grading.pdf_parser import extract_answers_from_pdf
from grading.hml_parser import extract_answers_from_hml
from integrations.supabase_client import (
    get_central_admin_token, get_teacher_drive_token,
    get_answer_key, get_all_answer_keys, get_answer_keys_by_teacher, upsert_answer_key,
    get_assignment, get_assignments_by_teacher, create_assignment,
    create_grading_result, update_grading_result,
    get_grading_results_by_teacher, get_grading_results_by_student,
    create_grading_items, get_grading_items, update_grading_item,
    get_student, get_teacher, get_teacher_by_id,
    get_pending_submissions, update_submission_grading_status,
    get_supabase, create_supabase_for_background,
    create_notification, get_notifications, mark_notifications_read,
)
from integrations.drive import (
    download_file_central, upload_to_central, upload_to_teacher_drive,
    search_answer_pdfs_central, cleanup_old_originals, delete_file,
    upload_page_images_to_central,
)
from integrations.gemini import match_answer_key
from scheduler.monthly_eval import run_monthly_evaluation

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ============================================================
# 채점 진행률 추적 (인메모리)
# ============================================================
_grading_progress: dict[int, dict] = {}  # result_id → progress dict

def _update_progress(result_id: int, stage: str, current: int = 0, total: int = 0, detail: str = ""):
    """채점 진행률 업데이트"""
    _grading_progress[result_id] = {
        "result_id": result_id,
        "stage": stage,
        "current": current,
        "total": total,
        "percent": round(current / total * 100) if total > 0 else 0,
        "detail": detail,
        "updated_at": time.time(),
    }

def _clear_old_progress():
    """5분 이상 된 진행률 데이터 정리"""
    cutoff = time.time() - 300
    stale = [k for k, v in _grading_progress.items() if v.get("updated_at", 0) < cutoff]
    for k in stale:
        del _grading_progress[k]


def _parse_page_range(range_str: str) -> tuple[int, int] | None:
    """페이지 범위 문자열 파싱 (예: "45-48" → (45, 48), "30" → (30, 30))"""
    import re
    range_str = range_str.replace(" ", "")
    m = re.match(r"(\d+)\s*[-~]\s*(\d+)", range_str)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"(\d+)", range_str)
    if m:
        return (int(m.group(1)), int(m.group(1)))
    return None


async def _match_by_image_comparison(
    student_img_bytes: bytes,
    candidate_keys: list[dict],
    central_token: str | None,
) -> dict | None:
    """저장된 페이지 이미지와 학생 이미지를 Gemini Vision으로 비교하여 교재 매칭

    후보 교재가 5개 이하이고 page_images_json이 있을 때만 실행.
    각 교재에서 대표 이미지 1장을 가져와 학생 이미지와 비교.
    """
    import google.generativeai as genai
    from config import GEMINI_API_KEY
    import base64

    if not central_token:
        return None

    candidates_with_images = [
        k for k in candidate_keys
        if k.get("page_images_json") and len(k["page_images_json"]) > 0
    ]

    if not candidates_with_images or len(candidates_with_images) > 5:
        if len(candidates_with_images) > 5:
            logger.info(f"[ImageMatch] 후보 {len(candidates_with_images)}개 > 5개 → 이미지 매칭 건너뜀")
        return None

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    parts = []
    parts.append("""아래 "학생 숙제 사진"이 어느 교재의 페이지인지 판별하세요.
각 교재의 대표 페이지 이미지와 학생 사진을 비교하여:
- 레이아웃, 폰트, 문제 형식, 페이지 디자인이 같은 교재를 찾으세요.
- 정확히 일치하는 교재가 없으면 -1을 반환하세요.

반드시 아래 JSON만 응답 (다른 텍스트 없이):
{"matched_index": 0}  (0-based 인덱스, 일치하는 교재 번호)
또는
{"matched_index": -1}  (일치하는 교재 없음)
""")

    # 학생 이미지 추가
    parts.append("=== 학생 숙제 사진 ===")
    student_b64 = base64.b64encode(student_img_bytes).decode("utf-8")
    parts.append({"mime_type": "image/jpeg", "data": student_b64})

    # 후보 교재 대표 이미지 추가 (Drive에서 다운로드)
    from integrations.drive import download_file_central
    for i, key in enumerate(candidates_with_images):
        page_imgs = key["page_images_json"]
        representative = page_imgs[0]
        title = key.get("title", "")
        parts.append(f"=== 교재 {i}: {title} ===")

        try:
            ref_bytes = download_file_central(central_token, representative["drive_file_id"])
            ref_b64 = base64.b64encode(ref_bytes).decode("utf-8")
            parts.append({"mime_type": "image/jpeg", "data": ref_b64})
        except Exception as e:
            logger.warning(f"[ImageMatch] 교재 '{title}' 대표 이미지 다운로드 실패: {e}")
            parts.append(f"(이미지 로드 실패)")

    try:
        response = model.generate_content(parts)
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        import json as _json
        match_result = _json.loads(text.strip())
        matched_idx = match_result.get("matched_index", -1)

        if 0 <= matched_idx < len(candidates_with_images):
            matched_key = candidates_with_images[matched_idx]
            logger.info(f"[ImageMatch] 이미지 비교 매칭 성공 → #{matched_key['id']} '{matched_key.get('title','')}'")
            return matched_key
        else:
            logger.info(f"[ImageMatch] 이미지 비교 결과: 일치하는 교재 없음 (index={matched_idx})")
    except Exception as e:
        logger.warning(f"[ImageMatch] Gemini Vision 이미지 비교 실패: {e}")

    return None


def _tokenize_korean(text: str) -> set[str]:
    """한국어 텍스트를 의미 있는 토큰으로 분리 (2글자 이상 단어)"""
    import re
    clean = re.sub(r"[^\w가-힣]", " ", text.lower())
    return {w for w in clean.split() if len(w) >= 2}


def _match_by_textbook_name(detected_name: str, available_keys: list[dict]) -> int | None:
    """OCR로 감지된 교재명과 등록된 교재 제목을 비교하여 가장 적합한 ID 반환"""
    if not detected_name or not available_keys:
        return None

    detected_clean = detected_name.replace(" ", "").lower()
    detected_tokens = _tokenize_korean(detected_name)
    best_id = None
    best_score = 0

    for key in available_keys:
        title = (key.get("title") or "").replace(" ", "").lower()
        if not title:
            continue

        # 정확히 포함되는지 확인
        if detected_clean in title or title in detected_clean:
            score = len(title) * 10
            if score > best_score:
                best_score = score
                best_id = key["id"]
            continue

        # 단어(토큰) 단위 겹침 확인
        title_tokens = _tokenize_korean(key.get("title") or "")
        if not title_tokens or not detected_tokens:
            continue
        common_tokens = detected_tokens & title_tokens
        ratio = len(common_tokens) / max(len(detected_tokens), len(title_tokens))
        if ratio > 0.4 and len(common_tokens) >= 1:
            score = int(ratio * 100) + len(common_tokens)
            if score > best_score:
                best_score = score
                best_id = key["id"]

    if best_id:
        logger.info(f"[TextbookMatch] '{detected_name}' → key #{best_id} (score={best_score})")
    return best_id

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 매월 28일 자정에 종합평가 자동 생성
    scheduler.add_job(run_monthly_evaluation, "cron", day=28, hour=0, minute=0)
    scheduler.start()
    logger.info("스케줄러 시작: 매월 28일 종합평가 자동 생성")
    yield
    scheduler.shutdown()


app = FastAPI(title="자동 채점 서버", version="2.0.0", lifespan=lifespan)

# CORS 설정: 환경변수 CORS_ORIGINS에 쉼표 구분으로 도메인 지정
_allowed_origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()] if CORS_ORIGINS else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Rate Limiting 미들웨어 (IP 기반, 분당 최대 요청 수 제한)
# ============================================================
_rate_limit_store: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/grade") or request.url.path.startswith("/api/auto-grade"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0
        timestamps = _rate_limit_store[client_ip]
        _rate_limit_store[client_ip] = [t for t in timestamps if now - t < window]
        if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_PER_MINUTE:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded. Max {RATE_LIMIT_PER_MINUTE} requests per minute."}
            )
        _rate_limit_store[client_ip].append(now)
    return await call_next(request)


# ============================================================
# 헬스체크
# ============================================================

@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


# ============================================================
# 교재/정답 관리 (중앙 드라이브에서 관리)
# ============================================================

@app.get("/api/teachers")
async def list_teachers():
    """선생님 목록 조회 (채점 관리 로그인용)"""
    try:
        sb = get_supabase()
        res = sb.table("teachers").select("*").order("created_at").execute()
        return {"data": res.data or []}
    except Exception as e:
        logger.error(f"선생님 목록 조회 실패: {e}")
        return {"data": []}


@app.get("/api/answer-keys")
async def list_answer_keys(teacher_id: str):
    """선생님의 교재 목록 조회"""
    keys = await get_answer_keys_by_teacher(teacher_id)
    return {"data": keys}


@app.put("/api/answer-keys/{key_id}")
async def update_answer_key(key_id: int, request: Request):
    """정답지 수정 (제목, 정답, 문제 유형 개별/전체 수정 가능)

    Body 예시:
    - {"title": "새 제목"}
    - {"answers_json": {"1": "③", "2": "①"}}  (전체 교체)
    - {"update_answers": {"3": "②"}}  (개별 문제만 수정, 기존 유지)
    - {"update_types": {"3": "essay"}}  (개별 문제 유형만 수정)
    """
    try:
        body = await request.json()
        sb = get_supabase()

        # 기존 데이터 조회
        existing = sb.table("answer_keys").select("*").eq("id", key_id).limit(1).execute()
        if not existing.data:
            raise HTTPException(404, "교재를 찾을 수 없습니다")
        old_key = existing.data[0]

        update_data = {}

        # 제목 수정
        if "title" in body:
            update_data["title"] = body["title"]

        # 과목 수정
        if "subject" in body:
            update_data["subject"] = body["subject"]

        # 정답 전체 교체
        if "answers_json" in body:
            update_data["answers_json"] = body["answers_json"]
            update_data["total_questions"] = len(body["answers_json"])

        # 개별 문제 정답 수정 (기존 유지 + 병합)
        if "update_answers" in body:
            merged = dict(old_key.get("answers_json") or {})
            merged.update(body["update_answers"])
            update_data["answers_json"] = merged
            update_data["total_questions"] = len(merged)

        # 문제 유형 전체 교체
        if "question_types_json" in body:
            update_data["question_types_json"] = body["question_types_json"]

        # 개별 문제 유형 수정 (기존 유지 + 병합)
        if "update_types" in body:
            merged_types = dict(old_key.get("question_types_json") or {})
            merged_types.update(body["update_types"])
            update_data["question_types_json"] = merged_types

        if not update_data:
            return {"success": False, "message": "수정할 내용이 없습니다"}

        from datetime import datetime, timezone
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        res = sb.table("answer_keys").update(update_data).eq("id", key_id).execute()
        logger.info(f"[AnswerKey] #{key_id} 수정: {list(update_data.keys())}")

        return {"success": True, "data": res.data[0] if res.data else {}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"정답지 수정 실패 (id={key_id}): {e}")
        raise HTTPException(500, f"정답지 수정 실패: {str(e)[:200]}")


@app.delete("/api/answer-keys/{key_id}")
async def delete_answer_key(key_id: int, teacher_id: str):
    """교재 삭제"""
    sb = get_supabase()
    result = sb.table("answer_keys").delete().eq("id", key_id).eq("teacher_id", teacher_id).execute()
    if result.data:
        return {"success": True, "message": "교재가 삭제되었습니다"}
    return {"success": False, "message": "삭제할 교재를 찾을 수 없습니다"}


def _upload_page_images_background(
    central_token: str, title: str, raw_page_images: list[dict], answer_key_id: int
):
    """백그라운드에서 페이지 이미지를 Drive에 업로드하고 DB 업데이트"""
    try:
        page_images_json = upload_page_images_to_central(
            central_token, title, raw_page_images
        )
        logger.info(f"[BG] '{title}' 페이지 이미지 {len(page_images_json)}장 Drive 업로드 완료")

        sb = create_supabase_for_background()
        sb.table("answer_keys").update(
            {"page_images_json": page_images_json}
        ).eq("id", answer_key_id).execute()
        logger.info(f"[BG] answer_key #{answer_key_id} page_images_json 업데이트 완료")
    except Exception as e:
        logger.error(f"[BG] 페이지 이미지 업로드 실패 (answer_key #{answer_key_id}): {e}")


@app.post("/api/answer-keys/parse")
async def parse_answer_key(
    background_tasks: BackgroundTasks,
    teacher_id: str = Form(...),
    title: str = Form(...),
    subject: str = Form(""),
    drive_file_id: str = Form(""),
    pdf_file: UploadFile = File(None),
    answer_page_range: str = Form(""),
    total_hint: int = Form(None),
):
    """정답 파일 파싱 및 교재 등록

    지원 형식:
    - PDF: Gemini Vision으로 정답 추출 (기존)
    - HML: 수학비서 XML에서 미주/꼬릿말 정답 직접 추출 (100% 정확)

    answer_page_range: PDF 전용, "45-48" 형식 정답 페이지 범위
    페이지 이미지는 백그라운드에서 Drive에 업로드 (응답 지연 방지)
    """
    file_bytes = None
    file_ext = ""
    central_token = await get_central_admin_token()

    if pdf_file:
        file_bytes = await pdf_file.read()
        fname = (pdf_file.filename or "").lower()
        if fname.endswith(".hml"):
            file_ext = "hml"
        else:
            file_ext = "pdf"
    elif drive_file_id and central_token:
        file_bytes = download_file_central(central_token, drive_file_id)
        file_ext = "pdf"
    else:
        raise HTTPException(400, "PDF 또는 HML 파일이 필요합니다")

    # ── 파서 분기: HML vs PDF ──
    raw_page_images = []

    if file_ext == "hml":
        logger.info(f"[Parse] HML 파일 파싱: '{title}'")
        result = await extract_answers_from_hml(file_bytes)
    else:
        page_range = None
        if answer_page_range.strip():
            page_range = _parse_page_range(answer_page_range.strip())

        result = await extract_answers_from_pdf(file_bytes, total_hint=total_hint, page_range=page_range)
        raw_page_images = result.pop("page_images", [])

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "drive_file_id": drive_file_id,
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "parsed": True,
    }
    saved = await upsert_answer_key(key_data)

    saved_id = saved.get("id")
    if raw_page_images and central_token and saved_id:
        background_tasks.add_task(
            _upload_page_images_background,
            central_token, title, raw_page_images, saved_id
        )
        logger.info(f"[Parse] '{title}' 정답 {result.get('total', 0)}문제 저장 완료. "
                     f"페이지 이미지 {len(raw_page_images)}장은 백그라운드 업로드 예약됨")
    else:
        logger.info(f"[Parse] '{title}' 정답 {result.get('total', 0)}문제 저장 완료 "
                     f"(파서: {'HML' if file_ext == 'hml' else 'PDF'})")

    return {"data": saved, "parsed_result": result}


@app.get("/api/answer-keys/drive-pdfs")
async def list_drive_pdfs():
    """중앙 드라이브 '숙제 채점 자료' 폴더의 PDF 목록"""
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    pdfs = search_answer_pdfs_central(central_token, CENTRAL_GRADING_MATERIAL_FOLDER)
    return {"data": pdfs}


# ============================================================
# 과제 배정
# ============================================================

@app.get("/api/assignments")
async def list_assignments(teacher_id: str):
    assignments = await get_assignments_by_teacher(teacher_id)
    return {"data": assignments}


@app.post("/api/assignments")
async def create_new_assignment(
    teacher_id: str = Form(...),
    title: str = Form(...),
    answer_key_id: int = Form(None),
    page_range: str = Form(""),
    due_date: str = Form(None),
    mode: str = Form("assigned"),
):
    data = {
        "teacher_id": teacher_id,
        "title": title,
        "answer_key_id": answer_key_id,
        "page_range": page_range,
        "due_date": due_date,
        "mode": mode,
    }
    result = await create_assignment(data)
    return {"data": result}


# ============================================================
# 채점 진행률 조회 API
# ============================================================

@app.get("/api/grading-progress/{result_id}")
async def get_grading_progress(result_id: int):
    """특정 채점의 실시간 진행률 조회"""
    _clear_old_progress()
    progress = _grading_progress.get(result_id)
    if progress:
        return {"success": True, "data": progress}
    return {"success": True, "data": {"result_id": result_id, "stage": "unknown", "percent": 0}}

@app.get("/api/grading-progress")
async def get_all_grading_progress(teacher_id: str = ""):
    """현재 진행 중인 모든 채점의 진행률 조회"""
    _clear_old_progress()
    active = [v for v in _grading_progress.values() if v.get("stage") != "done"]
    return {"success": True, "data": active}

# ============================================================
# 채점 결과 조회/수정 API
# ============================================================

@app.get("/api/results")
async def list_results(teacher_id: str, status: str = ""):
    """채점 결과 목록 조회"""
    try:
        sb = get_supabase()
        query = sb.table("grading_results").select("*").eq("teacher_id", teacher_id)
        if status and status != "all":
            query = query.eq("status", status)
        res = query.order("created_at", desc=True).execute()
        results = res.data or []
        # 학생 정보 별도 조회
        student_ids = list(set(r.get("student_id") for r in results if r.get("student_id")))
        student_map = {}
        if student_ids:
            s_res = sb.table("students").select("id, name, grade, school").in_("id", student_ids).execute()
            for s in (s_res.data or []):
                student_map[s["id"]] = s
        for r in results:
            r["students"] = student_map.get(r.get("student_id"), {})
        return {"data": results}
    except Exception as e:
        logger.error(f"결과 조회 실패: {e}")
        return {"data": []}


@app.put("/api/results/{result_id}/confirm")
async def confirm_result(result_id: int):
    """채점 결과 확정"""
    try:
        sb = get_supabase()
        res = sb.table("grading_results").update({"status": "confirmed"}).eq("id", result_id).execute()
        return {"data": res.data}
    except Exception as e:
        logger.error(f"결과 확정 실패: {e}")
        return {"data": None}


@app.delete("/api/results/{result_id}")
async def delete_result(result_id: int):
    """채점 결과 삭제 (관련 grading_items도 함께 삭제)"""
    try:
        sb = get_supabase()
        sb.table("grading_items").delete().eq("result_id", result_id).execute()
        res = sb.table("grading_results").delete().eq("id", result_id).execute()
        if res.data:
            logger.info(f"채점 결과 #{result_id} 삭제 완료")
            return {"success": True, "message": "채점 결과가 삭제되었습니다"}
        return {"success": False, "message": "삭제할 결과를 찾을 수 없습니다"}
    except Exception as e:
        logger.error(f"채점 결과 삭제 실패 (id={result_id}): {e}")
        return {"success": False, "message": str(e)}


@app.put("/api/results/{result_id}/annotations")
async def save_annotations(result_id: int, request: Request):
    """선생님 메모/필기 저장 (허용 필드만 업데이트)"""
    ALLOWED_FIELDS = {"teacher_annotations", "teacher_memo", "updated_at"}
    try:
        body = await request.json()
        safe_body = {k: v for k, v in body.items() if k in ALLOWED_FIELDS}
        if not safe_body:
            return {"data": None, "message": "허용되지 않는 필드입니다"}
        from datetime import datetime, timezone
        safe_body["updated_at"] = datetime.now(timezone.utc).isoformat()
        sb = get_supabase()
        res = sb.table("grading_results").update(safe_body).eq("id", result_id).execute()
        return {"data": res.data}
    except Exception as e:
        logger.error(f"메모 저장 실패: {e}")
        return {"data": None}


@app.get("/api/results/{result_id}/items")
async def list_result_items(result_id: int):
    """채점 문항별 결과 조회"""
    try:
        sb = get_supabase()
        res = sb.table("grading_items").select("*").eq("result_id", result_id).order("question_num").execute()
        return {"data": res.data or []}
    except Exception as e:
        logger.error(f"문항 조회 실패: {e}")
        return {"data": []}


@app.put("/api/items/{item_id}")
async def update_item(item_id: int, request: Request):
    """문항별 점수/피드백 수정 → 해당 result 총점 자동 재계산"""
    try:
        body = await request.json()
        sb = get_supabase()
        res = sb.table("grading_items").update(body).eq("id", item_id).execute()
        updated_item = res.data[0] if res.data else None

        # result_id를 통해 해당 채점 결과의 모든 문항을 가져와 총점 재계산
        if updated_item and updated_item.get("result_id"):
            await _recalculate_result_totals(updated_item["result_id"])

        return {"data": res.data}
    except Exception as e:
        logger.error(f"문항 수정 실패: {e}")
        return {"data": None}


async def _recalculate_result_totals(result_id: int):
    """채점 결과의 문항별 데이터를 기반으로 총점/정답수 재계산

    점수 계산 방식은 grade_submission과 동일:
    - 서술형: ai_score / ai_max_score
    - MC/단답형: (100 - 서술형 총배점) / MC문항수 를 문항당 배점으로 사용
    """
    try:
        sb = get_supabase()
        items_res = sb.table("grading_items").select("*").eq("result_id", result_id).execute()
        items = items_res.data or []

        if not items:
            return

        correct = 0
        wrong = 0
        uncertain = 0
        unanswered = 0

        # 1단계: 서술형 배점 합계 + MC/단답형 문항 수 집계
        essay_total = 0.0
        essay_earned = 0.0
        mc_questions = 0

        for item in items:
            q_type = item.get("question_type", "multiple_choice")
            if q_type == "essay":
                ai_max = float(item.get("ai_max_score") or 0)
                essay_total += ai_max if ai_max > 0 else 10
            else:
                mc_questions += 1

        mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0

        # 2단계: 각 문항 채점
        for item in items:
            q_type = item.get("question_type", "multiple_choice")
            is_correct = item.get("is_correct")
            student_answer = item.get("student_answer", "")
            is_unanswered = student_answer == "(미풀이)" or (
                is_correct is None and item.get("ai_feedback") == "학생이 풀지 않은 문제"
            )

            if q_type == "essay":
                ai_score = float(item.get("ai_score") or 0)
                ai_max = float(item.get("ai_max_score") or 0)
                essay_earned += ai_score

                if is_correct is True:
                    correct += 1
                elif is_correct is False:
                    wrong += 1
                elif is_correct is None:
                    if is_unanswered:
                        unanswered += 1
                    else:
                        uncertain += 1
            else:
                if is_unanswered:
                    unanswered += 1
                elif is_correct is True:
                    correct += 1
                elif is_correct is False:
                    wrong += 1
                elif is_correct is None:
                    uncertain += 1

        mc_earned = sum(
            mc_per_score for item in items
            if item.get("question_type", "multiple_choice") != "essay"
            and item.get("is_correct") is True
        )
        total_score = round(mc_earned + essay_earned, 1)
        max_score = 100.0

        status = "confirmed" if uncertain == 0 else "review_needed"

        await update_grading_result(result_id, {
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_questions": len(items),
            "total_score": total_score,
            "max_score": max_score,
            "status": status,
        })
        logger.info(f"[Recalc] result #{result_id} 재계산 완료: "
                     f"{correct}맞/{wrong}틀/{uncertain}보류/{unanswered}미풀이, "
                     f"점수 {total_score}/{max_score}")
    except Exception as e:
        logger.error(f"[Recalc] result #{result_id} 재계산 실패: {e}")


@app.get("/api/stats")
async def get_stats(teacher_id: str):
    """통계 데이터 조회"""
    try:
        sb = get_supabase()
        res = sb.table("grading_results").select("*").eq("teacher_id", teacher_id).eq("status", "confirmed").execute()
        results = res.data or []
        # 학생 정보 별도 조회
        student_ids = list(set(r.get("student_id") for r in results if r.get("student_id")))
        student_map = {}
        if student_ids:
            s_res = sb.table("students").select("id, name").in_("id", student_ids).execute()
            for s in (s_res.data or []):
                student_map[s["id"]] = s
        for r in results:
            r["students"] = student_map.get(r.get("student_id"), {})
        return {"data": results}
    except Exception as e:
        logger.error(f"통계 조회 실패: {e}")
        return {"data": []}


@app.get("/api/stats/student/{student_id}")
async def get_student_stats(student_id: int, teacher_id: str = ""):
    """학생별 성적 추이 조회 (최근 결과 시간순)"""
    try:
        sb = get_supabase()
        query = sb.table("grading_results").select(
            "id, created_at, total_score, max_score, correct_count, wrong_count, "
            "total_questions, status, page_info, answer_key_id, answer_keys(title)"
        ).eq("student_id", student_id).in_(
            "status", ["confirmed", "review_needed"]
        ).order("created_at", desc=False)

        if teacher_id:
            query = query.eq("teacher_id", teacher_id)

        res = query.execute()
        results = res.data or []

        # 추이 데이터 생성
        trend = []
        for r in results:
            max_s = float(r.get("max_score") or 1)
            total_s = float(r.get("total_score") or 0)
            accuracy = round((total_s / max_s * 100) if max_s > 0 else 0, 1)
            ak = r.get("answer_keys") or {}
            trend.append({
                "result_id": r["id"],
                "date": r.get("created_at", "")[:10],
                "total_score": total_s,
                "max_score": max_s,
                "accuracy": accuracy,
                "correct_count": r.get("correct_count", 0),
                "wrong_count": r.get("wrong_count", 0),
                "total_questions": r.get("total_questions", 0),
                "textbook": ak.get("title", ""),
                "page_info": r.get("page_info", ""),
            })

        # 요약 통계
        if trend:
            avg_accuracy = round(sum(t["accuracy"] for t in trend) / len(trend), 1)
            recent_accuracy = trend[-1]["accuracy"] if trend else 0
            best_accuracy = max(t["accuracy"] for t in trend)
            total_submissions = len(trend)
        else:
            avg_accuracy = recent_accuracy = best_accuracy = 0
            total_submissions = 0

        return {
            "student_id": student_id,
            "summary": {
                "total_submissions": total_submissions,
                "avg_accuracy": avg_accuracy,
                "recent_accuracy": recent_accuracy,
                "best_accuracy": best_accuracy,
            },
            "trend": trend,
        }
    except Exception as e:
        logger.error(f"학생 통계 조회 실패 (student_id={student_id}): {e}")
        return {"student_id": student_id, "summary": {}, "trend": []}


@app.get("/api/stats/wrong-answers")
async def get_wrong_answer_stats(teacher_id: str, answer_key_id: int = 0):
    """교재별 오답률 분석 (어떤 문제를 많이 틀리는지)"""
    try:
        sb = get_supabase()

        # 해당 교사의 확정된 결과 조회
        query = sb.table("grading_results").select("id").eq("teacher_id", teacher_id).in_(
            "status", ["confirmed", "review_needed"]
        )
        if answer_key_id:
            query = query.eq("answer_key_id", answer_key_id)
        results = query.execute()
        result_ids = [r["id"] for r in (results.data or [])]

        if not result_ids:
            return {"data": [], "summary": {}}

        # 문항별 데이터 조회 (배치)
        all_items = []
        batch_size = 50
        for i in range(0, len(result_ids), batch_size):
            batch = result_ids[i:i + batch_size]
            items_res = sb.table("grading_items").select(
                "question_number, question_label, question_type, is_correct, correct_answer"
            ).in_("result_id", batch).execute()
            all_items.extend(items_res.data or [])

        # 문제별 오답률 집계
        question_stats = {}
        for item in all_items:
            q_label = item.get("question_label") or str(item.get("question_number", "?"))
            if q_label not in question_stats:
                question_stats[q_label] = {
                    "question": q_label,
                    "correct_answer": item.get("correct_answer", ""),
                    "total": 0, "correct": 0, "wrong": 0, "unanswered": 0,
                }
            stats = question_stats[q_label]
            stats["total"] += 1
            if item.get("is_correct") is True:
                stats["correct"] += 1
            elif item.get("is_correct") is False:
                if not item.get("student_answer"):
                    stats["unanswered"] += 1
                else:
                    stats["wrong"] += 1

        # 오답률 계산 및 정렬 (오답률 높은 순)
        result_data = []
        for q_label, stats in question_stats.items():
            total = stats["total"]
            wrong_rate = round(((stats["wrong"] + stats["unanswered"]) / total * 100) if total > 0 else 0, 1)
            result_data.append({
                "question": q_label,
                "correct_answer": stats["correct_answer"],
                "total_attempts": total,
                "correct_count": stats["correct"],
                "wrong_count": stats["wrong"],
                "unanswered_count": stats["unanswered"],
                "wrong_rate": wrong_rate,
            })

        result_data.sort(key=lambda x: x["wrong_rate"], reverse=True)

        # 전체 요약
        total_items = len(all_items)
        total_correct = sum(1 for i in all_items if i.get("is_correct") is True)
        overall_accuracy = round((total_correct / total_items * 100) if total_items > 0 else 0, 1)

        return {
            "data": result_data,
            "summary": {
                "total_results": len(result_ids),
                "total_items": total_items,
                "overall_accuracy": overall_accuracy,
                "most_missed": result_data[:5] if result_data else [],
            },
        }
    except Exception as e:
        logger.error(f"오답률 통계 조회 실패: {e}")
        return {"data": [], "summary": {}}


# ============================================================
# 채점 실행 (핵심 API)
# ============================================================

@app.post("/api/grade")
async def grade_homework(
    student_id: int = Form(...),
    teacher_id: str = Form(...),
    assignment_id: int = Form(None),
    answer_key_id: int = Form(None),
    mode: str = Form("assigned"),
    homework_submission_id: int = Form(None),
    image: UploadFile = File(None),
    zip_drive_id: str = Form(""),
):
    """채점 실행
    - image: 직접 업로드 (즉시 채점)
    - zip_drive_id: 중앙 드라이브의 ZIP 파일 ID (수업 전 제출 채점)
    """
    student = await get_student(student_id)
    if not student:
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    # 중복 채점 방지: 같은 submission에 대해 이미 채점 완료/진행 중이면 건너뜀
    if homework_submission_id:
        sb = get_supabase()
        existing = sb.table("grading_results").select("id, status").eq(
            "homework_submission_id", homework_submission_id
        ).in_("status", ["grading", "confirmed", "review_needed"]).limit(1).execute()
        if existing.data:
            existing_result = existing.data[0]
            logger.info(f"[Dedup] submission #{homework_submission_id} 이미 채점됨 → result #{existing_result['id']} ({existing_result['status']})")
            return {
                "result_id": existing_result["id"],
                "status": existing_result["status"],
                "message": "이미 채점된 제출입니다",
                "duplicate": True,
            }

    # 중앙 드라이브 토큰 조회
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    # 선생님 드라이브 토큰 조회
    teacher_token = await get_teacher_drive_token(teacher_id)

    # 정답 데이터 조회
    answer_key = None
    if answer_key_id:
        answer_key = await get_answer_key(answer_key_id)
    elif assignment_id:
        assignment = await get_assignment(assignment_id)
        if assignment and assignment.get("answer_key_id"):
            answer_key = await get_answer_key(assignment["answer_key_id"])
            answer_key_id = assignment["answer_key_id"]

    # 이미지 가져오기
    image_bytes_list = []

    if image:
        img_data = await image.read()
        if image.filename and image.filename.endswith(".zip"):
            image_bytes_list = _extract_images_from_zip(img_data)
        else:
            image_bytes_list = [img_data]
    elif zip_drive_id:
        # 중앙 드라이브에서 ZIP 다운로드
        zip_data = download_file_central(central_token, zip_drive_id)
        image_bytes_list = _extract_images_from_zip(zip_data)

    if not image_bytes_list:
        raise HTTPException(400, "채점할 이미지가 없습니다")

    # 채점 결과 레코드 생성
    result_data = {
        "student_id": student_id,
        "teacher_id": teacher_id,
        "assignment_id": assignment_id,
        "answer_key_id": answer_key_id,
        "homework_submission_id": homework_submission_id,
        "mode": mode,
        "status": "grading",
        "total_questions": 0,
    }
    grading_result = await create_grading_result(result_data)
    result_id = grading_result["id"]

    # 숙제 제출 상태 업데이트
    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "grading")

    # ── 채점 본체: 실패 시 failed 상태로 전환 ──
    try:
        return await _execute_grading(
            result_id=result_id,
            student=student,
            student_id=student_id,
            teacher_id=teacher_id,
            central_token=central_token,
            teacher_token=teacher_token,
            answer_key=answer_key,
            answer_key_id=answer_key_id,
            image_bytes_list=image_bytes_list,
            mode=mode,
            homework_submission_id=homework_submission_id,
        )
    except Exception as e:
        logger.error(f"[FATAL] 채점 실패 (result #{result_id}): {e}", exc_info=True)
        _update_progress(result_id, "failed", 0, 0, f"채점 실패: {str(e)[:100]}")
        # 실패 상태로 DB 업데이트
        try:
            error_msg = str(e)[:500]
            await update_grading_result(result_id, {
                "status": "failed",
                "error_message": error_msg,
            })
            if homework_submission_id:
                await update_submission_grading_status(homework_submission_id, "grading_failed")

            # 채점 실패 알림
            student_name = student.get("name", "학생") if student else "학생"
            await create_notification({
                "teacher_id": teacher_id,
                "type": "grading_failed",
                "title": "채점 실패",
                "message": f"{student_name} 숙제 채점 실패: {str(e)[:100]}",
                "data": {"result_id": result_id, "student_id": student_id, "error": error_msg[:200]},
                "read": False,
            })
        except Exception as db_err:
            logger.error(f"[FATAL] 실패 상태 DB 업데이트도 실패: {db_err}")
        raise HTTPException(500, f"채점 처리 중 오류가 발생했습니다: {str(e)[:200]}")


async def _execute_grading(
    *,
    result_id: int,
    student: dict,
    student_id: int,
    teacher_id: str,
    central_token: str,
    teacher_token: str | None,
    answer_key: dict | None,
    answer_key_id: int | None,
    image_bytes_list: list[bytes],
    mode: str,
    homework_submission_id: int | None,
) -> dict:
    """채점 실행 본체 (grade_homework에서 호출, 예외 시 상위에서 처리)"""
    all_items = []
    central_graded_urls = []
    central_graded_ids = []
    teacher_graded_urls = []
    teacher_graded_ids = []
    total_correct = 0
    total_wrong = 0
    total_uncertain = 0
    total_questions = 0
    total_score = 0
    max_score = 0

    total_unanswered = 0
    page_info_parts = []

    total_images = len(image_bytes_list)

    # ── #6: 이미지 전처리 (회전 보정, Deskew, 대비 향상, 샤프닝) ──
    _update_progress(result_id, "preprocess", 0, total_images, "이미지 전처리 중...")
    logger.info(f"[Preprocess] {total_images}장 이미지 전처리 시작")
    image_bytes_list = preprocess_batch(image_bytes_list)
    logger.info(f"[Preprocess] 전처리 완료")

    # ── #4: 기대 문제번호 준비 (answer_key가 이미 있으면 전달) ──
    expected_questions = None
    if answer_key:
        expected_questions = sorted(
            (answer_key.get("answers_json") or {}).keys(),
            key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
        )

    # ── #3: GPT-4o 배치 OCR (5장씩 병렬) ──
    # 문제 유형 힌트 준비 (answer_key에 types가 있으면 OCR에 전달)
    question_types = None
    if answer_key:
        question_types = answer_key.get("question_types_json") or None
    _update_progress(result_id, "ocr", 1, 4, f"GPT-4o OCR 처리 중 ({total_images}장)...")
    logger.info(f"[OCR] GPT-4o 배치 OCR 시작: {total_images}장"
                f"{f', 유형 힌트 {len(question_types)}문제' if question_types else ''}")
    gpt4o_results = await ocr_gpt4o_batch(
        image_bytes_list,
        expected_questions=expected_questions,
        question_types=question_types,
    )
    logger.info(f"[OCR] GPT-4o 배치 OCR 완료: {len(gpt4o_results)}개 결과")

    # ── #1: 크로스 엔진 검증 (GPT-4o + Gemini) ──
    _update_progress(result_id, "cross_validate", 2, 4, "Gemini 크로스 검증 중...")
    logger.info(f"[CrossVal] Gemini 크로스 검증 시작")
    ocr_results = await cross_validate_ocr(
        image_bytes_list, gpt4o_results,
        expected_questions=expected_questions,
        question_types=question_types,
    )
    logger.info(f"[CrossVal] 크로스 검증 완료: {len(ocr_results)}개 결과")

    # ── #8: 교재 매칭 - 다중 이미지 집계 (answer_key_id 미지정 시) ──
    if not answer_key and mode == "auto_search" and ocr_results:
        try:
            all_keys = await get_answer_keys_by_teacher(teacher_id, parsed_only=True)
            if not all_keys:
                all_keys = await get_all_answer_keys()
            logger.info(f"[Auto] 후보 교재 {len(all_keys)}개: "
                        f"{[k.get('title','') for k in all_keys]}")

            # 전체 OCR 결과에서 교재명/문제번호 집계 (#8) - 풀이 노트 제외
            all_detected_names = []
            all_detected_nums = set()
            for ocr_r in ocr_results:
                if ocr_r.get("page_type") == "solution_only":
                    continue  # 풀이 노트는 교재 매칭에서 제외
                tb = ocr_r.get("textbook_info", {})
                name = tb.get("name", "")
                if name:
                    all_detected_names.append(name)
                ans = ocr_r.get("answers", {})
                for k, v in ans.items():
                    # 크로스 검증 형식에서 키 추출
                    all_detected_nums.add(k)

            # 가장 많이 감지된 교재명 사용
            detected_name = ""
            if all_detected_names:
                from collections import Counter
                name_counts = Counter(all_detected_names)
                detected_name = name_counts.most_common(1)[0][0]

            logger.info(f"[Auto] 집계: 교재='{detected_name}' ({len(all_detected_names)}회), "
                        f"문제 {len(all_detected_nums)}개")

            # 1차: 교재명 매칭
            if detected_name:
                matched = _match_by_textbook_name(detected_name, all_keys)
                if matched:
                    answer_key = await get_answer_key(matched)
                    answer_key_id = matched
                    logger.info(f"[Match] 교재명 '{detected_name}' → #{matched}")

            # 2차: 문제 번호 겹침 매칭 (전체 이미지 집계)
            if not answer_key and all_detected_nums:
                best_key = None
                best_overlap = 0
                for key in all_keys:
                    key_nums = set((key.get("answers_json") or {}).keys())
                    overlap = len(all_detected_nums & key_nums)
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best_key = key
                if best_key and best_overlap >= max(1, len(all_detected_nums) * 0.3):
                    answer_key = best_key
                    answer_key_id = best_key["id"]
                    logger.info(f"[Match] 문제번호 {best_overlap}개 겹침 → #{answer_key_id} '{best_key.get('title','')}'")

            # 3차: 교재 1개만 있으면 자동 선택
            if not answer_key and len(all_keys) == 1:
                answer_key = all_keys[0]
                answer_key_id = answer_key["id"]
                logger.info(f"[Match] 교재 1개 → 자동선택 #{answer_key_id}")

            # 4차: 이미지 비교 매칭 (page_images_json 기반, Gemini 사용)
            if not answer_key and len(all_keys) > 1:
                central_token_for_match = await get_central_admin_token()
                matched_by_image = await _match_by_image_comparison(
                    image_bytes_list[0], all_keys, central_token_for_match
                )
                if matched_by_image:
                    answer_key = matched_by_image
                    answer_key_id = matched_by_image["id"]
                    logger.info(f"[Match] 이미지 비교 → #{answer_key_id} '{matched_by_image.get('title','')}'")

            # 매칭 성공 후 기대 문제번호가 없었으면 다시 GPT-4o OCR (문제번호 힌트 포함)
            if answer_key and expected_questions is None:
                expected_questions = sorted(
                    (answer_key.get("answers_json") or {}).keys(),
                    key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
                )
                logger.info(f"[Auto] 교재 매칭 완료, 기대 문제: {expected_questions[:10]}...")

        except Exception as e:
            logger.error(f"[Auto] 매칭 실패: {e}")

    if not answer_key:
        logger.warning(f"정답 데이터를 찾을 수 없습니다 (student: {student_id})")

    _update_progress(result_id, "grading", 0, total_images, "채점 시작...")
    solution_only_count = 0
    graded_questions = set()  # 중복 채점 방지: 이미 채점된 문제번호 추적

    for idx, img_bytes in enumerate(image_bytes_list):
        _update_progress(result_id, "grading", idx + 1, total_images,
                         f"이미지 {idx+1}/{total_images} 채점 중...")

        if not answer_key:
            logger.warning(f"교재 미매칭 → 이미지 {idx+1}/{total_images} 건너뜀")
            continue

        # ── 풀이 노트(solution_only) 판별: 채점 건너뛰고 원본만 저장 ──
        ocr_data = ocr_results[idx] if idx < len(ocr_results) else None
        is_solution_only = (ocr_data or {}).get("page_type") == "solution_only"

        if is_solution_only:
            solution_only_count += 1
            logger.info(f"[Grade] 이미지 {idx+1}/{len(image_bytes_list)}: 풀이 노트 → 채점 건너뜀, 원본 저장")
            page_info_parts.append(f"풀이노트 {solution_only_count}")

            now = datetime.now()
            now_str = now.strftime('%Y%m%d_%H%M')
            filename = f"{student['name']}_{now_str}_{idx+1}_풀이.jpg"
            sub_path = [
                str(now.year),
                f"{now.month:02d}",
                f"{now.day:02d}",
                student["name"],
            ]

            # 풀이 노트 원본을 드라이브에 저장 (채점 마킹 없이)
            central_uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, img_bytes
            )
            central_graded_urls.append(central_uploaded["url"])
            central_graded_ids.append(central_uploaded["id"])

            if teacher_token and teacher_token != central_token:
                try:
                    teacher_uploaded = upload_to_teacher_drive(
                        teacher_token, TEACHER_RESULT_FOLDER, sub_path, filename, img_bytes
                    )
                    teacher_graded_urls.append(teacher_uploaded["url"])
                    teacher_graded_ids.append(teacher_uploaded["id"])
                except Exception as e:
                    logger.warning(f"선생님 드라이브 풀이노트 전송 실패: {e}")
                    teacher_graded_urls.append(central_uploaded["url"])

            continue  # 채점 및 문항 데이터 저장 건너뜀

        # ── 정답지(answer_sheet) 페이지: 정상 채점 ──
        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        # 채점 실행 (중복 문제번호 건너뛰기 적용)
        grade_result = await grade_submission(
            img_bytes, answers_json, types_json,
            ocr_result=ocr_data,
            skip_questions=graded_questions if graded_questions else None,
        )

        # 채점된 문제번호 누적 (다음 이미지에서 중복 방지)
        newly_graded = grade_result.get("graded_questions", set())
        if newly_graded:
            graded_questions.update(newly_graded)
        skipped = grade_result.get("skipped_duplicates", [])
        if skipped:
            logger.info(f"[Dedup] 이미지 {idx+1}: 중복 {len(skipped)}개 건너뜀 → {skipped}")

        # 페이지 정보 수집 (등록된 교재 제목 우선, OCR 인식값 fallback)
        ak_title = answer_key.get("title", "")
        ocr_page = grade_result.get("textbook_info", {}).get("page", "")
        if ak_title:
            pi = ak_title
            if ocr_page:
                pi += f" p.{ocr_page}"
            page_info_parts.append(pi)
        elif grade_result.get("page_info"):
            page_info_parts.append(grade_result["page_info"])

        # 채점 이미지 생성
        graded_img = create_graded_image(
            img_bytes, grade_result["items"],
            grade_result["total_score"], grade_result["max_score"]
        )

        now = datetime.now()
        now_str = now.strftime('%Y%m%d_%H%M')
        filename = f"{student['name']}_{now_str}_{idx+1}.jpg"
        sub_path = [
            str(now.year),
            f"{now.month:02d}",
            f"{now.day:02d}",
            student["name"],
        ]

        # 1) 중앙 드라이브에 채점 결과 저장
        central_uploaded = upload_to_central(
            central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, graded_img
        )
        central_graded_urls.append(central_uploaded["url"])
        central_graded_ids.append(central_uploaded["id"])

        # 2) 선생님 드라이브에 채점 결과 전송 (중앙과 다른 계정일 때만)
        if teacher_token and teacher_token != central_token:
            try:
                teacher_uploaded = upload_to_teacher_drive(
                    teacher_token, TEACHER_RESULT_FOLDER, sub_path, filename, graded_img
                )
                teacher_graded_urls.append(teacher_uploaded["url"])
                teacher_graded_ids.append(teacher_uploaded["id"])
            except Exception as e:
                logger.warning(f"선생님 드라이브 전송 실패: {e}")
                teacher_graded_urls.append(central_uploaded["url"])

        # 문항별 데이터 (DB 컬럼에 맞는 필드만 전달)
        db_fields = {
            "result_id", "question_number", "question_label", "question_type",
            "student_answer", "correct_answer", "is_correct",
            "confidence", "ocr1_answer", "ocr2_answer",
            "ai_score", "ai_max_score", "ai_feedback",
            "position_x", "position_y",
        }
        for item in grade_result["items"]:
            item["result_id"] = result_id
            db_item = {k: v for k, v in item.items() if k in db_fields}
            all_items.append(db_item)

        total_correct += grade_result["correct_count"]
        total_wrong += grade_result["wrong_count"]
        total_uncertain += grade_result["uncertain_count"]
        total_unanswered += grade_result.get("unanswered_count", 0)
        total_questions += grade_result["total_questions"]
        total_score += grade_result["total_score"]
        max_score += grade_result["max_score"]

    # 문항별 DB 저장
    _update_progress(result_id, "saving", total_images, total_images, "결과 저장 중...")
    if all_items:
        await create_grading_items(all_items)

    # 결과 업데이트
    combined_page_info = " / ".join(page_info_parts) if page_info_parts else ""
    status = "confirmed" if total_uncertain == 0 else "review_needed"
    await update_grading_result(result_id, {
        "answer_key_id": answer_key_id,
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "unanswered_count": total_unanswered,
        "total_questions": total_questions,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "status": status,
        "page_info": combined_page_info,
        "central_graded_drive_ids": central_graded_ids,
        "central_graded_image_urls": central_graded_urls,
        "teacher_graded_drive_ids": teacher_graded_ids,
        "teacher_graded_image_urls": teacher_graded_urls if teacher_graded_urls else central_graded_urls,
    })

    # 숙제 제출 상태 업데이트
    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "graded")

    # ── 채점 완료 알림 ──
    try:
        student_name = student.get("name", "학생")
        score_text = f"{round(total_score, 1)}/{round(max_score, 1)}점" if max_score > 0 else ""
        notif_message = f"{student_name} 숙제 채점 완료"
        if combined_page_info:
            notif_message += f" ({combined_page_info})"
        if score_text:
            notif_message += f" - {score_text}"
        if status == "review_needed":
            notif_message += " [검토 필요]"

        await create_notification({
            "teacher_id": teacher_id,
            "type": "grading_complete",
            "title": "채점 완료",
            "message": notif_message,
            "data": {"result_id": result_id, "student_id": student_id, "status": status},
            "read": False,
        })
    except Exception as notif_err:
        logger.warning(f"채점 완료 알림 생성 실패 (무시): {notif_err}")

    # 진행률 완료 표시
    _update_progress(result_id, "done", total_images, total_images, "채점 완료")

    return {
        "result_id": result_id,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "uncertain_count": total_uncertain,
        "unanswered_count": total_unanswered,
        "total_questions": total_questions,
        "status": status,
        "page_info": combined_page_info,
        "graded_images": teacher_graded_urls if teacher_graded_urls else central_graded_urls,
    }


# ============================================================
# 채점 결과 조회/수정 (추가 엔드포인트)
# ============================================================

@app.get("/api/results/student/{student_id}")
async def list_student_results(student_id: int):
    results = await get_grading_results_by_student(student_id)
    return {"data": results}


@app.post("/api/results/{result_id}/regrade")
async def regrade_result(result_id: int):
    """기존 채점 결과를 정답지 기준으로 재채점 (OCR 결과는 유지, 정답 비교만 다시 수행)"""
    try:
        sb = get_supabase()

        # 기존 결과 조회
        res = sb.table("grading_results").select("*").eq("id", result_id).limit(1).execute()
        if not res.data:
            raise HTTPException(404, "채점 결과를 찾을 수 없습니다")
        result = res.data[0]

        answer_key_id = result.get("answer_key_id")
        if not answer_key_id:
            raise HTTPException(400, "정답지가 연결되지 않은 결과입니다")

        # 최신 정답지 조회
        answer_key = await get_answer_key(answer_key_id)
        if not answer_key:
            raise HTTPException(404, "정답지를 찾을 수 없습니다")

        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        # 기존 문항 조회
        items_res = sb.table("grading_items").select("*").eq("result_id", result_id).order("question_number").execute()
        old_items = items_res.data or []

        if not old_items:
            raise HTTPException(400, "재채점할 문항이 없습니다")

        # 상태를 grading으로 변경
        await update_grading_result(result_id, {"status": "regrading"})

        correct = 0
        wrong = 0
        uncertain = 0
        unanswered = 0
        regraded_count = 0

        from grading.grader import compare_answers

        # 서술형 배점 합계 + MC/단답형 문항 수 사전 집계
        essay_total = 0.0
        essay_earned = 0.0
        mc_questions = 0
        for item in old_items:
            q_label = item.get("question_label") or str(item.get("question_number", ""))
            q_type = types_json.get(q_label, item.get("question_type", "mc"))
            if q_type == "essay":
                ai_max = float(item.get("ai_max_score") or 10)
                essay_total += ai_max
            else:
                mc_questions += 1

        mc_per_score = (100 - essay_total) / mc_questions if mc_questions > 0 else 0

        for item in old_items:
            q_label = item.get("question_label") or str(item.get("question_number", ""))
            student_answer = item.get("student_answer", "")
            correct_answer = answers_json.get(q_label, item.get("correct_answer", ""))
            q_type = types_json.get(q_label, item.get("question_type", "mc"))

            update_data = {"correct_answer": correct_answer}
            is_unanswered = student_answer == "(미풀이)" or not student_answer

            if q_type in ("mc", "short"):
                if is_unanswered:
                    update_data["is_correct"] = None
                    update_data["student_answer"] = "(미풀이)" if not student_answer else student_answer
                    unanswered += 1
                else:
                    match_result = compare_answers(student_answer, correct_answer, q_type)
                    if match_result == "correct":
                        update_data["is_correct"] = True
                        correct += 1
                    elif match_result == "wrong":
                        update_data["is_correct"] = False
                        wrong += 1
                    else:
                        update_data["is_correct"] = None
                        uncertain += 1

            elif q_type == "essay":
                ai_score = float(item.get("ai_score") or 0)
                ai_max = float(item.get("ai_max_score") or 10)
                essay_earned += ai_score

            sb.table("grading_items").update(update_data).eq("id", item["id"]).execute()
            regraded_count += 1

        mc_earned = correct * mc_per_score
        total_score = round(mc_earned + essay_earned, 1)

        status = "confirmed" if uncertain == 0 else "review_needed"
        await update_grading_result(result_id, {
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_questions": len(old_items),
            "total_score": total_score,
            "max_score": 100.0,
            "status": status,
        })

        logger.info(f"[Regrade] result #{result_id}: {regraded_count}문항 재채점 완료 "
                     f"→ {correct}맞/{wrong}틀/{uncertain}보류/{unanswered}미풀이")

        return {
            "result_id": result_id,
            "regraded_count": regraded_count,
            "correct_count": correct,
            "wrong_count": wrong,
            "uncertain_count": uncertain,
            "unanswered_count": unanswered,
            "total_score": total_score,
            "max_score": 100.0,
            "status": status,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Regrade] result #{result_id} 재채점 실패: {e}", exc_info=True)
        raise HTTPException(500, f"재채점 실패: {str(e)[:200]}")


# ============================================================
# 알림 API
# ============================================================

@app.get("/api/notifications")
async def list_notifications(teacher_id: str, unread_only: bool = False):
    """알림 목록 조회"""
    notifications = await get_notifications(teacher_id, unread_only=unread_only)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    return {"data": notifications, "unread_count": unread_count}


@app.put("/api/notifications/read")
async def read_notifications(request: Request):
    """알림 읽음 처리"""
    try:
        body = await request.json()
        teacher_id = body.get("teacher_id", "")
        notification_ids = body.get("notification_ids")
        if not teacher_id:
            raise HTTPException(400, "teacher_id가 필요합니다")
        await mark_notifications_read(teacher_id, notification_ids)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"알림 읽음 처리 실패: {e}")
        return {"success": False}


# ============================================================
# 종합평가
# ============================================================

@app.post("/api/evaluations/generate")
async def trigger_evaluation(teacher_id: str = Form(...)):
    await run_monthly_evaluation()
    return {"status": "ok"}


@app.put("/api/evaluations/{eval_id}/approve")
async def approve_evaluation(eval_id: int):
    sb = get_supabase()
    sb.table("evaluations").update({"approved": True}).eq("id", eval_id).execute()
    return {"status": "approved"}


# ============================================================
# 자동 정리 (중앙 드라이브 원본 삭제)
# ============================================================

@app.post("/api/cleanup/originals")
async def cleanup_originals(result_id: int = Form(...)):
    """원본 사진 삭제 (중앙 드라이브에서)"""
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")

    sb = get_supabase()
    res = sb.table("grading_results").select("central_original_drive_ids").eq("id", result_id).limit(1).execute()
    row = res.data[0] if res.data and len(res.data) > 0 else None
    if row and row.get("central_original_drive_ids"):
        deleted = cleanup_old_originals(central_token, row["central_original_drive_ids"])
        await update_grading_result(result_id, {"central_original_drive_ids": []})
        return {"deleted": deleted}
    return {"deleted": 0}


@app.post("/api/cleanup/student")
async def cleanup_student_data(
    student_id: int = Form(...),
    delete_files: bool = Form(False),
):
    """학생 삭제 시 자료 정리 (중앙 + 선생님 드라이브)"""
    sb = get_supabase()

    if delete_files:
        central_token = await get_central_admin_token()

        results = sb.table("grading_results").select(
            "central_original_drive_ids, central_graded_drive_ids, teacher_graded_drive_ids, teacher_id"
        ).eq("student_id", student_id).execute()

        total_deleted = 0
        for r in (results.data or []):
            # 중앙 드라이브 파일 삭제
            if central_token:
                for fid in (r.get("central_original_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1
                for fid in (r.get("central_graded_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1

            # 선생님 드라이브 파일 삭제
            teacher_token = await get_teacher_drive_token(r.get("teacher_id", ""))
            if teacher_token:
                for fid in (r.get("teacher_graded_drive_ids") or []):
                    if delete_file(teacher_token, fid):
                        total_deleted += 1

        logger.info(f"학생 {student_id} 드라이브 파일 {total_deleted}개 삭제")

    sb.table("grading_results").delete().eq("student_id", student_id).execute()

    return {"status": "cleaned", "student_id": student_id}


# ============================================================
# 유틸리티
# ============================================================

def _extract_images_from_zip(zip_bytes: bytes) -> list[bytes]:
    """ZIP에서 이미지 파일 추출"""
    images = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in sorted(zf.namelist()):
                lower = name.lower()
                if lower.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")):
                    images.append(zf.read(name))
    except Exception as e:
        logger.error(f"ZIP 압축 해제 실패: {e}")
    return images


# ============================================================
# 서버 시작
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
