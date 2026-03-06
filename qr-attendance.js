// QR 출석 관리 시스템
console.log('[qr-attendance.js] 파일 로드 시작');

// QR 스캐너 인스턴스
let html5QrcodeScanner = null;
let currentStudentForAttendance = null;
let currentFacingMode = "environment"; // "environment" (후방) 또는 "user" (전방)
let qrClosePinCheckInProgress = false;
let qrCameraSwitchInProgress = false;
const ATTENDANCE_GRACE_MINUTES = 2;

function shouldUseDualPanelMode() {
    const w = window.innerWidth || 0;
    // 10인치 태블릿 가로/전체화면 사용을 우선 타겟팅
    return w >= 900 && w <= 1400;
}

function getCurrentTeacherForQrPinGuard() {
    const teacherId = String(
        currentTeacherId ||
        (typeof getCurrentTeacherId === 'function' ? getCurrentTeacherId() : '') ||
        sessionStorage.getItem('current_teacher_id') ||
        ''
    );
    if (!teacherId || !Array.isArray(teacherList)) return null;
    return teacherList.find((t) => String(t?.id) === teacherId) || null;
}

async function verifyTeacherPinForAction(options = {}) {
    const teacher = getCurrentTeacherForQrPinGuard();
    if (!teacher || !teacher.pin_hash) {
        showToast('선생님 인증 정보를 찾을 수 없습니다. 다시 로그인 후 시도해주세요.', 'warning');
        return false;
    }
    if (typeof hashPin !== 'function') {
        showToast('비밀번호 검증 기능을 불러오지 못했습니다.', 'error');
        return false;
    }

    const input = await window.showPrompt(options.message || '선생님 비밀번호를 입력해주세요.', {
        title: options.title || '선생님 인증',
        placeholder: options.placeholder || '선생님 비밀번호',
        inputType: 'password',
        okText: options.okText || '확인',
        cancelText: options.cancelText || '취소'
    });
    if (input === null) return false;

    const password = String(input || '').trim();
    if (!password) {
        showToast('비밀번호를 입력해주세요.', 'warning');
        return false;
    }

    const passwordHash = await hashPin(password);
    if (passwordHash !== teacher.pin_hash) {
        showToast('비밀번호가 일치하지 않습니다.', 'warning');
        return false;
    }
    return true;
}

async function verifyTeacherPinForQrClose() {
    return verifyTeacherPinForAction({
        message: '학생 출석 화면을 종료하려면 선생님 비밀번호를 입력해주세요.'
    });
}

async function verifyTeacherPinForCameraSwitch() {
    return verifyTeacherPinForAction({
        message: '카메라를 전환하려면 선생님 비밀번호를 입력해주세요.'
    });
}

// ========== 후속 수업 재석 확인 시스템 ==========
// 대기 큐: { timeKey: "HH:MM", items: [{ studentId, studentName, teacherId, teacherName, scheduleStart, dateStr }] }
const pendingAttendanceChecks = new Map();
// 활성 타이머 ID 목록
const pendingTimers = new Map();

// 재석 확인 대기 큐에 등록
function registerPendingAttendanceCheck(studentId, studentName, teacherId, scheduleStart, dateStr) {
    const timeKey = scheduleStart; // "HH:MM"
    if (!pendingAttendanceChecks.has(timeKey)) {
        pendingAttendanceChecks.set(timeKey, []);
    }
    // 중복 등록 방지
    const existing = pendingAttendanceChecks.get(timeKey);
    if (existing.find(item => String(item.studentId) === String(studentId) && String(item.teacherId) === String(teacherId))) {
        return;
    }
    const teacherName = (typeof getTeacherNameById === 'function') ? getTeacherNameById(teacherId) : teacherId;
    existing.push({ studentId, studentName, teacherId, teacherName, scheduleStart, dateStr });
    console.log(`[재석확인] 등록: ${studentName} - ${scheduleStart} (${teacherName})`);
    
    // 타이머 설정 (수업 시작 5분 전에 알림)
    if (!pendingTimers.has(timeKey)) {
        const now = new Date();
        const [h, m] = scheduleStart.split(':').map(Number);
        const targetTime = new Date();
        targetTime.setHours(h, m, 0, 0);
        
        // ★ 5분 전에 알림 (300000ms = 5분)
        const EARLY_ALERT_MS = 5 * 60 * 1000;
        const delay = targetTime.getTime() - EARLY_ALERT_MS - now.getTime();
        if (delay > 0) {
            const timerId = setTimeout(() => {
                showAttendanceCheckNotification(timeKey);
                pendingTimers.delete(timeKey);
            }, delay);
            pendingTimers.set(timeKey, timerId);
            const delayMin = Math.round(delay / 60000);
            console.log(`[재석확인] 타이머 설정: ${scheduleStart} (${delayMin}분 후, 수업 5분 전 알림)`);
        } else if (targetTime.getTime() - now.getTime() > 0) {
            // 5분 전은 이미 지났지만 수업 시작 전이면 즉시 알림
            setTimeout(() => {
                showAttendanceCheckNotification(timeKey);
            }, 1000);
        } else {
            // 수업 시작도 이미 지났으면 즉시 알림
            setTimeout(() => {
                showAttendanceCheckNotification(timeKey);
            }, 1000);
        }
    }
}

// 재석 확인 알림 표시 (배치: 같은 시간의 학생들을 하나의 모달에)
// ★ 체크박스 선택 + 상태 버튼 방식
function showAttendanceCheckNotification(timeKey) {
    const items = pendingAttendanceChecks.get(timeKey);
    if (!items || items.length === 0) {
        pendingAttendanceChecks.delete(timeKey);
        return;
    }

    // 일정 변경/삭제 후에도 남아있는 재석확인 큐를 정리 (오탐 팝업 방지)
    const todayStr = (typeof getTodayStr === 'function') ? getTodayStr() : formatDateToYYYYMMDD(new Date());
    const isStillScheduled = (item) => {
        if (!item || !item.dateStr || !item.scheduleStart) return false;
        if (String(item.dateStr) !== String(todayStr)) return false;

        try {
            if (typeof getScheduleEntries === 'function') {
                const entries = getScheduleEntries(String(item.teacherId), String(item.studentId), String(item.dateStr)) || [];
                return entries.some((entry) => String(entry?.start || '') === String(item.scheduleStart));
            }
        } catch (e) {
            console.error('[재석확인] getScheduleEntries 검증 실패:', e);
        }

        const teacherSchedule = (teacherScheduleData || {})[String(item.teacherId)] || {};
        const studentSchedule = teacherSchedule[String(item.studentId)] || {};
        const rawData = studentSchedule[String(item.dateStr)];
        if (!rawData) return false;
        const entries = Array.isArray(rawData) ? rawData : [rawData];
        return entries.some((entry) => String(entry?.start || '') === String(item.scheduleStart));
    };

    const validItems = items.filter((item) => item && !item._done && isStillScheduled(item));
    if (validItems.length !== items.length) {
        pendingAttendanceChecks.set(timeKey, validItems);
    }
    if (validItems.length === 0) {
        pendingAttendanceChecks.delete(timeKey);
        return;
    }
    
    // ★ QR 스캔 페이지가 열려있으면 대기열에 보관 (스캔 종료 후 일괄 표시)
    const scanPage = document.getElementById('qr-scan-page');
    if (scanPage && scanPage.style.display && scanPage.style.display !== 'none') {
        if (!window._qrDeferredNotifications) window._qrDeferredNotifications = [];
        if (!window._qrDeferredNotifications.includes(timeKey)) {
            window._qrDeferredNotifications.push(timeKey);
        }
        console.log('[재석확인] QR 스캔 중 - 대기열 보관:', timeKey);
        return;
    }
    
    // ★ 현재 선생님의 항목만 필터링
    const myItems = validItems.filter(item => String(item.teacherId) === String(currentTeacherId));
    if (myItems.length === 0) return;
    
    const modal = document.getElementById('attendance-check-modal');
    if (!modal) return;
    
    const subtitle = document.getElementById('attendance-check-subtitle');
    const listDiv = document.getElementById('attendance-check-list');
    const selectAllCb = document.getElementById('att-check-select-all');
    if (!subtitle || !listDiv) return;
    
    const timeLabel = (typeof formatKoreanTimeLabel === 'function') ? formatKoreanTimeLabel(timeKey) : timeKey;
    subtitle.textContent = `${timeLabel} 수업 시작 5분 전 - ${myItems.length}명 확인 필요`;
    
    let html = '';
    myItems.forEach((item) => {
        const originalIdx = validItems.indexOf(item);
        html += `<label class="att-check-item" data-check-idx="${originalIdx}" data-check-time="${timeKey}">
                <input type="checkbox" class="att-check-cb" data-idx="${originalIdx}" data-time="${timeKey}" onchange="updateAttCheckCount()">
                <div class="att-check-item-info">
                    <div class="att-check-item-name">${item.studentName}</div>
                    <div class="att-check-item-time">${timeLabel} 수업</div>
                </div>
            </label>`;
    });
    
    listDiv.innerHTML = html;
    if (selectAllCb) selectAllCb.checked = false;
    updateAttCheckCount();
    modal.style.display = 'flex';
}

// 체크박스 전체 선택/해제
window.toggleAllAttCheck = function(checked) {
    document.querySelectorAll('.att-check-cb').forEach(cb => {
        if (!cb.closest('.att-check-item.done')) cb.checked = checked;
    });
    updateAttCheckCount();
};

// 선택 카운트 업데이트
window.updateAttCheckCount = function() {
    const total = document.querySelectorAll('.att-check-cb').length;
    const checked = document.querySelectorAll('.att-check-cb:checked').length;
    const countEl = document.getElementById('att-check-count');
    if (countEl) countEl.textContent = `${checked}/${total}명 선택`;
    // 전체 선택 체크박스 동기화
    const selectAll = document.getElementById('att-check-select-all');
    if (selectAll) selectAll.checked = (checked === total && total > 0);
};

// 개별 학생 재석 확인 처리 (내부용)
async function _processAttendanceCheck(timeKey, idx, status) {
    const items = pendingAttendanceChecks.get(timeKey);
    if (!items || !items[idx]) return;
    
    const item = items[idx];
    if (item._done) return;
    
    try {
        const existing = (typeof getAttendanceRecordByStudentAndDate === 'function')
            ? await getAttendanceRecordByStudentAndDate(item.studentId, item.dateStr, item.teacherId, item.scheduleStart)
            : null;
        
        const judgmentMap = { present: '재석 확인', late: '지각 확인', absent: '부재 확인', makeup: '보강 처리' };
        await saveAttendanceRecord({
            studentId: item.studentId,
            teacherId: String(item.teacherId),
            attendanceDate: item.dateStr,
            checkInTime: existing?.check_in_time || new Date().toISOString(),
            scheduledTime: item.scheduleStart,
            status: status,
            qrScanned: existing?.qr_scanned || false,
            qrScanTime: existing?.qr_scan_time || null,
            qrJudgment: judgmentMap[status] || status,
            attendance_source: existing?.attendance_source || 'teacher',
            authTime: existing?.auth_time || existing?.qr_scan_time || existing?.check_in_time || null,
            presenceChecked: true,
            processedAt: new Date().toISOString(),
            memo: existing?.memo || null
        });
        
        // 로컬 메모리 업데이트
        const student = students.find(s => String(s.id) === String(item.studentId));
        if (student) {
            if (!student.attendance) student.attendance = {};
            if (typeof student.attendance[item.dateStr] === 'string') {
                const prev = student.attendance[item.dateStr];
                student.attendance[item.dateStr] = {};
                student.attendance[item.dateStr]['default'] = prev;
            }
            if (!student.attendance[item.dateStr] || typeof student.attendance[item.dateStr] !== 'object') student.attendance[item.dateStr] = {};
            student.attendance[item.dateStr][item.scheduleStart] = status;
        }
        
        // UI 업데이트 - 처리 완료 표시
        const row = document.querySelector(`[data-check-idx="${idx}"][data-check-time="${timeKey}"]`);
        if (row) {
            const statusMap = {
                present: { label: '출석', color: '#10b981', bg: '#dcfce7' },
                late:    { label: '지각', color: '#f59e0b', bg: '#fef9c3' },
                absent:  { label: '결석', color: '#ef4444', bg: '#fef2f2' },
                makeup:  { label: '보강', color: '#8b5cf6', bg: '#f5f3ff' }
            };
            const s = statusMap[status] || statusMap.present;
            row.style.background = s.bg;
            row.style.borderColor = s.color;
            row.classList.add('done');
            // 체크박스를 배지로 교체
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb) cb.style.display = 'none';
            const badge = document.createElement('span');
            badge.className = 'att-check-item-badge';
            badge.style.background = s.color;
            badge.textContent = s.label;
            row.insertBefore(badge, row.querySelector('.att-check-item-info'));
        }
        
        item._done = true;
        console.log(`[재석확인] ${item.studentName} → ${status} 처리 완료`);
        
        // ★ 출석 기록 모달이 열려있으면 갱신
        const histModal = document.getElementById('student-attendance-history-modal');
        if (histModal && histModal.style.display === 'flex' && typeof window.loadStudentAttendanceHistory === 'function') {
            try { await window.loadStudentAttendanceHistory(); } catch (_) {}
        }
    } catch (e) {
        console.error('[재석확인] 저장 실패:', e);
        showToast(`${item.studentName} 출결 저장에 실패했습니다.`, 'error');
    }
}

// ★ 선택된 학생들을 일괄 처리
window.handleAttendanceCheckSelected = async function(status) {
    const checkedBoxes = document.querySelectorAll('.att-check-cb:checked');
    if (checkedBoxes.length === 0) {
        showToast('처리할 학생을 선택해주세요.', 'warning');
        return;
    }
    
    const statusLabel = { present: '출석', late: '지각', absent: '결석', makeup: '보강' };
    
    for (const cb of checkedBoxes) {
        const timeKey = cb.dataset.time;
        const idx = parseInt(cb.dataset.idx);
        await _processAttendanceCheck(timeKey, idx, status);
    }
    
    updateAttCheckCount();
    showToast(`${checkedBoxes.length}명 ${statusLabel[status]} 처리 완료`, 'success');

    // 현재 처리한 timeKey + 현재 선생님 기준으로 완료 여부 판단
    // (다른 선생님/다른 시간대 대기건 때문에 모달이 안 닫히는 문제 방지)
    const touchedKeys = new Set();
    checkedBoxes.forEach((cb) => {
        if (cb.dataset.time) touchedKeys.add(cb.dataset.time);
    });

    let allTouchedKeysDoneForCurrentTeacher = true;
    touchedKeys.forEach((timeKey) => {
        const keyItems = pendingAttendanceChecks.get(timeKey) || [];
        const remainingMine = keyItems.filter(
            (i) => String(i.teacherId) === String(currentTeacherId) && !i._done
        );
        if (remainingMine.length > 0) {
            allTouchedKeysDoneForCurrentTeacher = false;
        }
    });

    // 큐 상태와 DOM 렌더 상태가 일시적으로 어긋나는 경우를 위한 UI 기준 보조 판정
    const hasUncheckedVisible = !!document.querySelector('#attendance-check-list .att-check-cb:not(:checked)');

    if (allTouchedKeysDoneForCurrentTeacher || !hasUncheckedVisible) {
        setTimeout(() => {
            closeModal('attendance-check-modal');

            // 현재 선생님이 처리 완료한 항목만 큐에서 제거(타 선생님 대기건은 유지)
            touchedKeys.forEach((timeKey) => {
                const keyItems = pendingAttendanceChecks.get(timeKey) || [];
                const nextItems = keyItems.filter(
                    (i) => !(String(i.teacherId) === String(currentTeacherId) && i._done)
                );
                if (nextItems.length === 0) {
                    pendingAttendanceChecks.delete(timeKey);
                    if (snoozeTimers.has(timeKey)) {
                        clearTimeout(snoozeTimers.get(timeKey));
                        snoozeTimers.delete(timeKey);
                    }
                } else {
                    pendingAttendanceChecks.set(timeKey, nextItems);
                }
            });

            saveData();
            renderCalendar();
        }, 500);
    }
};

// 레거시 호환: handleSingleAttendanceCheck (다른 곳에서 호출할 수 있음)
window.handleSingleAttendanceCheck = async function(timeKey, idx, status) {
    await _processAttendanceCheck(timeKey, idx, status);
    const items = pendingAttendanceChecks.get(timeKey);
    const remainingMine = (items || []).filter(
        (i) => String(i.teacherId) === String(currentTeacherId) && !i._done
    );
    if (remainingMine.length === 0) {
        setTimeout(() => {
            closeModal('attendance-check-modal');
            const keyItems = pendingAttendanceChecks.get(timeKey) || [];
            const nextItems = keyItems.filter(
                (i) => !(String(i.teacherId) === String(currentTeacherId) && i._done)
            );
            if (nextItems.length === 0) {
                pendingAttendanceChecks.delete(timeKey);
                // 스누즈 타이머도 정리
                if (snoozeTimers.has(timeKey)) {
                    clearTimeout(snoozeTimers.get(timeKey));
                    snoozeTimers.delete(timeKey);
                }
            } else {
                pendingAttendanceChecks.set(timeKey, nextItems);
            }
            saveData();
            renderCalendar();
        }, 500);
    }
};

// 레거시 호환: handleAttendanceCheckAll
window.handleAttendanceCheckAll = async function(status) {
    // 전체 선택 후 처리
    document.querySelectorAll('.att-check-cb').forEach(cb => { if (!cb.closest('.done')) cb.checked = true; });
    await handleAttendanceCheckSelected(status);
};

// ★ 재석 확인 스누즈 (5분 후 재알림)
const SNOOZE_INTERVAL_MS = 5 * 60 * 1000; // 5분
const snoozeTimers = new Map();

window.snoozeAttendanceCheck = function() {
    // 아직 처리되지 않은 항목이 있는 timeKey들을 수집
    const pendingKeys = [];
    for (const [key, items] of pendingAttendanceChecks.entries()) {
        const remaining = items.filter(i => !i._done);
        if (remaining.length > 0) pendingKeys.push(key);
    }

    // 모달 닫기
    closeModal('attendance-check-modal');

    if (pendingKeys.length === 0) return;

    // 5분 후 재알림 타이머 설정
    pendingKeys.forEach(timeKey => {
        // 기존 스누즈 타이머가 있으면 제거
        if (snoozeTimers.has(timeKey)) {
            clearTimeout(snoozeTimers.get(timeKey));
        }

        const timerId = setTimeout(() => {
            snoozeTimers.delete(timeKey);
            const items = pendingAttendanceChecks.get(timeKey);
            if (items && items.some(i => !i._done)) {
                console.log(`[재석확인] 스누즈 재알림: ${timeKey}`);
                showAttendanceCheckNotification(timeKey);
            }
        }, SNOOZE_INTERVAL_MS);

        snoozeTimers.set(timeKey, timerId);
        console.log(`[재석확인] 스누즈 설정: ${timeKey} → 5분 후 재알림`);
    });

    showToast('5분 후에 다시 알려드릴게요', 'info');
};

// ========== 미스캔 학생 자동 알림 시스템 ==========
// 오늘 일정 중 수업 시간이 되었는데 출결 기록이 없는 학생 감지

// 이미 알림을 보낸 시간 기록 (중복 알림 방지)
const missedScanAlerted = new Set();
// 미스캔 체크 타이머 목록
const missedScanTimers = new Map();

// 오늘의 모든 일정에 대해 미스캔 타이머 설정
window.initMissedScanChecks = function() {
    // 기존 타이머 정리
    for (const [key, timerId] of missedScanTimers.entries()) {
        clearTimeout(timerId);
    }
    missedScanTimers.clear();
    
    if (typeof teacherScheduleData === 'undefined') return;
    
    const now = new Date();
    const todayStr = formatDateToYYYYMMDD(now);
    
    let timerCount = 0;
    
    // ★ 모든 선생님의 일정을 체크 (현재 선생님뿐 아니라 전체)
    for (const teacherId in teacherScheduleData) {
        const teacherSchedule = teacherScheduleData[teacherId] || {};
        
        for (const studentId in teacherSchedule) {
            const studentSchedule = teacherSchedule[studentId] || {};
            const rawData = studentSchedule[todayStr];
            if (!rawData) continue;
            
            // ★ 배열 또는 단일 객체 모두 처리
            const entries = Array.isArray(rawData) ? rawData : [rawData];
            
            for (const classInfo of entries) {
                if (!classInfo || !classInfo.start || classInfo.start === 'default') continue;
                
                const [h, m] = classInfo.start.split(':').map(Number);
                if (isNaN(h) || isNaN(m)) continue;
                
                const scheduleTime = new Date(now);
                scheduleTime.setHours(h, m, 0, 0);
                
                // ★ 5분 전에 확인 (수업 시작 5분 전에 체크)
                const EARLY_CHECK_MS = 5 * 60 * 1000;
                const delay = scheduleTime.getTime() - EARLY_CHECK_MS - now.getTime();
                const timerKey = `${studentId}_${classInfo.start}_${teacherId}`;
                
                if (delay <= 0) {
                    const alertKey = `${studentId}_${classInfo.start}_${todayStr}_${teacherId}`;
                    if (!missedScanAlerted.has(alertKey)) {
                        setTimeout(() => checkMissedScan(studentId, classInfo.start, todayStr, teacherId), 1000);
                    }
                } else {
                    if (!missedScanTimers.has(timerKey)) {
                        const timerId = setTimeout(() => {
                            checkMissedScan(studentId, classInfo.start, todayStr, teacherId);
                            missedScanTimers.delete(timerKey);
                        }, delay);
                        missedScanTimers.set(timerKey, timerId);
                        timerCount++;
                    }
                }
            }
        }
    }
    
    if (timerCount > 0) {
        console.log(`[미스캔체크] 오늘 ${timerCount}개 수업에 대해 미스캔 타이머 설정 완료`);
    }
};

// 특정 학생/시간의 미스캔 여부 확인
async function checkMissedScan(studentId, scheduleStart, dateStr, teacherId) {
    const effectiveTeacherId = teacherId || currentTeacherId;
    const alertKey = `${studentId}_${scheduleStart}_${dateStr}_${effectiveTeacherId}`;
    if (missedScanAlerted.has(alertKey)) return;
    
    // ★ 현재 선생님의 일정만 알림 표시
    if (String(effectiveTeacherId) !== String(currentTeacherId)) return;
    
    // DB에서 해당 시간의 출결 기록 확인
    try {
        const record = await getAttendanceRecordByStudentAndDate(
            studentId, dateStr, effectiveTeacherId, scheduleStart
        );
        
        if (record) {
            console.log(`[미스캔체크] ${studentId} ${scheduleStart} - 기록 있음 (${record.status})`);
            return;
        }
        
        // 로컬 메모리에서도 확인
        const student = students.find(s => String(s.id) === String(studentId));
        if (student && student.attendance && student.attendance[dateStr]) {
            const att = student.attendance[dateStr];
            if (typeof att === 'object' && att[scheduleStart]) return;
        }
        
        // 출결 기록 없음 → 재석 확인 대기 큐에 등록
        const studentName = student ? student.name : `학생${studentId}`;
        missedScanAlerted.add(alertKey);
        
        registerPendingAttendanceCheck(
            studentId,
            studentName,
            effectiveTeacherId,
            scheduleStart,
            dateStr
        );
        console.log(`[미스캔체크] ⚠️ ${studentName} ${scheduleStart} 수업 - 재석 확인 알림`);
        
    } catch (e) {
        console.error('[미스캔체크] 확인 실패:', e);
    }
}

// ========== QR 코드 생성 ==========

// 학생별 고유 QR 코드 데이터 생성
// QR코드 재발급 시마다 고유 토큰을 생성하여 로컬에 저장
window.generateQRCodeData = async function(studentId) {
    // 고유 토큰 생성 (랜덤+시간)
    const qrToken = `${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
    // 학생별 토큰 저장 (로컬)
    let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
    qrTokens[studentId] = qrToken;
    localStorage.setItem('student_qr_tokens', JSON.stringify(qrTokens));
    // ✅ 재발급 토큰을 DB에도 동기화 (기기 간 일관성 확보) - await로 완료 대기
    try {
        await updateStudentQrTokenInDb(studentId, qrToken);
        console.log('[generateQRCodeData] QR 토큰 생성 및 DB 저장 완료:', studentId, qrToken);
    } catch (dbError) {
        console.error('[generateQRCodeData] DB 저장 실패 (로컬 토큰만 사용):', dbError);
    }
    return `STUDENT_${studentId}_${qrToken}`;
}

// 기존 토큰을 우선 사용하고, 없을 때만 신규 발급
async function getOrCreateQRCodeData(studentId) {
    const studentKey = String(studentId);
    let dbToken = null;

    try {
        dbToken = await getStudentQrTokenFromDb(studentId);
    } catch (e) {
        console.error('[getOrCreateQRCodeData] DB 토큰 조회 실패:', e);
    }

    if (dbToken) {
        try {
            const qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
            if (qrTokens[studentKey] !== dbToken) {
                qrTokens[studentKey] = dbToken;
                localStorage.setItem('student_qr_tokens', JSON.stringify(qrTokens));
            }
        } catch (e) {
            console.error('[getOrCreateQRCodeData] 로컬 토큰 동기화 실패:', e);
        }
        return `STUDENT_${studentId}_${dbToken}`;
    }

    let localToken = null;
    try {
        const qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
        localToken = qrTokens[studentKey] || null;
    } catch (e) {
        console.error('[getOrCreateQRCodeData] 로컬 토큰 조회 실패:', e);
    }

    if (localToken) {
        try {
            await updateStudentQrTokenInDb(studentId, localToken);
        } catch (e) {
            console.error('[getOrCreateQRCodeData] DB 토큰 동기화 실패:', e);
        }
        return `STUDENT_${studentId}_${localToken}`;
    }

    return await generateQRCodeData(studentId);
}

// 학생 QR 토큰을 DB에 저장 (기기 간 동기화)
async function updateStudentQrTokenInDb(studentId, qrToken) {
    try {
        if (typeof supabase === 'undefined') {
            console.error('[updateStudentQrTokenInDb] Supabase 미정의');
            throw new Error('Supabase 연결 없음');
        }
        // studentId 타입 변환 확인 (문자열/숫자 혼용 방지)
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) {
            console.error('[updateStudentQrTokenInDb] 잘못된 학생 ID:', studentId);
            throw new Error('Invalid student ID');
        }
        console.log('[updateStudentQrTokenInDb] 업데이트 시도:', { id: numericId, token: qrToken.substring(0, 20) + '...' });
        
        const { data, error } = await supabase
            .from('students')
            .update({ qr_code_data: qrToken })
            .eq('id', numericId)
            .select('id, qr_code_data')
            .single();
        
        if (error) {
            console.error('[updateStudentQrTokenInDb] 업데이트 실패:', error);
            throw error;
        }
        
        if (!data) {
            console.error('[updateStudentQrTokenInDb] ⚠️ 업데이트된 행이 없음! ID:', numericId);
            throw new Error('No rows updated');
        }
        
        console.log('[updateStudentQrTokenInDb] ✅ DB 토큰 업데이트 완료:', studentId);
        return data;
    } catch (e) {
        console.error('[updateStudentQrTokenInDb] 예외:', e);
        throw e;
    }
}

// 학생 QR 토큰을 DB에서 조회
async function getStudentQrTokenFromDb(studentId) {
    try {
        if (typeof supabase === 'undefined') {
            console.error('[getStudentQrTokenFromDb] Supabase 미정의');
            return null;
        }
        // studentId 타입 변환 확인
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) {
            console.error('[getStudentQrTokenFromDb] 잘못된 학생 ID:', studentId);
            return null;
        }
        
        console.log('[getStudentQrTokenFromDb] 조회 시작:', numericId);
        
        // 캐시 무효화를 위해 timestamp 추가 쿼리
        const { data, error } = await supabase
            .from('students')
            .select('id, qr_code_data')
            .eq('id', numericId)
            .maybeSingle();
        
        if (error) {
            console.error('[getStudentQrTokenFromDb] 조회 실패:', error);
            return null;
        }
        
        if (!data) {
            console.log('[getStudentQrTokenFromDb] ⚠️ 학생 데이터 없음, ID:', numericId);
            return null;
        }
        
        const token = data.qr_code_data || null;
        console.log('[getStudentQrTokenFromDb] DB 토큰 조회 완료:', studentId, '→', token ? token.substring(0, 20) + '...' : 'null');
        return token;
    } catch (e) {
        console.error('[getStudentQrTokenFromDb] 예외:', e);
        return null;
    }
}

// QR 코드 이미지 생성 (흰색 배경 명시)
window.generateQRCode = function(containerId, qrData, size = 200) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // 기존 QR 코드 제거
    container.innerHTML = '';
    
    // QRCode.js 라이브러리 사용 (흰색 배경 명시)
    new QRCode(container, {
        text: qrData,
        width: size,
        height: size,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
        quietZone: 40,
        quietZoneColor: "#ffffff"
    });
}

// ========== QR 스캔 보조 함수 ==========

// current_owner_id 보장 (모바일/태블릿 세션 복구)
async function ensureOwnerId() {
    let ownerId = localStorage.getItem('current_owner_id');
    if (ownerId) return ownerId;

    try {
        if (typeof supabase !== 'undefined' && supabase?.auth?.getSession) {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error) {
                console.error('[ensureOwnerId] 세션 확인 에러:', error);
            }
            if (session && session.user && session.user.id) {
                ownerId = session.user.id;
                localStorage.setItem('current_owner_id', ownerId);
                console.log('[ensureOwnerId] 세션에서 current_owner_id 복구:', ownerId);
                return ownerId;
            }
        }
    } catch (e) {
        console.error('[ensureOwnerId] 예외:', e);
    }

    // 세션이 없으면 currentTeacherId 사용
    if (typeof currentTeacherId !== 'undefined' && currentTeacherId) {
        console.log('[ensureOwnerId] currentTeacherId 사용:', currentTeacherId);
        return currentTeacherId;
    }

    console.warn('[ensureOwnerId] current_owner_id 및 currentTeacherId 없음');
    return null;
}

// 모든 선생님 일정 로드 (QR 스캔용)
async function loadAllSchedulesForOwner() {
    try {
        const ownerId = await ensureOwnerId();
        if (!ownerId) return false;
        if (typeof supabase === 'undefined') return false;

        const { data, error } = await supabase
            .from('schedules')
            .select('id, teacher_id, student_id, schedule_date, start_time, duration')
            .eq('owner_user_id', ownerId)
            .order('schedule_date', { ascending: true });

        if (error) {
            console.error('[loadAllSchedulesForOwner] 에러:', error);
            return false;
        }

        const next = {};
        (data || []).forEach(schedule => {
            const teacherId = String(schedule.teacher_id);
            const studentId = String(schedule.student_id);
            const date = schedule.schedule_date;

            if (!next[teacherId]) next[teacherId] = {};
            if (!next[teacherId][studentId]) next[teacherId][studentId] = {};

            const entry = {
                start: schedule.start_time ? schedule.start_time.substring(0, 5) : schedule.start_time,
                duration: schedule.duration
            };

            // ★ 배열 형식으로 저장 (같은 날 여러 일정 지원)
            const existing = next[teacherId][studentId][date];
            if (!existing) {
                next[teacherId][studentId][date] = [entry];
            } else {
                const arr = Array.isArray(existing) ? existing : [existing];
                const dupIdx = arr.findIndex(e => e.start === entry.start);
                if (dupIdx >= 0) {
                    arr[dupIdx] = entry;
                } else {
                    arr.push(entry);
                }
                next[teacherId][studentId][date] = arr;
            }
        });

        teacherScheduleData = next;

        // 로컬 캐시에도 저장
        Object.keys(teacherScheduleData).forEach(tid => {
            const key = `teacher_schedule_data__${tid}`;
            localStorage.setItem(key, JSON.stringify(teacherScheduleData[tid] || {}));
        });

        console.log('[loadAllSchedulesForOwner] 전체 일정 로드 완료:', (data || []).length, '건');
        return true;
    } catch (e) {
        console.error('[loadAllSchedulesForOwner] 예외:', e);
        return false;
    }
}

function getTodayScheduleSnapshotForTeacher(teacherId) {
    const dateStr = (typeof getTodayStr === 'function') ? getTodayStr() : formatDateToYYYYMMDD(new Date());
    const tid = String(teacherId || currentTeacherId || '');
    if (!tid) {
        return { dateStr, teacherId: '', activeCount: 0, scheduledStudentCount: 0, scheduledEntryCount: 0, missingStudents: [] };
    }
    const activeStudents = (students || []).filter((s) => s.status === 'active');
    const missingStudents = [];
    let scheduledStudentCount = 0;
    let scheduledEntryCount = 0;
    for (const s of activeStudents) {
        const sid = String(s.id);
        const entries = (typeof getScheduleEntries === 'function') ? getScheduleEntries(tid, sid, dateStr) : [];
        if (entries && entries.length > 0) {
            scheduledStudentCount += 1;
            scheduledEntryCount += entries.length;
        } else {
            missingStudents.push(s);
        }
    }
    return {
        dateStr,
        teacherId: tid,
        activeCount: activeStudents.length,
        scheduledStudentCount,
        scheduledEntryCount,
        missingStudents
    };
}

window.getTodayScheduleSnapshotForTeacher = getTodayScheduleSnapshotForTeacher;

window.getEmergencyAttendancePendingCount = async function(days = 14) {
    try {
        const allRows = await fetchEmergencyAttendancePendingRows();
        const limitDays = Math.max(1, Number(days || 14));
        const cut = new Date();
        cut.setHours(0, 0, 0, 0);
        cut.setDate(cut.getDate() - limitDays);
        return allRows.filter((row) => {
            const dateValue = new Date(`${row.attendance_date}T00:00:00`);
            if (Number.isNaN(dateValue.getTime())) return false;
            return dateValue >= cut;
        }).length;
    } catch (error) {
        console.error('[getEmergencyAttendancePendingCount] 에러:', error);
        return null;
    }
};

window.openTodayScheduleSuggestion = function() {
    try {
        const snapshot = getTodayScheduleSnapshotForTeacher(currentTeacherId);
        const targetIds = (snapshot.missingStudents || []).map((s) => String(s.id));
        if (typeof closeModal === 'function') closeModal('qr-attendance-modal');
        if (typeof openModal === 'function') openModal('schedule-modal');

        // schedule 모달 초기화 후 값을 덮기 위해 한 틱 지연
        setTimeout(() => {
            const startDateInput = document.getElementById('sch-start-date');
            if (startDateInput) startDateInput.value = snapshot.dateStr;
            const timeInput = document.getElementById('sch-time');
            if (timeInput) timeInput.value = '16:00';

            if (typeof selectedScheduleStudents !== 'undefined') {
                selectedScheduleStudents = targetIds;
                if (typeof renderSelectedScheduleStudents === 'function') renderSelectedScheduleStudents();
                if (typeof updateDurationByGrade === 'function') updateDurationByGrade();
            }
            const searchInput = document.getElementById('sch-student-search');
            if (searchInput) searchInput.focus();
        }, 30);

        showToast(`오늘 일정 미등록 학생 ${targetIds.length}명을 기준으로 일정 등록을 시작합니다.`, 'info');
    } catch (error) {
        console.error('[openTodayScheduleSuggestion] 에러:', error);
        showToast(`일정 등록 화면을 열지 못했습니다: ${error.message}`, 'error');
    }
};

function normalizePhoneDigits(value) {
    return String(value || '').replace(/[^0-9]/g, '');
}

function maskSuffix4(value) {
    const digits = normalizePhoneDigits(value);
    return digits.length >= 4 ? digits.slice(-4) : digits;
}

function getPhoneSuffixMatchCandidates(last4) {
    const suffix = normalizePhoneDigits(last4).slice(-4);
    if (!suffix || suffix.length !== 4) return [];
    return (students || [])
        .filter((s) => !s.status || s.status === 'active')
        .filter((s) => {
            const studentPhone = normalizePhoneDigits(s.studentPhone || s.phone);
            return studentPhone && studentPhone.endsWith(suffix);
        });
}

function buildStudentQrPayload(student) {
    if (!student) return null;
    const token = String(
        student.qrCodeData ||
        student.qr_code_data ||
        student.studentCode ||
        student.student_code ||
        `PHONE_AUTH_${Date.now()}`
    ).trim();
    return `STUDENT_${student.id}_${token}`;
}

function renderPhoneAuthCandidateList(candidates, suffix) {
    const container = document.getElementById('qr-phone-auth-result');
    if (!container) return;
    if (!candidates || candidates.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <div class="qr-phone-auth-candidates-title">동일한 뒷자리(${escapePlainText(suffix)}) 학생이 ${candidates.length}명입니다. 학생을 선택하세요.</div>
        ${candidates.map((s) => `
            <button type="button" class="qr-phone-candidate-btn" onclick="selectPhoneAttendanceAuthCandidate('${String(s.id)}','${escapePlainText(suffix)}')">
                <span>${escapePlainText(s.name || '')} (${escapePlainText(s.grade || '-')})</span>
                <small>${escapePlainText((s.school || '').trim() || '학교 미입력')}</small>
            </button>
        `).join('')}
    `;
}

window.selectPhoneAttendanceAuthCandidate = async function(studentId, suffix) {
    const student = (students || []).find((s) => String(s.id) === String(studentId));
    if (!student) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }
    const qrPayload = buildStudentQrPayload(student);
    if (!qrPayload) {
        showToast('학생 인증코드가 없어 처리할 수 없습니다. QR 재생성 후 다시 시도해주세요.', 'warning');
        return;
    }
    const container = document.getElementById('qr-phone-auth-result');
    if (container) container.innerHTML = '';
    const input = document.getElementById('qr-phone-last4-input');
    if (input) input.value = '';
    await processAttendanceFromQR(qrPayload, { authMode: 'phone_last4', phoneSuffix: String(suffix || '') });
};

let phoneAuthSubmitting = false;

window.handlePhoneAuthInputChange = function(inputEl) {
    const input = inputEl || document.getElementById('qr-phone-last4-input');
    if (!input) return;
    input.value = String(input.value || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (input.value.length === 4) {
        setTimeout(() => {
            if (String(input.value || '').length === 4) {
                window.submitPhoneAttendanceAuth();
            }
        }, 10);
    }
};

window.submitPhoneAttendanceAuth = async function() {
    if (phoneAuthSubmitting) return;
    const input = document.getElementById('qr-phone-last4-input');
    const resultEl = document.getElementById('qr-phone-auth-result');
    const suffix = normalizePhoneDigits(input ? input.value : '').slice(-4);
    if (!suffix || suffix.length !== 4) {
        showToast('전화번호 뒷자리 4자리를 입력해주세요.', 'warning');
        if (input) input.focus();
        return;
    }
    phoneAuthSubmitting = true;
    try {
        const candidates = getPhoneSuffixMatchCandidates(suffix);
        if (candidates.length === 0) {
            if (resultEl) resultEl.innerHTML = '<div class="qr-phone-auth-empty">일치하는 학생이 없습니다.</div>';
            showToast('일치하는 학생이 없습니다. 학생 연락처를 확인해주세요.', 'warning');
            return;
        }
        if (candidates.length > 1) {
            renderPhoneAuthCandidateList(candidates, suffix);
            showToast('동일 번호 학생이 여러 명입니다. 학생을 선택해주세요.', 'info');
            return;
        }
        const qrPayload = buildStudentQrPayload(candidates[0]);
        if (!qrPayload) {
            showToast('학생 인증코드가 없어 처리할 수 없습니다. QR 재생성 후 다시 시도해주세요.', 'warning');
            return;
        }
        if (resultEl) resultEl.innerHTML = '';
        if (input) input.value = '';
        await processAttendanceFromQR(qrPayload, { authMode: 'phone_last4', phoneSuffix: suffix });
    } finally {
        phoneAuthSubmitting = false;
    }
};

window.handlePhoneAuthKeypadKey = function(digit) {
    const input = document.getElementById('qr-phone-last4-input');
    if (!input) return;
    const nextDigit = String(digit || '').replace(/[^0-9]/g, '').slice(0, 1);
    if (!nextDigit) return;
    const current = String(input.value || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (current.length >= 4) return;
    input.value = (current + nextDigit).slice(0, 4);
    if (input.value.length === 4) {
        setTimeout(() => window.submitPhoneAttendanceAuth(), 10);
    }
};

window.handlePhoneAuthKeypadAction = async function(action) {
    const input = document.getElementById('qr-phone-last4-input');
    if (!input) return;
    const current = String(input.value || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (action === 'backspace') {
        input.value = current.slice(0, -1);
        return;
    }
    if (action === 'clear') {
        input.value = '';
        const resultEl = document.getElementById('qr-phone-auth-result');
        if (resultEl) resultEl.innerHTML = '';
        return;
    }
};

async function stopQRScannerForModeChange() {
    if (!html5QrcodeScanner) return;
    try {
        await html5QrcodeScanner.stop();
        if (typeof html5QrcodeScanner.clear === 'function') {
            html5QrcodeScanner.clear();
        }
    } catch (error) {
        console.error('[stopQRScannerForModeChange] 스캐너 중지 실패:', error);
    } finally {
        html5QrcodeScanner = null;
    }
}

function applyQRScanResponsiveLayout() {
    const scanMain = document.querySelector('.qr-scan-main');
    if (!scanMain) return;
    const isLandscape = (window.matchMedia && window.matchMedia('(orientation: landscape)').matches);
    const useDual = shouldUseDualPanelMode() && isLandscape;
    scanMain.classList.toggle('dual-mode', useDual);
}

let qrViewportGuardBound = false;
let qrViewportResizeHandler = null;
let qrPhoneFocusInHandler = null;
let qrPhoneFocusOutHandler = null;
let qrPhoneInputFocused = false;

function updateQRKeyboardViewportState() {
    const page = document.getElementById('qr-scan-page');
    const panel = document.getElementById('qr-scan-mode-phone');
    if (!page) return;

    const vv = window.visualViewport;
    const keyboardOffset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height)) : 0;
    const keyboardOpen = qrPhoneInputFocused && keyboardOffset >= 120;

    page.style.setProperty('--qr-keyboard-offset', `${keyboardOpen ? keyboardOffset : 0}px`);
    page.classList.toggle('qr-keyboard-open', keyboardOpen);

    if (keyboardOpen && panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function bindQRViewportGuard() {
    if (qrViewportGuardBound) return;
    const input = document.getElementById('qr-phone-last4-input');
    if (!input) return;

    qrViewportResizeHandler = () => updateQRKeyboardViewportState();
    qrPhoneFocusInHandler = () => {
        qrPhoneInputFocused = true;
        setTimeout(updateQRKeyboardViewportState, 30);
    };
    qrPhoneFocusOutHandler = () => {
        qrPhoneInputFocused = false;
        setTimeout(updateQRKeyboardViewportState, 80);
    };

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', qrViewportResizeHandler);
    }
    input.addEventListener('focus', qrPhoneFocusInHandler);
    input.addEventListener('blur', qrPhoneFocusOutHandler);

    qrViewportGuardBound = true;
}

function unbindQRViewportGuard() {
    if (!qrViewportGuardBound) return;
    const input = document.getElementById('qr-phone-last4-input');
    if (window.visualViewport && qrViewportResizeHandler) {
        window.visualViewport.removeEventListener('resize', qrViewportResizeHandler);
    }
    if (input && qrPhoneFocusInHandler) input.removeEventListener('focus', qrPhoneFocusInHandler);
    if (input && qrPhoneFocusOutHandler) input.removeEventListener('blur', qrPhoneFocusOutHandler);

    const page = document.getElementById('qr-scan-page');
    if (page) {
        page.style.setProperty('--qr-keyboard-offset', '0px');
        page.classList.remove('qr-keyboard-open');
    }

    qrPhoneInputFocused = false;
    qrViewportGuardBound = false;
    qrViewportResizeHandler = null;
    qrPhoneFocusInHandler = null;
    qrPhoneFocusOutHandler = null;
}

window.addEventListener('resize', () => {
    const page = document.getElementById('qr-scan-page');
    if (!page || page.style.display !== 'flex') return;
    applyQRScanResponsiveLayout();
});

// ========== QR 스캔 페이지 ==========

// QR 스캔 페이지 열기
window.openQRScanPage = async function() {
    console.log('[openQRScanPage] QR 스캔 페이지 열기');
    console.log('[openQRScanPage] students 수:', students ? students.length : 0);
    console.log('[openQRScanPage] teacherScheduleData 키:', Object.keys(teacherScheduleData));
    
    try {
        // ✅ 학생 데이터가 비어있으면 Supabase에서 다시 로드 (모바일 네트워크 지연 대응)
        if (!students || students.length === 0) {
            console.log('[openQRScanPage] 학생 데이터 없음 - Supabase에서 재로드 시도');
            if (typeof getAllStudents === 'function') {
                const supabaseStudents = await getAllStudents();
                if (supabaseStudents && supabaseStudents.length > 0) {
                    students = supabaseStudents.map(s => ({
                        id: s.id,
                        name: s.name,
                        school: s.school || '',
                        grade: s.grade,
                        studentPhone: s.phone || '',
                        parentPhone: s.parent_phone || '',
                        defaultFee: s.default_fee || 0,
                        specialLectureFee: s.special_lecture_fee || 0,
                        defaultTextbookFee: s.default_textbook_fee || 0,
                        memo: s.memo || '',
                        registerDate: s.register_date || '',
                        status: s.status || 'active',
                        parentCode: s.parent_code || '',
                        studentCode: s.student_code || '',
                        events: [],
                        attendance: {},
                        records: {},
                        payments: {}
                    }));
                    console.log('[openQRScanPage] Supabase에서 학생 데이터 재로드 완료:', students.length, '명');
                } else {
                    showToast('등록된 학생이 없습니다.\n먼저 학생을 등록해주세요.', 'warning');
                    return;
                }
            } else {
                showToast('등록된 학생이 없습니다.\n먼저 학생을 등록해주세요.', 'warning');
                return;
            }
        }
        
        // ✅ 일정 데이터 강제 재로드 (모바일/PC 동일 결과 보장 - QR 재발급 후 동기화 필수)
        console.log('[openQRScanPage] 일정 데이터 전체 재로드 시작 (강제 동기화)');
        try {
            const reloadSuccess = await loadAllSchedulesForOwner();
            if (reloadSuccess) {
                console.log('[openQRScanPage] 일정 데이터 재로드 완료:', Object.keys(teacherScheduleData).length, '명의 선생님');
            } else {
                console.warn('[openQRScanPage] 일정 데이터 재로드 실패');
            }
        } catch (reloadError) {
            console.error('[openQRScanPage] 일정 재로드 중 에러:', reloadError);
        }

        // 일정 누락 사전 예방: 스캔 진입 전 당일 일정 체크
        const todaySnapshot = getTodayScheduleSnapshotForTeacher(currentTeacherId);
        if (todaySnapshot.scheduledEntryCount === 0) {
            const confirmed = await window.showConfirm(
                `오늘(${todaySnapshot.dateStr}) 등록된 수업 일정이 없습니다.\n` +
                `지금 스캔하면 미처리 출석으로 저장되고 일정이 자동 생성됩니다.\n\n` +
                `먼저 오늘 일정을 등록하시겠어요?`,
                {
                    title: '일정 누락 경고',
                    type: 'warn',
                    okText: '오늘 일정 등록',
                    cancelText: '그대로 스캔'
                }
            );
            if (confirmed) {
                window.openTodayScheduleSuggestion();
                return;
            }
            showToast('일정 없이 스캔을 진행합니다. 미처리 출석 저장 + 자동 일정 생성을 진행합니다.', 'warning');
        }
        
        // 모달 닫기 (존재하는 경우)
        if (typeof closeModal === 'function') {
            closeModal('qr-attendance-modal');
        }
        
        // QR 스캔 페이지 표시
        const scanPage = document.getElementById('qr-scan-page');
        if (scanPage) {
            scanPage.style.display = 'flex';
        } else {
            console.error('[openQRScanPage] qr-scan-page 요소를 찾을 수 없습니다');
            showToast('QR 스캔 페이지를 찾을 수 없습니다.', 'error');
            return;
        }
        
        const resultDiv = document.getElementById('qr-scan-result');
        if (resultDiv) {
            resultDiv.style.display = 'none';
        }
        
        // 10인치 태블릿 기준 반응형: 가로는 좌우, 세로는 상하
        applyQRScanResponsiveLayout();
        bindQRViewportGuard();
        updateQRKeyboardViewportState();
        setQRCameraActionsVisible(false);
        clearQRCameraActionsAutoHideTimer();
        clearQRCornerPressTimer();
        setTimeout(() => {
            if (!html5QrcodeScanner) startQRScanner();
        }, 80);
    } catch (error) {
        console.error('[openQRScanPage] 오류:', error);
        showToast('QR 스캔 페이지를 열 수 없습니다.', 'error');
    }
}

// ★ 선생님 선택 화면에서 QR 스캔 (비밀번호 인증 방식)
let openedFromTeacherSelect = false;

// QR 비밀번호 모달 열기 (세션 인증 기억 기능 포함)
window.showQRPasswordModal = async function() {
    console.log('[showQRPasswordModal] QR 비밀번호 모달 열기');

    // ★ 세션에 이전 인증 정보가 있으면 비밀번호 없이 바로 진입
    const savedTeacherId = sessionStorage.getItem('qr_scan_teacher_id');
    if (savedTeacherId && typeof teacherList !== 'undefined' && teacherList.length > 0) {
        const savedTeacher = teacherList.find(t => String(t.id) === String(savedTeacherId));
        if (savedTeacher) {
            console.log('[showQRPasswordModal] 세션 인증 기억 - 바로 진입:', savedTeacher.name);
            openedFromTeacherSelect = true;
            window._pendingQRScanOpen = true;
            await setCurrentTeacher(savedTeacher);
            if (window._pendingQRScanOpen) {
                window._pendingQRScanOpen = false;
                setTimeout(() => {
                    if (typeof openQRScanPage === 'function') openQRScanPage();
                }, 300);
            }
            return;
        }
    }

    const modal = document.getElementById('qr-password-modal');
    if (!modal) return;

    // 선생님 드롭다운 채우기 (메인 드롭다운의 목록을 복사)
    const qrDropdown = document.getElementById('qr-teacher-dropdown');
    if (qrDropdown && typeof teacherList !== 'undefined' && teacherList.length > 0) {
        qrDropdown.innerHTML = '<option value="">선생님 선택</option>';
        teacherList.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            qrDropdown.appendChild(opt);
        });
        // 선생님이 1명이면 자동 선택
        if (teacherList.length === 1) {
            qrDropdown.value = teacherList[0].id;
        }
    }

    // 비밀번호 초기화
    const pwInput = document.getElementById('qr-scan-password');
    if (pwInput) pwInput.value = '';

    modal.style.display = 'flex';
    setTimeout(() => {
        if (teacherList && teacherList.length === 1 && pwInput) {
            pwInput.focus();
        } else if (qrDropdown) {
            qrDropdown.focus();
        }
    }, 100);
}

// QR 비밀번호 모달 닫기
window.closeQRPasswordModal = function() {
    const modal = document.getElementById('qr-password-modal');
    if (modal) modal.style.display = 'none';
}

// QR 비밀번호 확인 → 선생님 입장 후 QR 스캔 자동 열기
window.confirmQRPassword = async function() {
    const qrDropdown = document.getElementById('qr-teacher-dropdown');
    const pwInput = document.getElementById('qr-scan-password');
    const teacherId = qrDropdown ? qrDropdown.value : '';
    const password = pwInput ? pwInput.value.trim() : '';

    if (!teacherId) {
        showToast('선생님을 선택해주세요.', 'warning');
        return;
    }
    if (!password) {
        showToast('비밀번호를 입력해주세요.', 'warning');
        return;
    }

    const teacher = teacherList.find(t => String(t.id) === String(teacherId));
    if (!teacher) {
        showToast('선생님을 찾을 수 없습니다.', 'error');
        return;
    }

    // 비밀번호 검증
    const passwordHash = await hashPin(password);
    if (passwordHash !== teacher.pin_hash) {
        showToast('비밀번호가 일치하지 않습니다.', 'warning');
        if (pwInput) { pwInput.value = ''; pwInput.focus(); }
        return;
    }

    console.log('[confirmQRPassword] 비밀번호 인증 성공:', teacher.name);

    // ★ 세션에 인증 정보 저장 (같은 탭에서 재인증 불필요)
    sessionStorage.setItem('qr_scan_teacher_id', teacher.id);

    // 모달 닫기
    closeQRPasswordModal();

    // ★ 플래그 설정: setCurrentTeacher 완료 후 QR 스캔 자동 오픈
    openedFromTeacherSelect = true;
    window._pendingQRScanOpen = true;

    // 기존 선생님 입장 로직 그대로 사용
    await setCurrentTeacher(teacher);

    // setCurrentTeacher 완료 후 QR 스캔 페이지 열기
    if (window._pendingQRScanOpen) {
        window._pendingQRScanOpen = false;
        console.log('[confirmQRPassword] QR 스캔 페이지 자동 열기');
        setTimeout(() => {
            if (typeof openQRScanPage === 'function') {
                openQRScanPage();
            }
        }, 300);
    }
}

// 카메라 전환 (전방 ↔ 후방)
window.switchCamera = async function() {
    console.log('[switchCamera] 카메라 전환 시작');
    if (qrCameraSwitchInProgress) return;
    if (!html5QrcodeScanner) {
        console.warn('[switchCamera] 실행 중인 스캐너가 없습니다');
        return;
    }
    qrCameraSwitchInProgress = true;
    try {
        const authenticated = await verifyTeacherPinForCameraSwitch();
        if (!authenticated) return;

        // 현재 스캐너 중지
        await html5QrcodeScanner.stop();
        console.log('[switchCamera] 스캐너 중지 완료');
        
        // 카메라 모드 전환
        currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        console.log('[switchCamera] 전환된 카메라 모드:', currentFacingMode);
        
        // 스캐너 인스턴스 초기화
        html5QrcodeScanner = null;
        
        // 잠시 대기 후 새 카메라로 시작
        setTimeout(() => {
            startQRScanner();
        }, 100);
        
    } catch (err) {
        console.error('[switchCamera] 카메라 전환 실패:', err);
        showToast('카메라 전환에 실패했습니다.', 'error');
    } finally {
        qrCameraSwitchInProgress = false;
    }
}

// QR 스캔 페이지 닫기
// 풀스크린 토글 (브라우저 Fullscreen API)
let qrFullscreenGestureLastTouchAt = 0;
let qrCornerPressTimer = null;
let qrCameraActionsAutoHideTimer = null;

function clearQRCornerPressTimer() {
    if (!qrCornerPressTimer) return;
    clearTimeout(qrCornerPressTimer);
    qrCornerPressTimer = null;
}

function setQRCameraActionsVisible(visible) {
    const panel = document.getElementById('qr-camera-actions');
    if (!panel) return;
    panel.classList.toggle('qr-camera-actions-hidden', !visible);
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function clearQRCameraActionsAutoHideTimer() {
    if (!qrCameraActionsAutoHideTimer) return;
    clearTimeout(qrCameraActionsAutoHideTimer);
    qrCameraActionsAutoHideTimer = null;
}

function revealQRCameraActionsTemporarily(durationMs = 12000) {
    setQRCameraActionsVisible(true);
    clearQRCameraActionsAutoHideTimer();
    qrCameraActionsAutoHideTimer = setTimeout(() => {
        setQRCameraActionsVisible(false);
        qrCameraActionsAutoHideTimer = null;
    }, durationMs);
}

window.handleQRCornerPressStart = function(event) {
    clearQRCornerPressTimer();
    qrCornerPressTimer = setTimeout(() => {
        qrCornerPressTimer = null;
        revealQRCameraActionsTemporarily(12000);
        showToast('카메라 전환 버튼이 12초간 표시됩니다.', 'info');
    }, 3000);
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
};

window.handleQRCornerPressEnd = function(event) {
    clearQRCornerPressTimer();
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
};

window.handleQRFullscreenGestureTouch = function(event) {
    const now = Date.now();
    const delta = now - qrFullscreenGestureLastTouchAt;
    qrFullscreenGestureLastTouchAt = now;
    if (delta > 0 && delta <= 350) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        window.toggleQRFullscreen();
    }
};

window.toggleQRFullscreen = function() {
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // 풀스크린 진입
        const requestFS = el.requestFullscreen || el.webkitRequestFullscreen;
        if (requestFS) {
            requestFS.call(el).catch(err => {
                console.warn('[Fullscreen] 전체화면 전환 실패:', err);
                showToast('이 기기에서는 전체화면을 지원하지 않습니다.', 'warning');
            });
        }
    } else {
        // 풀스크린 해제
        const exitFS = document.exitFullscreen || document.webkitExitFullscreen;
        if (exitFS) exitFS.call(document);
    }
};

// 풀스크린 상태 변경 시 버튼 텍스트 업데이트
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
function updateFullscreenBtn() {
    const btn = document.getElementById('qr-fullscreen-btn');
    if (!btn) return;
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    btn.innerHTML = isFS
        ? '<i class="fas fa-compress"></i> 전체화면 해제'
        : '<i class="fas fa-expand"></i> 전체화면';
}

window.closeQRScanPage = async function() {
    if (qrClosePinCheckInProgress) return;
    qrClosePinCheckInProgress = true;
    console.log('[closeQRScanPage] QR 스캔 페이지 닫기');

    try {
        const authenticated = await verifyTeacherPinForQrClose();
        if (!authenticated) return;

        // 풀스크린 상태면 해제
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            const exitFS = document.exitFullscreen || document.webkitExitFullscreen;
            if (exitFS) exitFS.call(document);
        }
        
        // 스캐너 중지
        stopQRScannerForModeChange();
        
        // 카메라 모드 초기화 (다음에 열 때 후방 카메라로)
        currentFacingMode = "environment";
        
        // 페이지 숨기기
        const scanPageEl = document.getElementById('qr-scan-page');
        if (scanPageEl) scanPageEl.style.display = 'none';
        unbindQRViewportGuard();
        setQRCameraActionsVisible(false);
        clearQRCameraActionsAutoHideTimer();
        clearQRCornerPressTimer();

        // QR 스캔 중 보류된 재석 확인 알림 일괄 표시
        if (window._qrDeferredNotifications && window._qrDeferredNotifications.length > 0) {
            const deferred = [...window._qrDeferredNotifications];
            window._qrDeferredNotifications = [];
            console.log('[closeQRScanPage] 보류된 재석 확인 알림 표시:', deferred.length, '건');
            deferred.forEach((timeKey, i) => {
                setTimeout(() => showAttendanceCheckNotification(timeKey), (i + 1) * 500);
            });
        }

        // 선생님 선택 화면에서 열었으면 선생님 선택 화면으로 복귀
        if (openedFromTeacherSelect) {
            openedFromTeacherSelect = false;
            console.log('[closeQRScanPage] 선생님 선택 화면으로 복귀');
            if (typeof navigateToPage === 'function') {
                navigateToPage('TEACHER_SELECT');
                if (typeof loadTeachers === 'function') loadTeachers();
            }
        }
    } finally {
        qrClosePinCheckInProgress = false;
    }
}

// QR 스캐너 시작
function startQRScanner() {
    if (html5QrcodeScanner) {
        console.log('[startQRScanner] 이미 실행 중인 스캐너가 있습니다');
        return;
    }
    
    try {
        // ★ QR 스캔 속도 최적화 설정
        const readerEl = document.getElementById('qr-reader');
        const readerWidth = readerEl ? readerEl.clientWidth : 300;
        const qrboxSize = Math.max(Math.min(Math.floor(readerWidth * 0.75), 300), 150);
        
        console.log('[startQRScanner] readerWidth:', readerWidth, 'qrboxSize:', qrboxSize);
        
        const config = {
            fps: 20,  // ★ 10 → 20fps (스캔 빈도 2배 증가)
            qrbox: { width: qrboxSize, height: qrboxSize },  // ★ 화면 비율에 맞게 자동 조정
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true  // ★ 브라우저 네이티브 API 사용 (훨씬 빠름)
            }
        };
        
        html5QrcodeScanner = new Html5Qrcode("qr-reader", {
            formatsToSupport: [0]  // ★ QR_CODE만 스캔 (불필요한 바코드 무시로 속도 향상)
        });
        
        html5QrcodeScanner.start(
            { facingMode: currentFacingMode },
            config,
            onQRScanSuccess,
            onQRScanFailure
        ).catch(err => {
            console.error('[startQRScanner] 카메라 시작 실패:', err);
            showCameraFallbackUI();
        });
    } catch (err) {
        console.error('[startQRScanner] 스캐너 초기화 실패:', err);
        showCameraFallbackUI();
    }
}

// 카메라를 사용할 수 없을 때 안내 UI 표시
function showCameraFallbackUI() {
    const readerEl = document.getElementById('qr-reader');
    if (readerEl) {
        readerEl.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:#94a3b8;text-align:center;">
                <i class="fas fa-video-slash" style="font-size:48px;margin-bottom:16px;color:#64748b;"></i>
                <p style="font-size:18px;font-weight:600;color:#e2e8f0;margin:0 0 8px;">카메라를 사용할 수 없습니다</p>
                <p style="font-size:14px;margin:0;line-height:1.6;">카메라 권한을 허용해주세요.<br>또는 모바일 기기에서 QR 스캔을 이용해주세요.</p>
            </div>
        `;
    }
    showToast('카메라를 시작할 수 없습니다.', 'error');
}

// QR 스캔 성공 콜백
function onQRScanSuccess(decodedText, decodedResult) {
    console.log('[onQRScanSuccess] QR 스캔 성공:', decodedText);
    console.log('[onQRScanSuccess] decodedResult:', decodedResult);
    
    // 스캐너 일시 정지
    if (html5QrcodeScanner) {
        html5QrcodeScanner.pause();
    }
    
    // 빈 문자열이나 null 체크
    if (!decodedText || decodedText.trim() === '') {
        console.error('[onQRScanSuccess] 빈 QR 데이터');
        showToast('QR 코드를 읽을 수 없습니다. 다시 시도해주세요.', 'error');
        if (html5QrcodeScanner) {
            html5QrcodeScanner.resume();
        }
        return;
    }
    
    // QR 데이터 파싱 및 출석 처리
    processAttendanceFromQR(decodedText);
}

// QR 스캔 실패 콜백 (무시)
function onQRScanFailure(error) {
    // 스캔 실패는 정상적인 상황이므로 무시
}

// QR 코드로부터 출석 처리
async function processAttendanceFromQR(qrData, authMeta = null) {
    try {
        console.log('[processAttendanceFromQR] === 출석 처리 시작 ===');
        console.log('[processAttendanceFromQR] 스캔된 QR 데이터:', qrData);
        const isPhoneAuthMode = !!(authMeta && authMeta.authMode === 'phone_last4');
        const phoneSuffix4 = isPhoneAuthMode ? maskSuffix4(authMeta.phoneSuffix) : '';
        const isHandledAttendanceStatus = (status) => {
            const normalized = String(status || '').toLowerCase();
            return normalized === 'present' || normalized === 'late' || normalized === 'makeup';
        };
        
        // 1. QR 데이터 검증
        if (!qrData || typeof qrData !== 'string' || qrData.trim() === '') {
            showQRScanToast(null, 'error', '읽을 수 없는 QR 코드');
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2000);
            return;
        }
        
        // 2. STUDENT_ 접두사 확인 (미등록 QR 코드)
        if (!qrData.startsWith('STUDENT_')) {
            console.error('[processAttendanceFromQR] QR 데이터가 STUDENT_로 시작하지 않음');
            showQRScanToast(null, 'unregistered', null);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        // 3. 학생 ID, QR토큰 추출 (STUDENT_{ID}_{qrToken} 형식)
        const dataWithoutPrefix = qrData.substring(8); // "STUDENT_" 제거
        let studentId, qrToken = null;
        const firstUnderscoreIndex = dataWithoutPrefix.indexOf('_');
        if (firstUnderscoreIndex !== -1) {
            studentId = dataWithoutPrefix.substring(0, firstUnderscoreIndex);
            qrToken = dataWithoutPrefix.substring(firstUnderscoreIndex + 1);
        } else {
            studentId = dataWithoutPrefix;
        }

        console.log('[processAttendanceFromQR] 추출된 학생 ID:', studentId, 'QR토큰:', qrToken);
        console.log('[processAttendanceFromQR] 학생 ID 타입:', typeof studentId);
        console.log('[processAttendanceFromQR] 전체 students 수:', students.length);
        console.log('[processAttendanceFromQR] 등록된 학생 ID 목록:', students.map(s => `${s.id}(${typeof s.id})`).join(', '));

        // 3-1. 학생 정보 조회 먼저 수행 (PC/모바일 동일 결과 보장)
        // 학생 ID 타입 일치 보장 (number/string 혼용 방지)
        let student = students.find(s => String(s.id) === String(studentId) || Number(s.id) === Number(studentId));
        if (!student) {
            // 혹시 currentTeacherStudents에도 있는지 추가로 확인
            student = currentTeacherStudents.find(s => String(s.id) === String(studentId) || Number(s.id) === Number(studentId));
        }
        // Supabase에서 불러온 학생 ID가 uuid(문자열)일 경우도 체크
        if (!student) {
            student = students.find(s => String(s.id).replace(/-/g, '') === String(studentId).replace(/-/g, ''));
        }
        if (!student) {
            student = currentTeacherStudents.find(s => String(s.id).replace(/-/g, '') === String(studentId).replace(/-/g, ''));
        }
        
        // ✅ 로컬 메모리에 없으면 Supabase에서 실시간 조회 (모바일 캐시 미스 대응)
        if (!student && typeof getAllStudents === 'function') {
            console.log('[processAttendanceFromQR] 로컬에 학생 없음 - Supabase 실시간 조회');
            try {
                const supabaseStudents = await getAllStudents();
                console.log('[processAttendanceFromQR] Supabase 조회 결과:', supabaseStudents.length, '명');
                student = supabaseStudents.find(s => String(s.id) === String(studentId) || Number(s.id) === Number(studentId));
                if (student) {
                    // 중복 체크 후 로컬 students 배열에 추가 (캐시 갱신)
                    const alreadyExists = students.some(s => String(s.id) === String(student.id));
                    if (!alreadyExists) {
                        students.push({
                            id: student.id,
                            name: student.name,
                            grade: student.grade,
                            studentPhone: student.phone || '',
                            parentPhone: student.parent_phone || '',
                            defaultFee: student.default_fee || 0,
                            specialLectureFee: student.special_lecture_fee || 0,
                            defaultTextbookFee: student.default_textbook_fee || 0,
                            memo: student.memo || '',
                            registerDate: student.register_date || '',
                            status: student.status || 'active',
                            events: [],
                            attendance: {},
                            records: {},
                            payments: {}
                        });
                        console.log('[processAttendanceFromQR] ✅ Supabase에서 학생 조회 및 로컬 추가:', student.name);
                    } else {
                        console.log('[processAttendanceFromQR] ✅ Supabase에서 학생 조회 (이미 로컬에 있음):', student.name);
                    }
                } else {
                    console.log('[processAttendanceFromQR] ⚠️ Supabase에도 학생 없음, ID:', studentId);
                }
            } catch (dbError) {
                console.error('[processAttendanceFromQR] Supabase 학생 조회 실패:', dbError);
            }
        }
        
        console.log('[processAttendanceFromQR] 최종 학생 찾기:', !!student, student);
        if (!student) {
            console.error('[processAttendanceFromQR] ❌ 학생을 찾을 수 없음!');
            console.error('[processAttendanceFromQR] 찾으려는 ID:', studentId);
            console.error('[processAttendanceFromQR] 전체 students 수:', students.length);
            if (students.length > 0) {
                console.error('[processAttendanceFromQR] 전체 학생 목록:', students.map(s => ({ id: s.id, name: s.name })));
            } else {
                console.error('[processAttendanceFromQR] ⚠️ 등록된 학생이 없습니다!');
            }
            showQRScanToast(null, 'unregistered', null);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        console.log('[processAttendanceFromQR] ✅ 학생 찾음:', student.name);
        
        // 4. QR토큰 유효성 검사 (최우선 검증 - 일정/날짜 검사보다 먼저!)
        // 전화번호 인증은 QR 만료 토큰 검증과 분리해 처리한다.
        if (!isPhoneAuthMode) {
        // ✅ QR 재발급 시 구 QR코드는 무조건 만료 처리
        
        // QR코드에 토큰이 없으면 구 버전 (만료)
        if (!qrToken) {
            console.log('[processAttendanceFromQR] ❌ QR토큰 없음 - 구 버전 QR코드');
            showQRScanToast(student, 'expired_qr', null);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        console.log('[processAttendanceFromQR] ========== QR 토큰 검증 시작 ==========');
        console.log('[processAttendanceFromQR] 스캔된 QR 토큰:', qrToken.substring(0, 30) + '...');
        
        // ✅ DB 토큰을 우선 조회 (기기 간 일관성 확보 - 최우선)
        // 다른 기기에서 재발급한 토큰을 감지하기 위해 항상 DB 먼저 조회
        let dbToken = null;
        try {
            console.log('[processAttendanceFromQR] DB에서 최신 토큰 조회 중...');
            dbToken = await getStudentQrTokenFromDb(studentId);
            console.log('[processAttendanceFromQR] DB 토큰 조회 결과:', dbToken ? `있음 (${dbToken.substring(0, 30)}...)` : '없음');
        } catch (e) {
            console.error('[processAttendanceFromQR] DB 토큰 조회 예외:', e);
        }
        
        // DB에 토큰이 있으면 DB 토큰으로 검증 (다른 기기 재발급 감지)
        if (dbToken) {
            if (qrToken !== dbToken) {
                console.log('[processAttendanceFromQR] ❌ QR토큰 불일치 (DB 기준) - 다른 기기에서 재발급됨');
                console.log('[processAttendanceFromQR] 스캔된 토큰:', qrToken.substring(0, 30) + '...');
                console.log('[processAttendanceFromQR] DB 최신 토큰:', dbToken.substring(0, 30) + '...');
                console.log('[processAttendanceFromQR] ========== 만료된 QR 코드 ==========');
                showQRScanToast(student, 'expired_qr', null);
                setTimeout(() => {
                    if (html5QrcodeScanner) html5QrcodeScanner.resume();
                }, 2500);
                return;
            }
            console.log('[processAttendanceFromQR] ✅ QR토큰 검증 통과 (DB 기준)');
            console.log('[processAttendanceFromQR] ========== 토큰 검증 완료 ==========');
            
            // 로컬 토큰도 동기화
            try {
                let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
                if (qrTokens[studentId] !== dbToken) {
                    qrTokens[studentId] = dbToken;
                    localStorage.setItem('student_qr_tokens', JSON.stringify(qrTokens));
                    console.log('[processAttendanceFromQR] 로컬 토큰을 DB 토큰으로 동기화 완료');
                }
            } catch (e) {
                console.error('[processAttendanceFromQR] 로컬 토큰 동기화 중 에러:', e);
            }
        } else {
            // DB에 토큰이 없는 경우
            // ✅ 먼저 로컬 토큰 확인 (재발급 했는데 DB 저장 실패한 경우 대비)
            let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
            const localToken = qrTokens[studentId];
            
            if (localToken) {
                // 로컬에 토큰이 있으면 로컬 토큰으로 검증
                if (qrToken !== localToken) {
                    console.log('[processAttendanceFromQR] ❌ QR토큰 불일치 (로컬 기준)');
                    console.log('[processAttendanceFromQR] 스캔된 토큰:', qrToken.substring(0, 30) + '...');
                    console.log('[processAttendanceFromQR] 로컬 토큰:', localToken.substring(0, 30) + '...');
                    showQRScanToast(student, 'expired_qr', null);
                    setTimeout(() => {
                        if (html5QrcodeScanner) html5QrcodeScanner.resume();
                    }, 2500);
                    return;
                }
                console.log('[processAttendanceFromQR] ✅ QR토큰 검증 통과 (로컬 기준)');
                // DB에도 동기화 시도
                try {
                    await updateStudentQrTokenInDb(studentId, qrToken);
                    console.log('[processAttendanceFromQR] 로컬 토큰을 DB에 동기화 완료');
                } catch (syncError) {
                    console.error('[processAttendanceFromQR] DB 동기화 실패:', syncError);
                }
            } else {
                // DB에도 없고 로컬에도 없으면 - 진짜 최초 생성
                console.log('[processAttendanceFromQR] ⚠️ DB/로컬 모두 토큰 없음 - 최초 생성으로 간주');
                try {
                    await updateStudentQrTokenInDb(studentId, qrToken);
                    console.log('[processAttendanceFromQR] ✅ 스캔 토큰을 DB에 저장 완료');
                    qrTokens[studentId] = qrToken;
                    localStorage.setItem('student_qr_tokens', JSON.stringify(qrTokens));
                } catch (saveError) {
                    console.error('[processAttendanceFromQR] 토큰 저장 실패:', saveError);
                    // 저장 실패해도 최초 생성이면 진행 허용
                }
            }
        }
        
        console.log('[processAttendanceFromQR] ✅ QR토큰 검증 통과');
        } else {
            console.log('[processAttendanceFromQR] 전화번호 인증 모드 - QR 토큰 만료 검증 스킵');
        }
        
        // 5. 오늘 날짜 (토큰 검증 후에 계산)
        const today = new Date();
        const dateStr = formatDateToYYYYMMDD(today);
        
        // 6. 로컬 메모리에서 모든 일정이 이미 처리되었는지 확인
        // (일부만 처리된 경우에는 나머지를 처리해야 하므로 계속 진행)
        if (student.attendance && student.attendance[dateStr] && typeof student.attendance[dateStr] === 'object') {
            const processedCount = Object.keys(student.attendance[dateStr]).length;
            // 대략적인 체크: 로컬에 기록된 수가 있으면 로그만 남기고 계속 진행
            // (실제 중복은 DB upsert에서 자연스럽게 처리됨)
            if (processedCount > 0) {
                console.log(`[processAttendanceFromQR] 로컬에 ${processedCount}개 출석 기록 있음 - DB에서 정확히 확인 후 처리`);
            }
        }
        
        // ⚠️ 여기서부터는 일정이 필요함 (QR 토큰 검증은 이미 통과)
        // 7. 해당 학생의 그날 모든 선생님 일정 중 가장 빠른 일정 찾기
        // ★★★ 핵심 수정: 로컬 캐시에는 현재 선생님 일정만 있을 수 있으므로
        //      항상 DB에서 해당 학생의 당일 전체 일정을 조회하여 정확한 "가장 빠른 일정"을 찾음
        let earliestSchedule = null;
        let allSchedules = [];
        
        // Step 1: DB에서 해당 학생의 당일 전체 일정 조회
        // 후속 알림 큐를 정확히 생성하려면 선생님 필터 없이 전체를 먼저 읽어야 한다.
        if (typeof supabase !== 'undefined') {
            console.log('[processAttendanceFromQR] DB에서 학생의 당일 전체 일정 조회 시작');
            try {
                const ownerId = await ensureOwnerId();
                if (ownerId) {
                    const scheduleQuery = supabase
                        .from('schedules')
                        .select('teacher_id, start_time, duration')
                        .eq('owner_user_id', ownerId)
                        .eq('student_id', parseInt(studentId))
                        .eq('schedule_date', dateStr);
                    const { data: schedules, error } = await scheduleQuery.order('start_time', { ascending: true });
                    
                    if (!error && schedules && schedules.length > 0) {
                        console.log('[processAttendanceFromQR] DB 전체 일정 조회 결과:', schedules.length, '건');
                        schedules.forEach(s => console.log(`  - 선생님 ${s.teacher_id}: ${s.start_time}`));
                        
                        // 모든 일정을 배열로 변환 (시간순 이미 정렬됨)
                        allSchedules = schedules.map(s => ({
                            teacherId: String(s.teacher_id),
                            schedule: {
                                start: s.start_time ? s.start_time.substring(0, 5) : s.start_time,
                                duration: s.duration
                            },
                            scheduleTime: new Date(`2000-01-01T${s.start_time.substring(0, 5)}:00`)
                        }));
                        
                        // 가장 빠른 일정 선택 (이미 start_time ASC 정렬)
                        earliestSchedule = allSchedules[0].schedule;
                        console.log('[processAttendanceFromQR] ★ DB 기준 가장 빠른 일정:', earliestSchedule.start, '선생님:', allSchedules[0].teacherId);
                        
                        // 로컬 캐시에도 반영 (다음 조회 시 빨라짐)
                        for (const s of schedules) {
                            const tid = String(s.teacher_id);
                            const startTime = s.start_time ? s.start_time.substring(0, 5) : s.start_time;
                            if (!startTime) continue;
                            const duration = parseInt(s.duration, 10) || 60;
                            if (typeof getScheduleEntries === 'function' && typeof setScheduleEntries === 'function') {
                                const entries = getScheduleEntries(tid, String(studentId), dateStr);
                                const next = Array.isArray(entries) ? [...entries] : [];
                                const idx = next.findIndex((entry) => String(entry?.start || '') === String(startTime));
                                if (idx >= 0) next[idx] = { start: startTime, duration };
                                else next.push({ start: startTime, duration });
                                setScheduleEntries(tid, String(studentId), dateStr, next);
                            } else {
                                if (!teacherScheduleData[tid]) teacherScheduleData[tid] = {};
                                if (!teacherScheduleData[tid][String(studentId)]) teacherScheduleData[tid][String(studentId)] = {};
                                const raw = teacherScheduleData[tid][String(studentId)][dateStr];
                                const list = Array.isArray(raw) ? [...raw] : (raw ? [raw] : []);
                                const idx = list.findIndex((entry) => String(entry?.start || '') === String(startTime));
                                if (idx >= 0) list[idx] = { start: startTime, duration };
                                else list.push({ start: startTime, duration });
                                teacherScheduleData[tid][String(studentId)][dateStr] = list;
                            }
                        }
                    } else {
                        console.warn('[processAttendanceFromQR] DB 일정 조회 결과 없음 또는 에러:', error);
                    }
                }
            } catch (dbError) {
                console.error('[processAttendanceFromQR] DB 일정 조회 실패:', dbError);
            }
        }
        
        // Step 2: DB 조회 실패 시 로컬 캐시에서 fallback
        if (!earliestSchedule) {
            console.log('[processAttendanceFromQR] DB 조회 결과 없음 - 로컬 캐시에서 검색');
            let scheduleResult = findEarliestScheduleForStudent(studentId, dateStr);
            allSchedules = scheduleResult.allSchedules || [];
            earliestSchedule = allSchedules.length > 0 ? allSchedules[0].schedule : null;
            
            // 로컬에도 없으면 전체 일정 재로드 후 다시 시도
            if (!earliestSchedule) {
                console.log('[processAttendanceFromQR] 로컬에도 일정 없음 - 전체 일정 재로드 시도');
                try {
                    await loadAllSchedulesForOwner();
                    scheduleResult = findEarliestScheduleForStudent(studentId, dateStr);
                    allSchedules = scheduleResult.allSchedules || [];
                    earliestSchedule = allSchedules.length > 0 ? allSchedules[0].schedule : null;
                } catch (reloadError) {
                    console.error('[processAttendanceFromQR] 전체 일정 재로드 실패:', reloadError);
                }
            }
        }
        
        if (!earliestSchedule) {
            console.warn('[processAttendanceFromQR] 수업 일정 없음 - 임시출석 분기 확인');

            // 중복 스캔 보호: 일정이 없어도 이미 처리된 출석 기록이 있으면 "이미 처리"로 종료
            let existingAnyRecord = null;
            const emergencyTeacherId = String(currentTeacherId || '');
            const ownerId = localStorage.getItem('current_owner_id') || null;
            try {
                // 무일정 중복조회는 임시출석 레코드(scheduled_time IS NULL)로 한정
                // -> 다음날/타수업 일반 출석 레코드가 섞여 already_processed 오탐되는 케이스 차단
                let emergencyQuery = supabase
                    .from('attendance_records')
                    .select('id, student_id, teacher_id, attendance_date, status, scheduled_time, check_in_time, qr_scanned, qr_scan_time, qr_judgment, memo, shared_memo')
                    .eq('student_id', parseInt(studentId))
                    .eq('attendance_date', dateStr)
                    .is('scheduled_time', null)
                    .order('created_at', { ascending: false })
                    .limit(1);
                if (ownerId) {
                    emergencyQuery = emergencyQuery.eq('owner_user_id', ownerId);
                }
                if (emergencyTeacherId) {
                    emergencyQuery = emergencyQuery.eq('teacher_id', emergencyTeacherId);
                }
                const { data: emergencyRows, error: emergencyReadErr } = await emergencyQuery;
                if (emergencyReadErr) throw emergencyReadErr;
                existingAnyRecord = emergencyRows && emergencyRows.length > 0 ? emergencyRows[0] : null;
            } catch (existingErr) {
                console.error('[processAttendanceFromQR] 임시출석 기존기록 조회 실패(일정없음 분기):', existingErr);
                try {
                    // 비상 fallback: 기존 조회함수 사용(기존 로직 호환)
                    existingAnyRecord = await getAttendanceRecordByStudentAndDate(
                        studentId,
                        dateStr,
                        emergencyTeacherId || null
                    );
                } catch (fallbackErr) {
                    console.error('[processAttendanceFromQR] 기존 출석 조회 fallback 실패(일정없음 분기):', fallbackErr);
                }
            }

            // 무일정 중복 판정은 "임시출석 기록"에만 적용 (일정 기반 과거 기록 오탐 방지)
            const existingIsTemporary = !!(
                existingAnyRecord &&
                (
                    !existingAnyRecord.scheduled_time ||
                    String(existingAnyRecord.qr_judgment || '').includes('임시출석') ||
                    String(existingAnyRecord.memo || '').includes('[임시출석]')
                )
            );
            if (existingAnyRecord && existingIsTemporary && isHandledAttendanceStatus(existingAnyRecord.status)) {
                const existingStatus = existingAnyRecord.status || 'present';
                console.log('[processAttendanceFromQR] 일정 없음 + 기존 처리 기록 존재 -> already_processed 반환');
                showQRScanToast(student, 'already_processed', existingStatus);
                setTimeout(() => {
                    if (html5QrcodeScanner) html5QrcodeScanner.resume();
                }, 2500);
                return;
            }

            // 무일정 자동보정:
            // - 출석기록은 미처리로 저장
            // - QR 스캔 시각은 기록
            // - 시간표에는 현재 시각 기준 일정 1건 자동 생성
            try {
                const nowIso = today.toISOString();
                const autoStartTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
                const autoDuration = 60;
                const sid = String(studentId);

                // 시간표 자동 일정 생성(현재 선생님 기준)
                if (emergencyTeacherId) {
                    const currentEntries = (typeof getScheduleEntries === 'function')
                        ? (getScheduleEntries(emergencyTeacherId, sid, dateStr) || [])
                        : [];
                    const hasSameStart = currentEntries.some((entry) => entry && entry.start === autoStartTime);
                    if (!hasSameStart) {
                        const nextEntries = [...currentEntries, { start: autoStartTime, duration: autoDuration }];
                        nextEntries.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
                        if (typeof setScheduleEntries === 'function') {
                            setScheduleEntries(emergencyTeacherId, sid, dateStr, nextEntries);
                        } else if (typeof teacherScheduleData !== 'undefined') {
                            if (!teacherScheduleData[emergencyTeacherId]) teacherScheduleData[emergencyTeacherId] = {};
                            if (!teacherScheduleData[emergencyTeacherId][sid]) teacherScheduleData[emergencyTeacherId][sid] = {};
                            teacherScheduleData[emergencyTeacherId][sid][dateStr] = nextEntries;
                        }
                        if (typeof saveScheduleToDatabase === 'function') {
                            try {
                                await saveScheduleToDatabase({
                                    teacherId: emergencyTeacherId,
                                    studentId: sid,
                                    date: dateStr,
                                    startTime: autoStartTime,
                                    duration: autoDuration
                                });
                            } catch (scheduleSaveErr) {
                                console.warn('[processAttendanceFromQR] 자동 일정 DB 저장 실패(로컬 유지):', scheduleSaveErr);
                            }
                        }
                    }
                }

                await saveAttendanceRecord({
                    studentId: studentId,
                    teacherId: emergencyTeacherId,
                    attendanceDate: dateStr,
                    checkInTime: nowIso,
                    scheduledTime: autoStartTime,
                    status: 'none',
                    qrScanned: !isPhoneAuthMode,
                    qrScanTime: !isPhoneAuthMode ? nowIso : null,
                    qrJudgment: isPhoneAuthMode
                        ? `미처리(전화번호 인증 · 자동일정 ${autoStartTime})`
                        : `미처리(QR 스캔 · 자동일정 ${autoStartTime})`,
                    attendance_source: 'emergency',
                    authTime: nowIso,
                    presenceChecked: false,
                    processedAt: nowIso,
                    memo: isPhoneAuthMode
                        ? `[자동일정생성] 일정 미등록 상태에서 전화번호 인증(${phoneSuffix4}) → ${autoStartTime} 일정 생성, 출석 미처리 저장`
                        : `[자동일정생성] 일정 미등록 상태에서 QR 스캔 → ${autoStartTime} 일정 생성, 출석 미처리 저장`,
                    shared_memo: null
                });

                // 로컬 캐시도 최소 동기화
                const sIdx = students.findIndex(s => String(s.id) === String(studentId));
                if (sIdx > -1) {
                    if (!students[sIdx].attendance) students[sIdx].attendance = {};
                    if (!students[sIdx].attendance[dateStr] || typeof students[sIdx].attendance[dateStr] !== 'object') {
                        students[sIdx].attendance[dateStr] = {};
                    }
                    students[sIdx].attendance[dateStr][autoStartTime] = 'none';
                    if (!students[sIdx].qr_scan_time) students[sIdx].qr_scan_time = {};
                    students[sIdx].qr_scan_time[dateStr] = today.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                }
                saveData();
                renderCalendar();
                if (typeof window.renderDayEvents === 'function') {
                    window.renderDayEvents(dateStr);
                }
                if (typeof window.renderEmergencyAttendanceQueue === 'function') {
                    window.renderEmergencyAttendanceQueue();
                }

                showQRScanToast(student, 'temporary_pending', {
                    scanTimeStr: today.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                    autoStartTime
                });
            } catch (emergencyErr) {
                console.error('[processAttendanceFromQR] 무일정 자동보정 저장 실패:', emergencyErr);
                showQRScanToast(student, 'no_schedule', dateStr);
            }

            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 3000);
            return;
        }

        // 7. 출석 처리 - 수업 종료시간 기반 판정
        // ★★★ 새로운 로직:
        //   시간순으로 일정 순회 →
        //   스캔시간 >= 수업종료시간 → 결석 (다음 일정으로)
        //   스캔시간 <= 수업시작시간 → 출석 (이후 일정은 알림)
        //   수업시작 < 스캔시간 < 수업종료 → 지각 (이후 일정은 알림)
        
        let primaryStatus = null; // 토스트에 표시할 대표 상태
        let primaryResult = null;
        let processedCount = 0; // ★ 바깥에서도 접근 가능하도록 스코프 이동
        
        try {
            if (allSchedules && allSchedules.length > 0) {
                // 시간순 정렬
                const sortedSchedules = [...allSchedules].sort((a, b) => {
                    const timeA = a.scheduleTime || new Date(`2000-01-01T${a.schedule.start}:00`);
                    const timeB = b.scheduleTime || new Date(`2000-01-01T${b.schedule.start}:00`);
                    return timeA - timeB;
                });
                
                const studentObj = students.find(s => String(s.id) === String(studentId));
                const studentName = studentObj ? studentObj.name : `학생${studentId}`;
                const sIdx = students.findIndex(s => String(s.id) === String(studentId));
                
                let foundActiveClass = false; // 출석/지각으로 처리된 수업이 있는지
                let pendingCount = 0;
                
                for (let i = 0; i < sortedSchedules.length; i++) {
                    const scheduleItem = sortedSchedules[i];
                    const startTimeStr = scheduleItem.schedule.start;
                    const duration = scheduleItem.schedule.duration || 60;
                    
                    // 수업 시작/종료 시간 계산
                    const [sh, sm] = startTimeStr.split(':').map(Number);
                    const classStart = new Date(today);
                    classStart.setHours(sh, sm, 0, 0);
                    const classEnd = new Date(classStart.getTime() + duration * 60000);
                    
                    // 이미 출석/지각 처리된 수업 뒤의 일정 → 재석 확인 알림
                    if (foundActiveClass) {
                        registerPendingAttendanceCheck(
                            studentId, studentName,
                            scheduleItem.teacherId,
                            startTimeStr, dateStr
                        );
                        pendingCount++;
                        console.log(`[processAttendanceFromQR] ⏰ 재석확인 예약: ${studentName} → ${startTimeStr} (${scheduleItem.teacherId})`);
                        continue;
                    }
                    
                    // 이미 DB에 기록이 있는지 확인
                    let existingRecord = null;
                    try {
                        existingRecord = await getAttendanceRecordByStudentAndDate(
                            studentId, dateStr, scheduleItem.teacherId, startTimeStr, false
                        );
                    } catch (e) { /* 무시 */ }
                    
                    // ★ 이미 QR 스캔 완료된 기록이면 건너뛰기 (중복 스캔 방지)
                    const alreadyHandled = !!(existingRecord && isHandledAttendanceStatus(existingRecord.status));
                    if (alreadyHandled) {
                        console.log(`[processAttendanceFromQR] 이미 QR 스캔 처리됨: ${startTimeStr} → ${existingRecord.status}`);
                        if (!primaryStatus) {
                            primaryStatus = existingRecord.status;
                        }
                        continue;
                    }
                    
                    let status, judgmentText, diffMin;
                    
                    const graceEnd = new Date(classStart.getTime() + ATTENDANCE_GRACE_MINUTES * 60000);
                    if (today >= classEnd) {
                        // ★ 수업 종료시간 이후 → 결석
                        status = 'absent';
                        diffMin = Math.round((today - classStart) / 60000);
                        judgmentText = '결석 (수업 종료)';
                        console.log(`[processAttendanceFromQR] ❌ 결석: ${studentName} → ${startTimeStr} (수업 종료됨, ${diffMin}분 경과)`);
                    } else if (today <= graceEnd) {
                        // ★ 수업 시작 후 grace 구간까지는 출석
                        status = 'present';
                        if (today <= classStart) {
                            diffMin = Math.round((classStart - today) / 60000);
                            judgmentText = diffMin > 0 ? `${diffMin}분 전 출석` : '정각 출석';
                        } else {
                            diffMin = Math.max(0, Math.floor((today - classStart) / 60000));
                            judgmentText = diffMin > 0
                                ? `${ATTENDANCE_GRACE_MINUTES}분 이내 출석(${diffMin}분)`
                                : '정각 출석';
                        }
                        foundActiveClass = true;
                        console.log(`[processAttendanceFromQR] ✅ 출석: ${studentName} → ${startTimeStr} (grace ${ATTENDANCE_GRACE_MINUTES}분)`);
                    } else {
                        // ★ grace 구간 이후 ~ 수업 종료 전 → 지각
                        status = 'late';
                        diffMin = Math.round((today - classStart) / 60000);
                        judgmentText = `${diffMin}분 지각`;
                        foundActiveClass = true;
                        console.log(`[processAttendanceFromQR] ⏰ 지각: ${studentName} → ${startTimeStr} (${diffMin}분 지각)`);
                    }
                    
                    // 출석 기록 저장 (기존 레코드가 있으면 QR 스캔 정보로 업데이트, 없으면 신규 생성)
                    await saveAttendanceRecord({
                        studentId: studentId,
                        teacherId: String(scheduleItem.teacherId),
                        attendanceDate: dateStr,
                        checkInTime: today.toISOString(),
                        scheduledTime: startTimeStr,
                        status: status,
                        qrScanned: !isPhoneAuthMode,
                        qrScanTime: !isPhoneAuthMode ? today.toISOString() : null,
                        qrJudgment: isPhoneAuthMode ? `${judgmentText} · 전화번호인증(${phoneSuffix4})` : judgmentText,
                        attendance_source: isPhoneAuthMode ? 'phone' : 'qr',
                        authTime: today.toISOString(),
                        presenceChecked: false,
                        processedAt: today.toISOString(),
                        memo: isPhoneAuthMode
                            ? (() => {
                                const prev = String(existingRecord?.memo || '').trim();
                                const line = `[전화번호인증] 뒷자리:${phoneSuffix4}`;
                                return prev ? `${prev}\n${line}` : line;
                            })()
                            : (existingRecord?.memo || null),
                        shared_memo: existingRecord?.shared_memo || null
                    });
                    processedCount++;
                    
                    // 대표 상태 (토스트용) - 출석/지각이 있으면 그것을 표시
                    if (!primaryStatus || status === 'present' || status === 'late') {
                        if (!primaryStatus || status !== 'absent') {
                            primaryStatus = status;
                            primaryResult = { status, diffMinutes: diffMin, scheduledTimeStr: startTimeStr, scanTimeStr: today.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) };
                        }
                    }
                    
                    // 로컬 데이터 업데이트
                    if (sIdx > -1) {
                        if (!students[sIdx].attendance) students[sIdx].attendance = {};
                        if (typeof students[sIdx].attendance[dateStr] === 'string') {
                            const prev = students[sIdx].attendance[dateStr];
                            students[sIdx].attendance[dateStr] = {};
                            students[sIdx].attendance[dateStr]['default'] = prev;
                        }
                        if (!students[sIdx].attendance[dateStr] || typeof students[sIdx].attendance[dateStr] !== 'object') students[sIdx].attendance[dateStr] = {};
                        students[sIdx].attendance[dateStr][startTimeStr] = status;
                        if (!students[sIdx].qr_scan_time) students[sIdx].qr_scan_time = {};
                        students[sIdx].qr_scan_time[dateStr] = today.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                        if (!students[sIdx].qr_judgment) students[sIdx].qr_judgment = {};
                        if (!students[sIdx].qr_judgment[dateStr]) students[sIdx].qr_judgment[dateStr] = {};
                        students[sIdx].qr_judgment[dateStr][startTimeStr] = judgmentText;
                    }
                }
                
                console.log('[processAttendanceFromQR] ✅ 출석 처리 완료:', {
                    student: studentName,
                    즉시처리: processedCount,
                    재석확인예약: pendingCount
                });
            }
        } catch (dbError) {
            console.error('[processAttendanceFromQR] 데이터베이스 저장 실패:', dbError);
            console.error('[processAttendanceFromQR] 에러 상세:', dbError.message, dbError.details, dbError.hint);
        }
        
        // ★ 중복 스캔 감지: processedCount가 0이면 모든 일정이 이미 QR 스캔 완료된 상태
        const isDuplicateScan = processedCount === 0 && primaryStatus;
        
        // 대표 상태 기본값
        if (!primaryStatus) primaryStatus = 'present';
        if (!primaryResult) primaryResult = determineAttendanceStatus(today, earliestSchedule.start);
        const attendanceStatus = isDuplicateScan ? 'already_processed' : primaryStatus;
        const attendanceResult = isDuplicateScan ? primaryStatus : primaryResult;
        
        // 10. 로컬 데이터 저장
        saveData();
        
        // 11. 화면 업데이트
        lastQrScannedStudentId = studentId;
        
        if (typeof getActiveStudentsForTeacher === 'function' && typeof currentTeacherId !== 'undefined') {
            currentTeacherStudents = getActiveStudentsForTeacher(currentTeacherId);
        }
        
        renderCalendar();

        // 수업 관리 모달이 열려 있으면 상태 표시를 즉시 동기화
        if (!isDuplicateScan) {
            syncAttendanceModalStatusIfOpen(studentId, dateStr, primaryStatus);
        }
        
        // ★ 출석 기록 모달이 열려있으면 즉시 갱신
        const historyModal = document.getElementById('student-attendance-history-modal');
        if (historyModal && historyModal.style.display === 'flex' && typeof window.loadStudentAttendanceHistory === 'function') {
            try {
                await window.loadStudentAttendanceHistory();
            } catch (e) {
                console.error('[processAttendanceFromQR] 출석 기록 갱신 실패:', e);
            }
        }
        
        // 12. 결과 표시 (토스트 알림)
        showQRScanToast(student, attendanceStatus, attendanceResult);
        
        // 스캐너 자동 재개
        setTimeout(() => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.resume();
            }
        }, 2500);
        
        console.log('[processAttendanceFromQR] === 출석 처리 완료 ===');
        
    } catch (error) {
        console.error('[processAttendanceFromQR] 에러:', error);
        showQRScanToast(null, 'error', error.message);
        
        setTimeout(() => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.resume();
            }
        }, 2000);
    }
}

// 특정 학생의 특정 날짜에 등록된 모든 선생님 일정 중 가장 빠른 일정을 찾는 함수
function findEarliestScheduleForStudent(studentId, dateStr) {
    let earliestSchedule = null;
    let earliestTime = null;
    let earliestTeacherId = null;
    let allSchedulesForDate = []; // 같은 날의 모든 일정 수집
    const studentKey = String(studentId);
    const dateKey = String(dateStr);
    
    console.log('[findEarliestScheduleForStudent] 학생 ID:', studentId, '날짜:', dateStr);
    console.log('[findEarliestScheduleForStudent] 전체 teacherScheduleData:', Object.keys(teacherScheduleData));
    console.log('[findEarliestScheduleForStudent] teacherScheduleData 상태:', Object.keys(teacherScheduleData).length > 0 ? '데이터 있음' : '데이터 없음');
    
    // 모든 선생님의 일정을 순회
    for (const teacherId in teacherScheduleData) {
        const teacherSchedule = teacherScheduleData[teacherId] || {};
        const studentSchedule = teacherSchedule[studentKey] || {};
        const rawData = studentSchedule[dateKey];
        if (!rawData) continue;
        
        // ★ 배열 또는 단일 객체 모두 처리
        const entries = Array.isArray(rawData) ? rawData : [rawData];
        
        for (const classInfo of entries) {
            if (!classInfo || !classInfo.start || classInfo.start === 'default') continue;
            
            console.log(`[findEarliestScheduleForStudent] 선생님 ${teacherId}: ${classInfo.start}`);
            
            const [hour, minute] = classInfo.start.split(':').map(Number);
            if (isNaN(hour) || isNaN(minute)) continue;
            const scheduleTime = new Date();
            scheduleTime.setHours(hour, minute, 0, 0);
            
            allSchedulesForDate.push({
                teacherId: teacherId,
                schedule: classInfo,
                scheduleTime: scheduleTime
            });
            
            if (!earliestTime || scheduleTime < earliestTime) {
                earliestTime = scheduleTime;
                earliestSchedule = classInfo;
                earliestTeacherId = teacherId;
            }
        }
    }
    
    if (earliestSchedule) {
        console.log('[findEarliestScheduleForStudent] 가장 빠른 일정:', earliestSchedule.start, '선생님:', earliestTeacherId);
        console.log('[findEarliestScheduleForStudent] 해당 날짜 전체 일정 수:', allSchedulesForDate.length);
    } else {
        console.log('[findEarliestScheduleForStudent] 로컬 캐시에 해당 날짜 일정이 없음 - DB에서 직접 조회 필요');
    }
    
    return {
        schedule: earliestSchedule,
        teacherId: earliestTeacherId,
        allSchedules: allSchedulesForDate  // 모든 일정 반환
    };
}

// 출석 상태 판단 (60분 기준)
function determineAttendanceStatus(currentTime, scheduledTimeStr) {
    const [scheduledHour, scheduledMinute] = scheduledTimeStr.split(':').map(Number);
    
    const scheduledTime = new Date(currentTime);
    scheduledTime.setHours(scheduledHour, scheduledMinute, 0, 0);
    
    const diffMinutes = Math.round((currentTime - scheduledTime) / (1000 * 60));
    
    console.log('[determineAttendanceStatus] 시간 차이(분):', diffMinutes);
    
    let status = 'present';
    // 수업 시작 후 ATTENDANCE_GRACE_MINUTES분까지는 출석
    if (diffMinutes <= ATTENDANCE_GRACE_MINUTES) {
        status = 'present';
    } 
    // grace 이후는 지각으로 처리 (결석 기준은 상위 로직에서 처리)
    else {
        status = 'late';
    }

    const scanTimeStr = currentTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    return {
        status,
        diffMinutes,
        scheduledTimeStr,
        scanTimeStr
    };
}

// QR 스캔 토스트 알림 표시
function showQRScanToast(student, status, extra) {
    let icon = '';
    let name = '';
    let statusText = '';
    let statusColor = '';
    let timeText = '';

    const existingToast = document.querySelector('.qr-scan-toast');
    if (existingToast) {
        existingToast.remove();
    }

    if (status === 'expired_qr') {
        icon = '❌';
        name = student ? `${student.name} (${student.grade})` : '만료된 QR코드';
        statusText = '만료된 QR코드';
        statusColor = '#ef4444';
        timeText = '재발급된 QR코드를 사용하세요';
    } else if (status === 'present') {
        icon = '✅';
        name = `${student.name} (${student.grade})`;
        statusColor = '#10b981';
        if (extra && typeof extra === 'object' && typeof extra.diffMinutes === 'number') {
            const diff = extra.diffMinutes;
            const diffAbs = Math.abs(diff);
            const diffText = diffAbs === 0 ? '정시 도착' : `${diffAbs}분 빠름`;
            statusText = diffAbs === 0 ? '출석 완료' : '출석 완료';
            timeText = `수업 ${extra.scheduledTimeStr} · 스캔 ${extra.scanTimeStr} · ${diffText}`;
        } else {
            statusText = '출석 완료';
            timeText = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        }
    } else if (status === 'late') {
        icon = '⏰';
        name = `${student.name} (${student.grade})`;
        statusColor = '#f59e0b';
        if (extra && typeof extra === 'object' && typeof extra.diffMinutes === 'number') {
            const diffAbs = Math.abs(extra.diffMinutes);
            statusText = `${diffAbs}분 지각`;
            timeText = `수업 ${extra.scheduledTimeStr} · 스캔 ${extra.scanTimeStr}`;
        } else {
            statusText = '지각 처리';
            timeText = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        }
    } else if (status === 'absent') {
        icon = '❌';
        name = `${student.name} (${student.grade})`;
        statusColor = '#ef4444';
        if (extra && typeof extra === 'object' && typeof extra.diffMinutes === 'number') {
            const diffAbs = Math.abs(extra.diffMinutes);
            statusText = '결석 처리';
            timeText = `수업 ${extra.scheduledTimeStr} · 스캔 ${extra.scanTimeStr} · ${diffAbs}분 지각`;
        } else {
            statusText = '결석 처리';
            timeText = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        }
    } else if (status === 'already_processed') {
        icon = '⚠️';
        name = `${student.name} (${student.grade})`;
        statusText = '이미 처리된 QR코드';
        statusColor = '#8b5cf6';
        const statusMap = {
            'present': '출석',
            'late': '지각',
            'absent': '결석',
            'makeup': '보강',
            'etc': '기타'
        };
        timeText = `기존 상태: ${statusMap[extra] || extra}`;
    } else if (status === 'temporary_present') {
        icon = '🟡';
        name = `${student.name} (${student.grade})`;
        statusText = '임시출석 처리';
        statusColor = '#d97706';
        const scanTime = extra && typeof extra === 'object' ? extra.scanTimeStr : '';
        timeText = scanTime
            ? `일정 미등록 · 스캔 ${scanTime} · 확정 대기`
            : '일정 미등록 · 확정 대기';
    } else if (status === 'temporary_pending') {
        icon = '🕘';
        name = `${student.name} (${student.grade})`;
        statusText = '미처리 저장';
        statusColor = '#475569';
        const scanTime = extra && typeof extra === 'object' ? extra.scanTimeStr : '';
        const autoStartTime = extra && typeof extra === 'object' ? extra.autoStartTime : '';
        const autoScheduleText = autoStartTime ? ` · 자동일정 ${autoStartTime}` : '';
        timeText = scanTime
            ? `일정 미등록 · 스캔 ${scanTime}${autoScheduleText}`
            : `일정 미등록${autoScheduleText}`;
    } else if (status === 'no_schedule') {
        icon = '📅';
        name = `${student.name} (${student.grade})`;
        statusText = '일정 미등록';
        statusColor = '#f59e0b';
        timeText = '시간표에서 일정을 먼저 등록해주세요';
    } else if (status === 'unregistered') {
        icon = '❌';
        name = '미등록 QR코드';
        statusText = '학생을 찾을 수 없습니다';
        statusColor = '#ef4444';
        timeText = 'QR코드를 다시 생성해주세요';
    } else if (status === 'error') {
        icon = '❌';
        name = '오류 발생';
        statusText = extra || '처리 실패';
        statusColor = '#ef4444';
        timeText = '';
    } else if (status === 'regenerate_success') {
        icon = '🔄';
        name = 'QR코드 재발급';
        statusText = '새로운 QR코드 생성 완료';
        statusColor = '#4f46e5';
        timeText = extra ? `${extra}` : '';
    }
    
    const toast = document.createElement('div');
    toast.className = 'qr-scan-toast';
    toast.innerHTML = `
        <div class="qr-toast-icon">${icon}</div>
        <div class="qr-toast-content">
            <div class="qr-toast-name">${name}</div>
            <div class="qr-toast-status" style="color: ${statusColor};">${statusText}</div>
            ${timeText ? `<div class="qr-toast-time">${timeText}</div>` : ''}
        </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 2500);
}

// ========== 임시출석 확정 대기함 ==========
let emergencyQueueDayFilter = 14;
let emergencySelectedRecordIds = new Set();

function isEmergencyAttendancePending(record) {
    if (!record) return false;
    const judgment = String(record.qr_judgment || '').trim();
    const memo = String(record.memo || '').trim();
    if (!judgment.includes('임시출석')) return false;
    if (judgment.includes('확정')) return false;
    if (memo.includes('[임시출석확정]')) return false;
    return true;
}

function escapePlainText(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function fetchEmergencyAttendancePendingRows() {
    if (typeof supabase === 'undefined') return [];
    const ownerId = await ensureOwnerId();
    if (!ownerId) return [];

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 14);
    const sinceStr = formatDateToYYYYMMDD(sinceDate);

    let query = supabase
        .from('attendance_records')
        .select('id, owner_user_id, teacher_id, student_id, attendance_date, scheduled_time, check_in_time, status, qr_scanned, qr_scan_time, qr_judgment, memo, created_at')
        .eq('owner_user_id', ownerId)
        .gte('attendance_date', sinceStr)
        .order('attendance_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(80);

    if (typeof currentTeacherId !== 'undefined' && currentTeacherId) {
        query = query.eq('teacher_id', String(currentTeacherId));
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).filter(isEmergencyAttendancePending);
}

function resolveCurrentTeacherDisplayName() {
    const currentId = String(currentTeacherId || '');
    if (!currentId) return '미지정 선생님';
    return getTeacherNameById(currentId);
}

function syncEmergencySelectedRows(rows) {
    const rowIdSet = new Set((rows || []).map((row) => String(row.id)));
    emergencySelectedRecordIds = new Set(
        Array.from(emergencySelectedRecordIds).filter((id) => rowIdSet.has(String(id)))
    );
}

async function applyEmergencyAttendanceConfirmation(recordId, reasonText, confirmedByName) {
    const ownerId = await ensureOwnerId();
    if (!ownerId) throw new Error('로그인이 필요합니다');

    const { data: target, error: targetError } = await supabase
        .from('attendance_records')
        .select('id, memo, qr_judgment')
        .eq('owner_user_id', ownerId)
        .eq('id', recordId)
        .single();
    if (targetError) throw targetError;
    if (!target) throw new Error('확정 대상을 찾을 수 없습니다.');

    const confirmedAt = new Date().toISOString();
    const confirmText = String(reasonText || '').trim() || '사유 미입력';
    const actor = String(confirmedByName || '').trim() || '미지정 선생님';

    const nextJudgment = `임시출석 확정(${actor}): ${confirmText}`;
    const memoLine = `[임시출석확정] ${confirmedAt} / 확정자: ${actor} / 사유: ${confirmText}`;
    const prevMemo = String(target.memo || '').trim();
    const nextMemo = prevMemo ? `${prevMemo}\n${memoLine}` : memoLine;

    const { error: updateError } = await supabase
        .from('attendance_records')
        .update({
            qr_judgment: nextJudgment,
            memo: nextMemo
        })
        .eq('owner_user_id', ownerId)
        .eq('id', recordId);
    if (updateError) throw updateError;
}

window.renderEmergencyAttendanceQueue = async function() {
    const container = document.getElementById('emergency-attendance-queue');
    if (!container) return;

    try {
        const allRows = await fetchEmergencyAttendancePendingRows();
        const rows = allRows.filter((row) => {
            const dateValue = new Date(`${row.attendance_date}T00:00:00`);
            if (Number.isNaN(dateValue.getTime())) return false;
            const cut = new Date();
            cut.setHours(0, 0, 0, 0);
            cut.setDate(cut.getDate() - Math.max(1, Number(emergencyQueueDayFilter || 14)));
            return dateValue >= cut;
        });
        syncEmergencySelectedRows(rows);

        if (!rows.length) {
            container.innerHTML = `
                <div class="emg-queue-card">
                    <div class="emg-queue-head">
                        <div class="emg-queue-title"><i class="fas fa-hourglass-half"></i> 임시출석 확정 대기함</div>
                        <span class="emg-queue-count">0건</span>
                    </div>
                    <div class="emg-queue-toolbar">
                        <label class="emg-filter-label">조회 기간</label>
                        <select class="emg-filter-select" onchange="setEmergencyAttendanceFilterDays(this.value)">
                            <option value="7" ${Number(emergencyQueueDayFilter) === 7 ? 'selected' : ''}>최근 7일</option>
                            <option value="14" ${Number(emergencyQueueDayFilter) === 14 ? 'selected' : ''}>최근 14일</option>
                            <option value="30" ${Number(emergencyQueueDayFilter) === 30 ? 'selected' : ''}>최근 30일</option>
                        </select>
                    </div>
                    <div class="emg-empty">현재 확정 대기 중인 임시출석이 없습니다.</div>
                </div>
            `;
            return;
        }

        const allChecked = rows.length > 0 && rows.every((row) => emergencySelectedRecordIds.has(String(row.id)));
        const itemHtml = rows.map((row) => {
            const student = (students || []).find((s) => String(s.id) === String(row.student_id));
            const studentName = student ? `${student.name} (${student.grade || '-'})` : `학생#${row.student_id}`;
            const dateLabel = row.attendance_date || '-';
            const scanLabel = row.qr_scan_time
                ? new Date(row.qr_scan_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                : '-';
            const teacherName = row.teacher_id ? getTeacherNameById(String(row.teacher_id)) : '선생님 미지정';
            const checked = emergencySelectedRecordIds.has(String(row.id)) ? 'checked' : '';

            return `
                <div class="emg-queue-item">
                    <div class="emg-row-top">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" class="emg-row-check" value="${row.id}" ${checked} onchange="toggleEmergencyAttendanceSelection('${row.id}', this.checked)">
                            <div class="emg-student">${escapePlainText(studentName)}</div>
                        </div>
                        <div class="emg-date">${escapePlainText(dateLabel)} · ${escapePlainText(scanLabel)}</div>
                    </div>
                    <div style="margin-top:4px;font-size:11px;color:#64748b;">담당: ${escapePlainText(teacherName)} · 상태: ${escapePlainText(row.status || 'present')}</div>
                    <textarea id="emg-reason-${row.id}" class="emg-note" placeholder="확정 사유를 입력하세요. (예: 시간표 누락으로 임시출석 후 확인)"></textarea>
                    <div class="emg-actions">
                        <button class="emg-confirm-btn" onclick="confirmEmergencyAttendance('${row.id}')">
                            <i class="fas fa-check-circle"></i> 임시출석 확정
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="emg-queue-card">
                <div class="emg-queue-head">
                    <div class="emg-queue-title"><i class="fas fa-hourglass-half"></i> 임시출석 확정 대기함</div>
                    <span class="emg-queue-count">${rows.length}건</span>
                </div>
                <div class="emg-queue-toolbar">
                    <label class="emg-filter-label">조회 기간</label>
                    <select class="emg-filter-select" onchange="setEmergencyAttendanceFilterDays(this.value)">
                        <option value="7" ${Number(emergencyQueueDayFilter) === 7 ? 'selected' : ''}>최근 7일</option>
                        <option value="14" ${Number(emergencyQueueDayFilter) === 14 ? 'selected' : ''}>최근 14일</option>
                        <option value="30" ${Number(emergencyQueueDayFilter) === 30 ? 'selected' : ''}>최근 30일</option>
                    </select>
                </div>
                <div class="emg-bulk-controls">
                    <label class="emg-select-all-wrap">
                        <input type="checkbox" id="emg-select-all" ${allChecked ? 'checked' : ''} onchange="toggleEmergencyAttendanceSelectAll(this.checked)">
                        <span>전체 선택</span>
                    </label>
                    <textarea id="emg-bulk-reason" class="emg-note emg-note-bulk" placeholder="일괄 확정 사유 (비워두면 각 행 사유/기본값 사용)"></textarea>
                    <div class="emg-actions" style="margin-top:6px;">
                        <button class="emg-confirm-btn" onclick="confirmSelectedEmergencyAttendance()">
                            <i class="fas fa-check-double"></i> 선택 항목 일괄 확정
                        </button>
                    </div>
                </div>
                ${itemHtml}
            </div>
        `;
    } catch (error) {
        console.error('[renderEmergencyAttendanceQueue] 에러:', error);
        container.innerHTML = `
            <div class="emg-queue-card">
                <div class="emg-queue-head">
                    <div class="emg-queue-title"><i class="fas fa-hourglass-half"></i> 임시출석 확정 대기함</div>
                </div>
                <div class="emg-empty">대기함을 불러오지 못했습니다.</div>
            </div>
        `;
    } finally {
        try {
            const qrModal = document.getElementById('qr-attendance-modal');
            if (qrModal && qrModal.style.display === 'flex' && typeof renderQRTodaySummary === 'function') {
                renderQRTodaySummary();
            }
        } catch (summaryErr) {
            console.error('[renderEmergencyAttendanceQueue] 요약 갱신 실패:', summaryErr);
        }
    }
};

window.setEmergencyAttendanceFilterDays = function(days) {
    const parsed = Number(days);
    emergencyQueueDayFilter = [7, 14, 30].includes(parsed) ? parsed : 14;
    window.renderEmergencyAttendanceQueue();
};

window.toggleEmergencyAttendanceSelection = function(recordId, checked) {
    const id = String(recordId);
    if (checked) emergencySelectedRecordIds.add(id);
    else emergencySelectedRecordIds.delete(id);

    const allRowChecks = Array.from(document.querySelectorAll('.emg-row-check'));
    const selectAll = document.getElementById('emg-select-all');
    if (selectAll) {
        selectAll.checked = allRowChecks.length > 0 && allRowChecks.every((cb) => cb.checked);
    }
};

window.toggleEmergencyAttendanceSelectAll = function(checked) {
    const checks = Array.from(document.querySelectorAll('.emg-row-check'));
    checks.forEach((cb) => {
        cb.checked = checked;
        const id = String(cb.value || '');
        if (!id) return;
        if (checked) emergencySelectedRecordIds.add(id);
        else emergencySelectedRecordIds.delete(id);
    });
};

window.confirmSelectedEmergencyAttendance = async function() {
    try {
        const selectedIds = Array.from(emergencySelectedRecordIds);
        if (!selectedIds.length) {
            showToast('일괄 확정할 항목을 먼저 선택해주세요.', 'warning');
            return;
        }
        const bulkReasonEl = document.getElementById('emg-bulk-reason');
        const bulkReason = String(bulkReasonEl ? bulkReasonEl.value : '').trim();
        const actorName = resolveCurrentTeacherDisplayName();

        for (const recordId of selectedIds) {
            const perReasonEl = document.getElementById(`emg-reason-${recordId}`);
            const perReason = String(perReasonEl ? perReasonEl.value : '').trim();
            await applyEmergencyAttendanceConfirmation(recordId, bulkReason || perReason, actorName);
        }

        emergencySelectedRecordIds = new Set();
        showToast(`임시출석 ${selectedIds.length}건이 일괄 확정되었습니다.`, 'success');
        await window.renderEmergencyAttendanceQueue();
        if (typeof renderQRTodaySummary === 'function') renderQRTodaySummary();
    } catch (error) {
        console.error('[confirmSelectedEmergencyAttendance] 에러:', error);
        showToast(`일괄 확정 실패: ${error.message}`, 'error');
    }
};

window.confirmEmergencyAttendance = async function(recordId) {
    try {
        const reasonEl = document.getElementById(`emg-reason-${recordId}`);
        const reason = String(reasonEl ? reasonEl.value : '').trim();
        const actorName = resolveCurrentTeacherDisplayName();
        await applyEmergencyAttendanceConfirmation(recordId, reason, actorName);

        emergencySelectedRecordIds.delete(String(recordId));
        showToast('임시출석이 확정되었습니다.', 'success');
        if (typeof window.renderEmergencyAttendanceQueue === 'function') {
            await window.renderEmergencyAttendanceQueue();
        }
        if (typeof renderQRTodaySummary === 'function') {
            renderQRTodaySummary();
        }
    } catch (error) {
        console.error('[confirmEmergencyAttendance] 에러:', error);
        showToast(`임시출석 확정 실패: ${error.message}`, 'error');
    }
};

// ========== 학생 QR 코드 목록 ==========

window.showStudentQRList = async function() {
    console.log('[showStudentQRList] 학생 QR 코드 목록 표시');
    
    try {
        // ✅ 학생 데이터가 비어있으면 Supabase에서 다시 로드 (모바일 네트워크 지연 대응)
        if (!students || students.length === 0) {
            console.log('[showStudentQRList] 학생 데이터 없음 - Supabase에서 재로드 시도');
            if (typeof getAllStudents === 'function') {
                const supabaseStudents = await getAllStudents();
                if (supabaseStudents && supabaseStudents.length > 0) {
                    students = supabaseStudents.map(s => ({
                        id: s.id,
                        name: s.name,
                        school: s.school || '',
                        grade: s.grade,
                        studentPhone: s.phone || '',
                        parentPhone: s.parent_phone || '',
                        defaultFee: s.default_fee || 0,
                        specialLectureFee: s.special_lecture_fee || 0,
                        defaultTextbookFee: s.default_textbook_fee || 0,
                        memo: s.memo || '',
                        registerDate: s.register_date || '',
                        status: s.status || 'active',
                        parentCode: s.parent_code || '',
                        studentCode: s.student_code || '',
                        events: [],
                        attendance: {},
                        records: {},
                        payments: {}
                    }));
                    console.log('[showStudentQRList] Supabase에서 학생 데이터 재로드 완료:', students.length, '명');
                } else {
                    showToast('등록된 학생이 없습니다.\n먼저 학생을 등록해주세요.', 'warning');
                    return;
                }
            } else {
                showToast('등록된 학생이 없습니다.\n먼저 학생을 등록해주세요.', 'warning');
                return;
            }
        }
        
        if (typeof closeModal === 'function') {
            closeModal('qr-attendance-modal');
        }
        
        const modal = document.getElementById('student-qr-list-modal');
        if (modal) {
            modal.style.display = 'flex';
        } else {
            console.error('[showStudentQRList] student-qr-list-modal 요소를 찾을 수 없습니다');
            showToast('학생 QR코드 모달을 찾을 수 없습니다.', 'error');
            return;
        }
        
        await renderStudentQRList();
    } catch (error) {
        console.error('[showStudentQRList] 오류:', error);
        showToast('학생 QR코드 목록을 표시할 수 없습니다.', 'error');
    }
}

// 동명이인 감지 (QR 모듈용)
function getQRDuplicateNameSet() {
    const nameCount = {};
    (window.students || []).filter(s => s.status === 'active').forEach(s => {
        const n = (s.name || '').trim();
        if (n) nameCount[n] = (nameCount[n] || 0) + 1;
    });
    const dupNames = new Set();
    for (const [name, count] of Object.entries(nameCount)) {
        if (count > 1) dupNames.add(name);
    }
    return dupNames;
}

async function renderStudentQRList() {
    const listDiv = document.getElementById('student-qr-list');
    const countEl = document.getElementById('qr-student-count');
    
    if (!Array.isArray(students) || students.length === 0) {
        listDiv.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#94a3b8;"><i class="fas fa-user-slash" style="font-size:28px;margin-bottom:10px;display:block;opacity:0.5;"></i><p style="font-size:13px;margin:0;">등록된 학생이 없습니다</p></div>';
        if (countEl) countEl.textContent = '';
        return;
    }

    const avatarColors = ['#6366f1','#ec4899','#f59e0b','#10b981','#8b5cf6','#ef4444','#0ea5e9','#f97316'];
    const activeStudents = students.filter(s => s.status === 'active');
    const dupNames = getQRDuplicateNameSet();
    let html = '';

    activeStudents.forEach((student, idx) => {
        const qrId = `qr-${student.id}`;
        const accordionId = `accordion-${student.id}`;
        const color = avatarColors[idx % avatarColors.length];
        const initial = (student.name || '?').charAt(0);
        // 이름/학년에서 특수문자 이스케이프
        const safeName = (student.name || '').replace(/'/g, "\\'");
        const isDup = dupNames.has((student.name || '').trim());
        const schoolTag = isDup && student.school ? `<span class="qr-item-school">${student.school}</span>` : '';

        html += `
        <div class="qr-item" data-student-id="${student.id}">
            <div class="qr-item-header" onclick="toggleQRAccordionLazy('${accordionId}', '${qrId}', '${student.id}')">
                <div class="qr-item-info">
                    <div class="qr-item-avatar" style="background:${color};">${initial}</div>
                    <span class="qr-item-name">${student.name}</span>
                    <span class="qr-item-grade">${student.grade}</span>
                    ${schoolTag}
                </div>
                <div class="qr-item-actions">
                    <button class="qr-regenerate-btn" onclick="event.stopPropagation(); regenerateQRCode('${student.id}', '${qrId}', '${accordionId}', '${safeName}')" title="QR코드 재발급">
                        <i class="fas fa-sync-alt"></i> 재발급
                    </button>
                    <i id="icon-${accordionId}" class="fas fa-chevron-down qr-item-chevron"></i>
                </div>
            </div>
            <div id="${accordionId}" class="qr-item-body">
                <div class="qr-item-body-inner">
                    <div id="${qrId}" style="display:flex;justify-content:center;margin-bottom:8px;"></div>
                    <button class="qr-download-btn" onclick="downloadQRCode('${qrId}', '${safeName}')">
                        <i class="fas fa-download"></i> 다운로드
                    </button>
                </div>
            </div>
        </div>`;
    });

    listDiv.innerHTML = html;
    if (countEl) countEl.textContent = `${activeStudents.length}명`;
}

// QR 데이터 지연 로드 - 아코디언 열 때만 QR 생성
window.toggleQRAccordionLazy = async function(accordionId, qrId, studentId) {
    const accordion = document.getElementById(accordionId);
    const icon = document.getElementById('icon-' + accordionId);
    if (!accordion) return;

    const isOpen = accordion.classList.contains('open');
    if (isOpen) {
        accordion.classList.remove('open');
        accordion.style.maxHeight = '0px';
        if (icon) icon.classList.remove('rotated');
        return;
    }

    // QR이 아직 생성되지 않았으면 지연 로드
    const qrContainer = document.getElementById(qrId);
    if (qrContainer && qrContainer.children.length === 0) {
        qrContainer.innerHTML = '<div style="text-align:center;padding:12px;color:#94a3b8;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> QR 생성 중...</div>';
        try {
            const qrData = await getOrCreateQRCodeData(studentId);
            qrContainer.innerHTML = '';
            generateQRCode(qrId, qrData, 200);
        } catch (e) {
            qrContainer.innerHTML = '<div style="text-align:center;padding:12px;color:#ef4444;font-size:12px;"><i class="fas fa-exclamation-triangle"></i> QR 생성 실패</div>';
        }
    }

    accordion.classList.add('open');
    accordion.style.maxHeight = accordion.scrollHeight + 'px';
    if (icon) icon.classList.add('rotated');
}

// QR 코드 재발급
window.regenerateQRCode = async function(studentId, qrId, accordionId, cleanName) {
    const newQrData = await generateQRCodeData(studentId);
    
    // DB 저장 검증
    const savedToken = await getStudentQrTokenFromDb(studentId);
    const expectedToken = newQrData.split('_').slice(2).join('_');
    if (savedToken !== expectedToken) {
        console.warn('[regenerateQRCode] DB 저장 검증 실패');
    }

    const qrContainer = document.getElementById(qrId);
    if (!qrContainer) return;

    qrContainer.innerHTML = '';

    generateQRCode(qrId, newQrData, 200);

    const accordion = document.getElementById(accordionId);
    if (accordion && accordion.style.maxHeight !== '0px' && accordion.style.maxHeight !== '') {
        setTimeout(() => {
            accordion.style.maxHeight = accordion.scrollHeight + 'px';
        }, 100);
    }

    // ✅ QR 재발급 후 일정 데이터 강제 동기화 (PC/모바일 일관성 보장)
    // 모바일에서도 다음 QR 스캔 시 최신 일정을 확인하도록 캐시 초기화
    if (typeof loadAllSchedulesForOwner === 'function') {
        console.log('[regenerateQRCode] QR 재발급 후 일정 데이터 동기화 시작');
        loadAllSchedulesForOwner().then(() => {
            console.log('[regenerateQRCode] 일정 데이터 동기화 완료');
        }).catch(err => {
            console.error('[regenerateQRCode] 일정 동기화 실패:', err);
        });
    }

    // 학생 인증코드도 함께 재생성 (QR과 1:1 대응)
    if (typeof generateStudentCode === 'function') {
        const newStudentCode = generateStudentCode();
        const s = (typeof students !== 'undefined') ? students.find(x => String(x.id) === String(studentId)) : null;
        if (s) { s.studentCode = newStudentCode; if (typeof saveData === 'function') saveData(true); }
        try {
            if (typeof updateStudent === 'function') await updateStudent(studentId, { student_code: newStudentCode });
        } catch(e) { console.error('[regenerateQRCode] student_code 업데이트 실패:', e); }
    }

    showQRScanToast(null, 'regenerate_success', cleanName);

    console.log('[regenerateQRCode] QR 코드 재발급 완료');
}

window.toggleQRAccordion = function(accordionId, qrId, qrData) {
    const accordion = document.getElementById(accordionId);
    const icon = document.getElementById(`icon-${accordionId}`);
    const qrContainer = document.getElementById(qrId);
    
    if (accordion.style.maxHeight && accordion.style.maxHeight !== '0px') {
        accordion.style.maxHeight = '0px';
        if (icon) icon.classList.remove('open');
    } else {
        accordion.style.maxHeight = accordion.scrollHeight + 'px';
        if (icon) icon.classList.add('open');
        
        if (!qrContainer.hasChildNodes()) {
            setTimeout(() => {
                generateQRCode(qrId, qrData, 200);
                accordion.style.maxHeight = accordion.scrollHeight + 'px';
            }, 50);
        }
    }
}

// QR 학생 목록 검색 필터
window.filterQRStudentList = function() {
    const query = (document.getElementById('qr-student-search')?.value || '').trim().toLowerCase();
    const items = document.querySelectorAll('#student-qr-list .qr-item, #student-qr-list .qr-item-error');
    let visible = 0;
    items.forEach(item => {
        const nameEl = item.querySelector('.qr-item-name');
        const gradeEl = item.querySelector('.qr-item-grade');
        const name = nameEl ? nameEl.textContent.toLowerCase() : '';
        const grade = gradeEl ? gradeEl.textContent.toLowerCase() : '';
        const match = !query || name.includes(query) || grade.includes(query);
        item.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    const countEl = document.getElementById('qr-student-count');
    if (countEl) countEl.textContent = query ? `${visible}명 검색` : `${items.length}명`;

    // 빈 검색 결과 메시지
    let emptyMsg = document.getElementById('qr-search-empty');
    if (query && visible === 0) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'qr-search-empty';
            emptyMsg.style.cssText = 'text-align:center;padding:30px 20px;color:#94a3b8;font-size:13px;';
            emptyMsg.innerHTML = '<i class="fas fa-search" style="font-size:22px;margin-bottom:8px;display:block;opacity:0.4;"></i>검색 결과가 없습니다';
            document.getElementById('student-qr-list').appendChild(emptyMsg);
        }
        emptyMsg.style.display = '';
    } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
    }
};

window.downloadQRCode = function(qrId, studentName) {
    const qrContainer = document.getElementById(qrId);
    const canvas = qrContainer.querySelector('canvas');
    
    if (!canvas) {
        showToast('QR 코드를 찾을 수 없습니다.', 'error');
        return;
    }
    
    // 여백을 포함한 더 큰 캔버스 생성 (각 방향으로 40px 여백)
    const padding = 40;
    const newCanvas = document.createElement('canvas');
    const ctx = newCanvas.getContext('2d');
    
    newCanvas.width = canvas.width + (padding * 2);
    newCanvas.height = canvas.height + (padding * 2);
    
    // 전체를 흰색 배경으로 채우기
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    
    // QR 코드를 중앙에 그리기
    ctx.drawImage(canvas, padding, padding);
    
    // 다운로드
    const link = document.createElement('a');
    link.download = `QR_${studentName}.png`;
    link.href = newCanvas.toDataURL('image/png');
    link.click();
}

// ========== 학생별 출석 기록 ==========

window.showStudentAttendanceHistory = function(studentId) {
    currentStudentForAttendance = studentId;
    
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('attendance-history-month').value = monthStr;
    
    const student = students.find(s => String(s.id) === String(studentId)) ||
        currentTeacherStudents.find(s => String(s.id) === String(studentId));
    if (student) {
        const titleElement = document.getElementById('attendance-student-name-title');
        if (titleElement) {
            titleElement.textContent = `${student.name}님의 출석 기록`;
        }
    }
    
    if (typeof closeModal === 'function') {
        closeModal('qr-attendance-modal');
    }
    document.getElementById('student-attendance-history-modal').style.display = 'flex';
    
    loadStudentAttendanceHistory();
}

window.loadStudentAttendanceHistory = async function() {
    try {
        if (!currentStudentForAttendance) return;
        
        const monthStr = document.getElementById('attendance-history-month').value;
        if (!monthStr) {
            showToast('조회할 월을 선택해주세요.', 'warning');
            return;
        }
        
        const [year, month] = monthStr.split('-').map(Number);
        const contentDiv = document.getElementById('attendance-history-content');
        
        contentDiv.innerHTML = '<p style="color: #64748b;">로딩 중...</p>';
        
        const records = await getStudentAttendanceRecordsByMonth(currentStudentForAttendance, year, month);
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0);
        const endDateStr = formatDateToYYYYMMDD(endDate);

        // ★ 배정된 선생님 기준으로 필터링
        const assignedTeacherId = (typeof getAssignedTeacherId === 'function')
            ? String(getAssignedTeacherId(String(currentStudentForAttendance)) || '')
            : '';
        const primaryTeacherId = assignedTeacherId || (currentTeacherId ? String(currentTeacherId) : '');

        let schedules = [];
        if (typeof getSchedulesByStudent === 'function') {
            try {
                schedules = await getSchedulesByStudent(currentStudentForAttendance);
            } catch (e) {
                console.error('[loadStudentAttendanceHistory] 일정 조회 실패:', e);
            }
        }

        const schedulesInMonth = (schedules || []).filter(s => s.schedule_date >= startDate && s.schedule_date <= endDateStr);

        // ★ 배정된 선생님의 일정/기록만 메인으로, 나머지는 "기타" 정보로
        // 슬롯 키(날짜+시간) 단위로 묶어 동일 날짜 다중 수업(예: 19:00/22:00)이
        // 이력 화면에서 한 건으로 덮어써 보이지 않도록 처리한다.
        const normalizeTimeKey = (raw) => {
            if (!raw) return 'default';
            const text = String(raw);
            if (text.length >= 5 && text.indexOf(':') > -1) return text.substring(0, 5);
            return 'default';
        };
        const toSlotKey = (dateVal, timeVal) => `${dateVal}__${normalizeTimeKey(timeVal)}`;
        const fromSlotKey = (slotKey) => {
            const idx = slotKey.lastIndexOf('__');
            if (idx < 0) return { date: slotKey, time: 'default' };
            return {
                date: slotKey.substring(0, idx),
                time: slotKey.substring(idx + 2) || 'default'
            };
        };

        const primaryScheduleBySlot = new Map();
        const otherScheduleBySlot = new Map();
        schedulesInMonth.forEach(s => {
            const key = toSlotKey(s.schedule_date, s.start_time);
            if (primaryTeacherId && String(s.teacher_id) === primaryTeacherId) {
                if (!primaryScheduleBySlot.has(key)) primaryScheduleBySlot.set(key, []);
                primaryScheduleBySlot.get(key).push(s);
            } else {
                if (!otherScheduleBySlot.has(key)) otherScheduleBySlot.set(key, []);
                otherScheduleBySlot.get(key).push(s);
            }
        });

        const primaryRecordBySlot = new Map();
        const otherRecordBySlot = new Map();
        (records || []).forEach(r => {
            const key = toSlotKey(r.attendance_date, r.scheduled_time);
            if (primaryTeacherId && String(r.teacher_id) === primaryTeacherId) {
                if (!primaryRecordBySlot.has(key)) primaryRecordBySlot.set(key, []);
                primaryRecordBySlot.get(key).push(r);
            } else {
                if (!otherRecordBySlot.has(key)) otherRecordBySlot.set(key, []);
                otherRecordBySlot.get(key).push(r);
            }
        });

        // ★ 담당 선생님 슬롯 + 담당 없을 때 다른 선생님 슬롯도 포함
        const primarySlots = new Set([...primaryScheduleBySlot.keys(), ...primaryRecordBySlot.keys()]);
        const otherSlots = new Set([...otherScheduleBySlot.keys(), ...otherRecordBySlot.keys()]);
        const allSlots = new Set([...primarySlots, ...otherSlots]);
        
        if (allSlots.size === 0) {
            const teacherName = primaryTeacherId ? getTeacherNameById(primaryTeacherId) : '선생님';
            contentDiv.innerHTML = `<p style="color: #64748b; text-align: center;">
                ${year}년 ${month}월에 출석 기록이 없습니다.
            </p>`;
            return;
        }
        
        const stats = { present: 0, late: 0, absent: 0, makeup: 0 };
        const formatHistoryTime = (raw, withSeconds = false) => {
            if (!raw) return '';
            const dt = new Date(raw);
            if (Number.isNaN(dt.getTime())) return '';
            const opts = withSeconds
                ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' };
            return dt.toLocaleTimeString('ko-KR', opts);
        };
        const resolveHistoryMeta = (recordLike) => {
            if (!recordLike) {
                return {
                    sourceLabel: '미처리',
                    sourceStyle: 'color:#475569;background:#e2e8f0;',
                    authTime: '',
                    processedTime: '',
                    presenceCheckLabel: '미확인',
                    presenceCheckStyle: 'color:#6b7280;background:#f1f5f9;'
                };
            }
            const judgment = String(recordLike?.qr_judgment || '');
            const memoText = String(recordLike?.memo || '');
            const source = String(recordLike?.attendance_source || '').trim();
            const hasPhoneAuth = source === 'phone' || source === 'teacher_manual' || judgment.includes('전화번호인증') || memoText.includes('[전화번호인증]');
            const hasTeacherPresenceCheck = (recordLike?.presence_checked === true) || /(재석 확인|지각 확인|부재 확인|보강 처리)/.test(judgment);
            const isEmergency = source === 'emergency' || judgment.includes('임시출석');

            let sourceLabel = '선생님 체크';
            let sourceStyle = 'color:#6366f1;background:#eef2ff;';
            if (source === 'unknown') {
                sourceLabel = '기존기록';
                sourceStyle = 'color:#475569;background:#e2e8f0;';
            } else if (isEmergency) {
                sourceLabel = '임시출석';
                sourceStyle = 'color:#b45309;background:#fef3c7;';
            } else if (source === 'qr' || source === 'qr_student' || recordLike?.qr_scanned) {
                sourceLabel = 'QR 스캔';
                sourceStyle = 'color:#047857;background:#d1fae5;';
            } else if (hasPhoneAuth) {
                sourceLabel = '번호 입력';
                sourceStyle = 'color:#1d4ed8;background:#dbeafe;';
            }

            const authTime = formatHistoryTime(recordLike?.auth_time, true)
                || (recordLike?.qr_scanned
                    ? formatHistoryTime(recordLike?.qr_scan_time, true)
                    : (hasPhoneAuth ? formatHistoryTime(recordLike?.check_in_time, true) : ''));
            const processedTime = formatHistoryTime(recordLike?.processed_at, true) || formatHistoryTime(recordLike?.check_in_time, true);
            const presenceCheckLabel = hasTeacherPresenceCheck ? '확인함' : '미확인';
            const presenceCheckStyle = hasTeacherPresenceCheck
                ? 'color:#065f46;background:#d1fae5;'
                : 'color:#6b7280;background:#f1f5f9;';

            return { sourceLabel, sourceStyle, authTime, processedTime, presenceCheckLabel, presenceCheckStyle };
        };

        const slotList = Array.from(allSlots).sort((a, b) => {
            const slotA = fromSlotKey(a);
            const slotB = fromSlotKey(b);
            if (slotA.date !== slotB.date) return slotA.date < slotB.date ? 1 : -1;
            return slotA.time < slotB.time ? 1 : -1;
        });
        const totalSlots = slotList.length;
        
        let detailsHtml = '';

        for (const slotKey of slotList) {
            const parsedSlot = fromSlotKey(slotKey);
            const dateKey = parsedSlot.date;
            const slotTimeKey = parsedSlot.time;
            const date = new Date(dateKey);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

            // 배정된 선생님의 기록/일정
            const myRecords = primaryRecordBySlot.get(slotKey) || [];
            const mySchedules = primaryScheduleBySlot.get(slotKey) || [];
            const otherRecords = otherRecordBySlot.get(slotKey) || [];
            const otherSchedules = otherScheduleBySlot.get(slotKey) || [];
            
            // 담당 선생님 기록 우선, 없으면 다른 선생님 기록도 표시 (QR 스캔 등으로 다른 teacher_id로 저장된 경우 대응)
            const effectiveRecord = myRecords[0] || otherRecords[0] || null;
            const effectiveSchedule = mySchedules[0] || otherSchedules[0] || null;
            const isFallback = !myRecords.length && !mySchedules.length && (otherRecords.length > 0 || otherSchedules.length > 0);
            const fallbackTeacherName = isFallback ? getTeacherNameById(String(effectiveRecord?.teacher_id || effectiveSchedule?.teacher_id || '')) : '';

            // 통계 집계
            const statusValue = effectiveRecord ? effectiveRecord.status : '';
            if (statusValue === 'present') stats.present++;
            else if (statusValue === 'late') stats.late++;
            else if (statusValue === 'absent') stats.absent++;
            else if (statusValue === 'makeup' || statusValue === 'etc') stats.makeup++;
            const { statusBadge, statusColor, bgColor, borderColor } = getStatusStyle(statusValue);

            const fallbackScheduledTime = slotTimeKey !== 'default' ? slotTimeKey : '';
            let timeLabel = fallbackScheduledTime ? formatKoreanTimeLabel(fallbackScheduledTime) : '-';
            if (effectiveRecord && effectiveRecord.check_in_time) {
                timeLabel = new Date(effectiveRecord.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            } else if (effectiveSchedule && effectiveSchedule.start_time) {
                timeLabel = formatKoreanTimeLabel(effectiveSchedule.start_time.substring(0, 5));
            }

            // ★ 해당 날짜의 모든 일정 (담당 + 다른 선생님) → 호버 툴팁
            const hasPrimaryData = myRecords.length > 0 || mySchedules.length > 0;
            const hasOtherTeachers = (hasPrimaryData && (otherRecords.length > 0 || otherSchedules.length > 0));

            let tooltipHtml = '';
            if (hasOtherTeachers) {
                // 담당 선생님 일정 정보
                const myTeacherName = primaryTeacherId ? getTeacherNameById(primaryTeacherId) : '담당';
                const primaryRecord = myRecords[0] || null;
                const primarySchedule = mySchedules[0] || null;
                const myTime = primarySchedule?.start_time
                    ? formatKoreanTimeLabel(primarySchedule.start_time.substring(0, 5))
                    : (primaryRecord?.scheduled_time ? formatKoreanTimeLabel(String(primaryRecord.scheduled_time).substring(0, 5)) : '-');
                const myStatusLabel = primaryRecord ? statusToLabel(primaryRecord.status) : '미처리';
                const myStatusStyle = getStatusStyle(primaryRecord?.status || '');

                let tooltipItems = `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><span style="font-weight:700;color:#93c5fd;">${myTeacherName}</span><span style="color:#94a3b8;font-size:12px;">${myTime}</span><span style="background:${myStatusStyle.statusColor};color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${myStatusLabel}</span></div>`;

                // 다른 선생님 일정 정보
                const otherTeacherIds = new Set([
                    ...otherRecords.map(r => String(r.teacher_id)),
                    ...otherSchedules.map(s => String(s.teacher_id))
                ].filter(Boolean));

                otherTeacherIds.forEach(tid => {
                    const rec = otherRecords.find(r => String(r.teacher_id) === tid) || null;
                    const sched = otherSchedules.find(s => String(s.teacher_id) === tid) || null;
                    const tName = getTeacherNameById(tid);
                    const tStatus = rec ? statusToLabel(rec.status) : '미처리';
                    const tTime = sched?.start_time
                        ? formatKoreanTimeLabel(sched.start_time.substring(0, 5))
                        : (rec?.scheduled_time ? formatKoreanTimeLabel(String(rec.scheduled_time).substring(0, 5)) : '-');
                    const tStatusStyle = getStatusStyle(rec?.status || '');
                    tooltipItems += `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;"><span style="font-weight:600;color:#e2e8f0;">${tName}</span><span style="color:#94a3b8;font-size:12px;">${tTime}</span><span style="background:${tStatusStyle.statusColor};color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${tStatus}</span></div>`;
                });

                tooltipHtml = `
                    <div class="att-day-tooltip" style="display:none;position:absolute;bottom:calc(100% + 8px);left:16px;background:#1e293b;color:white;padding:12px 14px;border-radius:10px;font-size:13px;min-width:220px;max-width:320px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.25);line-height:1.5;">
                        <div style="font-weight:700;margin-bottom:6px;font-size:12px;color:#94a3b8;letter-spacing:0.5px;">${dateStr} ${timeLabel} 슬롯</div>
                        ${tooltipItems}
                        <div style="position:absolute;bottom:-6px;left:24px;width:12px;height:12px;background:#1e293b;rotate:45deg;border-radius:2px;"></div>
                    </div>`;
            }

            const existingMemo = (effectiveRecord && effectiveRecord.memo) ? effectiveRecord.memo : '';
            const escapedMemo = (existingMemo || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const scheduledTimeVal = effectiveRecord && effectiveRecord.scheduled_time
                ? effectiveRecord.scheduled_time
                : (effectiveSchedule && effectiveSchedule.start_time ? effectiveSchedule.start_time : fallbackScheduledTime);
            const historyMeta = resolveHistoryMeta(effectiveRecord);
            const classTimeLabel = fallbackScheduledTime ? formatKoreanTimeLabel(fallbackScheduledTime) : '-';
            const processedTimeLabel = historyMeta.processedTime || '-';
            const authTimeLabel = historyMeta.authTime || '-';

            detailsHtml += `
                <div class="att-day-row" style="position:relative;display:flex;flex-direction:column;padding:16px 18px;background:${bgColor};border-radius:12px;border-left:4px solid ${statusColor};border-top:1px solid ${borderColor};border-right:1px solid ${borderColor};border-bottom:1px solid ${borderColor};cursor:${hasOtherTeachers ? 'pointer' : 'default'};" ${hasOtherTeachers ? 'data-has-tooltip="true"' : ''}>
                    ${tooltipHtml}
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:15px;color:#1e293b;margin-bottom:6px;">
                                <span>${dateStr} (${getDayOfWeek(date)}) · ${fallbackScheduledTime ? formatKoreanTimeLabel(fallbackScheduledTime) : '-'}</span>
                                ${isFallback && fallbackTeacherName ? `<span style="font-size:11px;color:#8b5cf6;background:#ede9fe;padding:2px 7px;border-radius:5px;font-weight:600;">${fallbackTeacherName}</span>` : ''}
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span style="font-size:13px;color:#64748b;display:flex;align-items:center;gap:4px;">
                                    <span style="opacity:0.7;">🕒</span> 수업시간 ${classTimeLabel}
                                </span>
                                <span style="font-size:13px;color:#64748b;display:flex;align-items:center;gap:4px;">
                                    <span style="opacity:0.7;">✅</span> 처리시간 ${processedTimeLabel}
                                </span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;">
                                <span style="font-size:12px;${historyMeta.sourceStyle}padding:3px 8px;border-radius:6px;font-weight:600;">처리방식 ${historyMeta.sourceLabel}</span>
                                <span style="font-size:12px;color:#334155;background:#e2e8f0;padding:3px 8px;border-radius:6px;font-weight:600;">인증시간 ${authTimeLabel}</span>
                                <span style="font-size:12px;${historyMeta.presenceCheckStyle}padding:3px 8px;border-radius:6px;font-weight:600;">자리확인 ${historyMeta.presenceCheckLabel}</span>
                            </div>
                        </div>
                        <select
                            style="background:${statusColor};color:white;padding:8px 12px;border-radius:8px;font-weight:700;font-size:14px;border:none;cursor:pointer;flex-shrink:0;"
                            onclick="event.stopPropagation();"
                            onchange="updateAttendanceStatusFromHistory('${currentStudentForAttendance}', '${dateKey}', this.value, '${scheduledTimeVal}')">
                            <option value="" ${statusValue ? '' : 'selected'}>미처리</option>
                            <option value="present" ${statusValue === 'present' ? 'selected' : ''}>출석</option>
                            <option value="late" ${statusValue === 'late' ? 'selected' : ''}>지각</option>
                            <option value="absent" ${statusValue === 'absent' ? 'selected' : ''}>결석</option>
                            <option value="makeup" ${(statusValue === 'makeup' || statusValue === 'etc') ? 'selected' : ''}>보강</option>
                        </select>
                    </div>
                    <div class="att-memo-row" style="margin-top:8px;display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation();">
                        <i class="fas fa-pen-to-square" style="font-size:12px;color:#94a3b8;flex-shrink:0;"></i>
                        <input type="text" class="att-day-memo-input" data-date="${dateKey}" data-scheduled="${scheduledTimeVal}"
                            placeholder="메모 (지각/결석 사유 등)"
                            value="${escapedMemo}"
                            style="flex:1;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;background:#f8fafc;color:#334155;outline:none;transition:border-color 0.2s;"
                            onfocus="this.style.borderColor='#818cf8'"
                            onblur="this.style.borderColor='#e2e8f0'; saveAttMemoFromHistory(this)">
                    </div>
                    ${existingMemo ? `<div class="att-memo-preview" style="margin-top:4px;padding:2px 0 0 22px;font-size:11px;color:#64748b;display:none;">💬 ${escapedMemo}</div>` : ''}
                </div>
            `;
        }

        // 배정된 선생님 이름 표시
        const teacherName = primaryTeacherId ? getTeacherNameById(primaryTeacherId) : '';
        const teacherChip = teacherName ? `<span style="background:#e0e7ff;color:#4f46e5;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;">담당 선생님 : ${teacherName}</span>` : '';

        let html = `
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px;">
                <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px 12px; border-radius: 14px; text-align: center; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">
                    <div style="font-size: 32px; font-weight: 700; line-height: 1;">${stats.present}</div>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.95; font-weight: 500;">출석</div>
                </div>
                <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 20px 12px; border-radius: 14px; text-align: center; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);">
                    <div style="font-size: 32px; font-weight: 700; line-height: 1;">${stats.late}</div>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.95; font-weight: 500;">지각</div>
                </div>
                <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 20px 12px; border-radius: 14px; text-align: center; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);">
                    <div style="font-size: 32px; font-weight: 700; line-height: 1;">${stats.absent}</div>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.95; font-weight: 500;">결석</div>
                </div>
                <div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; padding: 20px 12px; border-radius: 14px; text-align: center; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);">
                    <div style="font-size: 32px; font-weight: 700; line-height: 1;">${stats.makeup}</div>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.95; font-weight: 500;">보강</div>
                </div>
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <h3 style="margin: 0; font-size: 18px; color: #1e293b;">상세 기록</h3>
                    ${teacherChip}
                </div>
                <span style="font-size: 14px; color: #64748b; font-weight: 500;">총 ${totalSlots}건</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${detailsHtml}
            </div>
        `;
        contentDiv.innerHTML = html;

        // ★ 날짜 행 호버 시 전체 일정 툴팁 표시 (마우스 + 모바일 터치)
        contentDiv.querySelectorAll('.att-day-row[data-has-tooltip="true"]').forEach(row => {
            const tooltip = row.querySelector('.att-day-tooltip');
            if (!tooltip) return;
            row.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
            row.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
                e.stopPropagation();
                const isVisible = tooltip.style.display === 'block';
                contentDiv.querySelectorAll('.att-day-tooltip').forEach(t => t.style.display = 'none');
                tooltip.style.display = isVisible ? 'none' : 'block';
            });
        });
        contentDiv.addEventListener('click', (e) => {
            if (e.target.closest('.att-day-row[data-has-tooltip="true"]')) return;
            contentDiv.querySelectorAll('.att-day-tooltip').forEach(t => t.style.display = 'none');
        });
        
    } catch (error) {
        console.error('[loadStudentAttendanceHistory] 에러:', error);
        document.getElementById('attendance-history-content').innerHTML = 
            '<p style="color: #ef4444;">출석 기록을 불러올 수 없습니다.</p>';
    }
}

async function updateAttendanceStatusFromHistory(studentId, dateStr, nextStatus, scheduledTime) {
    try {
        if (!nextStatus) {
            await loadStudentAttendanceHistory();
            return;
        }
        const teacherIds = await getTeacherIdsForStudentDate(studentId, dateStr);

        const currentId = currentTeacherId ? String(currentTeacherId) : null;
        const defaultTeacherId = currentId && teacherIds.has(currentId)
            ? currentId
            : (teacherIds.values().next().value || currentId || '');

        // ★ scheduledTime이 비어있으면 스케줄에서 start_time 폴백
        let effectiveScheduledTime = scheduledTime || '';
        if (!effectiveScheduledTime) {
            const tSchedule = (typeof teacherScheduleData !== 'undefined' ? teacherScheduleData : {})[defaultTeacherId] || {};
            const sSchedule = tSchedule[String(studentId)] || {};
            const scheduleEntry = sSchedule[dateStr] || null;
            if (scheduleEntry && scheduleEntry.start) {
                effectiveScheduledTime = scheduleEntry.start;
            }
        }

        const record = await getAttendanceRecordByStudentAndDate(studentId, dateStr, defaultTeacherId, effectiveScheduledTime);

        // ★ 기존 레코드의 scheduled_time 우선 사용 (onConflict 매칭을 위해)
        const resolvedScheduledTime = record?.scheduled_time || effectiveScheduledTime || null;

        const payload = {
            studentId: studentId,
            teacherId: String(record?.teacher_id || defaultTeacherId || ''),
            attendanceDate: dateStr,
            checkInTime: record?.check_in_time || new Date().toISOString(),
            scheduledTime: resolvedScheduledTime,
            status: nextStatus,
            qrScanned: record?.qr_scanned || false,
            qrScanTime: record?.qr_scan_time || null,
            qrJudgment: record?.qr_judgment || null,
            memo: record?.memo || null
        };

        await saveAttendanceRecord(payload);

        // ★ 로컬 메모리 업데이트 - scheduledTime이 없어도 반드시 갱신
        const memoryKey = effectiveScheduledTime || 'default';
        
        if (teacherIds.has(String(currentTeacherId || ''))) {
            const student = students.find(s => String(s.id) === String(studentId));
            if (student) {
                if (!student.attendance) student.attendance = {};
                // attendance[dateStr]가 string이면 객체로 변환 (마이그레이션)
                if (student.attendance[dateStr] && typeof student.attendance[dateStr] === 'string') {
                    const prev = student.attendance[dateStr];
                    student.attendance[dateStr] = {};
                    student.attendance[dateStr]['default'] = prev;
                }
                if (!student.attendance[dateStr] || typeof student.attendance[dateStr] !== 'object') student.attendance[dateStr] = {};
                student.attendance[dateStr][memoryKey] = nextStatus;
            }

            const currentStudentIdx = currentTeacherStudents.findIndex(s => String(s.id) === String(studentId));
            if (currentStudentIdx > -1) {
                const cts = currentTeacherStudents[currentStudentIdx];
                if (!cts.attendance) cts.attendance = {};
                if (cts.attendance[dateStr] && typeof cts.attendance[dateStr] === 'string') {
                    const prev = cts.attendance[dateStr];
                    cts.attendance[dateStr] = {};
                    cts.attendance[dateStr]['default'] = prev;
                }
                if (!cts.attendance[dateStr] || typeof cts.attendance[dateStr] !== 'object') cts.attendance[dateStr] = {};
                cts.attendance[dateStr][memoryKey] = nextStatus;
            }
        }

        saveData();
        // 시간표 UI도 즉시 갱신
        if (typeof renderDayEvents === 'function' && typeof currentDetailDate !== 'undefined') {
            renderDayEvents(dateStr);
        }
        renderCalendar();
        await loadStudentAttendanceHistory();
    } catch (error) {
        console.error('[updateAttendanceStatusFromHistory] 에러:', error);
        showToast('상태 변경에 실패했습니다. 다시 시도해주세요.', 'error');
        await loadStudentAttendanceHistory();
    }
}

// ★ 출석 기록 모달에서 메모 저장
window.saveAttMemoFromHistory = async function(inputEl) {
    const dateStr = inputEl.dataset.date;
    const scheduledTime = inputEl.dataset.scheduled || null;
    const memo = inputEl.value.trim();
    const studentId = currentStudentForAttendance;
    if (!studentId || !dateStr) return;

    try {
        const record = await getAttendanceRecordByStudentAndDate(studentId, dateStr, null, scheduledTime);
        if (!record) {
            // 기록이 없으면 메모만으로는 저장 불가 (출석 상태가 있어야 함)
            if (memo) showToast('출석 상태를 먼저 지정해주세요.', 'warning');
            return;
        }

        // 기존 메모와 동일하면 저장 생략
        if ((record.memo || '') === memo) return;

        const resolvedScheduledTime = record.scheduled_time || scheduledTime || null;

        await saveAttendanceRecord({
            studentId: studentId,
            teacherId: String(record.teacher_id || ''),
            attendanceDate: dateStr,
            checkInTime: record.check_in_time || new Date().toISOString(),
            scheduledTime: resolvedScheduledTime,
            status: record.status,
            qrScanned: record.qr_scanned || false,
            qrScanTime: record.qr_scan_time || null,
            qrJudgment: record.qr_judgment || null,
            memo: memo || null
        });

        showToast('메모가 저장되었습니다.', 'success');
    } catch (e) {
        console.error('[saveAttMemoFromHistory] 에러:', e);
        showToast('메모 저장에 실패했습니다.', 'error');
    }
};

async function getTeacherIdsForStudentDate(studentId, dateStr) {
    const teacherIds = new Set();

    Object.keys(teacherScheduleData || {}).forEach(tid => {
        const studentSchedule = teacherScheduleData[tid] || {};
        if (studentSchedule[String(studentId)] && studentSchedule[String(studentId)][dateStr]) {
            teacherIds.add(String(tid));
        }
    });

    try {
        const ownerId = await ensureOwnerId();
        if (!ownerId) return teacherIds;

        const { data, error } = await supabase
            .from('schedules')
            .select('teacher_id')
            .eq('owner_user_id', ownerId)
            .eq('student_id', parseInt(studentId))
            .eq('schedule_date', dateStr);

        if (error) {
            console.error('[getTeacherIdsForStudentDate] 일정 조회 실패:', error);
            return teacherIds;
        }

        (data || []).forEach(row => {
            if (row.teacher_id !== null && row.teacher_id !== undefined) {
                teacherIds.add(String(row.teacher_id));
            }
        });
    } catch (e) {
        console.error('[getTeacherIdsForStudentDate] 예외:', e);
    }

    if (teacherIds.size === 0 && currentTeacherId) {
        teacherIds.add(String(currentTeacherId));
    }

    return teacherIds;
}

function showAttendanceScopeModal() {
    // 정책 변경: 상태 적용은 담당 선생님 일정에만 즉시 반영
    return Promise.resolve('current');
}

function getDayOfWeek(date) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[date.getDay()];
}

function formatKoreanTimeLabel(timeStr) {
    if (!timeStr) return '-';
    const base = new Date('2000-01-01T00:00:00');
    const [h, m] = String(timeStr).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return String(timeStr).substring(0, 5);
    base.setHours(h, m, 0, 0);
    return base.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function statusToLabel(status) {
    if (status === 'present') return '출석';
    if (status === 'late') return '지각';
    if (status === 'absent') return '결석';
    if (status === 'makeup' || status === 'etc') return '보강';
    return '미처리';
}

function getStatusStyle(status) {
    if (status === 'present') {
        return { statusBadge: '출석', statusColor: '#10b981', bgColor: '#f0fdf4', borderColor: '#86efac' };
    }
    if (status === 'late') {
        return { statusBadge: '지각', statusColor: '#f59e0b', bgColor: '#fffbeb', borderColor: '#fcd34d' };
    }
    if (status === 'absent') {
        return { statusBadge: '결석', statusColor: '#ef4444', bgColor: '#fef2f2', borderColor: '#fca5a5' };
    }
    if (status === 'makeup' || status === 'etc') {
        return { statusBadge: '보강', statusColor: '#8b5cf6', bgColor: '#faf5ff', borderColor: '#c4b5fd' };
    }
    return { statusBadge: '미처리', statusColor: '#94a3b8', bgColor: '#f8fafc', borderColor: '#e2e8f0' };
}

function getTeacherNameById(teacherId) {
    if (typeof teacherList !== 'undefined' && Array.isArray(teacherList)) {
        const teacher = teacherList.find(t => String(t.id) === String(teacherId));
        if (teacher && teacher.name) return teacher.name;
    }
    if (typeof getCurrentTeacherId === 'function' && typeof getCurrentTeacherName === 'function') {
        if (String(getCurrentTeacherId()) === String(teacherId)) return getCurrentTeacherName();
    }
    return teacherId ? `선생님 ${teacherId}` : '선생님';
}

function escapeHtmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ========== 유틸리티 함수 ==========

function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ========== 데이터베이스 함수 ==========

async function saveAttendanceRecord(recordData) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        // ✅ 세션 검증: owner_user_id가 없으면 저장 불가
        if (!ownerId) {
            console.warn('[saveAttendanceRecord] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }
        
        // ✅ student_id는 BIGINT이므로 숫자로 변환
        const studentIdValue = parseInt(recordData.studentId);
        if (isNaN(studentIdValue)) {
            throw new Error('잘못된 student_id: ' + recordData.studentId);
        }
        
        const sourceRaw = String(recordData.attendance_source || '').trim();
        const normalizedSource = (() => {
            if (['qr', 'phone', 'teacher', 'emergency', 'unknown'].includes(sourceRaw)) return sourceRaw;
            if (sourceRaw === 'qr_student') return 'qr';
            if (sourceRaw === 'teacher_manual') return 'phone';
            if (recordData.qrScanned) return 'qr';
            const judgmentText = String(recordData.qrJudgment || '');
            const memoText = String(recordData.memo || '');
            if (judgmentText.includes('임시출석')) return 'emergency';
            if (judgmentText.includes('전화번호인증') || memoText.includes('[전화번호인증]')) return 'phone';
            if (recordData.checkInTime) return 'teacher';
            return 'unknown';
        })();
        const hasPresenceCheckToken = /(재석 확인|지각 확인|부재 확인|보강 처리)/.test(String(recordData.qrJudgment || ''));
        const authTime = recordData.authTime || recordData.qrScanTime || recordData.checkInTime || null;
        const processedAt = recordData.processedAt || recordData.checkInTime || new Date().toISOString();
        const presenceChecked = recordData.presenceChecked !== undefined
            ? !!recordData.presenceChecked
            : hasPresenceCheckToken;

        const record = {
            student_id: studentIdValue,  // BIGINT (숫자)
            teacher_id: String(recordData.teacherId),  // TEXT (문자열)
            owner_user_id: ownerId,
            attendance_date: recordData.attendanceDate,
            check_in_time: recordData.checkInTime,
            scheduled_time: recordData.scheduledTime,
            status: recordData.status,
            qr_scanned: recordData.qrScanned || false,
            qr_scan_time: recordData.qrScanTime || null,
            qr_judgment: recordData.qrJudgment || null,
            attendance_source: normalizedSource,
            auth_time: authTime,
            presence_checked: presenceChecked,
            processed_at: processedAt,
            memo: recordData.memo || null,
            shared_memo: recordData.shared_memo !== undefined ? recordData.shared_memo : null
        };
        
        console.log('[saveAttendanceRecord] 저장 시도:', record);
        
        let { data, error } = await supabase
            .from('attendance_records')
            .upsert(record, { 
                onConflict: 'student_id,attendance_date,teacher_id,scheduled_time',
                ignoreDuplicates: false 
            })
            .select()
            .single();
        if (error && /attendance_source|auth_time|presence_checked|processed_at/i.test(String(error.message || ''))) {
            // 운영 DB가 아직 신규 메타 컬럼을 반영하지 않은 경우 레거시 payload로 재시도
            const legacyRecord = { ...record };
            delete legacyRecord.attendance_source;
            delete legacyRecord.auth_time;
            delete legacyRecord.presence_checked;
            delete legacyRecord.processed_at;
            const retry = await supabase
                .from('attendance_records')
                .upsert(legacyRecord, {
                    onConflict: 'student_id,attendance_date,teacher_id,scheduled_time',
                    ignoreDuplicates: false
                })
                .select()
                .single();
            data = retry.data;
            error = retry.error;
        }
        
        if (error) {
            console.error('[saveAttendanceRecord] Supabase 에러:', error);
            throw error;
        }
        
        console.log('[saveAttendanceRecord] ✅ 저장 성공:', data);
        return data;
    } catch (error) {
        console.error('[saveAttendanceRecord] ❌ 에러:', error);
        throw error;
    }
}

// 공유 메모 조회 (teacher_id, scheduled_time 모두 무관 - 해당 학생+날짜의 모든 레코드에서 공유 메모를 수집)
// tagged=true이면 선생님 이름 태그 포함 (이번달 기록용), false이면 순수 텍스트 (편집용)
async function getSharedMemoForStudent(studentId, dateStr, tagged) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) return '';
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) return '';

        const { data, error } = await supabase
            .from('attendance_records')
            .select('shared_memo, teacher_id, scheduled_time')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .eq('attendance_date', dateStr)
            .not('shared_memo', 'is', null);

        if (error) {
            console.error('[getSharedMemoForStudent] 에러:', error);
            return '';
        }
        if (!data || data.length === 0) return '';

        // 선생님 이름 매핑
        const teacherNames = {};
        if (typeof teacherList !== 'undefined' && teacherList) {
            teacherList.forEach(t => { teacherNames[String(t.id)] = t.name; });
        }

        // 모든 공유 메모를 수집 (중복 제거)
        const memos = [];
        const seen = new Set();
        for (const rec of data) {
            if (rec.shared_memo && rec.shared_memo.trim()) {
                const trimmed = rec.shared_memo.trim();
                if (!seen.has(trimmed)) {
                    seen.add(trimmed);
                    const tName = teacherNames[String(rec.teacher_id)] || '알 수 없음';
                    if (tagged) {
                        memos.push(`<div style="margin-bottom:6px;"><span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-bottom:3px;">${tName}</span><div>${trimmed}</div></div>`);
                    } else {
                        memos.push(trimmed);
                    }
                }
            }
        }
        if (tagged) {
            return memos.join('');
        }
        return memos.join('<hr style="margin:4px 0; border:none; border-top:1px dashed #e2e8f0;">');
    } catch (e) {
        console.error('[getSharedMemoForStudent] 예외:', e);
        return '';
    }
}

// 공유 메모 구조화 조회 (선생님 ID, 이름, 메모를 배열로 반환)
async function getSharedMemosStructured(studentId, dateStr) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) return [];
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) return [];

        const { data, error } = await supabase
            .from('attendance_records')
            .select('shared_memo, teacher_id, scheduled_time')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .eq('attendance_date', dateStr)
            .not('shared_memo', 'is', null);

        if (error) { console.error('[getSharedMemosStructured] 에러:', error); return []; }
        if (!data || data.length === 0) return [];

        // 선생님 이름 매핑
        const teacherNames = {};
        if (typeof teacherList !== 'undefined' && teacherList) {
            teacherList.forEach(t => { teacherNames[String(t.id)] = t.name; });
        }

        const result = [];
        const seen = new Set();
        for (const rec of data) {
            if (rec.shared_memo && rec.shared_memo.trim()) {
                const key = `${rec.teacher_id}__${rec.shared_memo.trim()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push({
                        teacher_id: rec.teacher_id,
                        teacher_name: teacherNames[String(rec.teacher_id)] || '알 수 없음',
                        memo: rec.shared_memo.trim()
                    });
                }
            }
        }
        return result;
    } catch (e) {
        console.error('[getSharedMemosStructured] 예외:', e);
        return [];
    }
}

// 다른 스크립트에서 재사용할 수 있도록 노출
window.saveAttendanceRecord = saveAttendanceRecord;
window.getAttendanceRecordByStudentAndDate = getAttendanceRecordByStudentAndDate;
window.getTeacherIdsForStudentDate = getTeacherIdsForStudentDate;
window.showAttendanceScopeModal = showAttendanceScopeModal;
window.getSharedMemoForStudent = getSharedMemoForStudent;
window.getSharedMemosStructured = getSharedMemosStructured;

function syncAttendanceModalStatusIfOpen(studentId, dateStr, status) {
    const modal = document.getElementById('attendance-modal');
    if (!modal || modal.style.display !== 'flex') return;

    const currentId = document.getElementById('att-student-id')?.value;
    const currentDate = document.getElementById('att-date')?.value;
    if (String(currentId) !== String(studentId) || currentDate !== dateStr) return;

    document.querySelectorAll('.am-att-btn').forEach(btn => btn.classList.remove('active'));

    let btnClass = status;
    if (status === 'makeup') {
        btnClass = 'etc';
    }

    const activeBtn = document.querySelector(`.am-att-btn.${btnClass}`);
    if (activeBtn) activeBtn.classList.add('active');

    const statusDisplay = document.getElementById('current-status-display');
    const statusMapDisplay = {
        present: { text: '✓ 출석', class: 'status-present' },
        late: { text: '⏰ 지각', class: 'status-late' },
        absent: { text: '✕ 결석', class: 'status-absent' },
        makeup: { text: '🔄 보강', class: 'status-makeup' },
        etc: { text: '🔄 보강', class: 'status-makeup' }
    };

    if (statusDisplay && statusMapDisplay[status]) {
        statusDisplay.className = 'status-display ' + statusMapDisplay[status].class;
        statusDisplay.textContent = statusMapDisplay[status].text;
    }
}

async function getAttendanceRecordByStudentAndDate(studentId, dateStr, teacherId = null) {
    try {
        const numericId = parseInt(studentId);
        const ownerId = localStorage.getItem('current_owner_id') || null;
        let scheduledTime = null;
        let allowScheduledFallback = true;
        const getStatusPriority = (statusValue) => {
            const key = String(statusValue || '').toLowerCase();
            if (key === 'present' || key === 'late' || key === 'makeup' || key === 'etc') return 3;
            if (key === 'absent') return 2;
            if (key === 'none') return 1;
            return 0;
        };
        const pickBestRecord = (rows, opts = {}) => {
            if (!Array.isArray(rows) || rows.length === 0) return null;
            const targetTeacherId = String(opts.teacherId || '').trim();
            const normalizedVariants = new Set((opts.scheduledVariants || []).map((v) => String(v)));
            const scoreRow = (row) => {
                const rowTeacherId = String(row?.teacher_id || '').trim();
                const rowScheduled = String(row?.scheduled_time || '').trim();
                const normalizedRowScheduled = normalizeScheduleTimeKey(rowScheduled);
                let score = 0;
                if (targetTeacherId && rowTeacherId === targetTeacherId) score += 100;
                if (normalizedVariants.size > 0) {
                    if (normalizedVariants.has(rowScheduled) || normalizedVariants.has(normalizedRowScheduled)) {
                        score += 30;
                    }
                }
                score += getStatusPriority(row?.status) * 5;
                return score;
            };
            const toTs = (row) => {
                const raw = row?.processed_at || row?.check_in_time || row?.updated_at || row?.created_at || '';
                const ts = new Date(raw).getTime();
                return Number.isFinite(ts) ? ts : 0;
            };
            const sorted = [...rows].sort((a, b) => {
                const scoreDiff = scoreRow(b) - scoreRow(a);
                if (scoreDiff !== 0) return scoreDiff;
                return toTs(b) - toTs(a);
            });
            return sorted[0] || null;
        };
        const normalizeScheduledVariants = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return [];
            const variants = new Set([raw]);
            const hhmmMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
            const hhmmssMatch = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (hhmmMatch) {
                variants.add(`${String(parseInt(hhmmMatch[1], 10)).padStart(2, '0')}:${hhmmMatch[2]}:00`);
            }
            if (hhmmssMatch) {
                variants.add(`${String(parseInt(hhmmssMatch[1], 10)).padStart(2, '0')}:${hhmmssMatch[2]}`);
            }
            return Array.from(variants);
        };
        if (arguments.length > 3) {
            scheduledTime = arguments[3];
        }
        if (arguments.length > 4) {
            allowScheduledFallback = arguments[4] !== false;
        }
        let query = supabase
            .from('attendance_records')
            .select('*')
            .eq('student_id', numericId)
            .eq('attendance_date', dateStr);
        if (ownerId) {
            query = query.eq('owner_user_id', ownerId);
        }
        if (teacherId) {
            query = query.eq('teacher_id', String(teacherId));
        }
        if (scheduledTime) {
            query = query.eq('scheduled_time', scheduledTime);
        }
        const { data, error } = await query.maybeSingle();
        if (error) {
            // maybeSingle 에러 (복수 레코드 등) → 첫 번째 레코드 반환
            console.warn('[getAttendanceRecordByStudentAndDate] maybeSingle 에러, limit(1) 재시도:', error.message);
            let retryQuery = supabase
                .from('attendance_records')
                .select('*')
                .eq('student_id', numericId)
                .eq('attendance_date', dateStr);
            if (ownerId) retryQuery = retryQuery.eq('owner_user_id', ownerId);
            if (teacherId) retryQuery = retryQuery.eq('teacher_id', String(teacherId));
            if (scheduledTime) retryQuery = retryQuery.eq('scheduled_time', scheduledTime);
            const { data: retryData } = await retryQuery.order('created_at', { ascending: false }).limit(50);
            return pickBestRecord(retryData || [], {
                teacherId: teacherId || '',
                scheduledVariants: normalizeScheduledVariants(scheduledTime)
            });
        }
        // scheduled_time 포맷 차이(HH:MM vs HH:MM:SS) 보정 재시도
        if (!data && scheduledTime) {
            const variants = normalizeScheduledVariants(scheduledTime).filter((v) => v !== String(scheduledTime));
            for (const variant of variants) {
                let variantQuery = supabase
                    .from('attendance_records')
                    .select('*')
                    .eq('student_id', numericId)
                    .eq('attendance_date', dateStr);
                if (ownerId) variantQuery = variantQuery.eq('owner_user_id', ownerId);
                if (teacherId) variantQuery = variantQuery.eq('teacher_id', String(teacherId));
                variantQuery = variantQuery.eq('scheduled_time', variant);
                const { data: variantData, error: variantError } = await variantQuery.maybeSingle();
                if (variantError) continue;
                if (variantData) return variantData;
            }
        }
        // scheduledTime 필터로 못 찾으면 필터 없이 재시도
        if (!data && scheduledTime && allowScheduledFallback) {
            let fallbackQuery = supabase
                .from('attendance_records')
                .select('*')
                .eq('student_id', numericId)
                .eq('attendance_date', dateStr);
            if (ownerId) fallbackQuery = fallbackQuery.eq('owner_user_id', ownerId);
            if (teacherId) fallbackQuery = fallbackQuery.eq('teacher_id', String(teacherId));
            const { data: fbData } = await fallbackQuery.order('created_at', { ascending: false }).limit(50);
            return pickBestRecord(fbData || [], {
                teacherId: teacherId || '',
                scheduledVariants: normalizeScheduledVariants(scheduledTime)
            });
        }
        return data;
    } catch (error) {
        console.error('[getAttendanceRecordByStudentAndDate] 예외:', error);
        return null;
    }
}

async function getAttendanceRecordsByDate(dateStr, options = {}) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        const includeAllTeachers = !!(options && options.includeAllTeachers);
        const explicitTeacherId = options && options.teacherId != null
            ? String(options.teacherId).trim()
            : '';

        let query = supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('attendance_date', dateStr)
            .order('check_in_time', { ascending: false });

        const effectiveTeacherId = explicitTeacherId || String(currentTeacherId || '').trim();
        if (!includeAllTeachers && effectiveTeacherId) {
            query = query.eq('teacher_id', effectiveTeacherId);
        }

        const { data, error } = await query;
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getAttendanceRecordsByDate] 에러:', error);
        return [];
    }
}

async function getStudentAttendanceRecordsByMonth(studentId, year, month) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        const numericId = parseInt(studentId);
        
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0);
        const endDateStr = formatDateToYYYYMMDD(endDate);
        
        let query = supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .gte('attendance_date', startDate)
            .lte('attendance_date', endDateStr)
            .order('attendance_date', { ascending: true });

        const { data, error } = await query;
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getStudentAttendanceRecordsByMonth] 에러:', error);
        return [];
    }
}

// qr-attendance.js 로드 완료
