// =====================================================================
// collect-admissions-knowledge
//
// 한국 입시 전문 매체(kyobit.com + veritas-a.com)에서 입시·교육 관련
// 섹션을 스크래핑해 학년대별로 정리한 「입시 정보·트렌드」를
// admissions_knowledge 에 누적 저장합니다.
// 종합평가 AI Stage 1 (입시 전문가 사전 분석) 의 컨텍스트로 자동 주입됨.
//
// 학원이 중·고 중심이라 학년대별 소스 가중치를 비대칭으로 설정:
//   - elementary: 1소스(가벼움)
//   - middle:     2소스
//   - high1·2:    4소스
//   - high3·재수: 5소스(가장 두꺼움 — 입결·등급컷·대학 정보)
//
// 호출 모드:
//   - 'auto'    (기본): 두 사이트 다중 섹션 스크래핑 → Gemini 1회 호출 → 6학년대 일괄 저장
//   - 'manual'  : Gemini 미호출, 사용자 입력(title/content) 그대로 저장
//
// 인증:
//   - Bearer 세션 토큰(원장 본인 호출)
//   - 또는 x-cron-secret 헤더 (=== Deno.env CRON_SECRET) + x-target-owner UUID — pg_cron 용
//
// 응답: { ok: true, inserted: N, scraped: K, rows: [...] } 또는 에러
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
const ALL_BANDS: GradeBand[] = ["elementary", "middle", "high1", "high2", "high3", "retake"];

const BAND_LABEL: Record<GradeBand, string> = {
    elementary: "초등",
    middle: "중등",
    high1: "고1",
    high2: "고2",
    high3: "고3",
    retake: "재수·N수",
};

interface ScrapedArticle {
    site: string;        // 'kyobit' | 'veritas'
    section: string;     // sc_section_code 또는 sc_sub_section_code 값
    sectionLabel: string;
    title: string;
    url: string;
    date: string;
}

interface SiteSection {
    site: "kyobit" | "veritas";
    base: string;
    paramKey: "sc_section_code" | "sc_sub_section_code";
    code: string;
    label: string;
    relevantBands: GradeBand[];
}

const KYOBIT_BASE = "https://www.kyobit.com";
const VERITAS_BASE = "https://www.veritas-a.com";

/**
 * 두 사이트 통합 섹션 매핑.
 * 같은 기사가 여러 학년대에 매칭될 수 있고, 학년대별 소스 두께가 의도적으로 다름:
 *   - 초등은 1소스, 중등은 2소스, 고1·고2는 4소스, 고3·재수는 5소스
 */
const SITE_SECTIONS: SiteSection[] = [
    // ── kyobit.com ──
    { site: "kyobit", base: KYOBIT_BASE, paramKey: "sc_section_code", code: "S1N1",  label: "kyobit 대입",     relevantBands: ["high1", "high2", "high3", "retake"] },
    { site: "kyobit", base: KYOBIT_BASE, paramKey: "sc_section_code", code: "S1N2",  label: "kyobit 고입",     relevantBands: ["middle"] },
    { site: "kyobit", base: KYOBIT_BASE, paramKey: "sc_section_code", code: "S1N3",  label: "kyobit 초등교육", relevantBands: ["elementary"] },
    { site: "kyobit", base: KYOBIT_BASE, paramKey: "sc_section_code", code: "S1N8",  label: "kyobit 진로탐색", relevantBands: ["high1", "high2", "high3", "retake"] },
    { site: "kyobit", base: KYOBIT_BASE, paramKey: "sc_section_code", code: "S1N10", label: "kyobit 대학교육", relevantBands: ["high3", "retake"] },

    // ── veritas-a.com (입시 전문지, 데이터 깊이 있음) ──
    { site: "veritas", base: VERITAS_BASE, paramKey: "sc_section_code",     code: "S1N2",  label: "veritas 대입",         relevantBands: ["high1", "high2", "high3", "retake"] },
    { site: "veritas", base: VERITAS_BASE, paramKey: "sc_section_code",     code: "S1N4",  label: "veritas 고입",         relevantBands: ["middle"] },
    { site: "veritas", base: VERITAS_BASE, paramKey: "sc_section_code",     code: "S1N5",  label: "veritas 고교",         relevantBands: ["high1", "high2"] },
    { site: "veritas", base: VERITAS_BASE, paramKey: "sc_section_code",     code: "S1N3",  label: "veritas 대학",         relevantBands: ["high3", "retake"] },
    { site: "veritas", base: VERITAS_BASE, paramKey: "sc_sub_section_code", code: "S2N10", label: "veritas 수능/모의고사", relevantBands: ["high2", "high3", "retake"] },
];

interface Body {
    mode?: "auto" | "manual";
    gradeBand?: GradeBand | "all";
    title?: string;
    content?: string;
    validUntil?: string;
}

interface KnowledgeRow {
    topic_key: string;
    grade_band: string;
    title: string;
    content: string;
    source: string;
    valid_from: string;
    valid_until: string | null;
}

/** 간단한 HTML → 텍스트 (스크립트·스타일 제거 + 태그 제거 + 공백 정규화) */
function htmlToText(html: string): string {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * articleList 페이지 HTML 에서 기사 메타(idxno, 제목)를 추출.
 * kyobit·베리타스알파 모두 동일 CMS 패턴 사용.
 */
function parseArticleListHtml(html: string, site: string, sectionCode: string, sectionLabel: string, max: number, base: string): ScrapedArticle[] {
    const items: ScrapedArticle[] = [];
    const seen = new Set<string>();
    const linkRe = /<a[^>]+href="([^"]*\/news\/articleView\.html\?idxno=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
        const url = m[1];
        const idxno = m[2];
        const titleHtml = m[3];
        const title = htmlToText(titleHtml);
        if (!title || title.length < 5) continue;
        if (seen.has(idxno)) continue;
        seen.add(idxno);
        const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
        items.push({
            site,
            section: sectionCode,
            sectionLabel,
            title: title.slice(0, 200),
            url: fullUrl,
            date: "",
        });
        if (items.length >= max) break;
    }
    return items;
}

/** 한 섹션 list 페이지 fetch → 기사 목록 추출. 실패 시 []. */
async function scrapeOneSection(s: SiteSection, maxArticles: number): Promise<ScrapedArticle[]> {
    const url = `${s.base}/news/articleList.html?${s.paramKey}=${s.code}&view_type=sm`;
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (academy-manager admissions-knowledge collector)",
                "Accept": "text/html",
                "Accept-Language": "ko-KR,ko;q=0.9",
            },
        });
        if (!res.ok) {
            console.warn(`[scrape] ${s.label} HTTP ${res.status}`);
            return [];
        }
        const html = await res.text();
        return parseArticleListHtml(html, s.site, s.code, s.label, maxArticles, s.base);
    } catch (e) {
        console.warn(`[scrape] ${s.label} fetch err`, e);
        return [];
    }
}

/**
 * 기사 view 페이지에서 본문(article-view-content-div) 추출.
 * 두 사이트 모두 동일 CMS 사용. 실패 시 빈 문자열.
 */
async function fetchArticleBody(url: string): Promise<string> {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (academy-manager admissions-knowledge collector)",
                "Accept": "text/html",
                "Accept-Language": "ko-KR,ko;q=0.9",
            },
        });
        if (!res.ok) return "";
        const html = await res.text();
        // article-view-content-div ~ article-sns 사이를 본문으로 간주
        // (article-sns 가 없으면 끝까지)
        const startIdx = html.indexOf('id="article-view-content-div"');
        if (startIdx < 0) return "";
        const endMarker = html.indexOf('id="article-sns"', startIdx);
        const slice = endMarker > 0
            ? html.slice(startIdx, endMarker)
            : html.slice(startIdx, startIdx + 20000);
        // figure / figcaption / iframe / 광고성 div 제거 후 텍스트화
        const cleaned = slice
            .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
            .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");
        return htmlToText(cleaned).slice(0, 1200);
    } catch (e) {
        console.warn(`[fetchBody] err`, e);
        return "";
    }
}

/**
 * 풀에 담긴 기사들의 본문을 동시에 fetch (concurrency 제한).
 * url 별로 캐시해 중복 fetch 방지.
 */
async function fetchBodiesParallel(urls: string[], concurrency: number, perUrlCache: Map<string, string>): Promise<void> {
    const queue = urls.filter((u) => !perUrlCache.has(u));
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= queue.length) return;
            const url = queue[i];
            const body = await fetchArticleBody(url);
            perUrlCache.set(url, body);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

/** 모든 섹션 병렬 스크래핑 → 학년대별로 분류한 기사 묶음 반환 */
async function scrapeAllSections(maxPerSection: number): Promise<{
    byBand: Record<GradeBand, ScrapedArticle[]>;
    sourcesAll: ScrapedArticle[];
}> {
    const all = await Promise.all(
        SITE_SECTIONS.map((s) => scrapeOneSection(s, maxPerSection).then((arts) => ({ section: s, arts }))),
    );
    const byBand: Record<GradeBand, ScrapedArticle[]> = {
        elementary: [], middle: [], high1: [], high2: [], high3: [], retake: [],
    };
    const sourcesAll: ScrapedArticle[] = [];
    for (const { section, arts } of all) {
        for (const art of arts) {
            sourcesAll.push(art);
            for (const band of section.relevantBands) {
                byBand[band].push(art);
            }
        }
    }
    // 같은 학년대에 여러 사이트의 같은 기사가 들어가는 경우는 없으나,
    // 학년대 내에서 너무 많이 쌓이면 프롬프트가 부푸므로 학년대별 상한.
    const PER_BAND_CAP = 18;
    for (const band of ALL_BANDS) {
        if (byBand[band].length > PER_BAND_CAP) {
            byBand[band] = byBand[band].slice(0, PER_BAND_CAP);
        }
    }
    return { byBand, sourcesAll };
}

interface BandSummary {
    band: GradeBand;
    title: string;
    content: string;
}

/**
 * 스크래핑한 기사 목록을 Gemini 1회 호출로 6학년대 분량 요약 텍스트 생성.
 * 응답을 학년대별로 파싱해 BandSummary[] 반환.
 *
 * @param byBand 학년대별 기사 메타
 * @param bodyByUrl URL→본문 캐시 (있는 기사만 본문 포함)
 */
async function summarizeWithGemini(
    byBand: Record<GradeBand, ScrapedArticle[]>,
    bodyByUrl: Map<string, string>,
): Promise<BandSummary[]> {
    if (!GEMINI_API_KEY) return [];

    const today = new Date().toISOString().slice(0, 10);

    // 학년대별 기사 묶음을 프롬프트에 정리 (제목 + 본문 발췌)
    const sourcesText = ALL_BANDS.map((band) => {
        const arts = byBand[band];
        if (arts.length === 0) return `## [${BAND_LABEL[band]} (${band})] 관련 기사 없음 — 일반 입시 원칙으로만 작성`;
        const lines = arts.map((a, i) => {
            const body = bodyByUrl.get(a.url) || "";
            const head = `[${i + 1}] [${a.site}/${a.sectionLabel}] ${a.title}`;
            const excerpt = body ? `\n   본문발췌: ${body.slice(0, 600)}` : "";
            return head + excerpt;
        }).join("\n");
        return `## [${BAND_LABEL[band]} (${band})] 최근 기사 ${arts.length}건 (제목 + 본문 발췌):\n${lines}`;
    }).join("\n\n");

    const systemPrompt = `당신은 한국 대학입시(수능·내신·수시·정시·학생부종합전형)에 정통한 20년 경력 입시 전문 컨설턴트입니다.

[작업]
학원 원장이 학생 종합평가에 활용할 수 있도록, 아래 두 입시 전문 매체 (kyobit.com, veritas-a.com) 에서 스크래핑한 최신 기사 (제목 + 본문 발췌) 들을 학년대별로 분석해 「학습 우선순위·평가 데이터·약점 패턴·학부모 소통 포인트」를 정리합니다.

[학원 환경]
- 본 학원은 중·고등학생을 주 대상으로 합니다. 따라서 high1/high2/high3/retake/middle 의 분석 깊이를 충실히, elementary 는 가벼운 수준으로 작성하세요.

[원칙]
- 본문 발췌가 첨부된 기사는 발췌의 구체 데이터(등급컷·전형 변경·일정 등) 를 우선 활용하세요. 제목만 있는 기사는 제목에서 추세를 읽으세요.
- 데이터에 없는 사실(특정 점수, 합격선 단언 등)을 지어내지 마세요. 본문에 없는 수치를 추정하지 마세요.
- 학년대별로 명확히 구분된 내용만 쓰세요(예: 고1 섹션에 고3 정시 얘기 X).
- ${today} 기준으로 통상 유효한 입시 일반 원칙도 함께 녹여 주세요(기사가 적은 학년대에서 특히).
- veritas 출처 기사는 입결·등급컷·전형 변경 등 정량·구조 정보가 많고, kyobit 기사는 일반 교육 트렌드 위주임을 활용하세요.
- 동일 주제가 여러 기사에 나오면 가장 최신·구체적인 본문 정보를 우선하세요.

[출력 형식 — 반드시 이 형식, 다른 텍스트·메타 설명 없이]
각 학년대 블록을 아래 헤더로 시작:

=== [BAND:elementary] ===
[1. 학습 우선순위] ...
[2. 평가에 자주 쓰이는 데이터] ...
[3. 흔한 약점·리스크 패턴] ...
[4. 학부모와의 소통 포인트] ...

=== [BAND:middle] ===
(같은 4섹션)

=== [BAND:high1] ===
(같은 4섹션)

=== [BAND:high2] ===
(같은 4섹션)

=== [BAND:high3] ===
(같은 4섹션)

=== [BAND:retake] ===
(같은 4섹션)

각 학년대 블록은 800자 이내. 한국어. 마크다운 헤더(##) 쓰지 마세요.`;

    const userPrompt = `[스크래핑 시점] ${today}\n[출처] kyobit.com (교육을 비추다) + veritas-a.com (베리타스알파)\n\n${sourcesText}\n\n위 정보를 바탕으로 6개 학년대별 입시 정보·트렌드 메모를 작성해주세요. (학원 주 대상은 중·고이므로 elementary 는 간략히)`;

    try {
        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ADMISSIONS_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
            }),
        });
        if (!res.ok) {
            console.warn("[summarize] Gemini HTTP", res.status, await res.text());
            return [];
        }
        const j = await res.json();
        const fullText = String(
            j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "",
        ).trim();
        if (!fullText) return [];

        // 학년대 블록 파싱
        const summaries: BandSummary[] = [];
        const re = /=== \[BAND:(elementary|middle|high1|high2|high3|retake)\] ===([\s\S]*?)(?=(=== \[BAND:|$))/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(fullText)) !== null) {
            const band = m[1] as GradeBand;
            const body = m[2].trim();
            if (!body) continue;
            summaries.push({
                band,
                title: `${BAND_LABEL[band]} 입시 트렌드 (kyobit ${today})`,
                content: body.slice(0, 4000),
            });
        }
        return summaries;
    } catch (e) {
        console.warn("[summarize] error", e);
        return [];
    }
}

function defaultValidUntil(): string {
    // 주 1회 갱신 가정 → 14일 유효(다음 갱신 한 번 미스해도 폴백 가능)
    const d = new Date();
    d.setDate(d.getDate() + 14);
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

        // ── manual 모드 ──────────────────────────────────────────────
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

        // ── auto 모드: kyobit 스크래핑 → Gemini 요약 → 일괄 저장 ────
        if (!GEMINI_API_KEY) {
            return new Response(JSON.stringify({ ok: false, error: "gemini_not_configured" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { byBand, sourcesAll } = await scrapeAllSections(8);
        if (sourcesAll.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "scrape_failed", detail: "kyobit.com / veritas-a.com 응답 없음 또는 구조 변경" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── 본문 수집 (학년대별 상위 기사들의 body) ─────────────────
        // 같은 url 이 여러 학년대에 매칭될 수 있으므로 dedupe.
        // 학년대별 상위 N건만 fetch 해 비용·시간 제어.
        const PER_BAND_FETCH = 4;
        const targetUrls = new Set<string>();
        for (const band of ALL_BANDS) {
            const arts = byBand[band] || [];
            for (let i = 0; i < Math.min(arts.length, PER_BAND_FETCH); i++) {
                targetUrls.add(arts[i].url);
            }
        }
        const bodyCache = new Map<string, string>();
        await fetchBodiesParallel(Array.from(targetUrls), 6, bodyCache);
        const bodiesFetched = Array.from(bodyCache.values()).filter((b) => b.length > 100).length;

        const summaries = await summarizeWithGemini(byBand, bodyCache);
        if (summaries.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "summarize_failed" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 출처 URL 목록을 content 끝에 부록으로 첨부 (학원 원장이 클릭해 학습할 수 있도록)
        const sourceUrlsByBand: Record<string, string[]> = {};
        for (const band of ALL_BANDS) {
            sourceUrlsByBand[band] = (byBand[band] || []).slice(0, 12)
                .map((a) => `- [${a.site}] ${a.title}\n  ${a.url}`);
        }

        const rowsToInsert: (KnowledgeRow & { owner_user_id: string })[] = summaries.map((s) => {
            const today = new Date().toISOString().slice(0, 10);
            const updatedTitle = `${BAND_LABEL[s.band]} 입시 트렌드 (${today})`;
            const sourcesAppendix = sourceUrlsByBand[s.band].length
                ? `\n\n[참고 기사 — kyobit.com / veritas-a.com]\n${sourceUrlsByBand[s.band].join("\n")}`
                : "";
            return {
                owner_user_id: ownerId,
                topic_key: `auto_${s.band}_trend`,
                grade_band: s.band,
                title: updatedTitle.slice(0, 200),
                content: (s.content + sourcesAppendix).slice(0, 8000),
                source: "auto_scrape",
                valid_from: validFrom,
                valid_until: validUntil,
            };
        });

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
            JSON.stringify({
                ok: true,
                inserted: data?.length ?? 0,
                scraped: sourcesAll.length,
                bodiesFetched,
                rows: data ?? [],
            }),
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
