// HTML 이스케이프 유틸리티 (XSS 방지)
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
window.escapeHtml = escapeHtml;

let currentDate = new Date();
// 마지막 QR 출석 학생 ID (캘린더 표시용)
let lastQrScannedStudentId = null;
let currentView = 'month';
let students = [];  // 전역: 모든 학생 (학생목록은 통합)
let currentTeacherStudents = [];  // 현재 선생님의 학생만 (일정용)
let teacherScheduleData = {};  // 선생님별 일정 데이터: { teacherId: { studentId: { date: { start, duration } } } }
let teacherNameLookup = {}; // 시간표 라벨 복원용: { teacherId/owner_user_id(lowercase): teacherName }
let customHolidays = {};
let dailyLayouts = {};
let currentPaymentDate = new Date();
let currentPaymentFilter = 'all';
let currentTeacher = null;
let currentTeacherId = null;
let teacherList = [];
let currentStudentListTab = 'all';
let currentStudentSort = 'default';
let autoAbsentTimerId = null;
let isStudentSaving = false;
let selectedScheduleStudents = [];
let isScheduleSaving = false;
let selectedPeriodDeleteStudents = [];
let timetableScope = 'all';
let allScopeScheduleHydrated = false;
let allScopeScheduleLoading = false;
let historyActionContext = { studentId: '', monthPrefix: '' };
let testScoreSyncState = { mode: 'unknown', message: '동기화 상태 확인 전' };
const TEST_SCORE_STORAGE_PREFIX = 'student_test_scores__';

// ============================================
// 글로벌 UI: 토스트 알림 + 확인 다이얼로그
// ============================================
const TOAST_ICONS = {
    success: 'fa-check',
    error: 'fa-xmark',
    warning: 'fa-exclamation',
    info: 'fa-info'
};
const TOAST_TITLES = {
    success: '완료',
    error: '오류',
    warning: '주의',
    info: '알림'
};

/**
 * 토스트 알림 표시 (alert 대체)
 * @param {string} message - 메시지
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 자동 닫힘 시간 (ms, 기본 3500)
 */
window.showToast = function(message, type = 'info', duration = 3500) {
    // QR 스캔 중이면 일반 토스트 차단 (QR 스캔 결과는 showQRScanToast로 별도 표시)
    if (typeof isQRScanPageOpen === 'function' && isQRScanPageOpen()) {
        console.log('[showToast] QR 스캔 중 - 토스트 차단:', message.substring(0, 30));
        return;
    }
    const container = document.getElementById('toast-container');
    if (!container) { console.warn('[showToast] toast-container 없음:', message); return; }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.setProperty('--duration', `${duration}ms`);
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i></div>
        <div class="toast-body">
            <div class="toast-title">${TOAST_TITLES[type] || TOAST_TITLES.info}</div>
            <div class="toast-msg">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.classList.add('removing');setTimeout(()=>this.parentElement.remove(),300)">
            <i class="fas fa-times"></i>
        </button>
        <div class="toast-progress"><div class="toast-progress-bar"></div></div>
    `;

    toast.addEventListener('click', (e) => {
        if (e.target.closest('.toast-close')) return;
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    // 최대 5개까지만 표시
    while (container.children.length > 5) {
        container.firstChild.remove();
    }

    // 자동 닫힘
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
};

/**
 * 커스텀 확인 다이얼로그 (confirm 대체)
 * @param {string} message - 메시지
 * @param {object} options - { title, type: 'warn'|'danger'|'info'|'question', okText, cancelText }
 * @returns {Promise<boolean>}
 */
// QR 스캔 페이지가 열려있는지 확인
function isQRScanPageOpen() {
    const scanPage = document.getElementById('qr-scan-page');
    return scanPage && scanPage.style.display && scanPage.style.display !== 'none';
}

// confirm-dialog를 auth-page 위에 표시하기 위한 헬퍼
function _moveDialogToTop(overlay) {
    const origParent = overlay.parentNode;
    // 보이는 auth-page가 있으면 그 안으로 이동 (stacking context 동일화)
    const visibleAuth = document.querySelector('.auth-page[style*="display: flex"], .auth-page[style*="display:flex"]');
    if (visibleAuth) {
        visibleAuth.appendChild(overlay);
    }
    return { origParent, visibleAuth };
}
function _restoreDialog(overlay, ctx) {
    if (ctx.origParent && overlay.parentNode !== ctx.origParent) {
        ctx.origParent.appendChild(overlay);
    }
}

window.showConfirm = function(message, options = {}) {
    return new Promise((resolve) => {
        // QR 스캔 중이면 자동 알림/확인 다이얼로그 차단 (스캔 방해 방지)
        if (isQRScanPageOpen() && !options.allowDuringQRScan) {
            console.log('[showConfirm] QR 스캔 중 - 다이얼로그 차단:', message.substring(0, 30));
            resolve(false);
            return;
        }

        const overlay = document.getElementById('confirm-dialog');
        const icon = document.getElementById('confirm-icon');
        const title = document.getElementById('confirm-title');
        const msg = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        if (!overlay) { resolve(confirm(message)); return; }

        const type = options.type || 'question';
        const iconMap = { warn: 'fa-exclamation-triangle', danger: 'fa-trash-alt', info: 'fa-info-circle', question: 'fa-question-circle' };
        
        icon.className = `confirm-icon ${type}`;
        icon.innerHTML = `<i class="fas ${iconMap[type] || iconMap.question}"></i>`;
        title.textContent = options.title || '확인';
        msg.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
        okBtn.textContent = options.okText || '확인';
        cancelBtn.textContent = options.cancelText || '취소';
        okBtn.className = `confirm-btn ok${type === 'danger' ? ' danger' : ''}`;

        const ctx = _moveDialogToTop(overlay);
        overlay.style.display = 'flex';

        const cleanup = (result) => {
            overlay.style.display = 'none';
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            _restoreDialog(overlay, ctx);
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
};

window.showPrompt = function(message, options = {}) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-dialog');
        const icon = document.getElementById('confirm-icon');
        const title = document.getElementById('confirm-title');
        const msg = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        if (!overlay) { resolve(prompt(message)); return; }

        icon.className = 'confirm-icon info';
        icon.innerHTML = '<i class="fas fa-keyboard"></i>';
        title.textContent = options.title || '입력';
        msg.innerHTML = escapeHtml(message).replace(/\n/g, '<br>') + '<br><input type="' + (options.inputType || 'password') + '" id="confirm-prompt-input" style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;margin-top:10px;font-family:inherit;outline:none;transition:border-color 0.2s;" placeholder="' + escapeHtml(options.placeholder || '') + '">';
        okBtn.textContent = options.okText || '확인';
        cancelBtn.textContent = options.cancelText || '취소';
        okBtn.className = 'confirm-btn ok';

        const ctx = _moveDialogToTop(overlay);
        overlay.style.display = 'flex';

        setTimeout(() => {
            const inp = document.getElementById('confirm-prompt-input');
            if (inp) {
                inp.focus();
                inp.addEventListener('focus', () => inp.style.borderColor = '#6366f1');
                inp.addEventListener('blur', () => inp.style.borderColor = '#e2e8f0');
            }
        }, 100);

        const cleanup = (result) => {
            overlay.style.display = 'none';
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            _restoreDialog(overlay, ctx);
            resolve(result);
        };

        okBtn.onclick = () => {
            const inp = document.getElementById('confirm-prompt-input');
            cleanup(inp ? inp.value : '');
        };
        cancelBtn.onclick = () => cleanup(null);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    });
};

// ============================================
// 성능 유틸리티: 디바운스, 캐시, 날짜 헬퍼
// ============================================
function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// localStorage 캐시 (동기 호출 최소화)
const _lsCache = {};
function cachedLsGet(key) {
    if (_lsCache[key] !== undefined) return _lsCache[key];
    _lsCache[key] = localStorage.getItem(key);
    return _lsCache[key];
}
function cachedLsSet(key, value) {
    _lsCache[key] = value;
    localStorage.setItem(key, value);
}
function cachedLsRemove(key) {
    delete _lsCache[key];
    localStorage.removeItem(key);
}

// 오늘 날짜 캐시 (하루 동안 유효)
let _todayStr = null;
let _todayDate = null;
function getTodayStr() {
    const now = new Date();
    if (_todayDate && _todayDate.getDate() === now.getDate()) return _todayStr;
    _todayDate = now;
    const offset = now.getTimezoneOffset() * 60000;
    _todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
    return _todayStr;
}

// 날짜 -> 문자열 변환 캐시
const _dateStrCache = new Map();
function dateToStr(date) {
    const key = date.getTime();
    if (_dateStrCache.has(key)) return _dateStrCache.get(key);
    const offset = date.getTimezoneOffset() * 60000;
    const str = new Date(date.getTime() - offset).toISOString().split('T')[0];
    _dateStrCache.set(key, str);
    if (_dateStrCache.size > 500) {
        const firstKey = _dateStrCache.keys().next().value;
        _dateStrCache.delete(firstKey);
    }
    return str;
}

function normalizeScheduleEntries(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function getScheduleEntries(teacherId, studentId, dateStr) {
    const teacherSchedule = teacherScheduleData[teacherId] || {};
    const studentSchedule = teacherSchedule[studentId] || {};
    return normalizeScheduleEntries(studentSchedule[dateStr]);
}

function setScheduleEntries(teacherId, studentId, dateStr, entries) {
    if (!teacherScheduleData[teacherId]) teacherScheduleData[teacherId] = {};
    if (!teacherScheduleData[teacherId][studentId]) teacherScheduleData[teacherId][studentId] = {};
    if (entries && entries.length) {
        teacherScheduleData[teacherId][studentId][dateStr] = entries;
    } else {
        delete teacherScheduleData[teacherId][studentId][dateStr];
    }
}

// ★ 일정 시간 겹침 확인 함수 (로컬 + DB 동시 확인)
// 해당 학생의 해당 날짜에 모든 선생님의 일정을 확인하여 시간이 겹치는 일정을 반환
async function checkScheduleOverlap(studentId, dateStr, newStart, newDuration, excludeTeacherId, excludeStart) {
    const conflicts = [];
    const newStartMin = timeToMinutes(newStart);
    if (newStartMin < 0) return conflicts;
    const parseDurationMinutes = (value) => {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    };
    const newEndMin = newStartMin + parseDurationMinutes(newDuration);
    const checkedKeys = new Set(); // 중복 방지

    // 1단계: 로컬 데이터에서 확인
    for (const teacherId in teacherScheduleData) {
        const teacherSchedule = teacherScheduleData[teacherId] || {};
        const studentSchedule = teacherSchedule[String(studentId)] || {};
        const rawData = studentSchedule[dateStr];
        if (!rawData) continue;

        const entries = Array.isArray(rawData) ? rawData : [rawData];
        for (const entry of entries) {
            if (!entry || !entry.start || entry.start === 'default') continue;
            if (excludeTeacherId && excludeStart && String(teacherId) === String(excludeTeacherId) && entry.start === excludeStart) continue;

            const existStartMin = timeToMinutes(entry.start);
            if (existStartMin < 0) continue;
            const existEndMin = existStartMin + parseDurationMinutes(entry.duration);

            if (newStartMin < existEndMin && existStartMin < newEndMin) {
                const key = `${teacherId}_${entry.start}`;
                if (!checkedKeys.has(key)) {
                    checkedKeys.add(key);
                    conflicts.push({
                        teacherId,
                        teacherName: getTeacherNameById(teacherId),
                        start: entry.start,
                        duration: entry.duration || 60,
                        endTime: minutesToTime(existEndMin)
                    });
                }
            }
        }
    }

    // 2단계: DB에서도 직접 확인 (로컬에 없는 다른 선생님 일정 보완)
    try {
        const ownerId = cachedLsGet('current_owner_id');
        if (ownerId && typeof supabase !== 'undefined') {
            const { data, error } = await supabase
                .from('schedules')
                .select('teacher_id, start_time, duration')
                .eq('owner_user_id', ownerId)
                .eq('student_id', studentId)
                .eq('schedule_date', dateStr);

            if (!error && data) {
                for (const row of data) {
                    const tid = String(row.teacher_id);
                    const startStr = row.start_time ? row.start_time.substring(0, 5) : null;
                    if (!startStr) continue;
                    if (excludeTeacherId && excludeStart && tid === String(excludeTeacherId) && startStr === excludeStart) continue;

                    const key = `${tid}_${startStr}`;
                    if (checkedKeys.has(key)) continue;
                    checkedKeys.add(key);

                    const existStartMin = timeToMinutes(startStr);
                    if (existStartMin < 0) continue;
                    const dur = parseDurationMinutes(row.duration);
                    const existEndMin = existStartMin + dur;

                    if (newStartMin < existEndMin && existStartMin < newEndMin) {
                        conflicts.push({
                            teacherId: tid,
                            teacherName: getTeacherNameById(tid),
                            start: startStr,
                            duration: dur,
                            endTime: minutesToTime(existEndMin)
                        });
                    }
                }
            }
        }
    } catch (dbErr) {
        console.warn('[checkScheduleOverlap] DB 조회 실패 (로컬 결과만 사용):', dbErr);
    }

    return conflicts;
}

// 시간 문자열 "HH:MM" → 분으로 변환
function timeToMinutes(timeStr) {
    if (!timeStr) return -1;
    const parts = timeStr.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return -1;
    return parts[0] * 60 + parts[1];
}

// 분 → "HH:MM" 문자열로 변환
function minutesToTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function normalizeScheduleTimeKey(rawTime) {
    if (!rawTime) return 'default';
    const text = String(rawTime).trim();
    if (!text) return 'default';
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return text;
    return `${String(parseInt(match[1], 10)).padStart(2, '0')}:${match[2]}`;
}

function getSlotValueByNormalizedTime(slotMap, rawTime) {
    if (!slotMap || typeof slotMap !== 'object') return null;
    const target = normalizeScheduleTimeKey(rawTime);
    if (Object.prototype.hasOwnProperty.call(slotMap, target)) {
        return slotMap[target];
    }
    const matchedKey = Object.keys(slotMap).find((key) => normalizeScheduleTimeKey(key) === target);
    return matchedKey ? slotMap[matchedKey] : null;
}

// teacherId로 선생님 이름 가져오기
function getTeacherNameById(teacherId) {
    const rawId = String(teacherId || '').trim();
    if (!rawId) return '선생님';
    const normalizedRawId = rawId.toLowerCase();
    const canonicalRawId = normalizedRawId.replace(/[^a-z0-9]/g, '');
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId);
    const looksLikeOpaqueKey = /^[a-z0-9_-]{24,}$/i.test(rawId);
    const byLookup = String(teacherNameLookup[normalizedRawId] || '').trim();
    if (byLookup) return byLookup;
    const byCanonicalLookup = String(teacherNameLookup[canonicalRawId] || '').trim();
    if (byCanonicalLookup) return byCanonicalLookup;
    if (teacherList && teacherList.length) {
        const toCanonical = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const t = teacherList.find((item) => {
            const idValue = String(item.id || '').trim().toLowerCase();
            if (idValue === normalizedRawId) return true;
            const canonicalId = toCanonical(item.id);
            return !!(canonicalRawId && canonicalId && canonicalId === canonicalRawId);
        });
        if (t && t.name) return t.name;
        // 과거/혼합 데이터에서 schedule.teacher_id가 owner_user_id로 저장된 경우 보정
        const ownerMatchedList = teacherList.filter((item) => {
            const ownerValue = String(item.owner_user_id || '').trim().toLowerCase();
            if (ownerValue === normalizedRawId) return true;
            const canonicalOwner = toCanonical(item.owner_user_id);
            return !!(canonicalRawId && canonicalOwner && canonicalOwner === canonicalRawId);
        });
        if (ownerMatchedList.length === 1 && ownerMatchedList[0]?.name) return ownerMatchedList[0].name;
    }
    // teacherList 동기화 지연/미매칭 시 UUID를 그대로 노출하지 않도록 사용자용 라벨로 폴백
    if (String(getCurrentTeacherId() || '') === rawId) {
        const mine = String(getCurrentTeacherName() || '').trim();
        if (mine) return mine;
    }
    // schedule.teacher_id가 owner id인 케이스에서 현재 세션 선생님 이름으로 2차 보정
    if (String(cachedLsGet('current_owner_id') || '') === rawId) {
        const mine = String(getCurrentTeacherName() || '').trim();
        if (mine) return mine;
    }
    // UUID/난독화 키가 아닌 레거시 식별자는 사용자 라벨로 그대로 노출
    // (예: "선생님3", "teacher3", 과거 이름 기반 키)
    if (!looksLikeUuid && !looksLikeOpaqueKey && rawId.length <= 24) {
        return rawId;
    }
    return '선생님';
}

function resolveTeacherIdByExactName(teacherName) {
    const target = String(teacherName || '').trim();
    if (!target || ['선생님', '미확인', '담당 미확인'].includes(target)) return '';
    const matches = (teacherList || []).filter((t) => String(t?.name || '').trim() === target);
    if (matches.length !== 1) return '';
    return String(matches[0]?.id || '').trim();
}

// 겹침 목록을 사용자에게 보여주는 메시지 생성
function formatOverlapMessage(studentName, dateStr, conflicts) {
    let msg = `⚠️ ${studentName} - ${dateStr} 일정 시간 겹침 발견!\n\n`;
    for (const c of conflicts) {
        msg += `• ${c.teacherName} 선생님: ${c.start} ~ ${c.endTime} (${c.duration}분)\n`;
    }
    msg += `\n그래도 일정을 추가하시겠습니까?`;
    return msg;
}

function getEarliestScheduleEntry(entries) {
    if (!entries || entries.length === 0) return null;
    return entries.reduce((earliest, current) => {
        if (!earliest) return current;
        return current.start < earliest.start ? current : earliest;
    }, null);
}

function upsertScheduleEntry(entries, nextEntry) {
    const next = [...entries];
    const existingIdx = next.findIndex(item => item.start === nextEntry.start);
    if (existingIdx > -1) {
        next[existingIdx] = nextEntry;
        return { list: next, replaced: true };
    }
    next.push(nextEntry);
    return { list: next, replaced: false };
}

// ========== 새로운: 페이지 상태 관리 ==========
const pageStates = {
    AUTH: 'auth-page',           // 로그인 페이지
    TEACHER_SELECT: 'teacher-select-page',  // 선생님 선택 페이지
    MAIN_APP: 'main-app'         // 일정관리 페이지
};

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

function getCurrentTeacherId() {
    return getTabValue('current_teacher_id');
}

function getCurrentTeacherName() {
    return getTabValue('current_teacher_name') || '';
}

function getCurrentTeacherRole() {
    return getTabValue('current_teacher_role') || 'teacher';
}

function getCurrentView() {
    return getTabValue('current_view') || 'month';
}

// 현재 활성 페이지 저장
function setActivePage(pageKey) {
    console.log('[setActivePage] 현재 페이지 저장:', pageKey);
    setTabValue('active_page', pageKey);
}

// 현재 활성 페이지 조회
function getActivePage() {
    return getTabValue('active_page');
}

// 특정 페이지로 이동 (상태 저장 + 표시)
function navigateToPage(pageKey) {
    console.log('[navigateToPage] 페이지 이동:', pageKey);
    
    // 로딩 화면 제거
    const loader = document.getElementById('initial-loader');
    if (loader) loader.style.display = 'none';
    
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

function getTimetableScopeStorageKey() {
    return getStorageKey('timetable_scope');
}

function getTeacherIdsForTimetableScope() {
    const ids = new Set();
    if (currentTeacherId) ids.add(String(currentTeacherId));
    if (timetableScope === 'all') {
        Object.keys(teacherScheduleData || {}).forEach((tid) => {
            if (tid) ids.add(String(tid));
        });
    }
    return Array.from(ids);
}

function updateTimetableScopeUi() {
    const selectEl = document.getElementById('tt-scope-select');
    if (selectEl && selectEl.value !== timetableScope) {
        selectEl.value = timetableScope;
    }
    const mainSelectEl = document.getElementById('tt-scope-main-select');
    if (mainSelectEl && mainSelectEl.value !== timetableScope) {
        mainSelectEl.value = timetableScope;
    }
    const hintEl = document.getElementById('tt-scope-hint');
    if (hintEl) {
        hintEl.textContent = timetableScope === 'all'
            ? '모든 선생님의 학생 일정을 함께 표시합니다.'
            : '현재 선생님에게 배정된 학생 일정만 표시합니다.';
    }
}

function restoreTimetableScope() {
    const saved = localStorage.getItem(getTimetableScopeStorageKey());
    timetableScope = saved === 'mine' ? 'mine' : 'all';
    updateTimetableScopeUi();
}

function persistTeacherScheduleLocalFor(teacherId) {
    if (!teacherId) return;
    const key = `teacher_schedule_data__${teacherId}`;
    localStorage.setItem(key, JSON.stringify(teacherScheduleData[teacherId] || {}));
}

function resolveScheduleOwnerTeacherId(studentId, dateStr, startTime) {
    const sid = String(studentId || '');
    const dateKey = String(dateStr || '');
    const startKey = normalizeScheduleTimeKey(String(startTime || ''));
    if (!sid || !dateKey) return String(currentTeacherId || '');
    for (const tid of Object.keys(teacherScheduleData || {})) {
        const entries = getScheduleEntries(tid, sid, dateKey);
        if (startKey) {
            if (entries.some((entry) => normalizeScheduleTimeKey(entry?.start || '') === startKey)) return String(tid);
        } else if (entries.length > 0) {
            return String(tid);
        }
    }
    return String(currentTeacherId || '');
}

function getScheduleOwnerCandidatesBySlot(studentId, dateStr, startTime) {
    const sid = String(studentId || '');
    const dateKey = String(dateStr || '');
    const startKey = normalizeScheduleTimeKey(String(startTime || ''));
    if (!sid || !dateKey) return [];
    const candidates = [];
    const normalizedCandidates = new Set();
    for (const tid of Object.keys(teacherScheduleData || {})) {
        const entries = getScheduleEntries(tid, sid, dateKey);
        let matched = false;
        if (startKey && startKey !== 'default') {
            matched = entries.some((entry) => normalizeScheduleTimeKey(entry?.start || '') === startKey);
        } else {
            matched = entries.length > 0;
        }
        if (!matched) continue;
        const rawTid = String(tid || '').trim();
        if (!rawTid) continue;
        if (!candidates.includes(rawTid)) candidates.push(rawTid);
        const normalizedTid = normalizeTeacherIdForCompare(rawTid);
        if (normalizedTid) normalizedCandidates.add(normalizedTid);
    }
    normalizedCandidates.forEach((tid) => {
        if (tid && !candidates.includes(tid)) candidates.push(tid);
    });
    return candidates;
}

function resolveExactSlotOwnerTeacherId(studentId, dateStr, startTime, preferredOwnerTeacherId = '') {
    const slotCandidates = getScheduleOwnerCandidatesBySlot(studentId, dateStr, startTime)
        .map((candidate) => String(candidate || '').trim())
        .filter(Boolean);
    if (slotCandidates.length === 0) {
        const fallback = normalizeTeacherIdForCompare(preferredOwnerTeacherId || resolveScheduleOwnerTeacherId(studentId, dateStr, startTime));
        return String(fallback || preferredOwnerTeacherId || currentTeacherId || '').trim();
    }
    const preferNormalized = normalizeTeacherIdForCompare(preferredOwnerTeacherId);
    if (preferNormalized) {
        const matchedPreferred = slotCandidates.find((candidate) => normalizeTeacherIdForCompare(candidate) === preferNormalized);
        if (matchedPreferred) return String(normalizeTeacherIdForCompare(matchedPreferred) || matchedPreferred).trim();
    }
    const resolvedOwner = normalizeTeacherIdForCompare(resolveScheduleOwnerTeacherId(studentId, dateStr, startTime));
    if (resolvedOwner) {
        const matchedResolved = slotCandidates.find((candidate) => normalizeTeacherIdForCompare(candidate) === resolvedOwner);
        if (matchedResolved) return String(normalizeTeacherIdForCompare(matchedResolved) || matchedResolved).trim();
    }
    const currentNormalized = normalizeTeacherIdForCompare(currentTeacherId);
    if (currentNormalized) {
        const matchedCurrent = slotCandidates.find((candidate) => normalizeTeacherIdForCompare(candidate) === currentNormalized);
        if (matchedCurrent) return String(normalizeTeacherIdForCompare(matchedCurrent) || matchedCurrent).trim();
    }
    const first = slotCandidates[0];
    return String(normalizeTeacherIdForCompare(first) || first).trim();
}

function normalizeTeacherIdForCompare(teacherId) {
    const raw = String(teacherId || '').trim();
    if (!raw) return '';
    const resolved = String(resolveKnownTeacherId(raw) || '').trim();
    return resolved || raw;
}

async function verifyCurrentTeacherPinForAdmin(message) {
    const role = String(getCurrentTeacherRole() || 'teacher');
    if (role !== 'admin') return false;
    const current = teacherList.find((t) => String(t.id) === String(currentTeacherId));
    if (!current || !current.pin_hash) {
        showToast('관리자 PIN 정보가 없습니다.', 'error');
        return false;
    }
    const input = await showPrompt(message || '관리자 비밀번호를 입력하세요.', {
        title: '관리자 인증',
        placeholder: '관리자 비밀번호',
        inputType: 'password',
        okText: '확인',
        cancelText: '취소'
    });
    if (input === null) return false;
    if (!String(input).trim()) {
        showToast('비밀번호를 입력해주세요.', 'warning');
        return false;
    }
    const inputHash = await hashPin(String(input));
    if (inputHash !== current.pin_hash) {
        showToast('관리자 비밀번호가 올바르지 않습니다.', 'error');
        return false;
    }
    return true;
}

async function verifyAdminPinForCrossTeacherAccess(ownerTeacherName) {
    const admins = (teacherList || []).filter((t) => String(t.teacher_role || 'teacher') === 'admin' && t.pin_hash);
    if (!admins.length) {
        showToast('관리자 비밀번호 정보가 없어 타 선생님 일정을 열 수 없습니다.', 'error');
        return false;
    }
    const ownerLabel = ownerTeacherName && ownerTeacherName !== '선생님'
        ? `${ownerTeacherName} 선생님`
        : '해당 선생님';
    const input = await showPrompt(
        `${ownerLabel} 일정입니다.\n관리자 비밀번호를 입력하면 조회/수정을 계속할 수 있습니다.`,
        {
            title: '관리자 인증',
            placeholder: '관리자 비밀번호',
            inputType: 'password',
            okText: '계속',
            cancelText: '취소'
        }
    );
    if (input === null) return false;
    if (!String(input).trim()) {
        showToast('비밀번호를 입력해주세요.', 'warning');
        return false;
    }
    const inputHash = await hashPin(String(input));
    const matched = admins.some((admin) => String(admin.pin_hash || '') === String(inputHash));
    if (!matched) {
        showToast('관리자 비밀번호가 올바르지 않습니다.', 'error');
        return false;
    }
    return true;
}

function setAttendanceModalReadOnly(isReadOnly) {
    const modal = document.getElementById('attendance-modal');
    if (modal) modal.dataset.readonly = isReadOnly ? '1' : '0';

    const setDisabled = (selector) => {
        document.querySelectorAll(selector).forEach((el) => {
            el.disabled = !!isReadOnly;
        });
    };
    setDisabled('#attendance-modal .am-att-btn');
    setDisabled('#attendance-modal .am-collapse-toggle');
    setDisabled('#attendance-modal .am-btn-change');
    setDisabled('#attendance-modal .am-btn-save-memo');
    setDisabled('#attendance-modal .btn-delete-schedule');
    setDisabled('#attendance-modal .memo-editor-toolbar .color-btn');
    setDisabled('#att-edit-date, #att-edit-time, #att-edit-duration');

    const privateMemo = document.getElementById('att-memo');
    const sharedMemo = document.getElementById('att-shared-memo');
    if (privateMemo) privateMemo.contentEditable = isReadOnly ? 'false' : 'true';
    if (sharedMemo) sharedMemo.contentEditable = isReadOnly ? 'false' : 'true';
}

function isAttendanceModalReadOnly() {
    const modal = document.getElementById('attendance-modal');
    return !!(modal && modal.dataset && modal.dataset.readonly === '1');
}

function isKnownTeacherId(teacherId) {
    const raw = String(teacherId || '').trim();
    if (!raw) return false;
    return (teacherList || []).some((t) => String(t.id) === raw);
}

function resolveOwnerTeacherIdForModal(studentId, dateStr, startTime, preferredOwnerTeacherId) {
    const rawCandidates = [
        preferredOwnerTeacherId,
        resolveScheduleOwnerTeacherId(studentId, dateStr, startTime),
        (() => {
            const st = (students || []).find((item) => String(item.id) === String(studentId));
            return st ? st.teacher_id : '';
        })(),
        (typeof getAssignedTeacherId === 'function' ? getAssignedTeacherId(studentId) : '')
    ].map((v) => String(v || '').trim()).filter(Boolean);

    const candidates = [];
    rawCandidates.forEach((id) => {
        if (!id) return;
        if (!candidates.includes(id)) candidates.push(id);
        const resolved = typeof resolveKnownTeacherId === 'function' ? resolveKnownTeacherId(id) : '';
        if (resolved && !candidates.includes(resolved)) candidates.push(resolved);
    });

    // 우선순위: 실제 teacher.id로 확인 가능한 값
    const known = candidates.find((id) => isKnownTeacherId(id));
    if (known) return known;

    // known id로 해석되지 않더라도, 후보 이름이 현재 선생님과 일치하면 현재 id로 정규화
    const myName = String(getCurrentTeacherName() || '').trim();
    if (myName) {
        const matchMyName = candidates.find((id) => {
            const label = String(getTeacherNameById(id) || '').trim();
            return !!label && label !== '선생님' && label === myName;
        });
        if (matchMyName) {
            return String(currentTeacherId || '');
        }
    }

    // legacy owner만 남은 경우 원본 owner를 유지해 저장 teacher_id가 schedule owner와 어긋나지 않도록 처리
    // (현재교사 강제 fallback은 묶음 일정에서 결석 재역전의 원인이 될 수 있음)
    const rawOwnerCandidate = rawCandidates.find(Boolean);
    if (rawOwnerCandidate) return rawOwnerCandidate;
    return String(currentTeacherId || '');
}

function isScheduleOwnedByCurrentTeacher(ownerTeacherId) {
    const myId = String(currentTeacherId || '').trim();
    const ownerRaw = String(ownerTeacherId || '').trim();
    if (!ownerRaw || !myId) return ownerRaw === myId;
    if (ownerRaw === myId) return true;

    const resolvedOwnerId = String(resolveKnownTeacherId(ownerRaw) || '').trim();
    if (resolvedOwnerId && resolvedOwnerId === myId) return true;

    const myName = String(getCurrentTeacherName() || '').trim();
    const ownerLabel = String(getTeacherNameById(ownerRaw) || '').trim();
    if (
        myName &&
        ownerLabel &&
        ownerLabel === myName &&
        !['선생님', '미확인', '담당 미확인'].includes(ownerLabel)
    ) {
        return true;
    }
    return false;
}

function resolveExpectedOwnerTeacherIdForStudent(studentId) {
    const sid = String(studentId || '').trim();
    if (!sid) return '';
    const student = (students || []).find((item) => String(item.id) === sid);
    const candidates = [
        String(student?.teacher_id || '').trim(),
        (typeof getAssignedTeacherId === 'function') ? String(getAssignedTeacherId(sid) || '').trim() : ''
    ].filter(Boolean);
    for (const candidate of candidates) {
        const resolved = String(resolveKnownTeacherId(candidate) || '').trim();
        if (resolved) return resolved;
        if (isKnownTeacherId(candidate)) return candidate;
    }
    return '';
}

async function verifyScheduleEditPermission(ownerTeacherId) {
    const ownerId = String(ownerTeacherId || '');
    const myId = String(currentTeacherId || '');
    const modal = document.getElementById('attendance-modal');
    const modalAdminOverride = !!(modal && modal.dataset && modal.dataset.adminOverride === '1');
    if (!ownerId || ownerId === myId) {
        return { allowed: true, effectiveTeacherId: ownerId || myId, adminOverride: false };
    }
    if (modalAdminOverride) {
        return { allowed: true, effectiveTeacherId: ownerId, adminOverride: true };
    }
    showToast('타 선생님 일정은 보기 전용입니다. 수정/삭제할 수 없습니다.', 'warning');
    return { allowed: false };
}

window.setTimetableScope = async function(scope) {
    const nextScope = scope === 'all' ? 'all' : 'mine';
    if (timetableScope === nextScope) {
        updateTimetableScopeUi();
        return;
    }
    timetableScope = nextScope;
    localStorage.setItem(getTimetableScopeStorageKey(), timetableScope);
    allScopeScheduleHydrated = timetableScope !== 'all';
    allScopeScheduleLoading = timetableScope === 'all';
    updateTimetableScopeUi();
    if (timetableScope === 'all' && typeof loadAllTeachersScheduleData === 'function') {
        try {
            await loadAllTeachersScheduleData();
        } catch (e) {
            console.warn('[setTimetableScope] 전체 일정 재로드 실패:', e);
        }
    }
    renderCalendar();
    if (currentDetailDate && document.getElementById('day-detail-modal')?.style.display === 'flex') {
        renderDayEvents(currentDetailDate);
    }
};

// 전역 보관소 키(선생님 구분 없이 모든 학생 공유)
function getGlobalStorageKey(base) {
    return `${base}__global`;
}

function getKstNow() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcMs + (9 * 60 * 60000));
}

function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function autoMarkAbsentForPastSchedules() {
    if (!teacherScheduleData || Object.keys(teacherScheduleData).length === 0) return;

    const nowKst = getKstNow();
    const todayKst = formatDateToYYYYMMDD(nowKst);
    const statusPriority = { present: 5, late: 4, makeup: 3, etc: 3, absent: 2, none: 1 };
    const pickPriority = (value) => statusPriority[String(value || '').toLowerCase()] || 0;
    let updated = false;

    // ★ 모든 선생님의 일정을 순회 (현재 선생님뿐 아니라 전체)
    for (const teacherId in teacherScheduleData) {
        const teacherSchedule = teacherScheduleData[teacherId] || {};

        for (const studentId in teacherSchedule) {
            const scheduleByDate = teacherSchedule[studentId] || {};
            const student = students.find(s => String(s.id) === String(studentId));
            if (!student) continue;

            for (const dateStr in scheduleByDate) {
                const rawData = scheduleByDate[dateStr];
                // ★ 배열 또는 단일 객체 모두 처리
                const entries = Array.isArray(rawData) ? rawData : [rawData];

                for (const schedule of entries) {
                    const startTime = schedule?.start;
                    if (!startTime || startTime === 'default') continue;
                    const normalizedStartTime = normalizeScheduleTimeKey(startTime);
                    const startWithSeconds = `${normalizedStartTime}:00`;

                    const duration = schedule?.duration || 60;

                    let shouldCheck = false;
                    const [sh, sm] = startTime.split(':').map(Number);
                    const [yy, mm, dd] = String(dateStr || '').split('-').map(Number);
                    if (isNaN(sh) || isNaN(sm) || isNaN(yy) || isNaN(mm) || isNaN(dd)) continue;
                    // 날짜 문자열(dateStr)을 기준으로 실제 수업 종료 시각을 계산한다.
                    // 자정 넘김 수업(예: 23:30~01:10)도 종료 전에는 자동 결석 처리하지 않도록 보정.
                    const classStart = new Date(yy, mm - 1, dd, sh, sm, 0, 0);
                    const classEnd = new Date(classStart);
                    classEnd.setMinutes(classEnd.getMinutes() + Number(duration || 0));
                    if (nowKst >= classEnd) {
                        shouldCheck = true;
                    }

                    if (!shouldCheck) continue;

                    // DB 기준으로 이미 처리된 상태가 있으면 자동 결석 덮어쓰기를 금지
                    // (로컬 캐시 누락/지연으로 인한 present -> absent 역전 방지)
                    if (typeof window.getAttendanceRecordByStudentAndDate === 'function') {
                        try {
                            // 1) 일정 소유 teacher_id 기준 조회
                            const ownerScopedRecord = await window.getAttendanceRecordByStudentAndDate(
                                studentId,
                                dateStr,
                                String(teacherId),
                                normalizedStartTime,
                                false
                            );
                            // 2) 과거 잘못 저장된 teacher_id/legacy key를 흡수하기 위한 owner 기준 조회
                            const ownerAllRecord = await window.getAttendanceRecordByStudentAndDate(
                                studentId,
                                dateStr,
                                null,
                                normalizedStartTime,
                                false
                            );
                            let dbRecord = ownerScopedRecord || ownerAllRecord || null;
                            if (ownerScopedRecord && ownerAllRecord) {
                                const ownerPriority = pickPriority(ownerScopedRecord?.status);
                                const allPriority = pickPriority(ownerAllRecord?.status);
                                if (allPriority > ownerPriority) {
                                    dbRecord = ownerAllRecord;
                                } else if (allPriority === ownerPriority) {
                                    const ownerTs = new Date(ownerScopedRecord?.processed_at || ownerScopedRecord?.check_in_time || ownerScopedRecord?.updated_at || ownerScopedRecord?.created_at || 0).getTime();
                                    const allTs = new Date(ownerAllRecord?.processed_at || ownerAllRecord?.check_in_time || ownerAllRecord?.updated_at || ownerAllRecord?.created_at || 0).getTime();
                                    if (allTs >= ownerTs) dbRecord = ownerAllRecord;
                                }
                            }
                            const dbStatus = String(dbRecord?.status || '').toLowerCase();
                            if (dbStatus === 'present' || dbStatus === 'late' || dbStatus === 'makeup' || dbStatus === 'etc') {
                                if (!student.attendance) student.attendance = {};
                                if (!student.attendance[dateStr] || typeof student.attendance[dateStr] !== 'object') {
                                    student.attendance[dateStr] = {};
                                }
                                student.attendance[dateStr][normalizedStartTime] = dbStatus === 'etc' ? 'makeup' : dbStatus;
                                continue;
                            }
                        } catch (dbCheckError) {
                            console.warn('[autoMarkAbsentForPastSchedules] DB 상태 확인 실패, 로컬 기준으로 진행:', dbCheckError);
                        }
                    }

                    if (!student.attendance) student.attendance = {};
                    if (typeof student.attendance[dateStr] === 'string') {
                        const prev = student.attendance[dateStr];
                        student.attendance[dateStr] = {};
                        student.attendance[dateStr]['default'] = prev;
                    }
                    if (student.attendance[dateStr] && typeof student.attendance[dateStr] === 'object') {
                        const hasAnyStatusForSlot = Object.keys(student.attendance[dateStr]).some((key) => {
                            const keyNorm = normalizeScheduleTimeKey(key);
                            return keyNorm === normalizedStartTime && !!student.attendance[dateStr][key];
                        });
                        if (hasAnyStatusForSlot) continue;
                    }

                    if (!student.attendance[dateStr] || typeof student.attendance[dateStr] !== 'object') {
                        student.attendance[dateStr] = {};
                    }
                    student.attendance[dateStr][normalizedStartTime] = 'absent';

                    const ctIdx = currentTeacherStudents.findIndex(s => String(s.id) === String(studentId));
                    if (ctIdx > -1) {
                        if (!currentTeacherStudents[ctIdx].attendance) currentTeacherStudents[ctIdx].attendance = {};
                        if (typeof currentTeacherStudents[ctIdx].attendance[dateStr] === 'string') {
                            const prev = currentTeacherStudents[ctIdx].attendance[dateStr];
                            currentTeacherStudents[ctIdx].attendance[dateStr] = {};
                            currentTeacherStudents[ctIdx].attendance[dateStr]['default'] = prev;
                        }
                        if (!currentTeacherStudents[ctIdx].attendance[dateStr] || typeof currentTeacherStudents[ctIdx].attendance[dateStr] !== 'object') {
                            currentTeacherStudents[ctIdx].attendance[dateStr] = {};
                        }
                        currentTeacherStudents[ctIdx].attendance[dateStr][normalizedStartTime] = 'absent';
                    }

                    if (typeof window.saveAttendanceRecord === 'function') {
                        try {
                            console.log('[ATT-BOX][autoAbsent][write]', {
                                studentId,
                                teacherId: String(teacherId || ''),
                                dateStr,
                                startTime: normalizedStartTime,
                                status: 'absent'
                            });
                            await window.saveAttendanceRecord({
                                studentId: studentId,
                                teacherId: String(teacherId),
                                attendanceDate: dateStr,
                                checkInTime: null,
                                scheduledTime: normalizedStartTime,
                                status: 'absent',
                                qrScanned: false,
                                qrScanTime: null,
                                qrJudgment: '자동 결석 처리'
                            });
                        } catch (e) {
                            console.error('[autoMarkAbsentForPastSchedules] DB 저장 실패:', e);
                        }
                    }

                    updated = true;
                }
            }
        }
    }

    if (updated) {
        saveData();
        renderCalendar();
    }
}

// ★ 각 수업 종료 시점에 결석 자동 처리 타이머 등록
let _autoAbsentTimers = [];

function scheduleKstMidnightAutoAbsent() {
    // 기존 타이머 모두 제거
    if (autoAbsentTimerId) {
        clearTimeout(autoAbsentTimerId);
        autoAbsentTimerId = null;
    }
    _autoAbsentTimers.forEach(t => clearTimeout(t));
    _autoAbsentTimers = [];

    const now = getKstNow();
    const todayStr = formatDateToYYYYMMDD(now);

    // 자정 타이머 (안전장치)
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    autoAbsentTimerId = setTimeout(async () => {
        await autoMarkAbsentForPastSchedules();
        scheduleKstMidnightAutoAbsent();
    }, msUntilMidnight);

    // ★ 오늘 수업 종료 시점마다 타이머 등록
    const endTimes = new Set();
    for (const teacherId in teacherScheduleData) {
        const teacherSchedule = teacherScheduleData[teacherId] || {};
        for (const studentId in teacherSchedule) {
            const scheduleByDate = teacherSchedule[studentId] || {};
            const rawData = scheduleByDate[todayStr];
            if (!rawData) continue;

            // ★ 배열 또는 단일 객체 모두 처리
            const entries = Array.isArray(rawData) ? rawData : [rawData];
            for (const schedule of entries) {
                if (!schedule || !schedule.start || schedule.start === 'default') continue;

                const [sh, sm] = schedule.start.split(':').map(Number);
                if (isNaN(sh) || isNaN(sm)) continue;
                const duration = schedule.duration || 60;
                const classEnd = new Date(now);
                classEnd.setHours(sh, sm, 0, 0);
                classEnd.setMinutes(classEnd.getMinutes() + duration);

                if (classEnd > now) {
                    const endKey = classEnd.getTime();
                    if (!endTimes.has(endKey)) {
                        endTimes.add(endKey);
                        const msUntilEnd = endKey - now.getTime() + 60000;
                        const timerId = setTimeout(async () => {
                            console.log('[autoAbsent] 수업 종료 시점 결석 체크 실행');
                            await autoMarkAbsentForPastSchedules();
                        }, msUntilEnd);
                        _autoAbsentTimers.push(timerId);
                    }
                }
            }
        }
    }
    if (_autoAbsentTimers.length > 0) {
        console.log(`[scheduleKstMidnightAutoAbsent] 오늘 수업 종료 타이머 ${_autoAbsentTimers.length}개 등록`);
    }
}

window.setPaymentFilter = function(filter) {
    currentPaymentFilter = filter;
    document.querySelectorAll('.pay-pill').forEach(btn => btn.classList.remove('active'));
    const target = document.querySelector(`.pay-pill[onclick="setPaymentFilter('${filter}')"]`);
    if (target) target.classList.add('active');
    renderPaymentList();
}

// ========== 공공데이터포털 공휴일 API 연동 ==========
// 하드코딩 폴백 (API 실패 시 사용)
const LUNAR_HOLIDAYS_DB = {
    "2026": { "02-16":"설날","02-17":"설날","02-18":"설날","03-02":"대체공휴일","05-24":"부처님오신날","09-24":"추석","09-25":"추석","09-26":"추석" }
};

// API에서 가져온 공휴일 캐시 { "2026": { "2026-01-01": "신정", ... } }
let apiHolidayCache = {};

// 공휴일 API 호출 (연 단위, localStorage 캐싱)
async function fetchPublicHolidays(year) {
    // 이미 메모리 캐시에 있으면 바로 리턴
    if (apiHolidayCache[year]) return apiHolidayCache[year];

    // localStorage 캐시 확인 (24시간 유효)
    const cacheKey = `public_holidays_${year}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed.timestamp && (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000)) {
                apiHolidayCache[year] = parsed.data;
                console.log(`[공휴일] ${year}년 캐시 사용 (${Object.keys(parsed.data).length}개)`);
                return parsed.data;
            }
        } catch (e) { /* 캐시 파싱 실패 → 다시 가져옴 */ }
    }

    let apiKey =
        window.DATA_GO_KR_API_KEY ||
        (window.env && window.env.DATA_GO_KR_API_KEY) ||
        '';
    if (!apiKey) {
        // index.html의 .env.local 비동기 로더가 늦게 끝나는 경우를 흡수
        await new Promise((resolve) => setTimeout(resolve, 180));
        apiKey =
            window.DATA_GO_KR_API_KEY ||
            (window.env && window.env.DATA_GO_KR_API_KEY) ||
            '';
    }
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        console.warn('[공휴일] API 키가 설정되지 않았습니다. 하드코딩 데이터를 사용합니다.');
        return null;
    }

    try {
        const holidays = {};
        // 1~12월 전체를 한번에 가져오기 (numOfRows=50이면 1년치 충분)
        const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&numOfRows=50&_type=json&ServiceKey=${apiKey}`;
        
        console.log(`[공휴일] ${year}년 API 호출 중...`);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`[공휴일] API 응답 오류: ${response.status}`);
            return null;
        }
        
        const json = await response.json();
        const items = json?.response?.body?.items?.item;
        
        if (!items) {
            console.warn(`[공휴일] ${year}년 데이터 없음`);
            return null;
        }
        
        // 단일 항목인 경우 배열로 변환
        const itemList = Array.isArray(items) ? items : [items];
        
        itemList.forEach(item => {
            if (item.isHoliday === 'Y') {
                const locdate = String(item.locdate);
                const dateStr = `${locdate.substring(0,4)}-${locdate.substring(4,6)}-${locdate.substring(6,8)}`;
                holidays[dateStr] = item.dateName;
            }
        });
        
        // 메모리 + localStorage 캐싱
        apiHolidayCache[year] = holidays;
        localStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: holidays
        }));
        
        console.log(`[공휴일] ${year}년 API 로드 완료: ${Object.keys(holidays).length}개 공휴일`);
        return holidays;
    } catch (err) {
        console.error('[공휴일] API 호출 실패:', err);
        return null;
    }
}

// 앱 시작 시 현재 연도 + 전후 연도 공휴일 미리 로드
async function preloadPublicHolidays() {
    const year = new Date().getFullYear();
    await Promise.all([
        fetchPublicHolidays(year),
        fetchPublicHolidays(year + 1)
    ]);
}

// ============================================
// Theme Picker (페이지 테마 색상)
// ============================================
const APP_THEMES = [
    { id: 'default',     name: '기본',       bg: '#f8fafc',  preview: 'linear-gradient(135deg, #ffffff 50%, #f8fafc 50%)' },
    { id: 'warm-cream',  name: '크림',       bg: '#fefcf3',  preview: 'linear-gradient(135deg, #fffdf7 50%, #fef3c7 50%)' },
    { id: 'soft-gray',   name: '그레이',     bg: '#f1f3f5',  preview: 'linear-gradient(135deg, #f8f9fa 50%, #dee2e6 50%)' },
    { id: 'cool-blue',   name: '블루',       bg: '#eff6ff',  preview: 'linear-gradient(135deg, #f0f7ff 50%, #bfdbfe 50%)' },
    { id: 'mint-green',  name: '민트',       bg: '#ecfdf5',  preview: 'linear-gradient(135deg, #f0fdf8 50%, #a7f3d0 50%)' },
    { id: 'lavender',    name: '라벤더',     bg: '#f5f3ff',  preview: 'linear-gradient(135deg, #faf8ff 50%, #c4b5fd 50%)' },
    { id: 'rose-pink',   name: '로즈',       bg: '#fff1f2',  preview: 'linear-gradient(135deg, #fff5f5 50%, #fda4af 50%)' },
    { id: 'peach',       name: '피치',       bg: '#fff7ed',  preview: 'linear-gradient(135deg, #fffaf5 50%, #fdba74 50%)' },
    { id: 'sage',        name: '세이지',     bg: '#f0faf0',  preview: 'linear-gradient(135deg, #f5fcf5 50%, #86efac 50%)' },
    { id: 'sky',         name: '스카이',     bg: '#f0f9ff',  preview: 'linear-gradient(135deg, #f5fbff 50%, #7dd3fc 50%)' },
    { id: 'sand',        name: '샌드',       bg: '#faf7f2',  preview: 'linear-gradient(135deg, #fcfaf6 50%, #d6cfc0 50%)' },
    { id: 'night',       name: '나이트',     bg: '#1e293b',  preview: 'linear-gradient(135deg, #1e293b 50%, #0f172a 50%)' },
    { id: 'charcoal',    name: '차콜',       bg: '#27272a',  preview: 'linear-gradient(135deg, #27272a 50%, #18181b 50%)' },
];

window.toggleThemePicker = function() {
    const popup = document.getElementById('theme-picker-popup');
    if (!popup) return;
    popup.classList.toggle('open');
};

window.applyTheme = function(themeId) {
    const html = document.documentElement;
    if (themeId === 'default') {
        html.removeAttribute('data-theme');
    } else {
        html.setAttribute('data-theme', themeId);
    }
    localStorage.setItem('app_theme', themeId);

    // 팔레트 active 표시 업데이트
    document.querySelectorAll('.theme-swatch').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === themeId);
    });
};

window.initThemePicker = function() {
    const grid = document.getElementById('theme-picker-grid');
    if (!grid) return;
    
    const saved = localStorage.getItem('app_theme') || 'default';
    
    grid.innerHTML = APP_THEMES.map(t => `
        <div style="text-align:center;">
            <div class="theme-swatch ${t.id === saved ? 'active' : ''}" 
                 data-theme="${t.id}" 
                 onclick="applyTheme('${t.id}')"
                 style="background: ${t.preview}; ${t.id === 'night' || t.id === 'charcoal' ? 'border-color: #475569;' : 'box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);'}">
                <i class="fas fa-check swatch-check"></i>
            </div>
            <div class="theme-swatch-label">${t.name}</div>
        </div>
    `).join('');
    
    // 저장된 테마 즉시 적용
    if (saved !== 'default') {
        document.documentElement.setAttribute('data-theme', saved);
    }

    // 팝업 외부 클릭 시 닫기
    document.addEventListener('click', function(e) {
        const popup = document.getElementById('theme-picker-popup');
        const wrapper = e.target.closest('.theme-picker-wrapper');
        if (popup && popup.classList.contains('open') && !wrapper) {
            popup.classList.remove('open');
        }
    });
};

// 페이지 로드 시 저장된 테마 빠르게 적용 (FOUC 방지)
(function() {
    const saved = localStorage.getItem('app_theme');
    if (saved && saved !== 'default') {
        document.documentElement.setAttribute('data-theme', saved);
    }
})();

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[DOMContentLoaded] 페이지 로드 시작');
    
    // 테마 피커 초기화
    initThemePicker();
    restoreTimetableScope();
    
    // ===== 세션 플래그 설정 (새로고침 vs 창 닫기 구분) =====
    // sessionStorage는 탭/창을 닫으면 사라지고, 새로고침하면 유지됨
    const isRefresh = sessionStorage.getItem('refresh_flag') === 'true';
    console.log('[DOMContentLoaded] 새로고침 여부 판단 - refresh_flag:', sessionStorage.getItem('refresh_flag'), '→ isRefresh:', isRefresh);
    
    // 새로고침 플래그 초기화 (다음 beforeunload에서 설정할 준비)
    sessionStorage.setItem('refresh_flag', '');
    
    // ===== 페이지 언로드 이벤트 설정 (중복 등록 방지) =====
    // beforeunload와 unload는 한 번만 등록되어야 함 (DOMContentLoaded마다 재등록 방지)
    if (!window._unloadHandlersRegistered) {
        window._unloadHandlersRegistered = true;
        
        // 🔄 beforeunload: 새로고침/창 닫기 구분 플래그 설정
        window.addEventListener('beforeunload', (e) => {
            console.log('[beforeunload] 이벤트 발생 - 새로고침 플래그 설정');
            sessionStorage.setItem('refresh_flag', 'true');
        });
        
        // ⚠️ 클린업 함수: 로그인 유지 여부에 따라 localStorage 정리
        const cleanupLocalStorage = () => {
            const isRefreshOnUnload = sessionStorage.getItem('refresh_flag') === 'true';
            console.log('[cleanupLocalStorage] 새로고침 여부:', isRefreshOnUnload);
            
            if (isRefreshOnUnload) {
                // 🔄 새로고침 중 → localStorage 유지
                console.log('[cleanupLocalStorage] 새로고침 감지 - localStorage 유지');
                return;
            }
            
            // ❌ 창 닫기/탭 숨김 → 로그인 유지 여부에 따라 정리
            console.log('[cleanupLocalStorage] 창 닫기 감지 - localStorage 정리 시작');
            const rememberLogin = localStorage.getItem('remember_login') === 'true';
            console.log('[cleanupLocalStorage] remember_login:', rememberLogin);
            
            if (!rememberLogin) {
                // ❌ 로그인 유지 미체크 - 모든 로그인 정보 제거
                console.log('[cleanupLocalStorage] 로그인 유지 미체크 - 모든 로그인 정보 제거');
                localStorage.removeItem('current_owner_id');
                localStorage.removeItem('current_user_role');
                localStorage.removeItem('current_user_name');
                removeTabValue('current_teacher_id');
                removeTabValue('current_teacher_name');
                removeTabValue('current_teacher_role');
                removeTabValue('active_page');
                localStorage.removeItem('remember_login');
                removeTabValue('current_view');
            } else {
                // ✅ 로그인 유지 체크 - 멀티탭 유지 위해 선생님 정보는 유지
                console.log('[cleanupLocalStorage] 로그인 유지 체크 - 선생님 정보 유지');
            }
        };
        
        // pagehide 이벤트: 페이지가 숨겨질 때 (unload보다 더 신뢰성 있음)
        window.addEventListener('pagehide', cleanupLocalStorage, false);
        
        // unload도 함께 등록 (pagehide를 지원하지 않는 브라우저 대비)
        window.addEventListener('unload', cleanupLocalStorage, false);
        
        // visibilitychange에서 스토리지 정리는 하지 않음 (탭 전환 시 데이터 보호)
    }
    
    // ===== 1단계: 인증 상태 확인 =====
    console.log('[DOMContentLoaded] 인증 초기화 시작...');
    console.log('[DOMContentLoaded] 새로고침 여부:', isRefresh);
    
    // 안전장치: 5초 후에도 로딩 화면이 있으면 강제 제거
    const safetyTimeout = setTimeout(() => {
        const loader = document.getElementById('initial-loader');
        if (loader && loader.style.display !== 'none') {
            console.warn('[DOMContentLoaded] 타임아웃 - 로딩 화면 강제 제거');
            loader.style.display = 'none';
        }
    }, 5000);
    
    // 공휴일 API 데이터 미리 로드 (백그라운드)
    preloadPublicHolidays().then(() => {
        console.log('[DOMContentLoaded] 공휴일 데이터 로드 완료');
        if (typeof renderCalendar === 'function') renderCalendar();
    }).catch(err => console.warn('[DOMContentLoaded] 공휴일 로드 실패:', err));
    
    try {
        if (typeof initializeAuth === 'function') {
            await initializeAuth(isRefresh);
            console.log('[DOMContentLoaded] 인증 초기화 완료');
        } else {
            console.error('[DOMContentLoaded] initializeAuth 함수 없음');
            // 로딩 화면 제거
            const loader = document.getElementById('initial-loader');
            if (loader) loader.style.display = 'none';
        }
    } catch (error) {
        console.error('[DOMContentLoaded] 인증 초기화 중 에러:', error);
        // 에러 발생 시에도 로딩 화면 제거
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'none';
    } finally {
        // 타임아웃 클리어
        clearTimeout(safetyTimeout);
        // 최종 안전망: 로딩 화면 제거
        const loader = document.getElementById('initial-loader');
        if (loader) {
            setTimeout(() => {
                if (loader.style.display !== 'none') {
                    console.warn('[DOMContentLoaded] finally - 로딩 화면 제거');
                    loader.style.display = 'none';
                }
            }, 100);
        }
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
    updateTimetableScopeUi();
    
    // ✅ restorePageOnLoad()는 제거 - initializeAuth()가 이미 모든 페이지 복원 처리
    // initializeAuth()가 Supabase 세션 기반으로 페이지 라우팅을 완료함
    
    // 권한 메뉴 가시성 및 역할 라벨 업데이트
    updatePaymentMenuVisibility();
    updateStudentMenuVisibility();
    updateForceResetMenuVisibility();
    updateUserRoleLabel();
    
    console.log('[DOMContentLoaded] 페이지 로드 완료');
});

function setupHolidayColorChips() {
    const chips = document.querySelectorAll('.dset-color-chip, .color-chip');
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
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    } else {
        drawer.classList.add('open');
        overlay.style.display = 'block';
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }
}

window.closeFeaturePanel = function() {
    const drawer = document.getElementById('feature-drawer');
    const overlay = document.getElementById('feature-overlay');
    if (!drawer || !overlay) return;
    drawer.classList.remove('open');
    overlay.classList.remove('visible');
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
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
    const savedTeacherId = getCurrentTeacherId();
    const savedTeacherName = getCurrentTeacherName();
    const savedOwnerId = cachedLsGet('current_owner_id');

    console.log('[restorePageOnLoad] savedPage:', savedPage, 'savedTeacherId:', savedTeacherId, 'savedOwnerId:', savedOwnerId);

    // ✅ 핵심 검증: current_owner_id가 없으면 모든 사용자 상태 무효화
    if (!savedOwnerId) {
        console.warn('[restorePageOnLoad] current_owner_id 없음 - 세션 만료, 로그인 페이지로 이동');
        // localStorage 사용자 데이터 정리
        removeTabValue('current_teacher_id');
        removeTabValue('current_teacher_name');
        removeTabValue('active_page');
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
    const chips = document.querySelectorAll('.dset-color-chip, .color-chip');
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

function generateTempPassword(length = 6) {
    const chars = '0123456789';
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, v => chars[v % chars.length]).join('');
}

async function loadTeachers() {
    try {
        console.log('[loadTeachers] 시작');
        
        const ownerId = cachedLsGet('current_owner_id');
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
            teacher_role: t.teacher_role || 'teacher'  // teacher_role이 없으면 기본값 'teacher'
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
    const logo = document.querySelector('#teacher-select-page .auth-logo');

    if (selectForm.style.display === 'none' || !selectForm.style.display) {
        selectForm.style.display = 'flex';
        registerForm.style.display = 'none';
        if (logo) logo.textContent = '선생님 선택';
        // 등록 폼으로 돌아갈 때 Google 인증 상태 초기화
        if (typeof resetGoogleAuth === 'function') resetGoogleAuth();
    } else {
        selectForm.style.display = 'none';
        registerForm.style.display = 'flex';
        if (logo) logo.textContent = '새 선생님 등록';
    }
}


async function setCurrentTeacher(teacher) {
    try {
        console.log('[setCurrentTeacher] 시작, 선택된 선생님:', teacher);
        
        if (!teacher || !teacher.id) {
            console.error('[setCurrentTeacher] 유효하지 않은 선생님 정보');
            showToast('선생님 정보가 유효하지 않습니다.', 'error');
            return;
        }
        
        // localStorage의 current_owner_id 확인
        const ownerId = cachedLsGet('current_owner_id');
        console.log('[setCurrentTeacher] current_owner_id:', ownerId);
        
        if (!ownerId) {
            console.warn('[setCurrentTeacher] current_owner_id 없음, 세션 만료');
            showToast('로그인 세션이 만료되었습니다. 다시 로그인해주세요.', 'warning');
            // 로그인 페이지로 이동
            await initializeAuth();
            return;
        }
        
        // Supabase에서 최신 teacher_role 정보 조회
        console.log('[setCurrentTeacher] Supabase에서 최신 teacher_role 정보 조회 중...');
        const { data: latestTeacher, error } = await supabase
            .from('teachers')
            .select('teacher_role')
            .eq('id', teacher.id)
            .single();
        
        if (error) {
            console.error('[setCurrentTeacher] teacher_role 조회 실패:', error);
        } else if (latestTeacher) {
            teacher.teacher_role = latestTeacher.teacher_role || 'teacher';
            console.log('[setCurrentTeacher] 최신 teacher_role 반영:', teacher.teacher_role);
        }
        
        // 기본값 설정 (teacher_role이 없으면 'teacher')
        if (!teacher.teacher_role) {
            teacher.teacher_role = 'teacher';
        }
        
        // 전역 변수 설정
        currentTeacher = teacher;
        currentTeacherId = teacher.id;
        
        // 선택된 선생님을 로컬 저장해 새로고침 후에도 유지
        setTabValue('current_teacher_id', teacher.id);
        setTabValue('current_teacher_name', teacher.name || '');
        setTabValue('current_teacher_role', teacher.teacher_role);
        console.log('[setCurrentTeacher] 로컬 저장 완료, teacherId:', teacher.id, '역할:', teacher.teacher_role);
        restoreTimetableScope();
        // 운영 기본 정책: 로그인/선생님 전환 시 전체 일정 공유 보기를 우선 적용
        timetableScope = 'all';
        localStorage.setItem(getTimetableScopeStorageKey(), timetableScope);
        updateTimetableScopeUi();
        allScopeScheduleHydrated = timetableScope !== 'all';
        allScopeScheduleLoading = timetableScope === 'all';
        const allScopeLoadPromise = (timetableScope === 'all' && typeof loadAllTeachersScheduleData === 'function')
            ? loadAllTeachersScheduleData()
            : Promise.resolve();
        
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
        
        const perfStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        // 4단계: 현재 선생님의 일정 데이터 로드
        console.log('[setCurrentTeacher] 4단계: 일정 데이터 로드 중...');
        await loadTeacherScheduleData(teacher.id);
        console.log('[setCurrentTeacher] 4단계 완료: 현재 선생님 일정 로드 완료');
        if (timetableScope === 'all') {
            // 정확성 우선: 전체 범위는 전체 일정 로드 완료 후 첫 렌더
            try {
                await allScopeLoadPromise;
            } catch (e) {
                console.warn('[setCurrentTeacher] 전체 일정 선로딩 실패:', e);
            }
        }
        
        // 5단계: 페이지를 MAIN_APP으로 전환
        console.log('[setCurrentTeacher] 5단계: 페이지 전환 중...');
        navigateToPage('MAIN_APP');  // ✅ active_page를 'MAIN_APP'으로 저장
        
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
        
        // 7단계: 캘린더 렌더링 (저장된 탭 복원)
        console.log('[setCurrentTeacher] 7단계: 캘린더 렌더링 중...');
        // 저장된 탭 복원
        const savedView = getCurrentView();
        currentView = savedView;
        console.log('[setCurrentTeacher] 저장된 탭 복원:', savedView);
        
        // 탭 버튼 활성화
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        const tabElement = document.getElementById(`tab-${savedView}`);
        if (tabElement) {
            tabElement.classList.add('active');
        }
        
        renderCalendar();
        
        // 8단계: 권한 메뉴 및 역할 라벨 업데이트
        console.log('[setCurrentTeacher] 8단계: 권한 메뉴 및 역할 라벨 업데이트...');
        updatePaymentMenuVisibility();
        updateTeacherMenuVisibility();
        updateForceResetMenuVisibility();
        updateUserRoleLabel();
        
        // 로딩 화면은 초기 렌더 완료 시점에 먼저 제거해 체감 진입 속도를 개선
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'none';

        const perfAfterFirstRender = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        console.info(`[setCurrentTeacher][perf] first-render: ${Math.round(perfAfterFirstRender - perfStart)}ms`);

        // --- 백그라운드 후속 작업 ---
        // 전체 선생님 일정(전체 보기/교차 확인용)과 자동결석 보정은 화면 진입 후 비동기로 실행
        Promise.resolve()
            .then(async () => {
                try { await allScopeLoadPromise; } catch (_) {}
                try {
                    await autoMarkAbsentForPastSchedules();
                } catch (e) {
                    console.warn('[setCurrentTeacher] 백그라운드 자동결석 보정 실패:', e);
                }
                try {
                    scheduleKstMidnightAutoAbsent();
                } catch (e) {
                    console.warn('[setCurrentTeacher] 자동결석 타이머 등록 실패:', e);
                }
                try {
                    if (typeof window.initMissedScanChecks === 'function') {
                        window.initMissedScanChecks();
                    }
                } catch (e) {
                    console.warn('[setCurrentTeacher] 미스캔 체크 초기화 실패:', e);
                }
                renderCalendar();
                const perfDone = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                console.info(`[setCurrentTeacher][perf] background-complete: ${Math.round(perfDone - perfStart)}ms`);
            });
        
        console.log('[setCurrentTeacher] 완료 - 선생님:', teacher.name);
    } catch (err) {
        console.error('[setCurrentTeacher] 에러 발생:', err);
        console.error('[setCurrentTeacher] 에러 스택:', err.stack);
        
        // 에러 발생 시에도 로딩 화면 제거
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'none';
        
        showToast('선생님 선택 중 에러가 발생했습니다.\n\n에러: ' + (err.message || err), 'error');
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
    if (!teacherId) { showToast('선생님을 선택해주세요.', 'warning'); return; }
    
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) { showToast('선택한 선생님을 찾을 수 없습니다.', 'error'); return; }
    
    console.log('[confirmTeacher] 선택된 선생님:', teacher.name);
    
    // 모든 선생님(관리자 포함)은 개인 비밀번호로 인증
    const password = document.getElementById('teacher-select-password').value.trim();
    
    if (!password) {
        showToast('비밀번호를 입력해주세요', 'warning');
        return;
    }
    
    // Supabase에서 해시를 가져와 비교
    const passwordHash = await hashPin(password);
    console.log('[confirmTeacher] 입력된 비밀번호 해시:', passwordHash);
    console.log('[confirmTeacher] 저장된 해시:', teacher.pin_hash);
    
    if (passwordHash !== teacher.pin_hash) {
        showToast('비밀번호가 일치하지 않습니다.', 'warning');
        return;
    }
    
    console.log('[confirmTeacher] 비밀번호 인증 성공');
    await setCurrentTeacher(teacher);
}

function populateTeacherResetDropdown() {
    const dropdown = document.getElementById('reset-teacher-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '<option value="">선생님을 선택해주세요</option>';
    if (!teacherList || teacherList.length === 0) return;

    teacherList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        let displayText = t.name;
        if (t.phone) {
            const last4 = t.phone.replace(/[^0-9]/g, '').slice(-4);
            displayText += last4 ? ` (${last4})` : '';
        }
        opt.textContent = displayText;
        dropdown.appendChild(opt);
    });

    // 선생님 선택 시 구글 이메일 자동 표시
    dropdown.onchange = function() {
        const emailInput = document.getElementById('reset-teacher-email');
        const emailDisplay = document.getElementById('reset-teacher-email-display');
        const emailText = document.getElementById('reset-teacher-email-text');
        const noEmailMsg = document.getElementById('reset-teacher-no-email');
        
        const selectedTeacher = teacherList.find(t => String(t.id) === String(this.value));
        const teacherEmail = selectedTeacher && (selectedTeacher.google_email || selectedTeacher.email);
        
        if (emailInput) emailInput.value = teacherEmail || '';
        
        if (teacherEmail) {
            if (emailDisplay) { emailDisplay.style.display = 'block'; }
            if (emailText) { emailText.textContent = teacherEmail; }
            if (noEmailMsg) { noEmailMsg.style.display = 'none'; }
        } else if (this.value) {
            if (emailDisplay) { emailDisplay.style.display = 'none'; }
            if (noEmailMsg) { noEmailMsg.style.display = 'block'; }
        } else {
            if (emailDisplay) { emailDisplay.style.display = 'none'; }
            if (noEmailMsg) { noEmailMsg.style.display = 'none'; }
        }
    };
}

window.openTeacherPasswordResetModal = async function() {
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) {
        showToast('로그인이 필요합니다.', 'warning');
        return;
    }

    if (!teacherList || teacherList.length === 0) {
        await loadTeachers();
    }

    populateTeacherResetDropdown();
    const modal = document.getElementById('teacher-password-reset-modal');
    if (modal) modal.style.display = 'flex';
}

window.closeTeacherPasswordResetModal = function() {
    const modal = document.getElementById('teacher-password-reset-modal');
    if (modal) modal.style.display = 'none';
    // Step UI 초기화 (항상 Step 1로 되돌리기)
    const step1 = document.getElementById('reset-step1');
    const step2 = document.getElementById('reset-step2');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    const codeInput = document.getElementById('reset-verify-code');
    if (codeInput) codeInput.value = '';
}

window.confirmTeacherPasswordReset = async function() {
    const teacherId = document.getElementById('reset-teacher-dropdown')?.value || '';
    const currentPassword = document.getElementById('reset-teacher-current-password')?.value.trim() || '';
    const newPassword = document.getElementById('reset-teacher-password')?.value.trim() || '';
    const confirmPassword = document.getElementById('reset-teacher-password-confirm')?.value.trim() || '';

    if (!teacherId) { showToast('선생님을 선택해주세요.', 'warning'); return; }
    if (!currentPassword) { showToast('기존 비밀번호를 입력해주세요.', 'warning'); return; }
    if (!newPassword || !confirmPassword) { showToast('새 비밀번호를 입력해주세요.', 'warning'); return; }
    if (newPassword.length < 4) { showToast('비밀번호는 4자 이상으로 설정해주세요.', 'warning'); return; }
    if (newPassword !== confirmPassword) { showToast('새 비밀번호가 일치하지 않습니다.', 'warning'); return; }

    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }

    try {
        // 기존 비밀번호 확인
        const teacher = teacherList.find(t => String(t.id) === String(teacherId));
        if (!teacher) { showToast('선생님 정보를 찾을 수 없습니다.', 'error'); return; }
        
        const currentHash = await hashPin(currentPassword);
        if (currentHash !== teacher.pin_hash) {
            showToast('기존 비밀번호가 올바르지 않습니다.', 'error');
            return;
        }

        // 새 비밀번호로 변경
        const passwordHash = await hashPin(newPassword);
        const { error } = await supabase
            .from('teachers')
            .update({ pin_hash: passwordHash })
            .eq('id', teacherId)
            .eq('owner_user_id', ownerId);

        if (error) {
            console.error('[confirmTeacherPasswordReset] 실패:', error);
            showToast('비밀번호 변경 실패: ' + error.message, 'error');
            return;
        }

        teacher.pin_hash = passwordHash;

        document.getElementById('reset-teacher-current-password').value = '';
        document.getElementById('reset-teacher-password').value = '';
        document.getElementById('reset-teacher-password-confirm').value = '';
        document.getElementById('reset-teacher-dropdown').value = '';
        window.closeTeacherPasswordResetModal();
        showToast('선생님 비밀번호가 변경되었습니다.', 'success');
    } catch (err) {
        console.error('[confirmTeacherPasswordReset] 예외:', err);
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

// 선생님 비밀번호 초기화 - Step 1: 인증번호 발송
window.sendResetCode = async function() {
    const teacherId = document.getElementById('reset-teacher-dropdown')?.value || '';
    if (!teacherId) { showToast('선생님을 선택해주세요.', 'warning'); return; }

    const teacherEmail = (document.getElementById('reset-teacher-email')?.value || '').trim();
    if (!teacherEmail) { showToast('등록된 구글 이메일이 없습니다.\n선생님 등록 시 구글 인증을 먼저 진행해주세요.', 'warning'); return; }

    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }

    const teacher = teacherList.find(t => String(t.id) === String(teacherId));
    const teacherName = teacher ? teacher.name : '선생님';

    try {
        // 1. 6자리 인증번호 생성
        const code = String(Math.floor(100000 + Math.random() * 900000));

        // 2. DB에 인증번호 저장 (5분 만료)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        // 기존 미사용 코드 삭제 (같은 선생님)
        await supabase
            .from('teacher_reset_codes')
            .delete()
            .eq('teacher_id', teacherId)
            .eq('owner_user_id', ownerId)
            .eq('used', false);

        const { error: insertError } = await supabase
            .from('teacher_reset_codes')
            .insert({
                teacher_id: teacherId,
                owner_user_id: ownerId,
                code: code,
                expires_at: expiresAt
            });

        if (insertError) {
            console.error('[sendResetCode] DB 저장 실패:', insertError);
            showToast('인증번호 저장 실패: ' + insertError.message, 'error');
            return;
        }

        // 3. Edge Function으로 이메일 발송 (supabase.functions.invoke 사용)
        const { data: fnData, error: fnError } = await supabase.functions.invoke('send-reset-code', {
            body: {
                teacherEmail: teacherEmail,
                code: code,
                teacherName: teacherName
            }
        });

        if (fnError) {
            console.error('[sendResetCode] Edge Function 실패:', fnError);
            showToast('이메일 발송 실패: ' + (fnError.message || '알 수 없는 오류'), 'error');
            return;
        }

        if (fnData && fnData.error) {
            console.error('[sendResetCode] 이메일 발송 오류:', fnData.error);
            showToast('이메일 발송 실패: ' + fnData.error, 'error');
            return;
        }

        // 4. UI를 Step 2로 전환
        const step1 = document.getElementById('reset-step1');
        const step2 = document.getElementById('reset-step2');
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = 'block';

        // 인증번호 입력 필드 초기화 및 포커스
        const codeInput = document.getElementById('reset-verify-code');
        if (codeInput) {
            codeInput.value = '';
            codeInput.focus();
        }

        console.log('[sendResetCode] 인증번호 발송 완료:', teacherEmail);

    } catch (err) {
        console.error('[sendResetCode] 예외:', err);
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

// 선생님 비밀번호 초기화 - Step 2: 인증번호 확인 및 초기화
window.verifyAndResetTeacherPassword = async function() {
    const teacherId = document.getElementById('reset-teacher-dropdown')?.value || '';
    if (!teacherId) { showToast('선생님을 선택해주세요.', 'warning'); return; }

    const inputCode = (document.getElementById('reset-verify-code')?.value || '').trim();
    if (!inputCode || inputCode.length !== 6) { showToast('6자리 인증번호를 입력해주세요.', 'warning'); return; }

    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }

    const teacher = teacherList.find(t => String(t.id) === String(teacherId));
    const teacherName = teacher ? teacher.name : '선생님';

    try {
        // 1. DB에서 인증번호 확인
        const { data: codeRows, error: fetchError } = await supabase
            .from('teacher_reset_codes')
            .select('*')
            .eq('teacher_id', teacherId)
            .eq('owner_user_id', ownerId)
            .eq('code', inputCode)
            .eq('used', false)
            .gte('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        if (fetchError) {
            console.error('[verifyAndResetTeacherPassword] 조회 실패:', fetchError);
            showToast('인증번호 확인 실패: ' + fetchError.message, 'error');
            return;
        }

        if (!codeRows || codeRows.length === 0) {
            showToast('인증번호가 올바르지 않거나 만료되었습니다.\n다시 발송해주세요.', 'error');
            return;
        }

        // 2. 인증번호 사용 처리
        await supabase
            .from('teacher_reset_codes')
            .update({ used: true })
            .eq('id', codeRows[0].id);

        // 3. 랜덤 임시 비밀번호 생성 후 초기화
        const tempPw = generateTempPassword();
        const tempHash = await hashPin(tempPw);
        const { error: updateError } = await supabase
            .from('teachers')
            .update({ pin_hash: tempHash })
            .eq('id', teacherId)
            .eq('owner_user_id', ownerId);

        if (updateError) {
            console.error('[verifyAndResetTeacherPassword] 비밀번호 초기화 실패:', updateError);
            showToast('비밀번호 초기화 실패: ' + updateError.message, 'error');
            return;
        }

        if (teacher) teacher.pin_hash = tempHash;

        // 4. 폼 초기화 및 모달 닫기
        document.getElementById('reset-teacher-current-password').value = '';
        document.getElementById('reset-teacher-password').value = '';
        document.getElementById('reset-teacher-password-confirm').value = '';
        document.getElementById('reset-teacher-email').value = '';
        document.getElementById('reset-teacher-dropdown').value = '';
        document.getElementById('reset-verify-code').value = '';
        const emailDisplay = document.getElementById('reset-teacher-email-display');
        const noEmailMsg = document.getElementById('reset-teacher-no-email');
        if (emailDisplay) emailDisplay.style.display = 'none';
        if (noEmailMsg) noEmailMsg.style.display = 'none';
        // Step UI 초기화
        const step1 = document.getElementById('reset-step1');
        const step2 = document.getElementById('reset-step2');
        if (step1) step1.style.display = 'block';
        if (step2) step2.style.display = 'none';

        window.closeTeacherPasswordResetModal();
        showToast(`${teacherName}의 임시 비밀번호: ${tempPw}\n반드시 메모 후 변경해주세요.`, 'success');

    } catch (err) {
        console.error('[verifyAndResetTeacherPassword] 예외:', err);
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

// ========== 관리자 강제 비밀번호 초기화 모달 ==========
window.openForceResetModal = async function() {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('관리자만 사용할 수 있는 기능입니다.', 'warning');
        return;
    }

    if (!teacherList || teacherList.length === 0) {
        await loadTeachers();
    }

    // 드롭다운 채우기
    const dropdown = document.getElementById('force-reset-teacher-dropdown');
    if (dropdown) {
        dropdown.innerHTML = '<option value="">선생님을 선택해주세요</option>';
        teacherList.forEach(t => {
            const roleText = t.teacher_role === 'admin' ? ' (관리자)' : t.teacher_role === 'staff' ? ' (직원)' : '';
            dropdown.innerHTML += `<option value="${t.id}">${t.name}${roleText}</option>`;
        });
    }

    const modal = document.getElementById('force-reset-modal');
    if (modal) modal.style.display = 'flex';
}

window.closeForceResetModal = function() {
    const modal = document.getElementById('force-reset-modal');
    if (modal) modal.style.display = 'none';
    const dropdown = document.getElementById('force-reset-teacher-dropdown');
    const pwInput = document.getElementById('force-reset-admin-password');
    if (dropdown) dropdown.value = '';
    if (pwInput) pwInput.value = '';
}

window.forceResetTeacherPassword = async function() {
    const teacherId = document.getElementById('force-reset-teacher-dropdown')?.value || '';
    if (!teacherId) { showToast('선생님을 선택해주세요.', 'warning'); return; }

    const adminPassword = (document.getElementById('force-reset-admin-password')?.value || '').trim();
    if (!adminPassword) { showToast('관리자 비밀번호를 입력해주세요.', 'warning'); return; }

    const teacher = teacherList.find(t => String(t.id) === String(teacherId));
    const teacherName = teacher ? teacher.name : '선생님';

    // 최종 확인
    if (!(await showConfirm(`정말 ${teacherName}의 비밀번호를 강제 초기화하시겠습니까?\n\n랜덤 임시 비밀번호가 발급됩니다.\n이 작업은 되돌릴 수 없습니다.`, { type: 'danger', title: '비밀번호 초기화', okText: '초기화' }))) {
        return;
    }

    try {
        // 관리자 비밀번호 확인 (Supabase Auth로 재인증)
        const currentUser = (await supabase.auth.getUser()).data.user;
        if (!currentUser || !currentUser.email) {
            showToast('관리자 로그인 정보를 확인할 수 없습니다.', 'warning');
            return;
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: currentUser.email,
            password: adminPassword
        });

        if (signInError) {
            console.error('[forceResetTeacherPassword] 관리자 비밀번호 불일치:', signInError);
            showToast('관리자 비밀번호가 올바르지 않습니다.', 'error');
            return;
        }

        // 랜덤 임시 비밀번호 생성 후 강제 초기화
        const tempPw = generateTempPassword();
        const ownerId = cachedLsGet('current_owner_id');
        const tempHash = await hashPin(tempPw);
        const { error: updateError } = await supabase
            .from('teachers')
            .update({ pin_hash: tempHash })
            .eq('id', teacherId)
            .eq('owner_user_id', ownerId);

        if (updateError) {
            console.error('[forceResetTeacherPassword] 초기화 실패:', updateError);
            showToast('비밀번호 초기화 실패: ' + updateError.message, 'error');
            return;
        }

        if (teacher) teacher.pin_hash = tempHash;

        // UI 초기화 및 모달 닫기
        window.closeForceResetModal();
        showToast(`${teacherName}의 임시 비밀번호: ${tempPw}\n반드시 메모 후 변경해주세요.`, 'success');

    } catch (err) {
        console.error('[forceResetTeacherPassword] 예외:', err);
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

window.deleteTeacher = async function() {
    const teacherId = document.getElementById('teacher-dropdown').value;
    if (!teacherId) { showToast('삭제할 선생님을 선택해주세요.', 'warning'); return; }

    const target = teacherList.find(t => String(t.id) === String(teacherId));
    const targetName = target ? target.name : '선생님';
    if (!(await showConfirm(`${targetName}을(를) 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;

    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) { showToast('로그인이 필요합니다.', 'warning'); return; }

    const { error } = await supabase
        .from('teachers')
        .delete()
        .eq('id', teacherId)
        .eq('owner_user_id', ownerId);

    if (error) {
        console.error('선생님 삭제 실패', error);
        showToast('삭제 실패: ' + error.message, 'error');
        return;
    }

    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        removeTabValue('current_teacher_id');
        removeTabValue('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
        }
    }

    showToast('선생님이 삭제되었습니다.', 'success');
    await loadTeachers();
    const dropdown = document.getElementById('teacher-dropdown');
    if (dropdown) dropdown.value = '';
}

// 관리자(소유자) 강제 삭제: 관리자 비밀번호 재입력 필요
window.adminDeleteTeacher = async function() {
    console.log('[adminDeleteTeacher] 삭제 버튼 클릭');
    const dropdown = document.getElementById('teacher-dropdown');
    const teacherId = dropdown ? dropdown.value : '';
    console.log('[adminDeleteTeacher] 선택된 teacherId:', teacherId);
    if (!teacherId) { showToast('삭제할 선생님을 선택해주세요.', 'warning'); return; }

    const target = teacherList.find(t => String(t.id) === String(teacherId));
    const name = target ? target.name : '선생님';
    if (!(await showConfirm(`${name}을(를) 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) { showToast('로그인이 필요합니다.', 'warning'); return; }

    const adminEmail = session.user?.email;
    const password = await showPrompt('관리자 비밀번호를 입력하세요', { title: '관리자 인증', placeholder: '로그인 비밀번호', inputType: 'password' });
    if (password === null) return; // 취소
    if (!password.trim()) { showToast('비밀번호를 입력해주세요.', 'warning'); return; }

    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: adminEmail, password });
    if (reauthError) {
        console.error('재인증 실패', reauthError);
        showToast('비밀번호가 올바르지 않습니다.', 'error');
        return;
    }

    const ok = await deleteTeacherById(teacherId);
    if (!ok) return;

    if (currentTeacherId === teacherId) {
        currentTeacher = null;
        currentTeacherId = null;
        removeTabValue('current_teacher_id');
        removeTabValue('current_teacher_name');
        const mainApp = document.getElementById('main-app');
        const teacherPage = document.getElementById('teacher-select-page');
        if (mainApp) mainApp.style.setProperty('display', 'none', 'important');
        if (teacherPage) {
            teacherPage.style.display = 'flex';
            teacherPage.style.visibility = 'visible';
        }
    }

    showToast('강제 삭제가 완료되었습니다.', 'success');
    await loadTeachers();
    if (dropdown) dropdown.value = '';
}

// ========== Google OAuth 이메일 인증 ==========
let _googleTokenClient = null;

window.startGoogleAuth = function() {
    console.log('[startGoogleAuth] Google OAuth 시작');
    
    // Google Identity Services 로드 확인
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        showToast('Google 인증 서비스를 로드하는 중입니다. 잠시 후 다시 시도해주세요.', 'info');
        console.error('[startGoogleAuth] Google Identity Services 미로드');
        return;
    }

    if (window.GOOGLE_CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
        showToast('Google Client ID가 설정되지 않았습니다.\nsupabase-config.js 또는 환경 변수에서 GOOGLE_CLIENT_ID를 설정해주세요.\n\nGoogle Cloud Console에서 OAuth 2.0 클라이언트 ID를 생성하세요.', 'warning');
        return;
    }

    try {
        _googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: window.GOOGLE_CLIENT_ID,
            scope: window.GOOGLE_SCOPES,
            callback: handleGoogleAuthCallback,
            error_callback: function(error) {
                console.error('[startGoogleAuth] OAuth 에러:', error);
                if (error.type === 'popup_closed') {
                    console.log('[startGoogleAuth] 사용자가 팝업을 닫았습니다.');
                } else {
                    showToast('Google 인증 중 오류가 발생했습니다: ' + (error.message || error.type || '알 수 없는 오류'), 'error');
                }
            }
        });

        _googleTokenClient.requestAccessToken();
    } catch (err) {
        console.error('[startGoogleAuth] 예외:', err);
        showToast('Google 인증 초기화 실패: ' + err.message, 'error');
    }
}

window.handleGoogleAuthCallback = async function(tokenResponse) {
    console.log('[handleGoogleAuthCallback] 토큰 응답 수신');
    
    if (tokenResponse.error) {
        console.error('[handleGoogleAuthCallback] 에러:', tokenResponse.error);
        showToast('Google 인증 실패: ' + tokenResponse.error, 'error');
        return;
    }

    try {
        // Google userinfo API로 이메일/프로필 정보 가져오기
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': 'Bearer ' + tokenResponse.access_token }
        });

        if (!response.ok) {
            throw new Error('Google 사용자 정보를 가져올 수 없습니다. (HTTP ' + response.status + ')');
        }

        const userInfo = await response.json();
        console.log('[handleGoogleAuthCallback] 사용자 정보:', userInfo.email, userInfo.sub);

        if (!userInfo.email) {
            showToast('Google 계정에서 이메일 정보를 가져올 수 없습니다.', 'error');
            return;
        }

        if (!userInfo.email_verified) {
            showToast('인증되지 않은 Google 이메일입니다. 이메일 인증이 완료된 계정을 사용해주세요.', 'warning');
            return;
        }

        // access_token 임시 저장 (향후 Drive API 활용 시 사용)
        window._googleAccessToken = tokenResponse.access_token;

        // ★ 내 정보수정 모달에서 호출된 경우
        if (window._googleAuthTarget === 'myinfo') {
            window._googleAuthTarget = null;
            console.log('[handleGoogleAuthCallback] 내 정보수정 이메일 변경:', userInfo.email);

            // DB에 즉시 저장
            if (currentTeacher && currentTeacher.id) {
                try {
                    await supabase.from('teachers').update({
                        google_email: userInfo.email,
                        google_sub: userInfo.sub,
                        email: userInfo.email
                    }).eq('id', currentTeacher.id);
                    currentTeacher.google_email = userInfo.email;
                    currentTeacher.email = userInfo.email;
                } catch (e) {
                    console.error('[handleGoogleAuthCallback] 이메일 DB 저장 실패:', e);
                }
            }

            // teacherList 동기화
            const tInList = teacherList.find(x => String(x.id) === String(currentTeacher.id));
            if (tInList) {
                tInList.google_email = userInfo.email;
                tInList.email = userInfo.email;
            }

            // 내 정보수정 모달 UI 업데이트
            const myEmailDisplay = document.getElementById('my-info-email-display');
            const myEmailText = document.getElementById('my-info-email-text');
            const myNoEmail = document.getElementById('my-info-no-email');
            if (myEmailDisplay) myEmailDisplay.style.display = 'block';
            if (myEmailText) myEmailText.textContent = userInfo.email;
            if (myNoEmail) myNoEmail.style.display = 'none';

            showToast('구글 이메일이 변경되었습니다.', 'success');
            return;
        }

        window._googleAuthTarget = null;

        // 폼에 인증된 이메일 정보 반영 (선생님 등록 폼)
        document.getElementById('new-teacher-email').value = userInfo.email;
        document.getElementById('new-teacher-google-sub').value = userInfo.sub;

        // 인증 버튼 숨기고 인증 완료 영역 표시
        const authBtn = document.getElementById('google-auth-btn');
        const verifiedSection = document.getElementById('google-verified-email');
        const verifiedText = document.getElementById('verified-email-text');

        if (authBtn) authBtn.style.display = 'none';
        if (verifiedSection) verifiedSection.style.display = 'block';
        if (verifiedText) verifiedText.textContent = userInfo.email;

        console.log('[handleGoogleAuthCallback] 이메일 인증 완료:', userInfo.email);

    } catch (err) {
        console.error('[handleGoogleAuthCallback] 예외:', err);
        showToast('Google 사용자 정보 조회 실패: ' + err.message, 'error');
    }
}

// Google 인증 상태 초기화 (선생님 등록 폼 리셋 시 사용)
function resetGoogleAuth() {
    document.getElementById('new-teacher-email').value = '';
    document.getElementById('new-teacher-google-sub').value = '';
    
    const authBtn = document.getElementById('google-auth-btn');
    const verifiedSection = document.getElementById('google-verified-email');
    
    if (authBtn) authBtn.style.display = 'flex';
    if (verifiedSection) verifiedSection.style.display = 'none';
    
    window._googleAccessToken = null;
}

// ========== 관리자 회원가입용 Google OAuth ==========
window.startGoogleAuthAdmin = function() {
    console.log('[startGoogleAuthAdmin] Google OAuth 시작 (관리자)');
    
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        showToast('Google 인증 서비스를 로드하는 중입니다. 잠시 후 다시 시도해주세요.', 'info');
        return;
    }

    if (window.GOOGLE_CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
        showToast('Google Client ID가 설정되지 않았습니다.\nsupabase-config.js 또는 환경 변수에서 GOOGLE_CLIENT_ID를 설정해주세요.', 'warning');
        return;
    }

    try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: window.GOOGLE_CLIENT_ID,
            scope: 'email profile',
            callback: handleGoogleAuthCallbackAdmin,
            error_callback: function(error) {
                console.error('[startGoogleAuthAdmin] OAuth 에러:', error);
                if (error.type !== 'popup_closed') {
                    showToast('Google 인증 중 오류가 발생했습니다: ' + (error.message || error.type || '알 수 없는 오류'), 'error');
                }
            }
        });

        tokenClient.requestAccessToken();
    } catch (err) {
        console.error('[startGoogleAuthAdmin] 예외:', err);
        showToast('Google 인증 초기화 실패: ' + err.message, 'error');
    }
}

window.handleGoogleAuthCallbackAdmin = async function(tokenResponse) {
    console.log('[handleGoogleAuthCallbackAdmin] 토큰 응답 수신');
    
    if (tokenResponse.error) {
        console.error('[handleGoogleAuthCallbackAdmin] 에러:', tokenResponse.error);
        showToast('Google 인증 실패: ' + tokenResponse.error, 'error');
        return;
    }

    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': 'Bearer ' + tokenResponse.access_token }
        });

        if (!response.ok) {
            throw new Error('Google 사용자 정보를 가져올 수 없습니다. (HTTP ' + response.status + ')');
        }

        const userInfo = await response.json();
        console.log('[handleGoogleAuthCallbackAdmin] 사용자 정보:', userInfo.email);

        if (!userInfo.email) {
            showToast('Google 계정에서 이메일 정보를 가져올 수 없습니다.', 'error');
            return;
        }

        if (!userInfo.email_verified) {
            showToast('인증되지 않은 Google 이메일입니다. 이메일 인증이 완료된 계정을 사용해주세요.', 'warning');
            return;
        }

        // 회원가입 폼에 인증된 이메일 반영
        document.getElementById('signup-email').value = userInfo.email;

        const authBtn = document.getElementById('admin-google-auth-btn');
        const verifiedSection = document.getElementById('admin-google-verified-email');
        const verifiedText = document.getElementById('admin-verified-email-text');

        if (authBtn) authBtn.style.display = 'none';
        if (verifiedSection) verifiedSection.style.display = 'block';
        if (verifiedText) verifiedText.textContent = userInfo.email;

        console.log('[handleGoogleAuthCallbackAdmin] 이메일 인증 완료:', userInfo.email);

    } catch (err) {
        console.error('[handleGoogleAuthCallbackAdmin] 예외:', err);
        showToast('Google 사용자 정보 조회 실패: ' + err.message, 'error');
    }
}

// 관리자 회원가입 Google 인증 상태 초기화
function resetGoogleAuthAdmin() {
    const emailInput = document.getElementById('signup-email');
    if (emailInput) emailInput.value = '';
    
    const authBtn = document.getElementById('admin-google-auth-btn');
    const verifiedSection = document.getElementById('admin-google-verified-email');
    
    if (authBtn) authBtn.style.display = 'flex';
    if (verifiedSection) verifiedSection.style.display = 'none';
}

window.registerTeacher = async function() {
    try {
        console.log('[registerTeacher] 시작');
        const name = document.getElementById('new-teacher-name').value.trim();
        const googleEmail = document.getElementById('new-teacher-email').value.trim();
        const googleSub = document.getElementById('new-teacher-google-sub').value.trim();
        const phone = document.getElementById('new-teacher-phone').value.trim();
        const address = document.getElementById('new-teacher-address').value.trim();
        const addressDetail = document.getElementById('new-teacher-address-detail').value.trim();
        const teacherPassword = document.getElementById('register-teacher-password').value.trim();
        const teacherPasswordConfirm = document.getElementById('register-teacher-password-confirm')?.value.trim() || '';
        
        console.log('[registerTeacher] 입력 값 - name:', name, ', googleEmail:', googleEmail, ', phone:', phone, ', address:', address);
        
        if (!name) { showToast('선생님 이름은 필수입니다.', 'warning'); return; }

        // 구글 이메일 인증 필수
        if (!googleEmail || !googleSub) {
            showToast('구글 이메일 인증이 필요합니다.\n"구글 이메일 인증" 버튼을 눌러 인증해주세요.', 'warning');
            return;
        }
        
        // 모든 선생님은 비밀번호가 필수
        if (!teacherPassword || !teacherPasswordConfirm) {
            showToast('비밀번호는 필수입니다.', 'warning');
            return;
        }

        if (teacherPassword !== teacherPasswordConfirm) {
            showToast('비밀번호가 일치하지 않습니다.', 'warning');
            return;
        }
        
        // 저장된 현재 관리자 ID 확인
        const ownerId = cachedLsGet('current_owner_id');
        console.log('[registerTeacher] current_owner_id:', ownerId);
        
        if (!ownerId) {
            console.error('[registerTeacher] 로그인 정보 없음');
            showToast('로그인 세션이 만료되었습니다. 다시 로그인해주세요.', 'warning');
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
                email: googleEmail || null,
                google_email: googleEmail || null,
                google_sub: googleSub || null,
                phone: phone || null, 
                address: address || null,
                address_detail: addressDetail || null,
                pin_hash: passwordHash, 
                teacher_role: 'teacher' 
            })
            .select()
            .single();
        
        if (error) {
            console.error('[registerTeacher] Supabase 에러:', error);
            console.error('[registerTeacher] 에러 상세:', error.message, error.code, error.details);
            showToast('선생님 등록 실패:\n' + error.message, 'error');
            return;
        }
        
        console.log('[registerTeacher] 등록 성공:', data);
        
        // 입력 필드 초기화
        document.getElementById('new-teacher-name').value = '';
        document.getElementById('new-teacher-phone').value = '';
        document.getElementById('new-teacher-address').value = '';
        document.getElementById('new-teacher-address-detail').value = '';
        document.getElementById('register-teacher-password').value = '';
        const teacherPasswordConfirmInput = document.getElementById('register-teacher-password-confirm');
        if (teacherPasswordConfirmInput) teacherPasswordConfirmInput.value = '';
        
        // Google 인증 상태 초기화
        resetGoogleAuth();
        
        showToast('선생님이 등록되었습니다!', 'success');
        
        // 선생님 목록 새로고침
        console.log('[registerTeacher] 선생님 목록 새로고침 중...');
        await loadTeachers();
        
        // 선생님 선택 화면으로 돌아가기
        console.log('[registerTeacher] 선생님 선택 폼으로 전환');
        toggleTeacherForm();
    } catch (err) {
        console.error('[registerTeacher] 예외 발생:', err);
        console.error('[registerTeacher] 스택:', err.stack);
        showToast('오류 발생: ' + (err.message || err), 'error');
    }
}

window.showTeacherSelectPage = async function() {
    console.log('[showTeacherSelectPage] 선생님 선택 페이지로 이동');
    navigateToPage('TEACHER_SELECT');
    await loadTeachers();
}

// ★ 내 정보 수정 모달
window.openMyInfoEditModal = async function() {
    if (!currentTeacher || !currentTeacher.id) {
        showToast('선생님 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    // Supabase에서 최신 정보 조회
    try {
        const { data, error } = await supabase
            .from('teachers')
            .select('name, phone, google_email, address, address_detail')
            .eq('id', currentTeacher.id)
            .single();

        if (error) throw error;

        document.getElementById('my-info-name').value = data.name || '';
        document.getElementById('my-info-phone').value = data.phone || '';
        document.getElementById('my-info-address').value = data.address || '';
        document.getElementById('my-info-address-detail').value = data.address_detail || '';

        const emailDisplay = document.getElementById('my-info-email-display');
        const emailText = document.getElementById('my-info-email-text');
        const noEmail = document.getElementById('my-info-no-email');
        if (data.google_email) {
            emailText.textContent = data.google_email;
            emailDisplay.style.display = 'block';
            noEmail.style.display = 'none';
        } else {
            emailDisplay.style.display = 'none';
            noEmail.style.display = 'block';
        }

    } catch (e) {
        console.error('[openMyInfoEditModal] 조회 실패:', e);
        document.getElementById('my-info-name').value = currentTeacher.name || '';
        document.getElementById('my-info-phone').value = currentTeacher.phone || '';
    }

    openModal('my-info-modal');
}

window.saveMyInfo = async function() {
    const name = document.getElementById('my-info-name').value.trim();
    const phone = document.getElementById('my-info-phone').value.trim();
    const address = document.getElementById('my-info-address').value.trim();
    const addressDetail = document.getElementById('my-info-address-detail').value.trim();

    if (!name) { showToast('이름을 입력해주세요.', 'warning'); return; }

    try {
        const { error } = await supabase
            .from('teachers')
            .update({
                name: name,
                phone: phone || null,
                address: address || null,
                address_detail: addressDetail || null
            })
            .eq('id', currentTeacher.id);

        if (error) throw error;

        // 로컬 데이터 업데이트
        currentTeacher.name = name;
        currentTeacher.phone = phone;
        currentTeacher.address = address || null;
        currentTeacher.address_detail = addressDetail || null;
        const label = document.getElementById('current-teacher-name');
        if (label) label.textContent = name;
        setTabValue('current_teacher_name', name);

        // teacherList 및 선생님 관리 모달 동기화
        await loadTeachers();
        if (typeof renderTeacherListModal === 'function') renderTeacherListModal();

        closeModal('my-info-modal');
        showToast('정보가 수정되었습니다.', 'success');
    } catch (e) {
        console.error('[saveMyInfo] 저장 실패:', e);
        showToast('저장에 실패했습니다: ' + e.message, 'error');
    }
}

window.searchAddressForMyInfo = function() {
    new daum.Postcode({
        oncomplete: function(data) {
            let addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
            document.getElementById('my-info-address').value = addr;
            document.getElementById('my-info-address-detail').focus();
        }
    }).open();
}

// 내 정보수정 모달 전용 구글 인증
window._googleAuthTarget = null; // 'register' | 'myinfo'

window.startGoogleAuthForMyInfo = function() {
    window._googleAuthTarget = 'myinfo';
    startGoogleAuth();
}

const defaultColor = '#ef4444';

function getHolidayInfo(dateStr) {
    // 1순위: 직접 등록한 커스텀 스케줄/공휴일
    if (customHolidays.hasOwnProperty(dateStr)) {
        const raw = customHolidays[dateStr];
        if (typeof raw === 'string') return { name: raw, color: defaultColor };
        return { name: raw.name || '', color: raw.color || defaultColor };
    }
    
    const [year] = dateStr.split('-');
    
    // 2순위: 공공데이터 API 캐시 (실시간 공휴일 — 대체공휴일, 임시공휴일 포함)
    if (apiHolidayCache[year] && apiHolidayCache[year][dateStr]) {
        return { name: apiHolidayCache[year][dateStr], color: defaultColor };
    }
    
    // 3순위: 하드코딩 양력 공휴일 (API 키 없을 때 폴백)
    const mmdd = dateStr.substring(5); // "MM-DD"
    const solarHolidays = { "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일", "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절" };
    if (solarHolidays[mmdd]) return { name: solarHolidays[mmdd], color: defaultColor };
    
    // 4순위: 하드코딩 음력 공휴일 폴백
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

function getGradeColorClass(grade, prefix = 'evt') {
    if(!grade) return `${prefix}-color-default`;
    if(grade.includes('초')) return `${prefix}-grade-cho`;
    if(grade.includes('중')) return `${prefix}-grade-jung`;
    if(grade.includes('고')) return `${prefix}-grade-go`;
    return `${prefix}-color-default`;
}

// 하위 호환: 기존 코드에서 getSubItemColorClass 호출하는 곳이 있으면 자동 연결
function getSubItemColorClass(grade) {
    return getGradeColorClass(grade, 'sub');
}

// renderCalendar 내부 구현
function _renderCalendarImpl() {
    // QR 출석 뱃지는 일정 렌더 직후 2.5초간만 표시
    if (lastQrScannedStudentId) {
        setTimeout(() => { lastQrScannedStudentId = null; renderCalendar(); }, 2500);
    }
    
    // 현재 표시 중인 연도의 공휴일 데이터가 없으면 백그라운드 로드
    const displayYear = currentDate.getFullYear();
    if (!apiHolidayCache[displayYear] && !window._holidayLoading?.[displayYear]) {
        if (!window._holidayLoading) window._holidayLoading = {};
        window._holidayLoading[displayYear] = true;
        fetchPublicHolidays(displayYear).then(() => {
            window._holidayLoading[displayYear] = false;
            if (apiHolidayCache[displayYear]) renderCalendar();
        });
    }
    
    const grid = document.getElementById('calendar-grid');
    const display = document.getElementById('current-display');
    
    if(!grid || !display) return;

    // DocumentFragment로 DOM 조작 최소화
    const fragment = document.createDocumentFragment();
    const todayStr = getTodayStr();

    const cellModels = [];
    if (currentView === 'month') {
        display.textContent = `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월`;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const startDow = new Date(year, month, 1).getDay();

        // 이전 달 채우기
        if (startDow > 0) {
            const prevLastDay = new Date(year, month, 0).getDate();
            for (let i = startDow - 1; i >= 0; i--) {
                cellModels.push({
                    date: new Date(year, month - 1, prevLastDay - i),
                    isOtherMonth: true
                });
            }
        }

        // 이번 달
        for (let i = 1; i <= lastDay; i++) {
            cellModels.push({
                date: new Date(year, month, i),
                isOtherMonth: false
            });
        }

        // 다음 달 채우기 (5~6줄)
        const totalCells = startDow + lastDay;
        const totalRows = totalCells <= 35 ? 35 : 42;
        for (let i = 1; i <= totalRows - totalCells; i++) {
            cellModels.push({
                date: new Date(year, month + 1, i),
                isOtherMonth: true
            });
        }
    } else {
        const start = new Date(currentDate);
        start.setDate(currentDate.getDate() - currentDate.getDay());
        display.textContent = `${start.getMonth()+1}월 ${start.getDate()}일 주간`;
        for (let i = 0; i <= 6; i++) {
            const dateObj = new Date(start);
            dateObj.setDate(start.getDate() + i);
            cellModels.push({
                date: dateObj,
                isOtherMonth: false
            });
        }
    }

    const renderDateList = cellModels.map((model) => dateToStr(model.date));
    const summaryMap = buildCalendarSummaryMap(renderDateList);
    cellModels.forEach((model) => {
        const dateStr = dateToStr(model.date);
        const precomputedRows = summaryMap.get(dateStr) || [];
        const cell = createCell(model.date, null, todayStr, precomputedRows);
        if (model.isOtherMonth) cell.classList.add('other-month');
        fragment.appendChild(cell);
    });

    grid.innerHTML = '';
    grid.appendChild(fragment);
}

// 디바운스된 renderCalendar (연속 호출 시 마지막만 실행)
const _debouncedRender = debounce(_renderCalendarImpl, 50);

window.renderCalendar = function(immediate) {
    if (immediate) {
        _renderCalendarImpl();
    } else {
        _debouncedRender();
    }
}

function collectCellScheduleSummary(dateStr) {
    const results = [];
    const seen = new Set();
    const teacherIds = getTeacherIdsForTimetableScope();
    for (const teacherId of teacherIds) {
        const teacherSched = teacherScheduleData[teacherId] || {};
        const activeStudents = getActiveStudentsForTeacher(teacherId);
        for (const student of activeStudents) {
            if (!student || !shouldShowScheduleForStudent(student, dateStr)) continue;
            const entries = normalizeScheduleEntries((teacherSched[String(student.id)] || {})[dateStr]);
            if (!entries.length) continue;
            const uniqueKey = `${teacherId}__${student.id}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            results.push({
                studentName: student.name,
                grade: student.grade || '-',
                teacherId: String(teacherId),
                teacherName: getTeacherNameById(teacherId)
            });
        }
    }
    return results;
}

function buildCalendarSummaryMap(dateStrList) {
    const targetDates = new Set((dateStrList || []).map((value) => String(value || '')).filter(Boolean));
    const summaryMap = new Map();
    if (targetDates.size === 0) return summaryMap;
    if (timetableScope === 'all' && !allScopeScheduleHydrated) return summaryMap;

    const seen = new Set();
    const teacherIds = getTeacherIdsForTimetableScope();
    for (const teacherId of teacherIds) {
        const teacherSched = teacherScheduleData[teacherId] || {};
        const teacherName = getTeacherNameById(teacherId);
        const activeStudents = getActiveStudentsForTeacher(teacherId);
        for (const student of activeStudents) {
            if (!student) continue;
            const sid = String(student.id || '');
            if (!sid) continue;
            const byDate = teacherSched[sid] || {};
            const scheduleDates = Object.keys(byDate);
            if (!scheduleDates.length) continue;
            for (const dateStr of scheduleDates) {
                if (!targetDates.has(dateStr)) continue;
                if (!shouldShowScheduleForStudent(student, dateStr)) continue;
                const entries = normalizeScheduleEntries(byDate[dateStr]);
                if (!entries.length) continue;
                const dedupeKey = `${teacherId}__${sid}__${dateStr}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                if (!summaryMap.has(dateStr)) summaryMap.set(dateStr, []);
                summaryMap.get(dateStr).push({
                    studentName: student.name,
                    grade: student.grade || '-',
                    teacherId: String(teacherId),
                    teacherName
                });
            }
        }
    }
    return summaryMap;
}

function createCell(date, activeStudents, todayStr, precomputedSummaryRows) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    const dateStr = dateToStr(date);
    cell.dataset.date = dateStr;

    // 이벤트 위임: grid 레벨에서 처리하므로 개별 셀 클릭 리스너 최소화
    cell.addEventListener('click', (e) => {
        if(e.target.closest('.student-tag')) return;
        if(e.target.closest('.summary-badge')) {
            e.stopPropagation();
            openDayDetail(dateStr);
            return;
        }
        if(e.button === 0) openDaySettings(dateStr);
    });

    cell.addEventListener('dragover', handleDragOver);
    cell.addEventListener('dragleave', handleDragLeave);
    cell.addEventListener('drop', handleDrop);

    const day = date.getDay();
    const holidayInfo = getHolidayInfo(dateStr);
    const holidayName = holidayInfo ? holidayInfo.name : '';
    let dayClass = '';
    if (day === 0 || holidayInfo) dayClass = 'is-holiday';
    else if (day === 6) dayClass = 'sat';

    if (dateStr === (todayStr || getTodayStr())) dayClass += ' is-today';

    if (holidayInfo) {
        cell.classList.add('custom-holiday');
        cell.style.setProperty('--holiday-color', holidayInfo.color || 'var(--red)');
    }

    cell.innerHTML = `
        <span class="date-num ${dayClass}">${date.getDate()}</span>
        ${holidayName ? `<span class="holiday-name">${holidayName}</span>` : ''}
    `;

    // 일정이 있는 학생 수 빠르게 카운트
    const summaryRows = Array.isArray(precomputedSummaryRows)
        ? precomputedSummaryRows
        : collectCellScheduleSummary(dateStr);
    const eventCount = summaryRows.length;
    const pendingAllScopeSummary = timetableScope === 'all' && !allScopeScheduleHydrated && allScopeScheduleLoading;
    const eventNames = summaryRows.map((row) => {
        const teacherText = timetableScope === 'all' ? ` · ${escapeHtml(row.teacherName)}` : '';
        return `<div>${escapeHtml(row.studentName)} (${escapeHtml(row.grade)})${teacherText}</div>`;
    });

    if (pendingAllScopeSummary) {
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'summary-badge-container';
        const badge = document.createElement('div');
        badge.className = 'summary-badge';
        badge.textContent = '집계중';
        badgeContainer.appendChild(badge);
        cell.appendChild(badgeContainer);
    } else if (eventCount > 0) {
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'summary-badge-container';
        const badge = document.createElement('div');
        badge.className = 'summary-badge has-events';
        badge.textContent = `${eventCount}명`;

        badge.addEventListener('mouseenter', () => {
            const tooltip = document.getElementById('calendar-tooltip');
            if (!tooltip) return;
            tooltip.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">${dateStr}</div>${eventNames.join('')}`;
            tooltip.style.display = 'block';
        });
        badge.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('calendar-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        });

        badgeContainer.appendChild(badge);
        cell.appendChild(badgeContainer);
    }
    return cell;
}

window.openDayDetail = async function(dateStr) {
    const modal = document.getElementById('day-detail-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('day-detail-title').textContent = `${dateStr} 시간표`;
    // 검색 초기화
    const searchInput = document.getElementById('tt-search-input');
    if (searchInput) { searchInput.value = ''; }
    const clearBtn = document.getElementById('tt-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    updateTimetableScopeUi();
    if (timetableScope === 'all' && typeof loadAllTeachersScheduleData === 'function') {
        try {
            await loadAllTeachersScheduleData();
        } catch (e) {
            console.warn('[openDayDetail] 전체 일정 재로드 실패:', e);
        }
    }
    currentDetailDate = dateStr;
    await ensureAttendanceForDate(dateStr);
    renderDayEvents(dateStr);
    // 하이라이트 초기화
    clearTimetableSearch();
}

// ── 시간표 학생 검색 ──
window.searchStudentInTimetable = function(query) {
    const clearBtn = document.getElementById('tt-search-clear');
    const q = (query || '').trim();
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';

    const blocks = document.querySelectorAll('#time-grid .event-block');
    if (!q) {
        // 검색어 비어있으면 모두 원래 상태
        blocks.forEach(b => { b.classList.remove('tt-highlight', 'tt-dim'); });
        document.querySelectorAll('.sub-event-item').forEach(s => { s.classList.remove('tt-sub-highlight', 'tt-sub-dim'); });
        return;
    }

    let hasMatch = false;
    blocks.forEach(b => {
        const names = (b.dataset.studentNames || '').split(',');
        const blockMatch = names.some(n => n.includes(q));
        if (blockMatch) {
            b.classList.add('tt-highlight');
            b.classList.remove('tt-dim');
            hasMatch = true;
            // 머지 그룹 내 개별 학생 하이라이트
            const subItems = b.querySelectorAll('.sub-event-item');
            if (subItems.length > 0) {
                subItems.forEach(si => {
                    const sName = si.dataset.studentName || '';
                    if (sName.includes(q)) {
                        si.classList.add('tt-sub-highlight');
                        si.classList.remove('tt-sub-dim');
                    } else {
                        si.classList.add('tt-sub-dim');
                        si.classList.remove('tt-sub-highlight');
                    }
                });
            }
        } else {
            b.classList.add('tt-dim');
            b.classList.remove('tt-highlight');
            b.querySelectorAll('.sub-event-item').forEach(si => {
                si.classList.remove('tt-sub-highlight', 'tt-sub-dim');
            });
        }
    });

    // 검색 결과가 있으면 첫 번째 하이라이트 블록으로 스크롤
    if (hasMatch) {
        const firstMatch = document.querySelector('#time-grid .event-block.tt-highlight');
        if (firstMatch) {
            const container = document.querySelector('.day-detail-card .modal-body');
            if (container) {
                const blockTop = firstMatch.offsetTop;
                const containerHeight = container.clientHeight;
                container.scrollTop = Math.max(0, blockTop - containerHeight / 3);
            }
        }
    }
}

window.clearTimetableSearch = function() {
    const input = document.getElementById('tt-search-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('tt-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    document.querySelectorAll('#time-grid .event-block').forEach(b => {
        b.classList.remove('tt-highlight', 'tt-dim');
    });
    document.querySelectorAll('.sub-event-item').forEach(s => {
        s.classList.remove('tt-sub-highlight', 'tt-sub-dim');
    });
}

window.renderDayEvents = function(dateStr) {
    const axis = document.getElementById('time-axis');
    const grid = document.getElementById('time-grid');
    axis.innerHTML = '';
    grid.innerHTML = '';

    const pxPerMin = 1.0; // 1 minute = 1 pixel
    const paddingTop = 24; // 상단 여유 공간
    const paddingBottom = 120; // 하단 여유 공간 (24:00 근처 블록 잘림 방지)
    const totalHeight = paddingTop + (24 * 60 * pxPerMin) + paddingBottom;

    // Set explicit heights for axis and grid
    axis.style.height = totalHeight + 'px';
    grid.style.height = totalHeight + 'px';

    // Render time labels (00:00 ~ 24:00)
    for (let h = 0; h <= 24; h++) {
        const yPos = paddingTop + (h * 60 * pxPerMin);
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        label.style.top = yPos + 'px';
        axis.appendChild(label);
    }

    // Grid lines are rendered via overlay after all blocks (see bottom of function)

    // 시간표 스코프 기준 학생 + 일정 데이터 수집
    const teacherIdsForScope = getTeacherIdsForTimetableScope();
    const isAllScope = timetableScope === 'all';
    let rawEvents = [];
    let temporaryAttendanceStudents = [];
    // QR 출석 뱃지용 학생ID (전역)
    const qrBadgeStudentId = typeof lastQrScannedStudentId !== 'undefined' ? lastQrScannedStudentId : null;
    const teacherAssignedStudentSetMap = new Map();
    (teacherList || []).forEach((t) => {
        const teacherId = String(t?.id || '').trim();
        if (!teacherId) return;
        const assignedIds = (typeof getAssignedStudentIdsForTeacher === 'function')
            ? getAssignedStudentIdsForTeacher(teacherId)
            : [];
        teacherAssignedStudentSetMap.set(
            teacherId,
            new Set((assignedIds || []).map((id) => String(id)))
        );
    });
    const inferTeacherNameFromMembers = (members) => {
        if (!Array.isArray(members) || members.length === 0) return '선생님';
        const memberStudentIds = members
            .map((m) => String(m?.student?.id || ''))
            .filter(Boolean);
        if (memberStudentIds.length === 0) return '선생님';

        let bestName = '선생님';
        let bestScore = 0;
        (teacherList || []).forEach((teacher) => {
            const teacherId = String(teacher?.id || '').trim();
            const teacherName = String(teacher?.name || '').trim();
            if (!teacherId || !teacherName) return;

            let score = 0;
            const assignedSet = teacherAssignedStudentSetMap.get(teacherId);
            if (assignedSet && assignedSet.size > 0) {
                memberStudentIds.forEach((sid) => {
                    if (assignedSet.has(sid)) score += 3;
                });
            }

            memberStudentIds.forEach((sid) => {
                const student = (students || []).find((item) => String(item?.id) === sid);
                if (!student) return;
                const studentTeacherId = String(student.teacher_id || '').trim();
                const teacherOwnerId = String(teacher.owner_user_id || '').trim();
                if (studentTeacherId && (studentTeacherId === teacherId || studentTeacherId === teacherOwnerId)) {
                    score += 2;
                }
            });

            if (score > bestScore) {
                bestScore = score;
                bestName = teacherName;
            }
        });

        return bestScore > 0 ? bestName : '선생님';
    };
    const knownTeacherIds = new Set((teacherList || []).map((t) => String(t.id || '')).filter(Boolean));
    const legacyTeacherResolutionMap = new Map();
    Object.keys(teacherScheduleData || {}).forEach((rawTeacherId) => {
        const legacyId = String(rawTeacherId || '').trim();
        if (!legacyId || knownTeacherIds.has(legacyId)) return;
        const legacySchedule = teacherScheduleData[legacyId] || {};
        const studentIds = Object.keys(legacySchedule);
        if (studentIds.length === 0) return;

        const scoreMap = new Map();
        const addScore = (teacherId, score) => {
            const tid = String(teacherId || '').trim();
            if (!tid || !knownTeacherIds.has(tid)) return;
            scoreMap.set(tid, (scoreMap.get(tid) || 0) + score);
        };
        studentIds.forEach((sid) => {
            const student = (students || []).find((s) => String(s.id) === String(sid));
            if (student && student.teacher_id) addScore(resolveKnownTeacherId(student.teacher_id), 3);
            if (typeof getAssignedTeacherId === 'function') addScore(resolveKnownTeacherId(getAssignedTeacherId(sid)), 2);
        });
        const ranked = Array.from(scoreMap.entries()).sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return String(a[0]).localeCompare(String(b[0]));
        });
        if (ranked.length > 0 && ranked[0][1] > 0) {
            legacyTeacherResolutionMap.set(legacyId, String(ranked[0][0]));
        }
    });

    const resolveTeacherDisplayName = (rawTeacherId, student) => {
        const raw = String(rawTeacherId || '').trim();
        const resolvedTeacherId = resolveKnownTeacherId(raw) || String(legacyTeacherResolutionMap.get(raw) || '');
        if (resolvedTeacherId) {
            const knownName = getTeacherNameById(resolvedTeacherId);
            if (knownName && knownName !== '선생님') return knownName;
        }
        const primary = getTeacherNameById(rawTeacherId);
        if (primary && primary !== '선생님') return primary;
        // 학생 레코드의 teacher_id가 있으면 우선 보조 매핑
        if (student && student.teacher_id) {
            const byStudentField = getTeacherNameById(String(student.teacher_id));
            if (byStudentField && byStudentField !== '선생님') return byStudentField;
        }
        // 로컬 선생님-학생 매핑 fallback
        if (student && student.id && typeof getAssignedTeacherId === 'function') {
            const assignedId = String(getAssignedTeacherId(String(student.id)) || '');
            if (assignedId) {
                const byAssigned = getTeacherNameById(assignedId);
                if (byAssigned && byAssigned !== '선생님') return byAssigned;
            }
        }
        return primary || '선생님';
    };
    const resolveTeacherGroupKey = (rawTeacherId, student) => {
        const raw = String(rawTeacherId || '').trim();
        if (raw && knownTeacherIds.has(raw)) return raw;
        if (raw && legacyTeacherResolutionMap.has(raw)) return String(legacyTeacherResolutionMap.get(raw));
        // 전체 보기 묶음은 반드시 스케줄 소유 teacher_id를 우선 키로 사용
        // (학생 teacher_id fallback이 끼면 A/B 묶음이 섞일 수 있음)
        if (raw) return raw;
        const studentTeacherId = student && student.teacher_id ? String(student.teacher_id).trim() : '';
        const assignedId = (student && student.id && typeof getAssignedTeacherId === 'function')
            ? String(getAssignedTeacherId(String(student.id)) || '').trim()
            : '';

        const candidates = [studentTeacherId, assignedId].filter(Boolean);
        for (const id of candidates) {
            if (typeof isKnownTeacherId === 'function' && isKnownTeacherId(id)) return id;
        }
        return studentTeacherId || assignedId || 'unknown';
    };
    const toStableHash = (seedValue) => {
        const seed = String(seedValue || 'default');
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    };
    const buildTeacherBadgeThemeFromHue = (hue) => {
        return {
            bg: `linear-gradient(135deg, hsl(${hue} 74% 38%), hsl(${(hue + 22) % 360} 76% 46%))`,
            border: `hsla(${hue}, 78%, 72%, 0.58)`,
            shadow: `hsla(${hue}, 84%, 42%, 0.38)`
        };
    };
    const hueDistance = (a, b) => {
        const diff = Math.abs(a - b);
        return Math.min(diff, 360 - diff);
    };

    teacherIdsForScope.forEach((teacherId) => {
        const teacherSchedule = teacherScheduleData[teacherId] || {};
        const activeStudents = getActiveStudentsForTeacher(teacherId);
        activeStudents.forEach((s) => {
            if (!shouldShowScheduleForStudent(s, dateStr)) return;
            const entries = getScheduleEntries(teacherId, String(s.id), dateStr);
            if (entries.length > 0) {
                entries.forEach(detail => {
                    const [h, m] = detail.start.split(':').map(Number);
                    let startMin = (h * 60) + m;
                    if (startMin < 0) startMin = 0;
                    if (startMin >= 24 * 60) startMin = (24 * 60) - 1;
                    rawEvents.push({
                        teacherId: String(teacherId),
                        groupTeacherKey: resolveTeacherGroupKey(teacherId, s),
                        teacherName: resolveTeacherDisplayName(teacherId, s),
                        startMin: startMin,
                        duration: parseInt(detail.duration, 10) || 60,
                        originalStart: detail.start,
                        // group key와 실제 owner teacher_id를 분리 보존해야
                        // 모달 진입 시 권한 판정이 흔들리지 않는다.
                        member: {
                            student: s,
                            teacherId: resolveTeacherGroupKey(teacherId, s),
                            ownerTeacherId: String(resolveKnownTeacherId(teacherId) || legacyTeacherResolutionMap.get(String(teacherId)) || teacherId)
                        }
                    });
                });
            } else {
                const attByDate = s.attendance && s.attendance[dateStr];
                if (attByDate && typeof attByDate === 'object') {
                    const emergencyStatus = attByDate.emergency || attByDate.default || '';
                    if (emergencyStatus === 'present') {
                        temporaryAttendanceStudents.push({ ...s, _teacherId: String(teacherId) });
                    }
                }
            }
        });
    });
    let groupedEvents = {}; 
    rawEvents.forEach(ev => {
        const key = isAllScope
            ? `${ev.groupTeacherKey || ev.teacherId}-${ev.startMin}-${ev.duration}`
            : `${ev.startMin}-${ev.duration}`;
        if (!groupedEvents[key]) {
            groupedEvents[key] = {
                type: 'group',
                teacherId: ev.groupTeacherKey || ev.teacherId,
                teacherName: ev.teacherName,
                startMin: ev.startMin,
                duration: ev.duration,
                originalStart: ev.originalStart,
                members: []
            };
        }
        if (groupedEvents[key].teacherName === '선생님' && ev.teacherName && ev.teacherName !== '선생님') {
            groupedEvents[key].teacherName = ev.teacherName;
        }
        groupedEvents[key].members.push(ev.member);
        if (!groupedEvents[key].teacherName || groupedEvents[key].teacherName === '선생님') {
            const inferred = inferTeacherNameFromMembers(groupedEvents[key].members);
            if (inferred && inferred !== '선생님') {
                groupedEvents[key].teacherName = inferred;
            }
        }
    });
    let layoutEvents = Object.values(groupedEvents).sort((a, b) => a.startMin - b.startMin);
    // 화면 내 교사 배지 색상 간격을 강제해 유사색 충돌을 줄임
    const teacherThemeMap = new Map();
    const usedHues = [];
    const distinctTeacherKeys = [...new Set(layoutEvents.map(ev => String(ev.teacherId || ev.groupTeacherKey || ev.teacherName || 'unknown')))]
        .sort();
    const resolveTeacherNameFromMemberCandidates = (members) => {
        if (!Array.isArray(members) || members.length === 0) return '';
        const counts = new Map();
        const addCount = (name) => {
            const key = String(name || '').trim();
            if (!key || key === '선생님' || key === '미확인' || key === '담당 미확인') return;
            counts.set(key, (counts.get(key) || 0) + 1);
        };
        members.forEach((m) => {
            const student = m?.student;
            const candidateIds = [
                String(m?.teacherId || '').trim(),
                String(student?.teacher_id || '').trim(),
                (student?.id && typeof getAssignedTeacherId === 'function') ? String(getAssignedTeacherId(String(student.id)) || '').trim() : ''
            ].filter(Boolean);
            candidateIds.forEach((candidateId) => {
                const knownId = resolveKnownTeacherId(candidateId);
                addCount(getTeacherNameById(knownId || candidateId));
            });
        });
        if (counts.size === 0) return '';
        const ranked = Array.from(counts.entries()).sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return String(a[0]).localeCompare(String(b[0]));
        });
        return String(ranked[0]?.[0] || '').trim();
    };
    const resolveTeacherNameByModalPolicy = (ev) => {
        const members = ev?.members || [];
        if (!Array.isArray(members) || members.length === 0) return '';
        const nameCount = new Map();
        const addName = (name) => {
            const key = String(name || '').trim();
            if (!key || key === '선생님' || key === '미확인' || key === '담당 미확인') return;
            nameCount.set(key, (nameCount.get(key) || 0) + 1);
        };
        members.forEach((m) => {
            const student = m?.student;
            const sid = String(student?.id || '').trim();
            const candidateIds = [
                String(m?.teacherId || '').trim(),
                resolveScheduleOwnerTeacherId(sid, dateStr, String(ev?.originalStart || '')),
                String(student?.teacher_id || '').trim(),
                (sid && typeof getAssignedTeacherId === 'function') ? String(getAssignedTeacherId(sid) || '').trim() : ''
            ].filter(Boolean);
            const uniqueCandidates = [...new Set(candidateIds)];
            for (const candidateId of uniqueCandidates) {
                const knownId = resolveKnownTeacherId(candidateId);
                if (!knownId) continue;
                addName(getTeacherNameById(knownId));
                break;
            }
        });
        if (nameCount.size === 0) return '';
        const ranked = Array.from(nameCount.entries()).sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return String(a[0]).localeCompare(String(b[0]));
        });
        return String(ranked[0]?.[0] || '').trim();
    };
    const resolveTeacherLabelForEvent = (ev) => {
        const eventTeacherId = String(ev.teacherId || '').trim();
        const resolvedEventTeacherId = resolveKnownTeacherId(eventTeacherId) || String(legacyTeacherResolutionMap.get(eventTeacherId) || '');
        if (resolvedEventTeacherId) {
            const resolvedName = String(getTeacherNameById(resolvedEventTeacherId) || '').trim();
            if (resolvedName && resolvedName !== '선생님') return resolvedName;
        }
        const baseName = String(ev.teacherName || getTeacherNameById(ev.teacherId || '') || '').trim();
        if (baseName && baseName !== '선생님') return baseName;
        const inferredName = inferTeacherNameFromMembers(ev.members || []);
        if (inferredName && inferredName !== '선생님') return inferredName;
        const candidateName = resolveTeacherNameFromMemberCandidates(ev.members || []);
        if (candidateName) return candidateName;
        const modalPolicyName = resolveTeacherNameByModalPolicy(ev);
        if (modalPolicyName) return modalPolicyName;
        return '미확인';
    };
    distinctTeacherKeys.forEach((teacherKey) => {
        let hue = toStableHash(teacherKey) % 360;
        let guard = 0;
        while (usedHues.some((used) => hueDistance(used, hue) < 34) && guard < 30) {
            hue = (hue + 137) % 360;
            guard += 1;
        }
        usedHues.push(hue);
        teacherThemeMap.set(teacherKey, buildTeacherBadgeThemeFromHue(hue));
    });
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
    // 컬럼당 최소 폭 (px) - 겹침 방지
    const minColWidthPx = 160;
    const containerEl = document.querySelector('.timetable-container');
    const axisWidth = 56;
    const availableWidth = containerEl ? (containerEl.clientWidth - axisWidth - 2) : 500;
    const neededWidth = Math.max(availableWidth, colCount * minColWidthPx);
    grid.style.width = neededWidth + 'px';
    grid.style.minWidth = neededWidth + 'px';
    const defaultSlotWidth = 100 / colCount;
    if (!dailyLayouts[dateStr]) dailyLayouts[dateStr] = {};
    const savedPositions = dailyLayouts[dateStr].positions || {};
    const savedWidths = dailyLayouts[dateStr].widths || {};

    layoutEvents.forEach(ev => {
        const isMerged = ev.members.length > 1;
        const blockId = isMerged
            ? `group-${ev.teacherId || 'na'}-${ev.startMin}-${ev.duration}`
            : `${ev.teacherId || 'na'}-${ev.members[0].student.id}-${ev.originalStart}`;
        const block = document.createElement('div');
        // 학생 검색용 데이터 속성
        block.dataset.studentNames = ev.members.map(m => m.student.name).join(',');
        
        // Merged 그룹도 학년별 색상 적용
        if (isMerged) {
            const grades = ev.members.map(m => {
                const g = m.student.grade || '';
                if (g.includes('초')) return 'cho';
                if (g.includes('중')) return 'jung';
                if (g.includes('고')) return 'go';
                return 'default';
            });
            const uniqueGrades = [...new Set(grades)];
            const gradeClass = uniqueGrades.length === 1 ? `merged-grade-${uniqueGrades[0]}` : 'merged-grade-mixed';
            block.className = `event-block ${gradeClass}`;
        } else {
            block.className = `event-block ${getGradeColorClass(ev.members[0].grade)}`;
        }
        block.style.top = (paddingTop + ev.startMin * pxPerMin) + 'px';
        block.style.height = (ev.duration * pxPerMin) + 'px'; 
        block.style.left = (savedPositions[blockId] !== undefined ? savedPositions[blockId] : ev.colIndex * defaultSlotWidth) + '%';
        // 기본은 컬럼 폭의 55%를 사용 (컴팩트한 블록 크기)
        const autoWidth = Math.min(defaultSlotWidth * 0.85, colCount === 1 ? 55 : defaultSlotWidth * 0.85);
        block.style.width = (savedWidths[blockId] !== undefined ? savedWidths[blockId] : autoWidth) + '%';
        
        
        const endTotalMin = (ev.originalStart.split(':')[0]*60 + parseInt(ev.originalStart.split(':')[1])) + ev.duration;
        let endH = Math.floor(endTotalMin / 60); const endM = endTotalMin % 60;
        // If endH is 24, display as 24:00 (end of day), otherwise wrap around (e.g., 25:00 becomes 01:00)
        const endTimeStr = `${String(endH % 24).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;

        const resizeHandle = document.createElement('div'); resizeHandle.className = 'resize-handle'; block.appendChild(resizeHandle);
        const contentDiv = document.createElement('div');
        contentDiv.style.flex = "1"; contentDiv.style.overflow = "hidden"; contentDiv.style.display = "flex"; contentDiv.style.flexDirection = "column";
        const teacherThemeKey = String(ev.teacherId || ev.groupTeacherKey || ev.teacherName || 'unknown');
        const teacherTheme = teacherThemeMap.get(teacherThemeKey) || buildTeacherBadgeThemeFromHue(toStableHash(teacherThemeKey) % 360);
        const resolvedTeacherLabel = resolveTeacherLabelForEvent(ev);
        const resolvedTeacherLabelOwnerId = resolveTeacherIdByExactName(resolvedTeacherLabel);
        const teacherBadge = isAllScope
            ? `<span class="evt-teacher" style="--evt-teacher-bg:${teacherTheme.bg};--evt-teacher-border:${teacherTheme.border};--evt-teacher-shadow:${teacherTheme.shadow};">${escapeHtml(resolvedTeacherLabel)}</span>`
            : '';
        const resolvedTeacherLabelArg = String(resolvedTeacherLabel || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");
        if (isMerged) {
            contentDiv.innerHTML = `<div class="merged-header"><span>${teacherBadge}${ev.originalStart}~${endTimeStr}</span><span style="opacity:0.8; font-size:10px;">${ev.members.length}명</span></div><div class="merged-list">${ev.members.map(m => {
                const student = m.student;
                // ★ 해당 수업시간(ev.originalStart)의 출결만 표시
                let status = '';
                if (student.attendance && student.attendance[dateStr]) {
                    if (typeof student.attendance[dateStr] === 'object') {
                        status = getSlotValueByNormalizedTime(student.attendance[dateStr], ev.originalStart) || '';
                    } else {
                        status = student.attendance[dateStr] || '';
                    }
                }
                let badge = '';
                if (status === 'present') badge = '<span style="background:#10b981;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">출석</span>';
                else if (status === 'late') badge = '<span style="background:#f59e0b;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">지각</span>';
                else if (status === 'absent') badge = '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">결석</span>';
                else if (status === 'makeup' || status === 'etc') badge = '<span style="background:#8b5cf6;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">보강</span>';
                else badge = '<span style="background:#d1d5db;color:#374151;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">미처리</span>';
                const ownerTeacherIdForModal = String(
                    normalizeTeacherIdForCompare(m.ownerTeacherId || m.teacherId || ev.teacherId || '') ||
                    resolvedTeacherLabelOwnerId ||
                    ''
                );
                return `<div class="sub-event-item ${getSubItemColorClass(student.grade)}" data-student-name="${student.name}" onclick="event.stopPropagation(); openAttendanceModal('${student.id}', '${dateStr}', '${ev.originalStart}', '${ownerTeacherIdForModal}', '${resolvedTeacherLabelArg}')"><div class="sub-info"><span class="sub-name">${student.name} ${badge}</span><span class="sub-grade">${student.grade}</span></div></div>`;
            }).join('')}</div>`;
        } else {
            const s = ev.members[0].student;
            // 단일 일정: 해당 일정의 출결만 표시
            let status = 'none';
            if (s.attendance && s.attendance[dateStr]) {
                // 여러 일정이 있을 경우, originalStart(수업 시작시간) 기준으로 해당 일정 출결만 표시
                if (typeof s.attendance[dateStr] === 'object') {
                    status = getSlotValueByNormalizedTime(s.attendance[dateStr], ev.originalStart) || 'none';
                } else {
                    status = s.attendance[dateStr];
                }
            }
            let statusBadge = '';
            if (status === 'present') {
                statusBadge = '<span style="background:#10b981;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">출석</span>';
            } else if (status === 'late') {
                statusBadge = '<span style="background:#f59e0b;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">지각</span>';
            } else if (status === 'absent') {
                statusBadge = '<span style="background:#ef4444;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">결석</span>';
            } else if (status === 'makeup' || status === 'etc') {
                statusBadge = '<span style="background:#8b5cf6;color:white;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">보강</span>';
            } else {
                statusBadge = '<span style="background:#d1d5db;color:#374151;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;">미처리</span>';
            }
            // 일정별로 badge를 정확히 표시
            ev.statusBadge = statusBadge;
            // QR 출석 뱃지 추가
            let qrBadge = '';
            if (qrBadgeStudentId && String(s.id) === String(qrBadgeStudentId)) {
                qrBadge = '<span style="background:#2563eb;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;">QR</span>';
            }
            const _dupNames = getDuplicateNameSet();
            const _isDup = _dupNames.has((s.name || '').trim());
            const schoolHint = _isDup && s.school ? `<span class="evt-school">${s.school}</span>` : '';
            contentDiv.innerHTML = `<div class="evt-title">${teacherBadge}${s.name}${qrBadge} ${statusBadge} <span class="evt-grade">(${s.grade})</span>${schoolHint}</div><div class="event-time-text">${ev.originalStart} - ${endTimeStr} (${ev.duration}분)</div>`;
            block.onclick = (e) => { 
                if(block.getAttribute('data-action-status') === 'moved' || block.getAttribute('data-action-status') === 'resized') { e.stopPropagation(); block.setAttribute('data-action-status', 'none'); return; }
                if(e.target.classList.contains('resize-handle')) return;
                e.stopPropagation();
                const ownerTeacherId = String(
                    normalizeTeacherIdForCompare(ev.members?.[0]?.ownerTeacherId || ev.teacherId || '') ||
                    resolvedTeacherLabelOwnerId ||
                    ''
                );
                openAttendanceModal(s.id, dateStr, ev.originalStart, ownerTeacherId, resolvedTeacherLabel);
            };
        }
        block.appendChild(contentDiv);
        resizeHandle.onmousedown = function(e) {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX;
            const startWidth = block.offsetWidth;
            const parentWidth = grid.offsetWidth;
            const container = document.querySelector('.timetable-container');
            const savedScrollL = container ? container.scrollLeft : 0;
            const savedScrollT = container ? container.scrollTop : 0;
            let isResized = false;

            function onResizeMove(ev) {
                const dx = ev.clientX - startX;
                const newWidthPx = startWidth + dx;
                if (newWidthPx > 30 && newWidthPx <= parentWidth) {
                    block.style.width = (newWidthPx / parentWidth) * 100 + '%';
                    isResized = true;
                }
                if (container) { container.scrollLeft = savedScrollL; container.scrollTop = savedScrollT; }
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
                    renderDayEvents(dateStr);
                    if (container) { container.scrollLeft = savedScrollL; container.scrollTop = savedScrollT; }
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
            const blockWidthPercent = (block.offsetWidth / parentWidth) * 100;
            const container = document.querySelector('.timetable-container');
            const savedScrollL = container ? container.scrollLeft : 0;
            const savedScrollT = container ? container.scrollTop : 0;
            let isMoved = false;

            function onMove(ev) {
                const dx = ev.clientX - startX;
                if(Math.abs(dx) > 3) {
                    isMoved = true;
                    let newLeft = initialLeftPercent + (dx / parentWidth) * 100;
                    if(newLeft < 0) newLeft = 0;
                    const maxLeft = 100 - blockWidthPercent;
                    if(newLeft > maxLeft) newLeft = maxLeft;
                    block.style.left = newLeft + '%';
                }
                // 드래그 중 스크롤 위치 고정
                if (container) { container.scrollLeft = savedScrollL; container.scrollTop = savedScrollT; }
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
                    renderDayEvents(dateStr);
                    if (container) { container.scrollLeft = savedScrollL; container.scrollTop = savedScrollT; }
                } else {
                    block.setAttribute('data-action-status', 'none');
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
        grid.appendChild(block);
    });

    // 일정이 없는 임시출석도 시간표 화면에서 보이도록 상단 배너 노출
    if (temporaryAttendanceStudents.length > 0) {
        const uniqueStudents = [];
        const seenIds = new Set();
        temporaryAttendanceStudents.forEach((s) => {
            const sid = String(s.id);
            if (seenIds.has(sid)) return;
            seenIds.add(sid);
            uniqueStudents.push(s);
        });

        const tempBanner = document.createElement('div');
        tempBanner.className = 'tt-temporary-attendance-banner';
        tempBanner.style.position = 'absolute';
        tempBanner.style.top = (paddingTop + 6) + 'px';
        tempBanner.style.left = '8px';
        tempBanner.style.right = '8px';
        tempBanner.style.minHeight = '36px';
        tempBanner.style.padding = '8px 10px';
        tempBanner.style.borderRadius = '10px';
        tempBanner.style.background = 'rgba(16, 185, 129, 0.14)';
        tempBanner.style.border = '1px solid rgba(16, 185, 129, 0.35)';
        tempBanner.style.color = '#065f46';
        tempBanner.style.fontSize = '12px';
        tempBanner.style.fontWeight = '700';
        tempBanner.style.zIndex = '4';
        tempBanner.style.pointerEvents = 'none';
        tempBanner.textContent = `임시출석 ${uniqueStudents.length}건 · ` +
            uniqueStudents.map((s) => `${s.name}(${s.grade || '-'})`).join(', ');
        grid.appendChild(tempBanner);
    }

    // 시간 선 오버레이 (박스 위에 표시, 클릭 통과)
    const lineOverlay = document.createElement('div');
    lineOverlay.className = 'time-grid-overlay';
    lineOverlay.style.height = totalHeight + 'px';
    const hourPxOv = 60 * pxPerMin;
    lineOverlay.style.backgroundImage = `repeating-linear-gradient(to bottom, var(--border) 0px, var(--border) 1px, transparent 1px, transparent ${hourPxOv}px)`;
    lineOverlay.style.backgroundPositionY = paddingTop + 'px';
    lineOverlay.style.backgroundSize = `100% ${hourPxOv}px`;
    grid.appendChild(lineOverlay);
}

// ... (기타 모달 Open/Close 및 CRUD 로직 생략 없이 유지) ...

// 현재 활성 메모 탭
let currentMemoTab = 'private';

window.switchMemoTab = function(tab) {
    currentMemoTab = tab;
    const privateMemo = document.getElementById('att-memo');
    const sharedMemo = document.getElementById('att-shared-memo');
    const sharedOthers = document.getElementById('att-shared-memo-others');
    const hint = document.getElementById('am-memo-hint');
    const tabs = document.querySelectorAll('.am-memo-tab');

    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    if (tab === 'private') {
        privateMemo.style.display = '';
        sharedMemo.style.display = 'none';
        if (sharedOthers) sharedOthers.style.display = 'none';
        hint.textContent = '🔒 개인메모: 본인만 확인 (학부모/다른 선생님 미노출)';
        hint.className = 'am-memo-hint';
    } else {
        privateMemo.style.display = 'none';
        sharedMemo.style.display = '';
        // 다른 선생님 공유 메모가 있으면 표시
        if (sharedOthers) {
            sharedOthers.style.display = sharedOthers.innerHTML.trim() ? '' : 'none';
        }
        hint.textContent = '👥 공유메모: 모든 선생님이 확인 (인수인계/공통 공지 용도)';
        hint.className = 'am-memo-hint shared';
    }
}

window.openAttendanceModal = async function(sid, dateStr, startTime, ownerTeacherId, ownerTeacherNameHint) {
    const sIdx = students.findIndex(x => String(x.id) === String(sid));
    if (sIdx === -1) return;
    const s = students[sIdx];
    let effectiveOwnerTeacherId = resolveOwnerTeacherIdForModal(sid, dateStr, startTime, ownerTeacherId);
    const normalizedRequestedStart = normalizeScheduleTimeKey(startTime || '');
    if (normalizedRequestedStart && normalizedRequestedStart !== 'default') {
        const currentOwnerEntries = getScheduleEntries(effectiveOwnerTeacherId, String(sid), dateStr);
        const hasCurrentOwnerSlot = currentOwnerEntries.some(
            (entry) => normalizeScheduleTimeKey(entry?.start || '') === normalizedRequestedStart
        );
        if (!hasCurrentOwnerSlot) {
            const resolvedScheduleOwner = String(resolveScheduleOwnerTeacherId(sid, dateStr, startTime) || '').trim();
            if (resolvedScheduleOwner) {
                const resolvedEntries = getScheduleEntries(resolvedScheduleOwner, String(sid), dateStr);
                const hasResolvedOwnerSlot = resolvedEntries.some(
                    (entry) => normalizeScheduleTimeKey(entry?.start || '') === normalizedRequestedStart
                );
                if (hasResolvedOwnerSlot) {
                    effectiveOwnerTeacherId = resolvedScheduleOwner;
                }
            }
        }
    }
    const expectedOwnerTeacherId = resolveExpectedOwnerTeacherIdForStudent(sid);
    const slotOwnerCandidates = getScheduleOwnerCandidatesBySlot(sid, dateStr, startTime)
        .map((candidate) => normalizeTeacherIdForCompare(candidate))
        .filter(Boolean);
    const uniqueSlotOwnerCandidates = [...new Set(slotOwnerCandidates)];
    const preferredOwnerId = normalizeTeacherIdForCompare(ownerTeacherId || effectiveOwnerTeacherId);
    const ownerHintId = normalizeTeacherIdForCompare(resolveTeacherIdByExactName(ownerTeacherNameHint));
    if (uniqueSlotOwnerCandidates.length > 0) {
        if (preferredOwnerId && uniqueSlotOwnerCandidates.includes(preferredOwnerId)) {
            effectiveOwnerTeacherId = preferredOwnerId;
        } else if (ownerHintId && uniqueSlotOwnerCandidates.includes(ownerHintId)) {
            effectiveOwnerTeacherId = ownerHintId;
        } else {
            const expectedOwnerId = normalizeTeacherIdForCompare(expectedOwnerTeacherId);
            if (expectedOwnerId && uniqueSlotOwnerCandidates.includes(expectedOwnerId)) {
                effectiveOwnerTeacherId = expectedOwnerId;
            } else if (uniqueSlotOwnerCandidates.length === 1) {
                effectiveOwnerTeacherId = uniqueSlotOwnerCandidates[0];
            }
        }
    } else {
        const normalizedOwnerId = normalizeTeacherIdForCompare(effectiveOwnerTeacherId);
        if (normalizedOwnerId) effectiveOwnerTeacherId = normalizedOwnerId;
    }
    if (normalizedRequestedStart && normalizedRequestedStart !== 'default') {
        const exactOwner = resolveExactSlotOwnerTeacherId(sid, dateStr, normalizedRequestedStart, effectiveOwnerTeacherId);
        if (exactOwner) effectiveOwnerTeacherId = exactOwner;
    }

    let isOwnerSchedule = isScheduleOwnedByCurrentTeacher(effectiveOwnerTeacherId);
    if (!isOwnerSchedule) {
        // 묶음/legacy owner key로 본인 일정이 타교사로 오판정되는 경우를 보정
        const slotResolvedOwner = String(resolveScheduleOwnerTeacherId(sid, dateStr, startTime) || '').trim();
        if (slotResolvedOwner && isScheduleOwnedByCurrentTeacher(slotResolvedOwner)) {
            effectiveOwnerTeacherId = String(resolveKnownTeacherId(slotResolvedOwner) || slotResolvedOwner).trim();
            isOwnerSchedule = true;
        }
    }
    if (!isOwnerSchedule) {
        if (expectedOwnerTeacherId && String(expectedOwnerTeacherId) === String(currentTeacherId || '')) {
            effectiveOwnerTeacherId = expectedOwnerTeacherId;
            isOwnerSchedule = true;
        }
    }
    if (!isOwnerSchedule) {
        const ownerLabel = String(getTeacherNameById(effectiveOwnerTeacherId) || '').trim();
        const ownerNormalized = normalizeTeacherIdForCompare(effectiveOwnerTeacherId);
        const currentNormalized = normalizeTeacherIdForCompare(currentTeacherId);
        const ownerUnresolved = !ownerNormalized || ['선생님', '미확인', '담당 미확인'].includes(ownerLabel);
        const expectedIsCurrent = !!(
            expectedOwnerTeacherId &&
            currentNormalized &&
            normalizeTeacherIdForCompare(expectedOwnerTeacherId) === currentNormalized
        );
        const slotCandidates = getScheduleOwnerCandidatesBySlot(sid, dateStr, startTime);
        const currentCandidate = slotCandidates.find((candidate) => {
            return currentNormalized && normalizeTeacherIdForCompare(candidate) === currentNormalized;
        });
        if (ownerUnresolved && expectedIsCurrent && currentCandidate) {
            effectiveOwnerTeacherId = String(resolveKnownTeacherId(currentCandidate) || currentTeacherId || currentCandidate).trim();
            isOwnerSchedule = true;
            console.info('[openAttendanceModal] owner 미해석 슬롯 보정 적용:', {
                sid: String(sid),
                dateStr: String(dateStr),
                startTime: String(startTime || ''),
                ownerBefore: String(ownerTeacherId || ''),
                ownerAfter: effectiveOwnerTeacherId
            });
        }
    }
    let adminOverride = false;
    if (!isOwnerSchedule) {
        console.warn('[openAttendanceModal] 관리자 인증 분기 진입:', {
            sid: String(sid),
            dateStr: String(dateStr),
            startTime: String(startTime || ''),
            ownerTeacherId: String(effectiveOwnerTeacherId || ''),
            ownerTeacherNameHint: String(ownerTeacherNameHint || ''),
            currentTeacherId: String(currentTeacherId || ''),
            currentTeacherName: String(getCurrentTeacherName() || '')
        });
        const ownerTeacherName = getTeacherNameById(effectiveOwnerTeacherId);
        const verified = await verifyAdminPinForCrossTeacherAccess(ownerTeacherName);
        if (!verified) return;
        adminOverride = true;
    }
    await ensureAttendanceForDate(dateStr);
    const attendanceModal = document.getElementById('attendance-modal');
    attendanceModal.style.display = 'flex';
    attendanceModal.dataset.adminOverride = adminOverride ? '1' : '0';
    document.getElementById('att-modal-title').textContent = `${s.name} (${s.grade}) 수업 관리`;
    document.getElementById('att-owner-teacher-id').value = effectiveOwnerTeacherId;
    const originalOwnerInput = document.getElementById('att-original-owner-teacher-id');
    if (originalOwnerInput) originalOwnerInput.value = effectiveOwnerTeacherId;
    const ownerTeacherName = getTeacherNameById(effectiveOwnerTeacherId);
    document.getElementById('att-info-text').textContent = `${dateStr}${s.school ? ' · ' + s.school : ''}${ownerTeacherName ? ' · 담당 ' + ownerTeacherName : ''}${adminOverride ? ' · 관리자 편집 모드' : ''}`;
    document.getElementById('att-student-id').value = sid;
    document.getElementById('att-date').value = dateStr;
    document.getElementById('att-edit-date').value = dateStr;

    // 개인 메모 로드 (로컬 우선, 없으면 DB에서 조회)
    const memoDiv = document.getElementById('att-memo');
    let savedRecord = '';
    if (s.records && s.records[dateStr]) {
        if (startTime && typeof s.records[dateStr] === 'object') {
            savedRecord = s.records[dateStr][startTime] || '';
        } else if (typeof s.records[dateStr] === 'string') {
            savedRecord = s.records[dateStr];
        }
    }
    // 로컬에 없으면 DB에서 가져오기
    if (!savedRecord) {
        try {
            if (typeof window.getAttendanceRecordByStudentAndDate === 'function') {
                const dbRecord = await window.getAttendanceRecordByStudentAndDate(sid, dateStr, effectiveOwnerTeacherId, startTime);
                if (dbRecord && dbRecord.memo) {
                    savedRecord = dbRecord.memo;
                    // 로컬에도 저장
                    if (!s.records) s.records = {};
                    if (!s.records[dateStr] || typeof s.records[dateStr] !== 'object') s.records[dateStr] = {};
                    s.records[dateStr][startTime || 'default'] = savedRecord;
                }
            }
        } catch (e) {
            console.error('[openAttendanceModal] 개인 메모 DB 조회 실패:', e);
        }
    }
    memoDiv.innerHTML = savedRecord;

    // 공유 메모 로드 (구조화 데이터 활용 - 다른 선생님 메모는 읽기전용, 본인 메모는 편집 가능)
    const sharedMemoDiv = document.getElementById('att-shared-memo');
    const sharedOthersDiv = document.getElementById('att-shared-memo-others');
    let mySharedMemo = '';
    let othersHtml = '';
    try {
        if (typeof window.getSharedMemosStructured === 'function') {
            const memoList = await window.getSharedMemosStructured(sid, dateStr);
            const myId = String(currentTeacherId);
            const otherMemos = [];
            for (const m of memoList) {
                if (String(m.teacher_id) === myId) {
                    mySharedMemo = m.memo;
                } else {
                    otherMemos.push(m);
                }
            }
            if (otherMemos.length > 0) {
                othersHtml = '<div class="shared-memo-header"><i class="fas fa-users"></i> 다른 선생님 공유 메모</div>';
                otherMemos.forEach(m => {
                    othersHtml += `<div class="shared-memo-item"><span class="shared-memo-teacher">${m.teacher_name}</span><div class="shared-memo-text">${m.memo}</div></div>`;
                });
            }
        }
    } catch (e) {
        console.error('[openAttendanceModal] 공유 메모 DB 조회 실패:', e);
    }
    // 다른 선생님 메모 표시 (읽기전용)
    if (sharedOthersDiv) {
        sharedOthersDiv.innerHTML = othersHtml;
        // 표시/숨김은 switchMemoTab에서 처리
    }
    // 본인 공유 메모만 편집 영역에 로드
    sharedMemoDiv.innerHTML = mySharedMemo;

    // 탭 초기화 (개인 메모 활성)
    switchMemoTab('private');

    // 일정 변경 섹션 접기
    const collapseSection = document.querySelector('.am-collapse-section');
    if (collapseSection) collapseSection.classList.remove('open');

    // 출석 상태 표시
    let currentStatus = null;
    if (s.attendance && s.attendance[dateStr]) {
        if (startTime && typeof s.attendance[dateStr] === 'object') {
            currentStatus = getSlotValueByNormalizedTime(s.attendance[dateStr], startTime);
        } else if (typeof s.attendance[dateStr] === 'string') {
            currentStatus = s.attendance[dateStr];
        }
    }
    updateAttendanceStatusDisplay(currentStatus);

    // 선생님별 일정 데이터 사용
    const entries = getScheduleEntries(effectiveOwnerTeacherId, String(sid), dateStr);
    const target = startTime
        ? entries.find(item => normalizeScheduleTimeKey(item?.start || '') === normalizedRequestedStart) || null
        : getEarliestScheduleEntry(entries);
    const detail = target || { start: normalizedRequestedStart || '16:00', duration: 90 };
    document.getElementById('att-edit-time').value = detail.start;
    document.getElementById('att-edit-duration').value = detail.duration;
    document.getElementById('att-original-time').value = detail.start;

    if (typeof window.updateAttendanceSourceDisplay === 'function') {
        let attendanceRecord = null;
        if (typeof window.getAttendanceRecordByStudentAndDate === 'function') {
            try {
                attendanceRecord = await window.getAttendanceRecordByStudentAndDate(sid, dateStr, effectiveOwnerTeacherId, detail.start);
            } catch (e) {
                console.error('[openAttendanceModal] 출석 방식 조회 실패:', e);
            }
        }
        window.updateAttendanceSourceDisplay(attendanceRecord);
    }
    setAttendanceModalReadOnly(!isOwnerSchedule && !adminOverride);
}

window.updateClassTime = async function() {
    const sid = document.getElementById('att-student-id').value;
    const oldDateStr = document.getElementById('att-date').value;
    const newDateStr = document.getElementById('att-edit-date').value;
    const newStart = document.getElementById('att-edit-time').value;
    const newDur = document.getElementById('att-edit-duration').value;
    const originalStart = document.getElementById('att-original-time').value;
    const ownerTeacherId = document.getElementById('att-owner-teacher-id').value || currentTeacherId;
    const originalOwnerTeacherId = document.getElementById('att-original-owner-teacher-id')?.value || ownerTeacherId;
    if(!newDur || parseInt(newDur) <= 0) { showToast("올바른 수업 시간을 입력해주세요.", 'warning'); return; }
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        const permission = await verifyScheduleEditPermission(ownerTeacherId);
        if (!permission.allowed) return;
        const targetTeacherId = String(permission.effectiveTeacherId || ownerTeacherId || currentTeacherId);
        // ★ 시간 겹침 확인 (기존 일정 자신은 제외)
        const overlaps = await checkScheduleOverlap(sid, newDateStr, newStart, parseInt(newDur), targetTeacherId, originalStart);
        if (overlaps.length > 0) {
            const studentName = students[sIdx].name || `학생${sid}`;
            if (!(await showConfirm(formatOverlapMessage(studentName, newDateStr, overlaps), { type: 'warn', title: '일정 겹침' }))) {
                return;
            }
        }

        // 선생님별 일정 데이터 사용
        if(!teacherScheduleData[targetTeacherId]) teacherScheduleData[targetTeacherId] = {};
        if(!teacherScheduleData[targetTeacherId][sid]) teacherScheduleData[targetTeacherId][sid] = {};
        
        const oldOwnerCandidates = [
            String(originalOwnerTeacherId || '').trim(),
            ...getScheduleOwnerCandidatesBySlot(sid, oldDateStr, originalStart),
            normalizeTeacherIdForCompare(originalOwnerTeacherId)
        ].filter(Boolean);
        const uniqueOldOwnerCandidates = [...new Set(oldOwnerCandidates)];
        const removeOldLocalEntries = (teacherId) => {
            const entries = getScheduleEntries(teacherId, String(sid), oldDateStr);
            const next = entries.filter(item => normalizeScheduleTimeKey(item?.start || '') !== normalizeScheduleTimeKey(originalStart || ''));
            setScheduleEntries(teacherId, String(sid), oldDateStr, next);
            persistTeacherScheduleLocalFor(teacherId);
        };

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
            uniqueOldOwnerCandidates.forEach(removeOldLocalEntries);
        }
        let newEntries = getScheduleEntries(targetTeacherId, String(sid), newDateStr);
        if (oldDateStr === newDateStr && originalStart && originalStart !== newStart) {
            uniqueOldOwnerCandidates.forEach(removeOldLocalEntries);
            newEntries = getScheduleEntries(targetTeacherId, String(sid), newDateStr);
        }
        const nextEntry = { start: newStart, duration: parseInt(newDur) };
        const updated = upsertScheduleEntry(newEntries, nextEntry);
        setScheduleEntries(targetTeacherId, String(sid), newDateStr, updated.list);
        saveData();
        persistTeacherScheduleLocalFor(targetTeacherId);

        try {
            if (oldDateStr !== newDateStr || (originalStart && originalStart !== newStart)) {
                await Promise.allSettled(
                    uniqueOldOwnerCandidates.map((teacherId) => deleteScheduleFromDatabase(sid, oldDateStr, teacherId, originalStart))
                );
            }
            await saveScheduleToDatabase({
                teacherId: targetTeacherId,
                studentId: sid,
                date: newDateStr,
                startTime: newStart,
                duration: parseInt(newDur)
            });
        } catch (dbError) {
            console.error('[updateClassTime] DB 동기화 실패:', dbError);
        }

        document.getElementById('att-original-time').value = newStart;
        const originalOwnerInput = document.getElementById('att-original-owner-teacher-id');
        if (originalOwnerInput) originalOwnerInput.value = targetTeacherId;

        renderCalendar(); 
        if (document.getElementById('day-detail-modal').style.display === 'flex') { if (currentDetailDate === newDateStr || currentDetailDate === oldDateStr) renderDayEvents(currentDetailDate); }
        // ★ 일정 변경 후 다른 선생님 데이터 갱신 + 타이머 갱신
        await loadAllTeachersScheduleData();
        if (typeof window.initMissedScanChecks === 'function') window.initMissedScanChecks();
        if (typeof scheduleKstMidnightAutoAbsent === 'function') scheduleKstMidnightAutoAbsent();
        showToast(permission.adminOverride ? "일정이 변경되었습니다. (관리자 권한)" : "일정이 변경되었습니다.", 'success'); closeModal('attendance-modal');
    }
}
window.setAttendance = async function(status, options = {}) {
    if (isAttendanceModalReadOnly()) {
        showToast('타 선생님 일정은 보기 전용입니다.', 'warning');
        return;
    }
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    const memo = document.getElementById('att-memo').innerHTML;
    const sharedMemo = document.getElementById('att-shared-memo').innerHTML;
    const keepModalOpen = options && options.keepModalOpen === true;
    const rawStartTime = options && options.startTime ? options.startTime : document.getElementById('att-edit-time').value;
    const startTime = normalizeScheduleTimeKey(rawStartTime);
    const ownerTeacherId = String(document.getElementById('att-owner-teacher-id')?.value || currentTeacherId || '');
    const resolvedStartTime = resolveAttendanceSlotStartTime(ownerTeacherId, sid, dateStr, startTime);
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1 && resolvedStartTime) {
        if(!students[sIdx].attendance) students[sIdx].attendance = {};
        if(!students[sIdx].attendance[dateStr]) students[sIdx].attendance[dateStr] = {};
        students[sIdx].attendance[dateStr][resolvedStartTime] = status;
        if(!students[sIdx].records) students[sIdx].records = {};
        if(!students[sIdx].records[dateStr]) students[sIdx].records[dateStr] = {};
        students[sIdx].records[dateStr][resolvedStartTime] = memo;
        if(!students[sIdx].shared_records) students[sIdx].shared_records = {};
        if(!students[sIdx].shared_records[dateStr]) students[sIdx].shared_records[dateStr] = {};
        students[sIdx].shared_records[dateStr][resolvedStartTime] = sharedMemo;

        updateAttendanceStatusDisplay(status);

        // 데이터 저장
        saveData();

        // DB에도 상태 업데이트 (기존 시간/스캔 결과 유지)
        // 반드시 scheduled_time(수업 시작시간)까지 포함하여 upsert
        const memoData = { memo: memo || null, shared_memo: sharedMemo || null };
        const lastSavedRecord = await persistAttendanceStatusToDbForTeacher(
            sid,
            dateStr,
            status,
            ownerTeacherId,
            resolvedStartTime,
            memoData
        );
        if (typeof window.updateAttendanceSourceDisplay === 'function') {
            window.updateAttendanceSourceDisplay(lastSavedRecord || {
                qr_scanned: false,
                check_in_time: new Date().toISOString()
            });
        }

        // currentTeacherStudents 배열도 즉시 업데이트
        const currentStudentIdx = currentTeacherStudents.findIndex(s => String(s.id) === String(sid));
        if (currentStudentIdx > -1) {
            if(!currentTeacherStudents[currentStudentIdx].attendance) currentTeacherStudents[currentStudentIdx].attendance = {};
            if(!currentTeacherStudents[currentStudentIdx].attendance[dateStr]) currentTeacherStudents[currentStudentIdx].attendance[dateStr] = {};
            currentTeacherStudents[currentStudentIdx].attendance[dateStr][resolvedStartTime] = status;
            if(!currentTeacherStudents[currentStudentIdx].records) currentTeacherStudents[currentStudentIdx].records = {};
            if(!currentTeacherStudents[currentStudentIdx].records[dateStr]) currentTeacherStudents[currentStudentIdx].records[dateStr] = {};
            currentTeacherStudents[currentStudentIdx].records[dateStr][resolvedStartTime] = memo;
            if(!currentTeacherStudents[currentStudentIdx].shared_records) currentTeacherStudents[currentStudentIdx].shared_records = {};
            if(!currentTeacherStudents[currentStudentIdx].shared_records[dateStr]) currentTeacherStudents[currentStudentIdx].shared_records[dateStr] = {};
            currentTeacherStudents[currentStudentIdx].shared_records[dateStr][resolvedStartTime] = sharedMemo;
        }

        // 반드시 최신 참조로 갱신
        if (typeof refreshCurrentTeacherStudents === 'function') {
            await refreshCurrentTeacherStudents();
        }

        console.log('[setAttendance] 상태 저장됨:', { sid, dateStr, startTime: resolvedStartTime, status, student: students[sIdx].name });

        // 화면 즉시 업데이트
        renderCalendar();
        // 출석 상태 변경 후 students/currentTeacherStudents 최신화
        if (typeof refreshCurrentTeacherStudents === 'function') {
            await refreshCurrentTeacherStudents();
        }
        // 시간표 모달이 열려 있으면 최신 데이터로 즉시 갱신
        if(document.getElementById('day-detail-modal') && document.getElementById('day-detail-modal').style.display === 'flex') {
            renderDayEvents(dateStr);
        }
        // 출석 관리 모달이 열려 있으면 즉시 갱신
        if(document.getElementById('attendance-modal') && document.getElementById('attendance-modal').style.display === 'flex') {
            // 현재 학생/날짜/시간에 맞게 상태 갱신
            const sid = document.getElementById('att-student-id').value;
            const startTime = document.getElementById('att-edit-time').value;
            const sIdx = students.findIndex(x => String(x.id) === String(sid));
            let currentStatus = null;
            if (sIdx > -1 && students[sIdx].attendance && students[sIdx].attendance[dateStr]) {
                if (startTime && typeof students[sIdx].attendance[dateStr] === 'object') {
                    currentStatus = getSlotValueByNormalizedTime(students[sIdx].attendance[dateStr], startTime);
                } else if (typeof students[sIdx].attendance[dateStr] === 'string') {
                    currentStatus = students[sIdx].attendance[dateStr];
                }
            }
            updateAttendanceStatusDisplay(currentStatus);
        }
        
        // ★ 출석 조회 모달이 열려있으면 즉시 갱신
        const historyModal = document.getElementById('student-attendance-history-modal');
        if (historyModal && historyModal.style.display === 'flex' && typeof window.loadStudentAttendanceHistory === 'function') {
            try {
                await window.loadStudentAttendanceHistory();
            } catch (e) {
                console.error('[setAttendance] 출석 조회 갱신 실패:', e);
            }
        }
        
        // 짧은 딜레이 후 모달 닫기 (사용자가 선택을 확인할 수 있도록)
        if (!keepModalOpen) {
            setTimeout(() => {
                closeModal('attendance-modal');
            }, 300);
        }
    }
}

function updateAttendanceStatusDisplay(status) {
    const statusDisplay = document.getElementById('current-status-display');
    if (!statusDisplay) return;

    statusDisplay.className = 'am-status-badge';

    const statusMapDisplay = {
        present: { text: '출석', class: 'status-present' },
        late: { text: '지각', class: 'status-late' },
        absent: { text: '결석', class: 'status-absent' },
        makeup: { text: '보강', class: 'status-makeup' },
        etc: { text: '보강', class: 'status-makeup' }
    };

    if (status && statusMapDisplay[status]) {
        statusDisplay.textContent = statusMapDisplay[status].text;
        statusDisplay.classList.add(statusMapDisplay[status].class);
    } else {
        statusDisplay.textContent = '미등록';
    }

    // 출석 버튼 활성 표시
    document.querySelectorAll('.am-att-btn').forEach(btn => btn.classList.remove('active'));
    if (status) {
        const activeClass = status === 'makeup' ? 'etc' : status;
        const activeBtn = document.querySelector(`.am-att-btn.${activeClass}`);
        if (activeBtn) activeBtn.classList.add('active');
    }
}

function resolveAttendanceSource(recordLike) {
    if (!recordLike) return 'unknown';
    const explicit = String(recordLike.attendance_source || '').trim();
    if (['qr', 'phone', 'teacher', 'emergency', 'unknown', 'qr_student', 'teacher_manual'].includes(explicit)) return explicit;
    if (recordLike.qr_scanned) return 'qr';
    if (String(recordLike.qr_judgment || '').includes('전화번호인증') || String(recordLike.memo || '').includes('[전화번호인증]')) return 'phone';
    if (recordLike.check_in_time) return 'teacher';
    return 'unknown';
}

window.updateAttendanceSourceDisplay = function(recordLike) {
    const sourceEl = document.getElementById('attendance-source-display');
    if (!sourceEl) return;

    const sourceType = resolveAttendanceSource(recordLike);
    sourceEl.className = 'am-source-badge';

    if (sourceType === 'qr' || sourceType === 'qr_student') {
        sourceEl.classList.add('source-qr');
        const timeLabel = recordLike && recordLike.qr_scan_time
            ? new Date(recordLike.qr_scan_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
            : '';
        sourceEl.textContent = timeLabel
            ? `출석 방식: 학생 QR (${timeLabel})`
            : '출석 방식: 학생 QR';
        return;
    }

    if (sourceType === 'phone') {
        sourceEl.classList.add('source-teacher');
        const timeLabel = recordLike && (recordLike.auth_time || recordLike.check_in_time)
            ? new Date(recordLike.auth_time || recordLike.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
            : '';
        sourceEl.textContent = timeLabel
            ? `출석 방식: 번호 입력 (${timeLabel})`
            : '출석 방식: 번호 입력';
        return;
    }

    if (sourceType === 'teacher' || sourceType === 'teacher_manual') {
        sourceEl.classList.add('source-teacher');
        const timeLabel = recordLike && recordLike.check_in_time
            ? new Date(recordLike.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
            : '';
        sourceEl.textContent = timeLabel
            ? `출석 방식: 선생님 체크 (${timeLabel})`
            : '출석 방식: 선생님 체크';
        return;
    }

    if (sourceType === 'emergency') {
        sourceEl.classList.add('source-unknown');
        sourceEl.textContent = '출석 방식: 임시출석';
        return;
    }

    sourceEl.classList.add('source-unknown');
    sourceEl.textContent = '출석 방식: 미확인';
}

async function persistAttendanceStatusToDb(studentId, dateStr, status, teacherId) {
    await persistAttendanceStatusToDbForTeacher(studentId, dateStr, status, teacherId);
}

function hasTeacherScheduleAtSlot(teacherId, studentId, dateStr, startTime) {
    const normalizedTeacherId = String(teacherId || '').trim();
    const normalizedStudentId = String(studentId || '').trim();
    const normalizedStart = normalizeScheduleTimeKey(startTime);
    if (!normalizedTeacherId || !normalizedStudentId || !dateStr || !normalizedStart) return false;
    const entries = getScheduleEntries(normalizedTeacherId, normalizedStudentId, dateStr);
    return entries.some((entry) => normalizeScheduleTimeKey(entry?.start || '') === normalizedStart);
}

function resolveAttendanceSlotStartTime(teacherId, studentId, dateStr, preferredStartTime) {
    const normalizedPreferred = normalizeScheduleTimeKey(preferredStartTime);
    const entries = getScheduleEntries(String(teacherId || ''), String(studentId || ''), dateStr);
    if (!Array.isArray(entries) || entries.length === 0) return normalizedPreferred;
    const exact = entries.find((entry) => normalizeScheduleTimeKey(entry?.start || '') === normalizedPreferred);
    if (exact) return normalizeScheduleTimeKey(exact.start || normalizedPreferred);
    if (entries.length === 1) return normalizeScheduleTimeKey(entries[0]?.start || normalizedPreferred);
    return normalizedPreferred;
}

async function cleanupLegacyAbsentShadowRecord(studentId, dateStr, ownerTeacherId, startTime, appliedStatus) {
    if (typeof supabase === 'undefined') return;
    const normalizedOwnerTeacherId = String(ownerTeacherId || '').trim();
    const normalizedStatus = String(appliedStatus || '').toLowerCase();
    const normalizedStart = normalizeScheduleTimeKey(startTime);
    if (!normalizedOwnerTeacherId) return;
    if (!normalizedStart) return;
    if (!['present', 'late', 'makeup', 'etc'].includes(normalizedStatus)) return;

    try {
        const ownerId = cachedLsGet('current_owner_id');
        if (!ownerId) return;
        const numericStudentId = parseInt(studentId, 10);
        if (Number.isNaN(numericStudentId)) return;
        const timeVariants = Array.from(new Set([normalizedStart, `${normalizedStart}:00`]));
        const { data: shadowRowsRaw, error: fetchError } = await supabase
            .from('attendance_records')
            .select('id, teacher_id, status')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericStudentId)
            .eq('attendance_date', dateStr)
            .in('scheduled_time', timeVariants);
        if (fetchError || !shadowRowsRaw || shadowRowsRaw.length === 0) return;
        const shadowRows = shadowRowsRaw.filter((row) => {
            const rowTeacherId = String(row?.teacher_id || '').trim();
            const statusValue = String(row?.status || '').toLowerCase();
            if (!rowTeacherId || rowTeacherId === normalizedOwnerTeacherId) return false;
            if (statusValue !== 'absent') return false;
            if (hasTeacherScheduleAtSlot(rowTeacherId, studentId, dateStr, normalizedStart)) return false;
            return true;
        });
        const shadowIds = shadowRows.map((row) => row.id).filter((id) => !!id);
        if (shadowIds.length === 0) return;
        const { error: deleteError } = await supabase
            .from('attendance_records')
            .delete()
            .in('id', shadowIds);
        if (deleteError) {
            console.warn('[cleanupLegacyAbsentShadowRecord] stale absent 정리 실패:', deleteError);
        } else {
            console.log('[cleanupLegacyAbsentShadowRecord] stale absent 정리 완료:', shadowIds.length);
        }
    } catch (cleanupError) {
        console.warn('[cleanupLegacyAbsentShadowRecord] 예외:', cleanupError);
    }
}

async function persistAttendanceStatusToDbForTeacher(studentId, dateStr, status, teacherId, startTime, memoData) {
    if (typeof window.saveAttendanceRecord !== 'function') return;

    let existing = null;
    if (typeof window.getAttendanceRecordByStudentAndDate === 'function') {
        try {
            existing = await window.getAttendanceRecordByStudentAndDate(studentId, dateStr, teacherId || null, startTime);
        } catch (e) {
            console.error('[persistAttendanceStatusToDbForTeacher] 기존 기록 조회 실패:', e);
        }
    }

    const teacherSchedule = teacherScheduleData[teacherId] || {};
    const studentSchedule = teacherSchedule[String(studentId)] || {};
    const schedule = studentSchedule[dateStr] || null;

    // memoData가 전달되면 해당 값 사용, 아니면 기존 DB 값 유지
    const memoValue = (memoData && memoData.memo !== undefined) ? memoData.memo : (existing?.memo || null);
    const sharedMemoValue = (memoData && memoData.shared_memo !== undefined) ? memoData.shared_memo : (existing?.shared_memo || null);

    const payload = {
        studentId: studentId,
        teacherId: String(teacherId || existing?.teacher_id || currentTeacherId || ''),
        attendanceDate: dateStr,
        // 선생님 수동 처리 시에도 체크 시각을 남겨 "QR/수동" 구분이 가능하도록 유지
        checkInTime: existing?.check_in_time || new Date().toISOString(),
        scheduledTime: startTime,
        status: status,
        qrScanned: existing?.qr_scanned || false,
        qrScanTime: existing?.qr_scan_time || null,
        qrJudgment: existing?.qr_judgment || null,
        attendance_source: existing?.attendance_source || (existing?.qr_scanned ? 'qr' : 'teacher'),
        authTime: existing?.auth_time || existing?.qr_scan_time || existing?.check_in_time || new Date().toISOString(),
        presenceChecked: existing?.presence_checked || false,
        processedAt: new Date().toISOString(),
        memo: memoValue,
        shared_memo: sharedMemoValue
    };

    let savedRecord = null;
    try {
        savedRecord = await window.saveAttendanceRecord(payload);
        console.log('[ATT-BOX][persist][write]', {
            studentId: String(studentId || ''),
            teacherId: String(payload.teacherId || ''),
            dateStr,
            startTime: String(payload.scheduledTime || ''),
            status: String(status || '')
        });
    } catch (e) {
        console.error('[persistAttendanceStatusToDbForTeacher] 상태 저장 실패:', e);
    }

    await cleanupLegacyAbsentShadowRecord(studentId, dateStr, teacherId, startTime, status);

    // 저장 직후 owner 전체 조회 기준으로 최종 상태를 재확인해 결석 재역전 경로를 즉시 보정
    // (묶음 일정/legacy teacher key 혼재 환경에서 stale absent가 재선택되는 케이스 대응)
    try {
        const normalizedDesired = String(status || '').toLowerCase();
        if (typeof window.getAttendanceRecordByStudentAndDate === 'function' && ['present', 'late', 'makeup', 'etc'].includes(normalizedDesired)) {
            const ownerAllAfterSave = await window.getAttendanceRecordByStudentAndDate(studentId, dateStr, null, startTime, false);
            const normalizedAfter = String(ownerAllAfterSave?.status || '').toLowerCase();
            if (normalizedAfter !== normalizedDesired) {
                const reconcilePayload = {
                    studentId: studentId,
                    teacherId: String(teacherId || currentTeacherId || ''),
                    attendanceDate: dateStr,
                    checkInTime: ownerAllAfterSave?.check_in_time || existing?.check_in_time || new Date().toISOString(),
                    scheduledTime: startTime,
                    status: status,
                    qrScanned: ownerAllAfterSave?.qr_scanned || existing?.qr_scanned || false,
                    qrScanTime: ownerAllAfterSave?.qr_scan_time || existing?.qr_scan_time || null,
                    qrJudgment: ownerAllAfterSave?.qr_judgment || existing?.qr_judgment || null,
                    attendance_source: ownerAllAfterSave?.attendance_source || existing?.attendance_source || (existing?.qr_scanned ? 'qr' : 'teacher'),
                    authTime: ownerAllAfterSave?.auth_time || existing?.auth_time || new Date().toISOString(),
                    presenceChecked: ownerAllAfterSave?.presence_checked || existing?.presence_checked || false,
                    processedAt: new Date().toISOString(),
                    memo: memoValue,
                    shared_memo: sharedMemoValue
                };
                savedRecord = await window.saveAttendanceRecord(reconcilePayload);
                await cleanupLegacyAbsentShadowRecord(studentId, dateStr, teacherId, startTime, status);
                console.log('[persistAttendanceStatusToDbForTeacher] 상태 재정합화 적용:', {
                    studentId, dateStr, startTime, desired: normalizedDesired, before: normalizedAfter
                });
            }
        }
    } catch (reconcileError) {
        console.warn('[persistAttendanceStatusToDbForTeacher] 상태 재정합화 실패:', reconcileError);
    }

    // ★ 출석 조회 모달이 열려있으면 즉시 갱신 (student-attendance-history-modal)
    const historyModal = document.getElementById('student-attendance-history-modal');
    if (historyModal && historyModal.style.display === 'flex' && typeof window.loadStudentAttendanceHistory === 'function') {
        try {
            await window.loadStudentAttendanceHistory();
        } catch (e) {
            console.error('[persistAttendanceStatusToDbForTeacher] 출석 조회 갱신 실패:', e);
        }
    }

    return savedRecord;
}
window.saveOnlyMemo = async function() {
    if (isAttendanceModalReadOnly()) {
        showToast('타 선생님 일정은 보기 전용입니다.', 'warning');
        return;
    }
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    const startTime = document.getElementById('att-original-time').value;
    const ownerTeacherId = String(document.getElementById('att-owner-teacher-id')?.value || currentTeacherId || '');
    const resolvedStartTime = resolveAttendanceSlotStartTime(ownerTeacherId, sid, dateStr, startTime);
    const privateMemo = document.getElementById('att-memo').innerHTML;
    const sharedMemo = document.getElementById('att-shared-memo').innerHTML;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        // 개인 메모 저장 (로컬 + 기존 records 구조)
        if(!students[sIdx].records) students[sIdx].records = {};
        if (resolvedStartTime) {
            if (typeof students[sIdx].records[dateStr] !== 'object') students[sIdx].records[dateStr] = {};
            students[sIdx].records[dateStr][resolvedStartTime] = privateMemo;
        } else {
            students[sIdx].records[dateStr] = privateMemo;
        }

        // 공유 메모 저장 (로컬 shared_records + DB)
        if(!students[sIdx].shared_records) students[sIdx].shared_records = {};
        if (resolvedStartTime) {
            if (typeof students[sIdx].shared_records[dateStr] !== 'object') students[sIdx].shared_records[dateStr] = {};
            students[sIdx].shared_records[dateStr][resolvedStartTime] = sharedMemo;
        } else {
            students[sIdx].shared_records[dateStr] = sharedMemo;
        }

        saveData();

        // DB에도 공유 메모 저장
        try {
            if (typeof window.saveAttendanceRecord === 'function') {
                const existing = typeof window.getAttendanceRecordByStudentAndDate === 'function'
                    ? await window.getAttendanceRecordByStudentAndDate(sid, dateStr, ownerTeacherId, resolvedStartTime)
                    : null;
                const localStatus = getSlotValueByNormalizedTime(students[sIdx].attendance?.[dateStr], resolvedStartTime);
                const currentStatus = existing?.status || localStatus || 'none';
                await window.saveAttendanceRecord({
                    studentId: sid,
                    teacherId: ownerTeacherId,
                    attendanceDate: dateStr,
                    scheduledTime: resolvedStartTime || null,
                    status: currentStatus,
                    checkInTime: existing ? existing.check_in_time : null,
                    qrScanned: existing ? existing.qr_scanned : false,
                    memo: privateMemo || null,
                    shared_memo: sharedMemo || null
                });
            }
        } catch (e) {
            console.error('[saveOnlyMemo] DB 저장 실패:', e);
        }

        showToast("기록이 저장되었습니다.", 'success');
    }
}

window.applyMemoColor = function(color) {
    if (isAttendanceModalReadOnly()) {
        showToast('타 선생님 일정은 보기 전용입니다.', 'warning');
        return;
    }
    const selection = window.getSelection();
    if (!selection.toString()) { showToast("글자를 선택해주세요.", 'warning'); return; }
    
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.style.color = color;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
}
// 통합된 일정 생성 내부 함수
async function _generateScheduleCore(excludeHolidays) {
    if (isScheduleSaving) return;
    const hiddenSid = document.getElementById('sch-student-select').value;
    const targetStudentIds = selectedScheduleStudents.length ? [...selectedScheduleStudents] : (hiddenSid ? [hiddenSid] : []);
    const days = Array.from(document.querySelectorAll('.day-check:checked')).map(c => parseInt(c.value));
    const startVal = document.getElementById('sch-start-date').value;
    const weeksVal = document.getElementById('sch-weeks').value;
    const startTime = document.getElementById('sch-time').value;
    const durationMin = document.getElementById('sch-duration-min').value;
    if (targetStudentIds.length === 0 || !startVal || !startTime || !durationMin) { showToast("필수 정보를 모두 입력해주세요.", 'warning'); return; }
    
    const startObj = new Date(startVal);
    const durInt = parseInt(durationMin);
    if (days.length > 0) {
        const startDayOfWeek = startObj.getDay();
        if (!days.includes(startDayOfWeek)) { showToast("시작 날짜의 요일이 선택된 반복 요일에 포함되지 않습니다.", 'warning'); return; }
        const weeks = parseInt(weeksVal);
        if (!weeks || weeks < 1) { showToast("반복할 주(Week) 수를 1 이상 입력해주세요.", 'warning'); return; }
    }

    isScheduleSaving = true;
    const saveBtn = document.getElementById('schedule-save-btn');
    const saveWithoutBtn = document.getElementById('schedule-save-without-btn');
    const activeBtn = excludeHolidays ? saveWithoutBtn : saveBtn;
    const otherBtn = excludeHolidays ? saveBtn : saveWithoutBtn;
    if (activeBtn) { activeBtn.disabled = true; activeBtn.dataset.originalHtml = activeBtn.innerHTML; activeBtn.textContent = '생성 중...'; }
    if (otherBtn) otherBtn.disabled = true;

    try {
        let totalCount = 0;
        let cancelledByUser = false; // 사용자가 겹침 취소로 중단했는지 추적
        const scheduleBatch = [];
        for (const sid of targetStudentIds) {
            const student = students.find(s => String(s.id) === String(sid));
            if (!student) { showToast("학생 정보를 찾을 수 없습니다.", 'error'); return; }

            if(!teacherScheduleData[currentTeacherId]) teacherScheduleData[currentTeacherId] = {};
            if(!teacherScheduleData[currentTeacherId][sid]) teacherScheduleData[currentTeacherId][sid] = {};
            assignStudentToTeacher(sid);

            let count = 0;
            let skipOverlapForAll = false;

            if (days.length === 0) {
                // === 단일 날짜 ===
                const off = startObj.getTimezoneOffset() * 60000;
                const dStr = new Date(startObj.getTime() - off).toISOString().split('T')[0];
                const holidayInfo = excludeHolidays ? getHolidayInfo(dStr) : null;
                if (holidayInfo && !(await showConfirm(`${student.name} - ${dStr}은 ${holidayInfo.name}입니다. 계속 진행하시겠습니까?`, { type: 'warn', title: '공휴일 안내' }))) { cancelledByUser = true; continue; }
                const entries = getScheduleEntries(currentTeacherId, String(sid), dStr);
                const exists = entries.some(item => item.start === startTime);
                if (exists && !(await showConfirm(`${student.name} - ${dStr} ${startTime}에 이미 일정이 있습니다. 덮어씌우시겠습니까?`, { type: 'warn', title: '일정 겹침' }))) { cancelledByUser = true; continue; }
                const overlaps = await checkScheduleOverlap(sid, dStr, startTime, durInt, exists ? currentTeacherId : null, exists ? startTime : null);
                if (overlaps.length > 0 && !(await showConfirm(formatOverlapMessage(student.name, dStr, overlaps), { type: 'warn', title: '일정 겹침' }))) { cancelledByUser = true; continue; }
                const updated = upsertScheduleEntry(entries, { start: startTime, duration: durInt });
                setScheduleEntries(currentTeacherId, String(sid), dStr, updated.list);
                scheduleBatch.push({ teacherId: currentTeacherId, studentId: sid, date: dStr, startTime, duration: durInt });
                count++;
            } else {
                // === 반복 일정 ===
                const weeks = parseInt(weeksVal);
                for (let i = 0; i < weeks * 7; i++) {
                    const cur = new Date(startObj); cur.setDate(startObj.getDate() + i); 
                    if (!days.includes(cur.getDay())) continue;
                    const off = cur.getTimezoneOffset() * 60000;
                    const dStr = new Date(cur.getTime() - off).toISOString().split('T')[0];
                    if (excludeHolidays && getHolidayInfo(dStr)) continue;
                    const entries = getScheduleEntries(currentTeacherId, String(sid), dStr);
                    const exists = entries.some(item => item.start === startTime);
                    if (exists) continue;
                    // 겹침 확인 (모두 건너뛰기 옵션 지원)
                    if (!skipOverlapForAll) {
                        const overlaps = await checkScheduleOverlap(sid, dStr, startTime, durInt, null, null);
                        if (overlaps.length > 0) {
                            const overlapMsg = formatOverlapMessage(student.name, dStr, overlaps) + `\n\n[확인] = 추가\n[취소] = 건너뛰기`;
                            if (!(await showConfirm(overlapMsg, { type: 'warn', title: '일정 겹침', okText: '추가', cancelText: '건너뛰기' }))) { cancelledByUser = true; continue; }
                        }
                    }
                    const updated = upsertScheduleEntry(entries, { start: startTime, duration: durInt });
                    setScheduleEntries(currentTeacherId, String(sid), dStr, updated.list);
                    scheduleBatch.push({ teacherId: currentTeacherId, studentId: sid, date: dStr, startTime, duration: durInt });
                    count++;
                }
            }
            totalCount += count;
        }
        saveData();
        persistTeacherScheduleLocal();
        if (scheduleBatch.length) {
            if (typeof saveSchedulesToDatabaseBatch === 'function') {
                await saveSchedulesToDatabaseBatch(scheduleBatch);
            } else if (typeof saveScheduleToDatabase === 'function') {
                await Promise.allSettled(scheduleBatch.map(item => saveScheduleToDatabase(item)));
            }
        }
        saveLayouts();
        // ★ 일정이 실제로 생성된 경우에만 모달 닫기 (취소로 0개면 모달 유지)
        if (totalCount > 0) {
            closeModal('schedule-modal');
        } else if (cancelledByUser) {
            // 사용자가 겹침/공휴일 확인에서 취소 → 모달 유지, 안내 토스트
            showToast('일정 추가가 취소되었습니다. 설정을 변경 후 다시 시도하세요.', 'info');
        } else {
            closeModal('schedule-modal');
        }
        renderCalendar();
        await loadAllTeachersScheduleData();
        if (typeof window.initMissedScanChecks === 'function') window.initMissedScanChecks();
        if (typeof scheduleKstMidnightAutoAbsent === 'function') scheduleKstMidnightAutoAbsent();
        const suffix = excludeHolidays && totalCount === 0 ? ' (공휴일이 제외되었을 수 있습니다)' : '';
        if (totalCount > 0) showToast(`${totalCount}개의 일정이 생성되었습니다.`, 'success');
        else if (!cancelledByUser) showToast(`새로 등록된 일정이 없습니다.${suffix}`, 'info');
    } finally {
        isScheduleSaving = false;
        if (activeBtn) { activeBtn.disabled = false; if (activeBtn.dataset.originalHtml) { activeBtn.innerHTML = activeBtn.dataset.originalHtml; delete activeBtn.dataset.originalHtml; } }
        if (otherBtn) otherBtn.disabled = false;
    }
}

window.generateSchedule = function() { return _generateScheduleCore(false); };
window.generateScheduleWithoutHolidays = function() { return _generateScheduleCore(true); };

function countStudentSchedulesInRange(studentId, startStr, endStr) {
    if (!studentId || !startStr || !endStr || startStr > endStr) return 0;
    const teacherSchedules = teacherScheduleData[currentTeacherId] || {};
    const studentSchedules = teacherSchedules[String(studentId)] || {};
    let count = 0;
    Object.keys(studentSchedules).forEach((dateStr) => {
        if (dateStr < startStr || dateStr > endStr) return;
        const entries = getScheduleEntries(currentTeacherId, String(studentId), dateStr);
        count += entries.length;
    });
    return count;
}

function getMonthSpanCount(startStr, endStr) {
    if (!startStr || !endStr || startStr > endStr) return 0;
    const [sy, sm] = startStr.split('-').map(Number);
    const [ey, em] = endStr.split('-').map(Number);
    if (!sy || !sm || !ey || !em) return 0;
    return ((ey - sy) * 12) + (em - sm) + 1;
}

function formatDeleteScopeLabel(scope, studentCount) {
    if (scope === 'student') return `선택 학생 ${studentCount}명`;
    return '전체 학생';
}

function buildDeleteImpactText(options) {
    const {
        scopeLabel = '전체 학생',
        startStr = '',
        endStr = '',
        totalCount = 0,
        monthSpan = 0
    } = options || {};
    if (!startStr || !endStr) {
        return '기간을 선택하면 삭제 범위와 영향이 표시됩니다.';
    }
    if (startStr > endStr) {
        return '시작일이 종료일보다 늦습니다. 날짜를 다시 선택해주세요.';
    }
    if (totalCount <= 0) {
        return `${scopeLabel} 기준으로 선택된 기간에 삭제할 일정이 없습니다.`;
    }
    const monthHint = monthSpan > 1 ? ` (${monthSpan}개월 범위)` : '';
    return `${scopeLabel} 기준 ${startStr} ~ ${endStr}${monthHint}에서 ${totalCount}건이 삭제됩니다. 삭제 후 복구할 수 없습니다.`;
}

window.updateBulkDeletePreview = function() {
    const previewEl = document.getElementById('bulk-del-preview');
    const warningEl = document.getElementById('bulk-del-warning');
    if (!previewEl) return;
    const sid = document.getElementById('bulk-del-sid')?.value;
    const startStr = document.getElementById('bulk-del-start')?.value;
    const endStr = document.getElementById('bulk-del-end')?.value;
    if (!sid || !startStr || !endStr || startStr > endStr) {
        previewEl.textContent = '삭제 예정 일정: 0건';
        if (warningEl) {
            warningEl.textContent = buildDeleteImpactText({
                scopeLabel: '현재 학생',
                startStr,
                endStr,
                totalCount: 0,
                monthSpan: getMonthSpanCount(startStr, endStr)
            });
            warningEl.classList.remove('danger');
        }
        return;
    }
    const count = countStudentSchedulesInRange(sid, startStr, endStr);
    previewEl.textContent = `삭제 예정 일정: ${count}건`;
    if (warningEl) {
        warningEl.textContent = buildDeleteImpactText({
            scopeLabel: '현재 학생',
            startStr,
            endStr,
            totalCount: count,
            monthSpan: getMonthSpanCount(startStr, endStr)
        });
        warningEl.classList.toggle('danger', count > 0);
    }
};

window.prepareBulkDelete = function() {
    const sid = document.getElementById('edit-id').value;
    if(!sid) return;
    document.getElementById('bulk-del-sid').value = sid;
    const today = new Date(); const off = today.getTimezoneOffset() * 60000;
    const todayStr = new Date(today.getTime() - off).toISOString().split('T')[0];
    document.getElementById('bulk-del-start').value = todayStr;
    document.getElementById('bulk-del-end').value = ""; 
    updateBulkDeletePreview();
    closeModal('register-modal'); openModal('bulk-delete-modal');
}

function ensureOwnedScheduleDeleteContext(actionLabel) {
    if (currentTeacherId) return true;
    showToast(`${actionLabel || '일정 삭제'}를 진행할 선생님 정보가 없습니다. 다시 로그인해주세요.`, 'error');
    return false;
}

function removeTimeScopedValue(container, dateKey, timeKey) {
    if (!container || !container[dateKey]) return;
    const dateValue = container[dateKey];
    if (!timeKey) {
        delete container[dateKey];
        return;
    }
    if (typeof dateValue === 'object' && dateValue !== null) {
        const normalizedTime = normalizeScheduleTimeKey(timeKey);
        const targetKey = Object.keys(dateValue).find((k) => normalizeScheduleTimeKey(k) === normalizedTime) || timeKey;
        delete dateValue[targetKey];
        const remainKeys = Object.keys(dateValue).filter(k => k !== 'default');
        if (remainKeys.length === 0) delete container[dateKey];
    } else {
        delete container[dateKey];
    }
}

async function deleteAttendanceRecordBySlotFromDb(studentId, dateStr, teacherId, startTime) {
    if (typeof supabase === 'undefined') return;
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) return;
    const numericStudentId = parseInt(studentId, 10);
    if (Number.isNaN(numericStudentId)) return;
    const normalizedStart = normalizeScheduleTimeKey(startTime);
    if (!dateStr || !teacherId) return;

    try {
        let query = supabase
            .from('attendance_records')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericStudentId)
            .eq('attendance_date', dateStr)
            .eq('teacher_id', String(teacherId));
        if (normalizedStart) {
            const timeVariants = Array.from(new Set([normalizedStart, `${normalizedStart}:00`]));
            query = query.in('scheduled_time', timeVariants);
        }
        const { error } = await query;
        if (error) {
            console.error('[deleteAttendanceRecordBySlotFromDb] 삭제 실패:', error);
        }
    } catch (e) {
        console.error('[deleteAttendanceRecordBySlotFromDb] 예외:', e);
    }
}

async function collectScheduleSlotsByRangeFromDb(studentId, startDate, endDate, teacherId) {
    if (typeof supabase === 'undefined') return [];
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) return [];
    const numericStudentId = parseInt(studentId, 10);
    if (Number.isNaN(numericStudentId)) return [];
    if (!startDate || !endDate || !teacherId) return [];

    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('schedule_date, start_time')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericStudentId)
            .eq('teacher_id', String(teacherId))
            .gte('schedule_date', startDate)
            .lte('schedule_date', endDate);
        if (error) {
            console.error('[collectScheduleSlotsByRangeFromDb] 조회 실패:', error);
            return [];
        }
        return (Array.isArray(data) ? data : [])
            .map((row) => ({
                studentId,
                dateStr: row?.schedule_date,
                teacherId: String(teacherId),
                startTime: normalizeScheduleTimeKey(row?.start_time || '')
            }))
            .filter((row) => row.dateStr && row.startTime && row.startTime !== 'default');
    } catch (e) {
        console.error('[collectScheduleSlotsByRangeFromDb] 예외:', e);
        return [];
    }
}

window.executeBulkDelete = async function() {
    if (!ensureOwnedScheduleDeleteContext('기간 삭제')) return;
    const sid = document.getElementById('bulk-del-sid').value;
    const startStr = document.getElementById('bulk-del-start').value;
    const endStr = document.getElementById('bulk-del-end').value;
    if(!startStr || !endStr) { showToast("기간을 모두 선택해주세요.", 'warning'); return; }
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx === -1) return;
    const deleteCount = countStudentSchedulesInRange(sid, startStr, endStr);
    const monthSpan = getMonthSpanCount(startStr, endStr);
    const confirmMessage = `선택한 기간의 일정을 삭제하시겠습니까?\n\n- 기간: ${startStr} ~ ${endStr}${monthSpan > 1 ? ` (${monthSpan}개월)` : ''}\n- 삭제 예정: ${deleteCount}건\n- 대상: 내가 등록한 일정만\n\n삭제한 일정의 같은 시간 슬롯 출석기록도 함께 삭제됩니다.\n삭제 후 복구할 수 없습니다.`;
    if(!(await showConfirm(confirmMessage, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    const startDate = new Date(startStr); const endDate = new Date(endStr);
    
    let deletedCount = 0;
    let deletedAny = false;
    let deleteDates = [];
    const deleteSlotTargets = [];
    
    // 현재 선생님의 schedule 데이터에서 삭제할 일정 수집
    if(teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
        deleteDates = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dStr => {
            const d = new Date(dStr);
            return d >= startDate && d <= endDate;
        });
        deleteDates.forEach((dStr) => {
            const entries = getScheduleEntries(currentTeacherId, String(sid), dStr);
            entries.forEach((entry) => {
                const st = normalizeScheduleTimeKey(entry?.start || '');
                if (!st || st === 'default') return;
                deleteSlotTargets.push({ studentId: sid, dateStr: dStr, teacherId: currentTeacherId, startTime: st });
            });
        });
    }

    if (deleteDates.length > 0) deletedAny = true;
    try {
        const dbSlotTargets = await collectScheduleSlotsByRangeFromDb(sid, startStr, endStr, currentTeacherId);
        if (dbSlotTargets.length > 0) {
            deleteSlotTargets.push(...dbSlotTargets);
        }

        if (typeof deleteSchedulesByRange === 'function') {
            await deleteSchedulesByRange(sid, startStr, endStr, currentTeacherId);
            deletedAny = true;
        } else if (deleteDates.length > 0) {
            await Promise.allSettled(
                deleteDates.map(dStr => deleteScheduleFromDatabase(sid, dStr, currentTeacherId))
            );
            deletedAny = true;
        }

        deleteDates.forEach(dStr => {
            const entries = getScheduleEntries(currentTeacherId, String(sid), dStr);
            if (entries.length > 0) {
                entries.forEach((entry) => {
                    removeTimeScopedValue(students[sIdx].attendance, dStr, entry?.start || '');
                    removeTimeScopedValue(students[sIdx].records, dStr, entry?.start || '');
                    removeTimeScopedValue(students[sIdx].shared_records, dStr, entry?.start || '');
                });
                setScheduleEntries(currentTeacherId, String(sid), dStr, []);
                deletedCount += entries.length;
            }
        });
        if (deleteSlotTargets.length > 0) {
            await Promise.allSettled(
                deleteSlotTargets.map((t) => deleteAttendanceRecordBySlotFromDb(t.studentId, t.dateStr, t.teacherId, t.startTime))
            );
        }

        await loadTeacherScheduleData(currentTeacherId);
    } catch (dbError) {
        console.error('[executeBulkDelete] 데이터베이스 삭제 실패:', dbError);
        showToast('데이터베이스 삭제 중 오류가 발생했습니다: ' + dbError.message, 'error');
        return;
    }
    
    // 2. 데이터 저장 및 화면 업데이트
    saveData(); 
    persistTeacherScheduleLocal();
    closeModal('bulk-delete-modal'); 
    renderCalendar();
    if (deletedCount > 0) {
        showToast(`${deletedCount}개의 일정이 삭제되었습니다.`, 'success');
    } else if (deletedAny) {
        showToast('일정이 삭제되었습니다.', 'success');
    } else {
        showToast('삭제할 일정이 없습니다.', 'info');
    }
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
                const rawInfo = teacherScheduleData[currentTeacherId][sid][oldD];
                const entries = Array.isArray(rawInfo) ? rawInfo : [rawInfo];
                
                try {
                    await deleteScheduleFromDatabase(sid, oldD, currentTeacherId);
                    console.log('[handleDrop] 구 일정 삭제 완료:', oldD);
                    
                    for (const entry of entries) {
                        if (entry && entry.start) {
                            await saveScheduleToDatabase({
                                teacherId: currentTeacherId,
                                studentId: sid,
                                date: newD,
                                startTime: entry.start,
                                duration: entry.duration || 60
                            });
                        }
                    }
                    console.log('[handleDrop] 신 일정 추가 완료:', newD);
                    
                    teacherScheduleData[currentTeacherId][sid][newD] = rawInfo;
                    delete teacherScheduleData[currentTeacherId][sid][oldD];
                    
                } catch (dbError) {
                    console.error('[handleDrop] 데이터베이스 동기화 실패:', dbError);
                    showToast('일정 이동 중 오류가 발생했습니다.', 'error');
                    return;
                }
            }
        }
        saveData();
        persistTeacherScheduleLocal();
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') closeModal('day-detail-modal');
    }
}
window.deleteSingleSchedule = async function() {
    const sid = document.getElementById('att-student-id').value;
    const dateStr = document.getElementById('att-date').value;
    const originalStart = document.getElementById('att-original-time').value;
    const ownerTeacherId = document.getElementById('att-owner-teacher-id').value || currentTeacherId;
    const permission = await verifyScheduleEditPermission(ownerTeacherId);
    if (!permission.allowed) return;
    const targetTeacherId = String(permission.effectiveTeacherId || ownerTeacherId || currentTeacherId);
    if(!(await showConfirm("이 날짜의 일정을 삭제하시겠습니까?", { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if(sIdx > -1) {
        // 1. 로컬 메모리에서 먼저 삭제
        removeTimeScopedValue(students[sIdx].attendance, dateStr, originalStart || '');
        removeTimeScopedValue(students[sIdx].records, dateStr, originalStart || '');
        removeTimeScopedValue(students[sIdx].shared_records, dateStr, originalStart || '');
        // 현재 선생님의 일정 데이터 삭제
        const entries = getScheduleEntries(targetTeacherId, String(sid), dateStr);
        const nextEntries = originalStart ? entries.filter(item => item.start !== originalStart) : [];
        setScheduleEntries(targetTeacherId, String(sid), dateStr, nextEntries);
        
        // 2. 데이터 저장 및 화면 업데이트
        saveData();
        persistTeacherScheduleLocalFor(targetTeacherId);
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') renderDayEvents(dateStr);
        
        showToast(permission.adminOverride ? '일정이 삭제되었습니다. (관리자 권한)' : '일정이 삭제되었습니다.', 'success');

        // 3. 데이터베이스 삭제는 백그라운드 처리 (일정 + 동일 슬롯 출석기록)
        Promise.allSettled([
            deleteScheduleFromDatabase(sid, dateStr, targetTeacherId, originalStart || null),
            deleteAttendanceRecordBySlotFromDb(sid, dateStr, targetTeacherId, originalStart || null)
        ])
            .then((results) => {
                const failed = results.filter((r) => r.status === 'rejected');
                if (failed.length > 0) {
                    console.warn('[deleteSingleSchedule] 일부 DB 삭제 실패:', failed);
                } else {
                    console.log('[deleteSingleSchedule] DB 일정/출석 삭제 완료');
                }
            })
            .catch(dbError => {
                console.error('[deleteSingleSchedule] 데이터베이스 삭제 실패:', dbError);
            });
    }
    closeModal('attendance-modal');
}

// 기간별 일정 삭제 - 학생 선택 토글
window.togglePeriodDeleteStudent = function() {
    const scope = document.getElementById('period-del-scope').value;
    const studentGroup = document.getElementById('period-del-student-group');
    if (scope === 'student') {
        studentGroup.style.display = 'block';
        const searchInput = document.getElementById('period-del-student-search');
        const dropdown = document.getElementById('period-del-student-dropdown');
        const selectedList = document.getElementById('period-del-student-selected');

        selectedPeriodDeleteStudents = [];
        if (selectedList) selectedList.innerHTML = '';
        if (searchInput) searchInput.value = '';
        if (dropdown) {
            dropdown.classList.remove('active');
            dropdown.innerHTML = '';
        }

        const searchable = students;
        if (searchInput) {
            searchInput.oninput = function() {
                const query = this.value.trim();
                if (query === '') {
                    dropdown.classList.remove('active');
                    dropdown.innerHTML = '';
                    return;
                }

                const queryLower = query.toLowerCase();
                const filtered = searchable.filter(s =>
                    s.name.toLowerCase().includes(queryLower) ||
                    s.grade.toLowerCase().includes(queryLower)
                );
                renderPeriodDeleteStudentDropdown(filtered);
            };
        }
    } else {
        studentGroup.style.display = 'none';
        selectedPeriodDeleteStudents = [];
        const selectedList = document.getElementById('period-del-student-selected');
        if (selectedList) selectedList.innerHTML = '';
    }
    updatePeriodDeletePreview();
}

window.updatePeriodDeletePreview = function() {
    const previewEl = document.getElementById('period-del-preview');
    const warningEl = document.getElementById('period-del-warning');
    if (!previewEl) return;
    const startDate = document.getElementById('period-del-start')?.value;
    const endDate = document.getElementById('period-del-end')?.value;
    if (!startDate || !endDate || startDate > endDate) {
        previewEl.textContent = '삭제 예정 일정: 0건';
        if (warningEl) {
            warningEl.textContent = buildDeleteImpactText({
                scopeLabel: '전체 학생',
                startStr: startDate,
                endStr: endDate,
                totalCount: 0,
                monthSpan: getMonthSpanCount(startDate, endDate)
            });
            warningEl.classList.remove('danger');
        }
        return;
    }
    const scope = document.getElementById('period-del-scope')?.value || 'all';
    const targetStudentIds = scope === 'all'
        ? Object.keys(teacherScheduleData[currentTeacherId] || {})
        : [...selectedPeriodDeleteStudents];
    let total = 0;
    targetStudentIds.forEach((sid) => {
        total += countStudentSchedulesInRange(sid, startDate, endDate);
    });
    previewEl.textContent = `삭제 예정 일정: ${total}건`;
    if (warningEl) {
        warningEl.textContent = buildDeleteImpactText({
            scopeLabel: formatDeleteScopeLabel(scope, targetStudentIds.length),
            startStr: startDate,
            endStr: endDate,
            totalCount: total,
            monthSpan: getMonthSpanCount(startDate, endDate)
        });
        warningEl.classList.toggle('danger', total > 0);
    }
};

// 기간별 일정 삭제 실행
window.executePeriodDelete = async function() {
    if (!ensureOwnedScheduleDeleteContext('기간별 일정 삭제')) return;
    const scope = document.getElementById('period-del-scope').value;
    const startDate = document.getElementById('period-del-start').value;
    const endDate = document.getElementById('period-del-end').value;
    
    if (!startDate || !endDate) {
        showToast('삭제 기간을 입력해주세요.', 'warning');
        return;
    }
    
    if (startDate > endDate) {
        showToast('시작 날짜가 종료 날짜보다 늦습니다.', 'warning');
        return;
    }
    
    let targetStudentIds = [];
    let expectedCount = 0;
    let scopeLabel = '';
    const monthSpan = getMonthSpanCount(startDate, endDate);
    
    if (scope === 'all') {
        targetStudentIds = Object.keys(teacherScheduleData[currentTeacherId] || {});
        scopeLabel = formatDeleteScopeLabel(scope, targetStudentIds.length);
        targetStudentIds.forEach((sid) => {
            expectedCount += countStudentSchedulesInRange(sid, startDate, endDate);
        });
    } else {
        if (!selectedPeriodDeleteStudents.length) {
            showToast('학생을 선택해주세요.', 'warning');
            return;
        }
        targetStudentIds = [...selectedPeriodDeleteStudents];
        scopeLabel = formatDeleteScopeLabel(scope, targetStudentIds.length);
        targetStudentIds.forEach((sid) => {
            expectedCount += countStudentSchedulesInRange(sid, startDate, endDate);
        });
    }
    const confirmMessage = `${startDate} ~ ${endDate}${monthSpan > 1 ? ` (${monthSpan}개월)` : ''} 기간의 일정을 삭제하시겠습니까?\n\n- 범위: ${scopeLabel}\n- 삭제 예정: ${expectedCount}건\n- 대상: 내가 등록한 일정만\n\n삭제한 일정의 같은 시간 슬롯 출석기록도 함께 삭제됩니다.\n삭제 후 복구할 수 없습니다.`;
    if (!(await showConfirm(confirmMessage, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    
    let deletedCount = 0;
    let deletedAny = false;

    // 1. 데이터베이스에서 먼저 삭제 (병렬 처리)
    const deleteRequests = [];
    const attendanceDeleteTargets = [];

    if (scope === 'all' && typeof deleteSchedulesByTeacherRange === 'function') {
        deleteRequests.push(deleteSchedulesByTeacherRange(startDate, endDate, currentTeacherId));
        deletedAny = true;
    }

    for (const sid of targetStudentIds) {
        const student = students.find(s => String(s.id) === String(sid));
        const dbSlotTargets = await collectScheduleSlotsByRangeFromDb(sid, startDate, endDate, currentTeacherId);
        if (dbSlotTargets.length > 0) {
            attendanceDeleteTargets.push(...dbSlotTargets);
        }

        // 항상 DB 삭제 요청을 보냄 (로컬에 없어도 DB에 있을 수 있음)
        if (typeof deleteSchedulesByRange === 'function') {
            deleteRequests.push(deleteSchedulesByRange(sid, startDate, endDate, currentTeacherId));
            deletedAny = true;
        }
        // 로컬에서도 삭제 (있을 경우)
        if (teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][sid]) {
            const eventsToDelete = Object.keys(teacherScheduleData[currentTeacherId][sid]).filter(dateStr => {
                return !(dateStr < startDate || dateStr > endDate);
            });
            eventsToDelete.forEach(dateStr => {
                const entries = getScheduleEntries(currentTeacherId, String(sid), dateStr);
                if (entries.length > 0) {
                    entries.forEach((entry) => {
                        const st = normalizeScheduleTimeKey(entry?.start || '');
                        if (!st || st === 'default') return;
                        attendanceDeleteTargets.push({ studentId: sid, dateStr, teacherId: currentTeacherId, startTime: st });
                        if (student) {
                            removeTimeScopedValue(student.attendance, dateStr, st);
                            removeTimeScopedValue(student.records, dateStr, st);
                            removeTimeScopedValue(student.shared_records, dateStr, st);
                        }
                    });
                    setScheduleEntries(currentTeacherId, String(sid), dateStr, []);
                    deletedCount += entries.length;
                }
            });
        }
    }

    if (attendanceDeleteTargets.length > 0) {
        const uniqueTargets = Array.from(new Map(
            attendanceDeleteTargets.map((t) => [`${t.studentId}|${t.dateStr}|${t.teacherId}|${t.startTime}`, t])
        ).values());
        deleteRequests.push(
            Promise.allSettled(uniqueTargets.map((t) => deleteAttendanceRecordBySlotFromDb(t.studentId, t.dateStr, t.teacherId, t.startTime)))
        );
    }

    if (deletedCount > 0) {
        saveData();
        persistTeacherScheduleLocal();
        renderCalendar();
        showToast(`총 ${deletedCount}개의 일정이 삭제되었습니다.`, 'success');
    } else if (deletedAny) {
        saveData();
        persistTeacherScheduleLocal();
        renderCalendar();
        showToast('일정이 삭제되었습니다.', 'success');
    } else {
        showToast('삭제할 일정이 없습니다.', 'info');
    }

    closeModal('period-delete-modal');

    if (deleteRequests.length > 0) {
        Promise.allSettled(deleteRequests).then(async results => {
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length) {
                console.error('[executePeriodDelete] DB 삭제 실패:', failed);
                return;
            }
            await loadTeacherScheduleData(currentTeacherId);
            renderCalendar();
        });
    }
}

function getTestScoreStorageKey() {
    const ownerId = localStorage.getItem('current_owner_id') || 'local';
    return `${TEST_SCORE_STORAGE_PREFIX}${ownerId}`;
}

function loadAllTestScores() {
    try {
        const raw = localStorage.getItem(getTestScoreStorageKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('[loadAllTestScores] 파싱 실패:', error);
        return [];
    }
}

function saveAllTestScores(rows) {
    try {
        localStorage.setItem(getTestScoreStorageKey(), JSON.stringify(rows || []));
    } catch (error) {
        console.warn('[saveAllTestScores] 저장 실패:', error);
    }
}

function getMonthlyTestScores(studentId, monthPrefix) {
    return loadAllTestScores()
        .filter((row) => String(row.studentId) === String(studentId) && String(row.examDate || '').startsWith(monthPrefix))
        .sort((a, b) => String(a.examDate || '').localeCompare(String(b.examDate || '')));
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function upsertLocalTestScore(row) {
    const rows = loadAllTestScores();
    const idx = rows.findIndex((item) => String(item.id) === String(row.id));
    if (idx > -1) rows[idx] = { ...rows[idx], ...row };
    else rows.push(row);
    saveAllTestScores(rows);
}

function removeLocalTestScore(scoreId) {
    const filtered = loadAllTestScores().filter((row) => String(row.id) !== String(scoreId));
    saveAllTestScores(filtered);
}

function setTestScoreSyncState(mode, message) {
    testScoreSyncState = {
        mode: String(mode || 'unknown'),
        message: String(message || '상태 미확인')
    };
    renderTestScoreSyncStatus();
}

function renderTestScoreSyncStatus() {
    const el = document.getElementById('test-score-sync-status');
    if (!el) return;
    const mode = testScoreSyncState.mode || 'unknown';
    const cls = mode === 'remote' ? 'remote' : (mode === 'local' ? 'local' : 'unknown');
    el.className = `test-score-sync-status ${cls}`;
    el.textContent = testScoreSyncState.message || '상태 미확인';
}

async function getMonthlyTestScoresWithFallback(studentId, monthPrefix) {
    if (typeof window.getStudentTestScoresByMonth === 'function') {
        try {
            const remoteRows = await window.getStudentTestScoresByMonth(studentId, monthPrefix);
            if (Array.isArray(remoteRows)) {
                remoteRows.forEach(upsertLocalTestScore);
                setTestScoreSyncState('remote', `원격 동기화 정상 · ${remoteRows.length}건 조회`);
                return remoteRows;
            }
        } catch (error) {
            console.warn('[getMonthlyTestScoresWithFallback] 원격 조회 실패, 로컬 폴백:', error);
            setTestScoreSyncState('local', `원격 조회 실패 · 로컬 폴백 사용 (${error.message || 'unknown'})`);
        }
    }
    if (typeof window.getStudentTestScoresByMonth !== 'function') {
        setTestScoreSyncState('local', '원격 동기화 함수 미구성 · 로컬 저장 모드');
    }
    return getMonthlyTestScores(studentId, monthPrefix);
}

window.runTestScoreSyncCheck = async function() {
    const nameInput = document.getElementById('test-score-name');
    const monthPrefix = String(nameInput?.dataset?.monthPrefix || '');
    const studentId = String(nameInput?.dataset?.studentId || '');
    const checkBtn = document.getElementById('test-score-sync-check-btn');
    if (!studentId || !monthPrefix) {
        showToast('학생/월 정보가 없어 동기화 점검을 실행할 수 없습니다.', 'warning');
        return;
    }
    if (typeof window.saveStudentTestScore !== 'function' || typeof window.getStudentTestScoresByMonth !== 'function' || typeof window.deleteStudentTestScore !== 'function') {
        setTestScoreSyncState('local', '원격 점검 함수 없음 · 로컬 저장 모드');
        showToast('원격 동기화 점검 함수를 찾을 수 없습니다.', 'warning');
        return;
    }

    const now = new Date();
    const off = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - off).toISOString().split('T')[0];
    const examDate = todayStr.startsWith(monthPrefix) ? todayStr : `${monthPrefix}-01`;
    const stamp = now.toISOString().slice(11, 19);
    const probeRow = {
        studentId,
        teacherId: String(currentTeacherId || ''),
        examName: `[동기화진단] ${stamp}`,
        examDate,
        score: 0,
        maxScore: 100
    };

    try {
        if (checkBtn) {
            checkBtn.disabled = true;
            checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 점검 중...';
        }
        setTestScoreSyncState('unknown', '원격 동기화 점검 실행 중...');
        const saved = await window.saveStudentTestScore(probeRow);
        const rows = await window.getStudentTestScoresByMonth(studentId, monthPrefix);
        const found = (rows || []).some((row) => String(row.id) === String(saved?.id));
        if (!found) throw new Error('저장 후 조회에서 진단 레코드를 찾지 못했습니다.');
        await window.deleteStudentTestScore(saved.id);
        removeLocalTestScore(saved.id);
        setTestScoreSyncState('remote', `원격 동기화 점검 성공 · ${new Date().toLocaleTimeString('ko-KR')}`);
        showToast('테스트 점수 원격 동기화 점검이 성공했습니다.', 'success');
        await renderTestScoreSection(studentId, monthPrefix, `${monthPrefix.slice(0, 4)}년 ${monthPrefix.slice(5)}월`);
    } catch (error) {
        console.error('[runTestScoreSyncCheck] 동기화 점검 실패:', error);
        setTestScoreSyncState('local', `원격 점검 실패 · 로컬 폴백 권장 (${error.message || 'unknown'})`);
        showToast(`동기화 점검 실패: ${error.message}`, 'warning');
    } finally {
        if (checkBtn) {
            checkBtn.disabled = false;
            checkBtn.innerHTML = '<i class="fas fa-stethoscope"></i> 동기화 점검';
        }
    }
};

function buildTestScoreSummary(scores) {
    if (!scores.length) {
        return '<div class="test-score-empty">이번 달 저장된 테스트 점수가 없습니다.</div>';
    }
    const normalized = scores
        .map((item) => {
            const maxScore = Number(item.maxScore || 0);
            const score = Number(item.score || 0);
            const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
            return { ...item, score, maxScore, percent };
        })
        .filter((item) => Number.isFinite(item.percent));
    if (!normalized.length) {
        return '<div class="test-score-empty">점수 데이터를 계산할 수 없습니다.</div>';
    }
    const avgPercent = Math.round(normalized.reduce((sum, item) => sum + item.percent, 0) / normalized.length);
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const diff = last.percent - first.percent;
    const diffLabel = diff === 0 ? '변화 없음' : (diff > 0 ? `+${diff}%p` : `${diff}%p`);
    const trendClass = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
    return `
        <div class="test-score-summary-item">
            <span class="label">평균</span>
            <strong>${avgPercent}%</strong>
        </div>
        <div class="test-score-summary-item ${trendClass}">
            <span class="label">변화</span>
            <strong>${diffLabel}</strong>
        </div>
        <div class="test-score-summary-item">
            <span class="label">건수</span>
            <strong>${normalized.length}회</strong>
        </div>
    `;
}

function buildTestScoreTrendBars(scores) {
    if (!scores.length) return '';
    return scores.map((item) => {
        const maxScore = Number(item.maxScore || 0);
        const score = Number(item.score || 0);
        const percent = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
        const dayLabel = String(item.examDate || '').split('-').slice(1).join('/');
        const title = `${item.examName || '테스트'} ${score}/${maxScore} (${percent}%)`;
        return `
            <div class="test-trend-bar" title="${escapeHtml(title)}">
                <span class="test-trend-fill" style="height:${percent}%;"></span>
                <span class="test-trend-day">${escapeHtml(dayLabel || '-')}</span>
            </div>
        `;
    }).join('');
}

function buildTestScoreList(scores) {
    if (!scores.length) return '';
    return scores.map((item) => {
        const maxScore = Number(item.maxScore || 0);
        const score = Number(item.score || 0);
        const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
        return `
            <div class="test-score-item">
                <div class="test-score-item-main">
                    <div class="test-score-item-title">${escapeHtml(item.examName || '테스트')}</div>
                    <div class="test-score-item-meta">${escapeHtml(item.examDate || '-')} · ${score}/${maxScore} (${percent}%)</div>
                </div>
                <button type="button" class="test-score-delete-btn" onclick="deleteTestScoreFromHistory('${item.id}')">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
    }).join('');
}

async function renderTestScoreSection(studentId, monthPrefix, monthLabel, preloadedScores) {
    const monthEl = document.getElementById('test-score-month-label');
    const summaryEl = document.getElementById('test-score-summary');
    const trendEl = document.getElementById('test-score-trend');
    const listEl = document.getElementById('test-score-list');
    const dateInput = document.getElementById('test-score-date');
    const nameInput = document.getElementById('test-score-name');
    const valueInput = document.getElementById('test-score-value');
    const maxInput = document.getElementById('test-score-max');
    if (monthEl) monthEl.textContent = monthLabel;
    if (dateInput && !dateInput.value) {
        const today = new Date(); const off = today.getTimezoneOffset() * 60000;
        dateInput.value = new Date(today.getTime() - off).toISOString().split('T')[0];
    }
    if (maxInput && !maxInput.value) maxInput.value = '100';
    if (nameInput) {
        nameInput.dataset.studentId = String(studentId);
        nameInput.dataset.monthPrefix = monthPrefix;
    }
    if (valueInput) {
        valueInput.dataset.studentId = String(studentId);
        valueInput.dataset.monthPrefix = monthPrefix;
    }
    if (summaryEl && trendEl && listEl) {
        const scores = Array.isArray(preloadedScores) ? preloadedScores : await getMonthlyTestScoresWithFallback(studentId, monthPrefix);
        summaryEl.innerHTML = buildTestScoreSummary(scores);
        trendEl.innerHTML = scores.length ? buildTestScoreTrendBars(scores) : '';
        listEl.innerHTML = buildTestScoreList(scores);
        renderTestScoreSyncStatus();
    }
}

function toSafeNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

async function getHistoryHomeworkSummary(studentId, monthPrefix) {
    const empty = { scheduledCount: 0, submittedCount: 0, missingCount: 0 };
    try {
        if (!supabase || !studentId) return empty;
        const ownerId = localStorage.getItem('current_owner_id');
        const [year, month] = String(monthPrefix).split('-').map(Number);
        if (!year || !month) return empty;
        const lastDay = new Date(year, month, 0).getDate();
        const startDate = `${monthPrefix}-01`;
        const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

        let scheduleQuery = supabase
            .from('schedules')
            .select('schedule_date')
            .eq('student_id', parseInt(studentId, 10))
            .gte('schedule_date', startDate)
            .lte('schedule_date', endDate);
        if (ownerId) scheduleQuery = scheduleQuery.eq('owner_user_id', ownerId);
        const { data: schedules, error: scheduleErr } = await scheduleQuery;
        if (scheduleErr) throw scheduleErr;

        let submitQuery = supabase
            .from('homework_submissions')
            .select('submission_date, status')
            .eq('student_id', parseInt(studentId, 10))
            .gte('submission_date', startDate)
            .lte('submission_date', endDate);
        if (ownerId) submitQuery = submitQuery.eq('owner_user_id', ownerId);
        const { data: submissions, error: submitErr } = await submitQuery;
        if (submitErr) throw submitErr;

        const scheduledDates = new Set((schedules || []).map((row) => String(row.schedule_date || '')).filter(Boolean));
        const submittedDates = new Set(
            (submissions || [])
                .filter((row) => ['uploaded', 'manual'].includes(String(row.status || '').toLowerCase()))
                .map((row) => String(row.submission_date || ''))
                .filter(Boolean)
        );
        const submittedCount = submissions ? submissions.filter((row) => ['uploaded', 'manual'].includes(String(row.status || '').toLowerCase())).length : 0;
        const todayStr = getTodayStr();
        const missingCount = Array.from(scheduledDates).filter((date) => date <= todayStr && !submittedDates.has(date)).length;
        return {
            scheduledCount: scheduledDates.size,
            submittedCount,
            missingCount
        };
    } catch (error) {
        console.warn('[getHistoryHomeworkSummary] 조회 실패:', error);
        return empty;
    }
}

async function getHistoryPaymentSummary(student, studentId, monthPrefix) {
    const empty = { dueAmount: 0, paidAmount: 0, unpaidAmount: 0, rowCount: 0 };
    try {
        if (typeof window.getPaymentsByStudent === 'function') {
            const rows = await window.getPaymentsByStudent(studentId);
            const monthRows = (rows || []).filter((row) => String(row.payment_month || '') === String(monthPrefix));
            if (monthRows.length > 0) {
                const dueAmount = monthRows.reduce((sum, row) => sum + toSafeNumber(row.amount), 0);
                const paidAmount = monthRows.reduce((sum, row) => sum + toSafeNumber(row.paid_amount), 0);
                return {
                    dueAmount,
                    paidAmount,
                    unpaidAmount: Math.max(0, dueAmount - paidAmount),
                    rowCount: monthRows.length
                };
            }
        }
    } catch (error) {
        console.warn('[getHistoryPaymentSummary] 원격 조회 실패, 로컬 폴백:', error);
    }

    const monthData = student && student.payments ? student.payments[monthPrefix] : null;
    if (!monthData) return empty;
    const dueAmount = toSafeNumber(monthData.amount || monthData.dueAmount || 0);
    const paidAmount = toSafeNumber(monthData.paidAmount || 0);
    return {
        dueAmount,
        paidAmount,
        unpaidAmount: Math.max(0, dueAmount - paidAmount),
        rowCount: dueAmount > 0 || paidAmount > 0 ? 1 : 0
    };
}

function renderHistoryIntegratedOverview(payload) {
    const overviewEl = document.getElementById('hist-overview');
    if (!overviewEl) return;
    const attendanceHandled = (payload.attendance.present || 0) + (payload.attendance.late || 0) + (payload.attendance.makeup || 0);
    const attendanceTotal = payload.totalClassDays || 0;
    const attendanceRate = attendanceTotal > 0 ? Math.round((attendanceHandled / attendanceTotal) * 100) : 0;

    const homeworkScheduled = payload.homework.scheduledCount || 0;
    const homeworkSubmitted = payload.homework.submittedCount || 0;
    const homeworkMissing = payload.homework.missingCount || 0;

    const dueAmount = toSafeNumber(payload.payment.dueAmount);
    const paidAmount = toSafeNumber(payload.payment.paidAmount);
    const unpaidAmount = toSafeNumber(payload.payment.unpaidAmount);

    const scoreRows = payload.testScores || [];
    const scoreAvg = scoreRows.length
        ? Math.round(scoreRows.reduce((sum, row) => {
            const maxScore = toSafeNumber(row.maxScore);
            const score = toSafeNumber(row.score);
            return sum + (maxScore > 0 ? ((score / maxScore) * 100) : 0);
        }, 0) / scoreRows.length)
        : 0;

    overviewEl.innerHTML = `
        <div class="hist-overview-card attendance">
            <div class="title"><i class="fas fa-calendar-check"></i> 출석</div>
            <div class="value">${attendanceHandled}/${attendanceTotal}회</div>
            <div class="meta">처리율 ${attendanceRate}%</div>
            <div class="hist-overview-actions">
                <button type="button" class="hist-overview-action-btn" onclick="openHistoryAttendanceAction()"><i class="fas fa-clipboard-check"></i> 출석 처리</button>
            </div>
        </div>
        <div class="hist-overview-card homework">
            <div class="title"><i class="fas fa-book"></i> 숙제</div>
            <div class="value">${homeworkSubmitted}건 제출</div>
            <div class="meta">예정 ${homeworkScheduled}일 · 미제출 ${homeworkMissing}일</div>
            <div class="hist-overview-actions">
                <button type="button" class="hist-overview-action-btn" onclick="openHistoryHomeworkAction()"><i class="fas fa-pen"></i> 평가/메모 작성</button>
            </div>
        </div>
        <div class="hist-overview-card payment">
            <div class="title"><i class="fas fa-won-sign"></i> 수납</div>
            <div class="value">${Math.round(paidAmount).toLocaleString()}원</div>
            <div class="meta">청구 ${Math.round(dueAmount).toLocaleString()}원 · 미수 ${Math.round(unpaidAmount).toLocaleString()}원</div>
            <div class="hist-overview-actions">
                <button type="button" class="hist-overview-action-btn" onclick="openHistoryPaymentAction()"><i class="fas fa-file-invoice-dollar"></i> 수납 원장 열기</button>
            </div>
        </div>
        <div class="hist-overview-card score">
            <div class="title"><i class="fas fa-chart-line"></i> 테스트</div>
            <div class="value">${scoreRows.length ? `${scoreAvg}%` : '-'}</div>
            <div class="meta">응시 ${scoreRows.length}회</div>
            <div class="hist-overview-actions">
                <button type="button" class="hist-overview-action-btn" onclick="openHistoryScoreAction()"><i class="fas fa-square-poll-vertical"></i> 점수 입력</button>
            </div>
        </div>
    `;
}

window.openHistoryAttendanceAction = async function() {
    const sid = String(historyActionContext.studentId || '');
    const monthPrefix = String(historyActionContext.monthPrefix || '');
    if (!sid) return;

    const todayStr = getTodayStr();
    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    const studentSchedule = teacherSchedule[sid] || {};

    let targetDate = todayStr;
    let targetStart = null;

    const todayEntries = getScheduleEntries(currentTeacherId, sid, todayStr);
    if (todayEntries.length > 0) {
        targetStart = getEarliestScheduleEntry(todayEntries)?.start || null;
    } else {
        const monthDates = Object.keys(studentSchedule)
            .filter((d) => d.startsWith(monthPrefix))
            .sort((a, b) => a.localeCompare(b));
        if (monthDates.length > 0) {
            targetDate = monthDates[monthDates.length - 1];
            const entries = getScheduleEntries(currentTeacherId, sid, targetDate);
            targetStart = getEarliestScheduleEntry(entries)?.start || null;
        }
    }

    closeModal('history-modal');

    if (targetStart) {
        await openAttendanceModal(sid, targetDate, targetStart);
        return;
    }

    openModal('schedule-modal');
    setTimeout(() => {
        const dateInput = document.getElementById('sch-start-date');
        if (dateInput) dateInput.value = todayStr;
        selectedScheduleStudents = [sid];
        renderSelectedScheduleStudents();
        updateDurationByGrade();
    }, 40);
    showToast('먼저 일정을 등록한 뒤 출석 처리를 진행해주세요.', 'warning');
};

window.openHistoryHomeworkAction = function() {
    const evalBox = document.getElementById('eval-textarea-main');
    if (!evalBox) return;
    evalBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    evalBox.focus();
};

window.openHistoryPaymentAction = function() {
    const sid = String(historyActionContext.studentId || '');
    const monthPrefix = String(historyActionContext.monthPrefix || '');
    if (!sid) return;

    if (typeof window.openPaymentLedgerModal !== 'function') {
        showToast('수납 원장 기능을 찾을 수 없습니다.', 'warning');
        return;
    }

    closeModal('history-modal');
    setTimeout(() => {
        window.openPaymentLedgerModal(sid, monthPrefix);
    }, 40);
};

window.openHistoryScoreAction = function() {
    const section = document.getElementById('test-score-section');
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const nameInput = document.getElementById('test-score-name');
    if (nameInput) nameInput.focus();
};

window.saveTestScoreFromHistory = async function() {
    const nameInput = document.getElementById('test-score-name');
    const dateInput = document.getElementById('test-score-date');
    const valueInput = document.getElementById('test-score-value');
    const saveBtn = document.getElementById('test-score-save-btn');
    const maxInput = document.getElementById('test-score-max');
    if (!nameInput || !dateInput || !valueInput || !maxInput) return;

    const studentId = nameInput.dataset.studentId || valueInput.dataset.studentId;
    const monthPrefix = nameInput.dataset.monthPrefix || valueInput.dataset.monthPrefix;
    const teacherId = String(currentTeacherId || '');
    const examName = String(nameInput.value || '').trim();
    const examDate = String(dateInput.value || '').trim();
    const score = Number(valueInput.value || 0);
    const maxScore = Number(maxInput.value || 0);

    if (!studentId || !monthPrefix) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }
    if (!examName || !examDate) {
        showToast('시험명과 시험일을 입력해주세요.', 'warning');
        return;
    }
    if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) {
        showToast('점수/만점 값을 확인해주세요. (0 <= 점수 <= 만점)', 'warning');
        return;
    }
    if (!examDate.startsWith(monthPrefix)) {
        showToast('현재 월의 시험일만 저장할 수 있습니다.', 'warning');
        return;
    }

    const localRow = {
        id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        studentId: String(studentId),
        teacherId,
        examName,
        examDate,
        score,
        maxScore,
        createdAt: new Date().toISOString()
    };

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';
    }

    let savedRow = localRow;
    if (typeof window.saveStudentTestScore === 'function') {
        try {
            const remoteSaved = await window.saveStudentTestScore(localRow);
            if (remoteSaved && remoteSaved.id) savedRow = remoteSaved;
            setTestScoreSyncState('remote', `원격 저장 성공 · ${new Date().toLocaleTimeString('ko-KR')}`);
        } catch (error) {
            console.warn('[saveTestScoreFromHistory] 원격 저장 실패, 로컬 폴백:', error);
            setTestScoreSyncState('local', `원격 저장 실패 · 로컬 저장 (${error.message || 'unknown'})`);
        }
    } else {
        setTestScoreSyncState('local', '원격 저장 함수 미구성 · 로컬 저장');
    }
    upsertLocalTestScore(savedRow);
    valueInput.value = '';
    if (!nameInput.value) nameInput.focus();
    await renderTestScoreSection(studentId, monthPrefix, `${monthPrefix.slice(0, 4)}년 ${monthPrefix.slice(5)}월`);

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-plus"></i> 점수 저장';
    }
    showToast(savedRow.id === localRow.id ? '테스트 점수가 저장되었습니다. (로컬 저장)' : '테스트 점수가 저장되었습니다.', 'success');
};

window.deleteTestScoreFromHistory = async function(scoreId) {
    const nameInput = document.getElementById('test-score-name');
    const valueInput = document.getElementById('test-score-value');
    const studentId = (nameInput && nameInput.dataset.studentId) || (valueInput && valueInput.dataset.studentId);
    const monthPrefix = (nameInput && nameInput.dataset.monthPrefix) || (valueInput && valueInput.dataset.monthPrefix);
    if (!studentId || !monthPrefix || !scoreId) return;
    if (isUuidLike(scoreId) && typeof window.deleteStudentTestScore === 'function') {
        try {
            await window.deleteStudentTestScore(scoreId);
            setTestScoreSyncState('remote', `원격 삭제 성공 · ${new Date().toLocaleTimeString('ko-KR')}`);
        } catch (error) {
            console.warn('[deleteTestScoreFromHistory] 원격 삭제 실패, 로컬만 삭제:', error);
            setTestScoreSyncState('local', `원격 삭제 실패 · 로컬 삭제 (${error.message || 'unknown'})`);
        }
    }
    removeLocalTestScore(scoreId);
    await renderTestScoreSection(studentId, monthPrefix, `${monthPrefix.slice(0, 4)}년 ${monthPrefix.slice(5)}월`);
    showToast('테스트 점수가 삭제되었습니다.', 'info');
};

window.openHistoryModal = async function() {
    const sid = document.getElementById('att-student-id').value;
    const s = students.find(x => String(x.id) === String(sid));
    if(!s) return;
    const curYear = currentDate.getFullYear();
    const curMonth = currentDate.getMonth() + 1;
    document.getElementById('history-modal').style.display = 'flex';
    document.getElementById('hist-title').textContent = `${s.name} (${s.grade})${s.school ? ' · ' + s.school : ''}`;
    document.getElementById('hist-subtitle').textContent = `${curYear}년 ${curMonth}월 학습 기록`;
    const container = document.getElementById('history-timeline');
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--gray);">로딩 중...</div>';
    const statsEl = document.getElementById('hist-stats');
    const overviewEl = document.getElementById('hist-overview');
    if (overviewEl) {
        overviewEl.innerHTML = '<div class="hist-overview-loading"><i class="fas fa-spinner fa-spin"></i> 통합 요약 불러오는 중...</div>';
    }
    const monthPrefix = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    historyActionContext = { studentId: String(sid), monthPrefix };

    // DB에서 해당 학생의 이번 달 전체 출석 레코드를 조회 (메모 + 공유 메모 모두)
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        if (ownerId) {
            const numericId = parseInt(sid);
            const startDate = `${monthPrefix}-01`;
            // 해당 월의 마지막 날짜를 정확히 계산 (2월 31일 같은 잘못된 날짜 방지)
            const lastDay = new Date(curYear, curMonth, 0).getDate();
            const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

            // 1) 공유 메모: teacher_id 무관하게 전체 조회
            const { data: allRecords, error: allErr } = await supabase
                .from('attendance_records')
                .select('attendance_date, scheduled_time, teacher_id, memo, shared_memo, status')
                .eq('owner_user_id', ownerId)
                .eq('student_id', numericId)
                .gte('attendance_date', startDate)
                .lte('attendance_date', endDate);

            if (!allErr && allRecords && allRecords.length > 0) {
                if (!s.shared_records) s.shared_records = {};
                if (!s.records) s.records = {};

                // 선생님 이름 매핑
                const teacherNames = {};
                if (typeof teacherList !== 'undefined' && teacherList) {
                    teacherList.forEach(t => { teacherNames[String(t.id)] = t.name; });
                }

                allRecords.forEach(rec => {
                    const dk = rec.attendance_date;
                    const tk = normalizeScheduleTimeKey(rec.scheduled_time);
                    const sharedKey = `${tk}__${rec.teacher_id || 'unknown'}`;

                    // 공유 메모 (선생님 이름 태그 포함)
                    if (rec.shared_memo && rec.shared_memo.trim()) {
                        if (!s.shared_records[dk] || typeof s.shared_records[dk] !== 'object') {
                            s.shared_records[dk] = {};
                        }
                        const tName = teacherNames[String(rec.teacher_id)] || '알 수 없음';
                        s.shared_records[dk][sharedKey] = `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-bottom:3px;">${tName}</span><div>${rec.shared_memo}</div>`;
                    }

                    // 개인 메모 (현재 선생님의 것만)
                    if (rec.memo && rec.memo.trim() && String(rec.teacher_id) === String(currentTeacherId)) {
                        if (!s.records[dk] || typeof s.records[dk] !== 'object') {
                            s.records[dk] = {};
                        }
                        s.records[dk][tk] = rec.memo;
                    }

                    // 출석 상태도 동기화 (누락 방지)
                    if (rec.status) {
                        if (!s.attendance) s.attendance = {};
                        if (!s.attendance[dk] || typeof s.attendance[dk] !== 'object') {
                            s.attendance[dk] = {};
                        }
                        // 현재 선생님 레코드이거나, 아직 상태 없으면 반영
                        if (String(rec.teacher_id) === String(currentTeacherId) || !s.attendance[dk][tk]) {
                            s.attendance[dk][tk] = rec.status;
                        }
                    }
                });
            }
        }
    } catch (e) {
        console.error('[openHistoryModal] DB 메모 조회 실패:', e);
    }

    container.innerHTML = '';

    const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
    const studentSchedule = teacherSchedule[sid] || {};
    const scheduleDates = Object.keys(studentSchedule);

    const allDates = new Set([...scheduleDates]);
    if(s.attendance) Object.keys(s.attendance).forEach(d => allDates.add(d));
    if(s.records) Object.keys(s.records).forEach(d => allDates.add(d));
    if(s.shared_records) Object.keys(s.shared_records).forEach(d => allDates.add(d));
    const monthlyEvents = Array.from(allDates).filter(date => date.startsWith(monthPrefix)).sort();

    // 통계 계산
    const stats = { present: 0, late: 0, absent: 0, makeup: 0 };
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    // Helper: 날짜에서 출석 상태 가져오기
    function getStatusForDate(date) {
        if (!s.attendance || !s.attendance[date]) return 'none';
        if (typeof s.attendance[date] === 'object') {
            const rawEntry = studentSchedule[date] || null;
            const scheduleEntry = Array.isArray(rawEntry) ? rawEntry[0] : rawEntry;
            const startTime = scheduleEntry?.start || null;
            if (startTime && s.attendance[date][startTime]) return s.attendance[date][startTime];
            const vals = Object.values(s.attendance[date]);
            return vals.length > 0 ? vals[0] : 'none';
        }
        return s.attendance[date];
    }

    // Helper: 메모 가져오기 (해당 날짜의 모든 메모를 합쳐서 반환, 중복 제거)
    function getMemo(recordObj, date) {
        if (!recordObj || !recordObj[date]) return '';
        if (typeof recordObj[date] === 'object') {
            const entries = Object.values(recordObj[date]);
            const seen = new Set();
            const memos = [];
            entries.forEach(v => {
                if (v && String(v).trim()) {
                    const trimmed = String(v).trim();
                    if (!seen.has(trimmed)) {
                        seen.add(trimmed);
                        memos.push(v);
                    }
                }
            });
            if (memos.length === 0) return '';
            if (memos.length === 1) return memos[0];
            return memos.join('<hr style="margin:4px 0; border:none; border-top:1px dashed #e2e8f0;">');
        }
        return recordObj[date];
    }

    const statusMap = {
        present: '출석', late: '지각', absent: '결석',
        makeup: '보강', etc: '보강', none: '미처리'
    };

    let html = '';
    monthlyEvents.forEach(date => {
        const status = getStatusForDate(date);
        if (stats[status] !== undefined) stats[status]++;
        else if (status === 'etc') stats.makeup++;

        const isScheduled = studentSchedule && studentSchedule[date];
        const privateMemo = getMemo(s.records, date);
        const sharedMemo = getMemo(s.shared_records, date);
        const dayNum = parseInt(date.split('-')[2]);
        const dow = dayNames[new Date(date).getDay()];
        const badgeClass = (status === 'etc') ? 'makeup' : (status || 'none');
        const badgeText = statusMap[status] || '미처리';

        let memosHtml = '';
        if (privateMemo || sharedMemo) {
            memosHtml = '<div class="hist-day-memos">';
            if (privateMemo) {
                memosHtml += `<div class="hist-memo-block"><div class="hist-memo-label"><i class="fas fa-lock"></i> 개인 메모</div><div>${privateMemo}</div></div>`;
            }
            if (sharedMemo) {
                memosHtml += `<div class="hist-memo-block"><div class="hist-memo-label shared"><i class="fas fa-users"></i> 공유 메모</div><div>${sharedMemo}</div></div>`;
            }
            memosHtml += '</div>';
        } else {
            memosHtml = '<div class="hist-memo-empty">기록 없음</div>';
        }

        html += `<div class="hist-day-card">
            <div class="hist-day-header">
                <span class="hist-day-date">${dayNum}일</span>
                <span class="hist-day-dow">${dow}요일</span>
                ${!isScheduled ? '<span class="hist-day-deleted">(일정 삭제됨)</span>' : ''}
                <span class="hist-day-badge ${badgeClass}">${badgeText}</span>
            </div>
            ${memosHtml}
        </div>`;
    });

    if (monthlyEvents.length === 0) {
        container.innerHTML = '<div class="hist-list-empty"><i class="fas fa-inbox" style="font-size:28px;margin-bottom:10px;display:block;color:#cbd5e1;"></i>이번 달 수업/기록이 없습니다.</div>';
    } else {
        container.innerHTML = html;
    }

    // 통계 렌더링
    statsEl.innerHTML = `
        <div class="hist-stat-item present"><div class="hist-stat-num">${stats.present}</div><div class="hist-stat-label">출석</div></div>
        <div class="hist-stat-item late"><div class="hist-stat-num">${stats.late}</div><div class="hist-stat-label">지각</div></div>
        <div class="hist-stat-item absent"><div class="hist-stat-num">${stats.absent}</div><div class="hist-stat-label">결석</div></div>
        <div class="hist-stat-item makeup"><div class="hist-stat-num">${stats.makeup}</div><div class="hist-stat-label">보강</div></div>
    `;

    const [homeworkSummary, paymentSummary, testScores] = await Promise.all([
        getHistoryHomeworkSummary(sid, monthPrefix),
        getHistoryPaymentSummary(s, sid, monthPrefix),
        getMonthlyTestScoresWithFallback(sid, monthPrefix)
    ]);
    renderHistoryIntegratedOverview({
        attendance: stats,
        totalClassDays: monthlyEvents.length,
        homework: homeworkSummary,
        payment: paymentSummary,
        testScores
    });

    // ★ 종합평가 로드
    const evalMonthLabel = document.getElementById('eval-current-month');
    const evalTextarea = document.getElementById('eval-textarea-main');
    const evalCharCount = document.getElementById('eval-char-main');
    const evalSaveBtn = document.getElementById('eval-save-btn');
    if (evalMonthLabel) evalMonthLabel.textContent = `${curYear}년 ${curMonth}월`;
    if (evalTextarea) {
        evalTextarea.value = '';
        evalTextarea.dataset.studentId = sid;
        evalTextarea.dataset.evalMonth = monthPrefix;
        // 글자수 카운터 이벤트
        evalTextarea.oninput = function() {
            if (evalCharCount) evalCharCount.textContent = this.value.length;
        };
    }
    if (evalCharCount) evalCharCount.textContent = '0';
    if (evalSaveBtn) {
        evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
        evalSaveBtn.classList.remove('saved');
    }

    // DB에서 기존 종합평가 불러오기
    try {
        if (typeof window.getStudentEvaluation === 'function') {
            const evalData = await window.getStudentEvaluation(sid, monthPrefix);
            if (evalData && evalData.comment && evalTextarea) {
                evalTextarea.value = evalData.comment;
                if (evalCharCount) evalCharCount.textContent = evalData.comment.length;
            }
        }
    } catch (e) {
        console.error('[openHistoryModal] 종합평가 로드 실패:', e);
    }

    await renderTestScoreSection(sid, monthPrefix, `${curYear}년 ${curMonth}월`, testScores);
}
// ★ 종합평가 저장
window.saveEvalFromHistory = async function() {
    const evalTextarea = document.getElementById('eval-textarea-main');
    const evalSaveBtn = document.getElementById('eval-save-btn');
    if (!evalTextarea) return;

    const studentId = evalTextarea.dataset.studentId;
    const evalMonth = evalTextarea.dataset.evalMonth;
    const comment = evalTextarea.value.trim();

    if (!studentId || !evalMonth) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    // 저장 중 상태
    if (evalSaveBtn) {
        evalSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';
        evalSaveBtn.disabled = true;
    }

    try {
        await window.saveStudentEvaluation(studentId, evalMonth, comment, currentTeacherId);

        if (evalSaveBtn) {
            evalSaveBtn.innerHTML = '<i class="fas fa-check"></i> 저장 완료';
            evalSaveBtn.classList.add('saved');
            evalSaveBtn.disabled = false;
            setTimeout(() => {
                evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
                evalSaveBtn.classList.remove('saved');
            }, 2000);
        }
        showToast('종합평가가 저장되었습니다.', 'success');
    } catch (e) {
        console.error('[saveEvalFromHistory] 종합평가 저장 실패:', e);
        if (evalSaveBtn) {
            evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
            evalSaveBtn.disabled = false;
        }
        showToast('종합평가 저장에 실패했습니다.', 'error');
    }
}

window.openDaySettings = function(dateStr) {
    document.getElementById('day-settings-modal').style.display = 'flex';
    document.getElementById('day-settings-title').textContent = `${dateStr} 설정`;
    document.getElementById('setting-date-str').value = dateStr;
    const info = getHolidayInfo(dateStr);

    // 삭제 버튼 표시/숨김
    const deleteBtn = document.getElementById('schedule-delete-btn');
    
    if (info) {
        document.getElementById('schedule-name').value = info.name || '';
        document.getElementById('schedule-type').value = info.scheduleType || 'academy';
        if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    } else {
        document.getElementById('schedule-name').value = '';
        document.getElementById('schedule-type').value = 'academy';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }

    // 기간 설정 기본값
    document.getElementById('schedule-start-date').value = dateStr;
    document.getElementById('schedule-end-date').value = dateStr;

    // hidden 호환 필드 동기화
    document.getElementById('is-red-day').value = info ? 'true' : '';
    document.getElementById('day-name').value = (info && info.name) || '';
    
    setHolidayColor((info && info.color) || '#ef4444');
    
    // 모달이 열릴 때마다 색상 칩 이벤트 다시 설정
    setTimeout(() => setupHolidayColorChips(), 0);
}
window.saveDaySettings = async function() {
    const dateStr = document.getElementById('setting-date-str').value;
    const scheduleName = (document.getElementById('schedule-name')?.value || '').trim();
    const isSchedule = !!scheduleName;
    const color = document.getElementById('holiday-color') ? document.getElementById('holiday-color').value : '#ef4444';

    if (isSchedule) {
        const name = scheduleName;
        const scheduleType = document.getElementById('schedule-type')?.value || 'academy';
        const startDate = document.getElementById('schedule-start-date')?.value || dateStr;
        const endDate = document.getElementById('schedule-end-date')?.value || dateStr;

        if (!name) { showToast("스케줄 이름을 입력해주세요.", 'warning'); return; }
        if (startDate > endDate) { showToast("종료일이 시작일보다 빠릅니다.", 'warning'); return; }

        // 학원 전체 일정 vs 개인 스케줄 확인
        const typeLabel = scheduleType === 'academy' ? '학원 전체 일정' : '개인 스케줄';
        if (!(await showConfirm(`"${name}"을(를) ${typeLabel}로 등록합니다.\n\n기간: ${startDate} ~ ${endDate}\n\n계속하시겠습니까?`, { type: 'question' }))) return;

        // 기간 내 모든 날짜에 등록
        const start = new Date(startDate);
        const end = new Date(endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const ds = d.toISOString().split('T')[0];
            customHolidays[ds] = { name, color, scheduleType };

            // 수파베이스에도 저장
            if (typeof saveHolidayToDatabase === 'function') {
                try {
                    await saveHolidayToDatabase({
                        teacherId: scheduleType === 'academy' ? 'academy' : currentTeacherId,
                        date: ds,
                        name: name,
                        color: color
                    });
                } catch (dbError) {
                    console.error('스케줄 DB 저장 실패:', ds, dbError);
                }
            }
        }
        console.log(`스케줄 등록 완료: ${name} (${startDate} ~ ${endDate}, ${typeLabel})`);
    } else {
        // 스케줄 해제 (현재 날짜만)
        const existingSchedule = customHolidays[dateStr];
        const deleteTeacherId = (existingSchedule && existingSchedule.scheduleType === 'academy') ? 'academy' : (currentTeacherId || 'no-teacher');
        delete customHolidays[dateStr];
        
        // 수파베이스에서도 삭제
        if (typeof deleteHolidayFromDatabase === 'function') {
            try {
                await deleteHolidayFromDatabase(deleteTeacherId, dateStr);
                console.log(`스케줄 DB 삭제: ${dateStr} (teacher_id: ${deleteTeacherId})`);
            } catch (dbError) {
                console.error('스케줄 DB 삭제 실패:', dbError);
            }
        }
    }

    // 로컬 저장 (선생님별)
    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));
    console.log(`스케줄 로컬 저장 (${currentTeacherId}): ${dateStr}`);
    closeModal('day-settings-modal'); renderCalendar();
}

// 스케줄 삭제 (모달에서 삭제 버튼 클릭 시)
window.deleteScheduleFromModal = async function() {
    const dateStr = document.getElementById('setting-date-str').value;
    if (!dateStr) return;

    const info = customHolidays[dateStr];
    if (!info) {
        showToast('삭제할 스케줄이 없습니다.', 'info');
        closeModal('day-settings-modal');
        return;
    }

    const scheduleName = info.name || '스케줄';
    const typeLabel = info.scheduleType === 'academy' ? '학원 전체 일정' : '개인 스케줄';

    // 같은 이름의 스케줄이 여러 날짜에 걸쳐 있는지 확인
    const sameName = Object.keys(customHolidays).filter(d => 
        customHolidays[d].name === info.name && customHolidays[d].scheduleType === info.scheduleType
    );

    let deleteAll = false;
    if (sameName.length > 1) {
        const choice = await showConfirm(
            `"${scheduleName}" (${typeLabel})\n\n` +
            `이 스케줄은 ${sameName.length}일에 걸쳐 등록되어 있습니다.\n\n` +
            `[확인] = 전체 기간 삭제 (${sameName.length}일)\n` +
            `[취소] = 이 날짜만 삭제 (${dateStr})`,
            { type: 'danger', title: '삭제 확인', okText: '삭제' }
        );
        deleteAll = choice;
    } else {
        if (!(await showConfirm(`"${scheduleName}" (${typeLabel})을 삭제하시겠습니까?`, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    }

    const datesToDelete = deleteAll ? sameName : [dateStr];
    const deleteTeacherId = info.scheduleType === 'academy' ? 'academy' : (currentTeacherId || 'no-teacher');

    for (const ds of datesToDelete) {
        delete customHolidays[ds];

        if (typeof deleteHolidayFromDatabase === 'function') {
            try {
                await deleteHolidayFromDatabase(deleteTeacherId, ds);
            } catch (dbError) {
                console.error('스케줄 DB 삭제 실패:', ds, dbError);
            }
        }
    }

    // 로컬 저장
    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));

    console.log(`스케줄 삭제 완료: ${scheduleName} (${datesToDelete.length}일)`);
    closeModal('day-settings-modal');
    renderCalendar();
    showToast(`"${scheduleName}" 스케줄이 삭제되었습니다. (${datesToDelete.length}일)`, 'success');
}

async function loadAndCleanData() {
    try {
        console.log('[loadAndCleanData] Supabase에서 학생 데이터 로드 중...');
        
        // Supabase에서 모든 학생 조회
        const supabaseStudents = await getAllStudents();
        console.log('[loadAndCleanData] Supabase 학생 수:', supabaseStudents.length);
        
        if (supabaseStudents && supabaseStudents.length > 0) {
            // Supabase 데이터를 앱 형식으로 변환
            students = supabaseStudents.map(s => {
                const metaFromMemo = parseStudentMetaFromMemo(s.memo || '');
                return ({
                id: s.id,
                name: s.name,
                school: s.school || '',
                grade: s.grade,
                studentPhone: s.phone || '',
                parentPhone: s.parent_phone || '',
                guardianName: s.guardian_name || metaFromMemo.guardianName || '',
                enrollmentStartDate: s.enrollment_start_date || metaFromMemo.enrollmentStartDate || (s.register_date || ''),
                enrollmentEndDate: s.enrollment_end_date || metaFromMemo.enrollmentEndDate || '',
                defaultFee: s.default_fee || 0,
                specialLectureFee: s.special_lecture_fee || 0,
                defaultTextbookFee: s.default_textbook_fee || 0,
                memo: stripStudentMetaFromMemo(s.memo || ''),
                registerDate: s.register_date || '',
                parentCode: s.parent_code || '',
                studentCode: s.student_code || '',
                status: s.status || 'active',
                statusChangedDate: s.status_changed_date || null,
                events: [],
                attendance: {},
                records: {},
                shared_records: {},
                payments: {}
            });
            });
            // 로컬 스토리지에도 백업 저장
            const ownerKey = `academy_students__${cachedLsGet('current_owner_id') || 'no-owner'}`;
            localStorage.setItem(ownerKey, JSON.stringify(students));
            console.log(`[loadAndCleanData] Supabase에서 학생 데이터 로드 완료: ${students.length}명`);
        } else {
            // Supabase에 학생이 없으면 students를 빈 배열로 강제 (로컬 fallback 금지)
            students = [];
            const ownerKey = `academy_students__${cachedLsGet('current_owner_id') || 'no-owner'}`;
            localStorage.setItem(ownerKey, JSON.stringify([]));
            console.log(`[loadAndCleanData] Supabase에 학생 없음. students를 빈 배열로 초기화.`);
        }
    } catch (error) {
        console.error('[loadAndCleanData] 학생 데이터 로드 실패:', error);
        students = [];
    }

    try {
        // 출석 기록: 소유자 기준 전체 레코드를 로드해 학생에 반영 (모든 선생님 공통)
        // ★ 시간별 객체 형태로 저장: student.attendance[date][scheduled_time] = status
        const studentById = new Map((students || []).map((s) => [String(s.id), s]));
        if (typeof getAttendanceRecordsByOwner === 'function') {
            const records = await getAttendanceRecordsByOwner(null);
            if (records && records.length > 0 && students.length > 0) {
                // scheduled_time까지 포함한 키로 중복 제거
                const recordMap = new Map();
                const statusPriority = {
                    present: 5,
                    late: 4,
                    makeup: 3,
                    etc: 3,
                    absent: 2,
                    none: 1
                };
                const pickPriority = (value) => statusPriority[String(value || '').toLowerCase()] || 0;
                records.forEach(r => {
                    const timeKey = normalizeScheduleTimeKey(r.scheduled_time);
                    const key = `${r.student_id}__${r.attendance_date}__${timeKey}`;
                    const timeVal = r.qr_scan_time || r.check_in_time || r.updated_at || r.created_at || null;
                    if (!recordMap.has(key)) {
                        recordMap.set(key, { record: r, time: timeVal });
                    } else {
                        const existing = recordMap.get(key);
                        const existingPriority = pickPriority(existing?.record?.status);
                        const currentPriority = pickPriority(r?.status);
                        if (currentPriority > existingPriority) {
                            recordMap.set(key, { record: r, time: timeVal });
                            return;
                        }
                        if (currentPriority === existingPriority) {
                            const existingTime = existing.time ? new Date(existing.time).getTime() : 0;
                            const currentTime = timeVal ? new Date(timeVal).getTime() : 0;
                            if (currentTime >= existingTime) {
                                recordMap.set(key, { record: r, time: timeVal });
                            }
                        }
                    }
                });

                recordMap.forEach(({ record, time }) => {
                    const student = studentById.get(String(record.student_id));
                    if (!student) return;
                    if (!student.attendance) student.attendance = {};
                    
                    // ★ 시간별 객체로 저장 (기존 flat string → object 마이그레이션)
                    const dateKey = record.attendance_date;
                    const scheduledTimeKey = normalizeScheduleTimeKey(record.scheduled_time);
                    if (typeof student.attendance[dateKey] === 'string') {
                        const prev = student.attendance[dateKey];
                        student.attendance[dateKey] = {};
                        student.attendance[dateKey]['default'] = prev;
                    }
                    if (!student.attendance[dateKey] || typeof student.attendance[dateKey] !== 'object') {
                        student.attendance[dateKey] = {};
                    }
                    student.attendance[dateKey][scheduledTimeKey] = record.status;

                    // 개인 메모 동기화 (DB → 로컬 records)
                    if (record.memo) {
                        if (!student.records) student.records = {};
                        if (typeof student.records[dateKey] === 'string') {
                            const prev = student.records[dateKey];
                            student.records[dateKey] = {};
                            student.records[dateKey]['default'] = prev;
                        }
                        if (!student.records[dateKey] || typeof student.records[dateKey] !== 'object') {
                            student.records[dateKey] = {};
                        }
                        student.records[dateKey][scheduledTimeKey] = record.memo;
                    }

                    // 공유 메모 동기화 (DB → 로컬 shared_records)
                    if (record.shared_memo) {
                        if (!student.shared_records) student.shared_records = {};
                        if (typeof student.shared_records[dateKey] === 'string') {
                            const prev = student.shared_records[dateKey];
                            student.shared_records[dateKey] = {};
                            student.shared_records[dateKey]['default'] = prev;
                        }
                        if (!student.shared_records[dateKey] || typeof student.shared_records[dateKey] !== 'object') {
                            student.shared_records[dateKey] = {};
                        }
                        student.shared_records[dateKey][scheduledTimeKey] = record.shared_memo;
                    }

                    // QR 스캔 시간 동기화 (상세기록 표시용)
                    if (!student.qr_scan_time) student.qr_scan_time = {};
                    if (time) {
                        const timeStr = new Date(time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                        student.qr_scan_time[record.attendance_date] = timeStr;
                    }

                    // 변경 사유 동기화 (있을 때만)
                    if (record.change_reason) {
                        if (!student.changeReasons) student.changeReasons = {};
                        student.changeReasons[record.attendance_date] = {
                            originalStatus: record.original_status || null,
                            newStatus: record.status,
                            reason: record.change_reason,
                            changedAt: record.changed_at || null
                        };
                    }
                });

                console.log(`[loadAndCleanData] 출석 기록 동기화 완료: ${recordMap.size}건`);
            }
        }

        // ★ 공유 메모 별도 조회: teacher_id 무관하게 모든 공유 메모를 가져와서 students에 반영
        const ownerId = cachedLsGet('current_owner_id');
        if (ownerId && students.length > 0) {
            try {
                const { data: sharedData, error: sharedErr } = await supabase
                    .from('attendance_records')
                    .select('student_id, attendance_date, scheduled_time, teacher_id, shared_memo')
                    .eq('owner_user_id', ownerId)
                    .not('shared_memo', 'is', null);

                if (!sharedErr && sharedData && sharedData.length > 0) {
                    sharedData.forEach(rec => {
                        if (!rec.shared_memo || !rec.shared_memo.trim()) return;
                        const student = studentById.get(String(rec.student_id));
                        if (!student) return;
                        if (!student.shared_records) student.shared_records = {};
                        const dk = rec.attendance_date;
                        const tk = `${rec.scheduled_time || 'default'}__${rec.teacher_id || 'unknown'}`;
                        if (!student.shared_records[dk] || typeof student.shared_records[dk] !== 'object') {
                            student.shared_records[dk] = {};
                        }
                        student.shared_records[dk][tk] = rec.shared_memo;
                    });
                    console.log(`[loadAndCleanData] 공유 메모 동기화 완료: ${sharedData.length}건`);
                }
            } catch (sharedErr) {
                console.error('[loadAndCleanData] 공유 메모 동기화 실패:', sharedErr);
            }
        }

        // localStorage에 최종 데이터 저장
        const ownerKey = `academy_students__${cachedLsGet('current_owner_id') || 'no-owner'}`;
        localStorage.setItem(ownerKey, JSON.stringify(students));
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
                        color: h.color || '#ef4444',
                        scheduleType: h.scheduleType || 'personal'
                    };
                });
                console.log(`스케줄 DB 로드 (${currentTeacherId}): ${dbHolidays.length}개 (학원전체 + 개인)`);
                
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

// 출석 기록 보강 로드 (날짜별)
const attendanceLoadedDates = new Set();
async function ensureAttendanceForDate(dateStr) {
    if (!dateStr || attendanceLoadedDates.has(dateStr)) return;

    try {
        // owner_user_id 보장
        let ownerId = cachedLsGet('current_owner_id');
        if (!ownerId && typeof supabase !== 'undefined' && supabase?.auth?.getSession) {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error) console.error('[ensureAttendanceForDate] 세션 확인 에러:', error);
            if (session?.user?.id) {
                ownerId = session.user.id;
                cachedLsSet('current_owner_id', ownerId);
            }
        }

        if (typeof getAttendanceRecordsByDate !== 'function') {
            attendanceLoadedDates.add(dateStr);
            return;
        }

        const records = await getAttendanceRecordsByDate(dateStr, { includeAllTeachers: true });
        if (records && records.length > 0 && Array.isArray(students)) {
            const statusPriority = { present: 5, late: 4, makeup: 3, etc: 3, absent: 2, none: 1 };
            const pickPriority = (value) => statusPriority[String(value || '').toLowerCase()] || 0;
            const mergedMap = new Map();

            records.forEach((row) => {
                const slotKey = `${String(row?.student_id || '')}__${String(row?.attendance_date || '')}__${normalizeScheduleTimeKey(row?.scheduled_time)}`;
                const current = mergedMap.get(slotKey);
                if (!current) {
                    mergedMap.set(slotKey, row);
                    return;
                }
                const currentPriority = pickPriority(current?.status);
                const nextPriority = pickPriority(row?.status);
                if (nextPriority > currentPriority) {
                    mergedMap.set(slotKey, row);
                    return;
                }
                if (nextPriority === currentPriority) {
                    const currentTime = new Date(current?.processed_at || current?.check_in_time || current?.created_at || 0).getTime();
                    const nextTime = new Date(row?.processed_at || row?.check_in_time || row?.created_at || 0).getTime();
                    if (nextTime >= currentTime) {
                        mergedMap.set(slotKey, row);
                    }
                }
            });

            Array.from(mergedMap.values()).forEach(r => {
                const student = students.find(s => String(s.id) === String(r.student_id));
                if (!student) return;
                if (!student.attendance) student.attendance = {};
                // ★ 시간별 객체로 저장 (flat string → object 마이그레이션)
                const dateKey = r.attendance_date;
                const scheduledTimeKey = normalizeScheduleTimeKey(r.scheduled_time);
                if (typeof student.attendance[dateKey] === 'string') {
                    const prev = student.attendance[dateKey];
                    student.attendance[dateKey] = {};
                    student.attendance[dateKey]['default'] = prev;
                }
                if (!student.attendance[dateKey] || typeof student.attendance[dateKey] !== 'object') {
                    student.attendance[dateKey] = {};
                }
                student.attendance[dateKey][scheduledTimeKey] = r.status;
            });
        }
    } catch (e) {
        console.error('[ensureAttendanceForDate] 에러:', e);
    } finally {
        attendanceLoadedDates.add(dateStr);
    }
}

// 선생님별 일정 데이터 로드
async function loadTeacherScheduleData(teacherId) {
    try {
        const normalizedTeacherId = String(resolveKnownTeacherId(teacherId) || teacherId || '').trim();
        const appendScheduleEntry = (ownerTid, schedule) => {
            const sid = String(schedule?.student_id || '').trim();
            const date = String(schedule?.schedule_date || '').trim();
            const start = normalizeScheduleTimeKey(schedule?.start_time || '');
            if (!ownerTid || !sid || !date || !start || start === 'default') return;
            if (!teacherScheduleData[ownerTid]) teacherScheduleData[ownerTid] = {};
            if (!teacherScheduleData[ownerTid][sid]) teacherScheduleData[ownerTid][sid] = {};
            const entry = {
                start,
                duration: parseInt(schedule?.duration, 10) || 60
            };
            const entries = getScheduleEntries(ownerTid, sid, date);
            const updated = upsertScheduleEntry(entries, entry);
            setScheduleEntries(ownerTid, sid, date, updated.list);
        };
        // 수파베이스에서 먼저 로드
        if (typeof getSchedulesByTeacher === 'function') {
            try {
                const dbSchedules = await getSchedulesByTeacher(teacherId);
                teacherScheduleData[teacherId] = {};
                
                dbSchedules.forEach(schedule => {
                    appendScheduleEntry(teacherId, schedule);
                });

                // legacy/미배정 혼합 데이터 보강:
                // owner 전체 조회에서 학생 컨텍스트로 현재 teacher 일정을 재해석해 누락을 줄인다.
                const ownerId = cachedLsGet('current_owner_id');
                if (ownerId && typeof supabase !== 'undefined') {
                    const { data: ownerSchedules, error: ownerErr } = await supabase
                        .from('schedules')
                        .select('teacher_id, student_id, schedule_date, start_time, duration')
                        .eq('owner_user_id', ownerId);
                    if (ownerErr) {
                        console.warn('[loadTeacherScheduleData] owner 전체 보강 조회 실패:', ownerErr);
                    } else {
                        (ownerSchedules || []).forEach((row) => {
                            const resolvedOwnerTid = String(
                                resolveKnownTeacherId(row?.teacher_id)
                                || resolveTeacherIdFromStudentContext(row?.student_id)
                                || row?.teacher_id
                                || ''
                            ).trim();
                            if (!resolvedOwnerTid || resolvedOwnerTid !== normalizedTeacherId) return;
                            appendScheduleEntry(teacherId, row);
                        });
                    }
                }
                
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
        normalizeLegacyTeacherScheduleOwnership();
        if (teacherId === currentTeacherId) {
            await refreshCurrentTeacherStudents();
        }
    } catch (e) {
        console.error('선생님 일정 데이터 로드 실패:', e);
        teacherScheduleData[teacherId] = {};
    }
}

// ★ 모든 선생님의 일정 데이터 로드 (겹침 확인/알림 등에 필요)
async function loadAllTeachersScheduleData() {
    allScopeScheduleLoading = true;
    try {
        if (typeof supabase === 'undefined') return;
        const ownerId = cachedLsGet('current_owner_id');
        if (!ownerId) return;

        const { data, error } = await supabase
            .from('schedules')
            .select('teacher_id, student_id, schedule_date, start_time, duration')
            .eq('owner_user_id', ownerId);

        if (error) {
            console.error('[loadAllTeachersScheduleData] DB 에러:', error);
            return;
        }

        // 타교사 일정 라벨 복원을 위해 owner 범위 선생님 이름 맵 갱신
        try {
            const { data: teacherRows, error: teacherErr } = await supabase
                .from('teachers')
                .select('id, owner_user_id, name')
                .eq('owner_user_id', ownerId);
            if (teacherErr) {
                console.warn('[loadAllTeachersScheduleData] teachers 라벨 조회 실패:', teacherErr);
            } else if (Array.isArray(teacherRows)) {
                const nextLookup = {};
                const addLookup = (key, name) => {
                    const rawKey = String(key || '').trim().toLowerCase();
                    if (!rawKey) return;
                    nextLookup[rawKey] = name;
                    const canonicalKey = rawKey.replace(/[^a-z0-9]/g, '');
                    if (canonicalKey) nextLookup[canonicalKey] = name;
                };
                teacherRows.forEach((row) => {
                    const name = String(row?.name || '').trim();
                    if (!name) return;
                    addLookup(row?.id, name);
                    addLookup(row?.owner_user_id, name);
                });
                teacherNameLookup = { ...teacherNameLookup, ...nextLookup };
            }
        } catch (lookupErr) {
            console.warn('[loadAllTeachersScheduleData] teachers 라벨 보강 예외:', lookupErr);
        }

        // 현재 선생님의 데이터는 보존하고, 다른 선생님 데이터만 추가/갱신
        const otherTeachers = {};
        (data || []).forEach(schedule => {
            const tid = String(
                resolveKnownTeacherId(schedule?.teacher_id)
                || resolveTeacherIdFromStudentContext(schedule?.student_id)
                || schedule?.teacher_id
                || ''
            ).trim();
            if (!tid) return;
            const sid = String(schedule.student_id);
            const date = schedule.schedule_date;
            const entry = {
                start: schedule.start_time ? schedule.start_time.substring(0, 5) : schedule.start_time,
                duration: schedule.duration
            };

            if (!otherTeachers[tid]) otherTeachers[tid] = {};
            if (!otherTeachers[tid][sid]) otherTeachers[tid][sid] = {};

            const existing = otherTeachers[tid][sid][date];
            if (!existing) {
                otherTeachers[tid][sid][date] = [entry];
            } else {
                const arr = Array.isArray(existing) ? existing : [existing];
                const dupIdx = arr.findIndex(e => e.start === entry.start);
                if (dupIdx >= 0) arr[dupIdx] = entry;
                else arr.push(entry);
                otherTeachers[tid][sid][date] = arr;
            }
        });

        // 현재 선생님 데이터는 유지하고, 다른 선생님 데이터를 병합
        for (const tid in otherTeachers) {
            if (String(tid) === String(currentTeacherId)) continue; // 현재 선생님은 건드리지 않음
            teacherScheduleData[tid] = otherTeachers[tid];
        }

        const otherCount = Object.keys(otherTeachers).filter(t => String(t) !== String(currentTeacherId)).length;
        console.log(`[loadAllTeachersScheduleData] 다른 선생님 ${otherCount}명 일정 로드 완료 (총 ${(data || []).length}건)`);
        normalizeLegacyTeacherScheduleOwnership();
        allScopeScheduleHydrated = true;
    } catch (e) {
        console.error('[loadAllTeachersScheduleData] 예외:', e);
    } finally {
        allScopeScheduleLoading = false;
    }
}

// 선생님별 일정 데이터 저장
async function saveTeacherScheduleData() {
    try {
        if (!currentTeacherId) return;
        
        // ✅ 세션 검증: current_owner_id가 없으면 저장 불가
        const ownerId = cachedLsGet('current_owner_id');
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

function persistTeacherScheduleLocal() {
    if (!currentTeacherId) return;
    const key = `teacher_schedule_data__${currentTeacherId}`;
    localStorage.setItem(key, JSON.stringify(teacherScheduleData[currentTeacherId] || {}));
}
// saveData를 디바운스 처리 (빠른 연속 호출 시 마지막 1회만 실제 저장)
const _saveDataImpl = function() { 
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) {
        console.warn('[saveData] current_owner_id 없음 - 저장 중단');
        showToast('로그인이 필요합니다', 'warning');
        return;
    }
    const ownerKey = `academy_students__${ownerId}`;
    cachedLsSet(ownerKey, JSON.stringify(students)); 
    console.log(`학생 데이터 저장 (${ownerId}): ${students.length}명`);
};
const _debouncedSave = debounce(_saveDataImpl, 300);
function saveData(immediate) { 
    if (immediate) _saveDataImpl();
    else _debouncedSave();
}

// ========== 학부모 인증코드 ==========
function generateParentCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

window.regenerateParentCode = async function(studentId) {
    const s = students.find(x => String(x.id) === String(studentId));
    if (!s) return;
    const ok = await showConfirm('학부모 인증코드를 재발급하시겠습니까?\n\n기존 코드는 즉시 무효화되며,\n새 코드를 학부모에게 다시 전달해야 합니다.', { confirmText: '재발급', cancelText: '취소', type: 'warning' });
    if (!ok) return;
    const newCode = generateParentCode();
    s.parentCode = newCode;
    saveData(true);
    try { await updateStudent(studentId, { parent_code: newCode }); } catch(e) { console.error('parent_code DB 업데이트 실패:', e); }
    const codeEl = document.getElementById('reg-parent-code');
    if (codeEl) codeEl.value = newCode;
    showToast('인증코드가 재발급되었습니다', 'success');
}

window.copyParentCode = function() {
    const codeEl = document.getElementById('reg-parent-code');
    if (!codeEl || !codeEl.value) return;
    navigator.clipboard.writeText(codeEl.value).then(() => {
        showToast('인증코드가 복사되었습니다', 'success');
    }).catch(() => {
        codeEl.select();
        document.execCommand('copy');
        showToast('인증코드가 복사되었습니다', 'success');
    });
}

// ========== 학생 인증코드 ==========
function generateStudentCode() {
    // 영문 대문자 + 숫자 조합 8자리 (개인정보 없이 고유 식별)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 가능한 0,O,1,I 제외
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

window.copyStudentCode = function() {
    const codeEl = document.getElementById('reg-student-code');
    if (!codeEl || !codeEl.value) return;
    navigator.clipboard.writeText(codeEl.value).then(() => {
        showToast('학생 인증코드가 복사되었습니다', 'success');
    }).catch(() => {
        codeEl.select();
        document.execCommand('copy');
        showToast('학생 인증코드가 복사되었습니다', 'success');
    });
}

// 학생 수정 모달에서 QR코드 렌더링
window.renderEditModalQR = async function(studentId) {
    const container = document.getElementById('reg-qr-container');
    if (!container) return;
    container.innerHTML = '<div class="qr-empty"><i class="fas fa-spinner fa-spin"></i><br>QR 생성 중...</div>';
    try {
        const qrData = await getOrCreateQRCodeData(studentId);
        container.innerHTML = '';
        generateQRCode('reg-qr-container', qrData, 140);
    } catch(e) {
        container.innerHTML = '<div class="qr-empty"><i class="fas fa-exclamation-triangle"></i><br>QR 생성 실패</div>';
    }
}

// QR 이미지 다운로드 (QR목록 모달과 동일한 흰색 여백 포함)
window.downloadStudentQR = function(studentId) {
    const container = document.getElementById('reg-qr-container');
    if (!container) return;
    const canvas = container.querySelector('canvas');
    if (!canvas) { showToast('QR코드가 생성되지 않았습니다', 'warning'); return; }
    const s = students.find(x => String(x.id) === String(studentId));
    const fileName = s ? `QR_${s.name}_${s.grade}.png` : `QR_${studentId}.png`;
    // QR 목록 모달의 downloadQRCode와 동일한 방식 사용
    const padding = 40;
    const newCanvas = document.createElement('canvas');
    const ctx = newCanvas.getContext('2d');
    newCanvas.width = canvas.width + (padding * 2);
    newCanvas.height = canvas.height + (padding * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(canvas, padding, padding);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = newCanvas.toDataURL('image/png');
    link.click();
    showToast('QR코드가 다운로드되었습니다', 'success');
}

// QR 코드 재생성 (수정 모달에서)
window.regenerateStudentQR = async function(studentId) {
    const ok = await showConfirm('QR코드를 재생성하시겠습니까?\n\n기존 QR코드와 학생 인증코드가 모두 무효화되며,\n새 코드를 학생에게 다시 전달해야 합니다.', { confirmText: '재생성', cancelText: '취소', type: 'warning' });
    if (!ok) return;
    try {
        const newQrData = await generateQRCodeData(studentId);
        const container = document.getElementById('reg-qr-container');
        if (container) { container.innerHTML = ''; generateQRCode('reg-qr-container', newQrData, 140); }

        // 학생 인증코드도 함께 재생성 (1:1 대응)
        const newStudentCode = generateStudentCode();
        const s = students.find(x => String(x.id) === String(studentId));
        if (s) { s.studentCode = newStudentCode; saveData(true); }
        try { await updateStudent(studentId, { student_code: newStudentCode }); } catch(e) { console.error('student_code DB 업데이트 실패:', e); }
        const scEl = document.getElementById('reg-student-code');
        if (scEl) scEl.value = newStudentCode;

        showToast('QR코드와 학생 인증코드가 재생성되었습니다', 'success');
    } catch(e) {
        showToast('QR코드 재생성에 실패했습니다', 'error');
    }
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

    // 활성 학생 + 퇴원/휴원 학생 (퇴원/휴원 학생은 상태 변경일 이전 일정 표시용)
    return students.filter(s => {
        if (!mergedIds.has(String(s.id))) return false;
        if (s.status === 'active') return true;
        // 퇴원/휴원 학생은 statusChangedDate가 있으면 포함 (이전 일정 표시용)
        if ((s.status === 'archived' || s.status === 'paused') && s.statusChangedDate) return true;
        return false;
    });
}

// 퇴원/휴원 학생의 일정을 해당 날짜에 표시할지 판단
function shouldShowScheduleForStudent(student, dateStr) {
    if (!student) return false;
    // 재원생은 항상 표시
    if (student.status === 'active') return true;
    // 퇴원/휴원 학생은 상태 변경일 당일까지 표시, 그 이후만 숨김
    if ((student.status === 'archived' || student.status === 'paused') && student.statusChangedDate) {
        return dateStr <= student.statusChangedDate;
    }
    // statusChangedDate가 없는 퇴원/휴원 학생은 표시하지 않음
    return false;
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
    // 탭 상태 저장 (새로고침 시 복원)
    setTabValue('current_view', v);
    console.log('[switchView] 탭 전환:', v);
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${v}`).classList.add('active');
    renderCalendar();
}
window.toggleStudentList = function() {
    const d = document.getElementById('student-drawer');
    const o = document.getElementById('drawer-overlay');
    const open = d.classList.toggle('open');
    if (open) {
        o.style.display = 'block';
        requestAnimationFrame(() => o.classList.add('visible'));
    } else {
        o.classList.remove('visible');
        setTimeout(() => { o.style.display = 'none'; }, 300);
    }
    if(open) {
        if (currentTeacherId && currentStudentListTab === 'all') {
            currentStudentListTab = 'mine';
            document.querySelectorAll('.student-tab-btn').forEach(btn => btn.classList.remove('active'));
            const active = document.getElementById('student-tab-mine');
            if (active) active.classList.add('active');
        }
        updateStudentSortControls();
        renderDrawerList();
        // 검색 입력 이벤트 리스너 (디바운싱 적용)
        const searchInput = document.getElementById('drawer-search-input');
        searchInput.oninput = debounce(function() {
            renderDrawerList();
        }, 200);
        searchInput.focus();
    }
}

window.openHistoryFromStudentList = async function(studentId, focusScoreInput) {
    const sid = String(studentId || '');
    if (!sid) return;
    const student = students.find((s) => String(s.id) === sid);
    if (!student) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }
    const attSidInput = document.getElementById('att-student-id');
    if (attSidInput) attSidInput.value = sid;

    const drawer = document.getElementById('student-drawer');
    if (drawer && drawer.classList.contains('open')) {
        toggleStudentList();
    }

    await window.openHistoryModal();
    if (focusScoreInput) {
        setTimeout(() => {
            if (typeof window.openHistoryScoreAction === 'function') {
                window.openHistoryScoreAction();
            }
        }, 80);
    }
};

// 동명이인 감지: 같은 이름의 학생이 여러 명인지 확인
function getDuplicateNameSet() {
    const nameCount = {};
    students.filter(s => s.status === 'active').forEach(s => {
        const n = (s.name || '').trim();
        if (n) nameCount[n] = (nameCount[n] || 0) + 1;
    });
    const dupNames = new Set();
    for (const [name, count] of Object.entries(nameCount)) {
        if (count > 1) dupNames.add(name);
    }
    return dupNames;
}

// 동명이인 구분 라벨 생성: 학교가 있으면 학교명, 없으면 학년 표시
function getDupLabel(student) {
    if (student.school && student.school.trim()) return student.school.trim();
    return student.grade || '';
}

function getGradeSortValue(grade) {
    if (!grade) return 999;
    const match = grade.match(/(초|중|고)\s*(\d)/);
    if (!match) return 900;
    const level = match[1];
    const num = parseInt(match[2], 10);
    const base = level === '초' ? 0 : level === '중' ? 10 : 20;
    return base + (isNaN(num) ? 9 : num);
}

function updateStudentSortControls() {
    const sortButtons = document.querySelectorAll('.student-sort-btn');
    sortButtons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`student-sort-${currentStudentSort}`);
    if (activeBtn) activeBtn.classList.add('active');
}

window.setStudentSort = function(mode) {
    currentStudentSort = mode || 'default';
    updateStudentSortControls();
    renderDrawerList();
}
window.renderDrawerList = function() {
    const showInactiveOnly = document.getElementById('show-archived').checked;
    const searchQuery = document.getElementById('drawer-search-input').value.toLowerCase();
    const assignedIds = getAssignedStudentIdsForTeacher(currentTeacherId);
    
    // 전체 학생 목록 표시 (모든 선생님의 학생)
    let filtered = students.filter(s => {
        if (showInactiveOnly) return s.status === 'archived' || s.status === 'paused';
        else return s.status === 'active';
    });

    if (currentStudentListTab === 'mine' && currentTeacherId) {
        filtered = filtered.filter(s => assignedIds.includes(String(s.id)));
    }
    
    // 검색어 필터링 (이름, 학년, 학교)
    if(searchQuery) {
        filtered = filtered.filter(s => 
            s.name.toLowerCase().includes(searchQuery) || 
            s.grade.toLowerCase().includes(searchQuery) ||
            (s.school && s.school.toLowerCase().includes(searchQuery))
        );
    }

    if (currentStudentSort === 'grade') {
        filtered.sort((a, b) => {
            const diff = getGradeSortValue(a.grade) - getGradeSortValue(b.grade);
            if (diff !== 0) return diff;
            return (a.name || '').localeCompare(b.name || '', 'ko-KR');
        });
    } else if (currentStudentSort === 'school') {
        filtered.sort((a, b) => {
            const aSchool = (a.school || '').trim();
            const bSchool = (b.school || '').trim();
            const schoolCompare = aSchool.localeCompare(bSchool, 'ko-KR');
            if (schoolCompare !== 0) return schoolCompare;
            return (a.name || '').localeCompare(b.name || '', 'ko-KR');
        });
    }
    
    const drawerContent = document.getElementById('drawer-content');
    if (filtered.length === 0) {
        const emptyMsg = searchQuery 
            ? `<div style="text-align:center;padding:40px 20px;color:#94a3b8;"><i class="fas fa-search" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.4;"></i><p style="font-size:13px;margin:4px 0 0;">"${searchQuery}" 검색 결과가 없습니다</p></div>`
            : `<div style="text-align:center;padding:40px 20px;color:#94a3b8;"><i class="fas fa-user-plus" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.4;"></i><p style="font-size:13px;margin:4px 0 0;">${showInactiveOnly ? '퇴원/휴원 학생이 없습니다' : '등록된 학생이 없습니다'}</p></div>`;
        drawerContent.innerHTML = emptyMsg;
    } else {
        const dupNames = getDuplicateNameSet();

        // 그룹 키 생성 함수
        function getGroupKey(s) {
            if (currentStudentSort === 'grade') {
                return s.grade || '미지정';
            } else if (currentStudentSort === 'school') {
                return (s.school || '').trim() || '학교 미지정';
            }
            return null;
        }

        // 그룹 색상 팔레트 (학년/학교별)
        const groupColors = {
            '초': { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: 'fa-seedling' },
            '중': { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', icon: 'fa-book' },
            '고': { bg: '#faf5ff', border: '#c4b5fd', text: '#6b21a8', icon: 'fa-graduation-cap' }
        };

        function getGroupStyle(key) {
            if (currentStudentSort === 'grade') {
                if (key.startsWith('초')) return groupColors['초'];
                if (key.startsWith('중')) return groupColors['중'];
                if (key.startsWith('고')) return groupColors['고'];
            }
            return { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', icon: 'fa-school' };
        }

        let html = '';
        let lastGroup = null;

        filtered.forEach((s, idx) => {
            const groupKey = getGroupKey(s);

            // 그룹 헤더 삽입
            if (groupKey !== null && groupKey !== lastGroup) {
                if (lastGroup !== null) {
                    html += `</div>`; // 이전 그룹 래퍼 닫기
                }
                const style = getGroupStyle(groupKey);
                const membersInGroup = filtered.filter(x => getGroupKey(x) === groupKey).length;
                html += `<div class="drawer-group">`;
                html += `<div class="drawer-group-header" style="background:${style.bg};border-left:3px solid ${style.border};color:${style.text};">
                    <i class="fas ${style.icon}"></i>
                    <span class="drawer-group-title">${groupKey}</span>
                    <span class="drawer-group-count">${membersInGroup}명</span>
                </div>`;
                lastGroup = groupKey;
            }

            let itemClass = '';
            if (s.status === 'archived' || s.status === 'paused') itemClass = 'inactive-item';
            const assignedTeacherId = getAssignedTeacherId(String(s.id));
            const teacherOptions = (teacherList || []).map(t => 
                `<option value="${t.id}" ${String(t.id) === String(assignedTeacherId) ? 'selected' : ''}>${t.name}</option>`
            ).join('');
            const assignControl = `
                <select class="m-input" style="width: 84px; min-width: 84px; max-width: 84px; padding: 4px 6px; font-size: 11px;" onchange="setStudentAssignment('${s.id}', this.value)">
                    <option value="">미배정</option>
                    ${teacherOptions}
                </select>
            `;
            const schoolLabel = s.school ? `<span class="student-school-label">${s.school}</span>` : '';
            const isDup = dupNames.has((s.name || '').trim());
            const dupBadge = isDup ? `<span class="dup-name-badge" title="동명이인"><i class="fas fa-user-group"></i></span>` : '';
            html += `<div class="student-item ${itemClass}${isDup ? ' has-dup-name' : ''}">
                <div class="student-info" onclick="prepareEdit('${s.id}')">
                    <b>${s.name} ${dupBadge}<span>${s.grade}</span></b>
                    ${schoolLabel}
                    <span>${s.studentPhone || '-'}</span>
                </div>
                <div class="student-quick-actions">
                    <button type="button" class="student-quick-btn" onclick="event.stopPropagation(); openHistoryFromStudentList('${s.id}', false)">
                        <i class="fas fa-history"></i> 이력
                    </button>
                    <button type="button" class="student-quick-btn score" onclick="event.stopPropagation(); openHistoryFromStudentList('${s.id}', true)">
                        <i class="fas fa-square-poll-vertical"></i> 점수
                    </button>
                </div>
                ${assignControl}
                <select id="status-select-${s.id}" class="status-select ${s.status}" data-student-id="${s.id}" data-original-status="${s.status}" onchange="updateStudentStatus('${s.id}', this.value)">
                    <option value="active" ${s.status === 'active' ? 'selected' : ''}>재원</option>
                    <option value="archived" ${s.status === 'archived' ? 'selected' : ''}>퇴원</option>
                    <option value="paused" ${s.status === 'paused' ? 'selected' : ''}>휴원</option>
                    <option value="delete">삭제</option>
                </select>
            </div>`;
        });

        // 마지막 그룹 닫기
        if (lastGroup !== null) html += `</div>`;

        drawerContent.innerHTML = html;
    }
    document.getElementById('student-list-count').textContent = `${filtered.length}명`;
}

window.setStudentListTab = function(tab) {
    currentStudentListTab = tab;
    document.querySelectorAll('.student-tab-btn').forEach(btn => btn.classList.remove('active'));
    const active = document.getElementById(`student-tab-${tab}`);
    if (active) active.classList.add('active');
    updateStudentSortControls();
    renderDrawerList();
}

function getAssignedStudentIdsForTeacher(teacherId) {
    if (!teacherId) return [];
    const rawTeacherId = String(teacherId || '').trim();
    const normalizedTeacherId = normalizeTeacherIdForCompare(rawTeacherId)
        || resolveKnownTeacherId(rawTeacherId)
        || rawTeacherId;
    const assignedSet = new Set();

    // 1) 기준 우선순위: 학생 레코드의 teacher_id (DB 동기화 대상)
    (students || []).forEach((student) => {
        const sid = String(student?.id || '').trim();
        const studentTeacherRaw = String(student?.teacher_id || '').trim();
        if (!sid || !studentTeacherRaw) return;
        const studentTeacherNormalized = normalizeTeacherIdForCompare(studentTeacherRaw)
            || resolveKnownTeacherId(studentTeacherRaw)
            || studentTeacherRaw;
        if (studentTeacherNormalized === normalizedTeacherId) {
            assignedSet.add(sid);
        }
    });

    // 2) 하위호환: 로컬 매핑은 teacher_id가 비어있는 학생에 한해 보조 사용
    const mappingTeacherKeys = new Set([
        rawTeacherId,
        normalizedTeacherId,
        resolveKnownTeacherId(rawTeacherId),
        resolveKnownTeacherId(normalizedTeacherId)
    ].map((v) => String(v || '').trim()).filter(Boolean));

    mappingTeacherKeys.forEach((mappingTeacherId) => {
        const key = `teacher_students_mapping__${mappingTeacherId}`;
        try {
            const saved = localStorage.getItem(key);
            const mappedIds = saved ? (JSON.parse(saved) || []).map(String) : [];
            mappedIds.forEach((sid) => {
                const student = (students || []).find((s) => String(s?.id) === String(sid));
                const studentTeacherRaw = String(student?.teacher_id || '').trim();
                if (!studentTeacherRaw) {
                    assignedSet.add(String(sid));
                    return;
                }
                const studentTeacherNormalized = normalizeTeacherIdForCompare(studentTeacherRaw)
                    || resolveKnownTeacherId(studentTeacherRaw)
                    || studentTeacherRaw;
                if (studentTeacherNormalized === normalizedTeacherId) {
                    assignedSet.add(String(sid));
                }
            });
        } catch (e) {
            console.error('[getAssignedStudentIdsForTeacher] 매핑 파싱 실패:', e);
        }
    });

    return Array.from(assignedSet);
}

function getAssignedTeacherId(studentId) {
    const sid = String(studentId || '').trim();
    if (!sid) return '';

    // 1) 기준 우선순위: 학생 레코드 teacher_id
    const student = (students || []).find((s) => String(s?.id) === sid);
    const studentTeacherRaw = String(student?.teacher_id || '').trim();
    if (studentTeacherRaw) {
        const knownTeacherId = resolveKnownTeacherId(studentTeacherRaw);
        if (knownTeacherId) return knownTeacherId;
        const normalizedTeacherId = normalizeTeacherIdForCompare(studentTeacherRaw);
        if (normalizedTeacherId) return normalizedTeacherId;
        return studentTeacherRaw;
    }

    // 2) 하위호환: 로컬 매핑 검색(복수 후보면 teacherList에 존재하는 키 우선)
    const allKeys = Object.keys(localStorage);
    const mappingKeys = allKeys.filter((key) => key.startsWith('teacher_students_mapping__'));
    const matchedTeacherIds = [];
    for (const key of mappingKeys) {
        try {
            const saved = localStorage.getItem(key);
            const ids = saved ? JSON.parse(saved) || [] : [];
            if (ids.map(String).includes(sid)) {
                matchedTeacherIds.push(String(key.replace('teacher_students_mapping__', '') || '').trim());
            }
        } catch (e) {
            console.error('[getAssignedTeacherId] 매핑 파싱 실패:', e);
        }
    }

    if (matchedTeacherIds.length === 0) return '';
    for (const candidate of matchedTeacherIds) {
        const knownTeacherId = resolveKnownTeacherId(candidate);
        if (knownTeacherId) return knownTeacherId;
    }
    return matchedTeacherIds[0] || '';
}

window.getAssignedTeacherId = getAssignedTeacherId;

function resolveKnownTeacherId(rawTeacherId) {
    const raw = String(rawTeacherId || '').trim();
    if (!raw) return '';
    const normalizedRaw = raw.toLowerCase();
    const canonicalRaw = normalizedRaw.replace(/[^a-z0-9]/g, '');
    const byId = (teacherList || []).find((t) => {
        const idRaw = String(t.id || '').trim().toLowerCase();
        if (idRaw === normalizedRaw) return true;
        const idCanonical = idRaw.replace(/[^a-z0-9]/g, '');
        return !!(canonicalRaw && idCanonical && canonicalRaw === idCanonical);
    });
    if (byId) return String(byId.id || '');
    const byOwnerMatches = (teacherList || []).filter((t) => {
        const ownerRaw = String(t.owner_user_id || '').trim().toLowerCase();
        if (ownerRaw === normalizedRaw) return true;
        const ownerCanonical = ownerRaw.replace(/[^a-z0-9]/g, '');
        return !!(canonicalRaw && ownerCanonical && canonicalRaw === ownerCanonical);
    });
    if (byOwnerMatches.length === 1) {
        return String(byOwnerMatches[0].id || '');
    }
    // owner_user_id가 여러 선생님과 매칭되면 단일 teacher id로 수렴시키지 않는다.
    // (임의 teacher로 매핑되면 본인 일정 인증 판단이 흔들릴 수 있음)
    return '';
}

function resolveTeacherIdFromStudentContext(studentId) {
    const sid = String(studentId || '').trim();
    if (!sid) return '';
    const student = (students || []).find((s) => String(s?.id) === sid);
    if (student && student.teacher_id) {
        const byStudent = resolveKnownTeacherId(student.teacher_id);
        if (byStudent) return byStudent;
    }
    if (typeof getAssignedTeacherId === 'function') {
        const assigned = resolveKnownTeacherId(getAssignedTeacherId(sid));
        if (assigned) return assigned;
    }
    return '';
}

function normalizeLegacyTeacherScheduleOwnership() {
    if (!teacherScheduleData || typeof teacherScheduleData !== 'object') return false;
    const knownTeacherIds = new Set((teacherList || []).map((t) => String(t.id || '')).filter(Boolean));
    if (knownTeacherIds.size === 0) return false;

    let changed = false;
    const legacyTeacherIds = Object.keys(teacherScheduleData).filter((tid) => tid && !knownTeacherIds.has(String(tid)));

    legacyTeacherIds.forEach((legacyTeacherId) => {
        const legacySchedule = teacherScheduleData[legacyTeacherId] || {};
        const studentIds = Object.keys(legacySchedule);
        if (studentIds.length === 0) return;

        const scoreMap = new Map();
        const addScore = (teacherId, score) => {
            const tid = String(teacherId || '').trim();
            if (!tid || !knownTeacherIds.has(tid)) return;
            scoreMap.set(tid, (scoreMap.get(tid) || 0) + score);
        };

        studentIds.forEach((sid) => {
            const student = (students || []).find((s) => String(s.id) === String(sid));
            if (student && student.teacher_id) {
                addScore(resolveKnownTeacherId(student.teacher_id), 3);
            }
            if (typeof getAssignedTeacherId === 'function') {
                addScore(resolveKnownTeacherId(getAssignedTeacherId(sid)), 2);
            }
        });

        const ranked = Array.from(scoreMap.entries()).sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return String(a[0]).localeCompare(String(b[0]));
        });
        if (!ranked.length) return;
        const [targetTeacherId, topScore] = ranked[0];
        if (topScore <= 0) return;

        if (!teacherScheduleData[targetTeacherId]) teacherScheduleData[targetTeacherId] = {};
        studentIds.forEach((sid) => {
            const byDate = legacySchedule[sid] || {};
            Object.keys(byDate).forEach((dateStr) => {
                const rawEntries = byDate[dateStr];
                const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
                let targetEntries = getScheduleEntries(targetTeacherId, String(sid), dateStr);
                entries.forEach((entry) => {
                    const start = normalizeScheduleTimeKey(entry?.start || '');
                    if (!start || start === 'default') return;
                    const duration = parseInt(entry?.duration, 10) || 60;
                    targetEntries = upsertScheduleEntry(targetEntries, { start, duration }).list;
                });
                setScheduleEntries(targetTeacherId, String(sid), dateStr, targetEntries);
            });
        });

        delete teacherScheduleData[legacyTeacherId];
        localStorage.removeItem(`teacher_schedule_data__${legacyTeacherId}`);
        persistTeacherScheduleLocalFor(targetTeacherId);
        changed = true;
        console.log(`[normalizeLegacyTeacherScheduleOwnership] legacy=${legacyTeacherId} -> target=${targetTeacherId} 병합`);
    });

    return changed;
}

// localStorage의 선생님-학생 매핑을 DB에 동기화 (한 번만 실행)
async function syncTeacherAssignmentsToDb() {
    const syncKey = 'teacher_assignment_db_synced';
    if (localStorage.getItem(syncKey)) return; // 이미 동기화됨
    
    console.log('[syncTeacherAssignmentsToDb] 기존 매핑을 DB에 동기화 시작...');
    const allKeys = Object.keys(localStorage);
    const mappingKeys = allKeys.filter(key => key.startsWith('teacher_students_mapping__'));
    let syncCount = 0;
    
    for (const key of mappingKeys) {
        const teacherId = key.replace('teacher_students_mapping__', '');
        try {
            const saved = localStorage.getItem(key);
            const studentIds = saved ? JSON.parse(saved) || [] : [];
            for (const sid of studentIds) {
                try {
                    await updateStudent(sid, { teacher_id: teacherId });
                    syncCount++;
                } catch (e) {
                    // 개별 실패 무시
                }
            }
        } catch (e) {
            console.error('[syncTeacherAssignmentsToDb] 매핑 동기화 실패:', e);
        }
    }
    
    localStorage.setItem(syncKey, 'true');
    console.log(`[syncTeacherAssignmentsToDb] 동기화 완료: ${syncCount}건`);
}

// 페이지 로드 후 동기화 실행
setTimeout(() => {
    if (typeof updateStudent === 'function') {
        syncTeacherAssignmentsToDb();
    }
}, 3000);

function removeStudentFromAllMappings(studentId) {
    const allKeys = Object.keys(localStorage);
    const mappingKeys = allKeys.filter(key => key.startsWith('teacher_students_mapping__'));
    mappingKeys.forEach(key => {
        try {
            const saved = localStorage.getItem(key);
            if (!saved) return;
            const ids = JSON.parse(saved) || [];
            const next = ids.filter(id => String(id) !== String(studentId));
            localStorage.setItem(key, JSON.stringify(next));
        } catch (e) {
            console.error('[removeStudentFromAllMappings] 매핑 파싱 실패:', e);
        }
    });
}

function assignStudentToSpecificTeacher(studentId, teacherId) {
    if (!teacherId) return;
    const key = `teacher_students_mapping__${teacherId}`;
    let studentIds = [];
    try {
        const saved = localStorage.getItem(key);
        if (saved) studentIds = JSON.parse(saved) || [];
    } catch (e) {
        console.error('매핑 로드 실패:', e);
    }

    if (!studentIds.map(String).includes(String(studentId))) {
        studentIds.push(studentId);
        localStorage.setItem(key, JSON.stringify(studentIds));
    }
}

window.setStudentAssignment = async function(studentId, teacherId) {
    removeStudentFromAllMappings(studentId);
    if (teacherId) {
        assignStudentToSpecificTeacher(studentId, teacherId);
    }
    
    // DB에도 teacher_id 업데이트 (숙제 제출 페이지에서 조회 가능하도록)
    try {
        await updateStudent(studentId, { teacher_id: teacherId || null });
        // 로컬 students 배열도 업데이트
        const idx = students.findIndex(s => String(s.id) === String(studentId));
        if (idx > -1) {
            students[idx].teacher_id = teacherId || null;
        }
    } catch (e) {
        console.error('[setStudentAssignment] DB teacher_id 업데이트 실패:', e);
    }
    
    if (typeof refreshCurrentTeacherStudents === 'function') {
        refreshCurrentTeacherStudents();
    }
    renderDrawerList();
    renderCalendar();
}
window.updateStudentStatus = async function(id, newStatus) {
    console.log(`[updateStudentStatus] 호출 - id: ${id}, newStatus: ${newStatus}`);
    
    const idx = students.findIndex(s => String(s.id) === String(id));
    if (idx === -1) {
        console.error(`[updateStudentStatus] 학생을 찾을 수 없음 - id: ${id}`);
        showToast('학생을 찾을 수 없습니다.', 'error');
        renderDrawerList();
        return;
    }
    
    const student = students[idx];
    const selectElement = document.getElementById(`status-select-${id}`);
    const originalStatus = selectElement ? selectElement.getAttribute('data-original-status') : student.status;
    
    if (newStatus === 'delete') {
        if (await showConfirm(`정말로 ${student.name} 학생의 모든 데이터를 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다.)`, { type: 'danger', title: '삭제 확인', okText: '삭제' })) {
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
                    showToast(`${student.name} 학생이 삭제되었습니다.`, 'success');
                } else {
                    throw new Error('데이터베이스 삭제 실패');
                }
            } catch (error) {
                console.error('[updateStudentStatus] 학생 삭제 실패:', error);
                showToast(`학생 삭제에 실패했습니다: ${error.message}`, 'error');
                
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
        
        // 퇴원/휴원 시 상태 변경 날짜 기록 (이 날짜 이전의 일정은 보존)
        const updatePayload = { status: newStatus };
        if (newStatus === 'archived' || newStatus === 'paused') {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            updatePayload.status_changed_date = `${yyyy}-${mm}-${dd}`;
        } else if (newStatus === 'active') {
            // 재원으로 복귀 시 상태 변경 날짜 초기화
            updatePayload.status_changed_date = null;
        }
        
        // 상태 변경을 Supabase에 반영
        const updated = await updateStudent(id, updatePayload);
        console.log(`[updateStudentStatus] updateStudent 결과:`, updated);
        
        if (updated) {
            students[idx].status = newStatus;
            if (updatePayload.status_changed_date !== undefined) {
                students[idx].statusChangedDate = updatePayload.status_changed_date;
            }
            saveData(); 
            renderDrawerList(); 
            renderCalendar();
            console.log(`[updateStudentStatus] 상태 변경 성공 - ${student.name}: ${newStatus}, 변경일: ${updatePayload.status_changed_date || '없음'}`);
            
            // 퇴원/휴원 시 이후 일정 삭제 여부 확인
            if (newStatus === 'archived' || newStatus === 'paused') {
                const statusLabel = newStatus === 'archived' ? '퇴원' : '휴원';
                const todayStr = updatePayload.status_changed_date;
                
                if (await showConfirm(`${student.name} 학생이 ${statusLabel} 처리되었습니다.\n\n${todayStr} 이후의 일정을 모두 삭제하시겠습니까?\n\n• 삭제: DB 공간 절약 (되돌릴 수 없음)\n• 취소: 일정 데이터 유지 (캘린더에서만 숨김)`, { type: 'danger', title: '삭제 확인', okText: '삭제' })) {
                    try {
                        // DB에서 이후 일정 삭제
                        if (typeof deleteSchedulesByRange === 'function') {
                            await deleteSchedulesByRange(id, todayStr, '2099-12-31', currentTeacherId);
                            console.log(`[updateStudentStatus] ${student.name} 이후 일정 DB 삭제 완료`);
                        }
                        
                        // 로컬 메모리에서도 이후 일정 삭제
                        if (teacherScheduleData[currentTeacherId] && teacherScheduleData[currentTeacherId][String(id)]) {
                            const studentSchedule = teacherScheduleData[currentTeacherId][String(id)];
                            Object.keys(studentSchedule).forEach(dateStr => {
                                if (dateStr >= todayStr) {
                                    delete studentSchedule[dateStr];
                                }
                            });
                        }
                        
                        persistTeacherScheduleLocal();
                        saveData();
                        renderCalendar();
                        showToast(`${student.name} 학생의 ${todayStr} 이후 일정이 삭제되었습니다.`, 'success');
                    } catch (delError) {
                        console.error('[updateStudentStatus] 이후 일정 삭제 실패:', delError);
                        showToast('이후 일정 삭제에 실패했습니다. 수동으로 삭제해주세요.', 'error');
                    }
                }
            }
        } else {
            throw new Error('상태 업데이트 실패');
        }
    } catch (error) {
        console.error('[updateStudentStatus] 학생 상태 업데이트 실패:', error);
        showToast(`학생 상태 변경에 실패했습니다: ${error.message}`, 'error');
        
        // 원래 상태로 복구
        if (selectElement) {
            selectElement.value = originalStatus;
        }
        renderDrawerList();
    }
}
window.openEmergencyQueueAction = async function() {
    try {
        if (typeof window.setEmergencyAttendanceFilterDays === 'function') {
            window.setEmergencyAttendanceFilterDays(7);
        }
        if (typeof window.renderEmergencyAttendanceQueue === 'function') {
            await window.renderEmergencyAttendanceQueue();
        }
        const queueEl = document.getElementById('emergency-attendance-queue');
        if (queueEl) {
            queueEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (error) {
        console.error('[openEmergencyQueueAction] 에러:', error);
    }
};

// QR 출석 모달 오늘 요약 렌더링
async function renderQRTodaySummary() {
    const el = document.getElementById('qr-today-summary');
    if (!el) return;
    const todayStr = getTodayStr();
    let total = 0, present = 0, late = 0, absent = 0, pending = 0;
    const activeStudents = students.filter(s => !s.status || s.status === 'active');
    const now = new Date();
    let nextClass = null;

    for (const s of activeStudents) {
        const sid = String(s.id);
        // 이 학생이 오늘 일정이 있는지 확인
        const entries = getScheduleEntries(currentTeacherId, sid, todayStr);
        if (entries.length === 0) continue;
        total++;

        // 다음 수업 시각 계산(운영자 즉시 판단용)
        for (const entry of entries) {
            const startText = String(entry?.start || '');
            if (!startText || startText === 'default') continue;
            const [h, m] = startText.split(':').map(Number);
            if (Number.isNaN(h) || Number.isNaN(m)) continue;
            const dt = new Date(now);
            dt.setHours(h, m, 0, 0);
            if (dt >= now && (!nextClass || dt < nextClass)) {
                nextClass = dt;
            }
        }

        const att = s.attendance?.[todayStr];
        if (att === 'present') present++;
        else if (att === 'late') late++;
        else if (att === 'absent') absent++;
        else pending++;
    }

    const scheduleSnapshot = (typeof window.getTodayScheduleSnapshotForTeacher === 'function')
        ? window.getTodayScheduleSnapshotForTeacher(currentTeacherId)
        : null;
    const missingCount = scheduleSnapshot ? (scheduleSnapshot.missingStudents || []).length : 0;
    const emergencyPendingCount = (typeof window.getEmergencyAttendancePendingCount === 'function')
        ? await window.getEmergencyAttendancePendingCount(14)
        : null;

    let nextClassLabel = '오늘 일정 종료';
    if (nextClass) {
        const diffMin = Math.max(0, Math.round((nextClass.getTime() - now.getTime()) / 60000));
        const hh = String(nextClass.getHours()).padStart(2, '0');
        const mm = String(nextClass.getMinutes()).padStart(2, '0');
        nextClassLabel = `${diffMin}분 후 (${hh}:${mm})`;
    }

    const dashboardHtml = `
        <div class="qr-ops-dashboard">
            <div class="qr-ops-cards">
                <div class="qr-ops-card">
                    <div class="qr-ops-label">오늘 일정 누락</div>
                    <div class="qr-ops-value ${missingCount > 0 ? 'warn' : ''}">${missingCount}명</div>
                </div>
                <div class="qr-ops-card">
                    <div class="qr-ops-label">임시출석 미확정</div>
                    <div class="qr-ops-value ${Number(emergencyPendingCount || 0) > 0 ? 'warn' : ''}">${emergencyPendingCount === null ? '-' : `${emergencyPendingCount}건`}</div>
                </div>
                <div class="qr-ops-card">
                    <div class="qr-ops-label">다음 수업</div>
                    <div class="qr-ops-value">${nextClassLabel}</div>
                </div>
            </div>
            <div class="qr-ops-actions">
                <button type="button" class="qr-ops-btn" onclick="openQRScanPage()"><i class="fas fa-camera"></i> 바로 스캔</button>
                <button type="button" class="qr-ops-btn alt" onclick="openTodayScheduleSuggestion()"><i class="fas fa-calendar-plus"></i> 누락 일정 등록</button>
                <button type="button" class="qr-ops-btn alt" onclick="openEmergencyQueueAction()"><i class="fas fa-hourglass-half"></i> 임시확정 보기</button>
            </div>
        </div>
    `;

    if (total === 0) {
        const hasAction = typeof window.openTodayScheduleSuggestion === 'function';
        el.innerHTML = `
            ${dashboardHtml}
            <div class="qr-schedule-missing-alert">
                <div class="qr-schedule-missing-title"><i class="fas fa-triangle-exclamation"></i> 오늘 등록된 수업이 없습니다</div>
                <div class="qr-schedule-missing-desc">QR 스캔 시 임시출석이 누적될 수 있어, 먼저 오늘 일정을 등록하는 것을 권장합니다.</div>
                ${hasAction ? '<button type="button" class="qr-schedule-missing-btn" onclick="openTodayScheduleSuggestion()"><i class="fas fa-calendar-plus"></i> 오늘 일정 빠른 등록</button>' : ''}
            </div>
        `;
        return;
    }
    el.innerHTML = `
        ${dashboardHtml}
        <div class="qr-summary-grid">
            <div class="qr-sum-item"><span class="qr-sum-num" style="color:#0f172a;">${total}</span><span class="qr-sum-label">전체</span></div>
            <div class="qr-sum-item"><span class="qr-sum-num" style="color:#22c55e;">${present}</span><span class="qr-sum-label">출석</span></div>
            <div class="qr-sum-item"><span class="qr-sum-num" style="color:#f59e0b;">${late}</span><span class="qr-sum-label">지각</span></div>
            <div class="qr-sum-item"><span class="qr-sum-num" style="color:#ef4444;">${absent}</span><span class="qr-sum-label">결석</span></div>
            <div class="qr-sum-item"><span class="qr-sum-num" style="color:#94a3b8;">${pending}</span><span class="qr-sum-label">미처리</span></div>
        </div>`;
}

window.openModal = function(id) {
    document.getElementById(id).style.display = 'flex';
    if(id === 'qr-attendance-modal') {
        renderQRTodaySummary();
        if (typeof window.renderEmergencyAttendanceQueue === 'function') {
            window.renderEmergencyAttendanceQueue();
        }
    }
    if(id === 'schedule-modal') {
        const searchInput = document.getElementById('sch-student-search');
        const dropdown = document.getElementById('sch-student-dropdown');
        const hiddenSelect = document.getElementById('sch-student-select');
        const selectedList = document.getElementById('sch-selected-students');
        
        // 전체 활성 학생 표시 (모든 선생님이 등록 가능)
        const activeStudents = students.filter(s => s.status === 'active');
        
        // 검색 입력 초기화
        searchInput.value = '';
        hiddenSelect.value = '';
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        selectedScheduleStudents = [];
        if (selectedList) selectedList.innerHTML = '';
        const durationHint = document.getElementById('sch-duration-hint');
        if (durationHint) durationHint.style.display = 'none';
        
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
                s.grade.toLowerCase().includes(queryLower) ||
                (s.school && s.school.toLowerCase().includes(queryLower))
            );
            renderStudentDropdown(filtered, query);
        };
        
        // 캘린더에서 보고 있는 날짜로 시작일 설정
        const calDate = new Date(currentDate);
        const yyyy = calDate.getFullYear();
        const mm = String(calDate.getMonth() + 1).padStart(2, '0');
        const dd = String(calDate.getDate()).padStart(2, '0');
        document.getElementById('sch-start-date').value = `${yyyy}-${mm}-${dd}`;

        // 반복 주 초기화 + 요일 체크 해제
        document.getElementById('sch-weeks').value = '4';
        document.querySelectorAll('.day-check').forEach(c => c.checked = false);

        // 수업시간/시작시간 기본값 복원
        document.getElementById('sch-time').value = '16:00';
        document.getElementById('sch-duration-min').value = '90';

        // 요일 선택에 따라 반복 주 필드 표시/숨김
        const weeksField = document.getElementById('sch-weeks').closest('.sch-field');
        if (weeksField) weeksField.style.display = '';
        document.querySelectorAll('.day-check').forEach(c => {
            c.onchange = function() {
                const anyChecked = document.querySelectorAll('.day-check:checked').length > 0;
                if (weeksField) weeksField.style.display = anyChecked ? '' : 'none';
            };
        });
        // 초기: 요일 미선택이면 반복주 숨김
        if (weeksField) weeksField.style.display = 'none';
    }
}

window.renderStudentDropdown = function(studentList, query) {
    const dropdown = document.getElementById('sch-student-dropdown');
    if(studentList.length === 0) {
        dropdown.innerHTML = '<div class="search-option" style="color: var(--gray); cursor: default;">검색 결과가 없습니다.</div>';
        dropdown.classList.add('active');
        return;
    }
    const dupNames = getDuplicateNameSet();
    dropdown.innerHTML = studentList.map(s => {
        const isDup = dupNames.has((s.name || '').trim());
        const schoolInfo = isDup && s.school ? `<span class="search-option-school">${s.school}</span>` : '';
        const dupIcon = isDup ? `<i class="fas fa-user-group" style="font-size:9px;color:#f59e0b;margin-left:3px;" title="동명이인"></i>` : '';
        return `<div class="search-option${isDup ? ' search-option-dup' : ''}" onclick="selectStudent('${s.id}', '${s.name}', '${s.grade}')">
            <span class="search-option-label">${s.name}${dupIcon}</span>
            <span class="search-option-grade">${s.grade}</span>
            ${schoolInfo}
        </div>`;
    }).join('');
    
    dropdown.classList.add('active');
}

window.selectStudent = function(id, name, grade) {
    if (!selectedScheduleStudents.map(String).includes(String(id))) {
        selectedScheduleStudents.push(id);
    }
    const searchInput = document.getElementById('sch-student-search');
    const dropdown = document.getElementById('sch-student-dropdown');
    const hiddenSelect = document.getElementById('sch-student-select');
    if (hiddenSelect) hiddenSelect.value = id;
    if (searchInput) searchInput.value = '';
    if (dropdown) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
    }
    renderSelectedScheduleStudents();
    updateDurationByGrade();
}

function renderSelectedScheduleStudents() {
    const selectedList = document.getElementById('sch-selected-students');
    if (!selectedList) return;
    if (!selectedScheduleStudents.length) {
        selectedList.textContent = '';
        return;
    }
    const dupNames = getDuplicateNameSet();
    const chips = selectedScheduleStudents.map(id => {
        const student = students.find(s => String(s.id) === String(id));
        if (!student) return `<button type="button" class="schedule-selected-chip" onclick="removeScheduleStudent('${id}')">${id} ×</button>`;
        const isDup = dupNames.has((student.name || '').trim());
        const extra = isDup && student.school ? ` · ${student.school}` : '';
        const label = `${student.name} ${student.grade}${extra}`;
        return `<button type="button" class="schedule-selected-chip${isDup ? ' chip-dup' : ''}" onclick="removeScheduleStudent('${id}')">${label} ×</button>`;
    });
    selectedList.innerHTML = chips.join('');
}

window.removeScheduleStudent = function(id) {
    selectedScheduleStudents = selectedScheduleStudents.filter(sid => String(sid) !== String(id));
    renderSelectedScheduleStudents();
    updateDurationByGrade();
}

// 학년별 수업 시간 자동 설정
function updateDurationByGrade() {
    const durationInput = document.getElementById('sch-duration-min');
    const hintEl = document.getElementById('sch-duration-hint');
    if (!durationInput || !hintEl) return;

    if (selectedScheduleStudents.length === 0) {
        hintEl.style.display = 'none';
        return;
    }

    let hasMiddle = false, hasHigh = false, hasOther = false;
    for (const sid of selectedScheduleStudents) {
        const student = students.find(s => String(s.id) === String(sid));
        if (!student) continue;
        const g = student.grade || '';
        if (g.startsWith('중')) hasMiddle = true;
        else if (g.startsWith('고')) hasHigh = true;
        else hasOther = true;
    }

    if (hasMiddle && hasHigh) {
        // 혼합: 큰 값(100분) + 안내 배너
        durationInput.value = 100;
        hintEl.innerHTML = '<i class="fas fa-info-circle"></i> 중학생(90분)과 고등학생(100분)이 섞여 있습니다. 필요시 수동 조정하세요.';
        hintEl.style.display = 'flex';
    } else if (hasHigh && !hasMiddle) {
        durationInput.value = 100;
        hintEl.style.display = 'none';
    } else if (hasMiddle && !hasHigh) {
        durationInput.value = 90;
        hintEl.style.display = 'none';
    } else {
        // 초등 또는 기타 - 90분 설정
        durationInput.value = 90;
        hintEl.style.display = 'none';
    }
}

function renderPeriodDeleteStudentDropdown(studentList) {
    const dropdown = document.getElementById('period-del-student-dropdown');
    if (!dropdown) return;
    if (studentList.length === 0) {
        dropdown.innerHTML = '<div class="search-option" style="color: var(--gray); cursor: default;">검색 결과가 없습니다.</div>';
        dropdown.classList.add('active');
        return;
    }

    const dupNames = getDuplicateNameSet();
    dropdown.innerHTML = studentList.map(s => {
        const isDup = dupNames.has((s.name || '').trim());
        const schoolInfo = isDup && s.school ? `<span class="search-option-school">${s.school}</span>` : '';
        const dupIcon = isDup ? `<i class="fas fa-user-group" style="font-size:9px;color:#f59e0b;margin-left:3px;" title="동명이인"></i>` : '';
        return `<div class="search-option${isDup ? ' search-option-dup' : ''}" onclick="selectPeriodDeleteStudent('${s.id}', '${s.name}', '${s.grade}')">
            <span class="search-option-label">${s.name}${dupIcon}</span>
            <span class="search-option-grade">${s.grade}</span>
            ${schoolInfo}
        </div>`;
    }).join('');

    dropdown.classList.add('active');
}

window.selectPeriodDeleteStudent = function(id, name, grade) {
    if (!selectedPeriodDeleteStudents.map(String).includes(String(id))) {
        selectedPeriodDeleteStudents.push(String(id));
    }
    const searchInput = document.getElementById('period-del-student-search');
    const dropdown = document.getElementById('period-del-student-dropdown');
    if (searchInput) searchInput.value = '';
    if (dropdown) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
    }
    renderPeriodDeleteSelectedStudents();
}

function renderPeriodDeleteSelectedStudents() {
    const selectedList = document.getElementById('period-del-student-selected');
    if (!selectedList) return;
    if (!selectedPeriodDeleteStudents.length) {
        selectedList.textContent = '';
        updatePeriodDeletePreview();
        return;
    }
    const dupNames = getDuplicateNameSet();
    const chips = selectedPeriodDeleteStudents.map(id => {
        const student = students.find(s => String(s.id) === String(id));
        if (!student) return `<button type="button" class="schedule-selected-chip" onclick="removePeriodDeleteStudent('${id}')">${id} ×</button>`;
        const isDup = dupNames.has((student.name || '').trim());
        const extra = isDup && student.school ? ` · ${student.school}` : '';
        const label = `${student.name} ${student.grade}${extra}`;
        return `<button type="button" class="schedule-selected-chip${isDup ? ' chip-dup' : ''}" onclick="removePeriodDeleteStudent('${id}')">${label} ×</button>`;
    });
    selectedList.innerHTML = chips.join('');
    updatePeriodDeletePreview();
}

window.removePeriodDeleteStudent = function(id) {
    selectedPeriodDeleteStudents = selectedPeriodDeleteStudents.filter(sid => String(sid) !== String(id));
    renderPeriodDeleteSelectedStudents();
    updatePeriodDeletePreview();
}

window.closeModal = function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.querySelector('.modal-card, .attendance-card, .history-card, .day-detail-card');
    if (card) {
        el.style.transition = 'opacity 0.15s ease';
        el.style.opacity = '0';
        card.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
        card.style.transform = 'translateY(10px) scale(0.97)';
        card.style.opacity = '0';
        setTimeout(() => {
            el.style.display = 'none';
            el.style.opacity = '';
            el.style.transition = '';
            card.style.transform = '';
            card.style.opacity = '';
            card.style.transition = '';
        }, 150);
    } else {
        el.style.display = 'none';
    }
}
// 코드 관리 아코디언 토글
window.toggleCodeSection = function() {
    const section = document.getElementById('reg-code-section');
    if (section) section.classList.toggle('open');
}

window.prepareRegister = function() {
    document.getElementById('reg-title').textContent = "학생 등록";
    ['edit-id', 'reg-name', 'reg-school', 'reg-student-phone', 'reg-parent-phone', 'reg-guardian-name', 'reg-memo', 'reg-default-fee', 'reg-special-fee', 'reg-default-textbook-fee', 'reg-enroll-start-date', 'reg-enroll-end-date'].forEach(id => document.getElementById(id).value = "");
    clearStudentRequiredMarks();
    // 학년 드롭다운 초기화
    const gradeSelect = document.getElementById('reg-grade');
    if (gradeSelect) gradeSelect.selectedIndex = 0;
    const statusSelect = document.getElementById('reg-status');
    if (statusSelect) statusSelect.value = 'active';
    const today = new Date(); const off = today.getTimezoneOffset() * 60000;
    const todayStr = new Date(today.getTime() - off).toISOString().split('T')[0];
    document.getElementById('reg-register-date').value = todayStr;
    document.getElementById('reg-enroll-start-date').value = todayStr;
    document.getElementById('edit-mode-actions').style.display = 'none'; 
    document.getElementById('view-attendance-btn').style.display = 'none';
    const codeSection = document.getElementById('reg-code-section');
    if (codeSection) codeSection.style.display = 'none';
    openModal('register-modal');
}
window.prepareEdit = function(id) {
    const s = students.find(x => String(x.id) === String(id));
    if(!s) return;
    clearStudentRequiredMarks();
    document.getElementById('reg-title').textContent = "학생 정보 수정";
    document.getElementById('edit-id').value = s.id;
    document.getElementById('reg-name').value = s.name;
    document.getElementById('reg-school').value = s.school || '';
    document.getElementById('reg-grade').value = s.grade;
    document.getElementById('reg-student-phone').value = s.studentPhone || "";
    document.getElementById('reg-parent-phone').value = s.parentPhone || "";
    document.getElementById('reg-guardian-name').value = s.guardianName || "";
    document.getElementById('reg-status').value = s.status || 'active';
    document.getElementById('reg-enroll-start-date').value = s.enrollmentStartDate || s.registerDate || "";
    document.getElementById('reg-enroll-end-date').value = s.enrollmentEndDate || "";
    document.getElementById('reg-default-fee').value = s.defaultFee ? s.defaultFee.toLocaleString() : "";
    document.getElementById('reg-special-fee').value = s.specialLectureFee ? s.specialLectureFee.toLocaleString() : "";
    document.getElementById('reg-default-textbook-fee').value = s.defaultTextbookFee ? s.defaultTextbookFee.toLocaleString() : "";
    document.getElementById('reg-memo').value = s.memo || "";
    if (s.registerDate) {
        document.getElementById('reg-register-date').value = s.registerDate;
    } else {
        const today = new Date(); const off = today.getTimezoneOffset() * 60000;
        document.getElementById('reg-register-date').value = new Date(today.getTime() - off).toISOString().split('T')[0];
    }
    // 코드 관리 통합 섹션 표시 (인증코드 + QR)
    const codeSection = document.getElementById('reg-code-section');
    const codeInput = document.getElementById('reg-parent-code');
    const studentCodeInput = document.getElementById('reg-student-code');
    if (codeSection) {
        if (!s.parentCode) { s.parentCode = generateParentCode(); saveData(true); try { updateStudent(id, { parent_code: s.parentCode }); } catch(e) {} }
        if (codeInput) codeInput.value = s.parentCode;
        // 학생 인증코드: 없으면 자동 생성
        if (!s.studentCode) { s.studentCode = generateStudentCode(); saveData(true); try { updateStudent(id, { student_code: s.studentCode }); } catch(e) {} }
        if (studentCodeInput) studentCodeInput.value = s.studentCode;
        codeSection.style.display = '';
        codeSection.classList.remove('open'); // 접힌 상태로 시작
        // QR코드 렌더링 (비동기)
        renderEditModalQR(id);
    }
    document.getElementById('edit-mode-actions').style.display = 'block'; 
    document.getElementById('view-attendance-btn').style.display = 'inline-block';
    openModal('register-modal');
}

function clearStudentRequiredMarks() {
    const requiredIds = ['reg-name', 'reg-register-date', 'reg-enroll-start-date', 'reg-student-phone', 'reg-parent-phone', 'reg-enroll-end-date'];
    requiredIds.forEach((fieldId) => {
        const input = document.getElementById(fieldId);
        if (!input) return;
        input.classList.remove('is-required-missing');
        const group = input.closest('.input-group');
        if (group) group.classList.remove('is-required-missing-group');
    });
}

function markStudentRequiredField(fieldId) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    input.classList.add('is-required-missing');
    const group = input.closest('.input-group');
    if (group) group.classList.add('is-required-missing-group');
}

function normalizePhoneDigits(phoneValue) {
    return String(phoneValue || '').replace(/[^0-9]/g, '');
}

function isValidKoreanMobile(phoneValue) {
    const digits = normalizePhoneDigits(phoneValue);
    return /^01[0-9]\d{7,8}$/.test(digits);
}

function parseStudentMetaFromMemo(memoText) {
    const marker = '[학생확장메타]';
    const text = String(memoText || '');
    const lines = text.split('\n');
    const metaLine = lines.find((line) => line.startsWith(marker));
    if (!metaLine) return { guardianName: '', enrollmentStartDate: '', enrollmentEndDate: '' };
    const payload = metaLine.slice(marker.length);
    const parts = payload.split('|');
    const map = {};
    parts.forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= -1) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        map[key] = value;
    });
    return {
        guardianName: map.guardian_name || '',
        enrollmentStartDate: map.enroll_start || '',
        enrollmentEndDate: map.enroll_end || ''
    };
}

function stripStudentMetaFromMemo(memoText) {
    const marker = '[학생확장메타]';
    return String(memoText || '')
        .split('\n')
        .filter((line) => !line.startsWith(marker))
        .join('\n')
        .trim();
}

function buildMemoWithStudentMeta(memoText, meta) {
    const marker = '[학생확장메타]';
    const baseMemo = String(memoText || '')
        .split('\n')
        .filter((line) => !line.startsWith(marker))
        .join('\n')
        .trim();
    const metaLine = `${marker}guardian_name=${meta.guardianName || ''}|enroll_start=${meta.enrollmentStartDate || ''}|enroll_end=${meta.enrollmentEndDate || ''}`;
    return baseMemo ? `${baseMemo}\n${metaLine}` : metaLine;
}

function isStudentSchemaColumnError(error) {
    const msg = String((error && (error.message || error.details || error.hint)) || '').toLowerCase();
    return msg.includes('guardian_name') || msg.includes('enrollment_start_date') || msg.includes('enrollment_end_date');
}

function validateStudentRegisterForm(values) {
    const issues = [];
    if (!values.name) issues.push({ id: 'reg-name', reason: '이름을 입력해주세요.' });
    if (!values.registerDate) issues.push({ id: 'reg-register-date', reason: '등록일을 입력해주세요.' });
    if (!values.enrollmentStartDate) issues.push({ id: 'reg-enroll-start-date', reason: '시작일을 입력해주세요.' });
    if ((values.status === 'archived' || values.status === 'paused') && !values.enrollmentEndDate) {
        issues.push({ id: 'reg-enroll-end-date', reason: '휴원/퇴원 상태에서는 종료일을 입력해주세요.' });
    }
    if (values.enrollmentStartDate && values.enrollmentEndDate && values.enrollmentStartDate > values.enrollmentEndDate) {
        issues.push({ id: 'reg-enroll-end-date', reason: '종료일은 시작일보다 빠를 수 없습니다.' });
    }
    if (!values.studentPhone && !values.parentPhone) {
        issues.push({ id: 'reg-student-phone', reason: '학생/학부모 연락처 중 1개는 입력해주세요.' });
        issues.push({ id: 'reg-parent-phone', reason: '학생/학부모 연락처 중 1개는 입력해주세요.' });
    }
    if (values.studentPhone && !isValidKoreanMobile(values.studentPhone)) {
        issues.push({ id: 'reg-student-phone', reason: '학생 연락처 형식을 확인해주세요. (예: 010-1234-5678)' });
    }
    if (values.parentPhone && !isValidKoreanMobile(values.parentPhone)) {
        issues.push({ id: 'reg-parent-phone', reason: '학부모 연락처 형식을 확인해주세요. (예: 010-1234-5678)' });
    }
    return issues;
}

function parseAmountInput(value) {
    return value ? parseInt(String(value).replace(/,/g, ''), 10) || 0 : 0;
}

window.handleStudentSave = async function() {
    if (isStudentSaving) return;
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('reg-name').value.trim();
    const school = document.getElementById('reg-school').value.trim();
    const grade = document.getElementById('reg-grade').value;
    const status = document.getElementById('reg-status').value || 'active';
    const enrollmentStartDate = document.getElementById('reg-enroll-start-date').value.trim();
    const enrollmentEndDate = document.getElementById('reg-enroll-end-date').value.trim();
    const sPhone = document.getElementById('reg-student-phone').value.trim();
    const pPhone = document.getElementById('reg-parent-phone').value.trim();
    const guardianName = document.getElementById('reg-guardian-name').value.trim();
    const defaultFee = document.getElementById('reg-default-fee').value;
    const specialLectureFee = document.getElementById('reg-special-fee').value;
    const defaultTextbookFee = document.getElementById('reg-default-textbook-fee').value;
    const memo = document.getElementById('reg-memo').value.trim();
    const regDate = document.getElementById('reg-register-date').value.trim();

    clearStudentRequiredMarks();
    const validationIssues = validateStudentRegisterForm({
        name,
        status,
        registerDate: regDate,
        enrollmentStartDate,
        enrollmentEndDate,
        studentPhone: sPhone,
        parentPhone: pPhone
    });
    if (validationIssues.length > 0) {
        const firstIssue = validationIssues[0];
        validationIssues.forEach(issue => markStudentRequiredField(issue.id));
        showToast(firstIssue.reason, 'warning');
        const focusTarget = document.getElementById(firstIssue.id);
        if (focusTarget) focusTarget.focus();
        return;
    }

    // 동명이인 경고 (신규 등록 또는 이름 변경 시)
    const trimmedName = name;
    const isNewStudent = !id;
    const isNameChanged = id && (() => { const orig = students.find(x => String(x.id) === String(id)); return orig && orig.name.trim() !== trimmedName; })();
    if (isNewStudent || isNameChanged) {
        const sameNameStudents = students.filter(s => 
            s.status === 'active' && s.name.trim() === trimmedName && String(s.id) !== String(id)
        );
        if (sameNameStudents.length > 0) {
            const dupList = sameNameStudents.map(s => `• ${s.name} (${s.grade}${s.school ? ' · ' + s.school : ''})`).join('\n');
            const proceed = await showConfirm(
                `같은 이름의 학생이 이미 ${sameNameStudents.length}명 등록되어 있습니다.\n\n${dupList}\n\n학교명을 정확히 입력하면 구분이 쉬워집니다.\n그래도 저장하시겠습니까?`,
                { confirmText: '저장', cancelText: '취소', type: 'warning' }
            );
            if (!proceed) return;
        }
    }

    // 중복 등록 강한 차단: 이름+학년+연락처가 같은 활성 학생
    const normalizedStudentPhone = normalizePhoneDigits(sPhone);
    const normalizedParentPhone = normalizePhoneDigits(pPhone);
    const strictDuplicate = students.find((s) => {
        if (String(s.id) === String(id)) return false;
        if (s.status && s.status !== 'active') return false;
        const sameName = String(s.name || '').trim() === trimmedName;
        const sameGrade = String(s.grade || '') === String(grade || '');
        if (!sameName || !sameGrade) return false;
        const sStudentPhone = normalizePhoneDigits(s.studentPhone || s.phone || '');
        const sParentPhone = normalizePhoneDigits(s.parentPhone || s.parent_phone || '');
        const hasMatchingStudentPhone = normalizedStudentPhone && sStudentPhone === normalizedStudentPhone;
        const hasMatchingParentPhone = normalizedParentPhone && sParentPhone === normalizedParentPhone;
        return hasMatchingStudentPhone || hasMatchingParentPhone;
    });
    if (strictDuplicate) {
        showToast(`동일 학생으로 보이는 데이터가 이미 있습니다: ${strictDuplicate.name}(${strictDuplicate.grade})`, 'error');
        markStudentRequiredField('reg-name');
        return;
    }

    isStudentSaving = true;
    const saveButton = document.getElementById('student-save-btn');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.dataset.originalHtml = saveButton.innerHTML;
        saveButton.textContent = '저장 중...';
    }
    
    // 학부모 인증코드: 기존 학생은 유지, 신규/없으면 자동 생성
    let parentCode;
    let studentCode;
    if (id) {
        const existing = students.find(x => String(x.id) === String(id));
        parentCode = (existing && existing.parentCode) ? existing.parentCode : generateParentCode();
        studentCode = (existing && existing.studentCode) ? existing.studentCode : generateStudentCode();
    } else {
        parentCode = generateParentCode();
        studentCode = generateStudentCode();
    }

    const localData = {
        name,
        school,
        grade,
        status,
        guardianName,
        enrollmentStartDate,
        enrollmentEndDate,
        statusChangedDate: (status === 'archived' || status === 'paused') ? (enrollmentEndDate || null) : null,
        studentPhone: sPhone,
        parentPhone: pPhone,
        defaultFee: parseAmountInput(defaultFee),
        specialLectureFee: parseAmountInput(specialLectureFee),
        defaultTextbookFee: parseAmountInput(defaultTextbookFee),
        memo,
        registerDate: regDate,
        parentCode,
        studentCode
    };
    const dbData = {
        name,
        school,
        grade,
        status,
        phone: sPhone,  // 학생 연락처
        parent_phone: pPhone,
        guardian_name: guardianName || null,
        enrollment_start_date: enrollmentStartDate || null,
        enrollment_end_date: enrollmentEndDate || null,
        status_changed_date: (status === 'archived' || status === 'paused') ? (enrollmentEndDate || null) : null,
        default_fee: localData.defaultFee,
        special_lecture_fee: localData.specialLectureFee,
        default_textbook_fee: localData.defaultTextbookFee,
        memo,
        register_date: regDate,
        parent_code: parentCode,
        student_code: studentCode
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
            let updatedStudent;
            try {
                updatedStudent = await updateStudent(id, dbData);
            } catch (schemaError) {
                if (!isStudentSchemaColumnError(schemaError)) throw schemaError;
                // DB 컬럼 미반영 환경에서는 메모에 확장 메타를 임시 저장
                const fallbackMemo = buildMemoWithStudentMeta(memo, {
                    guardianName,
                    enrollmentStartDate,
                    enrollmentEndDate
                });
                const legacyDbData = { ...dbData, memo: fallbackMemo };
                delete legacyDbData.guardian_name;
                delete legacyDbData.enrollment_start_date;
                delete legacyDbData.enrollment_end_date;
                updatedStudent = await updateStudent(id, legacyDbData);
            }
            
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
            let addedStudent;
            try {
                addedStudent = await addStudent(dbData);
            } catch (schemaError) {
                if (!isStudentSchemaColumnError(schemaError)) throw schemaError;
                // DB 컬럼 미반영 환경에서는 메모에 확장 메타를 임시 저장
                const fallbackMemo = buildMemoWithStudentMeta(memo, {
                    guardianName,
                    enrollmentStartDate,
                    enrollmentEndDate
                });
                const legacyDbData = { ...dbData, memo: fallbackMemo };
                delete legacyDbData.guardian_name;
                delete legacyDbData.enrollment_start_date;
                delete legacyDbData.enrollment_end_date;
                addedStudent = await addStudent(legacyDbData);
            }
            
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
        showToast('학생 정보 저장에 실패했습니다: ' + error.message, 'error');
    } finally {
        isStudentSaving = false;
        if (saveButton) {
            saveButton.disabled = false;
            if (saveButton.dataset.originalHtml) {
                saveButton.innerHTML = saveButton.dataset.originalHtml;
                delete saveButton.dataset.originalHtml;
            }
        }
    }
}

// 수납 관리, 페이지 링크 함수 → js/payment.js로 이동

// 권한, 선생님 관리 모달, 포맷터, 주소검색 → js/teacher-manage.js로 이동
