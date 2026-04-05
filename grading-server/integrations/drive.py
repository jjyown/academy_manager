"""Google Drive 연동: 중앙 드라이브(jjyown@gmail.com) 전용"""
import io
import logging
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from config import (
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    CENTRAL_ROOT_FOLDER,
    CENTRAL_ROOT_FOLDER_LEGACY_ALIASES,
    CENTRAL_GRADING_MATERIAL_FOLDER,
    CENTRAL_GRADED_RESULT_FOLDER,
    CENTRAL_INSTANT_GRADE_FOLDER,
    CENTRAL_SUBMIT_FOLDER,
    CENTRAL_PAGE_IMAGES_FOLDER,
    CENTRAL_GRADE_LEVEL_FOLDERS,
)

logger = logging.getLogger(__name__)


def _build_service(refresh_token: str):
    """Google Drive API 서비스 생성"""
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
    )
    return build("drive", "v3", credentials=creds)


def _find_or_create_folder(service, name: str, parent_id: str | None = None) -> str:
    """폴더를 찾거나 없으면 생성"""
    safe_name = name.replace("'", "\\'")
    query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        query += f" and '{parent_id}' in parents"

    results = service.files().list(q=query, fields="files(id,name)", pageSize=1).execute()
    files = results.get("files", [])

    if files:
        return files[0]["id"]

    metadata = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        metadata["parents"] = [parent_id]
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def _find_folder_only(service, name: str, parent_id: str | None) -> str | None:
    """폴더만 검색(없으면 None, 생성하지 않음)."""
    safe_name = name.replace("'", "\\'")
    query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        query += f" and '{parent_id}' in parents"
    results = service.files().list(q=query, fields="files(id)", pageSize=1).execute()
    files = results.get("files", [])
    return files[0]["id"] if files else None


def _find_folder_in_my_drive_root(service, name: str) -> str | None:
    """내 드라이브 최상위에만 있는 폴더 조회(동명 폴더가 하위 경로에 있어도 무시)."""
    safe_name = name.replace("'", "\\'")
    query = (
        f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' "
        f"and 'root' in parents and trashed=false"
    )
    results = service.files().list(q=query, fields="files(id,name)", pageSize=1).execute()
    files = results.get("files", [])
    return files[0]["id"] if files else None


def resolve_central_root_folder_id(service) -> str:
    """중앙 숙제 루트(항상 '숙제 관리' 우선).

    문제: Railway `.env`에 `CENTRAL_ROOT_FOLDER=과제 관리`가 남아있으면,
    Edge(upload-homework)는 '숙제 관리'에 업로드하지만 grading-server는 '과제 관리'에
    채점/교재 페이지 이미지 폴더를 만들어서 루트가 2개로 보일 수 있음.

    대응:
    - 신규 생성/검색은 항상 '숙제 관리'를 최우선으로 사용
    - '숙제 관리'가 없으면 '과제 관리'(레거시/환경값) 재사용 없이 '숙제 관리'를 새로 생성
    """
    preferred = "숙제 관리"

    fid = _find_folder_in_my_drive_root(service, preferred)
    if fid:
        logger.info("[Drive] 중앙 루트 '%s' 기존 사용 (%s)", preferred, fid)
        return fid

    # 둘 다 없으면 '숙제 관리'를 새로 생성
    metadata = {
        "name": preferred,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": ["root"],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    logger.info("[Drive] 중앙 루트 '%s' 생성 (%s)", preferred, folder["id"])
    return folder["id"]


def _ensure_homework_structure_with_service(service) -> str:
    """숙제 관리 루트 및 고정 하위 폴더(교재/학년, 제출 원본, 채점 결과)를 생성하고 루트 폴더 ID를 반환."""
    root_id = resolve_central_root_folder_id(service)
    material_id = _find_or_create_folder(service, CENTRAL_GRADING_MATERIAL_FOLDER, root_id)
    for grade_name in CENTRAL_GRADE_LEVEL_FOLDERS:
        _find_or_create_folder(service, grade_name, material_id)
    _find_or_create_folder(service, CENTRAL_SUBMIT_FOLDER, root_id)
    _find_or_create_folder(service, CENTRAL_GRADED_RESULT_FOLDER, root_id)
    _find_or_create_folder(service, CENTRAL_INSTANT_GRADE_FOLDER, root_id)
    return root_id


def ensure_homework_management_structure(central_token: str) -> str:
    """토큰만 있을 때 구조 보장(단일 서비스 인스턴스)."""
    service = _build_service(central_token)
    return _ensure_homework_structure_with_service(service)


# ──────────────────────────────────────────────
# 중앙 드라이브(jjyown) 전용 함수
# ──────────────────────────────────────────────

def get_central_grading_material_folder(central_token: str, folder_name: str) -> str:
    """중앙 드라이브에서 교재 폴더 ID 반환: {CENTRAL_ROOT_FOLDER} / {folder_name}"""
    service = _build_service(central_token)
    root = resolve_central_root_folder_id(service)
    return _find_or_create_folder(service, folder_name, root)


def search_answer_pdfs_central(central_token: str, material_folder_name: str) -> list[dict]:
    """중앙 드라이브의 교재 폴더에서 PDF 검색: {CENTRAL_ROOT_FOLDER} / {material_folder_name} (하위 학년 폴더 포함 재귀)"""
    service = _build_service(central_token)
    root = resolve_central_root_folder_id(service)
    folder_id = _find_or_create_folder(service, material_folder_name, root)

    all_pdfs = []
    _search_pdfs_recursive(service, folder_id, "", all_pdfs)
    return all_pdfs


def download_file_central(central_token: str, file_id: str, retries: int = 2) -> bytes:
    """중앙 드라이브에서 파일 다운로드 (재시도 포함)"""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            service = _build_service(central_token)
            request = service.files().get_media(fileId=file_id)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buffer.getvalue()
        except Exception as e:
            last_err = e
            logger.warning(f"[Drive] 다운로드 실패 (시도 {attempt}/{retries}, file={file_id}): {e}")
            if attempt < retries:
                import time
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"드라이브 파일 다운로드 실패 ({file_id}): {last_err}")


def upload_to_central(central_token: str, folder_name: str, sub_path: list[str],
                      filename: str, image_bytes: bytes, mime_type: str = "image/jpeg",
                      retries: int = 2) -> dict:
    """중앙 드라이브에 업로드: {CENTRAL_ROOT_FOLDER} / {folder_name} / {sub_path...} / {filename}"""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            service = _build_service(central_token)
            root = _ensure_homework_structure_with_service(service)
            parent = _find_or_create_folder(service, folder_name, root)
            for folder in sub_path:
                parent = _find_or_create_folder(service, folder, parent)
            return _upload_file(service, parent, filename, image_bytes, mime_type)
        except Exception as e:
            last_err = e
            logger.warning(f"[Drive] 업로드 실패 (시도 {attempt}/{retries}, file={filename}): {e}")
            if attempt < retries:
                import time
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"드라이브 업로드 실패 ({filename}): {last_err}")


def upload_page_images_to_central(
    central_token: str,
    title: str,
    page_images: list[dict],
    grade_level: str | None = None,
    root_folder_name: str | None = None,
) -> list[dict]:
    """교재(정답키) 페이지 이미지 업로드

    사용자 기대(학년 폴더):
    - 숙제 관리 / 교재 / {grade_level(고3 등)} / {title} / page_XXX.jpg

    grade_level이 없거나 목록에 없으면 레거시 폴백:
    - 숙제 관리 / 교재 / {CENTRAL_PAGE_IMAGES_FOLDER} / {title} / page_XXX.jpg
    """
    service = _build_service(central_token)
    _ensure_homework_structure_with_service(service)

    central_root = resolve_central_root_folder_id(service)
    material_root = _find_or_create_folder(service, CENTRAL_GRADING_MATERIAL_FOLDER, central_root)

    normalized_grade = (grade_level or "").strip()
    use_grade_root = bool(normalized_grade) and normalized_grade in CENTRAL_GRADE_LEVEL_FOLDERS

    if use_grade_root:
        grade_root_id = _find_or_create_folder(service, normalized_grade, material_root)
        book_parent_id = grade_root_id
        logger.info(
            "[Drive] 페이지 이미지 경로(grade): central_root=%s 교재/%s/%s",
            central_root, normalized_grade, title,
        )
    else:
        if normalized_grade and normalized_grade not in CENTRAL_GRADE_LEVEL_FOLDERS:
            logger.warning("[Drive] 알 수 없는 grade_level '%s' → 레거시 폴백 경로 사용", normalized_grade)
        if root_folder_name is None:
            root_folder_name = CENTRAL_PAGE_IMAGES_FOLDER
        root_id = _find_or_create_folder(service, root_folder_name, material_root)
        book_parent_id = root_id

    book_id = _find_or_create_folder(service, title, book_parent_id)

    results = []
    for item in page_images:
        page_num = item["page"]
        img_bytes = item["image_bytes"]
        filename = f"page_{page_num:03d}.jpg"

        try:
            uploaded = _upload_file(service, book_id, filename, img_bytes, "image/jpeg")
            results.append({
                "page": page_num,
                "drive_file_id": uploaded["id"],
                "url": uploaded["url"],
            })
        except Exception as e:
            logger.warning(f"페이지 {page_num} 이미지 업로드 실패: {e}")

    logger.info(f"[Drive] '{title}' 페이지 이미지 {len(results)}/{len(page_images)}장 업로드 완료")
    return results


# ──────────────────────────────────────────────
# 공통 함수
# ──────────────────────────────────────────────

def _upload_file(service, folder_id: str, filename: str, file_bytes: bytes, mime_type: str) -> dict:
    """파일 업로드 (공통)"""
    metadata = {"name": filename, "parents": [folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
    file = service.files().create(body=metadata, media_body=media, fields="id,webViewLink,webContentLink").execute()
    try:
        service.permissions().create(fileId=file["id"], body={"role": "reader", "type": "anyone"}).execute()
    except Exception as e:
        logger.warning(f"공유 설정 실패: {e}")
    return {
        "id": file["id"],
        "url": f"https://lh3.googleusercontent.com/d/{file['id']}",
        "web_url": file.get("webViewLink", ""),
    }


def _search_pdfs_recursive(service, folder_id: str, path: str, results: list):
    """폴더를 재귀적으로 탐색하여 PDF 찾기"""
    query = f"'{folder_id}' in parents and trashed=false"
    items = service.files().list(q=query, fields="files(id,name,mimeType,modifiedTime)", pageSize=100).execute()

    for item in items.get("files", []):
        full_path = f"{path}/{item['name']}" if path else item["name"]
        if item["mimeType"] == "application/vnd.google-apps.folder":
            _search_pdfs_recursive(service, item["id"], full_path, results)
        elif item["mimeType"] == "application/pdf":
            results.append({
                "id": item["id"],
                "name": item["name"],
                "path": full_path,
                "modified": item.get("modifiedTime", ""),
            })


def delete_file(refresh_token: str, file_id: str) -> bool:
    """드라이브에서 파일 삭제"""
    try:
        service = _build_service(refresh_token)
        service.files().delete(fileId=file_id).execute()
        return True
    except Exception as e:
        logger.error(f"파일 삭제 실패 ({file_id}): {e}")
        return False


def delete_page_images_folder(refresh_token: str, title: str,
                              root_folder_name: str | None = None) -> bool:
    """교재 페이지 이미지 폴더를 Drive에서 삭제 (폴더 내 모든 파일 포함).

    삭제 대상:
    - 숙제 관리/교재/{grade_level}/{title}
    - 숙제 관리/교재/{CENTRAL_PAGE_IMAGES_FOLDER}/{title} (레거시 폴백)
    """
    try:
        service = _build_service(refresh_token)
        preferred_root = "숙제 관리"
        central_id = _find_folder_in_my_drive_root(service, preferred_root)
        if not central_id:
            # 환경값/레거시가 기존에 남아있는 경우도 삭제 범위에 포함
            if CENTRAL_ROOT_FOLDER and CENTRAL_ROOT_FOLDER != preferred_root:
                central_id = _find_folder_in_my_drive_root(service, CENTRAL_ROOT_FOLDER)
            if not central_id:
                for legacy in CENTRAL_ROOT_FOLDER_LEGACY_ALIASES:
                    if not legacy or legacy == preferred_root:
                        continue
                    central_id = _find_folder_in_my_drive_root(service, legacy)
                    if central_id:
                        break
        if not central_id:
            return False
        material_id = _find_folder_only(service, CENTRAL_GRADING_MATERIAL_FOLDER, central_id)
        if not material_id:
            return False

        if root_folder_name is None:
            root_folder_name = CENTRAL_PAGE_IMAGES_FOLDER

        safe_title = title.replace("'", "\\'")

        deleted = False

        # 1) 레거시 폴백: 교재 페이지 이미지/{title}
        page_root_id = _find_folder_only(service, root_folder_name, material_id)
        if page_root_id:
            folder_q = (
                f"name='{safe_title}' and mimeType='application/vnd.google-apps.folder' "
                f"and '{page_root_id}' in parents and trashed=false"
            )
            folder_res = service.files().list(q=folder_q, fields="files(id,name)", pageSize=10).execute()
            for f in folder_res.get("files", []):
                service.files().delete(fileId=f["id"]).execute()
                logger.info(f"[Drive] 폴더 삭제(레거시): '{f['name']}' ({f['id']})")
                deleted = True

        # 2) 신규: 교재/{grade}/{title}
        for grade_name in CENTRAL_GRADE_LEVEL_FOLDERS:
            grade_root_id = _find_folder_only(service, grade_name, material_id)
            if not grade_root_id:
                continue
            folder_q = (
                f"name='{safe_title}' and mimeType='application/vnd.google-apps.folder' "
                f"and '{grade_root_id}' in parents and trashed=false"
            )
            folder_res = service.files().list(q=folder_q, fields="files(id,name)", pageSize=10).execute()
            for f in folder_res.get("files", []):
                service.files().delete(fileId=f["id"]).execute()
                logger.info(f"[Drive] 폴더 삭제(grade): '{f['name']}' ({f['id']})")
                deleted = True
        return deleted
    except Exception as e:
        logger.error(f"페이지 이미지 폴더 삭제 실패 ('{title}'): {e}")
        return False


def cleanup_old_originals(refresh_token: str, drive_ids: list[str]) -> int:
    """오래된 원본 파일 삭제"""
    deleted = 0
    for fid in drive_ids:
        if delete_file(refresh_token, fid):
            deleted += 1
    return deleted
