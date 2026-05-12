// Supabase 데이터베이스 함수들
// 최적화: 세션 캐싱, 불필요한 쿼리 제거, select 최적화

// ========== 세션 캐싱 ==========
let _cachedUser = null;
let _cachedSession = null;
let _sessionCacheTime = 0;
const SESSION_CACHE_TTL = 180000; // 3분 (성능 최적화: 불필요한 세션 체크 감소)

// 캐시된 세션 가져오기 (불필요한 중복 호출 방지)
async function _getSession() {
    const now = Date.now();
    if (_cachedSession && (now - _sessionCacheTime) < SESSION_CACHE_TTL) {
        return _cachedSession;
    }
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        _cachedSession = null;
        _cachedUser = null;
        return null;
    }
    _cachedSession = session;
    _sessionCacheTime = now;
    return session;
}

// owner_user_id 빠른 조회 (localStorage 우선, 없으면 세션에서)
function _getOwnerId() {
    const ownerId = localStorage.getItem('current_owner_id');
    if (ownerId) return ownerId;
    if (_cachedSession) return _cachedSession.user.id;
    return null;
}

/**
 * RLS(`owner_user_id = auth.uid()`) 통과를 위해 **세션 UID를 우선**한다.
 * `current_owner_id`가 세션과 다르면 세션으로 교정해 localStorage에 기록한다.
 */
async function _resolveOwnerUserId() {
    let sessionUid = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        sessionUid = session?.user?.id || null;
    } catch (e) {
        console.warn('[_resolveOwnerUserId] getSession 실패:', e);
    }
    const ls = localStorage.getItem('current_owner_id');
    if (sessionUid) {
        if (ls && ls !== sessionUid) {
            console.warn('[_resolveOwnerUserId] current_owner_id를 세션과 일치시킵니다.');
        }
        try {
            localStorage.setItem('current_owner_id', sessionUid);
        } catch (_) { /* ignore */ }
        return sessionUid;
    }
    return ls || null;
}

/** 로컬 타임존 기준 YYYY-MM-DD (수업일은 달력·캘린더 셀과 동일 기준) */
function _formatLocalDateYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * schedule_date / 범위 삭제용: 월·일 한 자리(2026-2-5) 등을 YYYY-MM-DD로 통일.
 * 문자열 비교(`2026-2-5` > `2026-02-28`)로 2월만 구간에서 빠지는 오류 방지.
 * Supabase/PostgREST가 `date`를 `2026-03-15T00:00:00+00:00` 형태로 줄 때 캘린더 `YYYY-MM-DD`와
 * 불일치해 뱃지가 빠지는 문제 → 앞 10자만 쓰지 않고 **로컬 달력 일자**로 정규화.
 */
function _normalizeScheduleDateKey(input) {
    if (input == null || input === '') return '';
    if (input instanceof Date) {
        if (Number.isNaN(input.getTime())) return '';
        return _formatLocalDateYmd(input);
    }
    const s = String(input).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const head10 = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head10) && s.length > 10) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return _formatLocalDateYmd(d);
    }
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const d = parseInt(m[3], 10);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return _formatLocalDateYmd(parsed);
    return s;
}
window.normalizeScheduleDateKey = _normalizeScheduleDateKey;

/** schedules.start_time 이 DB(TIME)와 HH:MM / HH:MM:SS 로 달라 삭제가 0건 되는 것 완화 */
function _scheduleStartTimeDeleteVariants(startTime) {
    const raw = String(startTime || '').trim();
    if (!raw || raw === 'default') return null;
    const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return [raw];
    const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0');
    const mm = String(Math.min(59, parseInt(m[2], 10))).padStart(2, '0');
    const ss = m[3] != null ? String(Math.min(59, parseInt(m[3], 10))).padStart(2, '0') : '00';
    const hhmm = `${hh}:${mm}`;
    const full = `${hh}:${mm}:${ss}`;
    return Array.from(new Set([hhmm, full]));
}

// 세션 변경 감지 → 캐시 무효화
if (typeof supabase !== 'undefined') {
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
            _cachedUser = null;
            _cachedSession = null;
            _sessionCacheTime = 0;
        }
    });
}

// ========== 사용자 정보 ==========

window.getCurrentUser = async function() {
    // 캐시된 사용자 정보가 있으면 바로 반환
    if (_cachedUser) return _cachedUser;

    try {
        const session = await _getSession();
        if (!session) return null;

        const { data: userData, error } = await supabase
            .from('users')
            .select('id, email, name, role')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error('사용자 정보 조회 실패:', error);
            _cachedUser = { ...session.user, role: 'user' };
        } else {
            _cachedUser = userData;
        }
        return _cachedUser;
    } catch (error) {
        console.error('사용자 정보 조회 실패:', error);
        return null;
    }
}

// 캐시 강제 초기화 (로그아웃 등)
window.clearUserCache = function() {
    _cachedUser = null;
    _cachedSession = null;
    _sessionCacheTime = 0;
}

/** 레거시: users.student_eval_ai_style_note (항목 테이블 도입 전·폴백) */
async function _getLegacyStudentEvalAiStyleNote(session) {
    if (!session) return '';
    try {
        const { data, error } = await supabase
            .from('users')
            .select('student_eval_ai_style_note')
            .eq('id', session.user.id)
            .maybeSingle();
        if (error) return '';
        return String(data && data.student_eval_ai_style_note ? data.student_eval_ai_style_note : '').trim();
    } catch (e) {
        return '';
    }
}

/** 한 번에 추가 가능한 최대 글자수 */
var STUDENT_EVAL_AI_STYLE_NOTE_MAX_APPEND = 1200;
/** AI 시스템 프롬프트에 넣는 합산 문자열 상한(항목 테이블은 행 수 제한 없음) */
var STUDENT_EVAL_AI_STYLE_NOTE_MAX_TOTAL = 8000;

function _isMissingTableError(err) {
    const m = String(err && (err.message || err.details || err.hint) || '');
    return /relation|does not exist|schema cache|Could not find the table/i.test(m);
}

/**
 * 저장된 고정 지침 행 목록 (student_eval_ai_style_entries).
 * 항목이 없고 users 컬럼만 있으면 폴백 1행(날짜 없음).
 */
window.getOwnerStudentEvalAiStyleNoteRows = async function() {
    try {
        const session = await _getSession();
        if (!session) return [];
        const { data: rows, error } = await supabase
            .from('student_eval_ai_style_entries')
            .select('id, content, created_at')
            .eq('owner_user_id', session.user.id)
            .order('created_at', { ascending: true });
        if (error) {
            if (_isMissingTableError(error)) {
                const leg = await _getLegacyStudentEvalAiStyleNote(session);
                return leg ? [{ id: null, content: leg, created_at: null }] : [];
            }
            console.warn('[getOwnerStudentEvalAiStyleNoteRows]', error);
            return [];
        }
        if (rows && rows.length) return rows;
        const leg = await _getLegacyStudentEvalAiStyleNote(session);
        return leg ? [{ id: null, content: leg, created_at: null }] : [];
    } catch (e) {
        console.warn('[getOwnerStudentEvalAiStyleNoteRows]', e);
        return [];
    }
};

/** 종합평가 AI에 매번 붙는 원장 고정 지침 (항목 합산 + 레거시 폴백) */
window.getOwnerStudentEvalAiStyleNote = async function() {
    try {
        const rows = await window.getOwnerStudentEvalAiStyleNoteRows();
        if (!rows.length) return '';
        let s = rows.map(function (r) { return r.content; }).join('\n\n');
        if (s.length > STUDENT_EVAL_AI_STYLE_NOTE_MAX_TOTAL) {
            s = s.slice(-STUDENT_EVAL_AI_STYLE_NOTE_MAX_TOTAL);
        }
        return s;
    } catch (e) {
        console.warn('[getOwnerStudentEvalAiStyleNote]', e);
        return '';
    }
};

/** 전체 덮어쓰기: 항목 전부 삭제 후 1행 삽입, 레거시 컬럼 비움 */
window.saveOwnerStudentEvalAiStyleNote = async function(text) {
    try {
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return false;
        }
        const t = String(text || '').trim().slice(0, STUDENT_EVAL_AI_STYLE_NOTE_MAX_APPEND);
        const uid = session.user.id;
        const { error: delErr } = await supabase
            .from('student_eval_ai_style_entries')
            .delete()
            .eq('owner_user_id', uid);
        if (delErr && _isMissingTableError(delErr)) {
            if (typeof showToast === 'function') {
                showToast('고정 지침 테이블이 없습니다. SUPABASE_STUDENT_EVAL_AI_STYLE_ENTRIES_20260329.sql 을 적용하세요.', 'error');
            }
            return false;
        }
        if (delErr) {
            console.error('[saveOwnerStudentEvalAiStyleNote] delete', delErr);
            if (typeof showToast === 'function') showToast('저장에 실패했습니다.', 'error');
            return false;
        }
        if (t.length) {
            const { error: insErr } = await supabase
                .from('student_eval_ai_style_entries')
                .insert({ owner_user_id: uid, content: t });
            if (insErr) {
                console.error('[saveOwnerStudentEvalAiStyleNote] insert', insErr);
                if (typeof showToast === 'function') {
                    const hint = String(insErr.message || '').includes('policy') || String(insErr.code || '') === '42501'
                        ? ' RLS·테이블 정책을 확인하세요.'
                        : '';
                    showToast('저장에 실패했습니다.' + hint, 'error');
                }
                return false;
            }
        }
        await supabase
            .from('users')
            .update({ student_eval_ai_style_note: null })
            .eq('id', uid);
        clearUserCache();
        if (typeof showToast === 'function') showToast('AI 고정 지침을 저장했습니다.', 'success');
        return true;
    } catch (e) {
        console.error('[saveOwnerStudentEvalAiStyleNote]', e);
        if (typeof showToast === 'function') showToast('저장 중 오류가 발생했습니다.', 'error');
        return false;
    }
};

/** 항목 테이블에 INSERT (평가 모달「고정 지침」기본). 최초 저장 시 레거시 컬럼을 먼저 1행으로 옮김 */
window.appendOwnerStudentEvalAiStyleNote = async function(chunk) {
    try {
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return false;
        }
        const piece = String(chunk || '').trim().slice(0, STUDENT_EVAL_AI_STYLE_NOTE_MAX_APPEND);
        if (!piece.length) {
            if (typeof showToast === 'function') showToast('추가할 내용을 입력하세요.', 'warning');
            return false;
        }
        const uid = session.user.id;
        const { count, error: cntErr } = await supabase
            .from('student_eval_ai_style_entries')
            .select('*', { count: 'exact', head: true })
            .eq('owner_user_id', uid);
        if (cntErr) {
            if (_isMissingTableError(cntErr)) {
                if (typeof showToast === 'function') {
                    showToast('고정 지침 테이블이 없습니다. SUPABASE_STUDENT_EVAL_AI_STYLE_ENTRIES_20260329.sql 을 Supabase에 적용하세요.', 'error');
                }
                return false;
            }
            console.error('[appendOwnerStudentEvalAiStyleNote] count', cntErr);
            if (typeof showToast === 'function') showToast('저장에 실패했습니다.', 'error');
            return false;
        }
        if (!count) {
            const leg = await _getLegacyStudentEvalAiStyleNote(session);
            if (leg) {
                const seed = leg.slice(0, STUDENT_EVAL_AI_STYLE_NOTE_MAX_APPEND);
                const { error: seedErr } = await supabase
                    .from('student_eval_ai_style_entries')
                    .insert({ owner_user_id: uid, content: seed });
                if (seedErr) {
                    console.error('[appendOwnerStudentEvalAiStyleNote] seed', seedErr);
                    if (typeof showToast === 'function') showToast('이전 지침을 옮기지 못했습니다. SQL 적용 여부를 확인하세요.', 'error');
                    return false;
                }
                await supabase.from('users').update({ student_eval_ai_style_note: null }).eq('id', uid);
            }
        }
        const { data: insData, error } = await supabase
            .from('student_eval_ai_style_entries')
            .insert({ owner_user_id: uid, content: piece })
            .select('id, content, created_at')
            .maybeSingle();
        if (error) {
            console.error('[appendOwnerStudentEvalAiStyleNote]', error);
            if (typeof showToast === 'function') {
                const hint = String(error.message || '').includes('policy') || String(error.code || '') === '42501'
                    ? ' RLS 정책을 확인하세요.'
                    : '';
                showToast('저장에 실패했습니다.' + hint, 'error');
            }
            return false;
        }
        if (!insData) {
            if (typeof showToast === 'function') showToast('저장되지 않았습니다.', 'error');
            return false;
        }
        clearUserCache();
        var rowsCheck = await window.getOwnerStudentEvalAiStyleNoteRows();
        var rawJoin = rowsCheck.map(function (r) { return r.content; }).join('\n\n');
        if (typeof showToast === 'function') {
            if (rawJoin.length > STUDENT_EVAL_AI_STYLE_NOTE_MAX_TOTAL) {
                showToast('항목은 저장되었습니다. AI에 붙는 합산 문구는 ' + STUDENT_EVAL_AI_STYLE_NOTE_MAX_TOTAL + '자로 잘립니다(뒤쪽 우선).', 'warning');
            } else {
                showToast('AI 고정 지침을 누적 저장했습니다.', 'success');
            }
        }
        return true;
    } catch (e) {
        console.error('[appendOwnerStudentEvalAiStyleNote]', e);
        if (typeof showToast === 'function') showToast('저장 중 오류가 발생했습니다.', 'error');
        return false;
    }
};

/** 고정 지침 한 건 삭제(UUID 행). id가 없으면 레거시 users 컬럼만 비움 */
window.deleteOwnerStudentEvalAiStyleEntry = async function(entryId) {
    try {
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return false;
        }
        const uid = session.user.id;
        if (!entryId) {
            const { error } = await supabase
                .from('users')
                .update({ student_eval_ai_style_note: null })
                .eq('id', uid);
            if (error) {
                console.error('[deleteOwnerStudentEvalAiStyleEntry] legacy', error);
                if (typeof showToast === 'function') showToast('삭제에 실패했습니다.', 'error');
                return false;
            }
            clearUserCache();
            if (typeof showToast === 'function') showToast('저장된 지침을 삭제했습니다.', 'success');
            return true;
        }
        const { error } = await supabase
            .from('student_eval_ai_style_entries')
            .delete()
            .eq('id', entryId)
            .eq('owner_user_id', uid);
        if (error) {
            console.error('[deleteOwnerStudentEvalAiStyleEntry]', error);
            if (typeof showToast === 'function') showToast('삭제에 실패했습니다.', 'error');
            return false;
        }
        clearUserCache();
        if (typeof showToast === 'function') showToast('지침을 삭제했습니다.', 'success');
        return true;
    } catch (e) {
        console.error('[deleteOwnerStudentEvalAiStyleEntry]', e);
        if (typeof showToast === 'function') showToast('삭제 중 오류가 발생했습니다.', 'error');
        return false;
    }
};


// ========== 입시 정보·트렌드 지식 베이스 (admissions_knowledge) ==========
// 종합평가 AI Stage 1 (입시 전문가 사전 분석) 의 컨텍스트로 사용됨.
// 학년대(grade_band) 매칭으로 자동 주입되며, 만료 행은 제외.

window.getAdmissionsKnowledgeRows = async function() {
    try {
        const session = await _getSession();
        if (!session) return [];
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await supabase
            .from('admissions_knowledge')
            .select('id, topic_key, grade_band, title, content, source, valid_from, valid_until, created_at')
            .eq('owner_user_id', session.user.id)
            .or(`valid_until.is.null,valid_until.gte.${today}`)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            if (_isMissingTableError(error)) {
                console.warn('[getAdmissionsKnowledgeRows] 테이블 없음 — migrations/0031 적용 필요');
                return [];
            }
            console.warn('[getAdmissionsKnowledgeRows]', error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.warn('[getAdmissionsKnowledgeRows]', e);
        return [];
    }
};

window.deleteAdmissionsKnowledgeRow = async function(rowId) {
    try {
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return false;
        }
        const { error } = await supabase
            .from('admissions_knowledge')
            .delete()
            .eq('id', rowId)
            .eq('owner_user_id', session.user.id);
        if (error) {
            console.error('[deleteAdmissionsKnowledgeRow]', error);
            if (typeof showToast === 'function') showToast('삭제에 실패했습니다.', 'error');
            return false;
        }
        if (typeof showToast === 'function') showToast('항목을 삭제했습니다.', 'success');
        return true;
    } catch (e) {
        console.error('[deleteAdmissionsKnowledgeRow]', e);
        return false;
    }
};

/**
 * collect-admissions-knowledge Edge Function 호출.
 * mode: 'auto' | 'single' | 'manual'
 * single: { gradeBand }
 * manual: { gradeBand, title, content, validUntil? }
 */
window.invokeAdmissionsKnowledgeCollect = async function(payload) {
    try {
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return null;
        }
        const accessToken = session.access_token;
        const { data, error } = await supabase.functions.invoke('collect-admissions-knowledge', {
            body: payload || { mode: 'auto' },
            headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (error) {
            console.error('[invokeAdmissionsKnowledgeCollect]', error);
            if (typeof showToast === 'function') showToast('입시 정보 수집 호출에 실패했습니다.', 'error');
            return null;
        }
        if (!data || !data.ok) {
            const errMap = {
                gemini_not_configured: 'Supabase에 GEMINI_API_KEY 시크릿을 설정해주세요.',
                manual_missing: '제목·내용을 모두 입력해주세요.',
                invalid_grade_band: '학년대 값이 올바르지 않습니다.',
                all_generations_failed: 'Gemini 호출이 모두 실패했습니다. API 키·quota·로그를 확인해주세요.',
                db_insert_failed: 'DB 저장 실패 — admissions_knowledge 테이블 마이그레이션 적용 여부를 확인하세요.',
                unauthorized: '다시 로그인해주세요.'
            };
            const msg = errMap[data && data.error] || '입시 정보 수집에 실패했습니다.';
            if (typeof showToast === 'function') showToast(msg, 'error');
            return null;
        }
        return data;
    } catch (e) {
        console.error('[invokeAdmissionsKnowledgeCollect]', e);
        if (typeof showToast === 'function') showToast('입시 정보 수집 중 오류가 발생했습니다.', 'error');
        return null;
    }
};

/**
 * investigate-school-calendar Edge Function 호출.
 * 두 가지 경로:
 *   1) 자동 조사: file 인자 없음 → 학교 공식 홈페이지 검색·스크래핑·Gemini 추출
 *   2) 파일 업로드: file = { base64, mimeType, name } → Gemini multimodal 로 직접 추출
 * 두 경로 모두 결과를 school_calendar_overrides 에 upsert.
 *
 * @param {{atpt:string, code:string, name:string, region?:string}} school
 * @param {{base64:string, mimeType:string, name?:string}} [file]
 *   업로드할 학사일정 자료 (PDF / PNG / JPG / WebP / HEIC). 생략 시 자동 조사 모드.
 * @returns {Promise<null|{ok:boolean, schoolName:string, inserted:number,
 *   total:number, events:Array, sourceUrls:string[], strategy:string,
 *   note?:string}>}
 */
window.invokeInvestigateSchoolCalendar = async function(school, file) {
    try {
        if (!school || !school.atpt || !school.code || !school.name) {
            if (typeof showToast === 'function') showToast('학교 정보가 부족합니다.', 'warning');
            return null;
        }
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return null;
        }
        const accessToken = session.access_token;
        const requestBody = { school };
        if (file && file.base64 && file.mimeType) {
            requestBody.file = {
                base64: file.base64,
                mimeType: file.mimeType,
                name: file.name || '',
            };
        }
        const { data, error } = await supabase.functions.invoke('investigate-school-calendar', {
            body: requestBody,
            headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (error) {
            console.error('[invokeInvestigateSchoolCalendar]', error);
            if (typeof showToast === 'function') showToast('학사일정 조사 호출에 실패했습니다.', 'error');
            return null;
        }
        if (!data || !data.ok) {
            const errMap = {
                gemini_not_configured: 'Supabase 에 GEMINI_API_KEY 시크릿을 설정해주세요.',
                supabase_env_missing: '서버 환경변수가 누락되었습니다.',
                school_missing: '학교 식별 정보(atpt/code/name)가 누락되었습니다.',
                db_upsert_failed: 'DB 저장 실패 — school_calendar_overrides 마이그레이션 적용 여부를 확인하세요.',
                unauthorized: '다시 로그인해주세요.',
                unsupported_file_type: '지원하지 않는 파일 형식입니다. PDF / PNG / JPG / WebP / HEIC 만 가능합니다.',
                file_too_large: '파일이 너무 큽니다. 14MB 이하로 줄여서 업로드해주세요.',
            };
            const msg = errMap[data && data.error] || ('학사일정 조사에 실패했습니다.' + (data && data.detail ? ' (' + data.detail + ')' : ''));
            if (typeof showToast === 'function') showToast(msg, 'error');
            return data || null;
        }
        return data;
    } catch (e) {
        console.error('[invokeInvestigateSchoolCalendar]', e);
        if (typeof showToast === 'function') showToast('학사일정 조사 중 오류가 발생했습니다.', 'error');
        return null;
    }
};

/**
 * 사용자가 모달에서 직접 입력한 학사일정 events 배열을 edge function 으로 upsert.
 * AI 추출(file 모드) 의 정확도 문제를 해결하기 위해 추가된 manual 경로.
 *
 * @param {{atpt:string, code:string, name:string, region?:string}} school
 * @param {Array<{date:string, name:string, content?:string, kind?:string}>} events
 * @param {string} [sourceLabel] - 사용자가 보고 입력한 자료의 라벨 (파일명 등). 미지정 시 'manual'.
 */
window.submitManualSchoolCalendarEvents = async function(school, events, sourceLabel, options) {
    try {
        if (!school || !school.atpt || !school.code || !school.name) {
            if (typeof showToast === 'function') showToast('학교 정보가 부족합니다.', 'warning');
            return null;
        }
        const opts = options || {};
        const replaceForSchool = opts.replaceForSchool === true;
        if (!Array.isArray(events)) events = [];
        // replace 모드면 빈 events 도 허용 (= 학교 전체 일정 비우기). 일반 모드는 비어있으면 거부.
        if (events.length === 0 && !replaceForSchool) {
            if (typeof showToast === 'function') showToast('입력된 일정이 없습니다.', 'warning');
            return null;
        }
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return null;
        }
        const { data, error } = await supabase.functions.invoke('investigate-school-calendar', {
            body: {
                school,
                mode: 'manual',
                events,
                sourceLabel: sourceLabel || 'manual',
                replaceForSchool,
            },
            headers: { Authorization: 'Bearer ' + session.access_token }
        });
        if (error) {
            console.error('[submitManualSchoolCalendarEvents]', error);
            if (typeof showToast === 'function') showToast('학사일정 저장에 실패했습니다.', 'error');
            return null;
        }
        if (!data || !data.ok) {
            const errMap = {
                supabase_env_missing: '서버 환경변수가 누락되었습니다.',
                school_missing: '학교 식별 정보가 누락되었습니다.',
                db_upsert_failed: 'DB 저장 실패 — school_calendar_overrides 마이그레이션 적용 여부를 확인하세요.',
                unauthorized: '다시 로그인해주세요.',
            };
            const msg = errMap[data && data.error] || ('학사일정 저장에 실패했습니다.' + (data && data.detail ? ' (' + data.detail + ')' : ''));
            if (typeof showToast === 'function') showToast(msg, 'error');
            return data || null;
        }
        return data;
    } catch (e) {
        console.error('[submitManualSchoolCalendarEvents]', e);
        if (typeof showToast === 'function') showToast('학사일정 저장 중 오류가 발생했습니다.', 'error');
        return null;
    }
};

/**
 * 한 학교의 모든 override 학사일정을 일자순으로 조회 (월 단위가 아닌 전체).
 * 학사일정 직접입력 모달이 "현재 DB 상태" 를 사용자에게 보여주기 위해 사용.
 *
 * @param {string} atpt
 * @param {string} code
 * @returns {Promise<Array<{date:string, name:string, content:string, kind:string,
 *   sourceUrl?:string, investigatedAt?:string}>>}
 */
window.fetchSchoolCalendarOverridesForSchool = async function(atpt, code) {
    try {
        if (!atpt || !code) return [];
        const { data, error } = await supabase
            .from('school_calendar_overrides')
            .select('event_date, event_name, event_content, event_kind, source_url, investigated_at')
            .eq('atpt', atpt)
            .eq('school_code', code)
            .order('event_date', { ascending: true })
            .order('event_name', { ascending: true });
        if (error) {
            console.warn('[fetchSchoolCalendarOverridesForSchool]', error);
            return [];
        }
        return (data || []).map((r) => ({
            date: r.event_date,
            name: r.event_name,
            content: r.event_content || '',
            kind: r.event_kind || 'event',
            sourceUrl: r.source_url || '',
            investigatedAt: r.investigated_at || '',
        }));
    } catch (e) {
        console.warn('[fetchSchoolCalendarOverridesForSchool]', e);
        return [];
    }
};

/**
 * 학사일정 자료 파일(PDF·이미지)을 Supabase Storage 에 업로드 + 메타 upsert.
 * 학교당 1개 파일만 유지 — 동일 (atpt, code) 재업로드 시 Storage 도 덮어쓰기,
 * school_calendar_files 도 ON CONFLICT 로 행 갱신.
 *
 * @param {{atpt:string, code:string, name:string}} school
 * @param {File} file — 사용자가 선택한 PDF·이미지
 * @returns {Promise<null|{ok:true, filePath:string, fileName:string, mimeType:string, size:number, url:string}>}
 */
window.uploadSchoolCalendarFile = async function(school, file) {
    try {
        if (!school || !school.atpt || !school.code || !school.name) {
            if (typeof showToast === 'function') showToast('학교 정보가 부족합니다.', 'warning');
            return null;
        }
        if (!file) {
            if (typeof showToast === 'function') showToast('파일이 없습니다.', 'warning');
            return null;
        }
        const session = await _getSession();
        if (!session) {
            if (typeof showToast === 'function') showToast('로그인이 필요합니다.', 'warning');
            return null;
        }
        const userId = session.user && session.user.id;
        // Storage 경로: {atpt}_{code}/{filename}. 한 학교 폴더 내 파일명은 통일.
        // 확장자 추출 (안전한 폴백: .bin)
        const origName = String(file.name || 'file');
        const dot = origName.lastIndexOf('.');
        const ext = (dot > 0 && dot < origName.length - 1) ? origName.slice(dot).toLowerCase() : '';
        const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
        const folder = `${school.atpt}_${school.code}`;
        const filePath = `${folder}/calendar${safeExt}`;

        // Storage 업로드 (upsert: 같은 경로 덮어쓰기)
        const { error: upErr } = await supabase
            .storage
            .from('school-calendar-files')
            .upload(filePath, file, {
                upsert: true,
                contentType: file.type || 'application/octet-stream',
                cacheControl: '3600',
            });
        if (upErr) {
            console.error('[uploadSchoolCalendarFile] storage', upErr);
            // bucket_not_found / row_level_security 등 안내
            const m = String(upErr.message || '');
            if (/Bucket not found/i.test(m)) {
                if (typeof showToast === 'function') showToast('Storage 버킷 \'school-calendar-files\' 가 없습니다. Dashboard 에서 생성해주세요.', 'error');
            } else if (/row-level security|RLS/i.test(m)) {
                if (typeof showToast === 'function') showToast('업로드 권한이 없습니다. 마이그레이션 0042 적용 여부 확인.', 'error');
            } else {
                if (typeof showToast === 'function') showToast('파일 업로드 실패: ' + m, 'error');
            }
            return null;
        }

        // 메타 upsert
        const meta = {
            atpt: school.atpt,
            school_code: school.code,
            school_name: school.name,
            file_path: filePath,
            file_name: origName.slice(0, 200),
            mime_type: (file.type || 'application/octet-stream').slice(0, 80),
            file_size: file.size || null,
            uploaded_by: userId,
            uploaded_at: new Date().toISOString(),
        };
        const { error: dbErr } = await supabase
            .from('school_calendar_files')
            .upsert(meta, { onConflict: 'atpt,school_code' });
        if (dbErr) {
            console.error('[uploadSchoolCalendarFile] meta upsert', dbErr);
            if (typeof showToast === 'function') showToast('파일 메타 저장 실패: ' + dbErr.message, 'error');
            return null;
        }

        // 미리보기용 서명 URL (1시간) — 비공개 버킷이라 직접 URL 안 통함
        const { data: signed, error: urlErr } = await supabase
            .storage
            .from('school-calendar-files')
            .createSignedUrl(filePath, 60 * 60);
        if (urlErr) {
            console.warn('[uploadSchoolCalendarFile] signedUrl', urlErr);
        }
        return {
            ok: true,
            filePath,
            fileName: origName,
            mimeType: meta.mime_type,
            size: meta.file_size || 0,
            url: signed ? signed.signedUrl : '',
        };
    } catch (e) {
        console.error('[uploadSchoolCalendarFile]', e);
        if (typeof showToast === 'function') showToast('파일 업로드 중 오류: ' + (e.message || ''), 'error');
        return null;
    }
};

/**
 * 한 학교에 저장된 학사일정 자료 파일이 있는지 조회. 있으면 서명 URL 까지 만들어 반환.
 * 모달 열 때 호출해 자동 미리보기 로드.
 *
 * @param {string} atpt
 * @param {string} code
 * @returns {Promise<null|{filePath:string, fileName:string, mimeType:string, size:number,
 *   uploadedAt:string, url:string}>}
 */
window.fetchSchoolCalendarFile = async function(atpt, code) {
    try {
        if (!atpt || !code) return null;
        const { data, error } = await supabase
            .from('school_calendar_files')
            .select('file_path, file_name, mime_type, file_size, uploaded_at')
            .eq('atpt', atpt)
            .eq('school_code', code)
            .maybeSingle();
        if (error) {
            console.warn('[fetchSchoolCalendarFile] meta', error);
            return null;
        }
        if (!data || !data.file_path) return null;
        const { data: signed, error: urlErr } = await supabase
            .storage
            .from('school-calendar-files')
            .createSignedUrl(data.file_path, 60 * 60);
        if (urlErr) {
            console.warn('[fetchSchoolCalendarFile] signedUrl', urlErr);
            return null;
        }
        return {
            filePath: data.file_path,
            fileName: data.file_name,
            mimeType: data.mime_type,
            size: data.file_size || 0,
            uploadedAt: data.uploaded_at,
            url: signed.signedUrl,
        };
    } catch (e) {
        console.warn('[fetchSchoolCalendarFile]', e);
        return null;
    }
};

/**
 * 학교 학사일정 자료 파일 삭제 (Storage 객체 + 메타 행 모두 제거).
 */
window.deleteSchoolCalendarFile = async function(atpt, code) {
    try {
        if (!atpt || !code) return false;
        // 메타 조회 → 파일 경로 확보
        const { data, error } = await supabase
            .from('school_calendar_files')
            .select('file_path')
            .eq('atpt', atpt)
            .eq('school_code', code)
            .maybeSingle();
        if (error || !data || !data.file_path) return false;
        // Storage 삭제
        const { error: rmErr } = await supabase
            .storage
            .from('school-calendar-files')
            .remove([data.file_path]);
        if (rmErr) console.warn('[deleteSchoolCalendarFile] storage', rmErr);
        // 메타 삭제
        const { error: dbErr } = await supabase
            .from('school_calendar_files')
            .delete()
            .eq('atpt', atpt)
            .eq('school_code', code);
        if (dbErr) {
            console.warn('[deleteSchoolCalendarFile] meta', dbErr);
            return false;
        }
        return true;
    } catch (e) {
        console.warn('[deleteSchoolCalendarFile]', e);
        return false;
    }
};

/**
 * File / Blob 객체를 Edge Function 전송용 base64(순수, data: prefix 없음) 으로 변환.
 * FileReader.readAsDataURL 결과는 "data:<mime>;base64,XXXX" 형태이므로 콤마 이후만 사용.
 */
window.fileToBase64ForEdge = function(file) {
    return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('파일이 없습니다.')); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            if (comma < 0) { reject(new Error('파일 인코딩 실패')); return; }
            resolve(result.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsDataURL(file);
    });
};

/**
 * school_calendar_overrides 에서 한 학교의 특정 yyyymm 학사일정을 조회.
 * RLS 정책상 anon/authenticated 모두 SELECT 가능 — 학부모 포털·숙제관리에서도 사용 가능.
 *
 * @param {string} atpt
 * @param {string} code
 * @param {string} yyyymm 예: '202605'
 * @returns {Promise<Array<{date:string, name:string, content:string, kind:string, sourceUrl?:string, investigatedAt?:string}>>}
 */
window.fetchSchoolCalendarOverrides = async function(atpt, code, yyyymm) {
    try {
        if (!atpt || !code || !yyyymm) return [];
        const year = parseInt(yyyymm.slice(0, 4), 10);
        const month = parseInt(yyyymm.slice(4, 6), 10);
        if (!year || !month) return [];
        const fromDate = `${yyyymm.slice(0,4)}-${yyyymm.slice(4,6)}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const toDate = `${yyyymm.slice(0,4)}-${yyyymm.slice(4,6)}-${String(lastDay).padStart(2,'0')}`;
        const { data, error } = await supabase
            .from('school_calendar_overrides')
            .select('event_date, event_name, event_content, event_kind, source_url, investigated_at')
            .eq('atpt', atpt)
            .eq('school_code', code)
            .gte('event_date', fromDate)
            .lte('event_date', toDate)
            .order('event_date', { ascending: true });
        if (error) {
            console.warn('[fetchSchoolCalendarOverrides]', error);
            return [];
        }
        return (data || []).map((r) => ({
            date: r.event_date,
            name: r.event_name,
            content: r.event_content || '',
            kind: r.event_kind || 'event',
            sourceUrl: r.source_url || '',
            investigatedAt: r.investigated_at || '',
        }));
    } catch (e) {
        console.warn('[fetchSchoolCalendarOverrides]', e);
        return [];
    }
};


// ========== 학생 관련 함수 ==========

window.getAllStudents = async function() {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('학생 조회 실패:', error);
        return [];
    }
}

window.addStudent = async function(studentData) {
    try {
        const user = _cachedUser || await getCurrentUser();
        if (!user) {
            showToast('로그인이 필요합니다', 'warning');
            return null;
        }

        let regDate = studentData.register_date;
        if (!regDate || regDate === '' || regDate === '연도-월-일') regDate = null;
        let enrollStartDate = studentData.enrollment_start_date;
        if (!enrollStartDate || enrollStartDate === '' || enrollStartDate === '연도-월-일') enrollStartDate = null;
        let enrollEndDate = studentData.enrollment_end_date;
        if (!enrollEndDate || enrollEndDate === '' || enrollEndDate === '연도-월-일') enrollEndDate = null;
        let statusChangedDate = studentData.status_changed_date;
        if (!statusChangedDate || statusChangedDate === '' || statusChangedDate === '연도-월-일') statusChangedDate = null;

        const insertPayload = {
            owner_user_id: user.id,
            teacher_id: null,
            name: studentData.name,
            school: studentData.school || '',
            grade: studentData.grade,
            phone: studentData.phone || '',
            parent_phone: studentData.parent_phone || '',
            default_fee: studentData.default_fee || 0,
            special_lecture_fee: studentData.special_lecture_fee || 0,
            default_textbook_fee: studentData.default_textbook_fee || 0,
            memo: studentData.memo || '',
            register_date: regDate,
            status: studentData.status || 'active',
            status_changed_date: statusChangedDate,
            parent_code: studentData.parent_code || null,
            student_code: studentData.student_code || null
        };
        if (studentData.guardian_name !== undefined) insertPayload.guardian_name = studentData.guardian_name || null;
        if (studentData.enrollment_start_date !== undefined) insertPayload.enrollment_start_date = enrollStartDate;
        if (studentData.enrollment_end_date !== undefined) insertPayload.enrollment_end_date = enrollEndDate;

        const { data, error } = await supabase
            .from('students')
            .insert([insertPayload])
            .select()
            .single();

        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('학생 추가 실패:', error);
        throw error;
    }
}

window.updateStudent = async function(studentId, updateData) {
    try {
        const { data, error } = await supabase
            .from('students')
            .update(updateData)
            .eq('id', studentId)
            .select()
            .single();

        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('학생 수정 실패:', error);
        throw error;
    }
}

window.deleteStudent = async function(studentId) {
    try {
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) {
            console.error('[deleteStudent] 잘못된 학생 ID:', studentId);
            throw new Error('잘못된 학생 ID');
        }

        // 관련 데이터 병렬 삭제 (순서 무관한 항목들을 동시에 처리 - 성능 4배 향상)
        const [schedRes, attRes, payRes, evalRes, testScoreRes] = await Promise.allSettled([
            supabase.from('schedules').delete().eq('student_id', numericId),
            supabase.from('attendance_records').delete().eq('student_id', numericId),
            supabase.from('payments').delete().eq('student_id', numericId),
            supabase.from('student_evaluations').delete().eq('student_id', numericId),
            supabase.from('student_test_scores').delete().eq('student_id', numericId)
        ]);

        // 실패 로깅 (관련 데이터가 없을 수 있으므로 에러는 경고만)
        const labels = ['일정', '출석 기록', '결제 기록', '평가 기록', '테스트 점수 기록'];
        [schedRes, attRes, payRes, evalRes, testScoreRes].forEach((res, i) => {
            if (res.status === 'rejected' || res.value?.error) {
                console.warn(`[deleteStudent] ${labels[i]} 삭제 실패:`, res.reason || res.value?.error);
            }
        });

        // 학생 본체 삭제 (이것은 반드시 성공해야 함)
        const { error: studentError } = await supabase
            .from('students')
            .delete()
            .eq('id', numericId);

        if (studentError) {
            throw new Error('학생 삭제 실패: ' + studentError.message);
        }

        console.log('[deleteStudent] 학생 삭제 완료 - ID:', numericId);
        return true;
    } catch (error) {
        console.error('[deleteStudent] 삭제 프로세스 실패:', error);
        return false;
    }
}


// ========== 출석 기록 조회 ==========

window.getAttendanceRecordsByOwner = async function(teacherId = undefined) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) return [];

        let query = supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .order('attendance_date', { ascending: true });

        let effectiveTeacherId = null;
        if (teacherId === undefined) {
            effectiveTeacherId = (typeof currentTeacherId !== 'undefined' ? currentTeacherId : null);
        } else if (teacherId === null || String(teacherId).trim() === '') {
            effectiveTeacherId = null; // 명시적으로 전체 조회
        } else {
            effectiveTeacherId = String(teacherId).trim();
        }
        if (effectiveTeacherId) {
            query = query.eq('teacher_id', String(effectiveTeacherId));
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getAttendanceRecordsByOwner] 에러:', error);
        return [];
    }
}


// ========== 선생님 관리 ==========

window.getMyTeachers = async function() {
    try {
        const session = await _getSession();
        if (!session) return [];

        const { data, error } = await supabase
            .from('teachers')
            .select('id, name, phone, email, google_email, google_sub, created_at')
            .eq('owner_user_id', session.user.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('선생님 목록 조회 실패:', err);
        return [];
    }
}

window.deleteTeacherById = async function(teacherId) {
    try {
        const session = await _getSession();
        if (!session) {
            showToast('로그인이 필요합니다', 'warning');
            return false;
        }

        const { error } = await supabase
            .from('teachers')
            .delete()
            .eq('id', teacherId)
            .eq('owner_user_id', session.user.id);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('선생님 삭제 실패:', err);
        showToast('선생님 삭제 실패: ' + err.message, 'error');
        return false;
    }
}


// ========== 일정(Schedules) 관련 함수 ==========

window.saveScheduleToDatabase = async function(scheduleData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[saveScheduleToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }
        const session = await _getSession();
        if (!session) {
            console.warn('[saveScheduleToDatabase] auth session 없음 - DB 동기화 건너뜀');
            throw new Error('세션 만료로 DB 동기화를 건너뜁니다');
        }

        const { data, error } = await supabase
            .from('schedules')
            .upsert({
                owner_user_id: ownerId,
                teacher_id: scheduleData.teacherId,
                student_id: parseInt(scheduleData.studentId),
                schedule_date: _normalizeScheduleDateKey(scheduleData.date),
                start_time: scheduleData.startTime,
                duration: parseInt(scheduleData.duration)
            }, {
                onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[saveScheduleToDatabase] 에러:', error);
        throw error;
    }
}

window.saveSchedulesToDatabaseBatch = async function(scheduleList) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[saveSchedulesToDatabaseBatch] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }
        const session = await _getSession();
        if (!session) {
            console.warn('[saveSchedulesToDatabaseBatch] auth session 없음 - DB 동기화 건너뜀');
            throw new Error('세션 만료로 DB 동기화를 건너뜁니다');
        }

        if (!Array.isArray(scheduleList) || scheduleList.length === 0) return [];

        const payload = scheduleList.map(item => ({
            owner_user_id: ownerId,
            teacher_id: item.teacherId,
            student_id: parseInt(item.studentId),
            schedule_date: _normalizeScheduleDateKey(item.date),
            start_time: item.startTime,
            duration: parseInt(item.duration)
        }));

        // 청크 사이즈를 500으로 증가 (Supabase 기본 제한 1000)
        const chunkSize = 500;
        
        if (payload.length <= chunkSize) {
            // 단일 청크면 바로 전송
            const { data, error } = await supabase
                .from('schedules')
                .upsert(payload, {
                    onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
                    ignoreDuplicates: false
                })
                .select();
            if (error) throw error;
            return data || [];
        }

        // 다중 청크: 병렬 처리
        const chunks = [];
        for (let i = 0; i < payload.length; i += chunkSize) {
            chunks.push(payload.slice(i, i + chunkSize));
        }

        const results = await Promise.all(chunks.map(chunk =>
            supabase
                .from('schedules')
                .upsert(chunk, {
                    onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
                    ignoreDuplicates: false
                })
                .select()
        ));

        // 결과 합치기 & 에러 체크
        let combined = [];
        for (const result of results) {
            if (result.error) throw result.error;
            if (result.data) combined = combined.concat(result.data);
        }
        return combined;
    } catch (error) {
        console.error('[saveSchedulesToDatabaseBatch] 에러:', error);
        throw error;
    }
}

window.getSchedulesByTeacher = async function(teacherId) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) { console.warn('[getSchedulesByTeacher] ownerId 없음'); return []; }

        const pageSize = 1000;
        let from = 0;
        const all = [];
        for (;;) {
            const { data, error } = await supabase
                .from('schedules')
                .select('id, student_id, schedule_date, start_time, duration')
                .eq('owner_user_id', ownerId)
                .eq('teacher_id', teacherId)
                .order('schedule_date', { ascending: true })
                .range(from, from + pageSize - 1);

            if (error) throw error;
            const chunk = data || [];
            all.push(...chunk);
            if (chunk.length < pageSize) break;
            from += pageSize;
        }
        return all;
    } catch (error) {
        console.error('[getSchedulesByTeacher] 에러:', error);
        return [];
    }
}

window.getSchedulesByStudent = async function(studentId) {
    try {
        const ownerId = _getOwnerId();
        const numericId = parseInt(studentId);

        const { data, error } = await supabase
            .from('schedules')
            .select('id, teacher_id, schedule_date, start_time, duration')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .order('schedule_date', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getSchedulesByStudent] 에러:', error);
        return [];
    }
}

window.deleteScheduleFromDatabase = async function(studentId, date, teacherId = null, startTime = null) {
    try {
        const numericId = parseInt(studentId, 10);
        if (Number.isNaN(numericId)) {
            throw new Error('[deleteScheduleFromDatabase] student_id가 유효하지 않습니다.');
        }
        const effectiveTeacherId = String(
            teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : '') || ''
        ).trim();
        if (!effectiveTeacherId) {
            throw new Error('[deleteScheduleFromDatabase] teacherId가 없어 삭제할 수 없습니다.');
        }
        const ownerId = _getOwnerId();
        if (!ownerId) {
            throw new Error('[deleteScheduleFromDatabase] owner(로그인) 정보가 없어 삭제할 수 없습니다.');
        }

        const dateKey = _normalizeScheduleDateKey(date);
        if (!dateKey) {
            throw new Error('[deleteScheduleFromDatabase] schedule_date가 유효하지 않습니다.');
        }

        let query = supabase
            .from('schedules')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .eq('schedule_date', dateKey)
            .eq('teacher_id', effectiveTeacherId);

        const st = String(startTime || '').trim();
        if (st && st !== 'default') {
            const variants = _scheduleStartTimeDeleteVariants(st);
            if (variants && variants.length > 1) {
                query = query.in('start_time', variants);
            } else if (variants && variants.length === 1) {
                query = query.eq('start_time', variants[0]);
            } else {
                query = query.eq('start_time', st);
            }
        }

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteScheduleFromDatabase] 에러:', error);
        throw error;
    }
}

window.deleteSchedulesByRange = async function(studentId, startDate, endDate, teacherId = null) {
    try {
        const numericId = parseInt(studentId, 10);
        if (Number.isNaN(numericId)) {
            throw new Error('[deleteSchedulesByRange] student_id가 유효하지 않습니다.');
        }
        const effectiveTeacherId = String(teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : '') || '').trim();
        if (!effectiveTeacherId) {
            throw new Error('[deleteSchedulesByRange] teacherId가 없어 삭제할 수 없습니다.');
        }

        const ownerId = _getOwnerId();
        if (!ownerId) {
            throw new Error('[deleteSchedulesByRange] 로그인(owner) 정보가 없어 삭제할 수 없습니다.');
        }
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        let query = supabase
            .from('schedules')
            .delete()
            .eq('student_id', numericId)
            .eq('teacher_id', effectiveTeacherId)
            .eq('owner_user_id', ownerId);
        if (rangeStart) query = query.gte('schedule_date', rangeStart);
        if (rangeEnd) query = query.lte('schedule_date', rangeEnd);

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteSchedulesByRange] 에러:', error);
        throw error;
    }
}

window.deleteSchedulesByTeacherRange = async function(startDate, endDate, teacherId = null) {
    try {
        const effectiveTeacherId = String(teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : '') || '').trim();
        if (!effectiveTeacherId) {
            throw new Error('[deleteSchedulesByTeacherRange] teacherId가 없어 삭제할 수 없습니다.');
        }

        const ownerId = _getOwnerId();
        if (!ownerId) {
            throw new Error('[deleteSchedulesByTeacherRange] 로그인(owner) 정보가 없어 삭제할 수 없습니다.');
        }
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        let query = supabase
            .from('schedules')
            .delete()
            .eq('teacher_id', effectiveTeacherId)
            .eq('owner_user_id', ownerId);
        if (rangeStart) query = query.gte('schedule_date', rangeStart);
        if (rangeEnd) query = query.lte('schedule_date', rangeEnd);

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteSchedulesByTeacherRange] 에러:', error);
        throw error;
    }
}

/**
 * 기간 내 일정 — owner 기준(모든 선생님 teacher_id). 학생 필터는 선택.
 * @param {string} startDate
 * @param {string} endDate
 * @param {string[]|null} studentIds - null/빈 배열이면 전체 학생
 */
window.fetchDistinctStudentIdsFromSchedulesInRangeForOwner = async function(startDate, endDate, studentIds = null) {
    try {
        if (typeof supabase === 'undefined') return [];
        const ownerId = _getOwnerId();
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        if (!ownerId || !rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];
        let query = supabase
            .from('schedules')
            .select('student_id')
            .eq('owner_user_id', ownerId)
            .gte('schedule_date', rangeStart)
            .lte('schedule_date', rangeEnd);
        const list = Array.isArray(studentIds) ? studentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : [];
        if (list.length) query = query.in('student_id', list);
        const { data, error } = await query;
        if (error) {
            console.error('[fetchDistinctStudentIdsFromSchedulesInRangeForOwner]', error);
            return [];
        }
        const set = new Set((data || []).map((r) => String(r.student_id)));
        return Array.from(set);
    } catch (e) {
        console.error('[fetchDistinctStudentIdsFromSchedulesInRangeForOwner] 예외:', e);
        return [];
    }
};

/**
 * 기간 내 일정 — 특정 선생님(teacher_id) 칸에 등록된 일정만
 * @param {string} teacherId
 * @param {string} startDate
 * @param {string} endDate
 * @param {string[]|null} studentIds
 */
window.fetchDistinctStudentIdsFromSchedulesInRangeForTeacher = async function(teacherId, startDate, endDate, studentIds = null) {
    try {
        if (typeof supabase === 'undefined') return [];
        const ownerId = _getOwnerId();
        const tid = String(teacherId || '').trim();
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        if (!ownerId || !tid || !rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];
        let query = supabase
            .from('schedules')
            .select('student_id')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', tid)
            .gte('schedule_date', rangeStart)
            .lte('schedule_date', rangeEnd);
        const list = Array.isArray(studentIds) ? studentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : [];
        if (list.length) query = query.in('student_id', list);
        const { data, error } = await query;
        if (error) {
            console.error('[fetchDistinctStudentIdsFromSchedulesInRangeForTeacher]', error);
            return [];
        }
        const set = new Set((data || []).map((r) => String(r.student_id)));
        return Array.from(set);
    } catch (e) {
        console.error('[fetchDistinctStudentIdsFromSchedulesInRangeForTeacher] 예외:', e);
        return [];
    }
};

/** 기간 내 일정 행 수 — owner 전체(모든 선생님 시간표) */
window.countScheduleRowsInRangeFromDbForOwner = async function(startDate, endDate, studentIds = null) {
    try {
        if (typeof supabase === 'undefined') return 0;
        const ownerId = _getOwnerId();
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        if (!ownerId || !rangeStart || !rangeEnd || rangeStart > rangeEnd) return 0;
        let query = supabase
            .from('schedules')
            .select('*', { count: 'exact', head: true })
            .eq('owner_user_id', ownerId)
            .gte('schedule_date', rangeStart)
            .lte('schedule_date', rangeEnd);
        const list = Array.isArray(studentIds) ? studentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : [];
        if (list.length) query = query.in('student_id', list);
        const { count, error } = await query;
        if (error) {
            console.error('[countScheduleRowsInRangeFromDbForOwner]', error);
            return 0;
        }
        return typeof count === 'number' ? count : 0;
    } catch (e) {
        console.error('[countScheduleRowsInRangeFromDbForOwner] 예외:', e);
        return 0;
    }
};

/** 기간 내 일정에 등장하는 teacher_id 목록(다른 선생님 일정 포함 여부 판별용) */
window.fetchDistinctTeacherIdsFromSchedulesInRangeForOwner = async function(startDate, endDate, studentIds = null) {
    try {
        if (typeof supabase === 'undefined') return [];
        const ownerId = _getOwnerId();
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        if (!ownerId || !rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];
        let query = supabase
            .from('schedules')
            .select('teacher_id')
            .eq('owner_user_id', ownerId)
            .gte('schedule_date', rangeStart)
            .lte('schedule_date', rangeEnd);
        const list = Array.isArray(studentIds) ? studentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : [];
        if (list.length) query = query.in('student_id', list);
        const { data, error } = await query;
        if (error) {
            console.error('[fetchDistinctTeacherIdsFromSchedulesInRangeForOwner]', error);
            return [];
        }
        const set = new Set((data || []).map((r) => String(r.teacher_id || '').trim()).filter(Boolean));
        return Array.from(set);
    } catch (e) {
        console.error('[fetchDistinctTeacherIdsFromSchedulesInRangeForOwner] 예외:', e);
        return [];
    }
};

/**
 * 기간 내 일정 일괄 삭제 — owner 소유 전체 선생님 시간표(teacher_id 무관)
 * @param {string} startDate
 * @param {string} endDate
 * @param {{ studentIds?: string[]|null }} options - studentIds 있으면 해당 학생만
 */
window.deleteSchedulesByOwnerRange = async function(startDate, endDate, options = {}) {
    try {
        if (typeof supabase === 'undefined') {
            throw new Error('[deleteSchedulesByOwnerRange] Supabase 미초기화');
        }
        const ownerId = _getOwnerId();
        if (!ownerId) {
            throw new Error('[deleteSchedulesByOwnerRange] 로그인(owner) 정보가 없어 삭제할 수 없습니다.');
        }
        const rangeStart = startDate ? _normalizeScheduleDateKey(startDate) : '';
        const rangeEnd = endDate ? _normalizeScheduleDateKey(endDate) : '';
        if (!rangeStart || !rangeEnd) {
            throw new Error('[deleteSchedulesByOwnerRange] 기간이 유효하지 않습니다.');
        }
        const studentIds = options.studentIds;
        if (Array.isArray(studentIds) && studentIds.length === 0) {
            return true;
        }
        let query = supabase.from('schedules').delete().eq('owner_user_id', ownerId);
        query = query.gte('schedule_date', rangeStart).lte('schedule_date', rangeEnd);
        const list = Array.isArray(studentIds) && studentIds.length
            ? studentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n))
            : [];
        if (list.length) query = query.in('student_id', list);
        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteSchedulesByOwnerRange] 에러:', error);
        throw error;
    }
};


// ========== 커스텀 휴일(Holidays) 관련 함수 ==========

/** @deprecated 다중 일정은 insertHolidayToDatabase 사용 */
window.saveHolidayToDatabase = async function(holidayData) {
    return window.insertHolidayToDatabase(holidayData);
};

window.insertHolidayToDatabase = async function(holidayData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[insertHolidayToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        const fontSize = Number(holidayData.fontSize);
        const row = {
            owner_user_id: ownerId,
            teacher_id: holidayData.teacherId,
            holiday_date: holidayData.date,
            holiday_name: holidayData.name,
            color: holidayData.color || '#ef4444',
            font_size: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, Math.round(fontSize))) : 13
        };
        if (holidayData.bgColor != null && holidayData.bgColor !== '') {
            row.bg_color = holidayData.bgColor;
        }

        const { data, error } = await supabase
            .from('holidays')
            .insert(row)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[insertHolidayToDatabase] 에러:', error);
        throw error;
    }
};

window.updateHolidayInDatabase = async function(holidayId, patch) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            throw new Error('로그인이 필요합니다');
        }
        const fs = patch.fontSize != null ? Number(patch.fontSize) : null;
        const updateRow = {
            holiday_name: patch.name,
            color: patch.color || '#ef4444',
            ...(Number.isFinite(fs) ? { font_size: Math.min(32, Math.max(8, Math.round(fs))) } : {})
        };
        if (patch.bgColor !== undefined) {
            updateRow.bg_color = patch.bgColor && String(patch.bgColor).trim() !== '' ? patch.bgColor : null;
        }
        const { data, error } = await supabase
            .from('holidays')
            .update(updateRow)
            .eq('id', holidayId)
            .eq('owner_user_id', ownerId)
            .select()
            .single();
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[updateHolidayInDatabase] 에러:', error);
        throw error;
    }
};

window.deleteHolidayFromDatabaseById = async function(holidayId) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) throw new Error('로그인이 필요합니다');
        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('id', holidayId)
            .eq('owner_user_id', ownerId);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteHolidayFromDatabaseById] 에러:', error);
        throw error;
    }
};

window.getHolidaysByTeacher = async function(teacherId) {
    try {
        const ownerId = _getOwnerId();

        // 개인 스케줄 + 학원 전체 일정(teacher_id='academy') 모두 조회
        const { data, error } = await supabase
            .from('holidays')
            .select('id, holiday_date, holiday_name, color, bg_color, teacher_id, font_size')
            .eq('owner_user_id', ownerId)
            .in('teacher_id', [teacherId, 'academy'])
            .order('holiday_date', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;
        return (data || []).map(h => ({
            ...h,
            scheduleType: h.teacher_id === 'academy' ? 'academy' : 'personal'
        }));
    } catch (error) {
        console.error('[getHolidaysByTeacher] 에러:', error);
        return [];
    }
}

/** 해당 날짜·teacher 스코프의 사용자 등록 일정 전부 삭제 */
window.deleteHolidayFromDatabase = async function(teacherId, date) {
    try {
        const ownerId = _getOwnerId();

        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .eq('holiday_date', date);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteHolidayFromDatabase] 에러:', error);
        throw error;
    }
}

/**
 * id 폴백: 로컬 entry에 DB id가 없을 때(과거 버전·DB 로드 실패 시 localStorage 폴백 등)
 * (teacher_id, holiday_date, holiday_name) 정확 매칭으로 삭제. 영향 행 수를 반환.
 */
window.deleteHolidayFromDatabaseByMatch = async function(teacherId, date, name) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) throw new Error('로그인이 필요합니다');
        const tid = String(teacherId || '').trim();
        const ds = String(date || '').trim();
        const nm = String(name || '').trim();
        if (!tid || !ds || !nm) {
            console.warn('[deleteHolidayFromDatabaseByMatch] 인자 부족:', { teacherId, date, name });
            return 0;
        }
        const { data, error } = await supabase
            .from('holidays')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', tid)
            .eq('holiday_date', ds)
            .eq('holiday_name', nm)
            .select('id');
        if (error) throw error;
        return Array.isArray(data) ? data.length : 0;
    } catch (error) {
        console.error('[deleteHolidayFromDatabaseByMatch] 에러:', error);
        throw error;
    }
}


// ========== 결제(Payments) 관련 함수 ==========

window.savePaymentToDatabase = async function(paymentData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[savePaymentToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        const row = {
            owner_user_id: ownerId,
            teacher_id: paymentData.teacherId,
            student_id: parseInt(paymentData.studentId, 10),
            payment_month: paymentData.month,
            amount: parseInt(paymentData.amount, 10),
            paid_amount: parseInt(paymentData.paidAmount || 0, 10),
            payment_status: paymentData.status || 'unpaid',
            payment_date: paymentData.paymentDate || null,
            memo: paymentData.memo != null ? paymentData.memo : null,
            ledger_json: paymentData.ledgerJson != null ? paymentData.ledgerJson : null,
            supply_amount: Math.max(0, parseInt(paymentData.supplyAmount ?? 0, 10) || 0),
            vat_amount: Math.max(0, parseInt(paymentData.vatAmount ?? 0, 10) || 0),
            refund_amount: Math.max(0, parseInt(paymentData.refundAmount ?? 0, 10) || 0),
            refund_reason: paymentData.refundReason != null && String(paymentData.refundReason).trim() !== ''
                ? String(paymentData.refundReason).trim()
                : null,
            channel: paymentData.channel != null && String(paymentData.channel).trim() !== ''
                ? String(paymentData.channel).trim()
                : null,
            method: paymentData.method != null && String(paymentData.method).trim() !== ''
                ? String(paymentData.method).trim()
                : null,
            reference_id: paymentData.referenceId != null && String(paymentData.referenceId).trim() !== ''
                ? String(paymentData.referenceId).trim()
                : null,
            evidence_type: paymentData.evidenceType != null && String(paymentData.evidenceType).trim() !== ''
                ? String(paymentData.evidenceType).trim()
                : null,
            evidence_number: paymentData.evidenceNumber != null && String(paymentData.evidenceNumber).trim() !== ''
                ? String(paymentData.evidenceNumber).trim()
                : null,
            evidence_name: paymentData.evidenceName != null && String(paymentData.evidenceName).trim() !== ''
                ? String(paymentData.evidenceName).trim()
                : null,
            unmatched_deposit: Boolean(paymentData.unmatchedDeposit),
            paid_at_text: paymentData.paidAtText != null && String(paymentData.paidAtText).trim() !== ''
                ? String(paymentData.paidAtText).trim()
                : null
        };

        const { data, error } = await supabase
            .from('payments')
            .upsert(row, {
                onConflict: 'student_id,payment_month',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[savePaymentToDatabase] 에러:', error);
        throw error;
    }
}

/** owner 소유 payments 전부(수납 동기화·로드 병합용) */
window.getPaymentsByOwnerForSync = async function() {
    try {
        if (typeof supabase === 'undefined') return [];
        const ownerId = _getOwnerId();
        if (!ownerId) return [];

        const { data, error } = await supabase
            .from('payments')
            .select([
                'student_id', 'payment_month', 'amount', 'paid_amount', 'payment_status', 'payment_date', 'memo',
                'ledger_json', 'created_at',
                'supply_amount', 'vat_amount', 'refund_amount', 'refund_reason',
                'channel', 'method', 'reference_id', 'evidence_type', 'evidence_number', 'evidence_name',
                'unmatched_deposit', 'paid_at_text'
            ].join(', '))
            .eq('owner_user_id', ownerId);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.warn('[getPaymentsByOwnerForSync] 에러:', error);
        return [];
    }
}

window.getPaymentsByMonth = async function(teacherId, month) {
    try {
        const ownerId = _getOwnerId();

        const { data, error } = await supabase
            .from('payments')
            .select([
                'id', 'student_id', 'amount', 'paid_amount', 'payment_status', 'payment_date', 'memo', 'ledger_json',
                'supply_amount', 'vat_amount', 'refund_amount', 'refund_reason',
                'channel', 'method', 'reference_id', 'evidence_type', 'evidence_number', 'evidence_name',
                'unmatched_deposit', 'paid_at_text'
            ].join(', '))
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .eq('payment_month', month);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getPaymentsByMonth] 에러:', error);
        return [];
    }
}

window.getPaymentsByStudent = async function(studentId) {
    try {
        const ownerId = _getOwnerId();
        const numericId = parseInt(studentId);

        const { data, error } = await supabase
            .from('payments')
            .select([
                'id', 'payment_month', 'amount', 'paid_amount', 'payment_status', 'payment_date', 'memo', 'ledger_json',
                'supply_amount', 'vat_amount', 'refund_amount', 'refund_reason',
                'channel', 'method', 'reference_id', 'evidence_type', 'evidence_number', 'evidence_name',
                'unmatched_deposit', 'paid_at_text'
            ].join(', '))
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .order('payment_month', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getPaymentsByStudent] 에러:', error);
        return [];
    }
}

// ========== 종합평가 관리 ==========

window.getStudentEvaluation = async function(studentId, evalMonth) {
    try {
        const { data, error } = await supabase
            .from('student_evaluations')
            .select('id, student_id, eval_month, teacher_id, comment, parent_portal_visible, updated_at')
            .eq('student_id', parseInt(studentId))
            .eq('eval_month', evalMonth)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data || null;
    } catch (error) {
        console.error('[getStudentEvaluation] 에러:', error);
        return null;
    }
}

window.saveStudentEvaluation = async function(studentId, evalMonth, comment, teacherId, options) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) throw new Error('로그인이 필요합니다');

        const opt = options && typeof options === 'object' ? options : {};
        const payload = {
            student_id: parseInt(studentId),
            eval_month: evalMonth,
            owner_user_id: ownerId,
            teacher_id: String(teacherId || ''),
            comment: comment || '',
            updated_at: new Date().toISOString()
        };
        if (Object.prototype.hasOwnProperty.call(opt, 'parentPortalVisible')) {
            payload.parent_portal_visible = !!opt.parentPortalVisible;
        }

        const { data, error } = await supabase
            .from('student_evaluations')
            .upsert(payload, { onConflict: 'student_id,eval_month' })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[saveStudentEvaluation] 에러:', error);
        throw error;
    }
}

/**
 * 종합평가 이미지(PNG Blob) 를 Supabase Storage 에 업로드 →
 * student_evaluations.image_url 에 public URL 저장.
 *
 * 경로: student-eval-reports/{owner_uuid}/{student_id}_{YYYY-MM}.png
 * 같은 학생·같은 월 재생성 시 덮어쓰기.
 */
window.uploadStudentEvalImage = async function(studentId, evalMonth, blob, teacherId) {
    try {
        const session = await _getSession();
        if (!session) throw new Error('로그인이 필요합니다');
        const ownerId = session.user.id;
        if (!blob) throw new Error('이미지 데이터 없음');
        if (!studentId || !evalMonth) throw new Error('학생/월 정보 누락');

        // path: {owner_uuid}/{student_id}_{eval_month}.png
        const path = `${ownerId}/${parseInt(studentId, 10)}_${evalMonth}.png`;

        const { error: upErr } = await supabase.storage
            .from('student-eval-reports')
            .upload(path, blob, {
                contentType: 'image/png',
                upsert: true,             // 같은 path 덮어쓰기
                cacheControl: '60'        // 학부모 포털 새로고침 시 빠르게 갱신 보이도록
            });
        if (upErr) {
            console.error('[uploadStudentEvalImage] storage upload', upErr);
            // 정책·버킷 미적용 안내
            const msg = String(upErr.message || '');
            if (/bucket|not\s*found|row-level|policy/i.test(msg)) {
                throw new Error('Storage 버킷·정책이 적용되지 않았습니다. migrations/0033 SQL 을 적용해주세요.');
            }
            throw upErr;
        }

        const { data: pub } = supabase.storage
            .from('student-eval-reports')
            .getPublicUrl(path);
        const publicUrl = pub && pub.publicUrl ? pub.publicUrl : '';
        if (!publicUrl) throw new Error('public URL 생성 실패');

        // 캐시 무효화용 timestamp 쿼리 추가 (학부모 포털에서 새로고침 시 즉시 반영)
        const versioned = publicUrl + (publicUrl.includes('?') ? '&' : '?') + 'v=' + Date.now();

        // student_evaluations 행 upsert 로 image_url 저장 (없으면 row 생성)
        const upsertPayload = {
            student_id: parseInt(studentId, 10),
            eval_month: evalMonth,
            owner_user_id: ownerId,
            teacher_id: String(teacherId || ''),
            image_url: versioned,
            updated_at: new Date().toISOString()
        };
        const { error: dbErr } = await supabase
            .from('student_evaluations')
            .upsert(upsertPayload, { onConflict: 'student_id,eval_month' });
        if (dbErr) {
            // image_url 컬럼 없을 때 알기 쉽게 안내
            const msg = String(dbErr.message || '');
            if (/image_url|column/i.test(msg)) {
                throw new Error('student_evaluations.image_url 컬럼이 없습니다. migrations/0033 SQL 을 적용해주세요.');
            }
            throw dbErr;
        }

        return { url: versioned, path };
    } catch (e) {
        console.error('[uploadStudentEvalImage] 에러:', e);
        throw e;
    }
};

// ========== 수업관리 메모(JSON) 관리 ==========
// student_evaluations.class_memos / class_shared_memos를 month 단위로 로드/저장합니다.
// class_memos: { "YYYY-MM-DD": { "HH:MM": "<memo-html>" } }
// class_shared_memos: { "YYYY-MM-DD": { "HH:MM": { "<teacher_id>": "<shared-memo-html>" } } }
window.getStudentClassMemos = async function(studentId, evalMonth) {
    try {
        const { data, error } = await supabase
            .from('student_evaluations')
            .select('class_memos, class_shared_memos')
            .eq('student_id', parseInt(studentId))
            .eq('eval_month', evalMonth)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;

        return {
            class_memos: (data && data.class_memos && typeof data.class_memos === 'object') ? data.class_memos : {},
            class_shared_memos: (data && data.class_shared_memos && typeof data.class_shared_memos === 'object') ? data.class_shared_memos : {}
        };
    } catch (error) {
        console.error('[getStudentClassMemos] 에러:', error);
        return { class_memos: {}, class_shared_memos: {} };
    }
}

window.saveStudentClassMemos = async function(studentId, evalMonth, classMemos, classSharedMemos, teacherId) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) throw new Error('로그인이 필요합니다');

        const payload = {
            student_id: parseInt(studentId),
            eval_month: evalMonth,
            owner_user_id: ownerId,
            teacher_id: String(teacherId || ''),
            class_memos: classMemos && typeof classMemos === 'object' ? classMemos : {},
            class_shared_memos: classSharedMemos && typeof classSharedMemos === 'object' ? classSharedMemos : {},
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('student_evaluations')
            .upsert(payload, { onConflict: 'student_id,eval_month' })
            .select('id, student_id, eval_month, class_memos, class_shared_memos')
            .maybeSingle();

        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('[saveStudentClassMemos] 에러:', error);
        throw error;
    }
}

// ========== 테스트 점수 관리 ==========

window.getStudentTestScoresByMonth = async function(studentId, monthPrefix) {
    try {
        const ownerId = await _resolveOwnerUserId();
        if (!ownerId) return [];
        const startDate = `${monthPrefix}-01`;
        const [year, month] = monthPrefix.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

        const { data, error } = await supabase
            .from('student_test_scores')
            .select('id, student_id, teacher_id, exam_name, exam_date, score, max_score, created_at, updated_at')
            .eq('owner_user_id', ownerId)
            .eq('student_id', parseInt(studentId))
            .gte('exam_date', startDate)
            .lte('exam_date', endDate)
            .order('exam_date', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;
        return (data || []).map((row) => ({
            id: row.id,
            studentId: String(row.student_id),
            teacherId: row.teacher_id ? String(row.teacher_id) : '',
            examName: row.exam_name || '',
            examDate: row.exam_date || '',
            score: Number(row.score || 0),
            maxScore: Number(row.max_score || 0),
            createdAt: row.created_at || '',
            updatedAt: row.updated_at || ''
        }));
    } catch (error) {
        console.error('[getStudentTestScoresByMonth] 에러:', error);
        throw error;
    }
}

/** 시험일이 [startDate, endDate] 구간에 들어가는 점수 전부 (그래프 탭 다월 조회용) */
window.getStudentTestScoresByDateRange = async function(studentId, startDate, endDate) {
    try {
        const ownerId = await _resolveOwnerUserId();
        if (!ownerId) return [];
        const sd = _normalizeScheduleDateKey(startDate);
        const ed = _normalizeScheduleDateKey(endDate);
        if (!sd || !ed || sd > ed) return [];

        const { data, error } = await supabase
            .from('student_test_scores')
            .select('id, student_id, teacher_id, exam_name, exam_date, score, max_score, created_at, updated_at')
            .eq('owner_user_id', ownerId)
            .eq('student_id', parseInt(studentId, 10))
            .gte('exam_date', sd)
            .lte('exam_date', ed)
            .order('exam_date', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;
        return (data || []).map((row) => ({
            id: row.id,
            studentId: String(row.student_id),
            teacherId: row.teacher_id ? String(row.teacher_id) : '',
            examName: row.exam_name || '',
            examDate: row.exam_date || '',
            score: Number(row.score || 0),
            maxScore: Number(row.max_score || 0),
            createdAt: row.created_at || '',
            updatedAt: row.updated_at || ''
        }));
    } catch (error) {
        console.error('[getStudentTestScoresByDateRange] 에러:', error);
        throw error;
    }
};

window.saveStudentTestScore = async function(scoreRow) {
    try {
        const ownerId = await _resolveOwnerUserId();
        if (!ownerId) throw new Error('로그인이 필요합니다');
        const tid = String(scoreRow.teacherId || '').trim();
        const payload = {
            owner_user_id: ownerId,
            student_id: parseInt(scoreRow.studentId),
            teacher_id: tid || null,
            exam_name: String(scoreRow.examName || '').trim(),
            exam_date: scoreRow.examDate,
            score: Number(scoreRow.score || 0),
            max_score: Number(scoreRow.maxScore || 0),
            updated_at: new Date().toISOString()
        };
        if (!payload.exam_name || !payload.exam_date || payload.max_score <= 0) {
            throw new Error('필수값 누락(시험명/시험일/점수/만점)');
        }

        const { data, error } = await supabase
            .from('student_test_scores')
            .insert(payload)
            .select('id, student_id, teacher_id, exam_name, exam_date, score, max_score, created_at, updated_at')
            .single();

        if (error) throw error;
        return {
            id: data.id,
            studentId: String(data.student_id),
            teacherId: data.teacher_id ? String(data.teacher_id) : '',
            examName: data.exam_name || '',
            examDate: data.exam_date || '',
            score: Number(data.score || 0),
            maxScore: Number(data.max_score || 0),
            createdAt: data.created_at || '',
            updatedAt: data.updated_at || ''
        };
    } catch (error) {
        console.error('[saveStudentTestScore] 에러:', error);
        throw error;
    }
}

window.deleteStudentTestScore = async function(scoreId) {
    try {
        const ownerId = await _resolveOwnerUserId();
        if (!ownerId) throw new Error('로그인이 필요합니다');
        const { error } = await supabase
            .from('student_test_scores')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('id', scoreId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteStudentTestScore] 에러:', error);
        throw error;
    }
}
