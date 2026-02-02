// Supabase 설정 파일
// 여기에 복사한 URL과 API 키를 붙여넣으세요

const SUPABASE_URL = 'https://jzcrpdeomjmytfekcgqu.supabase.co'; // 예: https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu'; // 예: eyJhbGci...

// Supabase 클라이언트 초기화
const { createClient } = supabase;

// ✅ 세션 저장 방식 명시: localStorage 사용 (각 브라우저마다 독립적)
// persistSession: true = 세션 유지, false = 탭 닫으면 로그아웃
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        // localStorage 사용 (기본값이지만 명시적으로 설정)
        storage: window.localStorage,
        // 세션 자동 갱신 활성화
        autoRefreshToken: true,
        // 세션 감지 활성화
        detectSessionInUrl: true,
        // 브라우저 세션 유지 (로그인 유지 체크박스로 제어)
        persistSession: true,
        // 쿠키 사용 안 함 (localStorage만 사용)
        storageKey: 'supabase.auth.token',
        // 로그인 후 URL에서 토큰 제거
        flowType: 'pkce'
    }
});

// 전역으로 사용할 수 있게 export
window.supabase = supabaseClient;
