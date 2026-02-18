"""자동 채점 서버 - FastAPI
전체 흐름:
1. 학생이 숙제 제출 → 중앙 드라이브(jjyown@gmail.com)에 저장
2. Edge Function이 채점 서버에 비동기 트리거
3. 채점 서버가 ZIP 다운로드 → OCR → 배정된 교재로 채점
4. 채점 결과 이미지를 중앙 드라이브에 저장
5. 선생님이 채점 관리 페이지에서 검토/다운로드
"""
import logging
import base64
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
    CORS_ORIGINS, RATE_LIMIT_PER_MINUTE
)
from ocr.engines import ocr_gpt4o_batch, cross_validate_ocr
from ocr.preprocessor import preprocess_batch
from grading.grader import grade_submission
from grading.image_marker import create_graded_image
from grading.pdf_parser import extract_answers_from_pdf
from grading.hml_parser import extract_answers_from_hml
from integrations.supabase_client import (
    get_central_admin_token,
    get_answer_key, get_answer_keys_by_teacher, upsert_answer_key,
    get_assignment, get_assignments_by_teacher, create_assignment, delete_assignment,
    get_student_assigned_key,
    get_student_books, get_student_books_by_teacher, add_student_book, remove_student_book, get_student_book_keys,
    create_grading_result, update_grading_result,
    get_grading_results_by_teacher, get_grading_results_by_student,
    create_grading_items, get_grading_items, update_grading_item,
    get_student, get_teacher, get_teacher_by_id,
    get_pending_submissions, update_submission_grading_status,
    get_supabase,
    create_notification, get_notifications, mark_notifications_read,
)
from integrations.drive import (
    download_file_central, upload_to_central, upload_page_images_to_central,
    search_answer_pdfs_central, cleanup_old_originals, delete_file,
    delete_page_images_folder,
)
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

        # 북마크 수정
        if "bookmarks_json" in body:
            update_data["bookmarks_json"] = body["bookmarks_json"]

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
    """교재 삭제 (DB + Drive 페이지 이미지 폴더)"""
    sb = get_supabase()

    # 삭제 전 레코드 조회 (Drive 폴더명 = title)
    record = sb.table("answer_keys").select("id, title, page_images_json").eq(
        "id", key_id
    ).eq("teacher_id", teacher_id).limit(1).execute()

    if not record.data:
        return {"success": False, "message": "삭제할 교재를 찾을 수 없습니다"}

    key_data = record.data[0]
    title = key_data.get("title", "")

    # DB 삭제
    sb.table("answer_keys").delete().eq("id", key_id).execute()

    # Drive 폴더 삭제 (비동기 실패해도 DB 삭제는 유지)
    drive_deleted = False
    if title:
        central_token = await get_central_admin_token()
        if central_token:
            drive_deleted = delete_page_images_folder(central_token, title)
            if drive_deleted:
                logger.info(f"[Delete] 교재 '{title}' Drive 폴더 삭제 완료")
            else:
                logger.warning(f"[Delete] 교재 '{title}' Drive 폴더 없거나 삭제 실패")

    return {
        "success": True,
        "message": f"교재가 삭제되었습니다" + (" (Drive 폴더도 삭제됨)" if drive_deleted else ""),
    }




@app.post("/api/answer-keys/parse")
async def parse_answer_key(
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
    페이지 이미지는 base64 data URL로 DB에 직접 저장
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

    page_images_json = []
    if raw_page_images:
        if central_token:
            try:
                page_images_json = upload_page_images_to_central(central_token, title, raw_page_images)
                logger.info(f"[Parse] '{title}' 페이지 이미지 {len(page_images_json)}장 Drive 업로드 완료")
            except Exception as e:
                logger.warning(f"[Parse] Drive 업로드 실패, base64 fallback: {e}")
                page_images_json = []

        if not page_images_json:
            for img in raw_page_images:
                b64 = base64.b64encode(img["image_bytes"]).decode("utf-8")
                page_images_json.append({
                    "page": img["page"],
                    "url": f"data:image/jpeg;base64,{b64}",
                })
            logger.info(f"[Parse] '{title}' 페이지 이미지 {len(page_images_json)}장 base64 fallback 저장")

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "drive_file_id": drive_file_id,
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "page_images_json": page_images_json,
        "parsed": True,
    }
    saved = await upsert_answer_key(key_data)
    logger.info(f"[Parse] '{title}' 정답 {result.get('total', 0)}문제 저장 완료 "
                 f"(파서: {'HML' if file_ext == 'hml' else 'PDF'}, "
                 f"페이지 이미지: {len(page_images_json)}장)")

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
    assigned_students: str = Form("[]"),
):
    try:
        students = json.loads(assigned_students)
    except Exception:
        students = []
    data = {
        "teacher_id": teacher_id,
        "title": title,
        "answer_key_id": answer_key_id,
        "page_range": page_range,
        "due_date": due_date,
        "mode": mode,
        "assigned_students": students,
    }
    result = await create_assignment(data)
    return {"data": result}


@app.delete("/api/assignments/{assignment_id}")
async def delete_assignment_endpoint(assignment_id: int):
    ok = await delete_assignment(assignment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다")
    return {"ok": True}


# ============================================================
# 학생-교재 관리 API
# ============================================================

@app.get("/api/student-books")
async def list_student_books(teacher_id: str):
    data = await get_student_books_by_teacher(teacher_id)
    return {"data": data}


@app.get("/api/student-books/{student_id}")
async def list_books_for_student(student_id: int):
    data = await get_student_books(student_id)
    return {"data": data}


@app.post("/api/student-books")
async def add_student_book_endpoint(
    student_id: int = Form(...),
    answer_key_id: int = Form(...),
    teacher_id: str = Form(...),
):
    result = await add_student_book(student_id, answer_key_id, teacher_id)
    return {"data": result}


@app.delete("/api/student-books/{book_id}")
async def remove_student_book_endpoint(book_id: int):
    ok = await remove_student_book(book_id)
    if not ok:
        raise HTTPException(status_code=404, detail="해당 교재 연결을 찾을 수 없습니다")
    return {"ok": True}


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
        res = sb.table("grading_items").select("*").eq("result_id", result_id).order("question_number").execute()
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
    background_tasks: BackgroundTasks,
    student_id: int = Form(...),
    teacher_id: str = Form(...),
    assignment_id: int = Form(None),
    answer_key_id: int = Form(None),
    mode: str = Form("assigned"),
    homework_submission_id: int = Form(None),
    image: UploadFile = File(None),
    zip_drive_id: str = Form(""),
):
    """채점 실행 (비동기: 즉시 result_id 반환 후 백그라운드 채점)"""
    student = await get_student(student_id)
    if not student:
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    # 중복 채점 방지
    if homework_submission_id:
        sb = get_supabase()
        existing = sb.table("grading_results").select("id, status").eq(
            "homework_submission_id", homework_submission_id
        ).in_("status", ["grading", "confirmed", "review_needed"]).limit(1).execute()
        if existing.data:
            existing_result = existing.data[0]
            logger.info(f"[Dedup] submission #{homework_submission_id} 이미 채점됨 → result #{existing_result['id']}")
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

    # 정답 데이터 조회: answer_key_id → assignment → 학생 배정 교재
    answer_key = None
    if answer_key_id:
        answer_key = await get_answer_key(answer_key_id)
    elif assignment_id:
        assignment = await get_assignment(assignment_id)
        if assignment and assignment.get("answer_key_id"):
            answer_key = await get_answer_key(assignment["answer_key_id"])
            answer_key_id = assignment["answer_key_id"]
    if not answer_key:
        assigned = await get_student_assigned_key(student_id)
        if assigned:
            answer_key = assigned
            answer_key_id = assigned.get("id")
            logger.info(f"[Assign] 학생 #{student_id} 배정 교재 → #{answer_key_id} '{assigned.get('title','')}'")
    if not answer_key:
        book_keys = await get_student_book_keys(student_id)
        if book_keys:
            answer_key = book_keys[0]
            answer_key_id = answer_key.get("id")
            logger.info(f"[StudentBooks] 학생 #{student_id} 교재 목록에서 선택 → #{answer_key_id} '{answer_key.get('title','')}' (총 {len(book_keys)}개)")

    # 이미지 가져오기
    image_bytes_list = []
    if image:
        img_data = await image.read()
        if image.filename and image.filename.endswith(".zip"):
            image_bytes_list = _extract_images_from_zip(img_data)
        else:
            image_bytes_list = [img_data]
    elif zip_drive_id:
        zip_data = download_file_central(central_token, zip_drive_id)
        logger.info(f"[Grade] Drive ZIP 다운로드 완료: {len(zip_data)} bytes")
        image_bytes_list = _extract_images_from_zip(zip_data)

    logger.info(f"[Grade] 추출된 이미지: {len(image_bytes_list)}장 "
                f"(크기: {[len(b)//1024 for b in image_bytes_list[:10]]}KB)")

    if not image_bytes_list:
        raise HTTPException(400, "채점할 이미지가 없습니다 (지원 형식: JPG, PNG, GIF, WEBP, BMP, HEIC, PDF)")

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

    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "grading")

    # 백그라운드에서 채점 실행 (즉시 응답 반환)
    background_tasks.add_task(
        _run_grading_background,
        result_id=result_id,
        student=student,
        student_id=student_id,
        teacher_id=teacher_id,
        central_token=central_token,
        answer_key=answer_key,
        answer_key_id=answer_key_id,
        image_bytes_list=image_bytes_list,
        mode=mode,
        homework_submission_id=homework_submission_id,
    )

    return {
        "result_id": result_id,
        "status": "grading",
        "message": "채점이 백그라운드에서 시작되었습니다",
    }


async def _run_grading_background(
    *,
    result_id: int,
    student: dict,
    student_id: int,
    teacher_id: str,
    central_token: str,
    answer_key: dict | None,
    answer_key_id: int | None,
    image_bytes_list: list[bytes],
    mode: str,
    homework_submission_id: int | None,
):
    """백그라운드 채점 래퍼: 실패 시 review_needed 상태로 전환"""
    try:
        await _execute_grading(
            result_id=result_id,
            student=student,
            student_id=student_id,
            teacher_id=teacher_id,
            central_token=central_token,
            answer_key=answer_key,
            answer_key_id=answer_key_id,
            image_bytes_list=image_bytes_list,
            mode=mode,
            homework_submission_id=homework_submission_id,
        )
    except Exception as e:
        logger.error(f"[FATAL] 채점 실패 (result #{result_id}): {e}", exc_info=True)
        _update_progress(result_id, "failed", 0, 0, f"채점 실패: {str(e)[:100]}")
        try:
            error_msg = str(e)[:500]
            await update_grading_result(result_id, {
                "status": "review_needed",
                "error_message": error_msg,
            })
            if homework_submission_id:
                await update_submission_grading_status(homework_submission_id, "grading_failed")

            student_name = student.get("name", "학생") if student else "학생"
            await create_notification({
                "teacher_id": teacher_id,
                "type": "grading_failed",
                "title": "채점 실패 - 확인 필요",
                "message": f"{student_name} 숙제 채점 실패: {str(e)[:100]}. 원본 파일을 확인해주세요.",
                "data": {"result_id": result_id, "student_id": student_id, "error": error_msg[:200]},
                "read": False,
            })
        except Exception as db_err:
            logger.error(f"[FATAL] 실패 상태 DB 업데이트도 실패: {db_err}")


async def _execute_grading(
    *,
    result_id: int,
    student: dict,
    student_id: int,
    teacher_id: str,
    central_token: str,
    answer_key: dict | None,
    answer_key_id: int | None,
    image_bytes_list: list[bytes],
    mode: str,
    homework_submission_id: int | None,
) -> dict:
    """채점 실행 본체 (백그라운드에서 호출)"""
    all_items = []
    central_graded_urls = []
    central_graded_ids = []
    total_correct = 0
    total_wrong = 0
    total_uncertain = 0
    total_questions = 0
    total_score = 0
    max_score = 0

    total_unanswered = 0
    page_info_parts = []

    total_images = len(image_bytes_list)

    # 배정 교재 없으면 review_needed 상태로 원본만 저장
    if not answer_key:
        logger.warning(f"배정된 교재 없음 (student: {student_id}) → 확인 요청 상태로 전환")

        now = datetime.now()
        now_str = now.strftime('%Y%m%d_%H%M')
        for idx, img_bytes in enumerate(image_bytes_list):
            filename = f"{student['name']}_{now_str}_{idx+1}_원본.jpg"
            sub_path = [str(now.year), f"{now.month:02d}", f"{now.day:02d}", student["name"]]
            uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, img_bytes
            )
            central_graded_urls.append(uploaded["url"])
            central_graded_ids.append(uploaded["id"])

        await update_grading_result(result_id, {
            "status": "review_needed",
            "error_message": "배정된 교재가 없습니다. 교재를 배정한 후 재채점해주세요.",
            "central_graded_drive_ids": central_graded_ids,
            "central_graded_image_urls": central_graded_urls,
        })
        if homework_submission_id:
            await update_submission_grading_status(homework_submission_id, "graded")

        await create_notification({
            "teacher_id": teacher_id,
            "type": "grading_review",
            "title": "확인 필요 - 교재 미배정",
            "message": f"{student.get('name', '학생')} 숙제: 배정된 교재가 없어 채점할 수 없습니다. 원본 파일을 확인해주세요.",
            "data": {"result_id": result_id, "student_id": student_id},
            "read": False,
        })
        _update_progress(result_id, "done", total_images, total_images, "확인 요청")
        return {"result_id": result_id, "status": "review_needed"}

    # 이미지 전처리
    _update_progress(result_id, "preprocess", 0, total_images, "이미지 전처리 중...")
    logger.info(f"[Preprocess] {total_images}장 이미지 전처리 시작")
    image_bytes_list = preprocess_batch(image_bytes_list)

    # 기대 문제번호 + 유형 힌트
    expected_questions = sorted(
        (answer_key.get("answers_json") or {}).keys(),
        key=lambda x: (int(re.match(r"(\d+)", x).group(1)) if re.match(r"(\d+)", x) else 9999)
    )
    question_types = answer_key.get("question_types_json") or None

    # GPT-4o 배치 OCR
    _update_progress(result_id, "ocr", 1, 4, f"GPT-4o OCR 처리 중 ({total_images}장)...")
    logger.info(f"[OCR] GPT-4o 배치 OCR 시작: {total_images}장"
                f"{f', 유형 힌트 {len(question_types)}문제' if question_types else ''}")
    gpt4o_results = await ocr_gpt4o_batch(
        image_bytes_list,
        expected_questions=expected_questions,
        question_types=question_types,
    )

    # 크로스 엔진 검증
    _update_progress(result_id, "cross_validate", 2, 4, "Gemini 크로스 검증 중...")
    ocr_results = await cross_validate_ocr(
        image_bytes_list, gpt4o_results,
        expected_questions=expected_questions,
        question_types=question_types,
    )

    _update_progress(result_id, "grading", 0, total_images, "채점 시작...")
    solution_only_count = 0
    graded_questions = set()

    for idx, img_bytes in enumerate(image_bytes_list):
        _update_progress(result_id, "grading", idx + 1, total_images,
                         f"이미지 {idx+1}/{total_images} 채점 중...")

        ocr_data = ocr_results[idx] if idx < len(ocr_results) else None
        is_solution_only = (ocr_data or {}).get("page_type") == "solution_only"
        ocr_answers = (ocr_data or {}).get("answers", {})
        logger.info(f"[Grade] 이미지 {idx+1}/{total_images}: page_type={ocr_data.get('page_type', '?') if ocr_data else 'None'}, "
                    f"인식문제={len(ocr_answers)}개, 문제번호={list(ocr_answers.keys())[:10]}")

        if is_solution_only:
            solution_only_count += 1
            logger.info(f"[Grade] 이미지 {idx+1}: 풀이 노트 → 원본 저장")
            page_info_parts.append(f"풀이노트 {solution_only_count}")

            now = datetime.now()
            now_str = now.strftime('%Y%m%d_%H%M')
            filename = f"{student['name']}_{now_str}_{idx+1}_풀이.jpg"
            sub_path = [str(now.year), f"{now.month:02d}", f"{now.day:02d}", student["name"]]
            central_uploaded = upload_to_central(
                central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, img_bytes
            )
            central_graded_urls.append(central_uploaded["url"])
            central_graded_ids.append(central_uploaded["id"])
            continue

        # 정상 채점
        answers_json = answer_key.get("answers_json", {})
        types_json = answer_key.get("question_types_json", {})

        grade_result = await grade_submission(
            img_bytes, answers_json, types_json,
            ocr_result=ocr_data,
            skip_questions=graded_questions if graded_questions else None,
        )

        newly_graded = grade_result.get("graded_questions", set())
        if newly_graded:
            graded_questions.update(newly_graded)

        ak_title = answer_key.get("title", "")
        ocr_page = grade_result.get("textbook_info", {}).get("page", "")
        if ak_title:
            pi = ak_title
            if ocr_page:
                pi += f" p.{ocr_page}"
            page_info_parts.append(pi)
        elif grade_result.get("page_info"):
            page_info_parts.append(grade_result["page_info"])

        graded_img = create_graded_image(
            img_bytes, grade_result["items"],
            grade_result["total_score"], grade_result["max_score"]
        )

        now = datetime.now()
        now_str = now.strftime('%Y%m%d_%H%M')
        filename = f"{student['name']}_{now_str}_{idx+1}.jpg"
        sub_path = [str(now.year), f"{now.month:02d}", f"{now.day:02d}", student["name"]]

        central_uploaded = upload_to_central(
            central_token, CENTRAL_GRADED_RESULT_FOLDER, sub_path, filename, graded_img
        )
        central_graded_urls.append(central_uploaded["url"])
        central_graded_ids.append(central_uploaded["id"])

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

    # DB 저장
    _update_progress(result_id, "saving", total_images, total_images, "결과 저장 중...")
    if all_items:
        await create_grading_items(all_items)

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
    })

    if homework_submission_id:
        await update_submission_grading_status(homework_submission_id, "graded")

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
        "graded_images": central_graded_urls,
    }


# ============================================================
# 채점 결과 조회/수정 (추가 엔드포인트)
# ============================================================

@app.get("/api/results/student/{student_id}")
async def list_student_results(student_id: int):
    results = await get_grading_results_by_student(student_id)
    return {"data": results}


@app.post("/api/results/{result_id}/regrade")
async def regrade_result(result_id: int, request: Request):
    """기존 채점 결과를 정답지 기준으로 재채점 (OCR 결과는 유지, 정답 비교만 다시 수행)
    
    body에 answer_key_id가 포함되면 교재를 변경한 후 재채점합니다.
    """
    try:
        body = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()

        sb = get_supabase()

        # 기존 결과 조회
        res = sb.table("grading_results").select("*").eq("id", result_id).limit(1).execute()
        if not res.data:
            raise HTTPException(404, "채점 결과를 찾을 수 없습니다")
        result = res.data[0]

        new_key_id = body.get("answer_key_id")
        if new_key_id:
            await update_grading_result(result_id, {"answer_key_id": new_key_id})
            answer_key_id = new_key_id
            logger.info(f"[Regrade] result #{result_id}: 교재 변경 → key #{new_key_id}")
        else:
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
    """학생 삭제 시 자료 정리 (중앙 드라이브)"""
    sb = get_supabase()

    if delete_files:
        central_token = await get_central_admin_token()

        results = sb.table("grading_results").select(
            "central_original_drive_ids, central_graded_drive_ids"
        ).eq("student_id", student_id).execute()

        total_deleted = 0
        for r in (results.data or []):
            if central_token:
                for fid in (r.get("central_original_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1
                for fid in (r.get("central_graded_drive_ids") or []):
                    if delete_file(central_token, fid):
                        total_deleted += 1

        logger.info(f"학생 {student_id} 드라이브 파일 {total_deleted}개 삭제")

    sb.table("grading_results").delete().eq("student_id", student_id).execute()

    return {"status": "cleaned", "student_id": student_id}


# ============================================================
# 유틸리티
# ============================================================

def _extract_images_from_zip(zip_bytes: bytes) -> list[bytes]:
    """ZIP에서 이미지/PDF/HEIC 파일 추출 → 모두 JPEG 바이트로 변환"""
    IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
    HEIC_EXTS = (".heic", ".heif")
    PDF_EXTS = (".pdf",)

    images: list[bytes] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            all_names = sorted(zf.namelist())
            logger.info(f"[ZIP] 파일 {len(all_names)}개 발견: {[n for n in all_names if not n.endswith('/')]}")

            for name in all_names:
                if name.endswith("/"):
                    continue
                lower = name.lower()

                if lower.endswith(IMAGE_EXTS):
                    images.append(zf.read(name))

                elif lower.endswith(HEIC_EXTS):
                    images.extend(_convert_heic_to_jpeg(zf.read(name), name))

                elif lower.endswith(PDF_EXTS):
                    images.extend(_convert_pdf_to_images(zf.read(name), name))

                else:
                    logger.warning(f"[ZIP] 지원되지 않는 파일 형식 건너뜀: {name}")

    except Exception as e:
        logger.error(f"ZIP 압축 해제 실패: {e}")

    logger.info(f"[ZIP] 최종 추출 이미지: {len(images)}장")
    return images


def _convert_heic_to_jpeg(heic_bytes: bytes, filename: str) -> list[bytes]:
    """HEIC/HEIF → JPEG 변환"""
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
        from PIL import Image
        img = Image.open(io.BytesIO(heic_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        logger.info(f"[ZIP] HEIC 변환 성공: {filename}")
        return [buf.getvalue()]
    except ImportError:
        logger.error(f"[ZIP] pillow-heif 미설치 → HEIC 파일 건너뜀: {filename}")
        return []
    except Exception as e:
        logger.error(f"[ZIP] HEIC 변환 실패 ({filename}): {e}")
        return []


def _convert_pdf_to_images(pdf_bytes: bytes, filename: str) -> list[bytes]:
    """PDF → 페이지별 JPEG 이미지 변환 (PyMuPDF 사용)"""
    result = []
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        logger.info(f"[ZIP] PDF 변환 시작: {filename} ({len(doc)}페이지)")
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=200)
            img_bytes = pix.tobytes("jpeg")
            result.append(img_bytes)
        doc.close()
        logger.info(f"[ZIP] PDF 변환 완료: {filename} → {len(result)}장 이미지")
    except Exception as e:
        logger.error(f"[ZIP] PDF 변환 실패 ({filename}): {e}")
    return result


# ============================================================
# 서버 시작
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
