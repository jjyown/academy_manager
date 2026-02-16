"""Google Drive 연동: 중앙 드라이브 + 선생님 드라이브 지원"""
import io
import logging
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

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


# ──────────────────────────────────────────────
# 중앙 드라이브(jjyown) 전용 함수
# ──────────────────────────────────────────────

def get_central_grading_material_folder(central_token: str, folder_name: str) -> str:
    """중앙 드라이브에서 '숙제 채점 자료' 폴더 ID 반환"""
    service = _build_service(central_token)
    return _find_or_create_folder(service, folder_name)


def search_answer_pdfs_central(central_token: str, material_folder_name: str) -> list[dict]:
    """중앙 드라이브의 '숙제 채점 자료' 폴더에서 PDF 검색"""
    service = _build_service(central_token)
    folder_id = _find_or_create_folder(service, material_folder_name)

    all_pdfs = []
    _search_pdfs_recursive(service, folder_id, "", all_pdfs)
    return all_pdfs


def download_file_central(central_token: str, file_id: str) -> bytes:
    """중앙 드라이브에서 파일 다운로드"""
    service = _build_service(central_token)
    request = service.files().get_media(fileId=file_id)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buffer.getvalue()


def upload_to_central(central_token: str, folder_name: str, sub_path: list[str],
                      filename: str, image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """중앙 드라이브에 채점 결과 업로드
    folder_name: '채점 결과'
    sub_path: ['수학', '문제집A', '김민철']
    """
    service = _build_service(central_token)
    parent = _find_or_create_folder(service, folder_name)
    for folder in sub_path:
        parent = _find_or_create_folder(service, folder, parent)

    return _upload_file(service, parent, filename, image_bytes, mime_type)


# ──────────────────────────────────────────────
# 선생님 드라이브 전용 함수
# ──────────────────────────────────────────────

def upload_to_teacher_drive(teacher_token: str, folder_name: str, sub_path: list[str],
                            filename: str, image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """선생님 드라이브에 채점 결과 업로드
    folder_name: '채점 결과'
    sub_path: ['수학', '문제집A', '김민철']
    """
    service = _build_service(teacher_token)
    parent = _find_or_create_folder(service, folder_name)
    for folder in sub_path:
        parent = _find_or_create_folder(service, folder, parent)

    return _upload_file(service, parent, filename, image_bytes, mime_type)


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
        "url": f"https://drive.google.com/uc?id={file['id']}",
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


def cleanup_old_originals(refresh_token: str, drive_ids: list[str]) -> int:
    """오래된 원본 파일 삭제"""
    deleted = 0
    for fid in drive_ids:
        if delete_file(refresh_token, fid):
            deleted += 1
    return deleted
