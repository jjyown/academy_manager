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

/** 모델이 본문 맨 앞에 단독으로 붙이는 0·전각0·빈 줄 제거( "01."·"1." 본문은 유지 ) */
function stripLeadingArtifactLines(input: string): string {
  const lines = input.split("\n");
  while (lines.length > 0) {
    const t = lines[0].trim();
    if (t === "" || t === "0" || t === "０") {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join("\n");
}

/** 줄바꿈 유지 + 번호 항목(1. 2. …)을 새 줄로 분리 */
function postProcessEvalText(raw: string): string {
  let t = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  t = stripLeadingArtifactLines(t).trim();
  if (!t) return "";
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/([.!?。…])\s*(\d{1,2}\.\s)/g, "$1\n\n$2");
  t = t.replace(/([^\n])\s*(\d{1,2}\.\s+\*\*)/g, "$1\n\n$2");
  t = t.replace(/([^\n])\s*(\d{1,2}\.\s+[가-힣])/g, "$1\n\n$2");
  t = t.trim().slice(0, EVAL_MAX_CHARS);
  t = stripLeadingArtifactLines(t).trim();
  return t.slice(0, EVAL_MAX_CHARS);
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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    /** 원장 고정 지침: 항목 테이블 시간순 합산, 없으면 users 레거시 컬럼 */
    const OWNER_STYLE_PROMPT_MAX = 8000;
    let ownerEvalStyleNote = "";
    try {
      const { data: entryRows } = await admin
        .from("student_eval_ai_style_entries")
        .select("content")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: true });
      if (entryRows && entryRows.length > 0) {
        ownerEvalStyleNote = entryRows.map((r: { content: string }) => String(r.content || "")).join("\n\n").trim();
        if (ownerEvalStyleNote.length > OWNER_STYLE_PROMPT_MAX) {
          ownerEvalStyleNote = ownerEvalStyleNote.slice(-OWNER_STYLE_PROMPT_MAX);
        }
      } else {
        const { data: ownerRow, error: ownErr } = await admin
          .from("users")
          .select("student_eval_ai_style_note")
          .eq("id", user.id)
          .maybeSingle();
        if (!ownErr && ownerRow && typeof (ownerRow as { student_eval_ai_style_note?: string }).student_eval_ai_style_note === "string") {
          ownerEvalStyleNote = String((ownerRow as { student_eval_ai_style_note: string }).student_eval_ai_style_note).trim();
        }
      }
    } catch {
      /* 테이블·컬럼 미적용 등 */
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

    const { data: attRows } = await admin
      .from("attendance_records")
      .select("status")
      .eq("student_id", studentId)
      .eq("owner_user_id", user.id)
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate);

    const attStat: Record<string, number> = {};
    for (const r of attRows ?? []) {
      const k = String((r as { status?: string }).status || "unknown");
      attStat[k] = (attStat[k] || 0) + 1;
    }
    const attendanceBlock =
      Object.keys(attStat).length > 0
        ? Object.entries(attStat)
            .map(([st, n]) => `${st}: ${n}건`)
            .join(", ")
        : "(해당 월 출결 기록 없음)";

    const { data: hwRows } = await admin
      .from("homework_submissions")
      .select("submission_date, status")
      .eq("student_id", studentId)
      .eq("owner_user_id", user.id)
      .gte("submission_date", startDate)
      .lte("submission_date", endDate);

    let hwUploaded = 0;
    let hwFailed = 0;
    const hwOkDays = new Set<string>();
    for (const r of hwRows ?? []) {
      const row = r as { submission_date?: string; status?: string };
      if (row.status === "failed") {
        hwFailed++;
      } else if (row.status === "deleted") {
        /* 제외 */
      } else {
        hwUploaded++;
        if (row.submission_date) hwOkDays.add(String(row.submission_date));
      }
    }
    const homeworkBlock =
      (hwRows?.length ?? 0) > 0
        ? `업로드 성공 ${hwUploaded}건, 실패 ${hwFailed}건, 제출이 확인된 서로 다른 날 ${hwOkDays.size}일`
        : "(해당 월 숙제 제출 기록 없음)";

    const memoBlock = [...personal, ...shared].join("\n") || "(해당 월 메모 없음)";
    const scoreBlock = scoreLines.length ? scoreLines.join("\n") : "(해당 월 시험 점수 없음)";

    let systemInstruction = `당신은 15년 경력의 전문 교육 컨설턴트이자 학원 현장을 잘 아는 베테랑입니다. 아래 제공된 학생 데이터만을 바탕으로 학부모에게 발송할 「월간 학업 성취 리포트」를 작성합니다.

[역할·톤]
- 학부모가 "체계적으로 관리받는다"고 느낄 수 있도록 전문적이면서도 따뜻하고 격려하는 톤을 유지합니다.
- 문장은 한국어 존댓말(~습니다 / ~합니다 체)로 통일합니다.
- 객관 데이터(출결·숙제 제출·시험 점수)를 먼저 반영한 뒤, 선생님 메모의 정성적 관찰을 자연스럽게 녹입니다.
- 수치·항목을 기계적으로 나열하지 말고, 접속사와 요약 문장으로 문단이 이어지게 씁니다.

[학부모에게 보이는 글 — AI·시스템 티 내지 않기]
- 학부모에게 "상세 메모가 확보되지 않았습니다", "데이터가 부족합니다", "시스템상", "작성 시점에~", "AI가~" 같은 **메타 설명·사과·한계 고백**을 쓰지 마세요. 원장·담임이 직접 보낸 안내문처럼 읽혀야 합니다.
- 내부 참고 자료에 메모·기록이 적으면, **짧고 긍정적인 문장**으로만 다루고 빈칸을 채우려 장황하게 변명하지 마세요.
- 추측·과장은 금지이나, 그렇다고 부모에게 "근거 없음"을 드러내는 말투로 쓰지 마세요.

[출력 형식 — 반드시 이 순서·줄바꿈]
각 항목은 새 줄에서 시작하고, 번호와 굵은 소제목을 그대로 사용합니다.
- **본문 최상단에 단독 숫자 "0" 또는 "０"만 있는 줄, 또는 의미 없는 빈 줄을 넣지 마세요.** 첫 줄은 반드시 아래 01. 항목(또는 동일 형식)으로 시작합니다.

01. **학습 총평:** 해당 월 전반의 성실도와 성취 수준을 한 문장으로 요약합니다.

02. **데이터 분석:** 출결·숙제 이행·시험 결과가 학습과 어떻게 맞물릴 수 있는지, 제공된 수치·기록 범위 안에서만 서술합니다. 기록이 적으면 가능한 범위에서만 조용히 요약합니다(부모에게 '기록 없음'을 강조하지 않음).

03. **역량 진단:** 선생님 메모·수업 기록을 바탕으로 학습 태도와 인지적 특성(이해 방식·문제 접근 등)을 구분해 서술합니다. 메모가 없으면 점수·출결·제출 패턴만으로 말할 수 있는 범위에서 조심스럽게 작성합니다.

04. **솔루션:** 다음 달에 집중하면 좋은 학습 포인트를 구체적이되 부담스럽지 않게 제안합니다.

[금지·한도]
- 데이터에 없는 출결·제출·점수·진단을 지어내지 않습니다. 확정적 병리·라벨링·과장은 금지합니다.
- 이모지를 쓰지 않습니다.
- 총 길이는 ${EVAL_MAX_CHARS}자 이내(줄바꿈 포함)입니다.`;

    if (ownerEvalStyleNote) {
      systemInstruction +=
        `\n\n[이 학원(로그인 계정)에서 매 요청마다 부여하는 고정 지침 — 반드시 준수]\n${ownerEvalStyleNote}`;
    }

    let userPrompt = `학생: ${stu.name} (${stu.grade ?? ""}${stu.school ? `, ${stu.school}` : ""})
대상 월: ${evalMonth}

[출결 요약(해당 월, 기록 건수 기준)]
${attendanceBlock}

[숙제 제출 요약(해당 월)]
${homeworkBlock}

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
        `다음 요청을 반영해 전체를 다시 작성하세요. ${EVAL_MAX_CHARS}자 이내, 한국어, 동일 톤·금지 사항 준수.\n` +
        `항목 01~04는 각각 새 줄에서 시작하고, 위와 같은 소제목 형식을 유지합니다.\n요청: ${instr}\n\n` +
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
