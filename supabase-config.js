// Supabase 설정 파일
// 여기에 복사한 URL과 API 키를 붙여넣으세요

const SUPABASE_URL = 'https://jzcrpdeomjmytfekcgqu.supabase.co'; // 예: https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu'; // 예: eyJhbGci...

// Supabase 클라이언트 초기화
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 전역으로 사용할 수 있게 export
window.supabase = supabaseClient;
