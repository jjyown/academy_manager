import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// gemini-2.5-flash: 2026 시점 가성비 최적 (입력 빠름·동일 비용대 품질 ↑).
// 2.0-flash 대비 한국어 추론 안정성·지시 준수도 모두 향상.
const GEMINI_EVAL_MODEL = Deno.env.get("GEMINI_EVAL_MODEL") ?? "gemini-2.5-flash";
/** 입시 전문가 사전 분석 단계 모델 — 비싸지 않은 모델로도 충분. 환경변수로 별도 설정 가능 */
const GEMINI_ADMISSIONS_MODEL = Deno.env.get("GEMINI_ADMISSIONS_MODEL") ?? GEMINI_EVAL_MODEL;
/** Stage 1 (입시 전문가 사전 분석) 비활성화 옵션 — 환경변수로 끌 수 있음 */
const ADMISSIONS_STAGE_DISABLED = (Deno.env.get("ADMISSIONS_STAGE_DISABLED") ?? "").toLowerCase() === "true";

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

/**
 * Stage 1: 입시 전문가 사전 분석.
 * 학부모용 글을 만들기 전, 한국 대입(수시·정시·내신·모의고사) 관점으로
 * 학생 데이터를 구조화 분석한 raw 텍스트를 반환합니다.
 * Stage 2 (종합평가 본문 작성)에 컨텍스트로 주입돼 솔루션·역량 진단의 근거가 됨.
 *
 * 호출 실패 시 빈 문자열을 반환하여 Stage 2 가 단독으로 동작하도록 폴백합니다.
 */
async function runAdmissionsExpertAnalysis(args: {
  studentName: string;
  grade: string;
  school: string;
  evalMonth: string;
  attendanceBlock: string;
  homeworkBlock: string;
  scoreBlock: string;
  memoBlock: string;
  /** admissions_knowledge 에서 학년대 매칭으로 가져온 입시 정보·트렌드. 없으면 빈 문자열. */
  knowledgeBlock: string;
  /** 원장의 고정 지침 (student_eval_ai_style_entries) — Stage 2 와 동일하게 Stage 1 에도 반영 */
  ownerStyleNote: string;
}): Promise<string> {
  if (ADMISSIONS_STAGE_DISABLED) return "";
  if (!GEMINI_API_KEY) return "";

  const expertSystem = `당신은 한국 대학입시(수능·내신·수시·정시·학생부종합전형)에 정통한 20년 경력 입시 전문 컨설턴트입니다. 이 단계는 학부모에게 직접 전달되는 글이 아니라, 후속 단계의 종합평가 작성자가 참고할 **내부 분석 노트**를 만드는 단계입니다.

[역할]
- 한국 입시 맥락(학년별 우선순위·내신·모의고사·수능 트랙)을 기준으로 학생의 현재 위치와 다음 한 달의 학습 우선순위를 진단합니다.
- 학년이 명확하면 그에 맞는 입시 단계(예: 고1 내신·진로 탐색 / 고2 모의고사·내신 균형 / 고3·N수 수능·수시 마무리 / 중등 내신·기초학력 / 초등 학습 습관)를 적용합니다.
- 학년이 비어있거나 모호하면 "학년 미상 — 일반 학습 관점" 으로만 다룹니다(임의로 추정 금지).

[금지]
- 데이터에 없는 점수·출결·기록을 지어내지 않습니다.
- 확정적 진단/병리 라벨링/특정 대학 합격 가능성 단언 금지.
- 학부모에게 보일 수 있는 톤(존댓말·감성)으로 쓰지 마세요. 이건 내부 노트입니다.

[출력 형식 — 정확히 이 5개 헤더, 마크다운 없이 일반 텍스트]
[A. 입시 단계 위치] 학년 기준 현재 입시 트랙·우선순위 1~2줄.
[B. 강점 신호] 데이터에서 읽히는 강점(점수·제출·기록)을 근거와 함께 bullet(- )로 1~3개. 근거가 약하면 "근거 약함" 표시.
[C. 약점·리스크] 같은 형식, 데이터 근거 명시. 추정 금지.
[D. 다음 달 학습 우선순위] bullet 2~4개. 입시 관점에서 효과 큰 순서.
[E. 작성자 가이드] 후속 종합평가에서 학부모에게 전달할 때 강조하면 좋을 포인트·피해야 할 표현 1~3줄.

총 길이는 1200자 이내. 한국어.

[중요] 본 요청에는 "[최신 입시 정보·트렌드]" 섹션이 포함될 수 있습니다.
이는 원장이 운영하는 입시 정보 수집 모듈이 학년대별로 정리해 둔 자료로,
당신의 분석에 반드시 반영해야 합니다(특히 [A. 입시 단계 위치] / [D. 다음 달 학습 우선순위]).
단, 학생 데이터에 없는 사실을 "트렌드 자료에 따르면" 하고 가져다 붙이지 마세요 — 트렌드는 우선순위·가이드일 뿐이고 진단 근거는 학생 데이터입니다.${args.ownerStyleNote ? `

[이 학원 원장의 고정 지침 — 본 분석 노트 작성 시에도 반드시 준수]
${args.ownerStyleNote}` : ""}`;

  const expertUser = `[학생 식별]
- 이름: ${args.studentName}
- 학년: ${args.grade || "(미상)"}
- 학교: ${args.school || "(미상)"}
- 대상 월: ${args.evalMonth}

[출결 요약]
${args.attendanceBlock}

[숙제 제출 요약]
${args.homeworkBlock}

[수업·메모 기록(원문)]
${args.memoBlock}

[시험·점수(해당 월)]
${args.scoreBlock}${args.knowledgeBlock}`;

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ADMISSIONS_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: expertSystem + "\n\n" + expertUser }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    });
    if (!res.ok) {
      console.warn("[admissions-expert] Gemini HTTP", res.status, await res.text());
      return "";
    }
    const json = await res.json();
    const text =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
      "";
    return String(text || "").trim().slice(0, 4000);
  } catch (e) {
    console.warn("[admissions-expert] error", e);
    return "";
  }
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

    // ── Stage 0: 학년대 매칭으로 admissions_knowledge 로드 ─────────
    // 학생 학년 문자열을 grade_band 로 정규화 (실패 시 'all').
    const gradeStr = String(stu.grade || "").trim();
    let gradeBand = "all";
    if (gradeStr) {
      if (/(고\s*1|고1|고등\s*1|1학년.*고)/i.test(gradeStr)) gradeBand = "high1";
      else if (/(고\s*2|고2|고등\s*2|2학년.*고)/i.test(gradeStr)) gradeBand = "high2";
      else if (/(고\s*3|고3|고등\s*3|3학년.*고)/i.test(gradeStr)) gradeBand = "high3";
      else if (/(재수|N수|반수)/i.test(gradeStr)) gradeBand = "retake";
      else if (/(중\s*[1-3]|중학|중등)/i.test(gradeStr)) gradeBand = "middle";
      else if (/(초\s*[1-6]|초등)/i.test(gradeStr)) gradeBand = "elementary";
    }

    // 유효한 최신 행만 (만료 미설정 또는 오늘 이전 만료 안 됨), 학년 매칭 + 'all' 포함
    const today = new Date().toISOString().slice(0, 10);
    const { data: knowledgeRows } = await admin
      .from("admissions_knowledge")
      .select("topic_key, grade_band, title, content, source, created_at")
      .eq("owner_user_id", user.id)
      .in("grade_band", gradeBand === "all" ? ["all"] : [gradeBand, "all"])
      .or(`valid_until.is.null,valid_until.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(8);

    // 각 topic_key 의 가장 최신 1행만 (중복 제거)
    const seenTopic = new Set<string>();
    const knowledgeBlock = ((): string => {
      if (!knowledgeRows || knowledgeRows.length === 0) return "";
      const picks: typeof knowledgeRows = [];
      for (const r of knowledgeRows) {
        const k = String(r.topic_key || "");
        if (seenTopic.has(k)) continue;
        seenTopic.add(k);
        picks.push(r);
      }
      const body = picks.map((r) => {
        const tag = r.grade_band ? ` (${r.grade_band})` : "";
        return `── ${r.title}${tag}\n${String(r.content || "").trim()}`;
      }).join("\n\n");
      return body
        ? `\n\n[최신 입시 정보·트렌드 — 원장 입시 정보 수집 모듈에서 가져옴]\n${body}`
        : "";
    })();

    // ── Stage 1: 입시 전문가 사전 분석 ─────────────────────────────
    // refine 모드는 사용자가 이미 초안을 손보는 단계라 사전 분석을 건너뛰어
    // 응답 시간·비용을 아낍니다. generate 모드에서만 호출.
    let admissionsAnalysis = "";
    if (mode === "generate") {
      admissionsAnalysis = await runAdmissionsExpertAnalysis({
        studentName: String(stu.name || ""),
        grade: String(stu.grade || ""),
        school: String(stu.school || ""),
        evalMonth,
        attendanceBlock,
        homeworkBlock,
        scoreBlock,
        memoBlock,
        knowledgeBlock,
        ownerStyleNote: ownerEvalStyleNote,  // Stage 2 와 동일한 고정 지침을 Stage 1 에도 적용
      });
    }

    let systemInstruction = `당신은 15년 경력의 전문 교육 컨설턴트이자 학원 현장을 잘 아는 베테랑입니다. 아래 제공된 학생 데이터만을 바탕으로 학부모에게 발송할 「월간 학업 성취 리포트」를 작성합니다.

[역할·톤]
- 학부모가 "체계적으로 관리받는다"고 느낄 수 있도록 전문적이면서도 따뜻하고 격려하는 톤을 유지합니다.
- 문장은 한국어 존댓말(~습니다 / ~합니다 체)로 통일합니다.
- 객관 데이터(출결·숙제 제출·시험 점수)를 먼저 반영한 뒤, 선생님 메모의 정성적 관찰을 자연스럽게 녹입니다.
- 수치·항목을 기계적으로 나열하지 말고, 접속사와 요약 문장으로 문단이 이어지게 씁니다.

[입시 전문가 사전 분석 — 후속 작성에 반드시 반영]
- 본 요청에는 별도로 한국 입시 전문 컨설턴트가 사전 작성한 「내부 분석 노트」가 첨부될 수 있습니다(섹션명: [입시 전문가 사전 분석]).
- 분석 노트는 학부모에게 그대로 전달되는 글이 아니라, 작성자가 「02. 데이터 분석 / 03. 역량 진단 / 04. 솔루션」을 쓸 때 **근거·우선순위·표현 가이드**로 활용해야 합니다.
- 노트의 "[D. 다음 달 학습 우선순위]" 항목은 「04. 솔루션」의 핵심 줄기로 반영하되, 부모님 입장에서 부담스럽지 않게 풀어쓰세요.
- 노트의 "[E. 작성자 가이드]"에서 권장한 강조점·피해야 할 표현은 그대로 따릅니다.
- 단, 학부모용 본문에는 "입시 전문가 분석에 따르면", "내부 노트", "사전 분석" 같은 메타 표현을 절대 쓰지 마세요. 분석은 보이지 않게 녹여 넣습니다.

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

    const admissionsBlock = admissionsAnalysis
      ? `\n\n[입시 전문가 사전 분석 — 학부모용 글이 아닌 내부 노트, 본문에 직접 인용 금지]\n${admissionsAnalysis}`
      : "";

    let userPrompt = `학생: ${stu.name} (${stu.grade ?? ""}${stu.school ? `, ${stu.school}` : ""})
대상 월: ${evalMonth}

[출결 요약(해당 월, 기록 건수 기준)]
${attendanceBlock}

[숙제 제출 요약(해당 월)]
${homeworkBlock}

[수업·메모 기록]
${memoBlock}

[시험·점수]
${scoreBlock}${admissionsBlock}`;

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
