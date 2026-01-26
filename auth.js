// 로그인/회원가입 기능

window.signUp = async function() {
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const name = document.getElementById('signup-name').value;

    if (!email || !password || !name) {
        alert('모든 항목을 입력해주세요');
        return;
    }

    try {
        // Supabase에서 회원가입
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password
        });

        if (error) {
            alert('회원가입 실패: ' + error.message);
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

        alert('회원가입이 완료되었습니다! 로그인 후 사용해주세요.');
        
        // 회원가입 폼 초기화 & 로그인 폼으로 전환
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        document.getElementById('signup-name').value = '';
        toggleAuthForm();
    } catch (error) {
        alert('오류 발생: ' + error.message);
        console.error('전체 에러:', error);
    }
}

window.signIn = async function() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;

    if (!email || !password) {
        alert('이메일과 비밀번호를 입력해주세요');
        return;
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            alert('로그인 실패: ' + error.message);
            return;
        }

        // 사용자의 role 확인
        console.log('[signIn] 사용자 role 확인 중...');
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (userError) {
            console.warn('[signIn] users 테이블 조회 실패:', userError);
            console.warn('[signIn] 계속 진행합니다');
        } else if (userData?.role === 'admin') {
            console.log('[signIn] admin 권한 확인됨');
        } else if (userData?.role !== 'admin') {
            await supabase.auth.signOut();
            alert('관리자 권한이 없습니다');
            return;
        }

        // 로그인 성공 - 현재 사용자(관리자) ID 저장
        console.log('[signIn] 로그인 성공, current_owner_id 저장');
        localStorage.setItem('current_owner_id', data.user.id);
        
        // 관리자 로그인이므로 역할을 admin으로 설정
        localStorage.setItem('current_user_role', 'admin');
        
        // 로그인 유지 여부 저장
        if (rememberMe) {
            localStorage.setItem('remember_login', 'true');
        } else {
            // 로그인 유지 안 하면 세션만 사용
            localStorage.removeItem('remember_login');
        }

        // 페이지 상태 초기화 (선생님 선택 페이지로)
        setActivePage('TEACHER_SELECT');
        
        // 메인 페이지로 이동
        console.log('[signIn] 선생님 선택 페이지로 이동');
        showMainApp();
    } catch (error) {
        alert('오류 발생: ' + error.message);
    }
}

window.signOut = async function() {
    console.log('[signOut] 로그아웃 시작');
    // 먼저 localStorage 정리 (Supabase signOut 전에 실행)
    localStorage.removeItem('current_owner_id');
    localStorage.removeItem('current_user_role');
    localStorage.removeItem('current_user_name');
    localStorage.removeItem('remember_login');
    localStorage.removeItem('current_teacher_id');
    localStorage.removeItem('current_teacher_name');
    localStorage.removeItem('current_teacher_role');
    localStorage.removeItem('active_page');
    
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

window.toggleAuthForm = function() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'flex';
        signupForm.style.display = 'none';
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'flex';
    }
}

window.showMainApp = async function() {
    try {
        console.log('[showMainApp] 시작');

        const authPage = document.getElementById('auth-page');
        const teacherPage = document.getElementById('teacher-select-page');

        // 로그인 페이지는 먼저 숨김
        if (authPage) {
            authPage.style.display = 'none';
            authPage.style.visibility = 'hidden';
        }

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

        const lastTeacherId = localStorage.getItem('current_teacher_id');
        console.log('[showMainApp] 저장된 current_teacher_id:', lastTeacherId);

        // 이전에 선택한 선생님이 있고 목록에서 찾으면 바로 일정 페이지로 복원
        if (lastTeacherId && list && list.length > 0) {
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
        navigateToPage('TEACHER_SELECT');
    } catch (error) {
        console.error('[showMainApp] 에러:', error);
        console.error('[showMainApp] 에러 스택:', error.stack);
        alert('메인 앱 전환 중 에러\n\n에러: ' + (error.message || error));
    }
};

// 페이지 로드 시 인증 상태 초기화 (script.js의 DOMContentLoaded에서 호출됨)
window.initializeAuth = async function() {
    try {
        console.log('[initializeAuth] 시작');
        
        // Supabase 세션 확인
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('[initializeAuth] 세션 확인 에러:', error);
        }
        
        console.log('[initializeAuth] 세션 존재 여부:', !!session);

        // remember_me 상태를 체크박스에 반영
        const rememberFlag = localStorage.getItem('remember_login') === 'true';
        if (document.getElementById('remember-me')) {
            document.getElementById('remember-me').checked = rememberFlag;
        }

        // 세션이 있는데 remember_me가 꺼져 있으면 강제 로그아웃
        if (session && !rememberFlag) {
            console.log('[initializeAuth] remember_login 꺼짐 → 세션 정리 및 로그인 페이지 이동');
            localStorage.removeItem('current_owner_id');
            localStorage.removeItem('current_user_role');
            localStorage.removeItem('current_user_name');
            localStorage.removeItem('remember_login');
            localStorage.removeItem('current_teacher_id');
            localStorage.removeItem('current_teacher_name');
            localStorage.removeItem('current_teacher_role');
            localStorage.removeItem('active_page');
            await supabase.auth.signOut();
            navigateToPage('AUTH');
            return;
        }

        if (session) {
            // 세션이 있으면 사용자 ID 저장
            console.log('[initializeAuth] 세션 있음, current_owner_id 저장:', session.user.id);
            localStorage.setItem('current_owner_id', session.user.id);
            
            // 이전에 선택한 페이지 확인
            const lastPage = getActivePage();
            console.log('[initializeAuth] 이전 활성 페이지:', lastPage);
            
            // 선생님이 이미 선택되어 있으면 메인 앱으로, 아니면 선생님 선택 페이지로
            const lastTeacherId = localStorage.getItem('current_teacher_id');
            if (lastTeacherId) {
                console.log('[initializeAuth] 이전 선생님 선택 기록 있음:', lastTeacherId);
                // 선생님 선택 페이지로 이동 (자동 선택 처리)
                await showMainApp();
            } else {
                console.log('[initializeAuth] 선생님 선택 페이지로 이동');
                navigateToPage('TEACHER_SELECT');
            }
            return;
        }
        
        // 세션이 없으면 로그인 페이지 표시
        console.log('[initializeAuth] 세션 없음, 로그인 페이지 표시');
        navigateToPage('AUTH');
    } catch (err) {
        console.error('[initializeAuth] 에러:', err);
        navigateToPage('AUTH');
    }
};

