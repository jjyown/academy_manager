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

// Google Drive 폴더 이름
const DRIVE_FOLDER_NAME = "숙제 제출";

/**
 * refresh_token으로 새 access_token을 발급받습니다.
 */
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

/**
 * Google Drive에서 "숙제 제출" 폴더를 찾거나 생성합니다.
 */
async function getOrCreateFolder(accessToken: string): Promise<string> {
  // 먼저 기존 폴더 검색
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )}&fields=files(id,name)`;

  const searchResponse = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const searchData = await searchResponse.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // 폴더가 없으면 생성
  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
    }
  );

  const createData = await createResponse.json();

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create Drive folder: ${JSON.stringify(createData)}`
    );
  }

  return createData.id;
}

/**
 * Google Drive에 ZIP 파일을 업로드합니다.
 */
async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileData: Uint8Array
): Promise<{ fileId: string; fileUrl: string }> {
  // multipart upload 사용
  const boundary = "homework_upload_boundary_" + Date.now();

  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: "application/zip",
  });

  // multipart/related 요청 본문 구성
  const encoder = new TextEncoder();
  const metadataPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
  );
  const filePart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`
  );
  const ending = encoder.encode(`\r\n--${boundary}--`);

  // 전체 본문 합치기
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
  // CORS preflight
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

    // FormData에서 데이터 추출
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

    // Supabase 클라이언트 (service role - RLS 우회)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 선생님의 refresh token 조회
    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .select("google_drive_refresh_token, google_drive_connected, name")
      .eq("id", teacherId)
      .single();

    if (teacherError || !teacher) {
      return new Response(
        JSON.stringify({ error: "선생님 정보를 찾을 수 없습니다." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!teacher.google_drive_connected || !teacher.google_drive_refresh_token) {
      return new Response(
        JSON.stringify({
          error: "선생님의 Google Drive가 연결되지 않았습니다. 선생님에게 Drive 연결을 요청해주세요.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 파일 이름 생성: 과제-{year}년-{month}월-{day}일-{studentName}.zip
    const dateParts = submissionDate.split("-");
    const year = dateParts[0];
    const month = String(parseInt(dateParts[1]));
    const day = String(parseInt(dateParts[2]));
    const fileName = `과제-${year}년-${month}월-${day}일-${studentName}.zip`;

    // Google Drive 업로드
    const accessToken = await getAccessToken(teacher.google_drive_refresh_token);
    const folderId = await getOrCreateFolder(accessToken);

    const fileBuffer = new Uint8Array(await file.arrayBuffer());
    const { fileId, fileUrl } = await uploadFileToDrive(
      accessToken,
      folderId,
      fileName,
      fileBuffer
    );

    // DB에 제출 기록 저장
    const { error: insertError } = await supabase
      .from("homework_submissions")
      .insert({
        owner_user_id: ownerUserId,
        teacher_id: teacherId,
        student_id: parseInt(studentId),
        submission_date: submissionDate,
        file_name: fileName,
        drive_file_id: fileId,
        drive_file_url: fileUrl,
        file_size: fileBuffer.length,
        status: "uploaded",
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      // Drive 업로드는 성공했으므로 경고만 기록
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileName,
        driveFileId: fileId,
        driveFileUrl: fileUrl,
        fileSize: fileBuffer.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Upload homework error:", error);

    // refresh_token이 만료/취소된 경우
    if (
      error.message?.includes("Token refresh failed") ||
      error.message?.includes("invalid_grant")
    ) {
      return new Response(
        JSON.stringify({
          error: "Google Drive 인증이 만료되었습니다. 선생님에게 Drive 재연결을 요청해주세요.",
          code: "TOKEN_EXPIRED",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: error.message || "서버 오류가 발생했습니다." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
