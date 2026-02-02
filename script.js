let currentDate = new Date();
// 마지막 QR 출석 학생 ID (캘린더 표시용)
let lastQrScannedStudentId = null;
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
    
    // ✅ restorePageOnLoad()는 제거 - initializeAuth()가 이미 모든 페이지 복원 처리
    // initializeAuth()가 Supabase 세션 기반으로 페이지 라우팅을 완료함
    
    // 권한 메뉴 가시성 및 역할 라벨 업데이트
    updatePaymentMenuVisibility();
    updateStudentMenuVisibility();
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
    const savedOwnerId = localStorage.getItem('current_owner_id');

    console.log('[restorePageOnLoad] savedPage:', savedPage, 'savedTeacherId:', savedTeacherId, 'savedOwnerId:', savedOwnerId);

    // ✅ 핵심 검증: current_owner_id가 없으면 모든 사용자 상태 무효화
    if (!savedOwnerId) {
        console.warn('[restorePageOnLoad] current_owner_id 없음 - 세션 만료, 로그인 페이지로 이동');
        // localStorage 사용자 데이터 정리
        localStorage.removeItem('current_teacher_id');
        localStorage.removeItem('current_teacher_name');
        localStorage.removeItem('active_page');
        localStorage.removeItem('remember_login');
        navigateToPage('AUTH');
        return;
    }

    // 선생님이 이미 선택되어 있다면, 어떤 페이지가 저장되어 있더라도 일정 페이지로 복원
    if (savedTeacherId) {
        currentTeacherId = savedTeacherId;
        currentTeacher = { id: savedTeacherId, name: savedTeacherName };

        navigateToPage('MAIN_APP');

        const label = document.getElementById('current-teacher-name');
        if (label) label.textContent = savedTeacherName || '미선택';

        loadAndCleanData();
        (async () => {
            await loadTeacherScheduleData(currentTeacherId);
            renderCalendar();
        })();
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
            .select('*')
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
            role: t.role || t.teacher_role || 'teacher'  // role/teacher_role이 없으면 기본값 'teacher'
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
        // 전화번호 뒤 4자리만 표시
        let displayText = t.name;
        if (t.phone) {
            const last4 = t.phone.replace(/[^0-9]/g, '').slice(-4);
            displayText += last4 ? ` (${last4})` : '';
        }
        opt.textContent = displayText;
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
        
        // Supabase에서 최신 role 정보 조회
        console.log('[setCurrentTeacher] Supabase에서 최신 role 정보 조회 중...');
        const { data: latestTeacher, error } = await supabase
            .from('teachers')
            .select('role, teacher_role')
            .eq('id', teacher.id)
            .single();
        
        if (error) {
            console.error('[setCurrentTeacher] role 조회 실패:', error);
        } else if (latestTeacher) {
            // role 또는 teacher_role 중 하나 사용 (우선순위: role > teacher_role)
            teacher.role = latestTeacher.role || latestTeacher.teacher_role || 'teacher';
            console.log('[setCurrentTeacher] 최신 role 반영:', teacher.role);
        }
        
        // 기본값 설정 (role이 없으면 'teacher')
        if (!teacher.role) {
            teacher.role = 'teacher';
        }
        
        // 전역 변수 설정
        currentTeacher = teacher;
        currentTeacherId = teacher.id;
        
        // 선택된 선생님을 로컬 저장해 새로고침 후에도 유지
        localStorage.setItem('current_teacher_id', teacher.id);
        localStorage.setItem('current_teacher_name', teacher.name || '');
        localStorage.setItem('current_teacher_role', teacher.role);
        console.log('[setCurrentTeacher] 로컬 저장 완료, teacherId:', teacher.id, '역할:', teacher.role);
        
        // 1단계: 관리자별 모든 학생 로드
        console.log('[setCurrentTeacher] 1단계: 학생 데이터 로드 중...');
        await loadAndCleanData();
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
        await loadTeacherScheduleData(teacher.id);
        console.log('[setCurrentTeacher] 4단계 완료: 일정 데이터 로드 완료');
        
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
    
    // Supabase에서 해시를 가져와 비교
    const passwordHash = await hashPin(password);
    console.log('[confirmTeacher] 입력된 비밀번호 해시:', passwordHash);
    console.log('[confirmTeacher] 저장된 해시:', teacher.pin_hash);
    
    if (passwordHash !== teacher.pin_hash) {
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
        const address = document.getElementById('new-teacher-address').value.trim();
        const addressDetail = document.getElementById('new-teacher-address-detail').value.trim();
        const teacherPassword = document.getElementById('register-teacher-password').value.trim();
        
        console.log('[registerTeacher] 입력 값 - name:', name, ', phone:', phone, ', address:', address);
        
        if (!name) return alert('선생님 이름은 필수입니다.');
        
        // 모든 선생님은 비밀번호가 필수
        if (!teacherPassword) {
            return alert('비밀번호는 필수입니다.');
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
        
        // 비밀번호 해시 생성
        const passwordHash = await hashPin(teacherPassword);
        
        const { data, error } = await supabase
            .from('teachers')
            .insert({ 
                owner_user_id: ownerId, 
                name, 
                phone: phone || null, 
                address: address || null,
                address_detail: addressDetail || null,
                pin_hash: passwordHash, 
                role: 'teacher', 
                teacher_role: 'teacher' 
            })
            .select()
            .single();
        
        if (error) {
            console.error('[registerTeacher] Supabase 에러:', error);
            console.error('[registerTeacher] 에러 상세:', error.message, error.code, error.details);
            return alert('선생님 등록 실패:\n' + error.message);
        }
        
        console.log('[registerTeacher] 등록 성공:', data);
        
        console.log('[registerTeacher] 저장됨 - 비밀번호:', teacherPassword);
        
        // 입력 필드 초기화
        document.getElementById('new-teacher-name').value = '';
        document.getElementById('new-teacher-phone').value = '';
        document.getElementById('new-teacher-address').value = '';
        document.getElementById('new-teacher-address-detail').value = '';
        document.getElementById('register-teacher-password').value = '';
        
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
    // QR 출석 뱃지는 일정 렌더 직후 2.5초간만 표시
    const qrBadgeStudentId = lastQrScannedStudentId;
    if (qrBadgeStudentId) {
        setTimeout(() => { lastQrScannedStudentId = null; renderCalendar(); }, 2500);
    }
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

    // 현재 선생님의 학생 + 일정 데이터 기준 활성 학생
    const activeStudents = getActiveStudentsForTeacher(currentTeacherId);
    
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

    // Render time axis (00:00 ~ 24:00)
    for(let h = startHour; h <= endHour; h++) { // Loop up to 24 for hours (inclusive)
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        label.style.height = (60 * pxPerMin) + 'px';
        axis.appendChild(label);
    }
    
    // Set grid height to cover the full 24 hours (1440 minutes * pxPerMin)
    grid.style.height = (24 * 60 * pxPerMin) + 'px';

    // 현재 선생님의 학생 + 일정 데이터 기준 활성 학생
    const activeStudents = getActiveStudentsForTeacher(currentTeacherId);
    let rawEvents = [];
    // QR 출석 뱃지용 학생ID (전역)
    const qrBadgeStudentId = typeof lastQrScannedStudentId !== 'undefined' ? lastQrScannedStudentId : null;
    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    activeStudents.forEach((s) => {
        // 디버깅: 날짜 포맷과 데이터 매칭 확인
        if (teacherSchedule[s.id]) {
            const allDates = Object.keys(teacherSchedule[s.id]);
            console.log(`[디버그] 학생:${s.name}(${s.id}) 일정 날짜 목록:`, allDates, '찾는 날짜:', dateStr);
        }
        // 현재 선생님의 schedule 데이터에서만 확인
        if(teacherSchedule[s.id] && teacherSchedule[s.id][dateStr]) {
            console.log(`[디버그] 일정 있음:`, s.name, dateStr, teacherSchedule[s.id][dateStr]);
            const studentSchedule = teacherSchedule[s.id];
            const detail = studentSchedule[dateStr] || { start: '16:00', duration: 90 };
            const [h, m] = detail.start.split(':').map(Number);
            let startMin = (h * 60) + m; // Calculate start minutes from 00:00
            // Ensure startMin is within bounds, though it should be if time input is valid
            if (startMin < 0) startMin = 0;
            if (startMin >= 24 * 60) startMin = (24 * 60) - 1; // Cap at end of day
            rawEvents.push({ student: s, startMin: startMin, duration: parseInt(detail.duration), originalStart: detail.start });
        } else {
            console.log(`[디버그] 일정 없음:`, s.name, dateStr, teacherSchedule[s.id]);
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
        // 기본은 컬럼 폭의 40%만 사용해 처음 배치 시 더 작게 표시
        const autoWidth = defaultSlotWidth * 0.4;
        block.style.width = (savedWidths[blockId] !== undefined ? savedWidths[blockId] : autoWidth) + '%';
        
        
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
                let statusBadge = '';
                if (status === 'present') {
                    statusBadge = '<span style="background:#10b981;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">출석</span>';
                } else if (status === 'late') {
                    statusBadge = '<span style="background:#f59e0b;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">지각</span>';
                } else if (status === 'absent') {
                    statusBadge = '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">결석</span>';
                } else if (status === 'makeup' || status === 'etc') {
                    statusBadge = '<span style="background:#8b5cf6;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">보강</span>';
                }
                // QR 출석 뱃지 추가
                let qrBadge = '';
                if (qrBadgeStudentId && String(m.id) === String(qrBadgeStudentId)) {
                    qrBadge = '<span style="background:#2563eb;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;">QR</span>';
                }
                // 이름 옆에 출석현황 뱃지 항상 표시
                return `<div class="sub-event-item ${getSubItemColorClass(m.grade)}" onclick="event.stopPropagation(); openAttendanceModal('${m.id}', '${dateStr}')"><div class="sub-info"><span class="sub-name">${m.name}${qrBadge} ${statusBadge}</span><span class="sub-grade">${m.grade}</span></div></div>`;
            }).join('')}</div>`;
        } else {
            const s = ev.members[0];
            const status = (s.attendance && s.attendance[dateStr]) || 'none';
            let statusBadge = '';
            if (status === 'present') {
                statusBadge = '<span style="background:#10b981;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">출석</span>';
            } else if (status === 'late') {
                statusBadge = '<span style="background:#f59e0b;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">지각</span>';
            } else if (status === 'absent') {
                statusBadge = '<span style="background:#ef4444;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">결석</span>';
            } else if (status === 'makeup' || status === 'etc') {
                statusBadge = '<span style="background:#8b5cf6;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">보강</span>';
            }
            // QR 출석 뱃지 추가
            let qrBadge = '';
            if (qrBadgeStudentId && String(s.id) === String(qrBadgeStudentId)) {
                qrBadge = '<span style="background:#2563eb;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;">QR</span>';
            }
            // 이름 옆에 출석현황 뱃지 항상 표시
            contentDiv.innerHTML = `<div class="evt-title">${s.name}${qrBadge} ${statusBadge} <span class="evt-grade">(${s.grade})</span></div><div class="event-time-text">${ev.originalStart} - ${endTimeStr} (${ev.duration}분)</div>`;
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
    
    // 현재 출석 상태 표시
    document.querySelectorAll('.att-btn').forEach(btn => btn.classList.remove('active'));
    const currentStatus = s.attendance && s.attendance[dateStr];
    
    // 상태 표시 영역 업데이트
    const statusDisplay = document.getElementById('current-status-display');
    statusDisplay.className = 'status-display'; // 기본 클래스 초기화
    
    const statusMapDisplay = {
        'present': { text: '✓ 출석', class: 'status-present' },
        'late': { text: '⏰ 지각', class: 'status-late' },
        'absent': { text: '✕ 결석', class: 'status-absent' },
        'makeup': { text: '🔄 보강', class: 'status-makeup' },
        'etc': { text: '🔄 보강', class: 'status-makeup' }
    };
    
    if (currentStatus && statusMapDisplay[currentStatus]) {
        statusDisplay.textContent = statusMapDisplay[currentStatus].text;
        statusDisplay.classList.add(statusMapDisplay[currentStatus].class);
        
        // 버튼 active 상태도 설정
        let btnClass = currentStatus;
        if (currentStatus === 'makeup') {
            btnClass = 'etc'; // makeup을 etc 버튼에 매핑
        }
        const activeBtn = document.querySelector(`.att-btn.${btnClass}`);
        if (activeBtn) activeBtn.classList.add('active');
    } else {
        statusDisplay.textContent = '미등록';
        statusDisplay.style.color = '#9ca3af';
    }
    
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
        
        // 버튼 active 상태 업데이트 (시각적 피드백)
        document.querySelectorAll('.att-btn').forEach(btn => btn.classList.remove('active'));
        
        // status를 etc 버튼에 매핑
        let btnClass = status;
        if (status === 'makeup') {
            btnClass = 'etc';
        }
        
        const activeBtn = document.querySelector(`.att-btn.${btnClass}`);
        if (activeBtn) activeBtn.classList.add('active');
        
        // 상태 표시 영역 동적 업데이트
        const statusDisplay = document.getElementById('current-status-display');
        const statusMapDisplay = {
            'present': { text: '✓ 출석', class: 'status-present' },
            'late': { text: '⏰ 지각', class: 'status-late' },
            'absent': { text: '✕ 결석', class: 'status-absent' },
            'makeup': { text: '🔄 보강', class: 'status-makeup' },
            'etc': { text: '🔄 보강', class: 'status-makeup' }
        };
        
        if (statusMapDisplay[status]) {
            statusDisplay.className = 'status-display ' + statusMapDisplay[status].class;
            statusDisplay.textContent = statusMapDisplay[status].text;
        }
        
        // 데이터 저장
        saveData();
        
        // currentTeacherStudents 배열도 즉시 업데이트
        const currentStudentIdx = currentTeacherStudents.findIndex(s => String(s.id) === String(sid));
        if (currentStudentIdx > -1) {
            if(!currentTeacherStudents[currentStudentIdx].attendance) currentTeacherStudents[currentStudentIdx].attendance = {};
            if(!currentTeacherStudents[currentStudentIdx].records) currentTeacherStudents[currentStudentIdx].records = {};
            currentTeacherStudents[currentStudentIdx].attendance[dateStr] = status;
            currentTeacherStudents[currentStudentIdx].records[dateStr] = memo;
        }
        
        console.log('[setAttendance] 상태 저장됨:', { sid, dateStr, status, student: students[sIdx].name });
        
        // 화면 즉시 업데이트
        renderCalendar();
        if(document.getElementById('day-detail-modal').style.display === 'flex') {
            renderDayEvents(dateStr);
        }
        
        // 짧은 딜레이 후 모달 닫기 (사용자가 선택을 확인할 수 있도록)
        setTimeout(() => {
            closeModal('attendance-modal');
        }, 300);
    }
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
window.generateSchedule = async function() {
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
    await saveTeacherScheduleData();
    saveLayouts();
    closeModal('schedule-modal');
    await loadTeacherScheduleData(currentTeacherId);
    // 현재 선생님의 학생 목록 다시 로드 (새 학생의 일정이 즉시 보이도록)
    await refreshCurrentTeacherStudents();
    renderCalendar();
    alert(count === 0 ? "새로 등록된 일정이 없습니다." : `${count}개의 일정이 생성되었습니다.`);
}
window.generateScheduleWithoutHolidays = async function() {
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
    await saveTeacherScheduleData();
    saveLayouts();
    closeModal('schedule-modal');
    await loadTeacherScheduleData(currentTeacherId);
    // 현재 선생님의 학생 목록 다시 로드 (새 학생의 일정이 즉시 보이도록)
    await refreshCurrentTeacherStudents();
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
window.executeBulkDelete = async function() {
    const sid = document.getElementById('bulk-del-sid').value;
    const startStr = document.getElementById('bulk-del-start').value;
    const endStr = document.getElementById('bulk-del-end').value;
    if(!startStr || !endStr) return alert("기간을 모두 선택해주세요.");
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx === -1) return;
    if(!confirm("선택한 기간의 일정을 삭제하시겠습니까?")) return;
    const startDate = new Date(startStr); const endDate = new Date(endStr);
    
    let deletedCount = 0;
    
    // 현재 선생님의 schedule 데이터에서 삭제할 일정 수집
    if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
        const deleteDates = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dStr => {
            const d = new Date(dStr);
            return d >= startDate && d <= endDate;
        });
        
        // 1. 데이터베이스에서 각각 삭제
        for (const dStr of deleteDates) {
            try {
                const deleteSuccess = await deleteScheduleFromDatabase(sid, dStr, currentTeacherId);
                if (deleteSuccess) {
                    delete teacherScheduleData[currentTeacherId][sid][dStr];
                    deletedCount++;
                }
                console.log('[executeBulkDelete] 삭제 완료:', dStr);
            } catch (dbError) {
                console.error('[executeBulkDelete] 데이터베이스 삭제 실패 (' + dStr + '):', dbError);
            }
        }
    }
    
    // 2. 데이터 저장 및 화면 업데이트
    saveData(); 
    await saveTeacherScheduleData();
    closeModal('bulk-delete-modal'); 
    renderCalendar();
    alert(`${deletedCount}개의 일정이 삭제되었습니다.`);
}
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
async function handleDrop(e) {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    const sid = e.dataTransfer.getData('studentId');
    const oldD = e.dataTransfer.getData('oldDate');
    const newD = e.currentTarget.dataset.date;
    if (!sid || !oldD || !newD || oldD === newD) return;
    const idx = students.findIndex(s => String(s.id) === String(sid));
    if (idx > -1) {
        // 기존 출석/기록 이동
        if(students[idx].attendance && students[idx].attendance[oldD]) { students[idx].attendance[newD] = students[idx].attendance[oldD]; delete students[idx].attendance[oldD]; }
        if(students[idx].records && students[idx].records[oldD]) { students[idx].records[newD] = students[idx].records[oldD]; delete students[idx].records[oldD]; }
        
        // 선생님별 일정 데이터 이동 (현재 선생님의 데이터만 이동)
        if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            if(teacherScheduleData[currentTeacherId][sid][oldD]) {
                const scheduleInfo = teacherScheduleData[currentTeacherId][sid][oldD];
                
                // 데이터베이스에서 삭제 후 새로 추가
                try {
                    // 1. 구 일정 삭제
                    await deleteScheduleFromDatabase(sid, oldD, currentTeacherId);
                    console.log('[handleDrop] 구 일정 삭제 완료:', oldD);
                    
                    // 2. 신 일정 추가
                    await saveScheduleToDatabase({
                        teacherId: currentTeacherId,
                        studentId: sid,
                        date: newD,
                        startTime: scheduleInfo.start,
                        duration: scheduleInfo.duration
                    });
                    console.log('[handleDrop] 신 일정 추가 완료:', newD);
                    
                    // 3. 메모리 업데이트
                    teacherScheduleData[currentTeacherId][sid][newD] = scheduleInfo;
                    delete teacherScheduleData[currentTeacherId][sid][oldD];
                    
                } catch (dbError) {
                    console.error('[handleDrop] 데이터베이스 동기화 실패:', dbError);
                    alert('일정 이동 중 오류가 발생했습니다.');
                    return;
                }
            }
        }
        saveData();
        await saveTeacherScheduleData();
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') closeModal('day-detail-modal');
    }
}
window.deleteSingleSchedule = async function() {
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    if(!confirm("이 날짜의 일정을 삭제하시겠습니까?")) return;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        // 1. 데이터베이스에서 먼저 삭제
        try {
            const deleteSuccess = await deleteScheduleFromDatabase(sid, dateStr, currentTeacherId);
            console.log('[deleteSingleSchedule] 데이터베이스 삭제:', deleteSuccess);
        } catch (dbError) {
            console.error('[deleteSingleSchedule] 데이터베이스 삭제 실패:', dbError);
            alert('데이터베이스 삭제 중 오류가 발생했습니다: ' + dbError.message);
            return;
        }
        
        // 2. 로컬 메모리에서 삭제
        if(students[sIdx].attendance) delete students[sIdx].attendance[dateStr]; 
        if(students[sIdx].records) delete students[sIdx].records[dateStr];
        // 현재 선생님의 일정 데이터 삭제
        if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            delete teacherScheduleData[currentTeacherId][sid][dateStr];
        }
        
        // 3. 데이터 저장 및 화면 업데이트
        saveData();
        await saveTeacherScheduleData();
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') renderDayEvents(dateStr);
        
        alert('일정이 삭제되었습니다.');
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
window.executePeriodDelete = async function() {
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
    
    // 1. 데이터베이스에서 먼저 삭제
    for (const student of targetStudents) {
        const sid = student.id;
        const sIdx = students.findIndex(s => String(s.id) === String(sid));
        if (sIdx === -1) continue;
        
        // 현재 선생님의 일정 데이터에서 기간 내 이벤트 필터링
        if (teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            const eventsToDelete = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dateStr => {
                if (dateStr < startDate || dateStr > endDate) return false;
                // 출석 체크가 없는 일정만 삭제
                const hasAttendance = student.attendance && student.attendance[dateStr];
                return !hasAttendance;
            });
            
            // 데이터베이스에서 각각 삭제
            for (const dateStr of eventsToDelete) {
                try {
                    const deleteSuccess = await deleteScheduleFromDatabase(sid, dateStr, currentTeacherId);
                    if (deleteSuccess) {
                        delete teacherScheduleData[currentTeacherId][sid][dateStr];
                        deletedCount++;
                    }
                    console.log('[executePeriodDelete] 삭제 완료:', dateStr);
                } catch (dbError) {
                    console.error('[executePeriodDelete] 데이터베이스 삭제 실패 (' + dateStr + '):', dbError);
                }
            }
        }
    }
    
    if (deletedCount > 0) {
        saveData();
        await saveTeacherScheduleData();
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
        else if(status === 'late') { statusText = '지각'; statusClass = 'bg-late'; dotClass = 't-dot-late'; }
        else if(status === 'makeup') { statusText = '보강'; statusClass = 'bg-makeup'; dotClass = 't-dot-makeup'; }
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
window.saveDaySettings = async function() {
    const dateStr = document.getElementById('setting-date-str').value;
    const isRed = document.getElementById('is-red-day').checked;
    const name = document.getElementById('day-name').value;
    const color = document.getElementById('holiday-color') ? document.getElementById('holiday-color').value : '#ef4444';
    if (isRed) {
        if (!name.trim()) return alert("공휴일 이름을 입력해주세요.");
        customHolidays[dateStr] = { name, color };
        
        // 수파베이스에도 저장
        if (typeof saveHolidayToDatabase === 'function') {
            try {
                await saveHolidayToDatabase({
                    teacherId: currentTeacherId || 'no-teacher',
                    date: dateStr,
                    name: name,
                    color: color
                });
                console.log(`공휴일 DB 저장: ${dateStr}`);
            } catch (dbError) {
                console.error('휴일 DB 저장 실패:', dbError);
            }
        }
    } else { 
        delete customHolidays[dateStr];
        
        // 수파베이스에서도 삭제
        if (typeof deleteHolidayFromDatabase === 'function') {
            try {
                await deleteHolidayFromDatabase(currentTeacherId || 'no-teacher', dateStr);
                console.log(`공휴일 DB 삭제: ${dateStr}`);
            } catch (dbError) {
                console.error('휴일 DB 삭제 실패:', dbError);
            }
        }
    }
    // 공휴일: 선생님별로 분리 저장 (반드시 currentTeacherId 사용)
    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));
    console.log(`공휴일 로컬 저장 (${currentTeacherId}): ${dateStr}`);
    closeModal('day-settings-modal'); renderCalendar();
}
async function loadAndCleanData() {
    try {
        console.log('[loadAndCleanData] Supabase에서 학생 데이터 로드 중...');
        
        // Supabase에서 모든 학생 조회
        const supabaseStudents = await getAllStudents();
        console.log('[loadAndCleanData] Supabase 학생 수:', supabaseStudents.length);
        
        if (supabaseStudents && supabaseStudents.length > 0) {
            // Supabase 데이터를 앱 형식으로 변환
            students = supabaseStudents.map(s => ({
                id: s.id,
                name: s.name,
                grade: s.grade,
                studentPhone: s.phone || '',
                parentPhone: s.parent_phone || '',
                defaultFee: s.default_fee || 0,
                specialLectureFee: s.special_lecture_fee || 0,
                defaultTextbookFee: s.default_textbook_fee || 0,
                memo: s.memo || '',
                registerDate: s.register_date || '',
                status: s.status || 'active',
                events: [],
                attendance: {},
                records: {},
                payments: {}
            }));
            // 로컬 스토리지에도 백업 저장
            const ownerKey = `academy_students__${localStorage.getItem('current_owner_id') || 'no-owner'}`;
            localStorage.setItem(ownerKey, JSON.stringify(students));
            console.log(`[loadAndCleanData] Supabase에서 학생 데이터 로드 완료: ${students.length}명`);
        } else {
            // Supabase에 학생이 없으면 students를 빈 배열로 강제 (로컬 fallback 금지)
            students = [];
            const ownerKey = `academy_students__${localStorage.getItem('current_owner_id') || 'no-owner'}`;
            localStorage.setItem(ownerKey, JSON.stringify([]));
            console.log(`[loadAndCleanData] Supabase에 학생 없음. students를 빈 배열로 초기화.`);
        }
    } catch (error) {
        console.error('[loadAndCleanData] 학생 데이터 로드 실패:', error);
        students = [];
    }

    try {
        // 출석 기록: 소유자 기준으로 로드하여 학생에 반영 (모든 선생님 공통)
        if (typeof getAttendanceRecordsByOwner === 'function') {
            const records = await getAttendanceRecordsByOwner();
            if (records && records.length > 0 && students.length > 0) {
                const recordMap = new Map();
                records.forEach(r => {
                    const key = `${r.student_id}__${r.attendance_date}`;
                    const timeVal = r.qr_scan_time || r.check_in_time || r.updated_at || r.created_at || null;
                    if (!recordMap.has(key)) {
                        recordMap.set(key, { record: r, time: timeVal });
                    } else {
                        const existing = recordMap.get(key);
                        const existingTime = existing.time ? new Date(existing.time).getTime() : 0;
                        const currentTime = timeVal ? new Date(timeVal).getTime() : 0;
                        if (currentTime >= existingTime) {
                            recordMap.set(key, { record: r, time: timeVal });
                        }
                    }
                });

                recordMap.forEach(({ record }) => {
                    const student = students.find(s => String(s.id) === String(record.student_id));
                    if (!student) return;
                    if (!student.attendance) student.attendance = {};
                    student.attendance[record.attendance_date] = record.status;
                });

                const ownerKey = `academy_students__${localStorage.getItem('current_owner_id') || 'no-owner'}`;
                localStorage.setItem(ownerKey, JSON.stringify(students));
                console.log(`[loadAndCleanData] 출석 기록 동기화 완료: ${recordMap.size}건`);
            }
        }
    } catch (e) {
        console.error('[loadAndCleanData] 출석 기록 동기화 실패:', e);
    }
    try {
        // 공휴일: 수파베이스에서 먼저 로드
        if (typeof getHolidaysByTeacher === 'function') {
            try {
                const dbHolidays = await getHolidaysByTeacher(currentTeacherId || 'no-teacher');
                customHolidays = {};
                dbHolidays.forEach(h => {
                    customHolidays[h.holiday_date] = {
                        name: h.holiday_name,
                        color: h.color || '#ef4444'
                    };
                });
                console.log(`공휴일 DB 로드 (${currentTeacherId}): ${dbHolidays.length}개`);
                
                // 로컬에도 백업
                const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
                localStorage.setItem(holKey, JSON.stringify(customHolidays));
            } catch (dbError) {
                console.error('공휴일 DB 로드 실패:', dbError);
                // DB 실패 시 로컬에서 로드
                const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
                const hol = localStorage.getItem(holKey);
                customHolidays = hol ? JSON.parse(hol) : {};
            }
        } else {
            // 함수가 없으면 로컬에서만 로드
            const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
            const hol = localStorage.getItem(holKey);
            customHolidays = hol ? JSON.parse(hol) : {};
            console.log(`공휴일 로컬 로드 (${currentTeacherId}): ${Object.keys(customHolidays).length}개`);
        }
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
async function loadTeacherScheduleData(teacherId) {
    try {
        // 수파베이스에서 먼저 로드
        if (typeof getSchedulesByTeacher === 'function') {
            try {
                const dbSchedules = await getSchedulesByTeacher(teacherId);
                teacherScheduleData[teacherId] = {};
                
                dbSchedules.forEach(schedule => {
                    const studentId = String(schedule.student_id);
                    const date = schedule.schedule_date;
                    
                    if (!teacherScheduleData[teacherId][studentId]) {
                        teacherScheduleData[teacherId][studentId] = {};
                    }
                    
                    teacherScheduleData[teacherId][studentId][date] = {
                        start: schedule.start_time.substring(0, 5), // HH:MM 형식
                        duration: schedule.duration
                    };
                });
                
                console.log(`일정 DB 로드 (${teacherId}): ${dbSchedules.length}개`);
                
                // 로컬에도 백업
                const key = `teacher_schedule_data__${teacherId}`;
                localStorage.setItem(key, JSON.stringify(teacherScheduleData[teacherId] || {}));
            } catch (dbError) {
                console.error('일정 DB 로드 실패:', dbError);
                // DB 실패 시 로컬에서 로드
                const key = `teacher_schedule_data__${teacherId}`;
                const raw = localStorage.getItem(key);
                if (raw) {
                    teacherScheduleData[teacherId] = JSON.parse(raw) || {};
                } else {
                    teacherScheduleData[teacherId] = {};
                }
            }
        } else {
            // 함수가 없으면 로컬에서만 로드
            const key = `teacher_schedule_data__${teacherId}`;
            const raw = localStorage.getItem(key);
            if (raw) {
                teacherScheduleData[teacherId] = JSON.parse(raw) || {};
            } else {
                teacherScheduleData[teacherId] = {};
            }
        }
        console.log(`선생님 ${teacherId} 일정 데이터 로드 완료: ${Object.keys(teacherScheduleData[teacherId] || {}).length}명`);
        if (teacherId === currentTeacherId) {
            await refreshCurrentTeacherStudents();
        }
    } catch (e) {
        console.error('선생님 일정 데이터 로드 실패:', e);
        teacherScheduleData[teacherId] = {};
    }
}

// 선생님별 일정 데이터 저장
async function saveTeacherScheduleData() {
    try {
        if (!currentTeacherId) return;
        
        // ✅ 세션 검증: current_owner_id가 없으면 저장 불가
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) {
            console.warn('[saveTeacherScheduleData] current_owner_id 없음 - 저장 중단');
            return;
        }
        
        // 로컬 저장
        const key = `teacher_schedule_data__${currentTeacherId}`;
        localStorage.setItem(key, JSON.stringify(teacherScheduleData[currentTeacherId] || {}));
        console.log(`선생님 ${currentTeacherId} 일정 데이터 로컬 저장 완료`);
        
        // 수파베이스 동기화
        if (typeof saveScheduleToDatabase === 'function') {
            const scheduleData = teacherScheduleData[currentTeacherId] || {};
            for (const studentId in scheduleData) {
                for (const date in scheduleData[studentId]) {
                    const schedule = scheduleData[studentId][date];
                    try {
                        await saveScheduleToDatabase({
                            teacherId: currentTeacherId,
                            studentId: studentId,
                            date: date,
                            startTime: schedule.start,
                            duration: schedule.duration
                        });
                    } catch (dbError) {
                        console.error('일정 DB 저장 실패:', date, dbError);
                    }
                }
            }
            console.log(`선생님 ${currentTeacherId} 일정 데이터 DB 저장 완료`);
        }
    } catch (e) {
        console.error('선생님 일정 데이터 저장 실패:', e);
    }
}
function saveData() { 
    // ✅ 세션 검증: current_owner_id가 없으면 저장 불가
    const ownerId = localStorage.getItem('current_owner_id');
    if (!ownerId) {
        console.warn('[saveData] current_owner_id 없음 - 저장 중단');
        alert('로그인이 필요합니다');
        return;
    }
    
    // 현재 로그인 사용자(관리자) 기준으로 저장
    const ownerKey = `academy_students__${ownerId}`;
    localStorage.setItem(ownerKey, JSON.stringify(students)); 
    console.log(`학생 데이터 저장 (${ownerId}): ${students.length}명`);
}

// 선생님 기준 활성 학생 목록 (매핑 + 일정 데이터 병합)
function getActiveStudentsForTeacher(teacherId) {
    if (!teacherId) return [];

    const mappingKey = `teacher_students_mapping__${teacherId}`;
    let mappedIds = [];

    try {
        const saved = localStorage.getItem(mappingKey);
        if (saved) mappedIds = JSON.parse(saved) || [];
    } catch (e) {
        console.error('[getActiveStudentsForTeacher] 매핑 파싱 실패:', e);
        mappedIds = [];
    }

    const scheduleIds = Object.keys(teacherScheduleData[teacherId] || {});
    const mergedIds = new Set([ ...mappedIds.map(String), ...scheduleIds.map(String) ]);

    return students.filter(s => mergedIds.has(String(s.id)) && s.status === 'active');
}

// 현재 선생님의 학생 목록 새로고침
async function refreshCurrentTeacherStudents() {
    if (!currentTeacherId) {
        console.warn('[refreshCurrentTeacherStudents] currentTeacherId가 설정되지 않음');
        return;
    }

    currentTeacherStudents = getActiveStudentsForTeacher(currentTeacherId);
    console.log('[refreshCurrentTeacherStudents] 현재 선생님 학생 목록 갱신:', currentTeacherStudents.length + '명');
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

// 학생을 모든 선생님에게서 제거
function unassignStudentFromAllTeachers(studentId) {
    console.log(`[학생 삭제] 모든 선생님에게서 학생 ${studentId} 제거 시작`);
    
    // 모든 teacher_students_mapping 키 찾기
    const allKeys = Object.keys(localStorage);
    const mappingKeys = allKeys.filter(key => key.startsWith('teacher_students_mapping__'));
    
    mappingKeys.forEach(key => {
        try {
            const saved = localStorage.getItem(key);
            if (saved) {
                let studentIds = JSON.parse(saved) || [];
                const beforeLength = studentIds.length;
                studentIds = studentIds.filter(id => String(id) !== String(studentId));
                
                if (beforeLength !== studentIds.length) {
                    localStorage.setItem(key, JSON.stringify(studentIds));
                    console.log(`${key}에서 학생 ${studentId} 제거`);
                }
            }
        } catch (e) {
            console.error(`${key} 처리 실패:`, e);
        }
    });
    
    // teacherScheduleData에서도 제거
    Object.keys(teacherScheduleData).forEach(teacherId => {
        if (teacherScheduleData[teacherId] && teacherScheduleData[teacherId][studentId]) {
            delete teacherScheduleData[teacherId][studentId];
            console.log(`teacherScheduleData[${teacherId}]에서 학생 ${studentId} 제거`);
        }
    });
    
    console.log(`[학생 삭제] 모든 선생님에게서 학생 ${studentId} 제거 완료`);
}
window.goToday = function() { currentDate = new Date(); document.getElementById('jump-date-picker').value = ''; renderCalendar(); }
window.moveDate = function(d) {
    if(currentView === 'month') {
        // 날짜를 1일로 임시 설정 후 월 이동, 마지막에 일자를 조정
        const day = currentDate.getDate();
        currentDate.setDate(1);
        currentDate.setMonth(currentDate.getMonth() + d);
        const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
        currentDate.setDate(Math.min(day, lastDay));
    } else {
        currentDate.setDate(currentDate.getDate() + (d * 7));
    }
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
            <select id="status-select-${s.id}" class="status-select ${s.status}" data-student-id="${s.id}" data-original-status="${s.status}" onchange="updateStudentStatus('${s.id}', this.value)">
                <option value="active" ${s.status === 'active' ? 'selected' : ''}>재원</option>
                <option value="archived" ${s.status === 'archived' ? 'selected' : ''}>퇴원</option>
                <option value="paused" ${s.status === 'paused' ? 'selected' : ''}>휴원</option>
                <option value="delete">삭제</option>
            </select>
        </div>`
    }).join('');
    document.getElementById('student-list-count').textContent = `${filtered.length}명`;
}
window.updateStudentStatus = async function(id, newStatus) {
    console.log(`[updateStudentStatus] 호출 - id: ${id}, newStatus: ${newStatus}`);
    
    const idx = students.findIndex(s => String(s.id) === String(id));
    if (idx === -1) {
        console.error(`[updateStudentStatus] 학생을 찾을 수 없음 - id: ${id}`);
        alert('학생을 찾을 수 없습니다.');
        renderDrawerList();
        return;
    }
    
    const student = students[idx];
    const selectElement = document.getElementById(`status-select-${id}`);
    const originalStatus = selectElement ? selectElement.getAttribute('data-original-status') : student.status;
    
    if (newStatus === 'delete') {
        if (confirm(`정말로 ${student.name} 학생의 모든 데이터를 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다.)`)) {
            try {
                console.log(`[updateStudentStatus] 학생 삭제 시작 - id: ${id}`);
                
                // Supabase에서 삭제
                const deleted = await deleteStudent(id);
                console.log(`[updateStudentStatus] deleteStudent 결과:`, deleted);
                
                if (deleted) {
                    // 모든 선생님에게서 제거
                    unassignStudentFromAllTeachers(id);
                    
                    // 메모리와 로컬 스토리지에서 삭제
                    students.splice(idx, 1);
                    
                    // currentTeacherStudents에서도 제거
                    currentTeacherStudents = currentTeacherStudents.filter(s => String(s.id) !== String(id));
                    
                    saveData(); 
                    renderDrawerList(); 
                    renderCalendar(); 
                    
                    console.log(`[updateStudentStatus] 학생 삭제 성공 - ${student.name}`);
                    alert(`${student.name} 학생이 삭제되었습니다.`);
                } else {
                    throw new Error('데이터베이스 삭제 실패');
                }
            } catch (error) {
                console.error('[updateStudentStatus] 학생 삭제 실패:', error);
                alert(`학생 삭제에 실패했습니다: ${error.message}`);
                
                // 원래 상태로 복구
                if (selectElement) {
                    selectElement.value = originalStatus;
                }
                renderDrawerList();
            }
        } else {
            // 취소 시 원래 상태로 복구
            console.log('[updateStudentStatus] 사용자가 삭제를 취소함');
            if (selectElement) {
                selectElement.value = originalStatus;
            }
            renderDrawerList();
        }
        return;
    }
    
    try {
        console.log(`[updateStudentStatus] 상태 변경 시작 - ${student.name}: ${originalStatus} -> ${newStatus}`);
        
        // 상태 변경을 Supabase에 반영
        const updated = await updateStudent(id, { status: newStatus });
        console.log(`[updateStudentStatus] updateStudent 결과:`, updated);
        
        if (updated) {
            students[idx].status = newStatus; 
            saveData(); 
            renderDrawerList(); 
            renderCalendar();
            console.log(`[updateStudentStatus] 상태 변경 성공 - ${student.name}: ${newStatus}`);
        } else {
            throw new Error('상태 업데이트 실패');
        }
    } catch (error) {
        console.error('[updateStudentStatus] 학생 상태 업데이트 실패:', error);
        alert(`학생 상태 변경에 실패했습니다: ${error.message}`);
        
        // 원래 상태로 복구
        if (selectElement) {
            selectElement.value = originalStatus;
        }
        renderDrawerList();
    }
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
    document.getElementById('edit-mode-actions').style.display = 'none'; 
    document.getElementById('view-attendance-btn').style.display = 'none';
    openModal('register-modal');
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
    document.getElementById('reg-default-fee').value = s.defaultFee ? s.defaultFee.toLocaleString() : "";
    document.getElementById('reg-special-fee').value = s.specialLectureFee ? s.specialLectureFee.toLocaleString() : "";
    document.getElementById('reg-default-textbook-fee').value = s.defaultTextbookFee ? s.defaultTextbookFee.toLocaleString() : "";
    document.getElementById('reg-memo').value = s.memo || "";
    document.getElementById('reg-register-date').value = s.registerDate || "";
    document.getElementById('edit-mode-actions').style.display = 'block'; 
    document.getElementById('view-attendance-btn').style.display = 'inline-block';
    openModal('register-modal');
}
window.handleStudentSave = async function() {
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
    
    const localData = {
        name,
        grade,
        studentPhone: sPhone,
        parentPhone: pPhone,
        defaultFee: defaultFee ? parseInt(defaultFee.replace(/,/g, '')) : 0,
        specialLectureFee: specialLectureFee ? parseInt(specialLectureFee.replace(/,/g, '')) : 0,
        defaultTextbookFee: defaultTextbookFee ? parseInt(defaultTextbookFee.replace(/,/g, '')) : 0,
        memo,
        registerDate: regDate
    };
    const dbData = {
        name,
        grade,
        phone: sPhone,  // 학생 연락처
        parent_phone: pPhone,
        default_fee: localData.defaultFee,
        special_lecture_fee: localData.specialLectureFee,
        default_textbook_fee: localData.defaultTextbookFee,
        memo,
        register_date: regDate
    };
    // 기존 학생 정보에서 owner_user_id, teacher_id도 같이 넘김 (RLS 정책 대응)
    if (id) {
        const s = students.find(x => String(x.id) === String(id));
        if (s) {
            if (s.owner_user_id) dbData.owner_user_id = s.owner_user_id;
            if (s.teacher_id) dbData.teacher_id = s.teacher_id;
        }
    }
    
    try {
        if (id) {
            // 학생 수정
            console.log('학생 수정 중:', id, dbData);
            const updatedStudent = await updateStudent(id, dbData);
            
            if (updatedStudent) {
                // 메모리 업데이트
                const idx = students.findIndex(s => String(s.id) === String(id));
                if (idx > -1) {
                    students[idx] = { ...students[idx], ...localData };
                }
                console.log('학생 수정 완료:', updatedStudent);
            } else {
                throw new Error('학생 수정 실패');
            }
        } else {
            // 학생 추가
            console.log('학생 추가 중:', dbData);
            const addedStudent = await addStudent(dbData);
            
            if (addedStudent) {
                // Supabase에서 생성된 ID 사용
                const newStudentId = addedStudent.id;
                
                // 메모리에 추가
                students.push({ 
                    id: newStudentId, 
                    ...localData, 
                    status: addedStudent.status || 'active', 
                    events: [], 
                    attendance: {}, 
                    records: {}, 
                    payments: {} 
                });
                
                // 현재 선생님에게 학생 할당
                assignStudentToTeacher(newStudentId);
                
                // 선생님별 일정 데이터 초기화
                if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
                teacherScheduleData[currentTeacherId][newStudentId] = {};
                
                // currentTeacherStudents에도 즉시 추가 (일정 추가 시 바로 보이도록)
                currentTeacherStudents.push({
                    id: newStudentId,
                    ...localData,
                    status: addedStudent.status || 'active',
                    events: [],
                    attendance: {},
                    records: {},
                    payments: {}
                });
                
                console.log('학생 추가 완료:', addedStudent);
            } else {
                throw new Error('학생 추가 실패');
            }
        }
        
        // 로컬 저장소 동기화
        saveData();
        saveTeacherScheduleData();
        
        closeModal('register-modal');
        renderDrawerList();
        renderCalendar();
        
    } catch (error) {
        console.error('학생 저장 중 오류:', error);
        alert('학생 정보 저장에 실패했습니다: ' + error.message);
    }
}

// ============================================
// [수정됨] 수납 관리 기능 로직 (Master-Detail UI, 성능 개선)
// ============================================

window.openPaymentModal = function() {
    // 관리자 역할 확인
    const role = localStorage.getItem('current_teacher_role') || 'teacher';
    
    if (role !== 'admin') {
        alert('수납 관리는 관리자만 접근할 수 있습니다.');
        return;
    }
    
    openModal('payment-modal');
    currentPaymentDate = new Date(); 
    setPaymentFilter('all');
}

window.movePaymentMonth = function(offset) {
    // 날짜를 1일로 임시 설정 후 월 이동, 마지막에 일자를 조정
    const day = currentPaymentDate.getDate();
    currentPaymentDate.setDate(1);
    currentPaymentDate.setMonth(currentPaymentDate.getMonth() + offset);
    const lastDay = new Date(currentPaymentDate.getFullYear(), currentPaymentDate.getMonth() + 1, 0).getDate();
    currentPaymentDate.setDate(Math.min(day, lastDay));
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

    // allPaymentData가 없는 경우 기본값 설정
    if (!allPaymentData || !Array.isArray(allPaymentData)) {
        allPaymentData = [];
    }

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
                           oninput="formatNumberWithComma(this)"
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
        const textbook = { amount: studentMonthData.textbook?.amount ?? s.defaultTextbookFee ?? 0, date: studentMonthData.textbook?.date || '' };
        const special = { amount: studentMonthData.special?.amount ?? s.specialLectureFee ?? 0, date: studentMonthData.special?.date || '' };
        const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);
        const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);

        let status;
        if (totalDue === 0) status = 'no_charge';
        else if (totalPaid >= totalDue) status = 'paid';
        else if (totalPaid > 0) status = 'partial';
        else status = 'unpaid';

        return { summary: { totalPaid, totalDue, status } };
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
    const role = localStorage.getItem('current_teacher_role') || 'teacher';
    
    console.log('[updatePaymentMenuVisibility] role:', role, '버튼 존재:', !!btn);
    
    if (btn) {
        // admin만 수납관리 버튼 표시
        btn.style.display = role === 'admin' ? 'flex' : 'none';
        console.log('[updatePaymentMenuVisibility] 버튼 display 설정:', btn.style.display);
    }
}

// 선생님 관리 메뉴 버튼 가시성 업데이트
function updateTeacherMenuVisibility() {
    const btn = document.getElementById('teacher-menu-btn');
    if (btn) {
        // localStorage에서 현재 선택된 선생님의 역할 확인
        const role = localStorage.getItem('current_teacher_role') || 'teacher';
        
        console.log('[updateTeacherMenuVisibility] 선생님 메뉴 버튼 가시성 업데이트, role:', role);
        
        // admin만 선생님 관리 버튼 표시
        btn.style.display = role === 'admin' ? 'flex' : 'none';
        console.log('[updateTeacherMenuVisibility] 버튼 display:', btn.style.display);
    }
}

// 학생 관리 메뉴 버튼 가시성 업데이트
function updateStudentMenuVisibility() {
    const btn = document.querySelector('button[onclick="toggleStudentList(); closeFeaturePanel();"]');
    if (btn) {
        // localStorage에서 현재 선택된 선생님의 역할 확인
        const role = localStorage.getItem('current_teacher_role') || 'teacher';
        
        // teacher, admin 모두 학생 관리 버튼 표시
        btn.style.display = (role === 'teacher' || role === 'admin') ? 'flex' : 'none';
    }
}

// ============================================
// 선생님 관리 모달 함수
// ============================================

window.openTeacherModal = function() {
    // 관리자만 선생님 관리 가능
    const role = localStorage.getItem('current_teacher_role') || 'teacher';
    
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
        const role = storedRole || teacher.teacher_role || teacher.role || 'teacher';
        const roleText = role === 'admin' ? '관리자' : role === 'teacher' ? '선생님' : '직원';
        const roleColor = role === 'admin' ? '#ef4444' : role === 'teacher' ? '#3b82f6' : '#8b5cf6';
        
        return `
        <div style="background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1; cursor: pointer;" onclick="openTeacherDetail('${teacher.id}')">
                <div style="font-weight: 600; font-size: 14px; color: #6366f1;">${teacher.name}</div>
                <div style="font-size: 12px; color: var(--gray);">${teacher.phone || '연락처 없음'}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <select id="role-${teacher.id}" class="m-input" style="width: 100px; padding: 6px 8px; font-size: 12px;" onchange="handleRoleChange('${teacher.id}', this.value)">
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>관리자</option>
                    <option value="teacher" ${role === 'teacher' ? 'selected' : ''}>선생님</option>
                    <option value="staff" ${role === 'staff' ? 'selected' : ''}>직원</option>
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
    updateTeacherRole(teacherId, newRole);
}

// 선생님 역할 업데이트
async function updateTeacherRole(teacherId, newRole) {
    try {
        const teacher = teacherList.find(t => t.id === teacherId);
        if (!teacher) return;
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) {
            alert('로그인이 필요합니다. 다시 로그인 해주세요.');
            return;
        }
        
        const { data, error } = await supabase
            .from('teachers')
            .update({ role: newRole, teacher_role: newRole })
            .eq('id', teacherId)
            .eq('owner_user_id', ownerId)
            .select('id, role, teacher_role');

        if (error) throw error;

        if (!data || data.length === 0) {
            console.warn('[updateTeacherRole] 업데이트 결과 없음. owner_user_id 불일치 가능');
        }

        // DB 업데이트 성공 시 로컬 데이터와 캐시 동기화
        teacher.role = newRole;
        teacher.teacher_role = newRole;
        localStorage.setItem('teacher_' + teacher.name + '_role', newRole);
        await loadTeachers();
        
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

// 일반 선생님/직원 비밀번호 인증

// 전화번호 자동 포맷팅
window.formatPhoneNumber = function(input) {
    // 숫자만 추출
    let value = input.value.replace(/[^0-9]/g, '');
    let formatted = '';
    
    if (value.length <= 3) {
        formatted = value;
    } else if (value.length <= 7) {
        formatted = value.slice(0, 3) + '-' + value.slice(3);
    } else if (value.length <= 11) {
        formatted = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7);
    } else {
        // 11자리 초과 시 자르기
        value = value.slice(0, 11);
        formatted = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7);
    }
    
    input.value = formatted;
}

// 금액 자동 쉼표 포맷팅
window.formatNumberWithComma = function(input) {
    // 숫자만 추출
    let value = input.value.replace(/[^0-9]/g, '');
    
    // 빈 값이면 그대로 반환
    if (!value) {
        input.value = '';
        return;
    }
    
    // 숫자를 쉼표로 포맷팅
    let formatted = parseInt(value).toLocaleString();
    input.value = formatted;
}

// 선생님 상세 정보 모달 열기
window.openTeacherDetail = function(teacherId) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return alert('선생님 정보를 찾을 수 없습니다.');
    
    // 모달에 현재 정보 채우기
    document.getElementById('detail-teacher-name').value = teacher.name;
    document.getElementById('detail-teacher-phone').value = teacher.phone || '';
    document.getElementById('detail-teacher-address').value = teacher.address || '';
    document.getElementById('detail-teacher-address-detail').value = teacher.address_detail || '';
    document.getElementById('detail-teacher-memo').value = teacher.memo || '';
    
    // teacherId를 모달에 저장 (저장 시 사용)
    document.getElementById('teacher-detail-modal').dataset.teacherId = teacherId;
    
    openModal('teacher-detail-modal');
}

// 상세 정보 모달용 주소 검색
window.searchAddressForDetail = function() {
    new daum.Postcode({
        oncomplete: function(data) {
            let addr = '';
            if (data.userSelectedType === 'R') {
                addr = data.roadAddress;
            } else {
                addr = data.jibunAddress;
            }
            document.getElementById('detail-teacher-address').value = addr;
            document.getElementById('detail-teacher-address-detail').focus();
        }
    }).open();
}

// 선생님 상세 정보 저장
window.saveTeacherDetail = async function() {
    try {
        const modal = document.getElementById('teacher-detail-modal');
        const teacherId = modal.dataset.teacherId;
        
        if (!teacherId) return alert('선생님 정보를 찾을 수 없습니다.');
        
        const phone = document.getElementById('detail-teacher-phone').value.trim();
        const address = document.getElementById('detail-teacher-address').value.trim();
        const addressDetail = document.getElementById('detail-teacher-address-detail').value.trim();
        const memo = document.getElementById('detail-teacher-memo').value.trim();
        
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) {
            alert('로그인이 필요합니다.');
            return;
        }
        
        const { error } = await supabase
            .from('teachers')
            .update({
                phone: phone || null,
                address: address || null,
                address_detail: addressDetail || null,
                memo: memo || null
            })
            .eq('id', teacherId)
            .eq('owner_user_id', ownerId);
        
        if (error) throw error;
        
        alert('선생님 정보가 저장되었습니다.');
        
        // 선생님 목록 새로고침
        await loadTeachers();
        renderTeacherListModal();
        closeModal('teacher-detail-modal');
    } catch (error) {
        console.error('[saveTeacherDetail] 에러:', error);
        alert('저장 실패: ' + error.message);
    }
}

// 주소 검색 기능
window.searchAddress = function() {
    new daum.Postcode({
        oncomplete: function(data) {
            // 선택한 주소를 입력 필드에 설정
            let addr = ''; // 최종 주소
            
            // 도로명 주소 또는 지번 주소 선택
            if (data.userSelectedType === 'R') { // 도로명
                addr = data.roadAddress;
            } else { // 지번
                addr = data.jibunAddress;
            }
            
            // 주소 필드에 값 설정
            document.getElementById('new-teacher-address').value = addr;
            
            // 상세주소 입력칸에 포커스
            document.getElementById('new-teacher-address-detail').focus();
        }
    }).open();
}
