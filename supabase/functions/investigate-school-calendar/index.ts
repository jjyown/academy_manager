// =====================================================================
// investigate-school-calendar
//
// NEIS Open API 에 학사일정이 누락된 학교(특히 자체 시험·방학 미게재)
// 의 공식 홈페이지를 조사해 보강 일정을 school_calendar_overrides 에
// 저장합니다.
//
// 처리 흐름:
//   1) Naver 검색으로 '{학교명} 학사일정' 결과에서 공식 홈페이지(.go.kr/
//      .es.kr 등 교육 도메인) 링크를 탐지
//   2) 1순위로 학사일정 관련 페이지(학사일정·연간행사·월별행사)를,
//      못 찾으면 학교 홈페이지 자체를 fetch 해 텍스트화
//   3) 텍스트를 Gemini 에게 넘겨 「현재 학년도(2026 봄학기) 기준
//      앞으로 12개월 분량의 학사일정」을 JSON 으로 추출
//   4) 추출 결과를 school_calendar_overrides 에 upsert
//
// 인증: Bearer 세션 토큰(원장 본인 호출) — anon/서비스 키 단독 호출 거부.
//      investigated_by 컬럼에 호출자 UUID 를 기록.
//
// 응답: { ok, schoolName, sourceUrls, inserted, updated, total, events,
//         strategy, debug? } 또는 { ok:false, error, ... }
// =====================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_SCHOOL_CALENDAR_MODEL")
    ?? Deno.env.get("GEMINI_ADMISSIONS_MODEL")
    ?? Deno.env.get("GEMINI_EVAL_MODEL")
    ?? "gemini-2.5-flash";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
    "Access-Control-Max-Age": "86400",
};

interface SchoolInput {
    atpt?: string;
    code?: string;
    name?: string;
    region?: string;
}

interface ExtractedEvent {
    date: string;       // YYYY-MM-DD
    name: string;       // 예: '1학기 중간고사'
    content: string;    // 상세
    kind: "exam" | "vacation" | "event" | "other";
}

interface FetchedPage {
    url: string;
    title: string;
    text: string;
}

// ── 공통 유틸 ───────────────────────────────────────────────────────
function htmlToText(html: string): string {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(br|p|li|div|tr|td|th|h\d)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function _abs(url: string, base: string): string {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    try {
        return new URL(url, base).toString();
    } catch (_e) {
        return "";
    }
}

const COMMON_HEADERS: HeadersInit = {
    "User-Agent": "Mozilla/5.0 (academy-manager school-calendar-investigator)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
};

async function safeFetch(url: string, timeoutMs: number): Promise<string> {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: COMMON_HEADERS, signal: ctl.signal });
        if (!res.ok) return "";
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("text") && !ct.includes("html") && !ct.includes("xml")) return "";
        return await res.text();
    } catch (_e) {
        return "";
    } finally {
        clearTimeout(tm);
    }
}

// ── 1) Naver 검색으로 공식 홈페이지 후보 추출 ───────────────────────
// 한국 학교 도메인 패턴: *.go.kr / *.es.kr / *.ms.kr / *.hs.kr
// (구 *.sen.go.kr / *.gen.go.kr / *.ice.go.kr 등도 포함)
const KOREAN_SCHOOL_DOMAIN_RE = /\.(go\.kr|es\.kr|ms\.kr|hs\.kr|sc\.kr)(\/|$)/i;
// 입시 매체·뉴스 같은 노이즈는 제거
const NOISE_DOMAINS = [
    "blog.naver.com", "cafe.naver.com", "tistory.com", "kin.naver.com",
    "wikipedia.org", "namu.wiki", "veritas-a.com", "kyobit.com",
    "youtube.com", "facebook.com", "instagram.com", "n.news.naver.com",
];

function isLikelySchoolHomepage(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (NOISE_DOMAINS.some((d) => lower.includes(d))) return false;
    return KOREAN_SCHOOL_DOMAIN_RE.test(url);
}

async function naverSearchSchoolHomepage(schoolName: string): Promise<string[]> {
    const q = encodeURIComponent(`${schoolName} 학사일정`);
    const url = `https://m.search.naver.com/search.naver?query=${q}`;
    const html = await safeFetch(url, 8000);
    if (!html) return [];
    // 모바일 네이버는 a 태그 href 에 외부 링크가 'http://...' 로 그대로 노출됨
    const seen = new Set<string>();
    const out: string[] = [];
    const linkRe = /href="(https?:\/\/[^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
        const u = m[1];
        if (seen.has(u)) continue;
        if (!isLikelySchoolHomepage(u)) continue;
        seen.add(u);
        out.push(u);
        if (out.length >= 6) break;
    }
    return out;
}

// ── 2) 학교 홈페이지에서 '학사일정' 페이지 후보 추출 ────────────────
// 학교 홈페이지는 보통 menu/iframe 으로 학사일정을 노출. 본문 a/iframe 의
// href 중 학사·일정·연간행사·월별행사 키워드를 포함하는 것 우선.
const SCHEDULE_LINK_KEYWORDS = [
    "학사일정", "학사 일정", "연간행사", "월별행사", "월별 행사",
    "학교일정", "학교 일정", "연간일정", "행사일정",
];

function extractScheduleLinks(html: string, baseUrl: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    // a 태그 with text containing keyword
    const linkRe = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        const text = htmlToText(m[2]);
        if (!text || text.length > 60) continue;
        if (!SCHEDULE_LINK_KEYWORDS.some((k) => text.includes(k))) continue;
        const abs = _abs(href, baseUrl);
        if (!abs || seen.has(abs)) continue;
        seen.add(abs);
        out.push(abs);
        if (out.length >= 5) break;
    }
    // iframe src 도 후보 (학교 홈페이지가 외부 학사일정 시스템 임베드 시)
    const iframeRe = /<iframe[^>]+src="([^"#]+)"/gi;
    while ((m = iframeRe.exec(html)) !== null) {
        const href = m[1];
        const abs = _abs(href, baseUrl);
        if (!abs || seen.has(abs)) continue;
        // 키워드 추정이 어렵지만 학사 시스템 임베드인지 URL 으로 확인
        if (/(schedule|calendar|haksa|행사|일정)/i.test(href)) {
            seen.add(abs);
            out.push(abs);
            if (out.length >= 8) break;
        }
    }
    return out;
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
    const html = await safeFetch(url, 10000);
    if (!html) return null;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 120) : "";
    return { url, title, text: htmlToText(html) };
}

// ── 3-shared) Gemini 응답을 ExtractedEvent[] 로 파싱 ─────────────────
// 두 추출 경로(웹 페이지 텍스트 / 업로드 파일)가 공통으로 사용.
function _parseGeminiEventsResponse(fullText: string): ExtractedEvent[] {
    if (!fullText) return [];
    const cleaned = fullText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: { events?: unknown };
    try {
        parsed = JSON.parse(cleaned);
    } catch (_e) {
        console.warn("[investigate] Gemini JSON parse failed:", cleaned.slice(0, 200));
        return [];
    }
    const arr = Array.isArray(parsed?.events) ? parsed.events as unknown[] : [];
    const events: ExtractedEvent[] = [];
    for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const date = String(o.date || "").trim();
        const name = String(o.name || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!name) continue;
        const kindRaw = String(o.kind || "event").trim();
        const kind = (["exam", "vacation", "event", "other"].includes(kindRaw)
            ? kindRaw : "event") as ExtractedEvent["kind"];
        events.push({
            date,
            name: name.slice(0, 80),
            content: String(o.content || "").trim().slice(0, 200),
            kind,
        });
        if (events.length >= 80) break;
    }
    return events;
}

// 공통 추출 규칙 — 두 추출 경로에서 동일 시스템 프롬프트 사용.
function _buildExtractionSystemPrompt(schoolName: string): string {
    const today = new Date().toISOString().slice(0, 10);
    const year = new Date().getFullYear();
    return `당신은 한국 학교의 학사일정을 정확히 추출하는 정보 추출 엔진입니다.

[작업]
"${schoolName}" 의 학사일정 자료를 분석해, ${today} 기준으로 「앞으로 12개월 이내 / 지난 1개월 이내」 범위의 학사일정을 JSON 으로 추출합니다.

[출력 형식 — 오직 JSON, 다른 텍스트·코드블록 없음]
{
  "events": [
    { "date": "YYYY-MM-DD", "name": "행사명", "content": "상세(없으면 빈 문자열)", "kind": "exam|vacation|event|other" }
    ...
  ]
}

[추출 규칙]
- date 는 반드시 YYYY-MM-DD. 범위로 적힌 일정(예: 6/24~6/28) 은 각 날짜로 분해해 개별 행으로 펼침. 단 7일 이상의 긴 일정(방학·여름방학 등) 은 시작일·종료일 두 행으로만 표기.
- name 은 30자 이내 짧은 한국어. '제 1차 지필평가' / '여름방학 시작' / '체육대회' 등.
- kind 는 시험(중간/기말/지필/수행 포함)=exam, 방학(여름/겨울/봄/짧은방학)=vacation, 일반 행사(체육대회/축제/입학식/졸업식 등)=event, 기타=other.
- 연도가 명시되지 않아 모호하면 ${year} 또는 ${year + 1} 중 ${today} 이후가 되는 쪽으로 추정. 추정이 불가하면 그 행은 누락.
- 자료가 다른 학교 / 다른 학년도 잔존본인 듯하면 (학교명 불일치 / 명백히 과거 학년도) 빈 events 로 응답.
- 본문에 학사일정이 없거나 단순 안내문이면 events: [].
- 단순 광고·공지·게시판 게시물 제목은 학사일정으로 보지 말 것. '지필평가 출제 안내' 같은 공지는 제외, '1학기 중간고사 (6/24~6/28)' 같은 일정은 포함.
- 표·달력 형식 자료라면 각 셀의 텍스트를 모두 읽고 날짜에 맞게 펼침. 사진·이미지 자료의 경우 OCR 로 글자를 정확히 읽은 뒤 추출.
- 최대 80건. 동일 일자·동일 이름 중복 금지.`;
}

// ── 3-A) 업로드 파일(PDF/이미지) 로부터 Gemini multimodal 추출 ─────
// 학교 홈페이지에서 학사일정 PDF/이미지를 다운받아 직접 업로드하는 경우 사용.
// HWP 등 미지원 포맷은 클라이언트에서 차단(필요 시 PDF 변환 안내).
const SUPPORTED_UPLOAD_MIMES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/heic",
    "image/heif",
]);
async function extractEventsFromFileWithGemini(
    schoolName: string,
    fileBase64: string,
    mimeType: string,
): Promise<{ events: ExtractedEvent[]; raw: string }> {
    if (!GEMINI_API_KEY) return { events: [], raw: "" };
    if (!fileBase64) return { events: [], raw: "" };
    const mt = String(mimeType || "").toLowerCase().trim();
    if (!SUPPORTED_UPLOAD_MIMES.has(mt)) {
        return { events: [], raw: "unsupported_mime" };
    }
    const systemPrompt = _buildExtractionSystemPrompt(schoolName);
    const userPrompt =
        `[학교명] ${schoolName}\n[자료] 학원장이 학교 홈페이지에서 다운받은 학사일정 파일 1개\n\n위 첨부 자료에서 학사일정을 JSON 으로 추출하세요. 응답은 오직 JSON 객체 한 개.`;
    try {
        const apiUrl =
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: systemPrompt + "\n\n" + userPrompt },
                        { inline_data: { mime_type: mt, data: fileBase64 } },
                    ],
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 8192,
                    responseMimeType: "application/json",
                },
            }),
        });
        if (!res.ok) {
            console.warn("[investigate-file] Gemini HTTP", res.status, await res.text());
            return { events: [], raw: "" };
        }
        const j = await res.json();
        const fullText = String(
            j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "",
        ).trim();
        return { events: _parseGeminiEventsResponse(fullText), raw: fullText };
    } catch (e) {
        console.warn("[investigate-file] Gemini call err", e);
        return { events: [], raw: "" };
    }
}

// ── 3) Gemini 추출 ──────────────────────────────────────────────────
async function extractEventsWithGemini(
    schoolName: string,
    pages: FetchedPage[],
): Promise<{ events: ExtractedEvent[]; raw: string }> {
    if (!GEMINI_API_KEY) return { events: [], raw: "" };
    if (pages.length === 0) return { events: [], raw: "" };

    const today = new Date().toISOString().slice(0, 10);

    // 각 페이지 본문은 8000자로 컷 + 전체 합산 24000자 컷 — 프롬프트 비용 통제
    const PER_PAGE_CHARS = 8000;
    const TOTAL_CHARS = 24000;
    let acc = 0;
    const pageBlocks = pages.map((p, i) => {
        const remaining = Math.max(0, TOTAL_CHARS - acc);
        const slice = p.text.slice(0, Math.min(PER_PAGE_CHARS, remaining));
        acc += slice.length;
        return `### [PAGE ${i + 1}] ${p.title || "(no title)"}\nURL: ${p.url}\n---\n${slice}`;
    }).filter((b, i) => i === 0 || acc > 0).join("\n\n");

    const systemPrompt = _buildExtractionSystemPrompt(schoolName);
    const userPrompt = `[학교명] ${schoolName}\n[조사일] ${today}\n[페이지 수] ${pages.length}\n\n${pageBlocks}\n\n위 페이지들에서 학사일정만 JSON 으로 추출하세요. 응답은 오직 JSON 객체 한 개.`;

    try {
        const apiUrl =
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 4096,
                    responseMimeType: "application/json",
                },
            }),
        });
        if (!res.ok) {
            console.warn("[investigate] Gemini HTTP", res.status, await res.text());
            return { events: [], raw: "" };
        }
        const j = await res.json();
        const fullText = String(
            j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "",
        ).trim();
        return { events: _parseGeminiEventsResponse(fullText), raw: fullText };
    } catch (e) {
        console.warn("[investigate] Gemini call err", e);
        return { events: [], raw: "" };
    }
}

// ── 4) 종합 조사 파이프라인 ─────────────────────────────────────────
async function runInvestigation(school: SchoolInput): Promise<{
    pages: FetchedPage[];
    events: ExtractedEvent[];
    strategy: string;
    sourceUrls: string[];
    debug?: Record<string, unknown>;
}> {
    const name = String(school.name || "").trim();
    if (!name) return { pages: [], events: [], strategy: "no_name", sourceUrls: [] };

    // 4-1. Naver 검색으로 학교 홈페이지 후보 추출
    const candidates = await naverSearchSchoolHomepage(name);
    if (candidates.length === 0) {
        return { pages: [], events: [], strategy: "search_no_candidates", sourceUrls: [] };
    }

    // 4-2. 최상위 후보 1-2개의 메인 페이지를 fetch → 학사일정 링크 추출
    const scheduleUrls = new Set<string>();
    const homepagesTried: string[] = [];
    for (const u of candidates.slice(0, 3)) {
        homepagesTried.push(u);
        const html = await safeFetch(u, 10000);
        if (!html) continue;
        // 후보 URL 자체에 학사일정 키워드가 있으면 그대로 사용
        const direct = SCHEDULE_LINK_KEYWORDS.some((k) => decodeURIComponent(u).includes(k))
            || /(schedule|calendar|haksa)/i.test(u);
        if (direct) scheduleUrls.add(u);
        // 본문에서 학사일정 링크/iframe 추출
        extractScheduleLinks(html, u).forEach((sl) => scheduleUrls.add(sl));
        if (scheduleUrls.size >= 4) break;
    }

    // 4-3. 학사일정 링크가 없으면, 홈페이지 자체 본문을 통째로 분석
    const pages: FetchedPage[] = [];
    if (scheduleUrls.size === 0) {
        for (const u of homepagesTried.slice(0, 2)) {
            const pg = await fetchPage(u);
            if (pg && pg.text.length > 200) pages.push(pg);
        }
    } else {
        for (const u of Array.from(scheduleUrls).slice(0, 3)) {
            const pg = await fetchPage(u);
            if (pg && pg.text.length > 200) pages.push(pg);
        }
        // 본문이 부족하면 홈페이지도 보조로 추가
        if (pages.length === 0 && homepagesTried.length > 0) {
            const pg = await fetchPage(homepagesTried[0]);
            if (pg && pg.text.length > 200) pages.push(pg);
        }
    }

    if (pages.length === 0) {
        return {
            pages: [], events: [], strategy: "fetch_empty",
            sourceUrls: homepagesTried,
            debug: { candidates, scheduleUrls: Array.from(scheduleUrls) },
        };
    }

    const { events } = await extractEventsWithGemini(name, pages);
    return {
        pages,
        events,
        strategy: scheduleUrls.size > 0 ? "schedule_page" : "homepage_only",
        sourceUrls: pages.map((p) => p.url),
        debug: { candidates, scheduleUrls: Array.from(scheduleUrls) },
    };
}

// ── 5) HTTP 핸들러 ─────────────────────────────────────────────────
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
        if (!GEMINI_API_KEY) {
            return new Response(JSON.stringify({ ok: false, error: "gemini_not_configured" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 인증 — 원장 본인 호출만 허용
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
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) {
            return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        const ownerId = user.id;

        const body = (await req.json().catch(() => ({}))) as {
            school?: SchoolInput;
            file?: { base64?: string; mimeType?: string; name?: string };
        };
        const school = body.school || {};
        const atpt = String(school.atpt || "").trim();
        const code = String(school.code || "").trim();
        const name = String(school.name || "").trim();
        if (!atpt || !code || !name) {
            return new Response(JSON.stringify({ ok: false, error: "school_missing" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── 분기: 파일 업로드 경로 vs 홈페이지 자동 조사 경로 ──────
        let events: ExtractedEvent[] = [];
        let sourceUrls: string[] = [];
        let strategy = "";
        let noteOnEmpty = "";

        if (body.file && body.file.base64) {
            // ── 5-A) 사용자가 학사일정 PDF/이미지를 직접 업로드한 경우 ──
            const fileBase64 = String(body.file.base64);
            const mimeType = String(body.file.mimeType || "").toLowerCase();
            const fileName = String(body.file.name || "").slice(0, 200);

            if (!SUPPORTED_UPLOAD_MIMES.has(mimeType)) {
                return new Response(JSON.stringify({
                    ok: false,
                    error: "unsupported_file_type",
                    detail: `지원 포맷: PDF / PNG / JPG / WebP / HEIC. 받은 타입: ${mimeType || "(empty)"} (HWP 는 PDF 로 저장 후 업로드)`,
                }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            // 20MB inline 한도 — base64 는 원본 대비 ~33% 크므로 14MB 정도까지 안전
            if (fileBase64.length > 18 * 1024 * 1024) {
                return new Response(JSON.stringify({
                    ok: false,
                    error: "file_too_large",
                    detail: "원본 파일은 14MB 이하여야 합니다. 큰 PDF 는 페이지를 나누거나 압축 후 업로드해주세요.",
                }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            const r = await extractEventsFromFileWithGemini(name, fileBase64, mimeType);
            events = r.events;
            strategy = "uploaded_file";
            sourceUrls = fileName ? [`uploaded:${fileName}`] : ["uploaded"];
            noteOnEmpty = "업로드한 자료에서 학사일정을 추출하지 못했습니다. 일정표가 명확히 보이는 페이지 / 더 선명한 이미지로 다시 시도해주세요.";
        } else {
            // ── 5-B) 학교 홈페이지 자동 조사 경로 (기존 동작) ───────
            const investigation = await runInvestigation(school);
            events = investigation.events;
            sourceUrls = investigation.sourceUrls;
            strategy = investigation.strategy;
            noteOnEmpty = investigation.strategy === "search_no_candidates"
                ? "공식 홈페이지를 검색에서 찾지 못했습니다."
                : investigation.strategy === "fetch_empty"
                    ? "홈페이지를 열었으나 학사일정 페이지 본문을 찾지 못했습니다."
                    : "학사일정으로 추출할 만한 정보가 없었습니다. PDF/이미지 직접 업로드 버튼으로 다시 시도해보세요.";
        }

        if (events.length === 0) {
            return new Response(JSON.stringify({
                ok: true,
                schoolName: name,
                inserted: 0,
                updated: 0,
                total: 0,
                events: [],
                sourceUrls,
                strategy,
                note: noteOnEmpty,
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 5-1. DB 업서트 (service role)
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const sourceUrl = sourceUrls[0] || "";
        const rows = events.map((ev) => ({
            atpt,
            school_code: code,
            school_name: name,
            event_date: ev.date,
            event_name: ev.name,
            event_content: ev.content,
            event_kind: ev.kind,
            source_url: sourceUrl,
            investigated_by: ownerId,
            investigated_at: new Date().toISOString(),
        }));

        // upsert: 동일 (atpt, code, date, name) 충돌 시 content/source/시간만 갱신
        const { data, error } = await admin
            .from("school_calendar_overrides")
            .upsert(rows, {
                onConflict: "atpt,school_code,event_date,event_name",
                ignoreDuplicates: false,
            })
            .select("id, event_date, event_name, event_kind");

        if (error) {
            console.error("[investigate-school-calendar] upsert err", error);
            return new Response(JSON.stringify({
                ok: false, error: "db_upsert_failed", detail: error.message,
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({
            ok: true,
            schoolName: name,
            inserted: data?.length ?? rows.length,
            total: rows.length,
            events,
            sourceUrls,
            strategy,
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (e) {
        console.error("[investigate-school-calendar]", e);
        return new Response(JSON.stringify({ ok: false, error: "internal" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
