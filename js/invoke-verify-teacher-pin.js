/**
 * verify-teacher-pin Edge Function 호출 (이중 경로)
 * 1) 세션 갱신 후 functions.invoke (Authorization에 로그인 JWT 전달)
 * 2) 실패 시 fetch + apikey + Bearer(로그인 access_token만 — sb_publishable_ 키는 JWT가 아니어서 Bearer에 쓰면 게이트웨이 401 가능)
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{ teacherId: string, pin: string, ownerUserId?: string, requireAdmin?: boolean }} body
 * @param {{ url?: string, anonKey?: string }} [runtimeOverride] 포털/채점 등 supabase-config 미로드 페이지용
 */
window.invokeVerifyTeacherPin = async function (client, body, runtimeOverride) {
    const urlBase =
        (runtimeOverride && runtimeOverride.url) ||
        (typeof window !== 'undefined' && window.__ACADEMY_SUPABASE_URL__) ||
        '';
    const anon =
        (runtimeOverride && runtimeOverride.anonKey) ||
        (typeof window !== 'undefined' && window.__ACADEMY_SUPABASE_ANON_KEY__) ||
        '';

    /** 로그인 세션 JWT만 사용 (게이트웨이 verify_jwt 대응) */
    const getUserJwt = async () => {
        try {
            await client.auth.refreshSession().catch(() => {});
            const { data: a } = await client.auth.getSession();
            let t = a?.session?.access_token || null;
            if (!t) {
                const { data: b } = await client.auth.refreshSession();
                t = b?.session?.access_token || null;
            }
            return t || null;
        } catch (_) {
            return null;
        }
    };

    const tryInvoke = async () => {
        const jwt = await getUserJwt();
        const { data, error } = await client.functions.invoke('verify-teacher-pin', {
            body,
            headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}
        });
        if (!error && data && typeof data.ok !== 'undefined') {
            return {
                ok: !!data.ok,
                teacher: data.teacher || null,
                error: data.error || null
            };
        }
        if (error) {
            console.warn('[invokeVerifyTeacherPin] invoke 실패 → fetch 재시도:', error.message || error);
        }
        return null;
    };

    const tryFetch = async () => {
        if (!urlBase || !anon) {
            console.warn('[invokeVerifyTeacherPin] URL/anonKey 없음 — fetch 생략');
            return { ok: false, teacher: null, error: 'missing_supabase_config' };
        }
        const url = String(urlBase).replace(/\/$/, '') + '/functions/v1/verify-teacher-pin';

        const jwt = await getUserJwt();
        if (!jwt) {
            return {
                ok: false,
                teacher: null,
                error: 'session_expired_relogin'
            };
        }

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: anon,
                    Authorization: 'Bearer ' + jwt,
                    'x-client-info': 'academy-manager/invoke-verify-teacher-pin'
                },
                body: JSON.stringify(body)
            });
        } catch (netErr) {
            return { ok: false, teacher: null, error: netErr && netErr.message ? netErr.message : String(netErr) };
        }

        const text = await res.text();
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch (_) {
            return { ok: false, teacher: null, error: 'bad_json_http_' + res.status };
        }

        if (!res.ok) {
            return {
                ok: false,
                teacher: null,
                error:
                    res.status === 401
                        ? 'http_401'
                        : json.error || json.message || 'http_' + res.status
            };
        }
        return {
            ok: !!(json && json.ok),
            teacher: json.teacher || null,
            error: json.error || null
        };
    };

    const fromInvoke = await tryInvoke();
    if (fromInvoke) return fromInvoke;

    return tryFetch();
};
