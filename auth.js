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
            localStorage.removeItem('current_teacher_id');
            localStorage.removeItem('current_teacher_name');
            localStorage.removeItem('active_page');
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
        navigateToPage('TEACHER_SELECT');
    } catch (error) {
        console.error('[showMainApp] 에러:', error);
        console.error('[showMainApp] 에러 스택:', error.stack);
        alert('메인 앱 전환 중 에러\n\n에러: ' + (error.message || error));
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
        console.log('[initializeAuth] 현재 active_page:', localStorage.getItem('active_page'));
        console.log('[initializeAuth] 현재 teacher_id:', localStorage.getItem('current_teacher_id'));

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
                
                if (!rememberLogin) {
                    console.log('[initializeAuth] 새 세션에서 remember_login 없음 - 세션 제거');
                    await supabase.auth.signOut();
                    await cleanupAndRedirectToAuth();
                    return;
                }
            }
            
            // ✅ 3단계: 세션이 있으면 users 테이블에서 실제로 사용자가 존재하는지 확인
            // (새로고침 시에는 스킵 - 이미 로그인된 사용자로 간주)
            if (!isRefresh) {
                console.log('[initializeAuth] 세션 있음, users 테이블 검증 중...');
                try {
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .select('id, email, role')
                        .eq('id', session.user.id)
                        .single();
                    
                    if (userError || !userData) {
                        console.error('[initializeAuth] users 테이블에 사용자 없음 - 세션 무효:', userError);
                        await supabase.auth.signOut();
                        throw new Error('사용자 계정이 존재하지 않습니다');
                    }
                    
                    console.log('[initializeAuth] 사용자 검증 완료:', userData.email);
                } catch (validationError) {
                    console.error('[initializeAuth] 사용자 검증 실패:', validationError);
                    await cleanupAndRedirectToAuth();
                    return;
                }
            } else {
                console.log('[initializeAuth] 새로고침 - users 테이블 검증 스킵 (빠른 복원)');
            }
            
            // ✅ 4단계: 세션이 유효하면 사용자 ID 저장
            console.log('[initializeAuth] 세션 유효, current_owner_id 저장:', session.user.id);
            localStorage.setItem('current_owner_id', session.user.id);
            
            // ✅ 5단계: 새로고침 vs 창 닫기 구분 및 페이지 복원
            if (isRefresh) {
                // 🔄 새로고침 (F5): 현재 페이지 상태 완전히 복원
                const currentPage = getActivePage();
                const lastTeacherId = localStorage.getItem('current_teacher_id');
                
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
                    // ✅ 로그인 유지 함: 선생님 정보 제거하고 선생님 선택 페이지로 이동 (보안)
                    console.log('[initializeAuth] 창 닫기 후 다시 열기 - 로그인 유지 활성화 → 선생님 정보 제거 후 선생님 선택 페이지');
                    localStorage.removeItem('current_teacher_id');
                    localStorage.removeItem('current_teacher_name');
                    localStorage.removeItem('current_teacher_role');
                    localStorage.removeItem('active_page');
                    await showMainApp(true);  // forceTeacherSelect=true로 선생님 선택 페이지 강제 표시
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
    localStorage.removeItem('current_teacher_id');
    localStorage.removeItem('current_teacher_name');
    localStorage.removeItem('current_teacher_role');
    localStorage.removeItem('active_page');
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

