import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DRIVE_FOLDER_NAME = "숙제 제출";

async function getAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `Token refresh failed: ${data.error_description || data.error}`
    );
  }

  return data.access_token;
}

async function getOrCreateSubFolder(
  accessToken: string,
  folderName: string,
  parentId: string | null
): Promise<string> {
  const safeFolderName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const parentQuery = parentId
    ? `'${parentId}' in parents and `
    : "";
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `${parentQuery}name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )}&fields=files(id,name)`;

  const searchResponse = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const searchData = await searchResponse.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    }
  );

  const createData = await createResponse.json();

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create Drive folder '${folderName}': ${JSON.stringify(createData)}`
    );
  }

  return createData.id;
}

async function getOrCreateFolderPath(
  accessToken: string,
  year: string,
  month: string,
  day: string,
  studentName: string
): Promise<string> {
  const rootId = await getOrCreateSubFolder(accessToken, DRIVE_FOLDER_NAME, null);
  const yearId = await getOrCreateSubFolder(accessToken, `${year}년`, rootId);
  const monthId = await getOrCreateSubFolder(accessToken, `${month}월`, yearId);
  const dayId = await getOrCreateSubFolder(accessToken, `${day}일`, monthId);
  const studentId = await getOrCreateSubFolder(accessToken, studentName, dayId);
  return studentId;
}

async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileData: Uint8Array
): Promise<{ fileId: string; fileUrl: string }> {
  const boundary = "homework_upload_boundary_" + Date.now();

  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: "application/zip",
  });

  const encoder = new TextEncoder();
  const metadataPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
  );
  const filePart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`
  );
  const ending = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(
    metadataPart.length + filePart.length + fileData.length + ending.length
  );
  body.set(metadataPart, 0);
  body.set(filePart, metadataPart.length);
  body.set(fileData, metadataPart.length + filePart.length);
  body.set(
    ending,
    metadataPart.length + filePart.length + fileData.length
  );

  const uploadResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body,
    }
  );

  const uploadData = await uploadResponse.json();

  if (!uploadResponse.ok) {
    throw new Error(
      `Drive upload failed: ${JSON.stringify(uploadData)}`
    );
  }

  return {
    fileId: uploadData.id,
    fileUrl: uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/view`,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Google OAuth credentials not configured");
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const teacherId = formData.get("teacher_id") as string | null;
    const studentId = formData.get("student_id") as string | null;
    const studentName = formData.get("student_name") as string | null;
    const ownerUserId = formData.get("owner_user_id") as string | null;
    const submissionDate = formData.get("submission_date") as string | null;

    if (!file || !teacherId || !studentId || !studentName || !ownerUserId || !submissionDate) {
      return new Response(
        JSON.stringify({
          error: "필수 항목이 누락되었습니다.",
          required: "file, teacher_id, student_id, student_name, owner_user_id, submission_date",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ─── 1) 중앙 관리 드라이브(is_central_admin=true) 토큰 조회 ───
    const { data: centralAdmin, error: centralError } = await supabase
      .from("teachers")
      .select("google_drive_refresh_token, google_drive_connected, name")
      .eq("is_central_admin", true)
      .eq("google_drive_connected", true)
      .limit(1)
      .single();

    if (centralError || !centralAdmin || !centralAdmin.google_drive_refresh_token) {
      return new Response(
        JSON.stringify({
          error: "중앙 관리 드라이브(원장님)가 연결되지 않았습니다. 원장님 계정에서 Drive 연결을 확인해주세요.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ─── 2) 담당 선생님 드라이브 토큰 조회 ───
    const { data: teacher } = await supabase
      .from("teachers")
      .select("google_drive_refresh_token, google_drive_connected, name")
      .eq("id", teacherId)
      .single();

    const teacherHasDrive = teacher?.google_drive_connected && teacher?.google_drive_refresh_token;

    // submissionDate 검증
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(submissionDate)) {
      return new Response(
        JSON.stringify({ error: "올바른 날짜 형식이 아닙니다 (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dateParts = submissionDate.split("-");
    const year = dateParts[0];
    const month = String(parseInt(dateParts[1]));
    const day = String(parseInt(dateParts[2]));
    const fileName = `과제-${year}년-${month}월-${day}일-${studentName}.zip`;

    const fileBuffer = new Uint8Array(await file.arrayBuffer());

    // ─── 3) 중앙 드라이브(jjyown@gmail.com)에 원본 업로드 ───
    const centralAccessToken = await getAccessToken(centralAdmin.google_drive_refresh_token);
    const centralFolderId = await getOrCreateFolderPath(centralAccessToken, year, month, day, studentName);
    const { fileId: centralFileId, fileUrl: centralFileUrl } = await uploadFileToDrive(
      centralAccessToken,
      centralFolderId,
      fileName,
      fileBuffer
    );

    // ─── 4) 담당 선생님 드라이브에도 원본 업로드 ───
    let teacherFileId: string | null = null;
    let teacherFileUrl: string | null = null;

    if (teacherHasDrive) {
      try {
        const teacherAccessToken = await getAccessToken(teacher!.google_drive_refresh_token);
        const teacherFolderId = await getOrCreateFolderPath(teacherAccessToken, year, month, day, studentName);
        const teacherResult = await uploadFileToDrive(
          teacherAccessToken,
          teacherFolderId,
          fileName,
          fileBuffer
        );
        teacherFileId = teacherResult.fileId;
        teacherFileUrl = teacherResult.fileUrl;
        console.log(`선생님 드라이브 업로드 성공: ${teacherFileId}`);
      } catch (teacherUploadErr: unknown) {
        const msg = teacherUploadErr instanceof Error ? teacherUploadErr.message : String(teacherUploadErr);
        console.warn(`선생님 드라이브 업로드 실패 (중앙 저장은 정상): ${msg}`);
      }
    }

    // ─── 5) DB에 제출 기록 저장 ───
    const { error: insertError } = await supabase
      .from("homework_submissions")
      .insert({
        owner_user_id: ownerUserId,
        teacher_id: teacherId,
        student_id: parseInt(studentId),
        submission_date: submissionDate,
        file_name: fileName,
        // 기존 호환: drive_file_id/url은 중앙 드라이브 기준
        drive_file_id: centralFileId,
        drive_file_url: centralFileUrl,
        // 중앙 드라이브 정보
        central_drive_file_id: centralFileId,
        central_drive_file_url: centralFileUrl,
        // 선생님 드라이브 정보
        teacher_drive_file_id: teacherFileId,
        teacher_drive_file_url: teacherFileUrl,
        file_size: fileBuffer.length,
        status: "uploaded",
        grading_status: "pending",
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return new Response(
        JSON.stringify({
          success: true,
          fileName,
          driveFileId: centralFileId,
          driveFileUrl: centralFileUrl,
          teacherDriveFileId: teacherFileId,
          fileSize: fileBuffer.length,
          dbSaved: false,
          dbError: insertError.message || 'DB 저장 실패',
        }),
        {
          status: 207,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileName,
        driveFileId: centralFileId,
        driveFileUrl: centralFileUrl,
        teacherDriveFileId: teacherFileId,
        teacherDriveFileUrl: teacherFileUrl,
        fileSize: fileBuffer.length,
        dbSaved: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Upload homework error:", errMsg);

    if (
      errMsg.includes("Token refresh failed") ||
      errMsg.includes("invalid_grant")
    ) {
      return new Response(
        JSON.stringify({
          error: "중앙 관리 드라이브 인증이 만료되었습니다. 원장님 계정에서 Drive 재연결을 해주세요.",
          code: "TOKEN_EXPIRED",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: errMsg || "서버 오류가 발생했습니다." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
