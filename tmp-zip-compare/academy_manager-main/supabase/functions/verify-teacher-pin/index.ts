import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** 브라우저 preflight(OPTIONS)가 2xx + 필수 CORS 헤더를 받아야 실제 POST가 진행됩니다. */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Max-Age": "86400",
};

interface VerifyTeacherPinRequest {
  teacherId: string;
  pin: string;
  ownerUserId?: string;
  requireAdmin?: boolean;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  // send-reset-code와 동일: 일부 환경에서 204 빈 응답 preflight가 비정상 처리되는 경우가 있어 200 + 본문 사용
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    }

    const body: VerifyTeacherPinRequest = await req.json();
    const teacherId = String(body.teacherId || "").trim();
    const pin = String(body.pin || "").trim();
    const ownerUserId = String(body.ownerUserId || "").trim();
    const requireAdmin = !!body.requireAdmin;

    // supabase-js functions.invoke는 비-2xx 시 error로만 처리되어 본문(data)이 비는 경우가 많음 → 앱 수준 결과는 200 + JSON으로 통일
    if (!teacherId || !pin) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_fields",
          message: "Missing required fields: teacherId, pin",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: teacher, error } = await supabase
      .from("teachers")
      .select("id, name, teacher_role, owner_user_id, pin_hash")
      .eq("id", teacherId)
      .single();

    if (error || !teacher) {
      return new Response(
        JSON.stringify({ ok: false, error: "teacher_not_found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (ownerUserId && String(teacher.owner_user_id || "") !== ownerUserId) {
      return new Response(
        JSON.stringify({ ok: false, error: "ownership_mismatch" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (requireAdmin && String(teacher.teacher_role || "teacher") !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, error: "admin_required" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const pinHash = await sha256Hex(pin);
    const matched = String(pinHash) === String(teacher.pin_hash || "");
    if (!matched) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_pin" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        teacher: {
          id: teacher.id,
          name: teacher.name,
          teacher_role: teacher.teacher_role || "teacher",
          owner_user_id: teacher.owner_user_id || null,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("verify-teacher-pin error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error?.message || error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
