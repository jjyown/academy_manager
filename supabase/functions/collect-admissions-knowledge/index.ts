// =====================================================================
// collect-admissions-knowledge
//
// 종합평가 AI 보강용 「입시 정보·트렌드」를 학년대(grade_band) 별로
// Gemini 로 생성해 admissions_knowledge 테이블에 누적합니다.
//
// 호출 모드:
//   - 'auto'    (기본): 학년대 전체(elementary~retake)에 대해 한 번에 생성
//   - 'single' : grade_band 1개만 생성 (body.gradeBand 필수)
//   - 'manual' : Gemini 호출 없이 사용자가 보낸 title/content 를 그대로 저장
//                  (body.title, body.content, body.gradeBand 필수)
//
// 인증:
//   - Bearer 세션 토큰(원장 본인 호출) — 표준 경로
//   - 또는 Service Role Key 헤더 'x-cron-secret' (=== Deno.env CRON_SECRET) — 스케줄러용
//
// 응답: { ok: true, inserted: N, rows: [...] } 또는 에러
// =====================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_ADMISSIONS_MODEL = Deno.env.get("GEMINI_ADMISSIONS_MODEL")
    ?? Deno.env.get("GEMINI_EVAL_MODEL")
    ?? "gemini-2.0-flash";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, x-cron-secret, x-target-owner",
    "Access-Control-Max-Age": "86400",
};

type GradeBand = "elementary" | "middle" | "high1" | "high2" | "high3" | "retake";

const GRADE_BAND_DESC: Record<GradeBand, string> = {
    elementary: "초등학생 — 학습 습관·기초 학력·문해력·집중력 형성기",
    middle: "중학생 — 내신·자유학기·기초 학력 정착·고등 진학 대비",
    high1: "고1 — 내신 첫 학기 임팩트·진로 탐색·학생부 시작",
    high2: "고2 — 모의고사 본격화·내신과 모의고사 균형·학생부종합전형 준비",
    high3: "고3 — 수시 마감·정시 마무리·수능 준비·재수 결정",
    retake: "재수·N수 — 정시 중심·수능 영역별 전략·멘탈 관리",
};

const ALL_BANDS: GradeBand[] = ["elementary", "middle", "high1", "high2", "high3", "retake"];

interface KnowledgeRow {
    topic_key: string;
    grade_band: string;
    title: string;
    content: string;
    source: string;
    valid_from: string;
    valid_until: string | null;
}

interface Body {
    mode?: "auto" | "single" | "manual";
    gradeBand?: GradeBand;
    title?: string;
    content?: string;
    /** ISO date. 미지정 시 NOW + 60일. */
    validUntil?: string;
}

/** 학년대 1개에 대해 Gemini로 입시 정보 콘텐츠 생성. 실패 시 null. */
async function generateForBand(band: GradeBand): Promise<{ title: string; content: string } | null> {
    if (!GEMINI_API_KEY) return null;

    const today = new Date().toISOString().slice(0, 10);
    const ym = today.slice(0, 7);
    const desc = GRADE_BAND_DESC[band];

    const systemPrompt = `당신은 한국 대학입시(수능·내신·수시·정시·학생부종합전형)에 정통한 20년 경력 입시 전문 컨설턴트입니다. 학원 원장의 종합평가 AI 가 학년별 분석에 사용할 「입시 정보·트렌드 메모」를 작성합니다.

[대상 학년대]
${band} — ${desc}

[작성 원칙]
- 한국 입시 맥락(수능·내신·수시·정시·학생부종합) 기준.
- ${ym} 시점에 통상적으로 유효한 정보 위주로, 구체적이지만 장황하지 않게.
- 개별 학생을 다루는 글이 아닙니다. 이 학년대 전체에 적용 가능한 "공통 가이드"입니다.
- 학원 원장이 학생 분석 시 참고할 수 있도록 핵심 원칙·우선순위 위주.
- 추측·과장·특정 대학 합격 단언 금지.
- 학년대가 명확히 다른 내용(예: 고1 글에 고3 정시 얘기)을 섞지 마세요.

[출력 형식 — 정확히 이 4개 헤더, 마크다운 헤더 표시 없이 일반 텍스트]
[1. 학습 우선순위] 이 학년대에 이번 학기·학년에 무게를 두어야 할 영역 3~5개. bullet(- ).
[2. 평가에 자주 쓰이는 데이터] 이 학년대에서 학생 평가 시 의미 있게 보는 지표(예: 모의고사 등급, 내신 추세, 수행 평가 등) 2~4개.
[3. 흔한 약점·리스크 패턴] 이 시기 학생들에게 자주 나타나는 학습 리스크 2~4개.
[4. 학부모와의 소통 포인트] 학부모에게 전달할 때 강조하면 좋은 1~2가지.

총 길이 800자 이내. 한국어. 첫 줄은 반드시 [1. ... 로 시작.`;

    try {
        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ADMISSIONS_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }],
                generationConfig: { temperature: 0.5, maxOutputTokens: 1500 },
            }),
        });
        if (!res.ok) {
            console.warn(`[collect-admissions-knowledge] ${band} HTTP`, res.status, await res.text());
            return null;
        }
        const j = await res.json();
        const text = String(
            j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "",
        ).trim();
        if (!text) return null;

        return {
            title: `${band} 입시 정보·트렌드 (${today})`,
            content: text.slice(0, 4000),
        };
    } catch (e) {
        console.warn(`[collect-admissions-knowledge] ${band} error`, e);
        return null;
    }
}

function defaultValidUntil(): string {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().slice(0, 10);
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
            return new Response(JSON.stringify({ ok: false, error: "supabase_env_missing" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // ── 인증: Bearer 세션 또는 x-cron-secret ─────────────────────
        const authHeader = req.headers.get("Authorization") ?? "";
        const cronHeader = req.headers.get("x-cron-secret") ?? "";
        const targetOwnerHeader = req.headers.get("x-target-owner") ?? "";

        let ownerId = "";

        if (authHeader.startsWith("Bearer ")) {
            const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: { user }, error } = await userClient.auth.getUser();
            if (error || !user) {
                return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            ownerId = user.id;
        } else if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET) {
            // 스케줄러 호출: x-target-owner UUID 필수
            if (!targetOwnerHeader) {
                return new Response(JSON.stringify({ ok: false, error: "cron_target_owner_missing" }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            ownerId = String(targetOwnerHeader).trim();
        } else {
            return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = (await req.json().catch(() => ({}))) as Body;
        const mode = body.mode || "auto";

        const validFrom = new Date().toISOString().slice(0, 10);
        const validUntil = body.validUntil || defaultValidUntil();

        // ── manual 모드: Gemini 미호출, 입력 그대로 저장 ─────────────
        if (mode === "manual") {
            const title = String(body.title || "").trim();
            const content = String(body.content || "").trim();
            const band = String(body.gradeBand || "all").trim();
            if (!title || !content) {
                return new Response(JSON.stringify({ ok: false, error: "manual_missing" }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const row: KnowledgeRow = {
                topic_key: `manual_${band}`,
                grade_band: band,
                title: title.slice(0, 200),
                content: content.slice(0, 8000),
                source: "manual",
                valid_from: validFrom,
                valid_until: validUntil,
            };
            const { data, error } = await admin
                .from("admissions_knowledge")
                .insert({ ...row, owner_user_id: ownerId })
                .select("id, topic_key, grade_band, title, created_at")
                .single();
            if (error) {
                console.error("[collect-admissions-knowledge] manual insert", error);
                return new Response(JSON.stringify({ ok: false, error: "db_insert_failed" }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            return new Response(JSON.stringify({ ok: true, inserted: 1, rows: [data] }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── auto / single 모드: Gemini 호출 ─────────────────────────
        if (!GEMINI_API_KEY) {
            return new Response(JSON.stringify({ ok: false, error: "gemini_not_configured" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const targetBands: GradeBand[] = mode === "single"
            ? (body.gradeBand && ALL_BANDS.includes(body.gradeBand) ? [body.gradeBand] : [])
            : ALL_BANDS;
        if (targetBands.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "invalid_grade_band" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 병렬 생성 (학년대 6개)
        const generated = await Promise.all(targetBands.map((b) => generateForBand(b).then((r) => ({ band: b, r }))));

        const rowsToInsert: (KnowledgeRow & { owner_user_id: string })[] = [];
        for (const g of generated) {
            if (!g.r) continue;
            rowsToInsert.push({
                owner_user_id: ownerId,
                topic_key: `auto_${g.band}_trend`,
                grade_band: g.band,
                title: g.r.title.slice(0, 200),
                content: g.r.content,
                source: "ai_generated",
                valid_from: validFrom,
                valid_until: validUntil,
            });
        }
        if (rowsToInsert.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "all_generations_failed" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { data, error } = await admin
            .from("admissions_knowledge")
            .insert(rowsToInsert)
            .select("id, topic_key, grade_band, title, created_at");
        if (error) {
            console.error("[collect-admissions-knowledge] auto insert", error);
            return new Response(JSON.stringify({ ok: false, error: "db_insert_failed" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(
            JSON.stringify({ ok: true, inserted: data?.length ?? 0, rows: data ?? [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (e) {
        console.error("[collect-admissions-knowledge]", e);
        return new Response(JSON.stringify({ ok: false, error: "internal" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
