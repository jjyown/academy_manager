"""교재/정답 관리 라우터"""
import base64
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from config import CENTRAL_GRADING_MATERIAL_FOLDER
from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token,
    get_answer_keys_by_teacher, upsert_answer_key, add_student_book,
)
from integrations.drive import (
    download_file_central, upload_page_images_to_central,
    search_answer_pdfs_central, delete_page_images_folder,
    upload_homework_material_pdf, upload_book_pdf_to_central,
)
from grading.pdf_parser import extract_answers_from_pdf
from grading.hml_parser import extract_answers_from_hml, build_hml_answer_preview_images
from file_utils import parse_page_range

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/answer-keys", tags=["answer-keys"])


@router.get("")
async def list_answer_keys(teacher_id: str):
    keys = await get_answer_keys_by_teacher(teacher_id)
    return {"data": keys}


@router.put("/{key_id}")
async def update_answer_key(key_id: int, request: Request):
    try:
        body = await request.json()
        sb = get_supabase()

        existing = await run_query(sb.table("answer_keys").select("*").eq("id", key_id).limit(1).execute)
        if not existing.data:
            raise HTTPException(404, "교재를 찾을 수 없습니다")
        old_key = existing.data[0]

        # 소유권 검증 — 본 라우터는 SUPABASE_SERVICE_KEY 로 RLS 를 우회하므로
        # 애플리케이션 레벨에서 반드시 teacher_id 일치를 확인해야 한다.
        # JWT 미들웨어가 활성화된 경우 request.state.user.sub 를 신뢰.
        # 미설정(개발용)이면 body.teacher_id 를 폴백으로 허용.
        user = getattr(request.state, "user", None)
        caller_id = (user or {}).get("sub") if isinstance(user, dict) else None
        if not caller_id:
            caller_id = (body.get("teacher_id") or "").strip() or None
        if caller_id and old_key.get("teacher_id") and old_key["teacher_id"] != caller_id:
            logger.warning(
                f"[AnswerKey] 소유권 위반 시도: caller={caller_id} key#{key_id} owner={old_key.get('teacher_id')}"
            )
            raise HTTPException(403, "이 교재를 수정할 권한이 없습니다")

        update_data = {}

        if "title" in body:
            update_data["title"] = body["title"]
        if "subject" in body:
            update_data["subject"] = body["subject"]
        if "answers_json" in body:
            update_data["answers_json"] = body["answers_json"]
            update_data["total_questions"] = len(body["answers_json"])
        if "update_answers" in body:
            merged = dict(old_key.get("answers_json") or {})
            merged.update(body["update_answers"])
            update_data["answers_json"] = merged
            update_data["total_questions"] = len(merged)
        if "question_types_json" in body:
            update_data["question_types_json"] = body["question_types_json"]
        if "update_types" in body:
            merged_types = dict(old_key.get("question_types_json") or {})
            merged_types.update(body["update_types"])
            update_data["question_types_json"] = merged_types
        if "bookmarks_json" in body:
            update_data["bookmarks_json"] = body["bookmarks_json"]
        if "regions_json" in body:
            update_data["regions_json"] = body["regions_json"]
        if "grade_level" in body:
            update_data["grade_level"] = body["grade_level"]
        if "solution_source" in body:
            # 외부 해설 시스템(highroad-math-solution) 매핑(jsonb). 비우려면 null 명시.
            ss = body["solution_source"]
            if ss in (None, ""):
                update_data["solution_source"] = None
            elif isinstance(ss, dict):
                update_data["solution_source"] = ss
            # 기타 타입은 무시 — 잘못된 입력으로 컬럼을 깨뜨리지 않음

        if not update_data:
            return {"success": False, "message": "수정할 내용이 없습니다"}

        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = await run_query(sb.table("answer_keys").update(update_data).eq("id", key_id).execute)
        logger.info(f"[AnswerKey] #{key_id} 수정: {list(update_data.keys())}")
        return {"success": True, "data": res.data[0] if res.data else {}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"정답지 수정 실패 (id={key_id}): {e}")
        raise HTTPException(500, f"정답지 수정 실패: {str(e)[:200]}")


@router.delete("/{key_id}")
async def delete_answer_key(key_id: int, teacher_id: str, request: Request):
    # JWT 가 있으면 sub 로 강제 일치 — 쿼리 파라미터를 신뢰하지 않는다.
    # JWT 미설정 환경에서는 쿼리 폴백 허용(기존 동작 유지).
    user = getattr(request.state, "user", None)
    caller_id = (user or {}).get("sub") if isinstance(user, dict) else None
    if caller_id and caller_id != teacher_id:
        logger.warning(
            f"[AnswerKey] 삭제 소유권 위반 시도: caller={caller_id} 가 teacher_id={teacher_id} 로 위장"
        )
        raise HTTPException(403, "이 교재를 삭제할 권한이 없습니다")

    sb = get_supabase()
    record = await run_query(sb.table("answer_keys").select("id, title, page_images_json").eq(
        "id", key_id
    ).eq("teacher_id", teacher_id).limit(1).execute)

    if not record.data:
        return {"success": False, "message": "삭제할 교재를 찾을 수 없습니다"}

    key_data = record.data[0]
    title = key_data.get("title", "")
    await run_query(sb.table("answer_keys").delete().eq("id", key_id).execute)

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


@router.post("/parse")
async def parse_answer_key(
    teacher_id: str = Form(...),
    title: str = Form(...),
    subject: str = Form(""),
    grade_level: str = Form(""),
    drive_file_id: str = Form(""),
    pdf_file: UploadFile = File(None),
    answer_page_range: str = Form(""),
    total_hint: int = Form(None),
    source_type: str = Form(""),
):
    """교재/시험지 등록 + 파싱.

    source_type:
      - ''(빈값) | 'book' | 'custom' | 'manual' : 기존 동작 (정답 자동 추출 시도)
      - 'exam' : 시험지 모드 — PDF 파싱 skip, 페이지 이미지만 생성. parsed=False 로 마킹.
                  정답은 [+ 문제 추가] 또는 외부 해설(solution_source) 매핑으로 보강.

    parsed 의미 강화:
      - exam 모드: 항상 False
      - 자동 추출 모드: total_questions > 0 일 때만 True (0건이면 False)
        → UI 가 "✅ 파싱완료 / ⚠️ 정답 미추출" 을 정확히 구분할 수 있음.
    """
    grade_level = (grade_level or "").strip()
    source_type_norm = (source_type or "").strip().lower()
    is_exam_mode = source_type_norm == "exam"
    file_bytes = None
    file_ext = ""
    central_token = await get_central_admin_token()

    if pdf_file:
        file_bytes = await pdf_file.read()
        fname = (pdf_file.filename or "").lower()
        # HML(HWPML) 계열은 파일 확장자만 다르게 올라오는 경우가 있어 유연하게 판별
        # - 일반: .hml
        # - 운영/사용자 편의: .hwp 로도 올라오는 케이스 대응
        file_ext = "hml" if (fname.endswith(".hml") or fname.endswith(".hwp")) else "pdf"
    elif drive_file_id and central_token:
        file_bytes = download_file_central(central_token, drive_file_id)
        file_ext = "pdf"
    else:
        raise HTTPException(400, "PDF 또는 HML 파일이 필요합니다")

    raw_page_images = []
    if is_exam_mode:
        # 시험지 모드 — 정답 추출은 건너뛰고 페이지 이미지만 생성.
        # HML 도 동일하게 답 추출 skip (시험지·모의고사는 보통 PDF 형식).
        from grading.pdf_parser import _pdf_to_thumbnails  # noqa: WPS433
        logger.info(f"[Parse-Exam] '{title}' 시험지 모드 — 정답 추출 skip, 페이지 이미지만 생성")
        try:
            raw_page_images = _pdf_to_thumbnails(file_bytes) if file_ext == "pdf" else []
        except Exception as e:
            logger.warning(f"[Parse-Exam] 페이지 썸네일 생성 실패: {e}")
            raw_page_images = []
        result = {"answers": {}, "types": {}, "total": 0}
    elif file_ext == "hml":
        logger.info(f"[Parse] HML 파일 파싱: '{title}'")
        result = await extract_answers_from_hml(file_bytes)
        raw_page_images = build_hml_answer_preview_images(title, result)
        logger.info(
            f"[Parse] HML '{title}' raw_page_images 생성: {len(raw_page_images)} "
            f"(answers={len((result.get('answers') or {}))}, types={len((result.get('types') or {}))})"
        )
    else:
        page_range = None
        if answer_page_range.strip():
            page_range = parse_page_range(answer_page_range.strip())
        result = await extract_answers_from_pdf(file_bytes, total_hint=total_hint, page_range=page_range)
        raw_page_images = result.pop("page_images", [])

    # 원본 PDF 도 학년 폴더에 보존 — 향후 재파싱·검수 시 재업로드 불필요.
    # 페이지 이미지와 같은 폴더(숙제 관리/교재/{grade}/{title}/)에 {title}.pdf 로 저장.
    # 학년이 화이트리스트(중1~고3) 안에 있을 때만 시도 (그 외엔 페이지 이미지만 보존).
    pdf_drive_meta = None
    if pdf_file and file_ext == "pdf" and central_token and grade_level:
        from config import CENTRAL_GRADE_LEVEL_FOLDERS  # noqa: WPS433
        if grade_level in CENTRAL_GRADE_LEVEL_FOLDERS:
            try:
                pdf_drive_meta = upload_book_pdf_to_central(
                    central_token, grade_level, title, file_bytes,
                )
                logger.info(
                    f"[Parse] '{title}' PDF 원본 Drive 업로드: "
                    f"grade={grade_level} file_id={pdf_drive_meta.get('id')}"
                )
            except Exception as e:
                logger.warning(f"[Parse] PDF 원본 Drive 업로드 실패(파싱·페이지 이미지는 계속): {e}")

    page_images_json = []
    if raw_page_images:
        if central_token:
            try:
                page_images_json = upload_page_images_to_central(
                    central_token,
                    title,
                    raw_page_images,
                    grade_level=grade_level or None,
                )
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

    total_q = int(result.get("total", 0) or 0)
    # parsed = True 의 의미: "자동 추출에 성공해 정답이 들어있음".
    # 시험지 모드는 항상 False, 자동 모드는 total>0 일 때만 True.
    parsed_flag = (not is_exam_mode) and total_q > 0

    # drive_file_id: 폼에서 받은 값 우선, 없으면 방금 업로드한 PDF id
    effective_drive_file_id = drive_file_id or (pdf_drive_meta.get("id") if pdf_drive_meta else "")

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "grade_level": grade_level or "",
        "drive_file_id": effective_drive_file_id,
        "total_questions": total_q,
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "page_images_json": page_images_json,
        "parsed": parsed_flag,
    }
    if source_type_norm in ("book", "custom", "manual", "exam"):
        key_data["source_type"] = source_type_norm

    saved = await upsert_answer_key(key_data)

    if is_exam_mode:
        warning_msg = None
        mode_label = "시험지 모드 — 정답 추출 skip, 페이지 이미지만 생성"
    elif total_q == 0:
        warning_msg = (
            "PDF에서 정답을 자동 추출하지 못했습니다. "
            "이 PDF에 정답·해설 페이지가 없다면 [교재 유형 → 시험지]로 다시 등록하거나, "
            "상세 페이지에서 [+ 문제 추가] 또는 [해설지 매핑]으로 정답을 보강하세요."
        )
        mode_label = f"자동 추출 모드(파서: {'HML' if file_ext == 'hml' else 'PDF'}) — 추출 실패"
    else:
        warning_msg = None
        mode_label = f"자동 추출 모드(파서: {'HML' if file_ext == 'hml' else 'PDF'}) — {total_q}문제 추출"

    logger.info(
        f"[Parse] '{title}' 저장 완료 — {mode_label}, 페이지 이미지 {len(page_images_json)}장, "
        f"parsed={parsed_flag}, source_type={source_type_norm or '(미지정)'}"
    )
    return {
        "data": saved,
        "parsed_result": result,
        "mode": "exam" if is_exam_mode else "auto",
        "warning": warning_msg,
    }


@router.get("/drive-diagnose")
async def drive_diagnose():
    """Drive 인증·연결 상태 진단 — 실패 원인을 정확히 식별.

    체크 순서:
      1) 중앙 관리자 토큰 DB 조회 (teachers.is_central_admin=true, google_drive_connected=true)
      2) Google OAuth refresh → access token 교환 (가장 자주 실패하는 지점)
      3) Drive API 호출(권한·스코프 확인)
      4) "숙제 관리" 루트 폴더 접근

    각 단계의 성공·실패와 에러 메시지를 반환해 운영자가 어디서 끊겼는지 즉시 파악.
    """
    import traceback
    from config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

    # client_id 의 앞 12자만 노출 — 프론트(supabase-config.js)와 비교용
    # (전체 client_id 는 public OK 이지만 secret 은 절대 노출 X)
    cid_prefix = GOOGLE_CLIENT_ID[:12] + "..." if GOOGLE_CLIENT_ID else None
    cid_len = len(GOOGLE_CLIENT_ID) if GOOGLE_CLIENT_ID else 0
    secret_len = len(GOOGLE_CLIENT_SECRET) if GOOGLE_CLIENT_SECRET else 0

    result = {
        "step_1_token_in_db": None,
        "step_2_oauth_refresh": None,
        "step_3_drive_api": None,
        "step_4_root_folder": None,
        "config_check": {
            "google_client_id_present": bool(GOOGLE_CLIENT_ID),
            "google_client_id_prefix": cid_prefix,  # 프론트 값과 비교
            "google_client_id_length": cid_len,
            "google_client_secret_present": bool(GOOGLE_CLIENT_SECRET),
            "google_client_secret_length": secret_len,
        },
        "errors": [],
    }

    # Step 1: DB 토큰 확인
    try:
        token = await get_central_admin_token()
        if not token:
            result["step_1_token_in_db"] = False
            result["errors"].append("중앙 관리자 refresh token 이 DB 에 없음 (teachers.is_central_admin=true & google_drive_connected=true 조건 확인)")
            return result
        result["step_1_token_in_db"] = True
    except Exception as e:
        result["step_1_token_in_db"] = False
        result["errors"].append(f"DB 토큰 조회 실패: {e}")
        return result

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        result["step_2_oauth_refresh"] = False
        result["errors"].append("Railway env 에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 가 비어 있음 — 환경변수 확인 필요")
        return result

    # Step 2: OAuth refresh → access token
    try:
        import requests
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        if resp.status_code != 200:
            result["step_2_oauth_refresh"] = False
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text[:300]}
            result["errors"].append(
                f"OAuth refresh 실패 (HTTP {resp.status_code}): {body}"
            )
            return result
        access_token = resp.json().get("access_token")
        if not access_token:
            result["step_2_oauth_refresh"] = False
            result["errors"].append("OAuth 응답에 access_token 없음")
            return result
        result["step_2_oauth_refresh"] = True
    except Exception as e:
        result["step_2_oauth_refresh"] = False
        result["errors"].append(f"OAuth refresh 요청 예외: {e}")
        return result

    # Step 3: Drive API about 호출 (권한·스코프)
    try:
        import requests
        resp = requests.get(
            "https://www.googleapis.com/drive/v3/about?fields=user,storageQuota",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            result["step_3_drive_api"] = False
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text[:300]}
            result["errors"].append(
                f"Drive API about 실패 (HTTP {resp.status_code}): {body}"
            )
            return result
        about = resp.json()
        result["step_3_drive_api"] = True
        result["drive_user_email"] = (about.get("user") or {}).get("emailAddress")
    except Exception as e:
        result["step_3_drive_api"] = False
        result["errors"].append(f"Drive API 예외: {e}")
        return result

    # Step 4: 숙제 관리 루트 폴더 접근
    try:
        from integrations.drive import _build_service, resolve_central_root_folder_id
        service = _build_service(token)
        root_id = resolve_central_root_folder_id(service)
        result["step_4_root_folder"] = bool(root_id)
        result["root_folder_id"] = root_id
        if not root_id:
            result["errors"].append("중앙 루트 폴더('숙제 관리') 를 찾거나 생성할 수 없음")
    except Exception as e:
        result["step_4_root_folder"] = False
        result["errors"].append(f"루트 폴더 접근 예외: {e}\n{traceback.format_exc()[:500]}")

    return result


@router.get("/vision-diagnose/{key_id}")
async def vision_diagnose(key_id: int):
    """특정 answer_key 의 PDF 마지막 페이지에 Gemini Vision 직접 호출 → 원본 응답 그대로 반환.

    배경: per-page Vision 보강이 0건 반환하는 경우, 코드의 어디서 끊기는지 확인 불가.
    이 엔드포인트가 Vision 호출 자체와 응답을 그대로 보여줘서 진짜 원인 식별.

    체크 항목:
      - Drive 에서 PDF 다운로드 성공 여부
      - PDF → 이미지 변환 성공
      - Gemini API 호출 성공·실패
      - 응답 텍스트 원문 (앞 2000자)
      - JSON 파싱 가능 여부
    """
    import base64
    import traceback
    from config import GEMINI_API_KEY, GEMINI_MODEL
    from grading.pdf_parser import _pdf_to_images, _get_total_pages
    from ocr.engines import _robust_json_parse

    result = {
        "key_id": key_id,
        "step_db_lookup": None,
        "step_drive_download": None,
        "step_pdf_to_image": None,
        "step_gemini_call": None,
        "step_json_parse": None,
        "gemini_model": GEMINI_MODEL,
        "errors": [],
    }

    # 1) DB row 조회
    try:
        sb = get_supabase()
        row_res = await run_query(
            sb.table("answer_keys").select("drive_file_id, title").eq("id", key_id).limit(1).execute
        )
        if not row_res.data:
            result["errors"].append(f"row id={key_id} not found")
            return result
        row = row_res.data[0]
        drive_file_id = (row.get("drive_file_id") or "").strip()
        title = row.get("title")
        result["step_db_lookup"] = True
        result["title"] = title
        result["drive_file_id"] = drive_file_id
        if not drive_file_id:
            result["errors"].append("drive_file_id 비어있음 — Drive 저장 안 된 row")
            return result
    except Exception as e:
        result["step_db_lookup"] = False
        result["errors"].append(f"DB 조회 예외: {e}")
        return result

    # 2) Drive 다운로드
    try:
        central_token = await get_central_admin_token()
        if not central_token:
            result["step_drive_download"] = False
            result["errors"].append("Drive admin token 없음")
            return result
        pdf_bytes = download_file_central(central_token, drive_file_id)
        if not pdf_bytes:
            result["step_drive_download"] = False
            result["errors"].append("Drive 다운로드 결과 비어있음")
            return result
        result["step_drive_download"] = True
        result["pdf_size_kb"] = len(pdf_bytes) // 1024
    except Exception as e:
        result["step_drive_download"] = False
        result["errors"].append(f"Drive 다운로드 예외: {e}")
        return result

    # 3) PDF → 마지막 페이지 이미지
    try:
        total_pages = _get_total_pages(pdf_bytes)
        result["total_pages"] = total_pages
        last_page_idx = max(0, total_pages - 1)
        images = _pdf_to_images(pdf_bytes, page_indices=[last_page_idx])
        if not images:
            result["step_pdf_to_image"] = False
            result["errors"].append("이미지 변환 결과 비어있음")
            return result
        result["step_pdf_to_image"] = True
        result["page_used"] = last_page_idx + 1
        result["image_size_kb"] = len(images[0]) // 1024
    except Exception as e:
        result["step_pdf_to_image"] = False
        result["errors"].append(f"이미지 변환 예외: {e}\n{traceback.format_exc()[:500]}")
        return result

    # 4) Gemini Vision 호출
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = """이 이미지에서 "N) [정답] X" 패턴을 모두 찾아 JSON 으로 반환하세요.

예시:
- "1) [정답] ②"            → {"num": "1", "ans": "②", "type": "mc"}
- "17) [정답] a=3, b=7, c=1" → {"num": "17", "ans": "a=3, b=7, c=1", "type": "short"}
- "18) [정답] 45, 75"       → {"num": "18", "ans": "45, 75", "type": "short"}

JSON 만 출력 (다른 텍스트 X):
{"items": [{"num": "1", "ans": "②", "type": "mc"}, ...]}"""

        b64 = base64.b64encode(images[0]).decode("utf-8")
        parts = [prompt, {"mime_type": "image/jpeg", "data": b64}]

        response = model.generate_content(parts)
        raw_text = (response.text or "").strip()
        result["step_gemini_call"] = True
        result["gemini_response_raw"] = raw_text[:2000]
        result["gemini_response_length"] = len(raw_text)
    except Exception as e:
        result["step_gemini_call"] = False
        result["errors"].append(f"Gemini 호출 예외: {e}\n{traceback.format_exc()[:1500]}")
        return result

    # 5) JSON 파싱
    try:
        parsed = _robust_json_parse(raw_text)
        result["step_json_parse"] = parsed is not None
        if parsed:
            items = parsed.get("items") if isinstance(parsed, dict) else None
            result["parsed_items_count"] = len(items) if isinstance(items, list) else None
            result["parsed_sample"] = items[:5] if isinstance(items, list) else None
    except Exception as e:
        result["step_json_parse"] = False
        result["errors"].append(f"JSON 파싱 예외: {e}")

    return result


@router.get("/drive-pdfs")
async def list_drive_pdfs():
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    pdfs = search_answer_pdfs_central(central_token, CENTRAL_GRADING_MATERIAL_FOLDER)
    return {"data": pdfs}


@router.post("/upload-custom-material")
async def upload_custom_material(
    teacher_id: str = Form(...),
    title: str = Form(...),
    subject: str = Form(""),
    grade_level: str = Form(""),
    year: int = Form(...),
    month: int = Form(...),
    day: int = Form(...),
    pdf_file: UploadFile = File(...),
    answer_page_range: str = Form(""),
    total_hint: int = Form(None),
):
    """자체제작 숙제 PDF 업로드 → 파싱 → answer_keys 등록(source_type='custom').

    Drive 저장 경로:
        숙제 관리 / 학생들에게 나간숙제 자료 / {year}년 / {month}월 / {day}일 / {YYYY-MM-DD-title}.pdf

    페이지 이미지는 시중교재와 동일하게 "숙제 관리/교재/{grade_level}/{title}/" 에 저장 —
    자동채점 파이프라인이 시중/자체제작을 구분 없이 동일 풀에서 처리하도록 일관성 유지.

    선행: 마이그레이션 0037(answer_keys.source_type + custom_material_uploaded_at) 적용 필요.
    """
    if not (1 <= month <= 12):
        raise HTTPException(400, "month 는 1~12 사이여야 합니다")
    if not (1 <= day <= 31):
        raise HTTPException(400, "day 는 1~31 사이여야 합니다")
    if year < 2000 or year > 2100:
        raise HTTPException(400, "year 가 유효하지 않습니다")

    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(503, "중앙 관리 드라이브가 연결되지 않았습니다")

    file_bytes = await pdf_file.read()
    if not file_bytes:
        raise HTTPException(400, "빈 PDF 입니다")

    drive_meta = upload_homework_material_pdf(
        central_token, year, month, day, title, file_bytes,
    )
    logger.info(
        f"[CustomMaterial] '{title}' Drive 업로드 완료: file={drive_meta['filename']} id={drive_meta['id']}"
    )

    page_range = None
    if answer_page_range.strip():
        page_range = parse_page_range(answer_page_range.strip())
    result = await extract_answers_from_pdf(file_bytes, total_hint=total_hint, page_range=page_range)
    raw_page_images = result.pop("page_images", [])

    page_images_json: list[dict] = []
    if raw_page_images:
        try:
            page_images_json = upload_page_images_to_central(
                central_token, title, raw_page_images,
                grade_level=(grade_level or "").strip() or None,
            )
        except Exception as e:
            logger.warning(f"[CustomMaterial] 페이지 이미지 Drive 업로드 실패, base64 fallback: {e}")
            page_images_json = []
        if not page_images_json:
            for img in raw_page_images:
                b64 = base64.b64encode(img["image_bytes"]).decode("utf-8")
                page_images_json.append({
                    "page": img["page"],
                    "url": f"data:image/jpeg;base64,{b64}",
                })

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "grade_level": (grade_level or "").strip(),
        "drive_file_id": drive_meta["id"],
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "page_images_json": page_images_json,
        "parsed": True,
        "source_type": "custom",
        "custom_material_uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    saved = await upsert_answer_key(key_data)
    logger.info(
        f"[CustomMaterial] '{title}' answer_keys 저장 완료 "
        f"(정답 {result.get('total', 0)}문제, 페이지 이미지 {len(page_images_json)}장, "
        f"drive_file_id={drive_meta['id']})"
    )

    return {
        "data": saved,
        "parsed_result": result,
        "drive": {
            "file_id": drive_meta["id"],
            "filename": drive_meta["filename"],
            "url": drive_meta.get("web_url") or drive_meta.get("url"),
        },
    }


@router.post("/upload-for-student")
async def upload_for_student(
    student_id: int = Form(...),
    teacher_id: str = Form(...),
    pdf_file: UploadFile = File(...),
    title: str = Form(""),
    subject: str = Form(""),
    answer_page_range: str = Form(""),
    total_hint: int = Form(None),
):
    """학생 카드 드래그&드롭 진입점.

    동작 (시중교재 풀 등록 효율화):
      1) 학생의 grade(예: '고1') 자동 조회 → 학년 폴더 결정
      2) title 미지정 시 PDF 파일명에서 자동 추출
      3) 같은 (teacher_id, title) 의 answer_keys 가 이미 있으면 재파싱·재업로드 건너뛰고
         student_books 연결만 수행(다른 학생도 같은 교재 풀에 합류) — idempotent
      4) 신규일 때만 PDF 원본·페이지 이미지 Drive 업로드 + 파싱 + answer_keys 등록
      5) student_books 자동 연결

    Drive 저장 경로:
        숙제 관리 / 교재 / {학년} / {title} /
          ├─ {title}.pdf         (재파싱·검수용 원본)
          └─ page_001.jpg ~      (자동채점 매칭용)
    """
    sb = get_supabase()

    student_row_res = await run_query(
        sb.table("students").select("id, name, grade, owner_user_id")
          .eq("id", student_id).limit(1).execute
    )
    if not student_row_res.data:
        raise HTTPException(404, "학생을 찾을 수 없습니다")
    student_row = student_row_res.data[0]
    grade = (student_row.get("grade") or "").strip()
    if not grade:
        raise HTTPException(400, "학생 학년(grade) 정보가 없습니다 — 학생 프로필을 먼저 갱신하세요")

    if not title.strip():
        raw_name = (pdf_file.filename or "").strip()
        if raw_name:
            base = raw_name.rsplit(".", 1)[0]
            title = base.strip() or f"{student_row.get('name','학생')}_숙제"
        else:
            title = f"{student_row.get('name','학생')}_숙제"
    title = title.strip()

    # 1) 동일 (teacher_id, title) 이미 있으면 student_books 연결만 — 재업로드/재파싱 회피
    existing_res = await run_query(
        sb.table("answer_keys").select("id, title, grade_level, parsed, drive_file_id")
          .eq("teacher_id", teacher_id).eq("title", title).limit(1).execute
    )
    if existing_res.data:
        ak = existing_res.data[0]
        try:
            await add_student_book(student_id, ak["id"], teacher_id)
        except Exception as e:
            logger.warning(f"[UploadForStudent] student_books 연결 실패(reuse): {e}")
        logger.info(
            f"[UploadForStudent] 기존 answer_keys 재사용: title='{title}' key#{ak['id']} → student#{student_id} 연결"
        )
        return {
            "data": ak,
            "reused": True,
            "student": {"id": student_id, "name": student_row.get("name"), "grade": grade},
        }

    file_bytes = await pdf_file.read()
    if not file_bytes:
        raise HTTPException(400, "빈 PDF 입니다")

    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(503, "중앙 관리 드라이브가 연결되지 않았습니다")

    # 2) PDF 원본 업로드 → 교재/{학년}/{title}/{title}.pdf
    try:
        pdf_meta = upload_book_pdf_to_central(central_token, grade, title, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    logger.info(
        f"[UploadForStudent] PDF Drive 업로드: grade={grade} title='{title}' file_id={pdf_meta['id']}"
    )

    # 3) 정답 파싱
    page_range = None
    if answer_page_range.strip():
        page_range = parse_page_range(answer_page_range.strip())
    result = await extract_answers_from_pdf(file_bytes, total_hint=total_hint, page_range=page_range)
    raw_page_images = result.pop("page_images", [])

    # 4) 페이지 이미지 → 같은 폴더 (page_NNN.jpg)
    page_images_json: list[dict] = []
    if raw_page_images:
        try:
            page_images_json = upload_page_images_to_central(
                central_token, title, raw_page_images, grade_level=grade,
            )
        except Exception as e:
            logger.warning(f"[UploadForStudent] 페이지 이미지 Drive 업로드 실패, base64 fallback: {e}")
            page_images_json = []
        if not page_images_json:
            for img in raw_page_images:
                b64 = base64.b64encode(img["image_bytes"]).decode("utf-8")
                page_images_json.append({
                    "page": img["page"],
                    "url": f"data:image/jpeg;base64,{b64}",
                })

    # 5) answer_keys 등록 (source_type='book')
    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "grade_level": grade,
        "drive_file_id": pdf_meta["id"],
        "total_questions": result.get("total", 0),
        "answers_json": result.get("answers", {}),
        "question_types_json": result.get("types", {}),
        "page_images_json": page_images_json,
        "parsed": True,
        "source_type": "book",
    }
    saved = await upsert_answer_key(key_data)

    # 6) student_books 연결
    if saved and saved.get("id"):
        try:
            await add_student_book(student_id, saved["id"], teacher_id)
        except Exception as e:
            logger.warning(f"[UploadForStudent] student_books 연결 실패(new): {e}")
    logger.info(
        f"[UploadForStudent] 신규 등록 완료: title='{title}' grade={grade} "
        f"문제수={result.get('total',0)} 페이지={len(page_images_json)} → student#{student_id}"
    )

    return {
        "data": saved,
        "reused": False,
        "parsed_result": result,
        "drive": {
            "file_id": pdf_meta["id"],
            "filename": pdf_meta["filename"],
            "url": pdf_meta.get("web_url") or pdf_meta.get("url"),
        },
        "student": {"id": student_id, "name": student_row.get("name"), "grade": grade},
    }
