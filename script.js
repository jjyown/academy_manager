let currentDate = new Date();
let currentView = 'month';
let students = [];  // 전역: 모든 학생 (학생목록은 통합)
let currentTeacherStudents = [];  // 현재 선생님의 학생만 (일정용)
let teacherScheduleData = {};  // 선생님별 일정 데이터: { teacherId: { studentId: { date: { start, duration } } } }
let customHolidays = {};
let dailyLayouts = {};
let currentPaymentDate = new Date();
let currentPaymentFilter = 'all';
let currentTeacher = null;
let currentTeacherId = null;
let teacherList = [];

// ========== 새로운: 페이지 상태 관리 ==========
const pageStates = {
    AUTH: 'auth-page',           // 로그인 페이지
    TEACHER_SELECT: 'teacher-select-page',  // 선생님 선택 페이지
    MAIN_APP: 'main-app'         // 일정관리 페이지
};

// 현재 활성 페이지 저장
function setActivePage(pageKey) {
    console.log('[setActivePage] 현재 페이지 저장:', pageKey);
    localStorage.setItem('active_page', pageKey);
}

// 현재 활성 페이지 조회
function getActivePage() {
    return localStorage.getItem('active_page');
}

// 특정 페이지로 이동 (상태 저장 + 표시)
function navigateToPage(pageKey) {
    console.log('[navigateToPage] 페이지 이동:', pageKey);
    
    // 모든 페이지 숨김
    Object.values(pageStates).forEach(pageId => {
        const page = document.getElementById(pageId);
        if (page) {
            page.style.display = 'none';
            page.style.visibility = 'hidden';
        }
    });
    
    // 해당 페이지만 표시
    const targetPage = document.getElementById(pageStates[pageKey] || pageKey);
    if (targetPage) {
        targetPage.style.display = 'flex';
        targetPage.style.visibility = 'visible';
    }
    
    // 페이지 상태 저장
    setActivePage(pageKey);
}

function getStorageKey(base) {
    return `${base}__${currentTeacherId || 'no-teacher'}`;
}

// 전역 보관소 키(선생님 구분 없이 모든 학생 공유)
function getGlobalStorageKey(base) {
    return `${base}__global`;
}

window.setPaymentFilter = function(filter) {
    currentPaymentFilter = filter;
    document.querySelectorAll('.p-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.p-filter-btn[onclick="setPaymentFilter('${filter}')"]`).classList.add('active');
    renderPaymentList();
    updateSummary();
}

const LUNAR_HOLIDAYS_DB = {
    "2026": { "02-16":"설날","02-17":"설날","02-18":"설날","03-02":"대체공휴일","05-24":"부처님오신날","09-24":"추석","09-25":"추석","09-26":"추석" }
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[DOMContentLoaded] 페이지 로드 시작');
    
    // ===== 1단계: 인증 상태 확인 =====
    console.log('[DOMContentLoaded] 인증 초기화 시작...');
    if (typeof initializeAuth === 'function') {
        await initializeAuth();
        console.log('[DOMContentLoaded] 인증 초기화 완료');
    } else {
        console.error('[DOMContentLoaded] initializeAuth 함수 없음');
    }
    
    // ===== 2단계: 메인 앱 UI 초기화 (로그인 후 선생님 선택 후에 실행) =====
    console.log('[DOMContentLoaded] UI 이벤트 리스너 등록 중...');
    
    // 버튼이 존재하는지 확인 후 이벤트 리스너 추가
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (prevBtn) prevBtn.onclick = () => moveDate(-1);
    if (nextBtn) nextBtn.onclick = () => moveDate(1);
    
    const jumpDatePicker = document.getElementById('jump-date-picker');
    if (jumpDatePicker) {
        jumpDatePicker.addEventListener('change', (e) => {
            if(e.target.value) {
                currentDate = new Date(e.target.value);
                renderCalendar();
                e.target.value = '';
            }
        });
    }

    document.addEventListener('mousemove', (e) => {
        const tooltip = document.getElementById('calendar-tooltip');
        if(tooltip && tooltip.style.display === 'block') {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        }
    });

    setupHolidayColorChips();
    // 새로고침 시 마지막 활성 페이지로 복원
    try {
        restorePageOnLoad();
    } catch (e) {
        console.error('[DOMContentLoaded] 페이지 복원 중 오류:', e);
    }
    
    // 권한 메뉴 가시성 및 역할 라벨 업데이트
    updatePaymentMenuVisibility();
    updateUserRoleLabel();
    
    console.log('[DOMContentLoaded] 페이지 로드 완료');
});

function setupHolidayColorChips() {
    const chips = document.querySelectorAll('.color-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const color = chip.dataset.color;
            setHolidayColor(color);
        });
    });
}

// 기능 메뉴 드로어 토글
window.toggleFeaturePanel = function() {
    const drawer = document.getElementById('feature-drawer');
    const overlay = document.getElementById('feature-overlay');
    if (!drawer || !overlay) return;
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        drawer.classList.remove('open');
        overlay.style.display = 'none';
    } else {
        drawer.classList.add('open');
        overlay.style.display = 'block';
    }
}

window.closeFeaturePanel = function() {
    const drawer = document.getElementById('feature-drawer');
    const overlay = document.getElementById('feature-overlay');
    if (!drawer || !overlay) return;
    drawer.classList.remove('open');
    overlay.style.display = 'none';
}

// Allow closing the feature drawer via ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        try { window.closeFeaturePanel(); } catch (_) {}
    }
});

// 새로고침 시 상태 복원: 마지막 활성 페이지와 선택된 선생님 유지
function restorePageOnLoad() {
    const savedPage = getActivePage();
    const savedTeacherId = localStorage.getItem('current_teacher_id');
    const savedTeacherName = localStorage.getItem('current_teacher_name') || '';

    console.log('[restorePageOnLoad] savedPage:', savedPage, 'savedTeacherId:', savedTeacherId);

    // 선생님이 이미 선택되어 있다면, 어떤 페이지가 저장되어 있더라도 일정 페이지로 복원
    if (savedTeacherId) {
        currentTeacherId = savedTeacherId;
        currentTeacher = { id: savedTeacherId, name: savedTeacherName };

        navigateToPage('MAIN_APP');

        const label = document.getElementById('current-teacher-name');
        if (label) label.textContent = savedTeacherName || '미선택';

        loadAndCleanData();
        loadTeacherScheduleData(currentTeacherId);
        renderCalendar();
        // 드롭다운 및 목록 동기화는 백그라운드로
        loadTeachers();
        return;
    }

    // 선생님 정보가 없으면 저장된 페이지 상태에 따라 이동
    if (savedPage === 'TEACHER_SELECT') {
        navigateToPage('TEACHER_SELECT');
        loadTeachers();
        return;
    }

    // 기본: 인증 페이지
    navigateToPage('AUTH');
}

function setHolidayColor(color) {
    const chips = document.querySelectorAll('.color-chip');
    chips.forEach(c => {
        if (c.dataset.color === color) c.classList.add('active');
        else c.classList.remove('active');
    });
    const colorInput = document.getElementById('holiday-color');
    if (colorInput) colorInput.value = color;
}

async function hashPin(pin) {
    const enc = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadTeachers() {
    try {
        console.log('[loadTeachers] 시작');
        
        const ownerId = localStorage.getItem('current_owner_id');
        console.log('[loadTeachers] current_owner_id:', ownerId);
        
        if (!ownerId) {
            console.warn('[loadTeachers] current_owner_id 없음');
            teacherList = [];
            renderTeacherDropdown();
            return [];
        }
        
        console.log('[loadTeachers] Supabase에서 선생님 조회 중...');
        const { data, error } = await supabase
            .from('teachers')
            .select('id, name, phone, pin_hash')
            .eq('owner_user_id', ownerId)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('[loadTeachers] Supabase 조회 에러:', error);
            console.error('[loadTeachers] 에러 상세:', error.message, error.code);
            teacherList = [];
            renderTeacherDropdown();
            return [];
        }
        
        console.log('[loadTeachers] 조회 성공, 선생님 수:', (data || []).length + '명');
        console.log('[loadTeachers] 조회된 데이터:', data);
        
        teacherList = (data || []).map(t => ({
            ...t,
            role: t.role || 'teacher'  // role이 없으면 기본값 'teacher' 설정
        }));
        renderTeacherDropdown();
        
        console.log('[loadTeachers] 완료, teacherList:', teacherList);
        return teacherList;
    } catch (err) {
        console.error('[loadTeachers] 예외 발생:', err);
        teacherList = [];
        renderTeacherDropdown();
        return [];
    }
}

function renderTeacherDropdown() {
    const dropdown = document.getElementById('teacher-dropdown');
    console.log('[renderTeacherDropdown] 드롭다운 요소 확인:', dropdown ? '있음' : '없음');
    
    if (!dropdown) {
        console.warn('[renderTeacherDropdown] teacher-dropdown 요소를 찾을 수 없습니다. 페이지 구조를 확인하세요.');
        return;
    }
    
    dropdown.innerHTML = '<option value="">선생님을 선택해주세요</option>';
    
    if (!teacherList || teacherList.length === 0) {
        console.log('[renderTeacherDropdown] 선생님 목록이 비어있습니다.');
        dropdown.innerHTML += '<option disabled>등록된 선생님이 없습니다</option>';
        return;
    }
    
    console.log('[renderTeacherDropdown] 드롭다운에 선생님 추가 중, 총:', teacherList.length + '명');
    teacherList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name + (t.phone ? ` (${t.phone})` : '');
        dropdown.appendChild(opt);
        console.log('[renderTeacherDropdown] 추가됨:', t.name);
    });
    
    console.log('[renderTeacherDropdown] 완료');
}

window.toggleTeacherForm = function() {
    const selectForm = document.getElementById('teacher-select-form');
    const registerForm = document.getElementById('teacher-register-form');

    if (selectForm.style.display === 'none' || !selectForm.style.display) {
        selectForm.style.display = 'flex';
        registerForm.style.display = 'none';
    } else {
        selectForm.style.display = 'none';
        registerForm.style.display = 'flex';
        // 등록 폼을 표시할 때 현재 역할에 따라 필드 초기화
        handleNewTeacherRoleChange();
    }
}

// 새 선생님 등록 폼에서 역할 선택 시 인증 필드 표시
window.handleNewTeacherRoleChange = function() {
    console.log('[handleNewTeacherRoleChange] 시작');
    const role = document.getElementById('new-teacher-role').value;
    const adminEmailSection = document.getElementById('register-admin-email-section');
    const adminPasswordSection = document.getElementById('register-admin-password-section');
    
    console.log('[handleNewTeacherRoleChange] 역할:', role);
    console.log('[handleNewTeacherRoleChange] adminEmailSection:', adminEmailSection);
    console.log('[handleNewTeacherRoleChange] adminPasswordSection:', adminPasswordSection);
    
    if (role === 'admin') {
        // 관리자: 이메일 + 비밀번호 입력 필드 표시
        console.log('[handleNewTeacherRoleChange] 관리자 필드 표시');
        adminEmailSection.style.display = 'flex';
        adminPasswordSection.style.display = 'flex';
        document.getElementById('register-admin-email').value = '';
        document.getElementById('register-admin-auth-password').value = '';
    } else {
        // 일반 선생님/직원: 인증 필드 숨기기
        console.log('[handleNewTeacherRoleChange] 관리자 필드 숨기기');
        adminEmailSection.style.display = 'none';
        adminPasswordSection.style.display = 'none';
    }
}

async function setCurrentTeacher(teacher) {
    try {
        console.log('[setCurrentTeacher] 시작, 선택된 선생님:', teacher);
        
        if (!teacher || !teacher.id) {
            console.error('[setCurrentTeacher] 유효하지 않은 선생님 정보');
            alert('선생님 정보가 유효하지 않습니다.');
            return;
        }
        
        // localStorage의 current_owner_id 확인
        const ownerId = localStorage.getItem('current_owner_id');
        console.log('[setCurrentTeacher] current_owner_id:', ownerId);
        
        if (!ownerId) {
            console.warn('[setCurrentTeacher] current_owner_id 없음, 세션 만료');
            alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
            // 로그인 페이지로 이동
            await initializeAuth();
            return;
        }
        
        // 전역 변수 설정
        currentTeacher = teacher;
        currentTeacherId = teacher.id;
        
        // 선택된 선생님을 로컬 저장해 새로고침 후에도 유지
        localStorage.setItem('current_teacher_id', teacher.id);
        localStorage.setItem('current_teacher_name', teacher.name || '');
        console.log('[setCurrentTeacher] 로컬 저장 완료, teacherId:', teacher.id);
        
        // 1단계: 관리자별 모든 학생 로드
        console.log('[setCurrentTeacher] 1단계: 학생 데이터 로드 중...');
        loadAndCleanData();
        console.log('[setCurrentTeacher] 1단계 완료, 전체 학생:', students.length);
        
        // 2단계: 현재 선생님의 학생 매핑 키 구성
        const teacherStudentsKey = `teacher_students_mapping__${teacher.id}`;
        let teacherStudentIds = [];
        const saved = localStorage.getItem(teacherStudentsKey);
        if (saved) {
            try {
                teacherStudentIds = JSON.parse(saved) || [];
            } catch (e) {
                console.error('[setCurrentTeacher] 선생님-학생 매핑 파싱 실패:', e);
                teacherStudentIds = [];
            }
        }
        console.log('[setCurrentTeacher] 2단계: 선생님에 할당된 학생 ID:', teacherStudentIds);
        
        // 3단계: 학생 목록에서 현재 선생님에 할당된 학생만 필터링
        currentTeacherStudents = students.filter(s => teacherStudentIds.includes(s.id));
        console.log('[setCurrentTeacher] 3단계: 현재 선생님의 학생 필터링 완료 -', currentTeacherStudents.length + '명');
        
        // 4단계: 현재 선생님의 일정 데이터 로드
        console.log('[setCurrentTeacher] 4단계: 일정 데이터 로드 중...');
        loadTeacherScheduleData(teacher.id);
        
        // 5단계: 페이지를 MAIN_APP으로 전환
        console.log('[setCurrentTeacher] 5단계: 페이지 전환 중...');
        navigateToPage('MAIN_APP');
        
        // DOM이 렌더링될 때까지 약간의 지연
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 6단계: UI 업데이트 (레이블)
        console.log('[setCurrentTeacher] 6단계: UI 업데이트 중...');
        const label = document.getElementById('current-teacher-name');
        if (label) {
            label.textContent = teacher.name;
            console.log('[setCurrentTeacher] 레이블 업데이트 완료:', teacher.name);
        } else {
            console.warn('[setCurrentTeacher] 레이블 요소를 찾을 수 없음');
        }
        
        // 7단계: 캘린더 렌더링
        console.log('[setCurrentTeacher] 7단계: 캘린더 렌더링 중...');
        renderCalendar();
        
        // 8단계: 권한 메뉴 및 역할 라벨 업데이트
        console.log('[setCurrentTeacher] 8단계: 권한 메뉴 및 역할 라벨 업데이트...');
        updatePaymentMenuVisibility();
        updateTeacherMenuVisibility();
        updateUserRoleLabel();
        
        console.log('[setCurrentTeacher] 완료 - 선생님:', teacher.name);
    } catch (err) {
        console.error('[setCurrentTeacher] 에러 발생:', err);
        console.error('[setCurrentTeacher] 에러 스택:', err.stack);
        alert('선생님 선택 중 에러가 발생했습니다.\n\n에러: ' + (err.message || err));
    }
}

// 선생님 선택 변경 시 비밀번호 필드 표시
window.onTeacherSelected = function() {
    const teacherId = document.getElementById('teacher-dropdown').value;
    const teacherPasswordSection = document.getElementById('teacher-password-section');
    
    console.log('[onTeacherSelected] teacherId:', teacherId);
    
    if (!teacherId) {
        // 선생님을 선택하지 않았으면 비밀번호 필드 숨기기
        teacherPasswordSection.style.display = 'none';
        return;
    }
    
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return;
    
    // 모든 선생님(관리자 포함)은 비밀번호 입력 필요
    console.log('[onTeacherSelected] 비밀번호 필드 표시');
    teacherPasswordSection.style.display = 'flex';
    document.getElementById('teacher-select-password').value = '';
}

window.confirmTeacher = async function() {
    console.log('[confirmTeacher] 시작');
    const teacherId = document.getElementById('teacher-dropdown').value;
    if (!teacherId) return alert('선생님을 선택해주세요.');
    
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return alert('선택한 선생님을 찾을 수 없습니다.');
    
    console.log('[confirmTeacher] 선택된 선생님:', teacher.name);
    
    // 모든 선생님(관리자 포함)은 개인 비밀번호로 인증
    const password = document.getElementById('teacher-select-password').value.trim();
    
    if (!password) {
        return alert('비밀번호를 입력해주세요');
    }
    
    const storedPassword = localStorage.getItem('teacher_' + teacher.name + '_password');
    console.log('[confirmTeacher] 입력된 비밀번호:', password);
    console.log('[confirmTeacher] 저장된 비밀번호:', storedPassword);
    console.log('[confirmTeacher] 선생님:', teacher.name);
    
    if (password !== storedPassword) {
        return alert('비밀번호가 일치하지 않습니다.');
    }
    
    console.log('[confirmTeacher] 비밀번호 인증 성공');
    await setCurrentTeacher(teacher);
}

window.deleteTeacher = async function() {
    const teacherId = document.getElementById('teacher-dropdown').value;
    if (!teacherId) return alert('삭제할 선생님을 선택해주세요.');

    const target = teacherList.find(t => String(t.id) === String(teacherId));
    const targetName = target ? target.name : '선생님';
    if (!confirm(`${targetName}을(를) 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) return;

    const ownerId = localStorage.getItem('current_owner_id');
    if (!ownerId) return alert('로그인이 필요합니다.');

    const { error } = await supabase
        .from('teachers')
        .delete()
        .eq('id', teacherId)
        .eq('owner_user_id', ownerId);

    if (error) {
        console.error('선생님 삭제 실패', error);
        return alert('삭제 실패: ' + error.message);
    }

    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        localStorage.removeItem('current_teacher_id');
        localStorage.removeItem('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
        }
    }

    alert('선생님이 삭제되었습니다.');
    await loadTeachers();
    const dropdown = document.getElementById('teacher-dropdown');
    if (dropdown) dropdown.value = '';
}

// 관리자(소유자) 강제 삭제: 관리자 비밀번호 재입력 필요
window.adminDeleteTeacher = async function() {
    const dropdown = document.getElementById('teacher-dropdown');
    const teacherId = dropdown ? dropdown.value : '';
    if (!teacherId) return alert('삭제할 선생님을 선택해주세요.');

    const target = teacherList.find(t => String(t.id) === String(teacherId));
    const name = target ? target.name : '선생님';
    if (!confirm(`${name}을(를) 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) return alert('로그인이 필요합니다.');

    const adminEmail = session.user?.email;
    const password = prompt('관리자 비밀번호를 입력하세요 (로그인 비밀번호):');
    if (password === null) return; // 취소
    if (!password.trim()) return alert('비밀번호를 입력해주세요.');

    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: adminEmail, password });
    if (reauthError) {
        console.error('재인증 실패', reauthError);
        return alert('비밀번호가 올바르지 않습니다.');
    }

    const ok = await deleteTeacherById(teacherId);
    if (!ok) return;

    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        localStorage.removeItem('current_teacher_id');
        localStorage.removeItem('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
        }
    }

    alert('강제 삭제가 완료되었습니다.');
    await loadTeachers();
    if (dropdown) dropdown.value = '';
}

window.registerTeacher = async function() {
    try {
        console.log('[registerTeacher] 시작');
        const name = document.getElementById('new-teacher-name').value.trim();
        const phone = document.getElementById('new-teacher-phone').value.trim();
        const role = document.getElementById('new-teacher-role').value;
        const teacherPassword = document.getElementById('register-teacher-password').value.trim();
        
        console.log('[registerTeacher] 입력 값 - name:', name, ', phone:', phone, ', role:', role);
        
        if (!name) return alert('선생님 이름은 필수입니다.');
        
        // 모든 선생님은 비밀번호가 필수 (개인 프라이버시)
        if (!teacherPassword) {
            return alert('비밀번호는 필수입니다.');
        }
        
        // 관리자로 등록하는 경우 이메일과 비밀번호 인증 필요
        if (role === 'admin') {
            const adminEmail = document.getElementById('register-admin-email').value.trim();
            const adminPassword = document.getElementById('register-admin-auth-password').value.trim();
            
            if (!adminEmail || !adminPassword) {
                return alert('관리자로 등록하려면 이메일과 비밀번호를 입력해주세요.');
            }
            
            try {
                console.log('[registerTeacher] 관리자 인증 시작');
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: adminEmail,
                    password: adminPassword
                });
                
                if (error) {
                    console.error('[registerTeacher] 관리자 인증 실패:', error);
                    return alert('관리자 인증 실패: 이메일 또는 비밀번호가 올바르지 않습니다.');
                }
                
                console.log('[registerTeacher] 관리자 인증 성공');
            } catch (authError) {
                console.error('[registerTeacher] 인증 에러:', authError);
                return alert('인증 실패: ' + authError.message);
            }
        }
        
        // 저장된 현재 관리자 ID 확인
        const ownerId = localStorage.getItem('current_owner_id');
        console.log('[registerTeacher] current_owner_id:', ownerId);
        
        if (!ownerId) {
            console.error('[registerTeacher] 로그인 정보 없음');
            alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
            navigateToPage('AUTH');
            return;
        }
        
        console.log('[registerTeacher] Supabase insert 시작...');
        const { data, error } = await supabase
            .from('teachers')
            .insert({ owner_user_id: ownerId, name, phone: phone || null, pin_hash: '' })
            .select()
            .single();
        
        if (error) {
            console.error('[registerTeacher] Supabase 에러:', error);
            console.error('[registerTeacher] 에러 상세:', error.message, error.code, error.details);
            return alert('선생님 등록 실패:\n' + error.message);
        }
        
        console.log('[registerTeacher] 등록 성공:', data);
        
        // 로컬스토리지에 역할과 비밀번호 저장
        localStorage.setItem('teacher_' + name + '_role', role);
        localStorage.setItem('teacher_' + name + '_password', teacherPassword);
        
        console.log('[registerTeacher] 저장됨 - 역할:', role, ', 비밀번호:', teacherPassword);
        
        // 입력 필드 초기화
        document.getElementById('new-teacher-name').value = '';
        document.getElementById('new-teacher-phone').value = '';
        document.getElementById('new-teacher-role').value = 'teacher';
        document.getElementById('register-teacher-password').value = '';
        document.getElementById('register-admin-email').value = '';
        document.getElementById('register-admin-auth-password').value = '';
        
        alert('선생님이 등록되었습니다!');
        
        // 선생님 목록 새로고침
        console.log('[registerTeacher] 선생님 목록 새로고침 중...');
        await loadTeachers();
        
        // 선생님 선택 화면으로 돌아가기
        console.log('[registerTeacher] 선생님 선택 폼으로 전환');
        toggleTeacherForm();
    } catch (err) {
        console.error('[registerTeacher] 예외 발생:', err);
        console.error('[registerTeacher] 스택:', err.stack);
        alert('오류 발생: ' + (err.message || err));
    }
}

window.showTeacherSelectPage = async function() {
    console.log('[showTeacherSelectPage] 선생님 선택 페이지로 이동');
    navigateToPage('TEACHER_SELECT');
    await loadTeachers();
}

const defaultColor = '#ef4444';

function getHolidayInfo(dateStr) {
    if (customHolidays.hasOwnProperty(dateStr)) {
        const raw = customHolidays[dateStr];
        if (typeof raw === 'string') return { name: raw, color: defaultColor };
        return { name: raw.name || '', color: raw.color || defaultColor };
    }
    const [year, month, day] = dateStr.split('-');
    const mmdd = `${month}-${day}`;
    const solarHolidays = { "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일", "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절" };
    if (solarHolidays[mmdd]) return { name: solarHolidays[mmdd], color: defaultColor };
    if (LUNAR_HOLIDAYS_DB[year] && LUNAR_HOLIDAYS_DB[year][mmdd]) {
        return { name: LUNAR_HOLIDAYS_DB[year][mmdd], color: defaultColor };
    }
    return null;
}

function saveLayouts() { 
    const layoutKey = `academy_daily_layouts__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(layoutKey, JSON.stringify(dailyLayouts)); 
    console.log(`레이아웃 저장 (${currentTeacherId})`);
}

function getHolidayName(dateStr) {
    const info = getHolidayInfo(dateStr);
    return info ? info.name : null;
}

function getGradeColorClass(grade) {
    if(!grade) return 'evt-color-default';
    if(grade.includes('초')) return 'evt-grade-cho';
    if(grade.includes('중')) return 'evt-grade-jung';
    if(grade.includes('고')) return 'evt-grade-go';
    return 'evt-color-default';
}

function getSubItemColorClass(grade) {
    if(!grade) return 'sub-color-default';
    if(grade.includes('초')) return 'sub-grade-cho';
    if(grade.includes('중')) return 'sub-grade-jung';
    if(grade.includes('고')) return 'sub-grade-go';
    return 'sub-color-default';
}

window.renderCalendar = function() {
    const grid = document.getElementById('calendar-grid');
    const display = document.getElementById('current-display');
    
    console.log('[renderCalendar] 시작', {
        grid: !!grid,
        display: !!display,
        currentView,
        currentTeacherStudents: currentTeacherStudents.length,
        currentDate
    });
    
    if(!grid || !display) {
        console.error('[renderCalendar] 필수 요소 없음', { grid: !!grid, display: !!display });
        return;
    }

    grid.innerHTML = '';
    let loopStart, loopEnd;

    if (currentView === 'month') {
        display.textContent = `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월`;
        const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        for (let i = 0; i < firstDay.getDay(); i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'grid-cell empty';
            grid.appendChild(emptyCell);
        }
        loopStart = 1; loopEnd = lastDay.getDate();
    } else {
        const start = new Date(currentDate);
        start.setDate(currentDate.getDate() - currentDate.getDay());
        display.textContent = `${start.getMonth()+1}월 ${start.getDate()}일 주간`;
        loopStart = 0; loopEnd = 6;
    }

    // 현재 선생님의 학생만 필터링 (다른 선생님의 일정은 보이지 않음)
    const activeStudents = currentTeacherStudents.filter(s => s.status === 'active');
    
    console.log('[renderCalendar] activeStudents:', activeStudents.length);

    for (let i = loopStart; i <= loopEnd; i++) {
        let dateObj;
        if (currentView === 'month') {
            dateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), i);
        } else {
            const start = new Date(currentDate);
            start.setDate(currentDate.getDate() - currentDate.getDay());
            dateObj = new Date(start);
            dateObj.setDate(start.getDate() + i);
        }
        // 현재 선생님의 학생만으로 셀 렌더링
        grid.appendChild(createCell(dateObj, activeStudents));
    }
    
    console.log('[renderCalendar] 완료');
}

function createCell(date, activeStudents) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    const offset = date.getTimezoneOffset() * 60000;
    const dateStr = new Date(date.getTime() - offset).toISOString().split('T')[0];
    cell.dataset.date = dateStr;

    cell.addEventListener('dragover', handleDragOver);
    cell.addEventListener('dragleave', handleDragLeave);
    cell.addEventListener('drop', handleDrop);

    cell.addEventListener('click', (e) => {
        if(e.target.closest('.student-tag')) return;
        if(e.button === 0) {
            openDaySettings(dateStr);
        }
    });


    const day = date.getDay();
    const holidayInfo = getHolidayInfo(dateStr);
    const holidayName = holidayInfo ? holidayInfo.name : '';
    let dayClass = '';
    if (day === 0 || holidayInfo) dayClass = 'is-holiday';
    else if (day === 6) dayClass = 'sat';

    if (holidayInfo) {
        cell.classList.add('custom-holiday');
        cell.style.setProperty('--holiday-color', holidayInfo.color || 'var(--red)');
    }

    cell.innerHTML = `
        <span class="date-num ${dayClass}">${date.getDate()}</span>
        <span class="holiday-name">${holidayName || ''}</span>
    `;

    let dailyEvents = [];
    activeStudents.forEach(student => {
        // 현재 선생님의 schedule 데이터에서만 확인 (다른 선생님의 일정은 제외)
        if (student && teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][student.id] && 
            teacherScheduleData[currentTeacherId][student.id][dateStr]) {
            dailyEvents.push(student);
        }
    });

    if (dailyEvents.length > 0) {
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'summary-badge-container';
        const badge = document.createElement('div');
        badge.className = 'summary-badge has-events';
        badge.innerHTML = `<i class="fas fa-chalkboard-teacher"></i> ${dailyEvents.length}명`;
        badge.onclick = (e) => { e.stopPropagation(); openDayDetailModal(dateStr); };
        badgeContainer.appendChild(badge);
        cell.appendChild(badgeContainer);
    }
    return cell;
}

// ... (기존 캘린더 드래그앤드롭 및 상세 모달 관련 코드 생략 없이 유지 - 지면 관계상 핵심 로직 외 생략하지 않고 모두 포함) ...
// (하지만 요청하신 전체 코드를 위해 아래 핵심 함수들을 모두 유지합니다)

let currentDetailDate = null;
window.openDayDetailModal = function(dateStr) {
    const modal = document.getElementById('day-detail-modal');
    modal.style.display = 'flex';
    document.getElementById('day-detail-title').textContent = `${dateStr} 시간표`;
    currentDetailDate = dateStr;
    renderDayEvents(dateStr);
}

window.renderDayEvents = function(dateStr) {
    const axis = document.getElementById('time-axis');
    const grid = document.getElementById('time-grid');
    axis.innerHTML = '';
    grid.innerHTML = '';

    const startHour = 0; // Start at 00:00
    const endHour = 24; // End at 24:00 (which is really 00:00 of the next day, but represents the full 24 hours)
    const pxPerMin = 1.0; // 1 minute = 1 pixel. This can be adjusted for zoom.

    // Render time axis
    for(let h = startHour; h < endHour; h++) { // Loop up to 23 for hours
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        label.style.height = (60 * pxPerMin) + 'px';
        axis.appendChild(label);
    }
    // Add a label for 24:00 or "end of day" if needed, or simply let the last hour mark the end.
    // For now, let's keep it simple and represent 00-23 hours distinctly.
    
    // Set grid height to cover the full 24 hours (1440 minutes * pxPerMin)
    grid.style.height = (24 * 60 * pxPerMin) + 'px';

    // 현재 선생님의 학생만 필터링 (다른 선생님의 일정은 보이지 않음)
    const activeStudents = currentTeacherStudents.filter(s => s.status === 'active');
    let rawEvents = [];
    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    activeStudents.forEach((s) => {
        // 현재 선생님의 schedule 데이터에서만 확인
        if(teacherSchedule[s.id] && teacherSchedule[s.id][dateStr]) {
            const studentSchedule = teacherSchedule[s.id];
            const detail = studentSchedule[dateStr] || { start: '16:00', duration: 90 };
            const [h, m] = detail.start.split(':').map(Number);
            let startMin = (h * 60) + m; // Calculate start minutes from 00:00
            // Ensure startMin is within bounds, though it should be if time input is valid
            if (startMin < 0) startMin = 0;
            if (startMin >= 24 * 60) startMin = (24 * 60) - 1; // Cap at end of day
            
            rawEvents.push({ student: s, startMin: startMin, duration: parseInt(detail.duration), originalStart: detail.start });
        }
    });
    let groupedEvents = {}; 
    rawEvents.forEach(ev => {
        const key = `${ev.startMin}-${ev.duration}`;
        if (!groupedEvents[key]) groupedEvents[key] = { type: 'group', startMin: ev.startMin, duration: ev.duration, originalStart: ev.originalStart, members: [] };
        groupedEvents[key].members.push(ev.student);
    });
    let layoutEvents = Object.values(groupedEvents).sort((a, b) => a.startMin - b.startMin);
    let columns = []; 
    layoutEvents.forEach(ev => {
        let placed = false;
        // Try to place the event in an existing column
        for(let i = 0; i < columns.length; i++) {
            let overlaps = false;
            // Check for overlap with any event already in this column
            for(let existingEv of columns[i]) {
                // If existing event ends after current event starts, AND current event ends after existing event starts
                if (existingEv.startMin + existingEv.duration > ev.startMin &&
                    ev.startMin + ev.duration > existingEv.startMin) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) {
                columns[i].push(ev);
                ev.colIndex = i;
                placed = true;
                break;
            }
        }
        if(!placed) { // If it doesn't fit into any existing column, create a new one
            columns.push([ev]);
            ev.colIndex = columns.length - 1;
        }
    });
    const colCount = columns.length > 0 ? columns.length : 1;
    const defaultSlotWidth = 100 / colCount;
    if (!dailyLayouts[dateStr]) dailyLayouts[dateStr] = {};
    const savedPositions = dailyLayouts[dateStr].positions || {};
    const savedWidths = dailyLayouts[dateStr].widths || {};

    layoutEvents.forEach(ev => {
        const isMerged = ev.members.length > 1;
        const blockId = isMerged ? `group-${ev.startMin}-${ev.duration}` : ev.members[0].id;
        const block = document.createElement('div');
        
        // Merged 그룹도 학년별 색상 적용
        if (isMerged) {
            const grades = ev.members.map(m => {
                if (m.grade.includes('초')) return 'cho';
                if (m.grade.includes('중')) return 'jung';
                if (m.grade.includes('고')) return 'go';
                return 'default';
            });
            const uniqueGrades = [...new Set(grades)];
            const gradeClass = uniqueGrades.length === 1 ? `merged-grade-${uniqueGrades[0]}` : 'merged-grade-mixed';
            block.className = `event-block ${gradeClass}`;
        } else {
            block.className = `event-block ${getGradeColorClass(ev.members[0].grade)}`;
        }
        block.style.top = (ev.startMin * pxPerMin) + 'px';
        block.style.height = (ev.duration * pxPerMin) + 'px'; 
        block.style.left = (savedPositions[blockId] !== undefined ? savedPositions[blockId] : ev.colIndex * defaultSlotWidth) + '%';
        block.style.width = (savedWidths[blockId] !== undefined ? savedWidths[blockId] : defaultSlotWidth * 0.95) + '%';
        
        
        const endTotalMin = (ev.originalStart.split(':')[0]*60 + parseInt(ev.originalStart.split(':')[1])) + ev.duration;
        let endH = Math.floor(endTotalMin / 60); const endM = endTotalMin % 60;
        // If endH is 24, display as 24:00 (end of day), otherwise wrap around (e.g., 25:00 becomes 01:00)
        const endTimeStr = `${String(endH % 24).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;

        const resizeHandle = document.createElement('div'); resizeHandle.className = 'resize-handle'; block.appendChild(resizeHandle);
        const contentDiv = document.createElement('div');
        contentDiv.style.flex = "1"; contentDiv.style.overflow = "hidden"; contentDiv.style.display = "flex"; contentDiv.style.flexDirection = "column";
        if (isMerged) {
            contentDiv.innerHTML = `<div class="merged-header"><span>${ev.originalStart}~${endTimeStr}</span><span style="opacity:0.8; font-size:10px;">${ev.members.length}명</span></div><div class="merged-list">${ev.members.map(m => {
                const status = (m.attendance && m.attendance[dateStr]) || '';
                let icon = status === 'present' ? '✅' : status === 'absent' ? '❌' : status === 'etc' ? '⚠️' : '';
                return `<div class="sub-event-item ${getSubItemColorClass(m.grade)}" onclick="event.stopPropagation(); openAttendanceModal('${m.id}', '${dateStr}')"><div class="sub-info"><span class="sub-name">${m.name}</span><span class="sub-grade">${m.grade}</span></div><span class="sub-icon">${icon}</span></div>`;
            }).join('')}</div>`;
        } else {
            const s = ev.members[0];
            const status = (s.attendance && s.attendance[dateStr]) || 'none';
            const statusIcon = status === 'present' ? '✅' : status === 'absent' ? '❌' : status === 'etc' ? '⚠️' : '';
            contentDiv.innerHTML = `<div class="evt-title">${s.name} <span class="evt-grade">(${s.grade})</span> ${statusIcon}</div><div class="event-time-text">${ev.originalStart} - ${endTimeStr} (${ev.duration}분)</div>`;
            block.onclick = (e) => { 
                if(block.getAttribute('data-action-status') === 'moved' || block.getAttribute('data-action-status') === 'resized') { e.stopPropagation(); block.setAttribute('data-action-status', 'none'); return; }
                if(e.target.classList.contains('resize-handle')) return;
                e.stopPropagation(); openAttendanceModal(s.id, dateStr); 
            };
        }
        block.appendChild(contentDiv);
        resizeHandle.onmousedown = function(e) {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX;
            const startWidth = block.offsetWidth;
            const parentWidth = grid.offsetWidth;
            let isResized = false;

            function onResizeMove(ev) {
                const dx = ev.clientX - startX;
                const newWidthPx = startWidth + dx;
                if (newWidthPx > 30 && newWidthPx <= parentWidth) {
                    block.style.width = (newWidthPx / parentWidth) * 100 + '%';
                    isResized = true;
                }
            }

            function onResizeUp() {
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);

                if (isResized) {
                    block.setAttribute('data-action-status', 'resized');
                    if(!dailyLayouts[dateStr]) dailyLayouts[dateStr] = {};
                    if(!dailyLayouts[dateStr].widths) dailyLayouts[dateStr].widths = {};
                    dailyLayouts[dateStr].widths[blockId] = (block.offsetWidth / parentWidth) * 100;
                    saveLayouts();
                    renderDayEvents(dateStr); // Re-render to reflect changes
                }
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        };
        block.onmousedown = function(e) {
            if (e.target.classList.contains('resize-handle') || e.target.closest('.sub-event-item')) return;
            e.preventDefault();

            const startX = e.clientX;
            const parentWidth = grid.offsetWidth;
            const initialLeftPercent = (block.offsetLeft / parentWidth) * 100;
            let isMoved = false;

            function onMove(ev) {
                const dx = ev.clientX - startX;
                if(Math.abs(dx) > 3) {
                    isMoved = true;
                    let newLeft = initialLeftPercent + (dx / parentWidth) * 100;
                    if(newLeft < 0) newLeft = 0;
                    block.style.left = newLeft + '%';
                }
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                if (isMoved) {
                    block.setAttribute('data-action-status', 'moved');
                    if(!dailyLayouts[dateStr]) dailyLayouts[dateStr] = {};
                    if(!dailyLayouts[dateStr].positions) dailyLayouts[dateStr].positions = {};
                    dailyLayouts[dateStr].positions[blockId] = (block.offsetLeft / parentWidth) * 100;
                    saveLayouts();
                    renderDayEvents(dateStr); // Re-render to reflect changes
                } else {
                    block.setAttribute('data-action-status', 'none');
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
        grid.appendChild(block);
    });
}

// ... (기타 모달 Open/Close 및 CRUD 로직 생략 없이 유지) ...

window.openAttendanceModal = function(sid, dateStr) {
    const s = students.find(x => String(x.id) === String(sid));
    if(!s) return;
    document.getElementById('attendance-modal').style.display = 'flex';
    document.getElementById('att-modal-title').textContent = `${s.name} 수업 관리`;
    document.getElementById('att-info-text').textContent = `${dateStr} (${s.grade})`;
    document.getElementById('att-student-id').value = sid;
    document.getElementById('att-date').value = dateStr;
    document.getElementById('att-edit-date').value = dateStr; 
    const memoDiv = document.getElementById('att-memo');
    const savedRecord = (s.records && s.records[dateStr]) || "";
    memoDiv.innerHTML = savedRecord;
    // 선생님별 일정 데이터 사용
    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    const studentSchedule = teacherSchedule[sid] || {};
    const detail = (studentSchedule && studentSchedule[dateStr]) || { start: '16:00', duration: 90 };
    document.getElementById('att-edit-time').value = detail.start;
    document.getElementById('att-edit-duration').value = detail.duration;
}

window.updateClassTime = function() {
    const sid = document.getElementById('att-student-id').value;
    const oldDateStr = document.getElementById('att-date').value;
    const newDateStr = document.getElementById('att-edit-date').value;
    const newStart = document.getElementById('att-edit-time').value;
    const newDur = document.getElementById('att-edit-duration').value;
    if(!newDur || parseInt(newDur) <= 0) return alert("올바른 수업 시간을 입력해주세요.");
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        // 선생님별 일정 데이터 사용
        if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
        if(!teacherScheduleData[currentTeacherId][sid]) teacherScheduleData[currentTeacherId][sid] = {};
        
        if (oldDateStr !== newDateStr) {
            students[sIdx].events = students[sIdx].events.filter(d => d !== oldDateStr);
            if (!students[sIdx].events.includes(newDateStr)) students[sIdx].events.push(newDateStr);
            if (students[sIdx].attendance && students[sIdx].attendance[oldDateStr]) {
                if(!students[sIdx].attendance) students[sIdx].attendance = {};
                students[sIdx].attendance[newDateStr] = students[sIdx].attendance[oldDateStr]; delete students[sIdx].attendance[oldDateStr];
            }
            if (students[sIdx].records && students[sIdx].records[oldDateStr]) {
                if(!students[sIdx].records) students[sIdx].records = {};
                students[sIdx].records[newDateStr] = students[sIdx].records[oldDateStr]; delete students[sIdx].records[oldDateStr];
            }
            if (teacherScheduleData[currentTeacherId][sid][oldDateStr]) delete teacherScheduleData[currentTeacherId][sid][oldDateStr];
        }
        teacherScheduleData[currentTeacherId][sid][newDateStr] = { start: newStart, duration: parseInt(newDur) }; 
        saveData();
        saveTeacherScheduleData();
        renderCalendar(); 
        if (document.getElementById('day-detail-modal').style.display === 'flex') { if (currentDetailDate === newDateStr || currentDetailDate === oldDateStr) renderDayEvents(currentDetailDate); }
        alert("일정이 변경되었습니다."); closeModal('attendance-modal');
    }
}
window.setAttendance = function(status) {
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    const memoDiv = document.getElementById('att-memo');
    const memo = memoDiv.innerHTML;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        if(!students[sIdx].attendance) students[sIdx].attendance = {};
        if(!students[sIdx].records) students[sIdx].records = {};
        students[sIdx].attendance[dateStr] = status;
        students[sIdx].records[dateStr] = memo;
        saveData(); renderCalendar();
        if(document.getElementById('day-detail-modal').style.display === 'flex') renderDayEvents(dateStr);
    }
    closeModal('attendance-modal');
}
window.saveOnlyMemo = function() {
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    const memoDiv = document.getElementById('att-memo');
    const memo = memoDiv.innerHTML;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        if(!students[sIdx].records) students[sIdx].records = {};
        students[sIdx].records[dateStr] = memo;
        saveData(); alert("기록이 저장되었습니다.");
    }
}

window.applyMemoColor = function(color) {
    const selection = window.getSelection();
    if (!selection.toString()) return alert("글자를 선택해주세요.");
    
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.style.color = color;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
}
window.generateSchedule = function() {
    const sid = document.getElementById('sch-student-select').value;
    const days = Array.from(document.querySelectorAll('.day-check:checked')).map(c => parseInt(c.value));
    const startVal = document.getElementById('sch-start-date').value;
    const weeksVal = document.getElementById('sch-weeks').value;
    const startTime = document.getElementById('sch-time').value;
    const durationMin = document.getElementById('sch-duration-min').value;
    if (!sid || !startVal || !startTime || !durationMin) return alert("필수 정보를 모두 입력해주세요.");
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if (sIdx === -1) return alert("학생 정보를 찾을 수 없습니다.");
    
    // 선생님별 일정 데이터 초기화
    if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
    if(!teacherScheduleData[currentTeacherId][sid]) teacherScheduleData[currentTeacherId][sid] = {};
    
    // 이 학생을 현재 선생님에게 할당
    assignStudentToTeacher(sid);
    
    const startObj = new Date(startVal); const durInt = parseInt(durationMin); let count = 0;
    if (days.length === 0) {
        const off = startObj.getTimezoneOffset() * 60000;
        const dStr = new Date(startObj.getTime() - off).toISOString().split('T')[0];
        if (!teacherScheduleData[currentTeacherId][sid][dStr]) {
            teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
        } else {
            if(!confirm(`${dStr}에 이미 일정이 있습니다. 덮어씌우시겠습니까?`)) return;
            teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
        }
    } else {
        const startDayOfWeek = startObj.getDay(); 
        if (!days.includes(startDayOfWeek)) return alert("시작 날짜의 요일이 선택된 반복 요일에 포함되지 않습니다.");
        const weeks = parseInt(weeksVal);
        if (!weeks || weeks < 1) return alert("반복할 주(Week) 수를 1 이상 입력해주세요.");
        for (let i = 0; i < weeks * 7; i++) {
            const cur = new Date(startObj); cur.setDate(startObj.getDate() + i); 
            if (days.includes(cur.getDay())) {
                const off = cur.getTimezoneOffset() * 60000;
                const dStr = new Date(cur.getTime() - off).toISOString().split('T')[0];
                if (!teacherScheduleData[currentTeacherId][sid][dStr]) {
                    teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
                }
            }
        }
    }
    saveData();
    saveTeacherScheduleData();
    saveLayouts();
    closeModal('schedule-modal');
    renderCalendar();
    alert(count === 0 ? "새로 등록된 일정이 없습니다." : `${count}개의 일정이 생성되었습니다.`);
}
window.generateScheduleWithoutHolidays = function() {
    const sid = document.getElementById('sch-student-select').value;
    const days = Array.from(document.querySelectorAll('.day-check:checked')).map(c => parseInt(c.value));
    const startVal = document.getElementById('sch-start-date').value;
    const weeksVal = document.getElementById('sch-weeks').value;
    const startTime = document.getElementById('sch-time').value;
    const durationMin = document.getElementById('sch-duration-min').value;
    if (!sid || !startVal || !startTime || !durationMin) return alert("필수 정보를 모두 입력해주세요.");
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if (sIdx === -1) return alert("학생 정보를 찾을 수 없습니다.");
    
    // 선생님별 일정 데이터 초기화
    if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
    if(!teacherScheduleData[currentTeacherId][sid]) teacherScheduleData[currentTeacherId][sid] = {};
    
    // 이 학생을 현재 선생님에게 할당
    assignStudentToTeacher(sid);
    
    const startObj = new Date(startVal); const durInt = parseInt(durationMin); let count = 0;
    
    if (days.length === 0) {
        const off = startObj.getTimezoneOffset() * 60000;
        const dStr = new Date(startObj.getTime() - off).toISOString().split('T')[0];
        const holidayInfo = getHolidayInfo(dStr);
        if (!holidayInfo && !teacherScheduleData[currentTeacherId][sid][dStr]) {
            teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
        } else if (holidayInfo) {
            if(!confirm(`${dStr}은 ${holidayInfo.name}입니다. 계속 진행하시겠습니까?`)) return;
            if(!teacherScheduleData[currentTeacherId][sid][dStr]) {
                teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
            } else {
                teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
            }
        }
    } else {
        const startDayOfWeek = startObj.getDay(); 
        if (!days.includes(startDayOfWeek)) return alert("시작 날짜의 요일이 선택된 반복 요일에 포함되지 않습니다.");
        const weeks = parseInt(weeksVal);
        if (!weeks || weeks < 1) return alert("반복할 주(Week) 수를 1 이상 입력해주세요.");
        for (let i = 0; i < weeks * 7; i++) {
            const cur = new Date(startObj); cur.setDate(startObj.getDate() + i); 
            if (days.includes(cur.getDay())) {
                const off = cur.getTimezoneOffset() * 60000;
                const dStr = new Date(cur.getTime() - off).toISOString().split('T')[0];
                const holidayInfo = getHolidayInfo(dStr);
                if (!holidayInfo && !teacherScheduleData[currentTeacherId][sid][dStr]) {
                    teacherScheduleData[currentTeacherId][sid][dStr] = { start: startTime, duration: durInt }; count++;
                }
            }
        }
    }
    saveData();
    saveTeacherScheduleData();
    saveLayouts();
    closeModal('schedule-modal');
    renderCalendar();
    alert(count === 0 ? "새로 등록된 일정이 없습니다. (공휴일이 제외되었을 수 있습니다)" : `${count}개의 일정이 생성되었습니다.`);
}
window.prepareBulkDelete = function() {
    const sid = document.getElementById('edit-id').value;
    if(!sid) return;
    document.getElementById('bulk-del-sid').value = sid;
    const today = new Date(); const off = today.getTimezoneOffset() * 60000;
    const todayStr = new Date(today.getTime() - off).toISOString().split('T')[0];
    document.getElementById('bulk-del-start').value = todayStr;
    document.getElementById('bulk-del-end').value = ""; 
    closeModal('register-modal'); openModal('bulk-delete-modal');
}
window.executeBulkDelete = function() {
    const sid = document.getElementById('bulk-del-sid').value;
    const startStr = document.getElementById('bulk-del-start').value;
    const endStr = document.getElementById('bulk-del-end').value;
    if(!startStr || !endStr) return alert("기간을 모두 선택해주세요.");
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx === -1) return;
    if(!confirm("선택한 기간의 일정을 삭제하시겠습니까?")) return;
    const startDate = new Date(startStr); const endDate = new Date(endStr);
    
    // 현재 선생님의 schedule 데이터에서만 삭제
    if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
        const deleteDates = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dStr => {
            const d = new Date(dStr);
            return d >= startDate && d <= endDate;
        });
        deleteDates.forEach(dStr => delete teacherScheduleData[currentTeacherId][sid][dStr]);
    }
    
    saveData(); 
    saveTeacherScheduleData();
    closeModal('bulk-delete-modal'); 
    renderCalendar();
    alert(`일정이 삭제되었습니다.`);
}
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e) {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    const sid = e.dataTransfer.getData('studentId');
    const oldD = e.dataTransfer.getData('oldDate');
    const newD = e.currentTarget.dataset.date;
    if (!sid || !oldD || !newD || oldD === newD) return;
    const idx = students.findIndex(s => String(s.id) === String(sid));
    if (idx > -1) {
        if(students[idx].attendance && students[idx].attendance[oldD]) { students[idx].attendance[newD] = students[idx].attendance[oldD]; delete students[idx].attendance[oldD]; }
        if(students[idx].records && students[idx].records[oldD]) { students[idx].records[newD] = students[idx].records[oldD]; delete students[idx].records[oldD]; }
        // 선생님별 일정 데이터 이동 (현재 선생님의 데이터만 이동)
        if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            if(teacherScheduleData[currentTeacherId][sid][oldD]) {
                teacherScheduleData[currentTeacherId][sid][newD] = teacherScheduleData[currentTeacherId][sid][oldD];
                delete teacherScheduleData[currentTeacherId][sid][oldD];
            }
        }
        saveData();
        saveTeacherScheduleData();
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') closeModal('day-detail-modal');
    }
}
window.deleteSingleSchedule = function() {
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    if(!confirm("이 날짜의 일정을 삭제하시겠습니까?")) return;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        if(students[sIdx].attendance) delete students[sIdx].attendance[dateStr]; 
        if(students[sIdx].records) delete students[sIdx].records[dateStr];
        // 현재 선생님의 일정 데이터 삭제
        if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            delete teacherScheduleData[currentTeacherId][sid][dateStr];
        }
        saveData();
        saveTeacherScheduleData();
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') renderDayEvents(dateStr);
    }
    closeModal('attendance-modal');
}

// 기간별 일정 삭제 - 학생 선택 토글
window.togglePeriodDeleteStudent = function() {
    const scope = document.getElementById('period-del-scope').value;
    const studentGroup = document.getElementById('period-del-student-group');
    if (scope === 'student') {
        studentGroup.style.display = 'block';
        // 전체 활성 학생 표시
        const studentSelect = document.getElementById('period-del-student');
        const activeStudents = students.filter(s => s.status === 'active');
        studentSelect.innerHTML = '<option value="">학생을 선택하세요</option>' +
            activeStudents.map(s => `<option value="${s.id}">${s.name} (${s.grade})</option>`).join('');
    } else {
        studentGroup.style.display = 'none';
    }
}

// 기간별 일정 삭제 실행
window.executePeriodDelete = function() {
    const scope = document.getElementById('period-del-scope').value;
    const startDate = document.getElementById('period-del-start').value;
    const endDate = document.getElementById('period-del-end').value;
    
    if (!startDate || !endDate) {
        alert('삭제 기간을 입력해주세요.');
        return;
    }
    
    if (startDate > endDate) {
        alert('시작 날짜가 종료 날짜보다 늦습니다.');
        return;
    }
    
    let targetStudents = [];
    
    if (scope === 'all') {
        if (!confirm(`${startDate} ~ ${endDate} 기간의 모든 학생 일정을 삭제하시겠습니까?\n(출석체크가 안된 일정만 삭제됩니다)`)) return;
        targetStudents = students.filter(s => s.status === 'active');
    } else {
        const studentId = document.getElementById('period-del-student').value;
        if (!studentId) {
            alert('학생을 선택해주세요.');
            return;
        }
        const student = students.find(s => String(s.id) === String(studentId));
        if (!student) return;
        
        if (!confirm(`${student.name} 학생의 ${startDate} ~ ${endDate} 기간 일정을 삭제하시겠습니까?\n(출석체크가 안된 일정만 삭제됩니다)`)) return;
        targetStudents = [student];
    }
    
    let deletedCount = 0;
    
    targetStudents.forEach(student => {
        const sid = student.id;
        const sIdx = students.findIndex(s => String(s.id) === String(sid));
        if (sIdx === -1) return;
        
        // 현재 선생님의 일정 데이터에서 기간 내 이벤트 필터링
        if (teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            const eventsToDelete = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dateStr => {
                if (dateStr < startDate || dateStr > endDate) return false;
                // 출석 체크가 없는 일정만 삭제
                const hasAttendance = student.attendance && student.attendance[dateStr];
                return !hasAttendance;
            });
            
            if (eventsToDelete.length > 0) {
                // 선생님별 일정 데이터에서 제거
                eventsToDelete.forEach(dateStr => {
                    delete teacherScheduleData[currentTeacherId][sid][dateStr];
                });
                deletedCount += eventsToDelete.length;
            }
        }
    });
    
    if (deletedCount > 0) {
        saveData();
        saveTeacherScheduleData();
        renderCalendar();
        alert(`총 ${deletedCount}개의 일정이 삭제되었습니다.`);
    } else {
        alert('삭제할 일정이 없습니다.');
    }
    
    closeModal('period-delete-modal');
}

window.openHistoryModal = function() {
    const sid = document.getElementById('att-student-id').value;
    const s = students.find(x => String(x.id) === String(sid));
    if(!s) return;
    const curYear = currentDate.getFullYear();
    const curMonth = currentDate.getMonth() + 1;
    document.getElementById('history-modal').style.display = 'flex';
    document.getElementById('hist-title').textContent = `${s.name} 학생`;
    document.getElementById('hist-subtitle').textContent = `${curYear}년 ${curMonth}월 학습 기록`;
    const container = document.getElementById('history-timeline');
    container.innerHTML = "";
    const monthPrefix = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    
    // 현재 선생님의 schedule 데이터에서만 확인
    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    const studentSchedule = teacherSchedule[sid] || {};
    const scheduleDates = Object.keys(studentSchedule);
    
    const allDates = new Set([...scheduleDates]);
    if(s.attendance) Object.keys(s.attendance).forEach(d => allDates.add(d));
    if(s.records) Object.keys(s.records).forEach(d => allDates.add(d));
    const monthlyEvents = Array.from(allDates).filter(date => date.startsWith(monthPrefix)).sort();
    if (monthlyEvents.length === 0) { container.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">이번 달 수업/기록이 없습니다.</div>'; return; }
    monthlyEvents.forEach(date => {
        const status = (s.attendance && s.attendance[date]) || 'none';
        const record = (s.records && s.records[date]) || "";
        const isScheduled = studentSchedule && studentSchedule[date];
        let statusText = "미처리", statusClass = "bg-none", dotClass = "t-dot-none";
        if(status === 'present') { statusText = '출석'; statusClass = 'bg-present'; dotClass = 't-dot-present'; }
        else if(status === 'absent') { statusText = '결석'; statusClass = 'bg-absent'; dotClass = 't-dot-absent'; }
        else if(status === 'etc') { statusText = '기타'; statusClass = 'bg-etc'; dotClass = 't-dot-etc'; }
        else if (!isScheduled && record) { statusText = "기록만 존재"; statusClass = "bg-none"; } 
        const dayNum = date.split('-')[2];
        const contentHtml = record ? record.replace(/\n/g, '<br>') : '<span style="color:#aaa; font-size:12px;">(기록 없음)</span>';
        container.innerHTML += `<div class="timeline-item"><div class="timeline-dot ${dotClass}"></div><div class="timeline-date">${dayNum}일 <span class="status-badge ${statusClass}">${statusText}</span>${!isScheduled ? '<span style="font-size:10px; color:var(--red); margin-left:4px;">(일정삭제됨)</span>' : ''}</div><div class="timeline-content">${contentHtml}</div></div>`;
    });
}
window.openDaySettings = function(dateStr) {
    document.getElementById('day-settings-modal').style.display = 'flex';
    document.getElementById('day-settings-title').textContent = `${dateStr} 설정`;
    document.getElementById('setting-date-str').value = dateStr;
    const info = getHolidayInfo(dateStr);
    document.getElementById('is-red-day').checked = !!info;
    document.getElementById('day-name').value = (info && info.name) || "";
    setHolidayColor((info && info.color) || '#ef4444');
    
    // 모달이 열릴 때마다 색상 칩 이벤트 다시 설정
    setTimeout(() => setupHolidayColorChips(), 0);
}
window.saveDaySettings = function() {
    const dateStr = document.getElementById('setting-date-str').value;
    const isRed = document.getElementById('is-red-day').checked;
    const name = document.getElementById('day-name').value;
    const color = document.getElementById('holiday-color') ? document.getElementById('holiday-color').value : '#ef4444';
    if (isRed) {
        if (!name.trim()) return alert("공휴일 이름을 입력해주세요.");
        customHolidays[dateStr] = { name, color };
    } else { delete customHolidays[dateStr]; }
    // 공휴일: 선생님별로 분리 저장 (반드시 currentTeacherId 사용)
    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));
    console.log(`공휴일 저장 (${currentTeacherId}): ${dateStr}`);
    closeModal('day-settings-modal'); renderCalendar();
}
function loadAndCleanData() {
    try {
        // 현재 로그인 사용자(관리자) 기준으로 학생 데이터 로드
        // 형식: academy_students__[owner_user_id]
        const ownerKey = `academy_students__${localStorage.getItem('current_owner_id') || 'no-owner'}`;
        const raw = localStorage.getItem(ownerKey);
        let allStudents = [];
        
        if (raw) {
            try {
                allStudents = JSON.parse(raw) || [];
            } catch (e) {
                console.error('학생 데이터 파싱 실패:', e);
                allStudents = [];
            }
        }
        
        if (!Array.isArray(allStudents)) allStudents = [];
        students = allStudents.map(s => {
            if (!s.status) s.status = s.archived ? 'archived' : 'active';
            if (!s.payments) s.payments = {};
            if (!s.defaultFee) s.defaultFee = 0;
            if (!s.specialLectureFee) s.specialLectureFee = 0;
            if (!s.defaultTextbookFee) s.defaultTextbookFee = 0;
            // scheduleDetails는 더 이상 여기서 사용하지 않음
            return s;
        });
        console.log(`로드된 학생 수 (${localStorage.getItem('current_owner_id')}): ${students.length}명`);
    } catch (e) { 
        console.error('학생 데이터 로드 실패:', e);
        students = []; 
    }
    try {
        // 공휴일: 선생님별로 분리 (반드시 currentTeacherId 사용)
        const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
        const hol = localStorage.getItem(holKey);
        customHolidays = hol ? JSON.parse(hol) : {};
        console.log(`공휴일 로드 (${currentTeacherId}): ${Object.keys(customHolidays).length}개`);
    } catch (e) { 
        console.error('공휴일 로드 실패:', e);
        customHolidays = {}; 
    }
    try {
        // 일일 레이아웃: 선생님별로 분리 (반드시 currentTeacherId 사용)
        const layoutKey = `academy_daily_layouts__${currentTeacherId || 'no-teacher'}`;
        const layouts = localStorage.getItem(layoutKey);
        dailyLayouts = layouts ? JSON.parse(layouts) : {};
        console.log(`일일 레이아웃 로드 (${currentTeacherId}): ${Object.keys(dailyLayouts).length}개`);
    } catch (e) { 
        console.error('레이아웃 로드 실패:', e);
        dailyLayouts = {}; 
    }
}

// 선생님별 일정 데이터 로드
function loadTeacherScheduleData(teacherId) {
    try {
        const key = `teacher_schedule_data__${teacherId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            teacherScheduleData[teacherId] = JSON.parse(raw) || {};
        } else {
            teacherScheduleData[teacherId] = {};
        }
        console.log(`선생님 ${teacherId} 일정 데이터 로드 완료: ${Object.keys(teacherScheduleData[teacherId] || {}).length}명`);
    } catch (e) {
        console.error('선생님 일정 데이터 로드 실패:', e);
        teacherScheduleData[teacherId] = {};
    }
}

// 선생님별 일정 데이터 저장
function saveTeacherScheduleData() {
    try {
        if (!currentTeacherId) return;
        const key = `teacher_schedule_data__${currentTeacherId}`;
        localStorage.setItem(key, JSON.stringify(teacherScheduleData[currentTeacherId] || {}));
        console.log(`선생님 ${currentTeacherId} 일정 데이터 저장 완료`);
    } catch (e) {
        console.error('선생님 일정 데이터 저장 실패:', e);
    }
}
function saveData() { 
    // 현재 로그인 사용자(관리자) 기준으로 저장
    const ownerKey = `academy_students__${localStorage.getItem('current_owner_id') || 'no-owner'}`;
    localStorage.setItem(ownerKey, JSON.stringify(students)); 
    console.log(`학생 데이터 저장 (${localStorage.getItem('current_owner_id')}): ${students.length}명`);
}

// 현재 선생님에게 학생 할당
function assignStudentToTeacher(studentId) {
    if (!currentTeacherId) {
        console.warn('currentTeacherId가 설정되지 않음');
        return;
    }
    // 반드시 currentTeacherId를 사용 (getStorageKey 함수 사용 금지)
    const key = `teacher_students_mapping__${currentTeacherId}`;
    let studentIds = [];
    try {
        const saved = localStorage.getItem(key);
        if (saved) studentIds = JSON.parse(saved) || [];
    } catch (e) {
        console.error('매핑 로드 실패:', e);
    }
    
    if (!studentIds.includes(studentId)) {
        studentIds.push(studentId);
        localStorage.setItem(key, JSON.stringify(studentIds));
        console.log(`학생 ${studentId}를 선생님 ${currentTeacherId}에 할당`);
    }
    
    // 메모리에도 반영
    if (!currentTeacherStudents.find(s => s.id === studentId)) {
        const student = students.find(s => s.id === studentId);
        if (student) {
            currentTeacherStudents.push(student);
            console.log(`메모리에 학생 추가: ${student.name}`);
        }
    }
}

// 현재 선생님에게서 학생 제거
function unassignStudentFromTeacher(studentId) {
    if (!currentTeacherId) {
        console.warn('currentTeacherId가 설정되지 않음');
        return;
    }
    // 반드시 currentTeacherId를 사용 (getStorageKey 함수 사용 금지)
    const key = `teacher_students_mapping__${currentTeacherId}`;
    let studentIds = [];
    try {
        const saved = localStorage.getItem(key);
        if (saved) studentIds = JSON.parse(saved) || [];
    } catch (e) {
        console.error('매핑 로드 실패:', e);
    }
    
    studentIds = studentIds.filter(id => id !== studentId);
    localStorage.setItem(key, JSON.stringify(studentIds));
    console.log(`학생 ${studentId}를 선생님 ${currentTeacherId}에서 제거`);
    
    // 메모리에도 반영
    currentTeacherStudents = currentTeacherStudents.filter(s => s.id !== studentId);
}
window.goToday = function() { currentDate = new Date(); document.getElementById('jump-date-picker').value = ''; renderCalendar(); }
window.moveDate = function(d) {
    if(currentView === 'month') currentDate.setMonth(currentDate.getMonth() + d);
    else currentDate.setDate(currentDate.getDate() + (d * 7));
    renderCalendar();
}
window.switchView = function(v) {
    currentView = v;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${v}`).classList.add('active');
    renderCalendar();
}
window.toggleStudentList = function() {
    const d = document.getElementById('student-drawer');
    const o = document.getElementById('drawer-overlay');
    const open = d.classList.toggle('open');
    o.style.display = open ? 'block' : 'none';
    if(open) {
        renderDrawerList();
        // 검색 입력 이벤트 리스너 추가
        const searchInput = document.getElementById('drawer-search-input');
        searchInput.oninput = function() {
            renderDrawerList();
        };
        searchInput.focus();
    }
}
window.renderDrawerList = function() {
    const showInactiveOnly = document.getElementById('show-archived').checked;
    const searchQuery = document.getElementById('drawer-search-input').value.toLowerCase();
    
    // 전체 학생 목록 표시 (모든 선생님의 학생)
    let filtered = students.filter(s => {
        if (showInactiveOnly) return s.status === 'archived' || s.status === 'paused';
        else return s.status === 'active';
    });
    
    // 검색어 필터링
    if(searchQuery) {
        filtered = filtered.filter(s => 
            s.name.toLowerCase().includes(searchQuery) || 
            s.grade.toLowerCase().includes(searchQuery)
        );
    }
    
    document.getElementById('drawer-content').innerHTML = filtered.map(s => {
        let itemClass = '';
        if (s.status === 'archived' || s.status === 'paused') itemClass = 'inactive-item';
        return `<div class="student-item ${itemClass}">
            <div class="student-info" onclick="prepareEdit('${s.id}')">
                <b>${s.name} <span>${s.grade}</span></b>
                <span>${s.studentPhone || '-'}</span>
                <span style="font-size:11px; color:#aaa;">등록: ${s.registerDate || '-'}</span>
            </div>
            <select class="status-select ${s.status}" onchange="updateStudentStatus('${s.id}', this.value)">
                <option value="active" ${s.status === 'active' ? 'selected' : ''}>재원</option>
                <option value="archived" ${s.status === 'archived' ? 'selected' : ''}>퇴원</option>
                <option value="paused" ${s.status === 'paused' ? 'selected' : ''}>휴원</option>
                <option value="delete">삭제</option>
            </select>
        </div>`
    }).join('');
    document.getElementById('student-list-count').textContent = `${filtered.length}명`;
}
window.updateStudentStatus = function(id, newStatus) {
    const idx = students.findIndex(s => String(s.id) === String(id));
    if (idx === -1) return;
    if (newStatus === 'delete') {
        if (confirm(`정말로 ${students[idx].name} 학생의 모든 데이터를 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다.)`)) {
            unassignStudentFromTeacher(id);  // 모든 선생님에게서 제거
            students.splice(idx, 1); 
            saveData(); 
            renderDrawerList(); 
            renderCalendar(); 
            alert("삭제되었습니다.");
        } else { renderDrawerList(); }
        return;
    }
    students[idx].status = newStatus; 
    saveData(); 
    renderDrawerList(); 
    renderCalendar();
}
window.openModal = function(id) {
    document.getElementById(id).style.display = 'flex';
    if(id === 'schedule-modal') {
        const searchInput = document.getElementById('sch-student-search');
        const dropdown = document.getElementById('sch-student-dropdown');
        const hiddenSelect = document.getElementById('sch-student-select');
        
        // 전체 활성 학생 표시 (모든 선생님이 등록 가능)
        const activeStudents = students.filter(s => s.status === 'active');
        
        // 검색 입력 초기화
        searchInput.value = '';
        hiddenSelect.value = '';
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        
        // 검색 이벤트 리스너
        searchInput.oninput = function() {
            const query = this.value.trim();
            if(query === '') {
                dropdown.classList.remove('active');
                dropdown.innerHTML = '';
                return;
            }
            
            const queryLower = query.toLowerCase();
            const filtered = activeStudents.filter(s => 
                s.name.toLowerCase().includes(queryLower) || 
                s.grade.toLowerCase().includes(queryLower)
            );
            renderStudentDropdown(filtered, query);
        };
        
        document.getElementById('sch-start-date').valueAsDate = new Date();
        document.querySelectorAll('.day-check').forEach(c => c.checked = false);
    }
}

window.renderStudentDropdown = function(studentList, query) {
    const dropdown = document.getElementById('sch-student-dropdown');
    if(studentList.length === 0) {
        dropdown.innerHTML = '<div class="search-option" style="color: var(--gray); cursor: default;">검색 결과가 없습니다.</div>';
        dropdown.classList.add('active');
        return;
    }
    
    dropdown.innerHTML = studentList.map(s => 
        `<div class="search-option" onclick="selectStudent('${s.id}', '${s.name}', '${s.grade}')">
            <span class="search-option-label">${s.name}</span>
            <span class="search-option-grade">${s.grade}</span>
        </div>`
    ).join('');
    
    dropdown.classList.add('active');
}

window.selectStudent = function(id, name, grade) {
    document.getElementById('sch-student-select').value = id;
    document.getElementById('sch-student-search').value = name + ' (' + grade + ')';
    document.getElementById('sch-student-dropdown').classList.remove('active');
}

window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; }
window.prepareRegister = function() {
    document.getElementById('reg-title').textContent = "학생 등록";
    ['edit-id', 'reg-name', 'reg-student-phone', 'reg-parent-phone', 'reg-memo', 'reg-default-fee', 'reg-special-fee'].forEach(id => document.getElementById(id).value = "");
    const today = new Date(); const off = today.getTimezoneOffset() * 60000;
    document.getElementById('reg-register-date').value = new Date(today.getTime() - off).toISOString().split('T')[0];
    document.getElementById('edit-mode-actions').style.display = 'none'; openModal('register-modal');
}
window.prepareEdit = function(id) {
    const s = students.find(x => String(x.id) === String(id));
    if(!s) return;
    document.getElementById('reg-title').textContent = "학생 정보 수정";
    document.getElementById('edit-id').value = s.id;
    document.getElementById('reg-name').value = s.name;
    document.getElementById('reg-grade').value = s.grade;
    document.getElementById('reg-student-phone').value = s.studentPhone || "";
    document.getElementById('reg-parent-phone').value = s.parentPhone || "";
    document.getElementById('reg-default-fee').value = s.defaultFee || "";
    document.getElementById('reg-special-fee').value = s.specialLectureFee || "";
    document.getElementById('reg-default-textbook-fee').value = s.defaultTextbookFee || "";
    document.getElementById('reg-memo').value = s.memo || "";
    document.getElementById('reg-register-date').value = s.registerDate || "";
    document.getElementById('edit-mode-actions').style.display = 'block'; openModal('register-modal');
}
window.handleStudentSave = function() {
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('reg-name').value;
    const grade = document.getElementById('reg-grade').value;
    const sPhone = document.getElementById('reg-student-phone').value;
    const pPhone = document.getElementById('reg-parent-phone').value;
    const defaultFee = document.getElementById('reg-default-fee').value;
    const specialLectureFee = document.getElementById('reg-special-fee').value;
    const defaultTextbookFee = document.getElementById('reg-default-textbook-fee').value;
    const memo = document.getElementById('reg-memo').value;
    const regDate = document.getElementById('reg-register-date').value;
    if (!name.trim()) return alert("이름을 입력해주세요.");
    const newData = { name, grade, studentPhone: sPhone, parentPhone: pPhone, defaultFee: defaultFee ? parseInt(defaultFee) : 0, specialLectureFee: specialLectureFee ? parseInt(specialLectureFee) : 0, defaultTextbookFee: defaultTextbookFee ? parseInt(defaultTextbookFee) : 0, memo, registerDate: regDate };
    if (id) { 
        const idx = students.findIndex(s => String(s.id) === String(id)); 
        if (idx > -1) students[idx] = { ...students[idx], ...newData }; 
    } else { 
        const newStudentId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        students.push({ id: newStudentId, ...newData, status: 'active', events: [], attendance: {}, records: {}, payments: {} }); 
        // 현재 선생님에게 학생 할당
        assignStudentToTeacher(newStudentId);
        // 선생님별 일정 데이터 초기화
        if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
        teacherScheduleData[currentTeacherId][newStudentId] = {};
    }
    saveData();
    saveTeacherScheduleData();
    closeModal('register-modal');
    renderDrawerList();
    renderCalendar();
}

// ============================================
// [수정됨] 수납 관리 기능 로직 (Master-Detail UI, 성능 개선)
// ============================================

window.openPaymentModal = function() {
    // 관리자 역할 확인
    const currentTeacherName = localStorage.getItem('current_teacher_name');
    const role = localStorage.getItem('teacher_' + currentTeacherName + '_role') || 'teacher';
    
    if (role !== 'admin') {
        alert('수납 관리는 관리자만 접근할 수 있습니다.');
        return;
    }
    
    openModal('payment-modal');
    currentPaymentDate = new Date(); 
    setPaymentFilter('all');
}

window.movePaymentMonth = function(offset) {
    currentPaymentDate.setMonth(currentPaymentDate.getMonth() + offset);
    renderPaymentList();
}

window.renderPaymentList = function() {
    const container = document.getElementById('payment-list-container');
    const title = document.getElementById('payment-month-title');
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    
    title.textContent = `${year}년 ${month}월`;

    const activeStudents = students.filter(s => s.status === 'active');
    if (activeStudents.length === 0) {
        container.innerHTML = '<div class="empty-list-placeholder">등록된 재원생이 없습니다.</div>';
        updateSummary(monthKey, activeStudents);
        return;
    }

    // 1. 데이터 준비
    let paymentData = activeStudents.map(s => {
        const studentMonthData = s.payments?.[monthKey] || {};

        const tuition = {
            amount: studentMonthData.tuition?.amount ?? s.defaultFee ?? 0,
            date: studentMonthData.tuition?.date || '',
        };
        const textbook = {
            amount: studentMonthData.textbook?.amount ?? s.defaultTextbookFee ?? 0,
            date: studentMonthData.textbook?.date || '',
        };
        const special = {
            amount: studentMonthData.special?.amount ?? s.specialLectureFee ?? 0,
            date: studentMonthData.special?.date || '',
        };

        const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
        const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + 
                          (textbook.date ? (textbook.amount || 0) : 0) + 
                          (special.date ? (special.amount || 0) : 0);

        let status;
        if (totalDue === 0) status = 'no_charge';
        else if (totalPaid >= totalDue) status = 'paid';
        else if (totalPaid > 0) status = 'partial';
        else status = 'unpaid';

        return {
            student: s,
            monthKey: monthKey,
            fees: { tuition, textbook, special },
            summary: { totalDue, totalPaid, status }
        };
    });

    // 2. 필터링
    const filteredData = paymentData.filter(item => {
        if (currentPaymentFilter === 'all') return true;
        if (currentPaymentFilter === 'unpaid') return item.summary.status === 'unpaid' || item.summary.status === 'partial';
        return item.fees[currentPaymentFilter]?.amount > 0;
    });

    // 3. 정렬 (미납 > 일부납 > 완납 > 청구없음 순, 그 다음 이름순)
    const statusOrder = { 'unpaid': 0, 'partial': 1, 'paid': 2, 'no_charge': 3 };
    filteredData.sort((a, b) => {
        const orderA = statusOrder[a.summary.status] ?? 999;
        const orderB = statusOrder[b.summary.status] ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.student.name.localeCompare(b.student.name);
    });

    // 4. 렌더링
    container.innerHTML = filteredData.map(item => getPaymentRowHtml(item)).join('');
    
    // 5. 요약 업데이트
    updateSummary(monthKey, paymentData);
}

function updateSummary(monthKey, allPaymentData) {
    const activeStudents = students.filter(s => s.status === 'active');
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const mKey = monthKey || `${year}-${String(month).padStart(2, '0')}`;

    let totalCollected = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    if (currentPaymentFilter === 'all') {
        // 전체 필터: 전체 수납금과 최종 상태 기준
        allPaymentData.forEach(item => {
            totalCollected += item.summary.totalPaid;
            if (item.summary.status === 'paid') {
                paidCount++;
            } else if (item.summary.status === 'unpaid' || item.summary.status === 'partial') {
                unpaidCount++;
            }
        });
    } else if (currentPaymentFilter === 'unpaid') {
        // 미납 필터: 전체 기준
        allPaymentData.forEach(item => {
            totalCollected += item.summary.totalPaid;
            if (item.summary.status === 'paid') {
                paidCount++;
            } else if (item.summary.status === 'unpaid' || item.summary.status === 'partial') {
                unpaidCount++;
            }
        });
    } else {
        // 특정 항목(수강료, 교재비, 특강비) 필터: 해당 항목만 기준
        const feeType = currentPaymentFilter;
        activeStudents.forEach(s => {
            const studentMonthData = s.payments?.[mKey] || {};
            const fee = studentMonthData[feeType] || {};
            const amount = fee.amount ?? (feeType === 'tuition' ? s.defaultFee : feeType === 'textbook' ? s.defaultTextbookFee : s.specialLectureFee) ?? 0;
            
            if (amount > 0) {
                if (fee.date) {
                    totalCollected += amount;
                    paidCount++;
                } else {
                    unpaidCount++;
                }
            }
        });
    }

    document.getElementById('total-collected').textContent = totalCollected.toLocaleString() + '원';
    document.getElementById('count-paid').textContent = `${paidCount}명`;
    document.getElementById('count-unpaid').textContent = `${unpaidCount}명`;
}

function getPaymentRowHtml(item) {
    const { student, summary } = item;
    const { totalDue, totalPaid, status } = summary;

    let statusText, statusClass, statusBgColor;
    switch (status) {
        case 'paid': statusText = '완납'; statusClass = 'paid'; statusBgColor = 'bg-present'; break;
        case 'unpaid': statusText = '미납'; statusClass = 'unpaid'; statusBgColor = 'bg-absent'; break;
        case 'partial': statusText = '일부납'; statusClass = 'partial'; statusBgColor = 'bg-etc'; break;
        default: statusText = '청구없음'; statusClass = 'no_charge'; statusBgColor = 'bg-none'; break;
    }

    return `
        <div class="p-row" id="payment-row-${student.id}">
            <div class="p-summary-row" onclick="togglePaymentDetail('${student.id}')">
                <div class="p-cell-student">
                    <span class="p-name">${student.name}</span>
                    <span class="p-grade">${student.grade}</span>
                </div>
                <div class="p-cell">${(totalDue || 0).toLocaleString()}원</div>
                <div class="p-cell">${(totalPaid || 0).toLocaleString()}원</div>
                <div class="p-cell p-cell-status">
                    <span class="status-badge ${statusBgColor}">${statusText}</span>
                </div>
                <div class="p-cell p-cell-action">
                    <i class="fas fa-chevron-down"></i>
                </div>
            </div>
            <div class="p-details-row hidden">
                ${getDetailHtml(item)}
            </div>
        </div>
    `;
}

function getDetailHtml(item) {
    const { student, monthKey, fees } = item;
    const createDetailPart = (type, title) => {
        const fee = fees[type];
        return `
            <div class="p-detail-item">
                <div class="d-title">${title}</div>
                <div class="d-input-group">
                    <input type="text" class="money-input" id="amount-${type}-${student.id}"
                           value="${fee.amount ? fee.amount.toLocaleString() : ''}" placeholder="금액"
                           onchange="updatePayment('${student.id}', '${monthKey}', '${type}', 'amount', this.value)">
                    <input type="date" class="date-input ${fee.date ? 'has-value' : ''}" id="date-${type}-${student.id}"
                           value="${fee.date || ''}"
                           onchange="updatePayment('${student.id}', '${monthKey}', '${type}', 'date', this.value)">
                </div>
                <div class="d-action-row">
                    <button class="d-btn paid" onclick="quickPay('${student.id}', '${monthKey}', '${type}')">오늘 날짜로 완납</button>
                    <button class="d-btn unpaid" onclick="cancelPayment('${student.id}', '${monthKey}', '${type}')">납부 취소</button>
                </div>
            </div>
        `;
    };

    return `
        <div class="p-detail-grid">
            ${createDetailPart('tuition', '수강료')}
            ${createDetailPart('textbook', '교재비')}
            ${createDetailPart('special', '특강비')}
        </div>
    `;
}

window.togglePaymentDetail = function(sid) {
    const summaryRow = document.querySelector(`#payment-row-${sid} .p-summary-row`);
    const detailsRow = document.querySelector(`#payment-row-${sid} .p-details-row`);
    const chevronIcon = summaryRow.querySelector('.fa-chevron-down');

    summaryRow.classList.toggle('is-expanded');
    detailsRow.classList.toggle('hidden');
    if (chevronIcon) {
        chevronIcon.classList.toggle('rotate');
    }
}

window.quickPay = function(sid, monthKey, type) {
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if (sIdx === -1) return;
    
    const student = students[sIdx];
    if (!student.payments) student.payments = {};
    if (!student.payments[monthKey]) student.payments[monthKey] = {};
    if (!student.payments[monthKey][type]) student.payments[monthKey][type] = { amount: 0, date: '' };
    
    // 금액이 0이거나 없으면 기본 금액으로 설정
    const currentAmount = student.payments[monthKey][type].amount;
    if (!currentAmount || currentAmount === 0) {
        let defaultAmount = 0;
        if (type === 'tuition') defaultAmount = student.defaultFee || 0;
        else if (type === 'textbook') defaultAmount = student.defaultTextbookFee || 0;
        else if (type === 'special') defaultAmount = student.specialLectureFee || 0;
        
        if (defaultAmount > 0) {
            student.payments[monthKey][type].amount = defaultAmount;
        }
    }
    
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const dateStr = new Date(today.getTime() - offset).toISOString().split('T')[0];
    updatePayment(sid, monthKey, type, 'date', dateStr);
}

window.cancelPayment = function(sid, monthKey, type) {
    updatePayment(sid, monthKey, type, 'date', '');
}

window.updatePayment = function(sid, monthKey, type, field, value) {
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if (sIdx === -1) return;
    
    const student = students[sIdx];
    if (!student.payments) student.payments = {};
    if (!student.payments[monthKey]) student.payments[monthKey] = {};
    if (!student.payments[monthKey][type]) student.payments[monthKey][type] = { amount: 0, date: '' };

    let target = student.payments[monthKey][type];
    if (field === 'amount') {
        const num = parseInt(value.replace(/,/g, ''));
        target.amount = isNaN(num) ? 0 : num;
    } else if (field === 'date') {
        target.date = value;
    }

    saveData();
    
    // UI 부분 업데이트
    rerenderStudentRow(sid);
    updateSummaryForCurrentUserSet();
}

function rerenderStudentRow(sid) {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const student = students.find(s => String(s.id) === String(sid));
    
    if (!student) return;

    const studentMonthData = student.payments?.[monthKey] || {};
    const tuition = { amount: studentMonthData.tuition?.amount ?? student.defaultFee ?? 0, date: studentMonthData.tuition?.date || '' };
    const textbook = { amount: studentMonthData.textbook?.amount ?? student.defaultTextbookFee ?? 0, date: studentMonthData.textbook?.date || '' };
    const special = { amount: studentMonthData.special?.amount ?? student.specialLectureFee ?? 0, date: studentMonthData.special?.date || '' };

    const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
    const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);
    
    let status;
    if (totalDue === 0) status = 'no_charge';
    else if (totalPaid >= totalDue) status = 'paid';
    else if (totalPaid > 0) status = 'partial';
    else status = 'unpaid';

    const item = {
        student,
        monthKey,
        fees: { tuition, textbook, special },
        summary: { totalDue, totalPaid, status }
    };
    
    const rowElement = document.getElementById(`payment-row-${sid}`);
    if (rowElement) {
        const wasExpanded = rowElement.querySelector('.p-summary-row')?.classList.contains('is-expanded');
        rowElement.outerHTML = getPaymentRowHtml(item);
        if (wasExpanded) {
            const newSummaryRow = document.querySelector(`#payment-row-${sid} .p-summary-row`);
            const newDetailsRow = document.querySelector(`#payment-row-${sid} .p-details-row`);
            const newChevronIcon = newSummaryRow.querySelector('.fa-chevron-down');
            
            newSummaryRow.classList.add('is-expanded');
            newDetailsRow.classList.remove('hidden');
            if (newChevronIcon) {
                newChevronIcon.classList.add('rotate');
            }
        }
    }
}

function updateSummaryForCurrentUserSet() {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const activeStudents = students.filter(s => s.status === 'active');
    
    const paymentData = activeStudents.map(s => {
        const studentMonthData = s.payments?.[monthKey] || {};
        const tuition = { amount: studentMonthData.tuition?.amount ?? s.defaultFee ?? 0, date: studentMonthData.tuition?.date || '' };
        const textbook = { amount: studentMonthData.textbook?.amount ?? 0, date: studentMonthData.textbook?.date || '' };
        const special = { amount: studentMonthData.special?.amount ?? s.specialLectureFee ?? 0, date: studentMonthData.special?.date || '' };
        const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);
        const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
        
        let status;
        if (totalDue === 0) status = 'no_charge';
        else if (totalPaid >= totalDue) status = 'paid';
        else if (totalPaid > 0) status = 'partial';
        else status = 'unpaid';
        
        return { summary: { totalPaid, status } };
    });
    
    updateSummary(monthKey, paymentData);
}

// ============================================
// 권한 관련 함수
// ============================================

// 현재 사용자 역할 라벨 업데이트
function updateUserRoleLabel() {
    const role = localStorage.getItem('current_user_role') || 'teacher';
    const label = document.getElementById('current-user-role-label');
    if (label) {
        if (role === 'admin') {
            label.textContent = '관리자';
        } else if (role === 'teacher') {
            label.textContent = '선생님';
        } else if (role === 'staff') {
            label.textContent = '직원';
        }
    }
}

// 수납관리 메뉴 버튼 가시성 업데이트
function updatePaymentMenuVisibility() {
    const btn = document.getElementById('payment-menu-btn');
    if (btn) {
        // 현재 선택된 선생님의 역할 확인
        const currentTeacherName = localStorage.getItem('current_teacher_name');
        const role = localStorage.getItem('teacher_' + currentTeacherName + '_role') || 'teacher';
        
        // 관리자만 수납관리 버튼 표시
        btn.style.display = role === 'admin' ? 'flex' : 'none';
    }
}

// 선생님 관리 메뉴 버튼 가시성 업데이트
function updateTeacherMenuVisibility() {
    const btn = document.getElementById('teacher-menu-btn');
    if (btn) {
        // 현재 선택된 선생님의 역할 확인
        const currentTeacherName = localStorage.getItem('current_teacher_name');
        const role = localStorage.getItem('teacher_' + currentTeacherName + '_role') || 'teacher';
        
        // 관리자만 선생님 관리 버튼 표시
        btn.style.display = role === 'admin' ? 'flex' : 'none';
    }
}

// ============================================
// 선생님 관리 모달 함수
// ============================================

window.openTeacherModal = function() {
    // 관리자만 선생님 관리 가능
    const currentTeacherName = localStorage.getItem('current_teacher_name');
    const role = localStorage.getItem('teacher_' + currentTeacherName + '_role') || 'teacher';
    
    if (role !== 'admin') {
        alert('관리자만 선생님을 관리할 수 있습니다.');
        return;
    }
    
    const modal = document.getElementById('teacher-modal');
    if (!modal) {
        console.error('teacher-modal 요소를 찾을 수 없습니다');
        return;
    }
    modal.style.display = 'flex';
    renderTeacherListModal();
}

window.renderTeacherListModal = function() {
    const container = document.getElementById('teacher-list-container');
    if (!container || !teacherList || teacherList.length === 0) {
        if (container) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--gray);">등록된 선생님이 없습니다.</div>';
        }
        return;
    }
    
    container.innerHTML = teacherList.map(teacher => {
        // 로컬스토리지에서 role 확인
        const storedRole = localStorage.getItem('teacher_' + teacher.name + '_role');
        const role = storedRole || teacher.role || 'teacher';
        const roleText = role === 'admin' ? '관리자' : role === 'teacher' ? '선생님' : '직원';
        const roleColor = role === 'admin' ? '#ef4444' : role === 'teacher' ? '#3b82f6' : '#8b5cf6';
        
        return `
        <div style="background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 14px;">${teacher.name}</div>
                <div style="font-size: 12px; color: var(--gray);">${teacher.phone || '연락처 없음'}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <select id="role-${teacher.id}" class="m-input" style="width: 100px; padding: 6px 8px; font-size: 12px;" onchange="handleRoleChange('${teacher.id}', this.value)">
                    <option value="teacher" ${role === 'teacher' ? 'selected' : ''}>선생님</option>
                    <option value="staff" ${role === 'staff' ? 'selected' : ''}>직원</option>
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>관리자</option>
                </select>
                <button onclick="deleteTeacherFromModal('${teacher.id}')" style="padding: 6px 12px; background: var(--red); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">삭제</button>
            </div>
        </div>
        `;
    }).join('');
}

window.selectTeacherFromModal = async function(teacherId, teacherName) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return alert('선생님 정보를 찾을 수 없습니다.');
    
    await setCurrentTeacher(teacher);
    closeModal('teacher-modal');
}

window.deleteTeacherFromModal = async function(teacherId) {
    const teacher = teacherList.find(t => t.id === teacherId);
    const name = teacher ? teacher.name : '선생님';
    
    if (!confirm(`${name}을(를) 삭제하시겠습니까?`)) return;
    
    const ownerId = localStorage.getItem('current_owner_id');
    if (!ownerId) return alert('로그인이 필요합니다.');
    
    const { error } = await supabase
        .from('teachers')
        .delete()
        .eq('id', teacherId)
        .eq('owner_user_id', ownerId);
    
    if (error) {
        console.error('선생님 삭제 실패:', error);
        return alert('삭제 실패: ' + error.message);
    }
    
    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        localStorage.removeItem('current_teacher_id');
        localStorage.removeItem('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
        }
    }
    
    alert('선생님이 삭제되었습니다.');
    await loadTeachers();
    renderTeacherListModal();
}

// 역할 변경 처리
window.handleRoleChange = function(teacherId, newRole) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return;
    
    if (newRole === 'admin') {
        // 관리자 권한 부여 시 비밀번호 확인 필요
        document.getElementById('grant-admin-name').value = teacher.name;
        openModal('grant-admin-modal');
        // 역할 선택을 다시 원래대로
        document.getElementById(`role-${teacherId}`).value = teacher.role;
    } else {
        // 일반 역할 변경
        updateTeacherRole(teacherId, newRole);
    }
}

// 선생님 역할 업데이트
async function updateTeacherRole(teacherId, newRole) {
    try {
        const teacher = teacherList.find(t => t.id === teacherId);
        if (!teacher) return;
        
        // 로컬스토리지에 저장
        localStorage.setItem('teacher_' + teacher.name + '_role', newRole);
        
        console.log('[updateTeacherRole] 역할 변경 완료:', teacherId, newRole);
        alert('역할이 변경되었습니다.');
        
        // 목록 새로고침
        renderTeacherListModal();
    } catch (error) {
        console.error('[updateTeacherRole] 에러:', error);
        alert('역할 변경 실패: ' + error.message);
        // 실패 시 원래 값으로 복원
        renderTeacherListModal();
    }
}

// 관리자 권한 부여 확인
window.confirmGrantAdmin = async function() {
    const teacherName = document.getElementById('grant-admin-name').value;
    const email = document.getElementById('grant-admin-email').value.trim();
    const password = document.getElementById('grant-admin-password').value.trim();
    
    if (!email || !password) {
        alert('이메일과 비밀번호를 입력해주세요');
        return;
    }
    
    try {
        // 관리자 인증 확인
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) {
            alert('관리자 인증 실패: 이메일 또는 비밀번호가 올바르지 않습니다');
            return;
        }
        
        // 인증 성공 - role 컬럼이 없으므로 로컬스토리지에 저장
        localStorage.setItem('teacher_' + teacherName + '_role', 'admin');
        
        alert(teacherName + ' 선생님에게 관리자 권한이 부여되었습니다.');
        
        // 모달 초기화 및 닫기
        document.getElementById('grant-admin-name').value = '';
        document.getElementById('grant-admin-email').value = '';
        document.getElementById('grant-admin-password').value = '';
        closeModal('grant-admin-modal');
        
        // 현재 선택된 선생님이 권한을 받은 경우 UI 업데이트
        const currentTeacherName = localStorage.getItem('current_teacher_name');
        if (currentTeacherName === teacherName) {
            updatePaymentMenuVisibility();
            updateTeacherMenuVisibility();
            updateUserRoleLabel();
        }
        
        // 목록 새로고침
        await loadTeachers();
        renderTeacherListModal();
    } catch (error) {
        console.error('[confirmGrantAdmin] 에러:', error);
        alert('권한 부여 실패: ' + error.message);
    }
}

// 관리자 선생님 로그인 인증
// 일반 선생님/직원 비밀번호 인증
