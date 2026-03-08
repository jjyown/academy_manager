// ============================================
// 권한 관련 함수
// ============================================

function updateUserRoleLabel() {
    const role = localStorage.getItem('current_user_role') || 'teacher';
    const label = document.getElementById('current-user-role-label');
    if (label) {
        if (role === 'admin') label.textContent = '관리자';
        else if (role === 'teacher') label.textContent = '선생님';
        else if (role === 'staff') label.textContent = '직원';
    }
}

function updatePaymentMenuVisibility() {
    const btn = document.getElementById('payment-menu-btn');
    const role = getCurrentTeacherRole();
    if (btn) btn.style.display = role === 'admin' ? 'flex' : 'none';
}

function updateTeacherMenuVisibility() {
    const btn = document.getElementById('teacher-menu-btn');
    if (btn) {
        const role = getCurrentTeacherRole();
        btn.style.display = role === 'admin' ? 'flex' : 'none';
    }
}

function updateForceResetMenuVisibility() {
    const btn = document.getElementById('force-reset-menu-btn');
    if (btn) {
        const role = getCurrentTeacherRole();
        btn.style.display = role === 'admin' ? 'flex' : 'none';
    }
}

function updateStudentMenuVisibility() {
    const btn = document.querySelector('button[onclick="toggleStudentList(); closeFeaturePanel();"]');
    if (btn) {
        const role = getCurrentTeacherRole();
        btn.style.display = (role === 'teacher' || role === 'admin') ? 'flex' : 'none';
    }
}

// ============================================
// 선생님 관리 모달 함수
// ============================================

window.openTeacherModal = async function() {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('관리자만 선생님을 관리할 수 있습니다.', 'warning');
        return;
    }
    const modal = document.getElementById('teacher-modal');
    if (!modal) { console.error('teacher-modal 요소를 찾을 수 없습니다'); return; }
    modal.style.display = 'flex';
    await loadTeachers();
    renderTeacherListModal();
}

window.renderTeacherListModal = function() {
    const container = document.getElementById('teacher-list-container');
    if (!container || !teacherList || teacherList.length === 0) {
        if (container) container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--gray);">등록된 선생님이 없습니다.</div>';
        return;
    }
    container.innerHTML = teacherList.map(teacher => {
        const role = teacher.teacher_role || 'teacher';
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
        </div>`;
    }).join('');
}

window.selectTeacherFromModal = async function(teacherId) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) { showToast('선생님 정보를 찾을 수 없습니다.', 'error'); return; }
    await setCurrentTeacher(teacher);
    closeModal('teacher-modal');
}

window.deleteTeacherFromModal = async function(teacherId) {
    const teacher = teacherList.find(t => t.id === teacherId);
    const name = teacher ? teacher.name : '선생님';
    if (!(await showConfirm(`${name}을(를) 삭제하시겠습니까?`, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }
    const { error } = await supabase.from('teachers').delete().eq('id', teacherId).eq('owner_user_id', ownerId);
    if (error) { showToast('삭제 실패: ' + error.message, 'error'); return; }
    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        removeTabValue('current_teacher_id');
        removeTabValue('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) { teacherPage.style.display = 'flex'; teacherPage.style.visibility = 'visible'; }
    }
    showToast('선생님이 삭제되었습니다.', 'success');
    await loadTeachers();
    renderTeacherListModal();
}

window.handleRoleChange = async function(teacherId, newRole) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return;
    if (newRole === 'admin') { openAdminVerifyModal(teacherId, newRole); return; }
    const currentRole = teacher.teacher_role || 'teacher';
    if (currentRole === 'admin' && newRole !== 'admin') {
        if (!(await showConfirm(`${teacher.name}의 관리자 권한을 해제하시겠습니까?`, { type: 'warn', title: '권한 변경' }))) {
            renderTeacherListModal();
            return;
        }
    }
    updateTeacherRole(teacherId, newRole);
}

window.openAdminVerifyModal = function(teacherId, newRole) {
    const modal = document.getElementById('admin-verify-modal');
    if (!modal) return;
    document.getElementById('admin-verify-teacher-id').value = teacherId;
    document.getElementById('admin-verify-new-role').value = newRole;
    document.getElementById('admin-verify-email').value = '';
    document.getElementById('admin-verify-password').value = '';
    modal.style.display = 'flex';
}

window.closeAdminVerifyModal = function() {
    const modal = document.getElementById('admin-verify-modal');
    if (modal) modal.style.display = 'none';
    renderTeacherListModal();
}

window.confirmAdminVerifyAndChangeRole = async function() {
    const email = (document.getElementById('admin-verify-email')?.value || '').trim();
    const password = (document.getElementById('admin-verify-password')?.value || '').trim();
    const teacherId = document.getElementById('admin-verify-teacher-id')?.value || '';
    const newRole = document.getElementById('admin-verify-new-role')?.value || '';
    if (!email) { showToast('관리자 이메일을 입력해주세요.', 'warning'); return; }
    if (!password) { showToast('관리자 비밀번호를 입력해주세요.', 'warning'); return; }
    if (!teacherId || !newRole) { showToast('선생님 정보가 없습니다.', 'warning'); return; }
    try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { showToast('관리자 인증 실패: 이메일 또는 비밀번호가 올바르지 않습니다.', 'error'); return; }
        const modal = document.getElementById('admin-verify-modal');
        if (modal) modal.style.display = 'none';
        await updateTeacherRole(teacherId, newRole);
    } catch (err) {
        showToast('인증 오류: ' + (err.message || err), 'error');
    }
}

async function updateTeacherRole(teacherId, newRole) {
    try {
        const teacher = teacherList.find(t => t.id === teacherId);
        if (!teacher) return;
        const ownerId = cachedLsGet('current_owner_id');
        if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }
        const { data, error } = await supabase
            .from('teachers').update({ teacher_role: newRole })
            .eq('id', teacherId).eq('owner_user_id', ownerId).select('id, teacher_role');
        if (error) throw error;
        teacher.teacher_role = newRole;
        await loadTeachers();
        showToast('역할이 변경되었습니다.', 'success');
        renderTeacherListModal();
    } catch (error) {
        showToast('역할 변경 실패: ' + error.message, 'error');
        renderTeacherListModal();
    }
}

// ============================================
// 포맷터 유틸리티
// ============================================

window.formatPhoneNumber = function(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    let formatted = '';
    if (value.length <= 3) formatted = value;
    else if (value.length <= 7) formatted = value.slice(0, 3) + '-' + value.slice(3);
    else {
        if (value.length > 11) value = value.slice(0, 11);
        formatted = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7);
    }
    input.value = formatted;
}

window.formatNumberWithComma = function(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (!value) { input.value = ''; return; }
    input.value = parseInt(value).toLocaleString();
}

// ============================================
// 선생님 상세 정보
// ============================================

window.openTeacherDetail = function(teacherId) {
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) { showToast('선생님 정보를 찾을 수 없습니다.', 'error'); return; }
    document.getElementById('detail-teacher-name').value = teacher.name;
    document.getElementById('detail-teacher-phone').value = teacher.phone || '';
    document.getElementById('detail-teacher-address').value = teacher.address || '';
    document.getElementById('detail-teacher-address-detail').value = teacher.address_detail || '';
    document.getElementById('detail-teacher-memo').value = teacher.memo || '';
    const emailDisplay = document.getElementById('detail-teacher-email-display');
    const emailText = document.getElementById('detail-teacher-email-text');
    const noEmail = document.getElementById('detail-teacher-no-email');
    const teacherEmail = teacher.google_email || teacher.email || '';
    if (teacherEmail) {
        if (emailDisplay) emailDisplay.style.display = 'block';
        if (emailText) emailText.textContent = teacherEmail;
        if (noEmail) noEmail.style.display = 'none';
    } else {
        if (emailDisplay) emailDisplay.style.display = 'none';
        if (noEmail) noEmail.style.display = 'block';
    }
    document.getElementById('teacher-detail-modal').dataset.teacherId = teacherId;
    openModal('teacher-detail-modal');
}

window.saveTeacherDetail = async function() {
    try {
        const modal = document.getElementById('teacher-detail-modal');
        const teacherId = modal.dataset.teacherId;
        if (!teacherId) { showToast('선생님 정보를 찾을 수 없습니다.', 'error'); return; }
        const name = document.getElementById('detail-teacher-name').value.trim();
        const phone = document.getElementById('detail-teacher-phone').value.trim();
        const address = document.getElementById('detail-teacher-address').value.trim();
        const addressDetail = document.getElementById('detail-teacher-address-detail').value.trim();
        const memo = document.getElementById('detail-teacher-memo').value.trim();
        if (!name) { showToast('이름을 입력하세요.', 'warning'); return; }
        const ownerId = cachedLsGet('current_owner_id');
        if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }
        const { error } = await supabase.from('teachers').update({
            name, phone: phone || null, address: address || null,
            address_detail: addressDetail || null, memo: memo || null
        }).eq('id', teacherId).eq('owner_user_id', ownerId);
        if (error) throw error;
        showToast('선생님 정보가 저장되었습니다.', 'success');
        if (currentTeacher && String(currentTeacher.id) === String(teacherId)) {
            currentTeacher.name = name;
            currentTeacher.phone = phone;
            currentTeacher.address = address || null;
            currentTeacher.address_detail = addressDetail || null;
            currentTeacher.memo = memo || null;
            const label = document.getElementById('current-teacher-name');
            if (label) label.textContent = name;
            setTabValue('current_teacher_name', name);
        }
        await loadTeachers();
        renderTeacherListModal();
        closeModal('teacher-detail-modal');
    } catch (error) {
        showToast('저장 실패: ' + error.message, 'error');
    }
}

// ============================================
// 주소 검색 (통합) - 중복 제거
// ============================================

function searchAddressAndFill(addressInputId, detailInputId) {
    new daum.Postcode({
        oncomplete: function(data) {
            const addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
            document.getElementById(addressInputId).value = addr;
            document.getElementById(detailInputId).focus();
        }
    }).open();
}

window.searchAddressForDetail = function() {
    searchAddressAndFill('detail-teacher-address', 'detail-teacher-address-detail');
}

window.searchAddress = function() {
    searchAddressAndFill('new-teacher-address', 'new-teacher-address-detail');
}
