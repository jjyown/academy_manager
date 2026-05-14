import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** 500 응답에 throw.message · stack 을 노출하기 전 토큰성 문자열만 redact.
 *  Error.message 에 fetch 응답 본문이 echo 되는 케이스 대비 (access_token=ya29.xxx 등).
 *  플랜 Stage 0-followup. */
function _safe(s?: string): string {
  return (s || "").replace(
    /((?:access|refresh|id)[_-]?token|client[_-]?secret|service[_-]?role[_-]?key|anon[_-]?key|authorization|bearer|apikey)[=:\s]+[^\s,"&]+/gi,
    "$1=<redacted>"
  );
}

/** Drive 루트(중앙 관리 계정). grading-server `CENTRAL_*` 와 동일한 기본값 유지 */
const DRIVE_ROOT_FOLDER = "숙제 관리";
const DRIVE_MATERIAL_FOLDER = "교재";
const DRIVE_GRADE_LEVEL_FOLDERS = ["중1", "중2", "중3", "고1", "고2", "고3"] as const;
const DRIVE_SUBMIT_FOLDER = "제출 과제 원본";
const DRIVE_GRADED_FOLDER = "채점 결과";
const DRIVE_INSTANT_GRADE_FOLDER = "즉시채점";
const DRIVE_HOMEWORK_MATERIAL_FOLDER = "학생들에게 나간숙제 자료";

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** homework/index.html `normalizeHomeworkPortalCode` 와 동일 (학생 포털 인증코드 비교용) */
function normalizeHomeworkPortalCode(value: string): string {
  let out = "";
  for (const ch of String(value || "")) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xff10 + 0x30);
      continue;
    }
    if (code >= 0xff21 && code <= 0xff3a) {
      out += String.fromCharCode(code - 0xff21 + 0x41);
      continue;
    }
    if (code >= 0xff41 && code <= 0xff5a) {
      out += String.fromCharCode(code - 0xff41 + 0x61);
      continue;
    }
    out += ch;
  }
  return out
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

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

/** 숙제 관리 / 교재/{중1~고3} / 제출 과제 원본 / 채점 결과 / 즉시채점 / 학생들에게 나간숙제 자료 고정 트리 생성(멱등) */
async function ensureHomeworkDriveLayout(accessToken: string): Promise<string> {
  const centralRoot = await getOrCreateSubFolder(accessToken, DRIVE_ROOT_FOLDER, null);
  const materialRoot = await getOrCreateSubFolder(
    accessToken,
    DRIVE_MATERIAL_FOLDER,
    centralRoot
  );
  for (const grade of DRIVE_GRADE_LEVEL_FOLDERS) {
    await getOrCreateSubFolder(accessToken, grade, materialRoot);
  }
  await getOrCreateSubFolder(accessToken, DRIVE_SUBMIT_FOLDER, centralRoot);
  await getOrCreateSubFolder(accessToken, DRIVE_GRADED_FOLDER, centralRoot);
  await getOrCreateSubFolder(accessToken, DRIVE_INSTANT_GRADE_FOLDER, centralRoot);
  await getOrCreateSubFolder(accessToken, DRIVE_HOMEWORK_MATERIAL_FOLDER, centralRoot);
  return centralRoot;
}

async function getOrCreateFolderPath(
  accessToken: string,
  year: string,
  month: string,
  day: string,
  studentName: string
): Promise<string> {
  const centralRoot = await ensureHomeworkDriveLayout(accessToken);
  const submitRoot = await getOrCreateSubFolder(accessToken, DRIVE_SUBMIT_FOLDER, centralRoot);
  const yearId = await getOrCreateSubFolder(accessToken, `${year}년`, submitRoot);
  const monthId = await getOrCreateSubFolder(accessToken, `${month}월`, yearId);
  const dayId = await getOrCreateSubFolder(accessToken, `${day}일`, monthId);
  const studentFolderId = await getOrCreateSubFolder(accessToken, studentName, dayId);
  return studentFolderId;
}

async function deleteExistingFiles(
  accessToken: string,
  folderId: string,
  fileName: string
): Promise<void> {
  const safeName = fileName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `'${folderId}' in parents and name='${safeName}' and trashed=false`
  )}&fields=files(id)`;

  const res = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    for (const file of data.files) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`기존 파일 삭제: ${file.id}`);
      } catch (e) {
        console.warn(`기존 파일 삭제 실패: ${file.id}`, e);
      }
    }
  }
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
    const ownerUserId = formData.get("owner_user_id") as string | null; // legacy input (검증용)
    const submissionDate = formData.get("submission_date") as string | null;
  const gradingAssignmentIdRaw = formData.get("grading_assignment_id") as string | null;
    const answerKeyId = formData.get("answer_key_id") as string | null;
    const portalStudentCode = formData.get("student_code") as string | null;

    if (!file || !teacherId || !studentId || !studentName || !submissionDate) {
      return new Response(
        JSON.stringify({
          error: "필수 항목이 누락되었습니다.",
          required: "file, teacher_id, student_id, student_name, submission_date",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const parsedStudentId = Number.parseInt(String(studentId), 10);
    if (!Number.isFinite(parsedStudentId) || parsedStudentId <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid student_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let gradingAssignmentId: number | null = null;
    if (gradingAssignmentIdRaw != null) {
      const raw = String(gradingAssignmentIdRaw).trim();
      if (raw) {
        const iv = Number.parseInt(raw, 10);
        if (!Number.isFinite(iv) || iv <= 0) {
          return new Response(
            JSON.stringify({ error: "Invalid grading_assignment_id" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        gradingAssignmentId = iv;
      }
    }

    // 배정 과제 제출 중복 방지(가능하면 재업로드를 막는다)
    // - failed만 있는 경우는 재시도 허용
    if (gradingAssignmentId != null) {
      const { data: existingRow } = await supabase
        .from("homework_submissions")
        .select("id,status")
        .eq("owner_user_id", teacherRow.owner_user_id)
        .eq("student_id", parsedStudentId)
        .eq("grading_assignment_id", gradingAssignmentId)
        .in("status", ["uploaded", "manual"])
        .limit(1);

      if (existingRow && existingRow.length > 0) {
        return new Response(
          JSON.stringify({ error: "This grading assignment has already been submitted" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: teacherRow, error: teacherError } = await supabase
      .from("teachers")
      .select("id, owner_user_id")
      .eq("id", teacherId)
      .single();

    if (teacherError || !teacherRow) {
      return new Response(
        JSON.stringify({ error: "Teacher not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .select("id, owner_user_id, name, status, student_code")
      .eq("id", parsedStudentId)
      .single();

    if (studentError || !studentRow) {
      return new Response(
        JSON.stringify({ error: "Student not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (String(studentRow.owner_user_id || "") !== String(teacherRow.owner_user_id || "")) {
      return new Response(
        JSON.stringify({ error: "Forbidden: student ownership mismatch" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (String(studentRow.status || "") !== "active") {
      return new Response(
        JSON.stringify({ error: "Student is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 원장 Supabase 로그인 JWT 또는 숙제 포털 학생 인증코드(본인 일치) 중 하나로 인증
    const bearer = extractBearerToken(req);
    let jwtOwnerId: string | null = null;
    if (bearer) {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(bearer);
      if (!authError && user?.id) {
        jwtOwnerId = user.id;
      }
    }

    let authorized =
      !!jwtOwnerId &&
      String(teacherRow.owner_user_id || "") === String(jwtOwnerId);

    if (!authorized) {
      const codeOk =
        !!portalStudentCode &&
        normalizeHomeworkPortalCode(String(portalStudentCode)) ===
          normalizeHomeworkPortalCode(String(studentRow.student_code || ""));
      if (codeOk) {
        authorized = true;
      }
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({
          error:
            "Unauthorized: 원장 계정 로그인 또는 학생 인증코드(student_code)가 필요합니다.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (ownerUserId && String(ownerUserId) !== String(teacherRow.owner_user_id)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: owner_user_id mismatch" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

    // gradingAssignmentId(배정 선택) 검증 (선택값)
    if (gradingAssignmentId != null) {
      const { data: gaRow, error: gaErr } = await supabase
        .from("grading_assignments")
        .select("id, teacher_id, assigned_students, due_date, answer_key_id")
        .eq("id", gradingAssignmentId)
        .single();

      if (gaErr || !gaRow) {
        return new Response(
          JSON.stringify({ error: "Invalid grading_assignment_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (String(gaRow.teacher_id || "") !== String(teacherRow.owner_user_id || "")) {
        return new Response(
          JSON.stringify({ error: "Forbidden: grading assignment teacher mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const assigned = (gaRow.assigned_students || []) as unknown[];
      const assignedHit = assigned.some((x) => String(x) === String(parsedStudentId));
      if (!assignedHit) {
        return new Response(
          JSON.stringify({ error: "Forbidden: grading assignment not assigned to student" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (String(gaRow.due_date || "") !== String(submissionDate)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: grading assignment due_date mismatch" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const fileBuffer = new Uint8Array(await file.arrayBuffer());

    // ─── 2) 중앙 드라이브(jjyown@gmail.com)에 원본 업로드 ───
    const centralAccessToken = await getAccessToken(centralAdmin.google_drive_refresh_token);
    const centralFolderId = await getOrCreateFolderPath(centralAccessToken, year, month, day, studentName);
    await deleteExistingFiles(centralAccessToken, centralFolderId, fileName);
    const { fileId: centralFileId, fileUrl: centralFileUrl } = await uploadFileToDrive(
      centralAccessToken,
      centralFolderId,
      fileName,
      fileBuffer
    );

    // ─── 3) DB에 제출 기록 저장 ───
    const { error: insertError } = await supabase
      .from("homework_submissions")
      .insert({
        owner_user_id: teacherRow.owner_user_id,
        teacher_id: teacherId,
        student_id: parsedStudentId,
        submission_date: submissionDate,
        grading_assignment_id: gradingAssignmentId,
        file_name: fileName,
        // 기존 호환: drive_file_id/url은 중앙 드라이브 기준
        drive_file_id: centralFileId,
        drive_file_url: centralFileUrl,
        central_drive_file_id: centralFileId,
        central_drive_file_url: centralFileUrl,
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

    // ─── 4) 자동 채점 트리거 (fire-and-forget: 서버가 비동기로 처리) ───
    const GRADING_SERVER_URL = Deno.env.get("GRADING_SERVER_URL") || "";
    let gradingTriggered = false;
    if (GRADING_SERVER_URL) {
      try {
        const { data: submissionRow } = await supabase
          .from("homework_submissions")
          .select("id")
          .eq("central_drive_file_id", centralFileId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        const submissionId = submissionRow?.id;

        const teacherUid = String(teacherRow.owner_user_id || "");

        const gradeForm = new FormData();
        gradeForm.append("student_id", studentId);
        gradeForm.append("teacher_id", teacherUid);
        gradeForm.append("mode", "assigned");
        gradeForm.append("zip_drive_id", centralFileId);
        if (gradingAssignmentId != null) {
          gradeForm.append("assignment_id", String(gradingAssignmentId));
        }
        if (submissionId) {
          gradeForm.append("homework_submission_id", String(submissionId));
        }
        if (answerKeyId) {
          gradeForm.append("answer_key_id", answerKeyId);
        }

        // 채점 서버가 비동기로 처리하므로 짧은 타임아웃으로 충분
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const gradeRes = await fetch(`${GRADING_SERVER_URL}/api/grade`, {
            method: "POST",
            body: gradeForm,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          console.log(`자동 채점 트리거 완료: status=${gradeRes.status}`);
          gradingTriggered = gradeRes.ok;
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutId);
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          console.warn(`자동 채점 트리거 실패 (제출은 정상): ${msg}`);
        }

        if (submissionId) {
          await supabase
            .from("homework_submissions")
            .update({
              grading_status: gradingTriggered ? "grading" : "grading_failed",
            })
            .eq("id", submissionId);
        }
      } catch (gradeErr) {
        console.warn(`자동 채점 트리거 실패 (제출은 정상): ${gradeErr}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileName,
        driveFileId: centralFileId,
        driveFileUrl: centralFileUrl,
        fileSize: fileBuffer.length,
        dbSaved: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const e = error instanceof Error ? error : undefined;
    const errMsg = e?.message ?? String(error);
    console.error("Upload homework error:", e?.stack || errMsg);

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

    // Stage 0-followup — 일반 500 응답에 throw 의 정확한 message · name · 첫 stack frame
    // 을 노출(클라이언트 콘솔에서 분기 즉시 식별). 토큰성 문자열은 _safe() 로 redact.
    return new Response(
      JSON.stringify({
        error: _safe(errMsg) || "서버 오류가 발생했습니다.",
        name: e?.name,
        stack_first: _safe(e?.stack?.split("\n")[1]?.trim()),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
