"""기타 API 라우터 (teachers, notifications, evaluations, cleanup, payment helper)"""
import logging
import json
import re
import asyncio
from datetime import datetime

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile, File

from integrations.supabase_client import (
    get_supabase, run_query, get_central_admin_token, update_grading_result,
    create_notification, get_notifications, mark_notifications_read,
)
from integrations.drive import cleanup_old_originals, delete_file, upload_to_central
from scheduler.monthly_eval import run_monthly_evaluation
from config import GEMINI_API_KEY, GEMINI_MODEL, AI_API_TIMEOUT

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover
    genai = None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["misc"])


def _extract_json_from_ai_text(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
            raw = parts[1]
            if raw.startswith("json"):
                raw = raw[4:]
    raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _to_int(value, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return int(value)
    cleaned = re.sub(r"[^\d-]", "", str(value))
    if cleaned in ("", "-"):
        return default
    try:
        return int(cleaned)
    except Exception:
        return default


def _normalize_payment_extract(payload: dict, source_type: str) -> dict:
    channel = str(payload.get("channel") or "").strip()
    method = str(payload.get("method") or "").strip()
    if not channel:
        channel = {
            "결제선생 화면": "결제선생",
            "비즐 화면": "비즐",
            "이체내역": "통장",
        }.get(source_type, "통장")
    if not method:
        method = {
            "결제선생": "카드",
            "비즐": "카드",
            "통장": "계좌이체",
        }.get(channel, "계좌이체")

    review_notes = payload.get("review_notes") or []
    if isinstance(review_notes, str):
        review_notes = [review_notes]
    if not isinstance(review_notes, list):
        review_notes = []

    return {
        "student_name": str(payload.get("student_name") or "").strip(),
        "month_key": str(payload.get("month_key") or "").strip(),
        "due_amount": max(0, _to_int(payload.get("due_amount"), 0)),
        "paid_amount": max(0, _to_int(payload.get("paid_amount"), 0)),
        "paid_at": str(payload.get("paid_at") or "").strip(),
        "channel": channel,
        "method": method,
        "reference_id": str(payload.get("reference_id") or "").strip(),
        "note": str(payload.get("note") or "").strip(),
        "unmatched_deposit": bool(payload.get("unmatched_deposit", False)),
        "confidence": max(0, min(100, _to_int(payload.get("confidence"), 0))),
        "review_notes": [str(x).strip() for x in review_notes if str(x).strip()],
    }


def _safe_drive_part(value: str, fallback: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    safe = re.sub(r"[\\/:*?\"<>|]+", "-", raw)
    safe = re.sub(r"\s+", " ", safe).strip(". ")
    return safe or fallback


def _pick_upload_date(month_hint: str) -> tuple[str, str, str]:
    now = datetime.now()
    year = f"{now.year:04d}"
    month = f"{now.month:02d}"
    day = f"{now.day:02d}"
    month_hint = str(month_hint or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})$", month_hint)
    if m:
        year = m.group(1)
        month = m.group(2)
    return year, month, day


def _build_evidence_filename(original_name: str, source_type: str) -> str:
    now = datetime.now()
    ts = now.strftime("%H%M%S")
    base_name = _safe_drive_part(source_type or "기타", "기타")
    ext = ""
    if "." in (original_name or ""):
        ext = "." + (original_name.rsplit(".", 1)[-1] or "").strip().lower()
        if not re.match(r"^\.[a-z0-9]{1,8}$", ext):
            ext = ""
    if not ext:
        ext = ".jpg"
    return f"{ts}_{base_name}{ext}"


async def _upload_payment_evidence_to_drive(
    owner_folder: str,
    month_hint: str,
    source_type: str,
    image: UploadFile,
    image_bytes: bytes,
) -> dict:
    central_token = await get_central_admin_token()
    if not central_token:
        return {"saved": False, "reason": "중앙 Drive 토큰이 설정되지 않았습니다."}

    year, month, day = _pick_upload_date(month_hint)
    item = _safe_drive_part(source_type or "기타", "기타")
    filename = _build_evidence_filename(image.filename or "", source_type or "기타")
    mime = image.content_type or "image/jpeg"

    try:
        uploaded = upload_to_central(
            central_token=central_token,
            folder_name="수납증빙",
            sub_path=[owner_folder, year, month, day, item],
            filename=filename,
            image_bytes=image_bytes,
            mime_type=mime,
        )
        return {
            "saved": True,
            "file_id": uploaded.get("id", ""),
            "url": uploaded.get("url", ""),
            "path": f"수납증빙/{owner_folder}/{year}/{month}/{day}/{item}/{filename}",
            "folder_path": f"수납증빙/{owner_folder}/{year}/{month}/{day}/{item}",
            "filename": filename,
        }
    except Exception as e:
        logger.warning(f"[payments.extract] Drive 업로드 실패: {e}")
        return {"saved": False, "reason": f"Drive 업로드 실패: {str(e)[:180]}"}


async def _resolve_owner_folder_name(request: Request) -> str:
    owner_id = ""
    try:
        user = getattr(request.state, "user", None) or {}
        owner_id = str(user.get("sub") or "").strip()
    except Exception:
        owner_id = ""
    if not owner_id:
        return "owner-unknown"

    safe_owner = _safe_drive_part(owner_id, "owner-unknown")
    academy_label = ""
    try:
        sb = get_supabase()
        res = await run_query(
            sb.table("teachers").select("*").eq("owner_user_id", owner_id).limit(1).execute
        )
        row = (res.data or [{}])[0] if res.data else {}
        academy_label = str(
            row.get("academy_name")
            or row.get("academy")
            or row.get("name")
            or ""
        ).strip()
    except Exception as e:
        logger.warning(f"[payments.extract] owner 폴더명 조회 실패: {e}")

    if academy_label:
        return _safe_drive_part(f"{academy_label}__{safe_owner}", safe_owner)
    return safe_owner


@router.post("/payments/extract")
async def extract_payment_from_image(
    request: Request,
    image: UploadFile = File(...),
    source_type: str = Form("기타"),
    student_hint: str = Form(""),
    month_hint: str = Form(""),
    extract_mode: str = Form("single"),
    save_to_drive: str = Form("1"),
):
    if not image:
        raise HTTPException(status_code=400, detail="이미지 파일이 필요합니다.")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="이미지 파일만 업로드할 수 있습니다.")
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY가 설정되지 않았습니다.")
    if genai is None:
        raise HTTPException(status_code=503, detail="Gemini SDK를 사용할 수 없습니다.")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="파일 크기는 10MB 이하만 지원합니다.")

    mode = (extract_mode or "single").strip().lower()
    if mode not in {"single", "multi"}:
        mode = "single"
    save_drive_enabled = str(save_to_drive or "1").strip().lower() not in {"0", "false", "no", "off"}
    drive_meta = {"saved": False, "reason": "저장 비활성"}
    if save_drive_enabled:
        owner_folder = await _resolve_owner_folder_name(request)
        drive_meta = await _upload_payment_evidence_to_drive(
            owner_folder=owner_folder,
            month_hint=month_hint,
            source_type=source_type,
            image=image,
            image_bytes=image_bytes,
        )

    if mode == "multi":
        response_format = """{
  "drafts": [
    {
      "student_name": "문자열 또는 빈값",
      "month_key": "YYYY-MM 또는 빈값",
      "due_amount": 0,
      "paid_amount": 0,
      "paid_at": "YYYY-MM-DD 또는 빈값",
      "channel": "결제선생|비즐|통장|기타",
      "method": "카드|동백전|계좌이체|현금|기타",
      "reference_id": "승인번호/거래참조ID/이체식별값",
      "note": "짧은 메모",
      "unmatched_deposit": false,
      "confidence": 0,
      "review_notes": ["검토 필요 사항 1", "검토 필요 사항 2"]
    }
  ]
}"""
        mode_rule = "- 이미지에 결제내역이 여러 건 있으면 drafts 배열에 여러 항목으로 분리하세요."
    else:
        response_format = """{
  "student_name": "문자열 또는 빈값",
  "month_key": "YYYY-MM 또는 빈값",
  "due_amount": 0,
  "paid_amount": 0,
  "paid_at": "YYYY-MM-DD 또는 빈값",
  "channel": "결제선생|비즐|통장|기타",
  "method": "카드|동백전|계좌이체|현금|기타",
  "reference_id": "승인번호/거래참조ID/이체식별값",
  "note": "짧은 메모",
  "unmatched_deposit": false,
  "confidence": 0,
  "review_notes": ["검토 필요 사항 1", "검토 필요 사항 2"]
}"""
        mode_rule = "- 단건 모드이므로 가장 신뢰도 높은 1건만 반환하세요."

    prompt = f"""당신은 학원 수납 원장 입력 보조 도우미입니다.
업로드된 결제 증빙 이미지(스크린샷/영수증/이체내역)에서 수납 원장 초안을 추출하세요.

입력 힌트:
- source_type: {source_type}
- student_hint: {student_hint}
- month_hint: {month_hint}
- extract_mode: {mode}

반드시 아래 JSON 형식으로만 답하세요:
{response_format}

규칙:
- 확실하지 않으면 추측하지 말고 빈값 또는 0으로 두고 review_notes에 이유를 남기세요.
- 원장에서 최종확정은 사람이 하므로, 과신하지 말고 보수적으로 추출하세요.
{mode_rule}
"""
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)
        image_part = {"mime_type": image.content_type, "data": image_bytes}
        response = await asyncio.to_thread(
            model.generate_content,
            [prompt, image_part],
            request_options={"timeout": AI_API_TIMEOUT},
        )
        text = (response.text or "").strip()
        parsed = _extract_json_from_ai_text(text)
        if not parsed:
            raise HTTPException(status_code=502, detail="AI 응답을 JSON으로 해석하지 못했습니다.")
        drafts_raw = []
        if isinstance(parsed, dict) and isinstance(parsed.get("drafts"), list):
            drafts_raw = [x for x in parsed.get("drafts", []) if isinstance(x, dict)]
        elif isinstance(parsed, dict):
            drafts_raw = [parsed]
        else:
            drafts_raw = []

        if not drafts_raw:
            raise HTTPException(status_code=502, detail="AI 응답에서 추출 결과를 찾지 못했습니다.")

        drafts = [_normalize_payment_extract(item, source_type) for item in drafts_raw]
        draft = drafts[0] if drafts else None
        return {
            "draft": draft,
            "drafts": drafts,
            "extract_mode": mode,
            "source_type": source_type,
            "filename": image.filename,
            "drive_saved": bool(drive_meta.get("saved")),
            "drive_file_id": drive_meta.get("file_id", ""),
            "drive_url": drive_meta.get("url", ""),
            "drive_path": drive_meta.get("path", ""),
            "drive_folder_path": drive_meta.get("folder_path", ""),
            "drive_reason": drive_meta.get("reason", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"결제 증빙 AI 추출 실패: {e}")
        raise HTTPException(status_code=500, detail=f"결제 증빙 AI 추출 실패: {str(e)[:200]}")


@router.get("/teachers")
async def list_teachers():
    try:
        sb = get_supabase()
        res = await run_query(sb.table("teachers").select("*").order("created_at").execute)
        return {"data": res.data or []}
    except Exception as e:
        logger.error(f"선생님 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=f"선생님 목록 조회 실패: {str(e)[:200]}")


@router.get("/notifications")
async def list_notifications(teacher_id: str, unread_only: bool = False):
    notifications = await get_notifications(teacher_id, unread_only=unread_only)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    return {"data": notifications, "unread_count": unread_count}


@router.put("/notifications/read")
async def read_notifications(request: Request):
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
        raise HTTPException(status_code=500, detail=f"알림 읽음 처리 실패: {str(e)[:200]}")


@router.post("/evaluations/generate")
async def trigger_evaluation(teacher_id: str = Form(...)):
    await run_monthly_evaluation()
    return {"status": "ok"}


@router.put("/evaluations/{eval_id}/approve")
async def approve_evaluation(eval_id: int):
    sb = get_supabase()
    await run_query(sb.table("evaluations").update({"approved": True}).eq("id", eval_id).execute)
    return {"status": "approved"}


@router.post("/cleanup/originals")
async def cleanup_originals(result_id: int = Form(...)):
    central_token = await get_central_admin_token()
    if not central_token:
        raise HTTPException(400, "중앙 관리 드라이브가 연결되지 않았습니다")
    sb = get_supabase()
    res = await run_query(sb.table("grading_results").select("central_original_drive_ids").eq("id", result_id).limit(1).execute)
    row = res.data[0] if res.data and len(res.data) > 0 else None
    if row and row.get("central_original_drive_ids"):
        deleted = cleanup_old_originals(central_token, row["central_original_drive_ids"])
        await update_grading_result(result_id, {"central_original_drive_ids": []})
        return {"deleted": deleted}
    return {"deleted": 0}


@router.post("/cleanup/student")
async def cleanup_student_data(
    student_id: int = Form(...),
    delete_files: bool = Form(False),
):
    sb = get_supabase()
    if delete_files:
        central_token = await get_central_admin_token()
        results = await run_query(sb.table("grading_results").select(
            "central_original_drive_ids, central_graded_drive_ids"
        ).eq("student_id", student_id).execute)
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
    await run_query(sb.table("grading_results").delete().eq("student_id", student_id).execute)
    return {"status": "cleaned", "student_id": student_id}
