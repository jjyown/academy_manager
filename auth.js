// 로그인/회원가입 기능

function getTabValue(key) {
    const sessionValue = sessionStorage.getItem(key);
    return sessionValue !== null ? sessionValue : localStorage.getItem(key);
}

function setTabValue(key, value) {
    sessionStorage.setItem(key, value);
}

function removeTabValue(key) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
}

window.signUp = async function() {
    const email = (document.getElementById('signup-email')?.value || '').trim();
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm')?.value || '';
    const name = document.getElementById('signup-name').value;

    if (!name) {
        showToast('이름을 입력해주세요.', 'warning');
        return;
    }

    if (!email) {
        showToast('구글 이메일 인증이 필요합니다.\n"구글 이메일 인증" 버튼을 눌러 인증해주세요.', 'warning');
        return;
    }

    if (!password || !passwordConfirm) {
        showToast('비밀번호를 입력해주세요.', 'warning');
        return;
    }

    if (password !== passwordConfirm) {
        showToast('비밀번호가 일치하지 않습니다.', 'warning');
        return;
    }

    try {
        // Supabase에서 회원가입 (구글 인증된 이메일 사용)
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password
        });

        if (error) {
            showToast('회원가입 실패: ' + error.message, 'error');
            console.error('회원가입 에러:', error);
            return;
        }

        // 회원가입 성공 후 users 테이블에 이름 저장
        const user = data.user;
        
        const { error: updateError } = await supabase
            .from('users')
            .update({ name: name })
            .eq('id', user.id);

        if (updateError) {
            console.error('이름 저장 실패:', updateError);
        }

        showToast('회원가입이 완료되었습니다! 로그인 후 사용해주세요.', 'success');
        
        // 회원가입 폼 초기화 & 로그인 폼으로 전환
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        const passwordConfirmInput = document.getElementById('signup-password-confirm');
        if (passwordConfirmInput) passwordConfirmInput.value = '';
        document.getElementById('signup-name').value = '';
        
        // Google 인증 상태 초기화
        if (typeof resetGoogleAuthAdmin === 'function') resetGoogleAuthAdmin();
        
        toggleAuthForm();
    } catch (error) {
        showToast('오류 발생: ' + error.message, 'error');
        console.error('전체 에러:', error);
    }
}

window.signIn = async function() {
    const email = (document.getElementById('login-email')?.value || '').trim();
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;

    if (!email || !password) {
        showToast('이메일과 비밀번호를 입력해주세요', 'warning');
        return;
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            showToast('로그인 실패: ' + error.message, 'error');
            return;
        }

        // 원장(관리자) 앱: users.role 이 admin 인지 반드시 확인 (조회 실패 시에도 진행 금지)
        console.log('[signIn] 사용자 role 확인 중...');
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (userError || !userData || userData.role !== 'admin') {
            await supabase.auth.signOut();
            showToast(
                userError
                    ? '계정 정보를 확인할 수 없습니다. 네트워크·RLS를 확인하거나 관리자 계정인지 확인하세요.'
                    : '관리자 권한이 없습니다. 원장(관리자) 계정으로 로그인해주세요.',
                'warning'
            );
            if (userError) console.warn('[signIn] users 테이블 조회 실패:', userError);
            return;
        }
        console.log('[signIn] admin 권한 확인됨');

        // 로그인 성공 - 현재 사용자(관리자) ID 저장
        console.log('[signIn] 로그인 성공, current_owner_id 저장');
        localStorage.setItem('current_owner_id', data.user.id);
        
        // 관리자 로그인이므로 역할을 admin으로 설정
        localStorage.setItem('current_user_role', 'admin');
        
        // 로그인 유지 여부 저장
        if (rememberMe) {
            localStorage.setItem('remember_login', 'true');
            console.log('[signIn] 로그인 유지 체크 → localStorage에 true 저장');
        } else {
            // 로그인 유지 안 하면 세션만 사용
            localStorage.removeItem('remember_login');
            console.log('[signIn] 로그인 유지 미체크 → localStorage에서 제거');
        }
        
        // showMainApp() 호출로 선생님 선택 페이지 표시
        // (showMainApp 내에서 navigateToPage('TEACHER_SELECT') 호출됨)
        console.log('[signIn] 선생님 선택 페이지로 이동');
        await showMainApp();
    } catch (error) {
        showToast('오류 발생: ' + error.message, 'error');
    }
}

window.signOut = async function() {
    console.log('[signOut] 로그아웃 시작');
    // 먼저 localStorage 정리 (Supabase signOut 전에 실행)
    localStorage.removeItem('current_owner_id');
    localStorage.removeItem('current_user_role');
    localStorage.removeItem('current_user_name');
    localStorage.removeItem('remember_login');
    removeTabValue('current_teacher_id');
    removeTabValue('current_teacher_name');
    removeTabValue('current_teacher_role');
    removeTabValue('active_page');
    
    // 로그인 페이지로 이동 및 페이지 상태 초기화
    navigateToPage('AUTH');
    // 로그인 폼 초기화
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    if (loginForm) {
        loginForm.style.display = 'flex';
    }
    if (signupForm) {
        signupForm.style.display = 'none';
    }
    
    if (document.getElementById('login-email')) {
        document.getElementById('login-email').value = '';
    }
    if (document.getElementById('login-password')) {
        document.getElementById('login-password').value = '';
    }
    if (document.getElementById('remember-me')) {
        document.getElementById('remember-me').checked = false;
    }
    
    // Supabase 로그아웃 (UI 업데이트 후 실행)
    try {
        await supabase.auth.signOut();
        console.log('[signOut] 로그아웃 완료');
    } catch (error) {
        console.error('Supabase 로그아웃 에러:', error);
    }
}

// 선생님 선택 화면에서 관리자 로그인 화면으로 돌아가기
window.backToAdminLogin = async function() {
    // signOut과 동일하게 로컬 상태·로그인 유지 플래그 정리 (다른 원장 계정 혼선 방지)
    localStorage.removeItem('current_owner_id');
    localStorage.removeItem('current_user_role');
    localStorage.removeItem('current_user_name');
    localStorage.removeItem('remember_login');
    removeTabValue('current_teacher_id');
    removeTabValue('current_teacher_name');
    removeTabValue('current_teacher_role');
    removeTabValue('active_page');

    try {
        await supabase.auth.signOut();
    } catch (e) {
        console.error('[backToAdminLogin] 로그아웃 에러:', e);
    }

    navigateToPage('AUTH');
}

/**
 * 관리자 인증 모달(`admin-teacher-login-modal`) — 세션 재확인·역할 검증 후 닫기
 */
window.confirmAdminTeacherLogin = async function() {
    const email = (document.getElementById('admin-login-email')?.value || '').trim();
    const password = (document.getElementById('admin-login-password')?.value || '').trim();
    if (!email || !password) {
        showToast('이메일과 비밀번호를 입력해주세요.', 'warning');
        return;
    }
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            showToast('인증 실패: ' + error.message, 'error');
            return;
        }
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', data.user.id)
            .single();
        if (userError || !userData || userData.role !== 'admin') {
            await supabase.auth.signOut();
            showToast('관리자 권한이 없습니다.', 'warning');
            return;
        }
        localStorage.setItem('current_owner_id', data.user.id);
        localStorage.setItem('current_user_role', 'admin');
        const pw = document.getElementById('admin-login-password');
        if (pw) pw.value = '';
        if (typeof closeModal === 'function') {
            closeModal('admin-teacher-login-modal');
        } else {
            const m = document.getElementById('admin-teacher-login-modal');
            if (m) m.style.display = 'none';
        }
        showToast('관리자 인증이 완료되었습니다.', 'success');
    } catch (e) {
        showToast('오류: ' + (e.message || e), 'error');
    }
};

window.toggleAuthForm = function() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'flex';
        signupForm.style.display = 'none';
        // 로그인 폼으로 전환 시 회원가입 Google 인증 상태 초기화
        if (typeof resetGoogleAuthAdmin === 'function') resetGoogleAuthAdmin();
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'flex';
    }
}

function getPasswordResetRedirectUrl() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `${window.location.origin}/`;
    }
    return undefined;
}

window.openAdminPasswordResetModal = function() {
    const modal = document.getElementById('admin-password-reset-modal');
    if (modal) modal.style.display = 'flex';
    const emailInput = document.getElementById('admin-reset-email');
    const loginEmail = document.getElementById('login-email');
    if (emailInput && loginEmail && loginEmail.value) {
        emailInput.value = loginEmail.value.trim();
    }
}

window.closeAdminPasswordResetModal = function() {
    const modal = document.getElementById('admin-password-reset-modal');
    if (modal) modal.style.display = 'none';
}

// 기존 비밀번호 확인 후 관리자 비밀번호 변경
window.confirmAdminPasswordChange = async function() {
    const email = (document.getElementById('admin-reset-email')?.value || '').trim();
    const currentPassword = (document.getElementById('admin-current-password')?.value || '').trim();
    const newPassword = (document.getElementById('admin-reset-new-password')?.value || '').trim();
    const confirmPassword = (document.getElementById('admin-reset-new-password-confirm')?.value || '').trim();

    if (!email) { showToast('이메일을 입력해주세요.', 'warning'); return; }
    if (!currentPassword) { showToast('기존 비밀번호를 입력해주세요.', 'warning'); return; }
    if (!newPassword || !confirmPassword) { showToast('새 비밀번호를 입력해주세요.', 'warning'); return; }
    if (newPassword.length < 6) { showToast('비밀번호는 6자 이상으로 설정해주세요.', 'warning'); return; }
    if (newPassword !== confirmPassword) { showToast('새 비밀번호가 일치하지 않습니다.', 'warning'); return; }

    try {
        // 1. 기존 비밀번호 확인 (재로그인으로 검증)
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
        if (signInError) {
            showToast('기존 비밀번호가 올바르지 않습니다.', 'error');
            return;
        }

        // 2. 새 비밀번호로 변경
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
        if (updateError) {
            showToast('비밀번호 변경 실패: ' + updateError.message, 'error');
            return;
        }

        showToast('비밀번호가 변경되었습니다.', 'success');
        document.getElementById('admin-current-password').value = '';
        document.getElementById('admin-reset-new-password').value = '';
        document.getElementById('admin-reset-new-password-confirm').value = '';
        window.closeAdminPasswordResetModal();
    } catch (err) {
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

// 관리자 비밀번호 초기화 (이메일 재설정 링크 발송)
window.resetAdminPassword = async function() {
    const email = (document.getElementById('admin-reset-email')?.value || '').trim();
    if (!email) { showToast('관리자 이메일을 입력해주세요.', 'warning'); return; }

    if (!(await showConfirm(`${email} 계정에 비밀번호 재설정 링크를 보내시겠습니까?\n\n이메일의 링크를 클릭하면 새 비밀번호를 설정할 수 있습니다.`, { type: 'danger', title: '비밀번호 초기화', okText: '전송' }))) return;

    try {
        const redirectTo = getPasswordResetRedirectUrl();
        const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
        if (error) {
            showToast('메일 전송 실패: ' + error.message, 'error');
            return;
        }
        showToast('비밀번호 재설정 링크를 이메일로 보냈습니다.\n메일의 링크를 클릭하면 새 비밀번호를 설정할 수 있습니다.', 'success');
        window.closeAdminPasswordResetModal();
    } catch (err) {
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

window.openAdminPasswordUpdateModal = function() {
    const modal = document.getElementById('admin-password-update-modal');
    if (modal) modal.style.display = 'flex';
}

window.closeAdminPasswordUpdateModal = function() {
    const modal = document.getElementById('admin-password-update-modal');
    if (modal) modal.style.display = 'none';
}

window.confirmAdminPasswordReset = async function() {
    const newPasswordInput = document.getElementById('admin-new-password');
    const confirmInput = document.getElementById('admin-new-password-confirm');
    const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';
    const confirmPassword = confirmInput ? confirmInput.value.trim() : '';

    if (!newPassword || !confirmPassword) {
        showToast('새 비밀번호를 입력해주세요', 'warning');
        return;
    }

    if (newPassword.length < 6) {
        showToast('비밀번호는 6자 이상으로 설정해주세요', 'warning');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('비밀번호가 일치하지 않습니다', 'warning');
        return;
    }

    try {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
            showToast('비밀번호 변경 실패: ' + error.message, 'error');
            return;
        }

        showToast('비밀번호가 변경되었습니다. 다시 로그인해주세요.', 'success');
        if (newPasswordInput) newPasswordInput.value = '';
        if (confirmInput) confirmInput.value = '';
        window.closeAdminPasswordUpdateModal();
        await supabase.auth.signOut();
        if (typeof navigateToPage === 'function') {
            navigateToPage('AUTH');
        }
    } catch (err) {
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

if (!window._passwordRecoveryListenerSet) {
    window._passwordRecoveryListenerSet = true;
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            if (typeof navigateToPage === 'function') {
                navigateToPage('AUTH');
            }
            window._passwordRecoveryModalOpened = true;
            window.openAdminPasswordUpdateModal();
        }
    });
}

async function waitForRecoverySession(timeoutMs = 4000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
}

async function recoverSessionFromUrl(hashParams) {
    try {
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
            if (error) {
                console.error('[recoverSessionFromUrl] setSession 실패:', error);
                return false;
            }
            return true;
        }

        if (accessToken && typeof supabase.auth.getSessionFromUrl === 'function') {
            const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
            if (error) {
                console.error('[recoverSessionFromUrl] getSessionFromUrl 실패:', error);
                return false;
            }
            return true;
        }
    } catch (err) {
        console.error('[recoverSessionFromUrl] 실패:', err);
    }
    return false;
}

async function handlePasswordRecoveryOnLoad() {
    try {
        console.log('[handlePasswordRecoveryOnLoad] URL:', window.location.href);
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
        const searchParams = url.searchParams;

        const recoveryType = searchParams.get('type') || hashParams.get('type');
        const code = searchParams.get('code') || hashParams.get('code');
        const accessToken = hashParams.get('access_token');
        const errorCode = searchParams.get('error_code') || hashParams.get('error_code');
        const errorDescription = searchParams.get('error_description') || hashParams.get('error_description');

        console.log('[handlePasswordRecoveryOnLoad] 상태:', {
            recoveryType,
            code: code ? 'present' : 'none',
            accessToken: accessToken ? 'present' : 'none',
            errorCode,
            errorDescription
        });

        if (errorCode) {
            console.warn('[handlePasswordRecoveryOnLoad] 에러 코드 감지:', errorCode, errorDescription);
            showToast('비밀번호 재설정 링크가 유효하지 않거나 만료되었습니다. 새 메일로 다시 시도해주세요.', 'error');
            return;
        }

        const isRecovery = recoveryType === 'recovery' || !!code || !!accessToken;
        if (!isRecovery) return;

        await recoverSessionFromUrl(hashParams);

        if (typeof navigateToPage === 'function') {
            navigateToPage('AUTH');
        }

        const hasSession = await waitForRecoverySession();
        if (!hasSession) {
            showToast('비밀번호 재설정 링크 처리에 실패했습니다. 새 메일로 다시 시도해주세요.', 'error');
            return;
        }

        if (!window._passwordRecoveryModalOpened) {
            window._passwordRecoveryModalOpened = true;
            window.openAdminPasswordUpdateModal();
        }

        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    } catch (err) {
        console.error('[handlePasswordRecoveryOnLoad] 실패:', err);
    }
}

handlePasswordRecoveryOnLoad();

window.showMainApp = async function(forceTeacherSelect = false) {
    try {
        console.log('[showMainApp] 시작, forceTeacherSelect:', forceTeacherSelect);

        // ✅ 필수: Supabase 세션 재확인
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
            console.error('[showMainApp] 세션 확인 에러:', sessionError);
        }
        
        if (!session) {
            console.warn('[showMainApp] 세션 없음 - 로그인 페이지로 강제 이동');
            // localStorage 정리
            localStorage.removeItem('current_owner_id');
            removeTabValue('current_teacher_id');
            removeTabValue('current_teacher_name');
            removeTabValue('active_page');
            navigateToPage('AUTH');
            return;
        }
        
        // ✅ current_owner_id 확인
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) {
            console.warn('[showMainApp] current_owner_id 없음 - 로그인 페이지로 이동');
            navigateToPage('AUTH');
            return;
        }

        if (String(session.user.id) !== String(ownerId)) {
            console.warn('[showMainApp] 세션 사용자와 current_owner_id 불일치');
            showToast('세션 정보가 일치하지 않습니다. 다시 로그인해주세요.', 'warning');
            await cleanupAndRedirectToAuth();
            return;
        }

        const { data: ownerRoleRow, error: ownerRoleErr } = await supabase
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .single();
        if (ownerRoleErr || !ownerRoleRow || ownerRoleRow.role !== 'admin') {
            await supabase.auth.signOut();
            showToast('관리자 권한이 없습니다. 다시 로그인해주세요.', 'warning');
            await cleanupAndRedirectToAuth();
            return;
        }
        localStorage.setItem('current_user_role', 'admin');

        const authPage = document.getElementById('auth-page');
        const teacherPage = document.getElementById('teacher-select-page');
        const initialLoader = document.getElementById('initial-loader');
        const showTransitionLoader = () => {
            if (initialLoader) initialLoader.style.display = 'flex';
        };
        const hideTransitionLoader = () => {
            if (initialLoader) initialLoader.style.display = 'none';
        };

        // 로그인 페이지는 먼저 숨김
        if (authPage) {
            authPage.style.display = 'none';
            authPage.style.visibility = 'hidden';
        }
        // 선생님 목록·메인 진입 동안 전체 로딩 오버레이(체감 대기 완화)
        showTransitionLoader();

        // 선생님 목록 로드 (재시도 포함)
        let list = [];
        if (typeof loadTeachers === 'function') {
            console.log('[showMainApp] 선생님 목록 로드 시작...');
            let retries = 3;
            while (retries > 0 && list.length === 0) {
                list = await loadTeachers();
                console.log('[showMainApp] loadTeachers 결과:', (list || []).length + '명, 남은 재시도:', retries - 1);
                if (list.length === 0 && retries > 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                retries--;
            }
        } else {
            console.error('[showMainApp] loadTeachers 함수를 찾을 수 없습니다.');
        }

        const lastTeacherId = getTabValue('current_teacher_id');
        console.log('[showMainApp] 저장된 current_teacher_id:', lastTeacherId);

        // forceTeacherSelect가 true이면 선생님 자동 선택을 건너뛰고 선택 페이지로 이동
        if (forceTeacherSelect) {
            console.log('[showMainApp] forceTeacherSelect=true - 선생님 선택 페이지로 강제 이동');
        } else if (lastTeacherId && list && list.length > 0) {
            // 이전에 선택한 선생님이 있고 목록에서 찾으면 바로 일정 페이지로 복원
            const found = list.find(t => String(t.id) === String(lastTeacherId));
            if (found && typeof setCurrentTeacher === 'function') {
                console.log('[showMainApp] 이전 선생님 자동 선택 및 메인으로 이동:', found.name);
                await setCurrentTeacher(found); // 내부에서 MAIN_APP으로 이동
                return; // 선택 페이지 표시하지 않음
            }
        }

        // 여기까지 오면 선생님 자동 선택 불가 → 선택 페이지 표시
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
            const selectForm = document.getElementById('teacher-select-form');
            const registerForm = document.getElementById('teacher-register-form');
            if (selectForm && registerForm) {
                selectForm.style.display = 'flex';
                registerForm.style.display = 'none';
            }
        }
        hideTransitionLoader();
        navigateToPage('TEACHER_SELECT');
    } catch (error) {
        console.error('[showMainApp] 에러:', error);
        console.error('[showMainApp] 에러 스택:', error.stack);
        const initialLoader = document.getElementById('initial-loader');
        if (initialLoader) initialLoader.style.display = 'none';
        showToast('메인 앱 전환 중 에러\n\n에러: ' + (error.message || error), 'error');
    }
};

// 페이지 로드 시 인증 상태 초기화 (script.js의 DOMContentLoaded에서 호출됨)
window.initializeAuth = async function(isRefresh = false) {
    // 로딩 화면 제거 헬퍼 함수
    const hideLoader = () => {
        const loaderElement = document.getElementById('initial-loader');
        if (loaderElement) {
            loaderElement.style.display = 'none';
        }
    };
    
    try {
        console.log('[initializeAuth] 시작, 새로고침:', isRefresh);

        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
        const searchParams = url.searchParams;
        const isRecoveryUrl = (searchParams.get('type') || hashParams.get('type')) === 'recovery'
            || !!searchParams.get('code')
            || !!hashParams.get('code')
            || !!hashParams.get('access_token');
        if (isRecoveryUrl) {
            console.log('[initializeAuth] 비밀번호 복구 URL 감지');
            await recoverSessionFromUrl(hashParams);
            await waitForRecoverySession();
        }
        
        // 로딩 화면 표시 (이미 표시되어 있지만 명시적으로 확인)
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'flex';
        
        // ⚠️ 먼저 remember_login 상태 로깅
        const rememberLogin = localStorage.getItem('remember_login') === 'true';
        console.log('[initializeAuth] 초기 remember_login 상태:', rememberLogin);
        
        // 🔄 새로고침인 경우: localStorage의 current_owner_id를 먼저 확인
        // 새로고침 시에는 Supabase 세션 재확인을 건너뜀 (빠른 페이지 복원)
        if (isRefresh) {
            const currentOwnerId = localStorage.getItem('current_owner_id');
            console.log('[initializeAuth] 새로고침 감지 - current_owner_id 확인:', currentOwnerId);
            
            if (!currentOwnerId) {
                console.warn('[initializeAuth] 새로고침 시 current_owner_id 없음 - 로그인 페이지로 이동');
                navigateToPage('AUTH');
                return;
            }
            
            // localStorage에서 페이지 상태 복원
            console.log('[initializeAuth] 새로고침 - localStorage 기반 페이지 복원 진행');
            // 아래의 페이지 복원 로직으로 진행
        } else {
            // ❌ 새로고침이 아니면 Supabase 세션 확인
            console.log('[initializeAuth] 새로고침 아님 - Supabase 세션 확인');
        }
        
        // ✅ 1단계: Supabase 세션 확인 (새로고침이 아닐 때만)
        let session = null;
        if (!isRefresh) {
            const { data: { session: supabaseSession }, error } = await supabase.auth.getSession();
            
            if (error) {
                console.error('[initializeAuth] 세션 확인 에러:', error);
            }
            
            session = supabaseSession;
        } else {
            // 새로고침 시에는 Supabase 세션 확인 생략, current_owner_id 존재 여부로 판단
            session = localStorage.getItem('current_owner_id') ? { user: { id: localStorage.getItem('current_owner_id') } } : null;
            console.log('[initializeAuth] 새로고침 - 세션 판단: localStorage 기반');
        }
        
        console.log('[initializeAuth] 세션 존재 여부:', !!session);
        console.log('[initializeAuth] 현재 active_page:', getTabValue('active_page'));
        console.log('[initializeAuth] 현재 teacher_id:', getTabValue('current_teacher_id'));

        // remember_me 상태를 체크박스에 반영
        const rememberFlag = localStorage.getItem('remember_login') === 'true';
        if (document.getElementById('remember-me')) {
            document.getElementById('remember-me').checked = rememberFlag;
        }

        if (session) {
            // ✅ 2단계: 새로고침인 경우 remember_login 확인 불필요 (페이지 그대로 복원)
            if (isRefresh) {
                console.log('[initializeAuth] 새로고침 - 페이지 상태 복원 진행');
                // 새로고침이면 기존 페이지 복원 로직으로 진행
            } else {
                // ✅ 창 닫기 후 다시 열기: remember_login 확인
                console.log('[initializeAuth] 새 세션, remember_login 재확인:', rememberLogin);
                
                if (!rememberLogin && !isRecoveryUrl) {
                    console.log('[initializeAuth] 새 세션에서 remember_login 없음 - 세션 제거');
                    await supabase.auth.signOut();
                    await cleanupAndRedirectToAuth();
                    return;
                }
            }
            
            // ✅ 3단계: 실제 Supabase 세션 + users.role=admin 검증 (새로고침 포함, 비밀번호 복구 URL 제외)
            if (!isRecoveryUrl) {
                console.log('[initializeAuth] 실제 세션 + 관리자(role) 검증 중...');
                try {
                    const { data: { session: realSession }, error: sessErr } = await supabase.auth.getSession();
                    if (sessErr || !realSession?.user) {
                        console.error('[initializeAuth] 실제 세션 없음:', sessErr);
                        await cleanupAndRedirectToAuth();
                        return;
                    }
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .select('id, email, role')
                        .eq('id', realSession.user.id)
                        .single();

                    if (userError || !userData) {
                        console.error('[initializeAuth] users 테이블에 사용자 없음 - 세션 무효:', userError);
                        await supabase.auth.signOut();
                        throw new Error('사용자 계정이 존재하지 않습니다');
                    }
                    if (userData.role !== 'admin') {
                        console.warn('[initializeAuth] 비관리자 역할 - 앱 접근 거부');
                        await supabase.auth.signOut();
                        showToast('관리자 권한이 없습니다', 'warning');
                        await cleanupAndRedirectToAuth();
                        return;
                    }
                    session = realSession;
                    console.log('[initializeAuth] 관리자 검증 완료:', userData.email);
                } catch (validationError) {
                    console.error('[initializeAuth] 사용자 검증 실패:', validationError);
                    await cleanupAndRedirectToAuth();
                    return;
                }
            } else {
                console.log('[initializeAuth] 비밀번호 복구 URL — 역할 검증 스킵');
            }
            
            // ✅ 4단계: 세션이 유효하면 사용자 ID 저장
            console.log('[initializeAuth] 세션 유효, current_owner_id 저장:', session.user.id);
            localStorage.setItem('current_owner_id', session.user.id);
            
            // ✅ 5단계: 새로고침 vs 창 닫기 구분 및 페이지 복원
            if (isRefresh) {
                // 🔄 새로고침 (F5): 현재 페이지 상태 완전히 복원
                const currentPage = getTabValue('active_page') || getActivePage();
                const lastTeacherId = getTabValue('current_teacher_id');
                
                console.log('[initializeAuth] 🔄 새로고침 진행 - 현재 페이지:', currentPage, '선생님 ID:', lastTeacherId);
                
                if (currentPage === 'MAIN_APP' && lastTeacherId) {
                    // ✅ 메인 페이지에서 새로고침 → 메인 페이지 직접 복원
                    console.log('[initializeAuth] 메인 페이지 새로고침 - setCurrentTeacher 호출');
                    try {
                        const list = typeof loadTeachers === 'function' ? await loadTeachers() : [];
                        console.log('[initializeAuth] loadTeachers 완료, 선생님 목록:', list.length, '명');
                        const found = list.find(t => String(t.id) === String(lastTeacherId));
                        if (found) {
                            console.log('[initializeAuth] 선생님 찾음:', found.name, '(ID:', found.id, ')');
                            if (typeof setCurrentTeacher === 'function') {
                                console.log('[initializeAuth] setCurrentTeacher 함수 호출 시작...');
                                await setCurrentTeacher(found);
                                console.log('[initializeAuth] setCurrentTeacher 함수 호출 완료');
                            } else {
                                console.warn('[initializeAuth] setCurrentTeacher 함수 없음, showMainApp 호출');
                                await showMainApp();
                            }
                        } else {
                            console.warn('[initializeAuth] 선생님 정보를 찾을 수 없음 (ID:', lastTeacherId, '), 저장된 선생님 목록:', list.map(t => t.id), 'showMainApp 호출');
                            await showMainApp();
                        }
                    } catch (err) {
                        console.error('[initializeAuth] 메인 페이지 복원 중 에러 발생:', err.message);
                        console.error('[initializeAuth] 에러 스택:', err.stack);
                        console.warn('[initializeAuth] showMainApp 호출로 폴백');
                        await showMainApp();
                    }
                    // 로딩 화면 제거
                    hideLoader();
                } else if (currentPage === 'TEACHER_SELECT') {
                    // ✅ 선생님 선택 페이지에서 새로고침 → 선생님 선택 페이지 유지
                    console.log('[initializeAuth] 선생님 선택 페이지 새로고침 - navigateToPage 호출');
                    navigateToPage('TEACHER_SELECT');
                    if (typeof loadTeachers === 'function') await loadTeachers();
                    // 로딩 화면 제거
                    hideLoader();
                } else if (currentPage === 'AUTH') {
                    // ✅ 로그인 페이지에서 새로고침 → 로그인 페이지 유지
                    console.log('[initializeAuth] 로그인 페이지 새로고침 - navigateToPage 호출');
                    navigateToPage('AUTH');
                    // 로딩 화면 제거
                    hideLoader();
                } else {
                    // ⚠️ 알 수 없는 페이지 또는 active_page가 없는 경우
                    // 현재 저장된 선생님 정보로 판단
                    if (lastTeacherId) {
                        console.log('[initializeAuth] active_page 없지만 lastTeacherId 있음 - 메인앱 복원 시도');
                        try {
                            const list = typeof loadTeachers === 'function' ? await loadTeachers() : [];
                            const found = list.find(t => String(t.id) === String(lastTeacherId));
                            if (found && typeof setCurrentTeacher === 'function') {
                                await setCurrentTeacher(found);
                                // 로딩 화면 제거
                                hideLoader();
                                return;
                            }
                        } catch (err) {
                            console.error('[initializeAuth] 메인앱 복원 실패:', err.message);
                        }
                    }
                    console.log('[initializeAuth] 알 수 없는 페이지 (', currentPage, ') - showMainApp 호출');
                    await showMainApp();
                    // 로딩 화면 제거
                    hideLoader();
                }
                
                // 로딩 화면 제거 (모든 분기 후 최종 안전망)
                hideLoader();
            } else {
                // ❌ 창을 닫았다가 다시 열기: 로그인 유지 설정에 따라 처리
                const rememberLoginWindow = localStorage.getItem('remember_login') === 'true';
                console.log('[initializeAuth] ❌ 창 닫기 후 다시 열기 - remember_login:', rememberLoginWindow);
                
                if (rememberLoginWindow) {
                    const lastTeacherId = getTabValue('current_teacher_id');
                    console.log('[initializeAuth] 로그인 유지 활성화 - 저장된 선생님 ID:', lastTeacherId);

                    if (lastTeacherId) {
                        try {
                            const list = typeof loadTeachers === 'function' ? await loadTeachers() : [];
                            const found = list.find(t => String(t.id) === String(lastTeacherId));
                            if (found && typeof setCurrentTeacher === 'function') {
                                await setCurrentTeacher(found);
                                hideLoader();
                                return;
                            }
                        } catch (err) {
                            console.error('[initializeAuth] 선생님 복원 실패:', err.message);
                        }
                    }

                    await showMainApp(true);
                } else {
                    // ✅ 로그인 유지 안 함: 로그인 페이지로 이동
                    console.log('[initializeAuth] 창 닫기 후 다시 열기 - 로그인 유지 비활성화 → 로그인 페이지');
                    await cleanupAndRedirectToAuth();
                }
                
                // 로딩 화면 제거
                hideLoader();
            }
            return;
        }
        
        // ✅ 세션이 없으면 localStorage 정리하고 로그인 페이지로
        if (isRecoveryUrl) {
            console.warn('[initializeAuth] 복구 URL인데 세션 없음 - 처리 중단');
            hideLoader();
            return;
        }

        console.log('[initializeAuth] 세션 없음 → 로그인 페이지로 이동');
        await cleanupAndRedirectToAuth();
        
        // 로딩 화면 제거
        hideLoader();
    } catch (err) {
        console.error('[initializeAuth] 에러 발생:', err.message);
        console.error('[initializeAuth] 에러 스택:', err.stack);
        await cleanupAndRedirectToAuth();
        
        // 로딩 화면 제거
        hideLoader();
    }
};

// ✅ localStorage 정리 및 로그인 페이지 이동 헬퍼 함수
async function cleanupAndRedirectToAuth() {
    console.log('[cleanupAndRedirectToAuth] localStorage 정리 중...');
    
    localStorage.removeItem('current_owner_id');
    localStorage.removeItem('current_user_role');
    localStorage.removeItem('current_user_name');
    removeTabValue('current_teacher_id');
    removeTabValue('current_teacher_name');
    removeTabValue('current_teacher_role');
    removeTabValue('active_page');
    localStorage.removeItem('remember_login');
    
    // 선생님별 일정 데이터 정리
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
        if (key.startsWith('teacher_schedule_data__') || 
            key.startsWith('teacher_students_mapping__') ||
            key.startsWith('academy_students__') ||
            key.startsWith('academy_holidays__')) {
            localStorage.removeItem(key);
            console.log('[cleanupAndRedirectToAuth] 정리됨:', key);
        }
    });
    
    console.log('[cleanupAndRedirectToAuth] localStorage 정리 완료, 로그인 페이지로 이동');
    navigateToPage('AUTH');
}

