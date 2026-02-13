import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ResetCodeRequest {
  teacherEmail: string;
  code: string;
  teacherName: string;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }

    const { teacherEmail, code, teacherName }: ResetCodeRequest =
      await req.json();

    if (!teacherEmail || !code || !teacherName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Academy Manager <onboarding@resend.dev>",
        to: [teacherEmail],
        subject: `[학원관리] 비밀번호 초기화 인증번호`,
        html: `
          <div style="font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #4f46e5; font-size: 24px; margin: 0;">ACADEMY MANAGER</h1>
              <p style="color: #64748b; font-size: 14px; margin-top: 8px;">비밀번호 초기화 인증</p>
            </div>
            
            <div style="background: #f8fafc; border-radius: 16px; padding: 32px 24px; text-align: center; border: 1px solid #e2e8f0;">
              <p style="color: #475569; font-size: 15px; margin: 0 0 8px;">
                <strong>${teacherName}</strong> 선생님의 비밀번호 초기화가 요청되었습니다.
              </p>
              <p style="color: #64748b; font-size: 13px; margin: 0 0 24px;">
                아래 인증번호를 입력해주세요.
              </p>
              
              <div style="background: white; border: 2px solid #4f46e5; border-radius: 12px; padding: 20px; display: inline-block;">
                <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4f46e5;">${code}</span>
              </div>
              
              <p style="color: #ef4444; font-size: 12px; margin-top: 20px;">
                * 이 인증번호는 5분간 유효합니다.
              </p>
            </div>
            
            <div style="margin-top: 24px; padding: 16px; background: #fff7ed; border-radius: 10px; border: 1px solid #fed7aa;">
              <p style="color: #9a3412; font-size: 12px; margin: 0; line-height: 1.6;">
                ⚠️ 본인이 요청하지 않았다면 이 메일을 무시하세요.<br>
                인증번호를 다른 사람에게 알려주지 마세요.
              </p>
            </div>
            
            <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 32px;">
              이 메일은 학원 관리 시스템에서 자동 발송되었습니다.
            </p>
          </div>
        `,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend API error:", data);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: data }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, messageId: data.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
