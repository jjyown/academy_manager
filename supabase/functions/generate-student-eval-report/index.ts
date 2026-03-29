import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_EVAL_MODEL = Deno.env.get("GEMINI_EVAL_MODEL") ?? "gemini-2.0-flash";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Max-Age": "86400",
};

interface Body {
  studentId: number | string;
  evalMonth: string;
  mode?: "generate" | "refine";
  currentComment?: string;
  refinementInstruction?: string;
}

/** DB·UI와 맞춤 (종합평가 본문 상한) */
const EVAL_MAX_CHARS = 2000;

/** 줄바꿈 유지 + 번호 항목(1. 2. …)을 새 줄로 분리 */
function postProcessEvalText(raw: string): string {
  let t = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/([.!?。…])\s*(\d{1,2}\.\s)/g, "$1\n\n$2");
  t = t.replace(/([^\n])\s*(\d{1,2}\.\s+\*\*)/g, "$1\n\n$2");
  t = t.replace(/([^\n])\s*(\d{1,2}\.\s+[가-힣])/g, "$1\n\n$2");
  return t.trim().slice(0, EVAL_MAX_CHARS);
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenMemoMap(
  obj: Record<string, unknown> | null | undefined,
  label: string,
): string[] {
  const lines: string[] = [];
  if (!obj || typeof obj !== "object") return lines;
  for (const [dateKey, timeMap] of Object.entries(obj)) {
    if (!timeMap || typeof timeMap !== "object") continue;
    for (const [timeKey, val] of Object.entries(timeMap as Record<string, unknown>)) {
      if (typeof val === "string" && val.trim()) {
        lines.push(`[${dateKey} ${timeKey}] ${label}: ${stripHtml(val)}`);
      } else if (val && typeof val === "object") {
        for (const [tid, html] of Object.entries(val as Record<string, unknown>)) {
          if (typeof html === "string" && html.trim()) {
            lines.push(`[${dateKey} ${timeKey} 선생님:${tid}] ${label}: ${stripHtml(html)}`);
          }
        }
      }
    }
  }
  return lines;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase env missing");
    }
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "gemini_not_configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const studentId = parseInt(String(body.studentId), 10);
    const evalMonth = String(body.evalMonth || "").trim();
    const mode = body.mode === "refine" ? "refine" : "generate";
    if (!studentId || !/^\d{4}-\d{2}$/.test(evalMonth)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: stu, error: stuErr } = await admin
      .from("students")
      .select("id, name, school, grade, owner_user_id")
      .eq("id", studentId)
      .maybeSingle();

    if (stuErr || !stu || String(stu.owner_user_id) !== String(user.id)) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: evRow } = await admin
      .from("student_evaluations")
      .select("class_memos, class_shared_memos")
      .eq("student_id", studentId)
      .eq("eval_month", evalMonth)
      .maybeSingle();

    const personal = flattenMemoMap(
      (evRow?.class_memos as Record<string, unknown>) ?? {},
      "개인메모",
    );
    const shared = flattenMemoMap(
      (evRow?.class_shared_memos as Record<string, unknown>) ?? {},
      "공유메모",
    );

    const [y, m] = evalMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${evalMonth}-01`;
    const endDate = `${evalMonth}-${String(lastDay).padStart(2, "0")}`;

    const { data: scores } = await admin
      .from("student_test_scores")
      .select("exam_name, exam_date, score, max_score")
      .eq("student_id", studentId)
      .gte("exam_date", startDate)
      .lte("exam_date", endDate)
      .order("exam_date", { ascending: true });

    const scoreLines = (scores ?? []).map((r) => {
      const mx = r.max_score != null ? ` / 만점 ${r.max_score}` : "";
      return `- ${r.exam_date} ${r.exam_name ?? "시험"}: ${r.score}${mx}`;
    });

    const memoBlock = [...personal, ...shared].join("\n") || "(해당 월 메모 없음)";
    const scoreBlock = scoreLines.length ? scoreLines.join("\n") : "(해당 월 시험 점수 없음)";

    let systemInstruction = `당신은 학원의 월간 학생 평가 보고서를 작성하는 교육 전문가입니다.
출력은 반드시 한국어이며, 학부모가 읽는 공식 월간 보고서 형식으로 작성합니다.

[반드시 지킬 출력 형식]
- 아래 4개 항목을 **순서대로** 쓰고, **각 항목은 반드시 새 줄에서 시작**합니다.
- 각 줄은 "1. ", "2. ", "3. ", "4. " 로 시작하고, 소제목 뒤에 내용을 이어 씁니다. (예: 1. **이번 달 요약:** …)

1. **이번 달 학습·수업 참여 요약:** (2~3문장)
2. **성취·잘한 점:**
3. **보완이 필요한 점·제안:** (긍정적 톤)
4. **다음 달 응원:**

조건:
- 존댓말, 과장·확정적 진단 금지, 사실은 제공된 메모·점수 범위 안에서만 서술
- 총 길이 ${EVAL_MAX_CHARS}자 이내 (줄바꿈 포함)
- 이모지 사용 금지`;

    let userPrompt = `학생: ${stu.name} (${stu.grade ?? ""}${stu.school ? `, ${stu.school}` : ""})
대상 월: ${evalMonth}

[수업·메모 기록]
${memoBlock}

[시험·점수]
${scoreBlock}`;

    if (mode === "refine") {
      const cur = String(body.currentComment || "").trim();
      const instr = String(body.refinementInstruction || "").trim();
      if (!cur || !instr) {
        return new Response(JSON.stringify({ ok: false, error: "refine_missing" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userPrompt =
        `아래는 현재 종합평가 초안입니다.\n\n"""${cur}"""\n\n` +
        `다음 요청을 반영해 전체를 다시 작성하세요. ${EVAL_MAX_CHARS}자 이내, 한국어. 항목 1~4는 각각 새 줄에서 시작.\n요청: ${instr}\n\n` +
        `참고(원 자료 요약):\n${userPrompt}`;
    }

    const gemUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EVAL_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const gemRes = await fetch(gemUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction + "\n\n" + userPrompt }] }],
        generationConfig: {
          temperature: 0.65,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!gemRes.ok) {
      const errText = await gemRes.text();
      console.error("[generate-student-eval-report] Gemini HTTP", gemRes.status, errText);
      return new Response(JSON.stringify({ ok: false, error: "gemini_http" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gemJson = await gemRes.json();
    const text =
      gemJson?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
      "";

    const trimmed = postProcessEvalText(text);

    if (!trimmed) {
      return new Response(JSON.stringify({ ok: false, error: "empty_output" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, text: trimmed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[generate-student-eval-report]", e);
    return new Response(JSON.stringify({ ok: false, error: "internal" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
