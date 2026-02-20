// Supabase 설정 파일
// ⚠️ 환경 변수 사용 권장 (Vercel 또는 .env.local)
// Vercel: 환경 변수 설정 → https://vercel.com/docs/concepts/projects/environment-variables
// Note: SUPABASE_URL과 ANON_KEY는 Supabase 공식 문서상 public(publishable) 키이므로
//       fallback 하드코딩은 허용되나, RLS 정책이 반드시 올바르게 설정되어야 합니다.

const SUPABASE_URL = (typeof window !== 'undefined' && window.env?.REACT_APP_SUPABASE_URL) ||
                     'https://jzcrpdeomjmytfekcgqu.supabase.co';

const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.env?.REACT_APP_SUPABASE_ANON_KEY) ||
                          'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu';

// Supabase 클라이언트 초기화
const { createClient } = supabase;

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storageKey: 'supabase.auth.token',
        flowType: 'implicit'
    },
    // DB 쿼리 글로벌 설정
    db: {
        schema: 'public'
    },
    // 실시간 기능 비활성화 (사용하지 않으므로 연결 비용 절감)
    realtime: {
        params: {
            eventsPerSecond: 2
        }
    }
});

// 전역으로 사용할 수 있게 export
window.supabase = supabaseClient;

// ========== Google OAuth 설정 ==========
// Google Cloud Console에서 생성한 OAuth 2.0 클라이언트 ID
// 설정 방법: https://console.cloud.google.com/ → APIs & Services → Credentials
const GOOGLE_CLIENT_ID = (typeof window !== 'undefined' && window.env?.GOOGLE_CLIENT_ID) ||
                         '855684874322-aso83sliupcv0u400la4ncdtmqp1ggvs.apps.googleusercontent.com';

// Google OAuth scope (이메일 인증 + 향후 Drive 연동용)
const GOOGLE_SCOPES = 'email profile https://www.googleapis.com/auth/drive.file';

// ========== Edge Function URL ==========
// Supabase Edge Function 호출 URL (비밀번호 초기화 인증번호 발송)
const EDGE_FUNCTION_URL = SUPABASE_URL + '/functions/v1';

// ========== 공공데이터포털 공휴일 API ==========
// 발급: https://www.data.go.kr/data/15012690/openapi.do (한국천문연구원 특일정보)
// ⚠️ API 키는 반드시 환경변수로 관리하세요 (Vercel 또는 .env.local)
const DATA_GO_KR_API_KEY = (typeof window !== 'undefined' && window.env?.DATA_GO_KR_API_KEY) || '';

window.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
window.GOOGLE_SCOPES = GOOGLE_SCOPES;
window.EDGE_FUNCTION_URL = EDGE_FUNCTION_URL;
window.DATA_GO_KR_API_KEY = DATA_GO_KR_API_KEY;
