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

    key_data = {
        "teacher_id": teacher_id,
        "title": title,
        "subject": subject,
        "grade_level": grade_level or "",
        "drive_file_id": drive_file_id,
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
