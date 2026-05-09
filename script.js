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
let studentEvalChartDragBound = false;
let testScoreSyncState = { mode: 'unknown', message: '동기화 상태 확인 전' };
/** 종합평가 본문 글자 상한 — `index.html` textarea·Edge `EVAL_MAX_CHARS`와 동일 유지 */
const STUDENT_EVAL_COMMENT_MAX_CHARS = 2000;

/** AI 응답 맨 위 단독 "0"·전각 0·선행 빈 줄 제거(Edge와 이중 방어, 고정 지침 문구만으로는 모델이 재발시킬 수 있음) */
function stripLeadingEvalArtifact(s) {
    var lines = String(s || '').split(/\r?\n/);
    while (lines.length > 0) {
        var t = lines[0].trim();
        if (t === '' || t === '0' || t === '０') {
            lines.shift();
            continue;
        }
        break;
    }
    return lines.join('\n');
}
const TEST_SCORE_STORAGE_PREFIX = 'student_test_scores__';
const ADMIN_CROSS_TEACHER_EDIT_TTL_MS = 30 * 60 * 1000; // 30분
let adminCrossTeacherEditUntil = 0;

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
// QR 스캔 페이지가 열려있는지 확인 (GitHub origin/main과 동일 원칙: 인라인 display만 신뢰)
// — 인라인이 비어 있으면 CSS(#qr-scan-page)만으로는 '열림'으로 보지 않음. 그렇지 않으면 getComputedStyle이 flex여도
//   showToast/showConfirm 가드가 전부 막히는 현상이 재발할 수 있음.
function isQRScanPageOpen() {
    const scanPage = document.getElementById('qr-scan-page');
    if (!scanPage) return false;
    const inline = (scanPage.style && (scanPage.style.getPropertyValue('display') || scanPage.style.display)) || '';
    if (inline === 'none') return false;
    if (inline && inline !== 'none') return true;
    return false;
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

/** 로컬·레거시 키의 날짜를 YYYY-MM-DD로 통일 (database.js `normalizeScheduleDateKey`와 동일 목적) */
function normalizeScheduleDateKeyLocal(input) {
    if (typeof window.normalizeScheduleDateKey === 'function') {
        return window.normalizeScheduleDateKey(input);
    }
    if (input == null || input === '') return '';
    if (input instanceof Date) {
        if (Number.isNaN(input.getTime())) return '';
        const y = input.getFullYear();
        const m = String(input.getMonth() + 1).padStart(2, '0');
        const d = String(input.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const head10 = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head10) && s.length > 10) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) {
        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) {
            return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
        }
        return s;
    }
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * teacherScheduleData 내 날짜 키(비정규 문자열)를 정규화해 병합.
 * 로컬스토리지·구버전 데이터에 `2026-2-5` 형태가 남으면 구간 삭제 문자열 비교가 깨짐.
 */
function normalizeAllTeacherScheduleDataDateKeys() {
    Object.keys(teacherScheduleData || {}).forEach((tid) => {
        const byStudent = teacherScheduleData[tid];
        if (!byStudent || typeof byStudent !== 'object') return;
        Object.keys(byStudent).forEach((sid) => {
            const byDate = byStudent[sid];
            if (!byDate || typeof byDate !== 'object') return;
            Object.keys(byDate).forEach((dk) => {
                const nk = normalizeScheduleDateKeyLocal(dk);
                if (!nk || nk === dk) return;
                if (!byDate[nk]) {
                    byDate[nk] = byDate[dk];
                    delete byDate[dk];
                } else {
                    const ea = normalizeScheduleEntries(byDate[nk]);
                    const eb = normalizeScheduleEntries(byDate[dk]);
                    const seen = new Set();
                    const merged = [];
                    [...ea, ...eb].forEach((ent) => {
                        const st = normalizeScheduleTimeKey(ent?.start || '');
                        if (!st || st === 'default' || seen.has(st)) return;
                        seen.add(st);
                        merged.push(ent);
                    });
                    byDate[nk] = merged;
                    delete byDate[dk];
                }
            });
        });
    });
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
                .eq('schedule_date', normalizeScheduleDateKeyLocal(dateStr));

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

    // QR 스캔 페이지는 pageStates 밖에 있어 여기서만 숨기면 카메라·오버레이가 메인에 남을 수 있음
    if (typeof window.ensureQrScanFullyClosed === 'function') {
        void window.ensureQrScanFullyClosed();
    }
    
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
        // 일정 버킷이 아직 비어 있어도 teacherList의 담당 선생님은 집계 후보에 포함(매핑·지연 로드 정합)
        if (Array.isArray(teacherList)) {
            teacherList.forEach((t) => {
                const raw = String(t?.id ?? '').trim();
                if (!raw) return;
                const resolved = typeof resolveKnownTeacherId === 'function'
                    ? String(resolveKnownTeacherId(raw) || raw).trim()
                    : raw;
                if (resolved) ids.add(resolved);
            });
        }
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

function hasAdminCrossTeacherEditSession() {
    const role = String(getCurrentTeacherRole() || 'teacher');
    return role === 'admin' && Date.now() < adminCrossTeacherEditUntil;
}
window.hasAdminCrossTeacherEditSession = hasAdminCrossTeacherEditSession;

function grantAdminCrossTeacherEditSession() {
    adminCrossTeacherEditUntil = Date.now() + ADMIN_CROSS_TEACHER_EDIT_TTL_MS;
}

async function verifyCurrentTeacherPinForAdmin(message) {
    const role = String(getCurrentTeacherRole() || 'teacher');
    if (role !== 'admin') return false;
    const current = teacherList.find((t) => String(t.id) === String(currentTeacherId));
    if (!current) {
        showToast('관리자 정보를 찾을 수 없습니다.', 'error');
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
    const verifyResult = await verifyTeacherPinWithServer(current.id, String(input), {
        ownerUserId: cachedLsGet('current_owner_id'),
        requireAdmin: true
    });
    if (!verifyResult.ok) {
        const msg = mapVerifyTeacherPinFailureToMessage(verifyResult);
        showToast(msg || '관리자 비밀번호가 올바르지 않습니다.', 'error');
        return false;
    }
    return true;
}

async function verifyAdminPinForCrossTeacherAccess(ownerTeacherName) {
    const current = teacherList.find((t) => String(t.id) === String(currentTeacherId));
    if (!current || String(current.teacher_role || 'teacher') !== 'admin') {
        showToast('관리자 정보가 없어 타 선생님 일정을 열 수 없습니다.', 'error');
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
    const verifyResult = await verifyTeacherPinWithServer(current.id, String(input), {
        ownerUserId: cachedLsGet('current_owner_id'),
        requireAdmin: true
    });
    if (!verifyResult.ok) {
        const msg = mapVerifyTeacherPinFailureToMessage(verifyResult);
        showToast(msg || '관리자 비밀번호가 올바르지 않습니다.', 'error');
        return false;
    }
    grantAdminCrossTeacherEditSession();
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
    if (modalAdminOverride || hasAdminCrossTeacherEditSession()) {
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
    renderCalendar(true);
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

/**
 * 자동 결석 보정용: 슬롯당 `getAttendanceRecordByStudentAndDate` 2회 호출 대신 1회 조회 후 동일 병합.
 * (선생님 전체 일정 × 과거 슬롯에서 Network 폭주·메인 스레드 부담 완화)
 */
async function getMergedAttendanceRecordForAutoAbsentSlot(studentId, dateStr, teacherId, normalizedStartTime) {
    if (typeof supabase === 'undefined') return null;
    const ownerId = cachedLsGet('current_owner_id');
    const numericId = parseInt(studentId, 10);
    if (Number.isNaN(numericId)) return null;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;

    const raw = String(normalizedStartTime || '').trim();
    const variants = new Set();
    if (raw) {
        variants.add(raw);
        const hhmmMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
        const hhmmssMatch = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
        if (hhmmMatch) {
            variants.add(`${String(parseInt(hhmmMatch[1], 10)).padStart(2, '0')}:${hhmmMatch[2]}:00`);
        }
        if (hhmmssMatch) {
            variants.add(`${String(parseInt(hhmmssMatch[1], 10)).padStart(2, '0')}:${hhmmssMatch[2]}`);
        }
    }
    const timeVariants = Array.from(variants).filter(Boolean);
    if (timeVariants.length === 0) return null;

    try {
        let query = supabase
            .from('attendance_records')
            .select('*')
            .eq('student_id', numericId)
            .eq('attendance_date', dateStr)
            .in('scheduled_time', timeVariants);
        if (ownerId) query = query.eq('owner_user_id', ownerId);
        const { data: rows, error } = await query.limit(80);
        if (error || !rows || rows.length === 0) return null;

        const statusPriority = { present: 5, late: 4, makeup: 3, etc: 3, absent: 2, none: 1 };
        const pickPriority = (value) => statusPriority[String(value || '').toLowerCase()] || 0;
        const pickBestAmong = (candidates) => {
            if (!candidates.length) return null;
            return [...candidates].sort((a, b) => {
                const pa = pickPriority(a?.status);
                const pb = pickPriority(b?.status);
                if (pb !== pa) return pb - pa;
                const ta = new Date(a?.processed_at || a?.check_in_time || a?.updated_at || a?.created_at || 0).getTime();
                const tb = new Date(b?.processed_at || b?.check_in_time || b?.updated_at || b?.created_at || 0).getTime();
                return tb - ta;
            })[0];
        };

        const tid = String(teacherId || '').trim();
        const scoped = tid ? rows.filter((r) => String(r?.teacher_id || '').trim() === tid) : [];
        const ownerScopedRecord = scoped.length ? pickBestAmong(scoped) : null;
        const ownerAllRecord = pickBestAmong(rows);

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
        return dbRecord;
    } catch (e) {
        console.warn('[getMergedAttendanceRecordForAutoAbsentSlot] 조회 실패:', e);
        return null;
    }
}

async function autoMarkAbsentForPastSchedules() {
    if (!teacherScheduleData || Object.keys(teacherScheduleData).length === 0) return;

    const nowKst = getKstNow();
    const todayKst = formatDateToYYYYMMDD(nowKst);
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
                    if (typeof getMergedAttendanceRecordForAutoAbsentSlot === 'function') {
                        try {
                            const dbRecord = await getMergedAttendanceRecordForAutoAbsentSlot(
                                studentId,
                                dateStr,
                                String(teacherId),
                                normalizedStartTime
                            );
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
        
        // pagehide: 문서 숨김·bfcache 시 정리(Chrome Permissions-Policy에서 unload 리스너는 위반 로그 유발 → 등록하지 않음)
        window.addEventListener('pagehide', cleanupLocalStorage, false);
        
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
        if (!tooltip || tooltip.style.display !== 'block') return;
        // 위치 자동 flip — 화면 밑/오른쪽 잘림 방지
        const tipRect = tooltip.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 12;
        let left = e.pageX + 15;
        let top = e.pageY + 15;
        // 우측 잘림 → 커서 왼쪽으로 띄우기
        if (e.clientX + 15 + tipRect.width > vw - margin) {
            left = e.pageX - tipRect.width - 15;
            if (left < window.scrollX + margin) left = window.scrollX + margin;
        }
        // 하단 잘림 → 커서 위쪽으로 띄우기
        if (e.clientY + 15 + tipRect.height > vh - margin) {
            top = e.pageY - tipRect.height - 12;
            if (top < window.scrollY + margin) top = window.scrollY + margin;
        }
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
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
    const section = document.getElementById('schedule-register-section');
    if (section && !section._holidayChipDelegated) {
        section._holidayChipDelegated = true;
        section.addEventListener('click', (ev) => {
            const chip = ev.target.closest('.dset-color-chip[data-color]');
            if (!chip) return;
            if (!chip.closest('#holiday-text-color-options') && !chip.closest('#holiday-bg-color-options')) return;
            const c = chip.dataset.color;
            if (!c) return;
            if (chip.closest('#holiday-text-color-options')) setHolidayTextColor(c);
            else if (chip.closest('#holiday-bg-color-options')) setHolidayBgColor(c);
        });
    }
}

window.setHolidayTextColor = function (color) {
    document.querySelectorAll('#holiday-text-color-options .dset-color-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.color === color);
    });
    const inp = document.getElementById('holiday-text-color');
    if (inp) inp.value = color;
};

window.setHolidayBgColor = function (color) {
    const none = color == null || String(color).trim() === '';
    const v = none ? '' : String(color).trim();
    document.querySelectorAll('#holiday-bg-color-options .dset-color-chip:not(.dset-bg-none)').forEach((c) => {
        c.classList.toggle('active', !none && c.dataset.color === v);
    });
    const noneBtn = document.querySelector('#holiday-bg-color-options .dset-bg-none');
    if (noneBtn) noneBtn.classList.toggle('active', none);
    const inp = document.getElementById('holiday-bg-color');
    if (inp) inp.value = v;
};

/** 하위 호환: 글자·배경 동일 적용 */
function setHolidayColor(color) {
    setHolidayTextColor(color);
    setHolidayBgColor(color);
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

// 전역 단축키 — Esc(메뉴 닫기) + ←/→(월/주 이동) + T(오늘) + /(검색 포커스)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        try { window.closeFeaturePanel(); } catch (_) {}
    }

    // input/textarea/contenteditable 포커스 중에는 단축키 비활성
    const tag = (e.target && e.target.tagName) || '';
    const inEditable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)
        || (e.target && e.target.isContentEditable);
    if (inEditable) return;

    // 모달이 열려있으면 단축키 동작은 모달 우선 (각 모달이 자체 처리)
    const anyModalOpen = !!document.querySelector('.modal[style*="flex"], .modal.show');

    // 메인 앱이 보일 때만 캘린더 단축키
    const mainApp = document.getElementById('main-app');
    const mainVisible = mainApp && mainApp.style.display !== 'none';
    if (!mainVisible || anyModalOpen) return;

    if (e.key === 'ArrowLeft') {
        const btn = document.getElementById('prev-btn');
        if (btn && typeof btn.click === 'function') { e.preventDefault(); btn.click(); }
    } else if (e.key === 'ArrowRight') {
        const btn = document.getElementById('next-btn');
        if (btn && typeof btn.click === 'function') { e.preventDefault(); btn.click(); }
    } else if (e.key === 't' || e.key === 'T') {
        if (typeof goToday === 'function') { e.preventDefault(); goToday(); }
    } else if (e.key === '/') {
        // 현재 보이는 검색창 중 우선순위가 가장 높은 곳에 포커스
        // 모달/드로어 열려 있으면 그 안의 검색창, 아니면 메인 검색창
        const candidates = [
            '#tt-search-input',            // 시간표(day-detail) 모달
            '#drawer-search-input',        // 학생 관리 드로어
            '#sch-student-search',         // 일정 등록 모달
            '#period-del-student-search',  // 일정 삭제 모달
            '#pay-search-input',           // 결제 모달
            '#qr-student-search',          // QR 스캔 페이지
        ];
        let found = null;
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            // offsetParent === null 이면 display:none 또는 부모 숨김 — 가시성 체크
            if (el && el.offsetParent !== null) { found = el; break; }
        }
        if (found) {
            e.preventDefault();
            found.focus();
            if (typeof found.select === 'function') found.select();
        }
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


async function hashPin(pin) {
    const enc = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** verify-teacher-pin 실패 시 사용자 안내 문구 (Edge Function·네트워크 오류 포함) */
function mapVerifyTeacherPinFailureToMessage(verifyResult) {
    if (!verifyResult || verifyResult.ok) return '';
    const code = String(verifyResult.error || '').trim();
    const lower = code.toLowerCase();
    if (lower.includes('non-2xx') || lower.includes('failed to send') || lower.includes('fetch')) {
        return '서버 연결에 실패했습니다. 네트워크와 Edge Function(verify-teacher-pin) 배포를 확인해주세요.';
    }
    const map = {
        invalid_pin: '비밀번호가 일치하지 않습니다.',
        ownership_mismatch: '이 학원에 등록된 선생님이 아닙니다.',
        teacher_not_found: '선생님 정보를 찾을 수 없습니다.',
        admin_required: '관리자(원장) 권한이 필요합니다.',
        missing_fields: '입력 정보가 부족합니다.',
        missing_supabase_config: 'Supabase 설정을 불러오지 못했습니다. 페이지를 새로고침 해주세요.',
        session_expired_relogin: '로그인이 만료되었습니다. 상단에서 관리자 로그인으로 돌아가 다시 로그인해주세요.',
        http_401:
            '서버에서 요청을 거부했습니다(401). Supabase 대시보드 → Edge Functions → verify-teacher-pin → JWT 검증 끄기. 자세히: docs/SUPABASE_VERIFY_TEACHER_PIN_DASHBOARD.md',
        'Missing teacherId or pin': '입력 정보가 부족합니다.'
    };
    if (map[code]) return map[code];
    if (/missing.*teacherid|pin/i.test(code)) return '입력 정보가 부족합니다.';
    return '비밀번호 확인에 실패했습니다.';
}

async function verifyTeacherPinWithServer(teacherId, pin, options = {}) {
    const normalizedTeacherId = String(teacherId || '').trim();
    const normalizedPin = String(pin || '').trim();
    if (!normalizedTeacherId || !normalizedPin) {
        return { ok: false, error: 'Missing teacherId or pin' };
    }
    const body = {
        teacherId: normalizedTeacherId,
        pin: normalizedPin,
        ownerUserId: options.ownerUserId || undefined,
        requireAdmin: !!options.requireAdmin
    };
    try {
        if (typeof window.invokeVerifyTeacherPin === 'function') {
            return await window.invokeVerifyTeacherPin(supabase, body, undefined);
        }
        const { data, error } = await supabase.functions.invoke('verify-teacher-pin', { body });
        if (error) {
            return { ok: false, error: error.message || 'verify-teacher-pin failed' };
        }
        return {
            ok: !!(data && data.ok),
            teacher: data?.teacher || null,
            error: data?.error || null
        };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
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
            .select('id, owner_user_id, name, phone, email, google_email, google_sub, teacher_role, address, address_detail, created_at')
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
        // 등록 폼으로 돌아갈 때 이메일 등 입력 초기화
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

        if (typeof window.ensureQrScanFullyClosed === 'function') {
            await window.ensureQrScanFullyClosed();
        }
        
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
        
        // loadTeachers() 목록에 teacher_role이 이미 있으면 DB 재조회 생략(로그인 직후 진입 체감 속도)
        if (teacher.teacher_role == null || teacher.teacher_role === '') {
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
        } else {
            console.log('[setCurrentTeacher] teacher_role 목록값 사용:', teacher.teacher_role);
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
        // 주의: loadAllTeachersScheduleData를 loadTeacherScheduleData와 병렬로 돌리면 안 됨.
        // 선행 완료 시 merge로 teacherScheduleData[current]를 채운 뒤, loadTeacherScheduleData가
        // 시작 시 teacherScheduleData[teacherId]={} 로 초기화하면서 그 병합분이 통째로 사라지는 경합이 난다.
        
        // 1단계: 학생·출결·수납 로드 + (전체 일정 모드면) owner schedules 1회 선패치 — 순차 시 네트워크 왕복이 겹쳐 지연됨
        console.log('[setCurrentTeacher] 1단계: 학생 데이터 + 일정 선패치(병렬) 중...');
        const ownerIdForSchedules = cachedLsGet('current_owner_id');
        const shouldPrefetchOwnerSchedules = timetableScope === 'all' && !!ownerIdForSchedules;
        const [, ownerSchedulesPrefetch] = await Promise.all([
            loadAndCleanData(),
            shouldPrefetchOwnerSchedules && typeof fetchSchedulesForOwnerPaged === 'function'
                ? fetchSchedulesForOwnerPaged(ownerIdForSchedules)
                : Promise.resolve(null)
        ]);
        console.log('[setCurrentTeacher] 1단계 완료, 전체 학생:', students.length,
            shouldPrefetchOwnerSchedules ? `· 일정 선패치 ${(ownerSchedulesPrefetch || []).length}건` : '');
        
        // 2~3단계: 배정 학생 — 로컬 매핑만 보면 []로 나오는 경우가 많음(실제는 DB students.teacher_id에 있음).
        // 시간표·학생목록과 동일하게 getAssignedStudentIdsForTeacher(DB 우선 + 매핑 보조) 사용.
        const teacherStudentIds = typeof getAssignedStudentIdsForTeacher === 'function'
            ? getAssignedStudentIdsForTeacher(teacher.id)
            : [];
        console.log('[setCurrentTeacher] 2단계: 선생님에 할당된 학생 ID:', teacherStudentIds);
        const assignedSet = new Set((teacherStudentIds || []).map((id) => String(id)));
        currentTeacherStudents = students.filter((s) => assignedSet.has(String(s.id)));
        console.log('[setCurrentTeacher] 3단계: 현재 선생님의 학생 필터링 완료 -', currentTeacherStudents.length + '명');
        
        const perfStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        // 4단계: 현재 선생님 일정(getSchedulesByTeacher) + 전체 버킷 병합.
        // 선패치가 있으면 loadTeacher 내부 owner 전체 fetch 생략 → 동일 데이터 2중 조회 제거.
        console.log('[setCurrentTeacher] 4단계: 일정 데이터 로드 중...');
        const useSchedulePrefetch = shouldPrefetchOwnerSchedules && Array.isArray(ownerSchedulesPrefetch);
        await loadTeacherScheduleData(teacher.id, {
            skipOwnerPagedHydrate: useSchedulePrefetch,
            skipRefreshCurrentTeacherStudents: true
        });
        console.log('[setCurrentTeacher] 4단계 완료: 현재 선생님 일정 로드 완료');
        if (timetableScope === 'all' && typeof loadAllTeachersScheduleData === 'function') {
            try {
                await loadAllTeachersScheduleData(useSchedulePrefetch ? ownerSchedulesPrefetch : undefined);
            } catch (e) {
                console.warn('[setCurrentTeacher] 전체 일정 로드 실패:', e);
            }
        } else if (typeof refreshCurrentTeacherStudents === 'function') {
            await refreshCurrentTeacherStudents();
        }

        // 가벼운 타이머·미스캔은 메인 진입 전 등록(동기 비용 거의 없음).
        try {
            scheduleKstMidnightAutoAbsent();
        } catch (e) {
            console.warn('[setCurrentTeacher] 자동결석 타이머 실패:', e);
        }
        try {
            if (typeof window.initMissedScanChecks === 'function') {
                window.initMissedScanChecks();
            }
        } catch (e) {
            console.warn('[setCurrentTeacher] 미스캔 체크 초기화 실패:', e);
        }

        // 과거 일정 자동결석은 슬롯×DB조회로 수 초 걸릴 수 있어 — 화면 진입 후 idle에 실행해 체감 속도 우선.
        
        // 5단계: 페이지를 MAIN_APP으로 전환
        console.log('[setCurrentTeacher] 5단계: 페이지 전환 중...');
        navigateToPage('MAIN_APP');  // ✅ active_page를 'MAIN_APP'으로 저장

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        
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

        const runDeferredAutoAbsentAndRepaint = () => {
            Promise.resolve()
                .then(async () => {
                    try {
                        await autoMarkAbsentForPastSchedules();
                    } catch (e) {
                        console.warn('[setCurrentTeacher] 자동결석 보정(지연) 실패:', e);
                    }
                    try {
                        renderCalendar();
                    } catch (_) { /* ignore */ }
                    const perfDone = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    console.info(`[setCurrentTeacher][perf] post-auto-absent-render: ${Math.round(perfDone - perfStart)}ms`);
                });
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(runDeferredAutoAbsentAndRepaint, { timeout: 2500 });
        } else {
            setTimeout(runDeferredAutoAbsentAndRepaint, 0);
        }
        
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
    
    const userAc = document.getElementById('teacher-select-username-autocomplete');
    if (!teacherId) {
        // 선생님을 선택하지 않았으면 비밀번호 필드 숨기기
        teacherPasswordSection.style.display = 'none';
        if (userAc) userAc.value = '';
        return;
    }
    
    const teacher = teacherList.find(t => t.id === teacherId);
    if (!teacher) return;
    
    // 모든 선생님(관리자 포함)은 비밀번호 입력 필요
    console.log('[onTeacherSelected] 비밀번호 필드 표시');
    teacherPasswordSection.style.display = 'flex';
    document.getElementById('teacher-select-password').value = '';
    if (userAc) userAc.value = teacher.name || '';
}

let _confirmTeacherInFlight = false;

window.confirmTeacher = async function() {
    if (_confirmTeacherInFlight) return;
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

    _confirmTeacherInFlight = true;
    try {
        const verifyResult = await verifyTeacherPinWithServer(teacher.id, password, {
            ownerUserId: cachedLsGet('current_owner_id')
        });
        if (!verifyResult.ok) {
            showToast(mapVerifyTeacherPinFailureToMessage(verifyResult), 'warning');
            return;
        }
        
        console.log('[confirmTeacher] 비밀번호 인증 성공');
        await setCurrentTeacher(teacher);
    } finally {
        _confirmTeacherInFlight = false;
    }
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

        const resetUserAc = document.getElementById('reset-teacher-username-ac');
        if (resetUserAc) resetUserAc.value = (selectedTeacher && this.value) ? (selectedTeacher.name || '') : '';
        
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
    const resetUserAc = document.getElementById('reset-teacher-username-ac');
    if (resetUserAc) resetUserAc.value = '';
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
        
        const verifyResult = await verifyTeacherPinWithServer(teacher.id, currentPassword, {
            ownerUserId: ownerId
        });
        if (!verifyResult.ok) {
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

        document.getElementById('reset-teacher-current-password').value = '';
        document.getElementById('reset-teacher-password').value = '';
        document.getElementById('reset-teacher-password-confirm').value = '';
        document.getElementById('reset-teacher-dropdown').value = '';
        const rua = document.getElementById('reset-teacher-username-ac');
        if (rua) rua.value = '';
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
    if (!teacherEmail) { showToast('등록된 이메일이 없습니다.\n선생님 등록 시 이메일을 입력해주세요.', 'warning'); return; }

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

        // 4. 폼 초기화 및 모달 닫기
        document.getElementById('reset-teacher-current-password').value = '';
        document.getElementById('reset-teacher-password').value = '';
        document.getElementById('reset-teacher-password-confirm').value = '';
        document.getElementById('reset-teacher-email').value = '';
        document.getElementById('reset-teacher-dropdown').value = '';
        const rua2 = document.getElementById('reset-teacher-username-ac');
        if (rua2) rua2.value = '';
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
        dropdown.onchange = function() {
            const u = document.getElementById('force-reset-username-ac');
            if (!u) return;
            const tid = this.value;
            const te = teacherList.find(t => String(t.id) === String(tid));
            u.value = te ? (te.name || '') : '';
        };
    }
    const forceUserAc = document.getElementById('force-reset-username-ac');
    if (forceUserAc) forceUserAc.value = '';

    const modal = document.getElementById('force-reset-modal');
    if (modal) modal.style.display = 'flex';
}

window.closeForceResetModal = function() {
    const modal = document.getElementById('force-reset-modal');
    if (modal) modal.style.display = 'none';
    const dropdown = document.getElementById('force-reset-teacher-dropdown');
    const pwInput = document.getElementById('force-reset-admin-password');
    const forceUserAc = document.getElementById('force-reset-username-ac');
    if (dropdown) dropdown.value = '';
    if (pwInput) pwInput.value = '';
    if (forceUserAc) forceUserAc.value = '';
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

        // 선생님 등록 폼 등: 이메일 입력란이 있으면 반영(구글 인증 버튼은 제거됨)
        const newEmailEl = document.getElementById('new-teacher-email');
        if (newEmailEl) newEmailEl.value = userInfo.email;
        const subEl = document.getElementById('new-teacher-google-sub');
        if (subEl) subEl.value = userInfo.sub;

        const authBtn = document.getElementById('google-auth-btn');
        const verifiedSection = document.getElementById('google-verified-email');
        const verifiedText = document.getElementById('verified-email-text');
        if (authBtn && verifiedSection && verifiedText) {
            authBtn.style.display = 'none';
            verifiedSection.style.display = 'block';
            verifiedText.textContent = userInfo.email;
        }

        console.log('[handleGoogleAuthCallback] Google 이메일 반영:', userInfo.email);

    } catch (err) {
        console.error('[handleGoogleAuthCallback] 예외:', err);
        showToast('Google 사용자 정보 조회 실패: ' + err.message, 'error');
    }
}

// 선생님 등록 폼 리셋 시 사용(이메일 직접 입력 + 선택적 구글 UI 잔존 시)
function resetGoogleAuth() {
    const em = document.getElementById('new-teacher-email');
    if (em) em.value = '';
    const sub = document.getElementById('new-teacher-google-sub');
    if (sub) sub.value = '';

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
        const teacherEmail = document.getElementById('new-teacher-email').value.trim();
        const phone = document.getElementById('new-teacher-phone').value.trim();
        const address = document.getElementById('new-teacher-address').value.trim();
        const addressDetail = document.getElementById('new-teacher-address-detail').value.trim();
        const teacherPassword = document.getElementById('register-teacher-password').value.trim();
        const teacherPasswordConfirm = document.getElementById('register-teacher-password-confirm')?.value.trim() || '';
        
        console.log('[registerTeacher] 입력 값 - name:', name, ', email:', teacherEmail, ', phone:', phone, ', address:', address);
        
        if (!name) { showToast('선생님 이름은 필수입니다.', 'warning'); return; }

        if (!teacherEmail) {
            showToast('이메일을 입력해주세요.', 'warning');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) {
            showToast('올바른 이메일 형식을 입력해주세요.', 'warning');
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
                email: teacherEmail || null,
                google_email: teacherEmail || null,
                google_sub: null,
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
const DEFAULT_SCHEDULE_FONT_SIZE = 13;

function normalizeHolidayEntryOne(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    if (!name) return null;
    const fontSize = Number(raw.fontSize != null ? raw.fontSize : raw.font_size);
    const textColor = String(raw.textColor || raw.color || defaultColor).trim() || defaultColor;
    const bgRaw = raw.bgColor != null && raw.bgColor !== '' ? raw.bgColor : raw.bg_color;
    const bgColor = bgRaw != null && String(bgRaw).trim() !== '' ? String(bgRaw).trim() : null;
    return {
        id: raw.id != null && raw.id !== '' ? Number(raw.id) : null,
        name,
        color: textColor,
        textColor,
        bgColor,
        scheduleType: raw.scheduleType === 'personal' ? 'personal' : 'academy',
        fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, Math.round(fontSize))) : DEFAULT_SCHEDULE_FONT_SIZE
    };
}

function normalizeHolidayDayToArray(raw) {
    if (raw == null) return [];
    if (typeof raw === 'string') {
        const n = raw.trim();
        return n
            ? [
                  {
                      id: null,
                      name: n,
                      color: defaultColor,
                      textColor: defaultColor,
                      bgColor: null,
                      scheduleType: 'academy',
                      fontSize: DEFAULT_SCHEDULE_FONT_SIZE
                  }
              ]
            : [];
    }
    if (Array.isArray(raw)) {
        return raw.map(normalizeHolidayEntryOne).filter(Boolean);
    }
    const one = normalizeHolidayEntryOne(raw);
    return one ? [one] : [];
}

/** 사용자 등록 일정만 (공공 API/양력 폴백 제외) */
function getCustomHolidayEntriesOnly(dateStr) {
    if (!customHolidays || !Object.prototype.hasOwnProperty.call(customHolidays, dateStr)) return [];
    return normalizeHolidayDayToArray(customHolidays[dateStr]);
}

function mergePublicHolidayEntries(dateStr) {
    const [year] = dateStr.split('-');
    if (apiHolidayCache[year] && apiHolidayCache[year][dateStr]) {
        return [{ name: apiHolidayCache[year][dateStr], color: defaultColor, scheduleType: 'public', fontSize: DEFAULT_SCHEDULE_FONT_SIZE, id: null }];
    }
    const mmdd = dateStr.substring(5);
    const solarHolidays = { '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일', '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절' };
    if (solarHolidays[mmdd]) {
        return [{ name: solarHolidays[mmdd], color: defaultColor, scheduleType: 'public', fontSize: DEFAULT_SCHEDULE_FONT_SIZE, id: null }];
    }
    if (LUNAR_HOLIDAYS_DB[year] && LUNAR_HOLIDAYS_DB[year][mmdd]) {
        return [{ name: LUNAR_HOLIDAYS_DB[year][mmdd], color: defaultColor, scheduleType: 'public', fontSize: DEFAULT_SCHEDULE_FONT_SIZE, id: null }];
    }
    return [];
}

/** 캘린더 셀 표시용: 사용자 일정 우선, 없으면 공휴일 */
function getHolidayCellEntries(dateStr) {
    const custom = getCustomHolidayEntriesOnly(dateStr);
    if (custom.length) return custom;
    return mergePublicHolidayEntries(dateStr);
}

function getHolidayInfo(dateStr) {
    const entries = getHolidayCellEntries(dateStr);
    if (!entries.length) return null;
    return {
        name: entries.map((e) => e.name).join(' · '),
        color: entries[0].textColor || entries[0].color,
        scheduleType: entries[0].scheduleType,
        fontSize: entries[0].fontSize,
        entries
    };
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

    // 학사일정 배지 — 셀 추가 후 비동기로 NEIS 데이터 페치 (캐시되어 있으면 즉시)
    if (typeof window.renderAcademicBadgesOnCalendar === 'function') {
        Promise.resolve()
            .then(() => window.renderAcademicBadgesOnCalendar())
            .catch((e) => console.warn('[renderCalendar] 학사일정 배지 실패:', e));
    }
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
            const byDay = teacherSched[String(student.id)] || {};
            let entries = [];
            for (const [rawKey, cellVal] of Object.entries(byDay)) {
                if (normalizeScheduleDateKeyLocal(rawKey) !== dateStr) continue;
                entries = entries.concat(normalizeScheduleEntries(cellVal));
            }
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
    // 전체 선생님 모드에서도 집계 완료 전에는 teacherScheduleData에 있는 만큼 표시(빈 맵 반환 금지 — 일정 누락 방지)

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
            const scheduleDateEntries = Object.entries(byDate);
            if (!scheduleDateEntries.length) continue;
            for (const [rawDateKey, cellVal] of scheduleDateEntries) {
                const dateStr = normalizeScheduleDateKeyLocal(rawDateKey);
                if (!dateStr || !targetDates.has(dateStr)) continue;
                if (!shouldShowScheduleForStudent(student, dateStr)) continue;
                const entries = normalizeScheduleEntries(cellVal);
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
    const holidayEntries = getHolidayCellEntries(dateStr);
    const customHolidayEntries = getCustomHolidayEntriesOnly(dateStr);
    const isPublicHolidayOnly =
        customHolidayEntries.length === 0 &&
        holidayEntries.length > 0 &&
        holidayEntries.every((e) => e.scheduleType === 'public');
    let dayClass = '';
    if (day === 0 || holidayEntries.length) dayClass = 'is-holiday';
    else if (day === 6) dayClass = 'sat';

    if (dateStr === (todayStr || getTodayStr())) dayClass += ' is-today';

    if (customHolidayEntries.length) {
        cell.classList.add('custom-holiday');
        const first = customHolidayEntries[0];
        const textC = first.textColor || first.color || defaultColor;
        const bgRaw = first.bgColor != null ? String(first.bgColor).trim() : '';
        cell.style.setProperty('--holiday-text-color', textC);
        if (bgRaw === '') {
            cell.classList.add('custom-holiday-no-bg');
        } else {
            cell.classList.remove('custom-holiday-no-bg');
            cell.style.setProperty('--holiday-bg-mix', bgRaw);
        }
    } else if (isPublicHolidayOnly) {
        cell.classList.add('public-holiday-cell');
    }

    const holidayStackHtml = holidayEntries.length
        ? `<div class="holiday-names-stack">${holidayEntries.map((e) => {
            const fs = e.fontSize || DEFAULT_SCHEDULE_FONT_SIZE;
            const col = e.textColor || e.color || defaultColor;
            return `<span class="holiday-name" style="color:${col};font-size:${fs}px">${escapeHtml(e.name)}</span>`;
        }).join('')}</div>`
        : '';

    cell.innerHTML = `
        <span class="date-num ${dayClass}">${date.getDate()}</span>
        ${holidayStackHtml}
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
    // 학사일정 섹션 — 시간표 모달 상단에 해당 날짜 학사일정 chip 표시
    if (typeof window.renderDayDetailAcademicSection === 'function') {
        Promise.resolve()
            .then(() => window.renderDayDetailAcademicSection(dateStr))
            .catch((e) => console.warn('[openDayDetail] 학사일정 섹션 실패:', e));
    }
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
        label.dataset.hour = String(h);
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

    // 일정이 없는 임시 체크도 시간표 화면에서 보이도록 상단 배너 노출
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
        tempBanner.style.fontSize = '12px';
        tempBanner.style.fontWeight = '700';
        tempBanner.style.zIndex = '4';
        tempBanner.style.pointerEvents = 'none';
        tempBanner.textContent = `임시 체크 ${uniqueStudents.length}건 · ` +
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

    // ============================================================
    // 시간대별 밀집도 분석 — 신규 학생 배정용 운영 정보 패널
    //   - 각 시간(h)에 동시에 들어있는 학생수 합산
    //   - 운영 시간대(이벤트 첫 시작 ~ 마지막 종료) 안의 빈 시간 추천
    // ============================================================
    try {
        _renderDayDensityInsights(layoutEvents, axis);
    } catch (densityErr) {
        console.warn('[renderDayEvents] 밀집도 분석 실패:', densityErr);
    }
}

/** layoutEvents 기반 시간대별 학생수 분포 + 요약 패널 + 시간축 chip 렌더 */
function _renderDayDensityInsights(layoutEvents, axisEl) {
    const summary = document.getElementById('tt-density-summary');
    if (!summary) return;
    if (!Array.isArray(layoutEvents) || layoutEvents.length === 0) {
        summary.classList.add('is-empty');
        summary.textContent = '오늘은 등록된 일정이 없습니다.';
        // 기존 chip 정리
        if (axisEl) {
            axisEl.querySelectorAll('.time-label').forEach(lbl => {
                lbl.classList.remove('tt-free-hour', 'tt-peak-hour');
                const old = lbl.querySelector('.tt-hour-density');
                if (old) old.remove();
            });
        }
        return;
    }
    // 시간(h) 단위 학생수 합산 — event 가 걸친 모든 시간에 member 수 더함
    // 1시간 슬롯 1개에 30분 짜리 2개가 겹쳐도 동시간 학생수 정확히 반영하기 위해
    // 분 해상도로 계산 후 시간 단위로 max 집계 (peak concurrency).
    const minuteCount = new Array(24 * 60 + 1).fill(0);
    const uniqueStudentIds = new Set();
    layoutEvents.forEach(ev => {
        const start = Math.max(0, ev.startMin | 0);
        const end = Math.min(24 * 60, start + (ev.duration | 0));
        const memberCount = Array.isArray(ev.members) ? ev.members.length : 1;
        for (let m = start; m < end; m++) {
            minuteCount[m] += memberCount;
        }
        if (Array.isArray(ev.members)) {
            ev.members.forEach(mb => {
                const id = mb && mb.student && mb.student.id;
                if (id) uniqueStudentIds.add(String(id));
            });
        }
    });

    // 시간(h) 별 동시 최대 학생수
    const hourPeak = new Array(25).fill(0);
    for (let h = 0; h < 24; h++) {
        let maxAt = 0;
        for (let m = h * 60; m < (h + 1) * 60; m++) {
            if (minuteCount[m] > maxAt) maxAt = minuteCount[m];
        }
        hourPeak[h] = maxAt;
    }

    // 운영 시간대 = 첫 이벤트 시작 시간(h) ~ 마지막 이벤트 종료 시간(h)
    let firstHour = 24, lastHour = 0;
    layoutEvents.forEach(ev => {
        const sH = Math.floor(ev.startMin / 60);
        const eH = Math.ceil((ev.startMin + ev.duration) / 60);
        if (sH < firstHour) firstHour = sH;
        if (eH > lastHour) lastHour = eH;
    });
    if (firstHour >= lastHour) { firstHour = 14; lastHour = 22; }

    // 피크/여유 시간 도출 (운영 시간대 내)
    let peakHour = -1, peakCount = 0;
    const freeHours = [];
    for (let h = firstHour; h < lastHour; h++) {
        const c = hourPeak[h];
        if (c > peakCount) { peakCount = c; peakHour = h; }
        if (c === 0) freeHours.push(h);
    }

    // 가장 한가한(0이 아닌 가장 적은) 시간 도출 — 빈 시간이 없을 경우 fallback
    let lightestHour = -1, lightestCount = Infinity;
    for (let h = firstHour; h < lastHour; h++) {
        if (hourPeak[h] < lightestCount) { lightestCount = hourPeak[h]; lightestHour = h; }
    }

    // 추천 시간: 빈 시간 우선, 없으면 가장 한가한 시간 1-2개
    const recommend = freeHours.length > 0
        ? freeHours.slice(0, 3)
        : (lightestHour >= 0 ? [lightestHour] : []);

    // 요약 패널 렌더
    summary.classList.remove('is-empty');
    const fmt = (h) => `${String(h).padStart(2, '0')}시`;
    let html = '';
    html += `<span class="tt-density-stat"><i class="fas fa-user-group"></i>전체 ${uniqueStudentIds.size}명 / ${layoutEvents.length}수업</span>`;
    html += `<span class="tt-density-stat"><i class="fas fa-clock"></i>운영 ${fmt(firstHour)}–${fmt(lastHour)}</span>`;
    if (peakHour >= 0 && peakCount > 0) {
        html += `<span class="tt-density-stat peak"><i class="fas fa-arrow-trend-up"></i>피크 ${fmt(peakHour)} (${peakCount}명)</span>`;
    }
    if (recommend.length > 0) {
        const recLabel = recommend.map(fmt).join(', ');
        html += `<span class="tt-density-stat recommend"><i class="fas fa-bullseye"></i>신규 추천 <strong>${recLabel}</strong></span>`;
    }
    summary.innerHTML = html;

    // 시간축 chip — 운영 시간대 안의 시간에 학생수 chip 부착
    if (axisEl) {
        axisEl.querySelectorAll('.time-label').forEach(lbl => {
            lbl.classList.remove('tt-free-hour', 'tt-peak-hour');
            const old = lbl.querySelector('.tt-hour-density');
            if (old) old.remove();
            const h = parseInt(lbl.dataset.hour || '-1', 10);
            if (h < firstHour || h >= lastHour) return;
            const c = hourPeak[h];
            const lvl = c === 0 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : c <= 6 ? 3 : 4;
            const chip = document.createElement('span');
            chip.className = `tt-hour-density lvl-${lvl}`;
            chip.textContent = c === 0 ? '여유' : `${c}명`;
            chip.title = c === 0 ? '이 시간대는 비어 있습니다' : `이 시간대 동시 학생 ${c}명`;
            lbl.appendChild(chip);
            if (c === 0) lbl.classList.add('tt-free-hour');
            else if (h === peakHour && peakCount > 0) lbl.classList.add('tt-peak-hour');
        });
    }
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
        const verified = hasAdminCrossTeacherEditSession()
            ? true
            : await verifyAdminPinForCrossTeacherAccess(ownerTeacherName);
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

    // 개인/공유 메모는 반드시 student_evaluations에서만 로드합니다.
    // 출석기록(memo/shared_memo)과의 섞임을 구조적으로 차단합니다.
    const memoDiv = document.getElementById('att-memo');
    const sharedMemoDiv = document.getElementById('att-shared-memo');
    const sharedOthersDiv = document.getElementById('att-shared-memo-others');

    let savedRecord = '';
    let mySharedMemo = '';
    let othersHtml = '';

    try {
        if (typeof window.getStudentClassMemos === 'function') {
            const evalMonth = String(dateStr || '').slice(0, 7);
            const timeKey = normalizedRequestedStart || 'default';
            const { class_memos, class_shared_memos } = await window.getStudentClassMemos(sid, evalMonth);

            savedRecord = class_memos?.[dateStr]?.[timeKey] || '';

            const slotShared = class_shared_memos?.[dateStr]?.[timeKey] || {};
            const myId = String(currentTeacherId || '');
            const teacherIds = Object.keys(slotShared);

            if (teacherIds.length > 0) {
                const otherTeacherEntries = [];
                for (const tid of teacherIds) {
                    const memoText = slotShared[tid] || '';
                    if (tid === myId) {
                        mySharedMemo = memoText;
                    } else {
                        otherTeacherEntries.push({ teacherId: tid, memo: memoText });
                    }
                }

                if (otherTeacherEntries.length > 0) {
                    othersHtml = '<div class="shared-memo-header"><i class="fas fa-users"></i> 다른 선생님 공유 메모</div>';
                    otherTeacherEntries.forEach((m) => {
                        const tName = getTeacherNameById(m.teacherId) || '알 수 없음';
                        othersHtml += `<div class="shared-memo-item"><span class="shared-memo-teacher">${tName}</span><div class="shared-memo-text">${m.memo}</div></div>`;
                    });
                }
            }
        }
    } catch (e) {
        console.error('[openAttendanceModal] 수업관리 메모(student_evaluations) 로드 실패:', e);
    }

    memoDiv.innerHTML = savedRecord;
    if (sharedOthersDiv) sharedOthersDiv.innerHTML = othersHtml;
    if (sharedMemoDiv) sharedMemoDiv.innerHTML = mySharedMemo;

    // 직전 수업 메모 chip — 반복 메모 1초 입력 (s.records 에서 dateStr 이전 unique 3개)
    try {
        const chipsEl = document.getElementById('memo-recent-chips');
        if (chipsEl) {
            const recent = _collectRecentMemos(s, dateStr, 3);
            if (recent.length === 0) {
                chipsEl.style.display = 'none';
                chipsEl.innerHTML = '';
            } else {
                chipsEl.style.display = 'flex';
                chipsEl.innerHTML =
                    '<span class="memo-recent-chip-label">최근:</span>' +
                    recent.map((memo) => {
                        const short = String(memo).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
                        // textContent 처리 위해 이스케이프
                        const safe = short.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        // memoFull 은 click 시 contenteditable 로 적재 — 원본 HTML 보존
                        const fullSafe = String(memo)
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        return `<button type="button" class="memo-recent-chip" data-memo-full="${fullSafe}" onclick="_insertRecentMemoIntoEditor(this)">
                            <i class="fas fa-arrow-rotate-left" aria-hidden="true"></i>${safe}${short.length === 28 ? '…' : ''}
                        </button>`;
                    }).join('');
            }
        }
    } catch (chipErr) {
        console.warn('[openAttendanceModal] 최근 메모 chip 생성 실패:', chipErr);
    }

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

        renderCalendar(true);
        if (document.getElementById('day-detail-modal').style.display === 'flex') { if (currentDetailDate === newDateStr || currentDetailDate === oldDateStr) renderDayEvents(currentDetailDate); }
        if (typeof window.onScheduleSlotChangedForAttendanceCheck === 'function') {
            window.onScheduleSlotChangedForAttendanceCheck({
                studentId: sid,
                oldDateStr,
                newDateStr,
                oldStart: originalStart,
                newStart,
                oldTeacherIds: uniqueOldOwnerCandidates,
                newTeacherId: targetTeacherId
            });
        }
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
        // ※ 수업관리 메모는 student_evaluations로 이동하므로, 출석 상태 저장 시에는 메모를 건드리지 않습니다.
        // 반드시 scheduled_time(수업 시작시간)까지 포함하여 upsert
        const lastSavedRecord = await persistAttendanceStatusToDbForTeacher(
            sid,
            dateStr,
            status,
            ownerTeacherId,
            resolvedStartTime,
            null
        );

        // 수업관리 메모(JSON) 저장
        try {
            if (typeof window.getStudentClassMemos === 'function' && typeof window.saveStudentClassMemos === 'function') {
                const evalMonth = String(dateStr || '').slice(0, 7);
                const timeKey = resolvedStartTime || 'default';

                const teacherKey = String(ownerTeacherId || currentTeacherId || '');
                const memoText = memo || '';
                const sharedMemoText = sharedMemo || '';

                const existing = await window.getStudentClassMemos(sid, evalMonth);
                const classMemos = existing.class_memos || {};
                const classSharedMemos = existing.class_shared_memos || {};

                if (!classMemos[dateStr]) classMemos[dateStr] = {};
                if (!classSharedMemos[dateStr]) classSharedMemos[dateStr] = {};

                if (memoText.trim()) {
                    classMemos[dateStr][timeKey] = memoText;
                } else {
                    if (classMemos[dateStr]) delete classMemos[dateStr][timeKey];
                    if (classMemos[dateStr] && Object.keys(classMemos[dateStr]).length === 0) delete classMemos[dateStr];
                }

                if (!classSharedMemos[dateStr][timeKey]) classSharedMemos[dateStr][timeKey] = {};
                if (sharedMemoText.trim()) {
                    classSharedMemos[dateStr][timeKey][teacherKey] = sharedMemoText;
                } else {
                    if (classSharedMemos[dateStr]?.[timeKey]) delete classSharedMemos[dateStr][timeKey][teacherKey];
                    if (classSharedMemos[dateStr]?.[timeKey] && Object.keys(classSharedMemos[dateStr][timeKey]).length === 0) delete classSharedMemos[dateStr][timeKey];
                    if (classSharedMemos[dateStr] && Object.keys(classSharedMemos[dateStr]).length === 0) delete classSharedMemos[dateStr];
                }

                await window.saveStudentClassMemos(sid, evalMonth, classMemos, classSharedMemos, teacherKey);
            }
        } catch (e) {
            console.error('[setAttendance] 수업관리 메모 저장 실패:', e);
        }

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
        sourceEl.textContent = '출석 방식: 임시 체크';
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
            if (statusValue !== 'absent' && statusValue !== 'none') return false;
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
            console.warn('[cleanupLegacyAbsentShadowRecord] stale absent/none 정리 실패:', deleteError);
        } else {
            console.log('[cleanupLegacyAbsentShadowRecord] stale absent/none 정리 완료:', shadowIds.length);
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

    // NOTE: 수업관리 메모는 attendance_records.class_*가 아니라
    // student_evaluations.class_* JSON으로 이동합니다. 따라서 출석 상태 저장 시에는 메모를 건드리지 않습니다.
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
        processedAt: new Date().toISOString()
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

        // DB에도 수업관리 메모 저장(student_evaluations)
        try {
            if (typeof window.getStudentClassMemos === 'function' && typeof window.saveStudentClassMemos === 'function') {
                const evalMonth = String(dateStr || '').slice(0, 7);
                const timeKey = resolvedStartTime || 'default';
                const teacherKey = String(ownerTeacherId || currentTeacherId || '');

                const existing = await window.getStudentClassMemos(sid, evalMonth);
                const classMemos = existing.class_memos || {};
                const classSharedMemos = existing.class_shared_memos || {};

                if (!classMemos[dateStr]) classMemos[dateStr] = {};
                if (!classSharedMemos[dateStr]) classSharedMemos[dateStr] = {};
                if (!classSharedMemos[dateStr][timeKey]) classSharedMemos[dateStr][timeKey] = {};

                if (privateMemo && privateMemo.trim()) {
                    classMemos[dateStr][timeKey] = privateMemo;
                } else {
                    if (classMemos[dateStr]) delete classMemos[dateStr][timeKey];
                    if (classMemos[dateStr] && Object.keys(classMemos[dateStr]).length === 0) delete classMemos[dateStr];
                }

                if (sharedMemo && sharedMemo.trim()) {
                    classSharedMemos[dateStr][timeKey][teacherKey] = sharedMemo;
                } else {
                    if (classSharedMemos[dateStr]?.[timeKey]) delete classSharedMemos[dateStr][timeKey][teacherKey];
                    if (classSharedMemos[dateStr]?.[timeKey] && Object.keys(classSharedMemos[dateStr][timeKey]).length === 0) delete classSharedMemos[dateStr][timeKey];
                    if (classSharedMemos[dateStr] && Object.keys(classSharedMemos[dateStr]).length === 0) delete classSharedMemos[dateStr];
                }

                await window.saveStudentClassMemos(sid, evalMonth, classMemos, classSharedMemos, teacherKey);
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

    let totalCount = 0;
    let cancelledByUser = false; // 사용자가 겹침 취소로 중단했는지 추적
    let dbSyncFailed = false;
    try {
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
            try {
                if (typeof saveSchedulesToDatabaseBatch === 'function') {
                    await saveSchedulesToDatabaseBatch(scheduleBatch);
                } else if (typeof saveScheduleToDatabase === 'function') {
                    const syncResults = await Promise.allSettled(scheduleBatch.map(item => saveScheduleToDatabase(item)));
                    if (syncResults.some(r => r.status === 'rejected')) {
                        dbSyncFailed = true;
                    }
                }
            } catch (dbError) {
                dbSyncFailed = true;
                console.error('[generateSchedule] DB 동기화 실패(로컬 반영은 완료):', dbError);
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
        renderCalendar(true);
        await loadAllTeachersScheduleData();
        if (typeof window.initMissedScanChecks === 'function') window.initMissedScanChecks();
        if (typeof scheduleKstMidnightAutoAbsent === 'function') scheduleKstMidnightAutoAbsent();
        const suffix = excludeHolidays && totalCount === 0 ? ' (공휴일이 제외되었을 수 있습니다)' : '';
        if (totalCount > 0) {
            showToast(`${totalCount}개의 일정이 생성되었습니다.`, 'success');
            if (dbSyncFailed) {
                showToast('일정은 추가되었지만 서버 동기화에 실패했습니다. 새로고침 후 다시 확인해주세요.', 'warning');
            }
        }
        else if (!cancelledByUser) showToast(`새로 등록된 일정이 없습니다.${suffix}`, 'info');
    } catch (e) {
        console.error('[generateSchedule] 일정 생성 처리 예외:', e);
        // 로컬 반영은 이미 된 경우가 있으므로 캘린더를 다시 렌더링해 사용자 혼란을 줄인다.
        renderCalendar(true);
        if (totalCount > 0) {
            showToast(`${totalCount}개의 일정이 추가되었습니다. 다만 후처리 중 오류가 발생했습니다.`, 'warning');
        } else {
            showToast('일정 생성 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
        }
    } finally {
        isScheduleSaving = false;
        if (activeBtn) { activeBtn.disabled = false; if (activeBtn.dataset.originalHtml) { activeBtn.innerHTML = activeBtn.dataset.originalHtml; delete activeBtn.dataset.originalHtml; } }
        if (otherBtn) otherBtn.disabled = false;
    }
}

window.generateSchedule = function() { return _generateScheduleCore(false); };
window.generateScheduleWithoutHolidays = function() { return _generateScheduleCore(true); };

function countStudentSchedulesInRangeForTeacher(teacherId, studentId, startStr, endStr) {
    if (!teacherId || !studentId || !startStr || !endStr || startStr > endStr) return 0;
    const nStart = normalizeScheduleDateKeyLocal(startStr);
    const nEnd = normalizeScheduleDateKeyLocal(endStr);
    if (!nStart || !nEnd || nStart > nEnd) return 0;
    const teacherSchedules = teacherScheduleData[teacherId] || {};
    const studentSchedules = teacherSchedules[String(studentId)] || {};
    let count = 0;
    Object.keys(studentSchedules).forEach((dateStr) => {
        const n = normalizeScheduleDateKeyLocal(dateStr);
        if (!n || n < nStart || n > nEnd) return;
        const entries = getScheduleEntries(teacherId, String(studentId), dateStr);
        count += entries.length;
    });
    return count;
}

function countStudentSchedulesInRange(studentId, startStr, endStr) {
    if (!currentTeacherId) return 0;
    return countStudentSchedulesInRangeForTeacher(currentTeacherId, studentId, startStr, endStr);
}

/** 모든 선생님 시간표에 걸친 일정 수(기간 삭제 집계용) */
function countStudentSchedulesInRangeAllTeachers(studentId, startStr, endStr) {
    let n = 0;
    Object.keys(teacherScheduleData || {}).forEach((tid) => {
        n += countStudentSchedulesInRangeForTeacher(tid, studentId, startStr, endStr);
    });
    return n;
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
    const nStart = normalizeScheduleDateKeyLocal(startDate);
    const nEnd = normalizeScheduleDateKeyLocal(endDate);
    if (!nStart || !nEnd || !teacherId) return [];

    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('schedule_date, start_time')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericStudentId)
            .eq('teacher_id', String(teacherId))
            .gte('schedule_date', nStart)
            .lte('schedule_date', nEnd);
        if (error) {
            console.error('[collectScheduleSlotsByRangeFromDb] 조회 실패:', error);
            return [];
        }
        return (Array.isArray(data) ? data : [])
            .map((row) => ({
                studentId,
                dateStr: normalizeScheduleDateKeyLocal(String(row?.schedule_date || '').trim()) || row?.schedule_date,
                teacherId: String(teacherId),
                startTime: normalizeScheduleTimeKey(row?.start_time || '')
            }))
            .filter((row) => row.dateStr && row.startTime && row.startTime !== 'default');
    } catch (e) {
        console.error('[collectScheduleSlotsByRangeFromDb] 예외:', e);
        return [];
    }
}

/** 기간·학생 기준 DB 일정 슬롯 (모든 선생님 teacher_id) — 출석 정리용 */
async function collectScheduleSlotsByRangeFromDbAllTeachers(studentId, startDate, endDate) {
    if (typeof supabase === 'undefined') return [];
    const ownerId = cachedLsGet('current_owner_id');
    if (!ownerId) return [];
    const numericStudentId = parseInt(studentId, 10);
    if (Number.isNaN(numericStudentId)) return [];
    const nStart = normalizeScheduleDateKeyLocal(startDate);
    const nEnd = normalizeScheduleDateKeyLocal(endDate);
    if (!nStart || !nEnd) return [];
    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('schedule_date, start_time, teacher_id')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericStudentId)
            .gte('schedule_date', nStart)
            .lte('schedule_date', nEnd);
        if (error) {
            console.error('[collectScheduleSlotsByRangeFromDbAllTeachers] 조회 실패:', error);
            return [];
        }
        return (Array.isArray(data) ? data : [])
            .map((row) => ({
                studentId,
                dateStr: normalizeScheduleDateKeyLocal(String(row?.schedule_date || '').trim()) || row?.schedule_date,
                teacherId: String(row?.teacher_id || '').trim(),
                startTime: normalizeScheduleTimeKey(row?.start_time || '')
            }))
            .filter((row) => row.dateStr && row.teacherId && row.startTime && row.startTime !== 'default');
    } catch (e) {
        console.error('[collectScheduleSlotsByRangeFromDbAllTeachers] 예외:', e);
        return [];
    }
}

function collectLocalStudentIdsAcrossTeachersInRange(startDate, endDate, studentIdsFilter) {
    const filter = Array.isArray(studentIdsFilter) && studentIdsFilter.length ? studentIdsFilter.map(String) : null;
    const out = new Set();
    Object.keys(teacherScheduleData || {}).forEach((tId) => {
        const bucket = teacherScheduleData[tId] || {};
        Object.keys(bucket).forEach((sid) => {
            if (filter && !filter.includes(String(sid))) return;
            if (countStudentSchedulesInRangeForTeacher(tId, sid, startDate, endDate) > 0) out.add(String(sid));
        });
    });
    return Array.from(out);
}

/** 삭제 범위에 현재 선생님이 아닌 teacher_id로 등록된 일정이 있는지 (스키마상 일정 행의 teacher_id = 그 선생님 시간표) */
async function hasOtherTeacherSchedulesInPeriodDeleteScope(startDate, endDate, scope, targetStudentIdsForFilter) {
    if (typeof window.fetchDistinctTeacherIdsFromSchedulesInRangeForOwner !== 'function') return false;
    const studentFilter =
        scope === 'student' && Array.isArray(targetStudentIdsForFilter) && targetStudentIdsForFilter.length
            ? targetStudentIdsForFilter.map(String)
            : null;
    const tids = await window.fetchDistinctTeacherIdsFromSchedulesInRangeForOwner(startDate, endDate, studentFilter);
    const cur = normalizeTeacherIdForCompare(currentTeacherId);
    if (!cur) return false;
    return tids.some((t) => normalizeTeacherIdForCompare(t) !== cur);
}

/** 로컬 메모리: 기간 내 다른 선생님 시간표 버킷에 일정이 있는지 (등록 주체 = teacher_id) */
function hasOtherTeacherSchedulesLocalInRange(startDate, endDate, scope, targetStudentIdsForFilter) {
    const cur = normalizeTeacherIdForCompare(currentTeacherId);
    if (!cur) return false;
    const filter =
        scope === 'student' && Array.isArray(targetStudentIdsForFilter) && targetStudentIdsForFilter.length
            ? new Set(targetStudentIdsForFilter.map(String))
            : null;
    for (const tId of Object.keys(teacherScheduleData || {})) {
        if (normalizeTeacherIdForCompare(tId) === cur) continue;
        const bucket = teacherScheduleData[tId] || {};
        for (const sid of Object.keys(bucket)) {
            if (filter && !filter.has(String(sid))) continue;
            if (countStudentSchedulesInRangeForTeacher(tId, sid, startDate, endDate) > 0) return true;
        }
    }
    return false;
}

/** DB·로컬 합쳐서 「내가 아닌 선생님이 등록한 일정」이 기간에 있는지 */
async function hasAnyOtherTeacherScheduleInPeriod(startDate, endDate, scope, targetStudentIdsForFilter) {
    if (hasOtherTeacherSchedulesLocalInRange(startDate, endDate, scope, targetStudentIdsForFilter)) return true;
    return hasOtherTeacherSchedulesInPeriodDeleteScope(startDate, endDate, scope, targetStudentIdsForFilter);
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

        await reloadScheduleDataAfterOwnerMutation();
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
        const originalOwnerTeacherId = String(document.getElementById('att-original-owner-teacher-id')?.value || ownerTeacherId || '').trim();
        const scheduleOwnerCandidates = getScheduleOwnerCandidatesBySlot(String(sid), dateStr, originalStart || '');
        const ownerCandidateSet = new Set();
        [
            targetTeacherId,
            ownerTeacherId,
            originalOwnerTeacherId,
            ...scheduleOwnerCandidates
        ].forEach((candidate) => {
            const raw = String(candidate || '').trim();
            if (!raw) return;
            ownerCandidateSet.add(raw);
            const normalized = String(resolveKnownTeacherId(raw) || '').trim();
            if (normalized) ownerCandidateSet.add(normalized);
        });
        const ownerCandidates = Array.from(ownerCandidateSet);
        const normalizedOriginalStart = normalizeScheduleTimeKey(originalStart || '');

        // 1. Supabase 일정·출석 삭제를 먼저 완료 (성공 후에만 로컬 반영 — DB에 행이 남는 문제 방지)
        try {
            await Promise.all(
                ownerCandidates.map((teacherIdCandidate) =>
                    deleteScheduleFromDatabase(sid, dateStr, teacherIdCandidate, originalStart || null)
                )
            );
            await Promise.all(
                ownerCandidates.map((teacherIdCandidate) =>
                    deleteAttendanceRecordBySlotFromDb(sid, dateStr, teacherIdCandidate, originalStart || null)
                )
            );
        } catch (dbErr) {
            console.error('[deleteSingleSchedule] Supabase 삭제 실패:', dbErr);
            showToast('Supabase에서 일정을 삭제하지 못했습니다. 네트워크·로그인 상태를 확인해주세요.', 'error');
            try {
                await reloadScheduleDataAfterOwnerMutation();
            } catch (_) {
                /* noop */
            }
            renderCalendar();
            closeModal('attendance-modal');
            return;
        }

        // 2. 로컬 메모리에서 삭제
        removeTimeScopedValue(students[sIdx].attendance, dateStr, originalStart || '');
        removeTimeScopedValue(students[sIdx].records, dateStr, originalStart || '');
        removeTimeScopedValue(students[sIdx].shared_records, dateStr, originalStart || '');
        ownerCandidates.forEach((teacherIdCandidate) => {
            const entries = getScheduleEntries(teacherIdCandidate, String(sid), dateStr);
            if (!entries.length) return;
            const nextEntries = originalStart
                ? entries.filter((item) => normalizeScheduleTimeKey(item?.start || '') !== normalizedOriginalStart)
                : [];
            setScheduleEntries(teacherIdCandidate, String(sid), dateStr, nextEntries);
        });

        saveData();
        ownerCandidates.forEach((teacherIdCandidate) => persistTeacherScheduleLocalFor(teacherIdCandidate));
        renderCalendar();
        if (document.getElementById('day-detail-modal').style.display === 'flex') renderDayEvents(dateStr);

        showToast(permission.adminOverride ? '일정이 삭제되었습니다. (관리자 권한)' : '일정이 삭제되었습니다.', 'success');
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

let _periodDelPreviewTimer = null;
let _periodDelPreviewSeq = 0;

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
    const tid = currentTeacherId;

    if (scope === 'all' && tid) {
        const seq = ++_periodDelPreviewSeq;
        previewEl.textContent = '삭제 예정 일정: …';
        if (warningEl) {
            warningEl.textContent = '기간 내 일정을 집계하는 중입니다…';
            warningEl.classList.remove('danger');
        }
        if (_periodDelPreviewTimer) clearTimeout(_periodDelPreviewTimer);
        _periodDelPreviewTimer = setTimeout(() => {
            _periodDelPreviewTimer = null;
            (async () => {
                try {
                    const { total, mergedIds } = await getPeriodDeleteMergedStats(startDate, endDate, { scope: 'all' });
                    const mergedCount = mergedIds.length;
                    if (seq !== _periodDelPreviewSeq) return;
                    previewEl.textContent = `삭제 예정 일정: ${total}건`;
                    if (warningEl) {
                        warningEl.textContent = buildDeleteImpactText({
                            scopeLabel: formatDeleteScopeLabel(scope, mergedCount),
                            startStr: startDate,
                            endStr: endDate,
                            totalCount: total,
                            monthSpan: getMonthSpanCount(startDate, endDate)
                        });
                        warningEl.classList.toggle('danger', total > 0);
                    }
                } catch (e) {
                    console.error('[updatePeriodDeletePreview] 전체 범위 집계 실패:', e);
                    if (seq !== _periodDelPreviewSeq) return;
                    const fallbackKeys = Object.keys(teacherScheduleData[tid] || {});
                    let total = 0;
                    fallbackKeys.forEach((sid) => {
                        total += countStudentSchedulesInRange(sid, startDate, endDate);
                    });
                    previewEl.textContent = `삭제 예정 일정: ${total}건`;
                    if (warningEl) {
                        warningEl.textContent = buildDeleteImpactText({
                            scopeLabel: formatDeleteScopeLabel(scope, fallbackKeys.length),
                            startStr: startDate,
                            endStr: endDate,
                            totalCount: total,
                            monthSpan: getMonthSpanCount(startDate, endDate)
                        });
                        warningEl.classList.toggle('danger', total > 0);
                    }
                }
            })();
        }, 220);
        return;
    }

    if (scope === 'student' && tid && selectedPeriodDeleteStudents.length) {
        const seq = ++_periodDelPreviewSeq;
        previewEl.textContent = '삭제 예정 일정: …';
        if (warningEl) {
            warningEl.textContent = '기간 내 일정을 집계하는 중입니다…';
            warningEl.classList.remove('danger');
        }
        if (_periodDelPreviewTimer) clearTimeout(_periodDelPreviewTimer);
        _periodDelPreviewTimer = setTimeout(() => {
            _periodDelPreviewTimer = null;
            (async () => {
                try {
                    const sel = selectedPeriodDeleteStudents.map(String);
                    const { total, mergedIds } = await getPeriodDeleteMergedStats(startDate, endDate, {
                        scope: 'student',
                        studentIds: sel
                    });
                    if (seq !== _periodDelPreviewSeq) return;
                    previewEl.textContent = `삭제 예정 일정: ${total}건`;
                    if (warningEl) {
                        warningEl.textContent = buildDeleteImpactText({
                            scopeLabel: formatDeleteScopeLabel(scope, mergedIds.length),
                            startStr: startDate,
                            endStr: endDate,
                            totalCount: total,
                            monthSpan: getMonthSpanCount(startDate, endDate)
                        });
                        warningEl.classList.toggle('danger', total > 0);
                    }
                } catch (e) {
                    console.error('[updatePeriodDeletePreview] 학생 범위 집계 실패:', e);
                    if (seq !== _periodDelPreviewSeq) return;
                    let total = 0;
                    selectedPeriodDeleteStudents.forEach((sid) => {
                        total += countStudentSchedulesInRange(sid, startDate, endDate);
                    });
                    previewEl.textContent = `삭제 예정 일정: ${total}건`;
                    if (warningEl) {
                        warningEl.textContent = buildDeleteImpactText({
                            scopeLabel: formatDeleteScopeLabel(scope, selectedPeriodDeleteStudents.length),
                            startStr: startDate,
                            endStr: endDate,
                            totalCount: total,
                            monthSpan: getMonthSpanCount(startDate, endDate)
                        });
                        warningEl.classList.toggle('danger', total > 0);
                    }
                }
            })();
        }, 220);
        return;
    }

    const targetStudentIds =
        scope === 'all' ? Object.keys(teacherScheduleData[tid] || {}) : [...selectedPeriodDeleteStudents];
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

/** 기간·현재 선생님 기준 schedules 테이블에 있는 학생 ID (DB 기준, 로컬 누락 보정용) */
async function fetchDistinctStudentIdsFromSchedulesInRange(teacherId, startDate, endDate) {
    if (typeof supabase === 'undefined') return [];
    const ownerId = cachedLsGet('current_owner_id');
    const nStart = normalizeScheduleDateKeyLocal(startDate);
    const nEnd = normalizeScheduleDateKeyLocal(endDate);
    if (!ownerId || !teacherId || !nStart || !nEnd) return [];
    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('student_id')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', String(teacherId))
            .gte('schedule_date', nStart)
            .lte('schedule_date', nEnd);
        if (error) {
            console.error('[fetchDistinctStudentIdsFromSchedulesInRange]', error);
            return [];
        }
        const set = new Set((data || []).map((r) => String(r.student_id)));
        return Array.from(set);
    } catch (e) {
        console.error('[fetchDistinctStudentIdsFromSchedulesInRange] 예외:', e);
        return [];
    }
}

/** 현재 선생님·기간에 `schedules` 테이블 행 수 (로컬 버킷에 없는 학생·담당 외 일정 포함) */
async function countScheduleRowsInRangeFromDb(teacherId, startDate, endDate) {
    if (typeof supabase === 'undefined') return 0;
    const ownerId = cachedLsGet('current_owner_id');
    const nStart = normalizeScheduleDateKeyLocal(startDate);
    const nEnd = normalizeScheduleDateKeyLocal(endDate);
    if (!ownerId || !teacherId || !nStart || !nEnd || nStart > nEnd) return 0;
    try {
        const { count, error } = await supabase
            .from('schedules')
            .select('*', { count: 'exact', head: true })
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', String(teacherId))
            .gte('schedule_date', nStart)
            .lte('schedule_date', nEnd);
        if (error) {
            console.error('[countScheduleRowsInRangeFromDb]', error);
            return 0;
        }
        return typeof count === 'number' ? count : 0;
    } catch (e) {
        console.error('[countScheduleRowsInRangeFromDb] 예외:', e);
        return 0;
    }
}

/**
 * 기간 삭제 집계: owner 전체 시간표(모든 teacher_id) + 로컬 전 선생님 버킷.
 * @param {{ scope?: 'all'|'student', studentIds?: string[] }} options
 * @returns {{ total: number, mergedIds: string[], dbIds: string[], localKeys: string[] }}
 */
async function getPeriodDeleteMergedStats(startDate, endDate, options = {}) {
    const scope = options.scope || 'all';
    const pickIds = options.studentIds;
    const nStart = normalizeScheduleDateKeyLocal(startDate);
    const nEnd = normalizeScheduleDateKeyLocal(endDate);
    if (!nStart || !nEnd || nStart > nEnd) {
        return { total: 0, mergedIds: [], dbIds: [], localKeys: [] };
    }
    const studentFilter = scope === 'student' && Array.isArray(pickIds) && pickIds.length ? pickIds.map(String) : null;

    let dbIds = [];
    let dbTotal = 0;
    if (typeof window.fetchDistinctStudentIdsFromSchedulesInRangeForOwner === 'function') {
        dbIds = await window.fetchDistinctStudentIdsFromSchedulesInRangeForOwner(startDate, endDate, studentFilter);
    } else {
        dbIds = await fetchDistinctStudentIdsFromSchedulesInRange(currentTeacherId, startDate, endDate);
    }
    if (typeof window.countScheduleRowsInRangeFromDbForOwner === 'function') {
        dbTotal = await window.countScheduleRowsInRangeFromDbForOwner(startDate, endDate, studentFilter);
    } else {
        dbTotal = await countScheduleRowsInRangeFromDb(currentTeacherId, startDate, endDate);
    }

    const localKeySet = new Set();
    Object.keys(teacherScheduleData || {}).forEach((tId) => {
        const bucket = teacherScheduleData[tId] || {};
        Object.keys(bucket).forEach((sid) => {
            if (studentFilter && !studentFilter.includes(String(sid))) return;
            if (countStudentSchedulesInRangeForTeacher(tId, sid, startDate, endDate) > 0) localKeySet.add(String(sid));
        });
    });
    const localKeys = Array.from(localKeySet);

    const merged = new Set([...localKeys, ...dbIds.map(String)]);
    let localSum = 0;
    merged.forEach((sid) => {
        localSum += countStudentSchedulesInRangeAllTeachers(sid, startDate, endDate);
    });
    return {
        total: Math.max(localSum, dbTotal),
        mergedIds: Array.from(merged),
        dbIds,
        localKeys
    };
}

/**
 * 기간 삭제 미리보기·확인용 건수: 로컬 합계와 DB 행 수 중 큰 값.
 */
async function countScheduleRowsInRangeMerged(startDate, endDate, options) {
    const s = await getPeriodDeleteMergedStats(startDate, endDate, options || { scope: 'all' });
    return s.total;
}

/**
 * @param {object} opts
 * @param {'all'|'student'} opts.scope
 * @param {string} opts.startDate
 * @param {string} opts.endDate
 * @param {string[]} opts.targetStudentIds — student 범위일 때 선택 학생
 * @param {'owner'|'currentTeacherOnly'} opts.targetMode — owner: 다른 선생님 일정 포함 시 전체 삭제 / currentTeacherOnly: 내가 등록한 일정만
 */
async function runPeriodDeleteExecute(opts) {
    let {
        scope,
        startDate,
        endDate,
        targetStudentIds: inputTargetIds = [],
        targetMode = 'owner'
    } = opts;
    startDate = normalizeScheduleDateKeyLocal(startDate);
    endDate = normalizeScheduleDateKeyLocal(endDate);
    const tid = currentTeacherId;

    const filterForFetch = scope === 'student' ? inputTargetIds.map(String) : null;

    let loopStudentIds = [];
    if (targetMode === 'currentTeacherOnly') {
        const localSids = Object.keys(teacherScheduleData[tid] || {}).filter(
            (sid) => countStudentSchedulesInRangeForTeacher(tid, sid, startDate, endDate) > 0
        );
        let dbSids = [];
        if (typeof window.fetchDistinctStudentIdsFromSchedulesInRangeForTeacher === 'function') {
            dbSids = await window.fetchDistinctStudentIdsFromSchedulesInRangeForTeacher(tid, startDate, endDate, filterForFetch);
        } else {
            dbSids = await fetchDistinctStudentIdsFromSchedulesInRange(tid, startDate, endDate);
        }
        loopStudentIds = Array.from(new Set([...localSids.map(String), ...dbSids.map(String)]));
        if (scope === 'student') {
            const sel = new Set(inputTargetIds.map(String));
            loopStudentIds = loopStudentIds.filter((sid) => sel.has(String(sid)));
        }
    } else {
        let dbStudentIds = [];
        if (typeof window.fetchDistinctStudentIdsFromSchedulesInRangeForOwner === 'function') {
            dbStudentIds = await window.fetchDistinctStudentIdsFromSchedulesInRangeForOwner(startDate, endDate, filterForFetch);
        } else {
            dbStudentIds = await fetchDistinctStudentIdsFromSchedulesInRange(tid, startDate, endDate);
        }
        const localSids = collectLocalStudentIdsAcrossTeachersInRange(startDate, endDate, filterForFetch);
        loopStudentIds = Array.from(new Set([...localSids, ...dbStudentIds.map(String)]));
        if (scope === 'student') {
            const sel = new Set(inputTargetIds.map(String));
            loopStudentIds = loopStudentIds.filter((sid) => sel.has(String(sid)));
        }
    }

    let deletedCount = 0;
    let scheduleDbDeleteAttempted = false;
    const deleteRequests = [];
    const attendanceDeleteTargets = [];
    const touchedTeacherIds = new Set();

    const canOwnerBulk = typeof window.deleteSchedulesByOwnerRange === 'function';
    const canTeacherBulk = typeof window.deleteSchedulesByTeacherRange === 'function';

    if (targetMode === 'currentTeacherOnly') {
        if (scope === 'all') {
            if (canTeacherBulk) {
                deleteRequests.push(window.deleteSchedulesByTeacherRange(startDate, endDate, tid));
                scheduleDbDeleteAttempted = true;
            } else if (typeof deleteSchedulesByRange === 'function' && loopStudentIds.length) {
                for (const sid of loopStudentIds) {
                    deleteRequests.push(deleteSchedulesByRange(sid, startDate, endDate, tid));
                }
                scheduleDbDeleteAttempted = true;
            }
        } else if (scope === 'student' && inputTargetIds.length) {
            for (const sid of inputTargetIds.map(String)) {
                if (typeof deleteSchedulesByRange === 'function') {
                    deleteRequests.push(deleteSchedulesByRange(sid, startDate, endDate, tid));
                    scheduleDbDeleteAttempted = true;
                }
            }
        }
    } else {
        let studentIdsForOwnerDelete = null;
        if (scope === 'all') {
            studentIdsForOwnerDelete = null;
        } else {
            studentIdsForOwnerDelete = inputTargetIds.map(String);
        }

        if (canOwnerBulk) {
            const skipDb =
                studentIdsForOwnerDelete !== null && Array.isArray(studentIdsForOwnerDelete) && studentIdsForOwnerDelete.length === 0;
            if (!skipDb) {
                deleteRequests.push(window.deleteSchedulesByOwnerRange(startDate, endDate, { studentIds: studentIdsForOwnerDelete }));
                scheduleDbDeleteAttempted = true;
            }
        } else if (typeof deleteSchedulesByRange === 'function' && loopStudentIds.length) {
            const teacherIdsFallback = [
                ...new Set([
                    ...(Array.isArray(teacherList) ? teacherList.map((t) => String(t.id)) : []),
                    ...Object.keys(teacherScheduleData || {})
                ])
            ].filter(Boolean);
            for (const otid of teacherIdsFallback) {
                for (const sid of loopStudentIds) {
                    deleteRequests.push(deleteSchedulesByRange(sid, startDate, endDate, otid));
                }
            }
            scheduleDbDeleteAttempted = true;
        }
    }

    const teacherKeysForLocal =
        targetMode === 'currentTeacherOnly' ? [tid] : Object.keys(teacherScheduleData || {});

    for (const sid of loopStudentIds) {
        const student = students.find((s) => String(s.id) === String(sid));
        let dbSlotTargets;
        if (targetMode === 'currentTeacherOnly') {
            dbSlotTargets = await collectScheduleSlotsByRangeFromDb(sid, startDate, endDate, tid);
        } else {
            dbSlotTargets = await collectScheduleSlotsByRangeFromDbAllTeachers(sid, startDate, endDate);
        }
        if (dbSlotTargets.length > 0) {
            attendanceDeleteTargets.push(...dbSlotTargets);
        }

        teacherKeysForLocal.forEach((loopTid) => {
            if (!teacherScheduleData[loopTid] || !teacherScheduleData[loopTid][sid]) return;
            const eventsToDelete = Object.keys(teacherScheduleData[loopTid][sid]).filter((dateStr) => {
                const n = normalizeScheduleDateKeyLocal(dateStr);
                return n && !(n < startDate || n > endDate);
            });
            eventsToDelete.forEach((dateStr) => {
                const entries = getScheduleEntries(loopTid, String(sid), dateStr);
                if (entries.length > 0) {
                    entries.forEach((entry) => {
                        const st = normalizeScheduleTimeKey(entry?.start || '');
                        if (!st || st === 'default') return;
                        attendanceDeleteTargets.push({
                            studentId: sid,
                            dateStr,
                            teacherId: loopTid,
                            startTime: st
                        });
                        if (student) {
                            removeTimeScopedValue(student.attendance, dateStr, st);
                            removeTimeScopedValue(student.records, dateStr, st);
                            removeTimeScopedValue(student.shared_records, dateStr, st);
                        }
                    });
                    setScheduleEntries(loopTid, String(sid), dateStr, []);
                    deletedCount += entries.length;
                    touchedTeacherIds.add(String(loopTid));
                }
            });
        });
    }

    if (attendanceDeleteTargets.length > 0) {
        const uniqueTargets = Array.from(
            new Map(attendanceDeleteTargets.map((t) => [`${t.studentId}|${t.dateStr}|${t.teacherId}|${t.startTime}`, t])).values()
        );
        deleteRequests.push(
            Promise.all(uniqueTargets.map((t) => deleteAttendanceRecordBySlotFromDb(t.studentId, t.dateStr, t.teacherId, t.startTime)))
        );
    }

    closeModal('period-delete-modal');

    const persistLocalTouched = () => {
        if (touchedTeacherIds.size > 0) {
            touchedTeacherIds.forEach((id) => persistTeacherScheduleLocalFor(id));
        } else {
            persistTeacherScheduleLocal();
        }
    };

    try {
        if (deleteRequests.length > 0) {
            await Promise.all(deleteRequests);
        }
        await reloadScheduleDataAfterOwnerMutation();
        renderCalendar();

        if (deletedCount > 0) {
            saveData();
            persistLocalTouched();
            showToast(`총 ${deletedCount}개의 일정이 삭제되었습니다.`, 'success');
        } else if (scheduleDbDeleteAttempted) {
            saveData();
            persistLocalTouched();
            showToast(
                targetMode === 'currentTeacherOnly'
                    ? '내가 등록한 일정이 삭제되었습니다.'
                    : '선택한 기간의 일정이 삭제되었습니다.',
                'success'
            );
        } else {
            showToast('삭제할 일정이 없습니다.', 'info');
        }
    } catch (e) {
        console.error('[runPeriodDeleteExecute] DB 삭제 실패:', e);
        showToast('일정 삭제에 실패했습니다. 네트워크·로그인 상태를 확인한 뒤 다시 시도해주세요.', 'error');
        try {
            await reloadScheduleDataAfterOwnerMutation();
            renderCalendar();
        } catch (reloadErr) {
            console.error('[runPeriodDeleteExecute] 일정 재로드 실패:', reloadErr);
        }
    }
}

// 기간별 일정 삭제 실행 — 「내가 등록한 일정」vs「다른 선생님이 등록한 일정」만 구분
window.executePeriodDelete = async function() {
    if (!ensureOwnedScheduleDeleteContext('기간별 일정 삭제')) return;
    const scope = document.getElementById('period-del-scope').value;
    const startDate = normalizeScheduleDateKeyLocal(document.getElementById('period-del-start').value);
    const endDate = normalizeScheduleDateKeyLocal(document.getElementById('period-del-end').value);

    if (!startDate || !endDate) {
        showToast('삭제 기간을 입력해주세요.', 'warning');
        return;
    }

    if (startDate > endDate) {
        showToast('시작 날짜가 종료 날짜보다 늦습니다.', 'warning');
        return;
    }

    let targetStudentIds = [];
    if (scope === 'student') {
        if (!selectedPeriodDeleteStudents.length) {
            showToast('학생을 선택해주세요.', 'warning');
            return;
        }
        targetStudentIds = [...selectedPeriodDeleteStudents].map(String);
    }

    const studentFilter = scope === 'student' ? targetStudentIds : null;
    const hasOther = await hasAnyOtherTeacherScheduleInPeriod(startDate, endDate, scope, studentFilter);

    if (hasOther) {
        const ok = await showConfirm(
            '선택한 기간에 다른 선생님이 등록한 일정이 포함되어 있습니다.\n\n' +
                '삭제하면 같은 원장 계정에 속한 모든 선생님 시간표에서, 해당 기간·범위의 일정이 함께 삭제됩니다.\n\n' +
                '삭제한 일정과 같은 시간 슬롯의 출석 기록도 함께 삭제되며, 복구할 수 없습니다.\n\n계속하시겠습니까?',
            { type: 'warning', title: '다른 선생님 일정 포함', okText: '삭제', cancelText: '취소' }
        );
        if (!ok) return;
        await runPeriodDeleteExecute({
            scope,
            startDate,
            endDate,
            targetStudentIds,
            targetMode: 'owner'
        });
    } else {
        await runPeriodDeleteExecute({
            scope,
            startDate,
            endDate,
            targetStudentIds,
            targetMode: 'currentTeacherOnly'
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

function formatEvalChartMonth(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function parseEvalChartMonth(monthStr) {
    const m = String(monthStr || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    return { year: y, month: mo };
}

function evalChartMonthToIndex(monthStr) {
    const parsed = parseEvalChartMonth(monthStr);
    if (!parsed) return null;
    return parsed.year * 12 + (parsed.month - 1);
}

function evalChartIndexToMonth(idx) {
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    return formatEvalChartMonth(year, month);
}

function getStudentEvalChartRangeFromInputs() {
    const startEl = document.getElementById('student-eval-chart-start-month');
    const endEl = document.getElementById('student-eval-chart-end-month');
    const today = new Date();
    const currentMonth = formatEvalChartMonth(today.getFullYear(), today.getMonth() + 1);
    const anchorMonth = parseEvalChartMonth(historyActionContext.monthPrefix) ? historyActionContext.monthPrefix : currentMonth;
    const defaultEndMonth = evalChartMonthToIndex(anchorMonth) > evalChartMonthToIndex(currentMonth) ? currentMonth : anchorMonth;

    let startMonth = String(startEl?.value || '');
    let endMonth = String(endEl?.value || '');
    if (!parseEvalChartMonth(endMonth)) endMonth = defaultEndMonth;
    if (!parseEvalChartMonth(startMonth)) startMonth = endMonth;

    let startIdx = evalChartMonthToIndex(startMonth);
    let endIdx = evalChartMonthToIndex(endMonth);
    const currentIdx = evalChartMonthToIndex(currentMonth);
    if (startIdx == null || endIdx == null || currentIdx == null) {
        startIdx = currentIdx;
        endIdx = currentIdx;
    }
    if (startIdx > endIdx) {
        const t = startIdx;
        startIdx = endIdx;
        endIdx = t;
    }
    if (endIdx > currentIdx) endIdx = currentIdx;
    if (endIdx - startIdx > 11) startIdx = endIdx - 11;

    startMonth = evalChartIndexToMonth(startIdx);
    endMonth = evalChartIndexToMonth(endIdx);
    if (startEl) startEl.value = startMonth;
    if (endEl) endEl.value = endMonth;

    const startDate = `${startMonth}-01`;
    const endParts = parseEvalChartMonth(endMonth);
    const endLastDay = endParts ? new Date(endParts.year, endParts.month, 0).getDate() : 31;
    const endDate = `${endMonth}-${String(endLastDay).padStart(2, '0')}`;
    return { startMonth, endMonth, startDate, endDate };
}

function shiftStudentEvalChartRangeByMonths(delta) {
    const range = getStudentEvalChartRangeFromInputs();
    const startIdx = evalChartMonthToIndex(range.startMonth);
    const endIdx = evalChartMonthToIndex(range.endMonth);
    const today = new Date();
    const currentIdx = evalChartMonthToIndex(formatEvalChartMonth(today.getFullYear(), today.getMonth() + 1));
    if (startIdx == null || endIdx == null || currentIdx == null) return;

    const span = endIdx - startIdx;
    let nextStart = startIdx + delta;
    let nextEnd = endIdx + delta;
    if (nextEnd > currentIdx) {
        nextEnd = currentIdx;
        nextStart = currentIdx - span;
    }
    if (nextStart < 0) {
        nextStart = 0;
        nextEnd = span;
    }
    const startEl = document.getElementById('student-eval-chart-start-month');
    const endEl = document.getElementById('student-eval-chart-end-month');
    if (startEl) startEl.value = evalChartIndexToMonth(nextStart);
    if (endEl) endEl.value = evalChartIndexToMonth(nextEnd);
}

function scheduleStudentEvalChartRefresh() {
    const panel = document.getElementById('student-eval-panel-chart');
    if (!panel || panel.style.display === 'none') return;
    if (typeof window.renderStudentEvalChartPanel === 'function') {
        window.renderStudentEvalChartPanel();
    }
}

/** 시험일 → 시험명 순 정렬 (그래프·목록 동일 순서) */
function sortScoresByExamDate(scores) {
    if (!Array.isArray(scores)) return [];
    return [...scores].sort((a, b) => {
        const da = String(a.examDate || '');
        const db = String(b.examDate || '');
        if (da !== db) return da.localeCompare(db);
        return String(a.examName || '').localeCompare(String(b.examName || ''), 'ko-KR');
    });
}

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

function buildTestScoreTrendBars(scores, wide) {
    if (!scores.length) return '';
    const sorted = sortScoresByExamDate(scores);
    const wwrap = wide ? ' test-trend-bar-wrap--wide' : '';
    return sorted.map((item) => {
        const maxScore = Number(item.maxScore || 0);
        const score = Number(item.score || 0);
        const percent = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
        const dayLabel = String(item.examDate || '').split('-').slice(1).join('/');
        const rawName = String(item.examName || '테스트');
        const shortName = rawName.length > 6 ? `${rawName.slice(0, 5)}…` : rawName;
        const title = `${item.examName || '테스트'} ${score}/${maxScore} (${percent}%)`;
        return `
            <div class="test-trend-bar-wrap${wwrap}">
                <span class="test-trend-pct-label">${percent}%</span>
                <div class="test-trend-bar" title="${escapeHtml(title)}">
                    <span class="test-trend-fill" style="height:${percent}%;"></span>
                </div>
                <span class="test-trend-day">${escapeHtml(dayLabel || '-')}</span>
                <span class="test-trend-name" title="${escapeHtml(item.examName || '')}">${escapeHtml(shortName)}</span>
            </div>
        `;
    }).join('');
}

/**
 * 만점 대비 비율(%) 추이 — SVG 라인 + 가로 막대 영역 래퍼
 * @param {object} [opts] wide: 대형(그래프 탭), rangeMode: 다월 조회 안내 문구
 */
function buildTestScoreVisualizationHtml(scores, opts) {
    opts = opts || {};
    const wide = opts.wide === true;
    const rangeMode = opts.rangeMode === true;
    const silentEmpty = opts.silentEmpty === true;
    const suppressVizHead = opts.suppressVizHead === true;
    const wrapClass = `test-score-viz-wrap${wide ? ' test-score-viz--wide' : ''}${suppressVizHead && wide ? ' test-score-viz--chart-tab' : ''}`;

    if (!scores.length) {
        if (silentEmpty) {
            return `<div class="${wrapClass}"><div class="test-score-viz-empty test-score-viz-empty--silent" aria-hidden="true"></div></div>`;
        }
        const emptyInner = rangeMode
            ? `<p>선택한 기간에 등록된 점수가 없습니다.</p><span class="test-score-viz-empty-hint">「점수」탭에서 저장한 시험만 그래프에 반영됩니다.</span>`
            : `<p>이번 달 등록된 점수가 없습니다.</p><span class="test-score-viz-empty-hint">아래에서 시험명·시험일·점수를 입력해 저장하세요.</span>`;
        return `
            <div class="${wrapClass}">
            <div class="test-score-viz-empty">
                <i class="fas fa-chart-line" aria-hidden="true"></i>
                ${emptyInner}
            </div></div>`;
    }

    const normalized = sortScoresByExamDate(scores)
        .map((item) => {
            const maxScore = Number(item.maxScore || 0);
            const score = Number(item.score || 0);
            const percent = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
            return { ...item, score, maxScore, percent };
        })
        .filter((item) => Number.isFinite(item.percent));

    if (!normalized.length) {
        return `<div class="${wrapClass}"><div class="test-score-empty">점수 데이터를 계산할 수 없습니다.</div></div>`;
    }

    const n = normalized.length;
    const padL = wide ? 24 : 22;
    const padR = 6;
    const padT = wide ? 8 : 6;
    const padB = 4;
    const chartW = 100 - padL - padR;
    const chartH = wide ? 62 : 52;
    const svgH = wide ? 78 : 64;
    let lineSvg = '';
    if (n >= 2) {
        const pts = normalized.map((item, i) => {
            const x = padL + (i / (n - 1)) * chartW;
            const y = padT + (100 - item.percent) / 100 * chartH;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        const dots = normalized.map((item, i) => {
            const x = padL + (i / (n - 1)) * chartW;
            const y = padT + (100 - item.percent) / 100 * chartH;
            return `<circle class="test-line-dot" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${wide ? 2.6 : 2.2}" />`;
        }).join('');
        lineSvg = `
            <svg class="test-score-line-svg" viewBox="0 0 100 ${svgH}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <text x="2" y="10" class="test-score-y-tick">100</text>
                <text x="6" y="${padT + chartH / 2 + 2}" class="test-score-y-tick">50</text>
                <text x="8" y="${padT + chartH + 2}" class="test-score-y-tick">0</text>
                <line class="test-score-grid" x1="${padL}" y1="${padT + chartH / 2}" x2="100" y2="${padT + chartH / 2}" />
                <line class="test-score-grid test-score-grid--base" x1="${padL}" y1="${padT + chartH}" x2="100" y2="${padT + chartH}" />
                <polyline class="test-score-line" fill="none" points="${pts}" />
                ${dots}
            </svg>`;
    } else {
        const item = normalized[0];
        const x = padL + chartW / 2;
        const y = padT + (100 - item.percent) / 100 * chartH;
        lineSvg = `
            <svg class="test-score-line-svg" viewBox="0 0 100 ${svgH}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <text x="2" y="10" class="test-score-y-tick">100</text>
                <text x="6" y="${padT + chartH / 2 + 2}" class="test-score-y-tick">50</text>
                <text x="8" y="${padT + chartH + 2}" class="test-score-y-tick">0</text>
                <line class="test-score-grid test-score-grid--base" x1="${padL}" y1="${padT + chartH}" x2="100" y2="${padT + chartH}" />
                <circle class="test-line-dot test-line-dot--solo" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" />
            </svg>`;
    }

    const subLine = opts.rangeTitle
        ? opts.rangeTitle
        : '막대·선 그래프는 동일 데이터 기준(시험일 순)';

    const headBlock = suppressVizHead
        ? ''
        : `
        <div class="test-score-viz-head">
            <span class="test-score-viz-title"><i class="fas fa-percentage"></i> 만점 대비 비율 추이</span>
            <span class="test-score-viz-sub">${escapeHtml(subLine)}</span>
        </div>`;

    return `
        <div class="${wrapClass}">
        ${headBlock}
        ${lineSvg}
        <div class="test-score-trend test-score-trend--bars${wide ? ' test-score-trend--bars-wide' : ''}" role="img" aria-label="시험 만점 대비 비율 막대 그래프">
            ${buildTestScoreTrendBars(scores, wide)}
        </div>
        </div>`;
}

function buildTestScoreList(scores) {
    if (!scores.length) return '';
    const sorted = sortScoresByExamDate(scores);
    return sorted.map((item) => {
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
    if (summaryEl && listEl) {
        const scores = Array.isArray(preloadedScores) ? preloadedScores : await getMonthlyTestScoresWithFallback(studentId, monthPrefix);
        summaryEl.innerHTML = buildTestScoreSummary(scores);
        listEl.innerHTML = buildTestScoreList(scores);
        renderTestScoreSyncStatus();
    }
    scheduleStudentEvalChartRefresh();
}

/**
 * 평가 모달 「그래프」탭: 기준월~역산 N개월 구간을 Supabase에서 조회해 대형 시각화 표시
 */
window.renderStudentEvalChartPanel = async function() {
    const host = document.getElementById('student-eval-chart-wide');
    if (!host) return;
    const sid = String(historyActionContext.studentId || '');
    if (!sid) {
        host.innerHTML = '<div class="test-score-viz-empty test-score-viz-empty--silent" aria-hidden="true"></div>';
        return;
    }
    const { startDate, endDate } = getStudentEvalChartRangeFromInputs();
    if (!startDate || !endDate) {
        host.innerHTML = '<div class="test-score-viz-empty test-score-viz-empty--silent" aria-hidden="true"></div>';
        return;
    }
    host.innerHTML = '<div class="student-eval-chart-host-loading" aria-busy="true" aria-hidden="true"></div>';
    try {
        let scores = [];
        if (typeof window.getStudentTestScoresByDateRange === 'function') {
            scores = await window.getStudentTestScoresByDateRange(sid, startDate, endDate);
        }
        host.innerHTML = renderStudentEvalScoreTrendChart(scores, { startDate, endDate });
        bindStudentEvalScoreTooltip();
    } catch (e) {
        console.error('[renderStudentEvalChartPanel]', e);
        host.innerHTML = '<div class="test-score-viz-empty test-score-viz-empty--silent" aria-hidden="true"></div>';
    }
    bindStudentEvalChartDrag();
};

function renderStudentEvalScoreTrendChart(scores, rangeInfo) {
    const sorted = sortScoresByExamDate(scores || []);
    if (!sorted.length) {
        return '<div class="test-score-viz-empty test-score-viz-empty--silent" aria-hidden="true"></div>';
    }
    return `
        <div class="student-eval-score-chart-wrap">
            ${buildStudentEvalScoreTrendSvg(sorted, rangeInfo)}
        </div>
        <div class="student-eval-score-chart-x">${buildStudentEvalScoreTrendXAxis(sorted, rangeInfo)}</div>
    `;
}

function buildStudentEvalScoreTrendSvg(rows, rangeInfo) {
    const n = rows.length;
    const padL = 24;
    const padR = 8;
    const padT = 10;
    const chartH = 74;
    const chartW = 100 - padL - padR;
    const svgH = 96;
    if (n <= 0) return '';

    const startTs = new Date(`${rangeInfo.startDate}T00:00:00`).getTime();
    const endTs = new Date(`${rangeInfo.endDate}T23:59:59`).getTime();
    const span = Math.max(1, endTs - startTs);
    const getX = (item) => {
        if (n === 1) return padL + chartW / 2;
        const ts = new Date(`${item.examDate}T12:00:00`).getTime();
        const ratio = Math.max(0, Math.min(1, (ts - startTs) / span));
        return padL + ratio * chartW;
    };

    const points = rows.map((item) => {
        const maxScore = Number(item.maxScore || 0);
        const score = Number(item.score || 0);
        const percent = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
        const x = getX(item);
        const y = padT + (100 - percent) / 100 * chartH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const dots = rows.map((item) => {
        const maxScore = Number(item.maxScore || 0);
        const score = Number(item.score || 0);
        const percent = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))) : 0;
        const x = getX(item);
        const y = padT + (100 - percent) / 100 * chartH;
        return `<circle class="student-eval-score-dot"
            cx="${x.toFixed(2)}"
            cy="${y.toFixed(2)}"
            r="${n === 1 ? 2.8 : 2.2}"
            data-exam-name="${escapeHtml(String(item.examName || '테스트'))}"
            data-exam-date="${escapeHtml(String(item.examDate || '-'))}"
            data-score="${escapeHtml(`${score}/${maxScore}`)}"
        />`;
    }).join('');

    return `
        <svg class="student-eval-score-chart-svg" viewBox="0 0 100 ${svgH}" preserveAspectRatio="xMidYMid meet" aria-label="점수 변화 선 그래프">
            <text class="student-eval-score-y-label" x="4" y="10">100</text>
            <text class="student-eval-score-y-label" x="8" y="${padT + chartH / 2 + 2}">50</text>
            <text class="student-eval-score-y-label" x="10" y="${padT + chartH + 2}">0</text>
            <line class="student-eval-score-grid" x1="${padL}" y1="${padT + chartH / 2}" x2="100" y2="${padT + chartH / 2}" />
            <line class="student-eval-score-base" x1="${padL}" y1="${padT + chartH}" x2="100" y2="${padT + chartH}" />
            ${n >= 2 ? `<polyline class="student-eval-score-line" points="${points}" />` : ''}
            ${dots}
        </svg>`;
}

function buildStudentEvalScoreTrendXAxis(rows, rangeInfo) {
    const unique = (arr) => [...new Set(arr)];
    const startIdx = evalChartMonthToIndex(rangeInfo.startDate.slice(0, 7));
    const endIdx = evalChartMonthToIndex(rangeInfo.endDate.slice(0, 7));
    if (startIdx != null && endIdx != null && (endIdx - startIdx) <= 0) {
        const labels = unique(rows.map((r) => String(r.examDate || '').slice(8, 10)).filter(Boolean));
        return labels.map((d) => `<span class="student-eval-score-chart-x-item">${parseInt(d, 10)}일</span>`).join('');
    }
    if (startIdx == null || endIdx == null) return '';
    const labels = [];
    for (let idx = startIdx; idx <= endIdx; idx += 1) {
        const m = evalChartIndexToMonth(idx);
        labels.push(`<span class="student-eval-score-chart-x-item">${m.slice(5, 7)}월</span>`);
    }
    return labels.join('');
}

function bindStudentEvalScoreTooltip() {
    const wrap = document.querySelector('#student-eval-chart-wide .student-eval-score-chart-wrap');
    if (!wrap) return;
    const dots = wrap.querySelectorAll('.student-eval-score-dot');
    if (!dots.length) return;

    let tip = wrap.querySelector('.student-eval-score-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'student-eval-score-tooltip';
        wrap.appendChild(tip);
    }

    const positionTip = (evt) => {
        const rect = wrap.getBoundingClientRect();
        const x = evt.clientX - rect.left + 12;
        const y = evt.clientY - rect.top;
        const maxX = rect.width - tip.offsetWidth - 8;
        const clampedX = Math.max(8, Math.min(maxX, x));
        const aboveTop = y - tip.offsetHeight - 12;
        const belowTop = y + 14;
        const top = aboveTop >= 8 ? aboveTop : Math.min(rect.height - tip.offsetHeight - 8, belowTop);
        tip.style.left = `${clampedX}px`;
        tip.style.top = `${Math.max(8, top)}px`;
    };

    const showTip = (evt, dot) => {
        const examName = dot.getAttribute('data-exam-name') || '테스트';
        const examDate = dot.getAttribute('data-exam-date') || '-';
        const score = dot.getAttribute('data-score') || '-';
        tip.innerHTML = `<div><span class="k">시험명</span>${examName}</div>
            <div><span class="k">시험일</span>${examDate}</div>
            <div><span class="k">점수</span>${score}</div>`;
        positionTip(evt);
        tip.classList.add('show');
    };

    const hideTip = () => {
        tip.classList.remove('show');
    };

    dots.forEach((dot) => {
        dot.addEventListener('mouseenter', (evt) => showTip(evt, dot));
        dot.addEventListener('mousemove', (evt) => positionTip(evt));
        dot.addEventListener('mouseleave', hideTip);
    });
}

function bindStudentEvalChartDrag() {
    if (studentEvalChartDragBound) return;
    const host = document.getElementById('student-eval-chart-wide');
    if (!host) return;
    studentEvalChartDragBound = true;

    let startX = 0;
    let dragging = false;
    const onDown = (x) => {
        startX = x;
        dragging = true;
    };
    const onUp = (x) => {
        if (!dragging) return;
        dragging = false;
        const diff = x - startX;
        if (Math.abs(diff) < 42) return;
        shiftStudentEvalChartRangeByMonths(diff > 0 ? -1 : 1);
        window.renderStudentEvalChartPanel();
    };

    host.addEventListener('mousedown', (e) => {
        const wrap = e.target.closest('.student-eval-score-chart-wrap');
        if (!wrap) return;
        onDown(e.clientX);
    });
    window.addEventListener('mouseup', (e) => onUp(e.clientX));

    host.addEventListener('touchstart', (e) => {
        const wrap = e.target.closest('.student-eval-score-chart-wrap');
        if (!wrap) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        onDown(t.clientX);
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        onUp(t.clientX);
    }, { passive: true });
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
    closeModal('student-eval-modal');

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
    closeModal('student-eval-modal');
    setTimeout(() => {
        window.openPaymentLedgerModal(sid, monthPrefix);
    }, 40);
};

window.openHistoryScoreAction = function() {
    const evalModal = document.getElementById('student-eval-modal');
    if (evalModal && evalModal.style.display === 'flex') {
        if (typeof window.switchStudentEvalTab === 'function') {
            window.switchStudentEvalTab('score');
        }
        setTimeout(() => {
            const nameInput = document.getElementById('test-score-name');
            if (nameInput) nameInput.focus();
        }, 80);
        return;
    }
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
    const examMonthPrefix = /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate.slice(0, 7) : monthPrefix;

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
    let remoteOk = false;
    let remoteSaveErr = null;
    if (typeof window.saveStudentTestScore === 'function') {
        try {
            const remoteSaved = await window.saveStudentTestScore(localRow);
            if (remoteSaved && remoteSaved.id) {
                savedRow = remoteSaved;
                remoteOk = true;
            }
            setTestScoreSyncState('remote', `원격 저장 성공 · ${new Date().toLocaleTimeString('ko-KR')}`);
        } catch (error) {
            remoteSaveErr = error;
            console.warn('[saveTestScoreFromHistory] 원격 저장 실패, 로컬 폴백:', error);
            setTestScoreSyncState('local', `원격 저장 실패 · 로컬 저장 (${error.message || 'unknown'})`);
            showToast(`Supabase 저장 실패: ${error.message || '알 수 없는 오류'} (같은 내용은 기기에 백업됨)`, 'error');
        }
    } else {
        setTestScoreSyncState('local', '원격 저장 함수 미구성 · 로컬 저장');
    }
    upsertLocalTestScore(savedRow);
    valueInput.value = '';
    nameInput.value = '';
    nameInput.focus();
    await renderTestScoreSection(
        studentId,
        examMonthPrefix,
        `${examMonthPrefix.slice(0, 4)}년 ${examMonthPrefix.slice(5)}월`
    );

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-plus"></i> 점수 저장';
    }
    if (remoteOk) {
        showToast('테스트 점수가 저장되었습니다.', 'success');
    } else if (remoteSaveErr) {
        /* Supabase 오류 토스트는 catch에서 이미 표시 */
    } else if (typeof window.saveStudentTestScore === 'function') {
        showToast('로컬에만 저장되었습니다. 동기화 점검 또는 로그인 상태를 확인하세요.', 'warning');
    } else {
        showToast('테스트 점수가 저장되었습니다. (로컬 전용)', 'warning');
    }
    if (examMonthPrefix !== monthPrefix) {
        showToast(`입력한 시험일 기준으로 ${examMonthPrefix.slice(0, 4)}년 ${examMonthPrefix.slice(5)}월 목록을 표시합니다.`, 'info');
    }
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
    scheduleStudentEvalChartRefresh();
    showToast('테스트 점수가 삭제되었습니다.', 'info');
};

/**
 * 수업관리에서 저장한 월별 개인/공유 메모를 학생 객체에 채운 뒤 출석 레코드로 상태를 보조 동기화한다.
 * @param {object} s students 배열의 학생 객체
 * @param {string} sid 학생 id
 * @param {string} monthPrefix `YYYY-MM`
 */
async function hydrateMonthlyClassMemosForStudent(s, sid, monthPrefix) {
    const parts = String(monthPrefix || '').split('-');
    const curYear = parseInt(parts[0], 10);
    const curMonth = parseInt(parts[1], 10);
    if (!curYear || !curMonth) return;

    try {
        const ownerId = localStorage.getItem('current_owner_id');
        if (!ownerId) return;
        const numericId = parseInt(sid, 10);

        if (s.records && typeof s.records === 'object') {
            Object.keys(s.records).forEach((k) => {
                if (k && typeof k === 'string' && k.startsWith(monthPrefix)) delete s.records[k];
            });
        } else {
            s.records = {};
        }
        if (s.shared_records && typeof s.shared_records === 'object') {
            Object.keys(s.shared_records).forEach((k) => {
                if (k && typeof k === 'string' && k.startsWith(monthPrefix)) delete s.shared_records[k];
            });
        } else {
            s.shared_records = {};
        }

        if (typeof window.getStudentClassMemos === 'function') {
            try {
                const { class_memos, class_shared_memos } = await window.getStudentClassMemos(sid, monthPrefix);

                if (!s.records) s.records = {};
                Object.entries(class_memos || {}).forEach(([dateKey, timeMap]) => {
                    if (!dateKey || !String(dateKey).startsWith(monthPrefix)) return;
                    if (!timeMap || typeof timeMap !== 'object') return;
                    if (!s.records[dateKey] || typeof s.records[dateKey] !== 'object') s.records[dateKey] = {};
                    Object.entries(timeMap).forEach(([timeKey, memoHtml]) => {
                        if (memoHtml && String(memoHtml).trim()) {
                            const tk = normalizeScheduleTimeKey(String(timeKey || '')) || String(timeKey || 'default');
                            s.records[dateKey][tk] = memoHtml;
                        }
                    });
                });

                if (!s.shared_records) s.shared_records = {};
                Object.entries(class_shared_memos || {}).forEach(([dateKey, timeMap]) => {
                    if (!dateKey || !String(dateKey).startsWith(monthPrefix)) return;
                    if (!timeMap || typeof timeMap !== 'object') return;
                    if (!s.shared_records[dateKey] || typeof s.shared_records[dateKey] !== 'object') s.shared_records[dateKey] = {};
                    Object.entries(timeMap).forEach(([timeKey, teacherMap]) => {
                        if (!teacherMap || typeof teacherMap !== 'object') return;
                        const tk = normalizeScheduleTimeKey(String(timeKey || '')) || String(timeKey || 'default');
                        Object.entries(teacherMap).forEach(([teacherId, memoHtml]) => {
                            if (!memoHtml || !String(memoHtml).trim()) return;
                            const tid = String(teacherId || 'unknown');
                            const tName = getTeacherNameById(tid) || '알 수 없음';
                            const sharedKey = `${tk}__${tid}`;
                            s.shared_records[dateKey][sharedKey] =
                                `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-bottom:3px;">${tName}</span><div>${memoHtml}</div>`;
                        });
                    });
                });
            } catch (memoLoadError) {
                console.error('[hydrateMonthlyClassMemosForStudent] 수업관리 메모 로드 실패:', memoLoadError);
            }
        }

        const startDate = `${monthPrefix}-01`;
        const lastDay = new Date(curYear, curMonth, 0).getDate();
        const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

        const { data: allRecords, error: allErr } = await supabase
            .from('attendance_records')
            .select('attendance_date, scheduled_time, teacher_id, status')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .gte('attendance_date', startDate)
            .lte('attendance_date', endDate);

        if (!allErr && allRecords && allRecords.length > 0) {
            allRecords.forEach(rec => {
                const dk = rec.attendance_date;
                const tk = normalizeScheduleTimeKey(rec.scheduled_time);
                if (rec.status) {
                    if (!s.attendance) s.attendance = {};
                    if (!s.attendance[dk] || typeof s.attendance[dk] !== 'object') {
                        s.attendance[dk] = {};
                    }
                    if (String(rec.teacher_id) === String(currentTeacherId) || !s.attendance[dk][tk]) {
                        s.attendance[dk][tk] = rec.status;
                    }
                }
            });
        }
    } catch (e) {
        console.error('[hydrateMonthlyClassMemosForStudent] DB 메모 조회 실패:', e);
    }
}

/**
 * 학생의 최근 수업 메모 N개를 dateStr 이전 시점으로 추려서 반환.
 * 반복 메모 빠른 입력 chip 용.
 */
function _collectRecentMemos(s, dateStr, max = 3) {
    if (!s) return [];
    const records = s.records || {};
    const dates = Object.keys(records).filter(d => d < String(dateStr)).sort().reverse();
    const seen = new Set();
    const out = [];
    for (const d of dates) {
        const dayRec = records[d];
        if (!dayRec) continue;
        const slots = (typeof dayRec === 'object') ? Object.values(dayRec) : [dayRec];
        for (const slot of slots) {
            const text = String(slot || '').replace(/<[^>]+>/g, '').trim();
            if (!text) continue;
            const key = text.slice(0, 60);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(slot); // 원본 HTML 보존 — chip 클릭 시 contenteditable 에 그대로 삽입
            if (out.length >= max) return out;
        }
        if (out.length >= max) break;
    }
    return out;
}

/** chip 클릭 시 atomic 메모를 contenteditable 끝에 추가 */
window._insertRecentMemoIntoEditor = function(btn) {
    const editor = document.getElementById('att-memo');
    if (!editor) return;
    const memoFull = btn.getAttribute('data-memo-full') || '';
    if (!memoFull) return;
    // 이스케이프된 HTML 복원
    const decoded = memoFull
        .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    // 개행 — 이미 내용이 있으면 줄바꿈 후 append
    const has = editor.innerHTML.replace(/<br\s*\/?>/gi, '').trim();
    editor.innerHTML = has
        ? (editor.innerHTML + '<br>' + decoded)
        : decoded;
    // 시각 피드백
    btn.style.background = 'rgba(99,102,241,0.25)';
    setTimeout(() => { btn.style.background = ''; }, 220);
    editor.focus();
};

/**
 * s.memo 에서 #해시태그를 추출해 색상 chip 으로 변환.
 * 같은 태그는 같은 색상이 일관 (해시 → 팔레트 인덱스).
 */
const _STUDENT_TAG_PALETTE = [
    { bg: '#dcfce7', fg: '#166534' }, { bg: '#dbeafe', fg: '#1e40af' },
    { bg: '#fef3c7', fg: '#92400e' }, { bg: '#fce7f3', fg: '#9f1239' },
    { bg: '#e0e7ff', fg: '#3730a3' }, { bg: '#cffafe', fg: '#155e75' },
    { bg: '#fee2e2', fg: '#991b1b' }, { bg: '#f5f3ff', fg: '#5b21b6' },
];
function _hashTagToColorIdx(tag) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) {
        h = (h << 5) - h + tag.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % _STUDENT_TAG_PALETTE.length;
}
function extractStudentTagsFromMemo(memo) {
    if (!memo) return [];
    const out = new Set();
    const re = /#([\wㄱ-ㅎ가-힣ㅏ-ㅣ]+)/g;
    let m;
    while ((m = re.exec(String(memo))) !== null) {
        const tag = m[1].trim();
        if (tag) out.add(tag);
        if (out.size >= 5) break; // 너무 많은 태그 제한
    }
    return Array.from(out);
}
function renderStudentTagsFromMemo(memo) {
    const tags = extractStudentTagsFromMemo(memo);
    if (tags.length === 0) return '';
    const chips = tags.map(t => {
        const c = _STUDENT_TAG_PALETTE[_hashTagToColorIdx(t)];
        return `<span class="student-tag-chip" style="background:${c.bg};color:${c.fg};" title="검색창에 #${t} 입력 시 필터링됩니다">#${t}</span>`;
    }).join('');
    return `<div class="student-tag-row">${chips}</div>`;
}

/**
 * hydrate 이후 `s.records` / `s.shared_records`로 월별 메모 타임라인 HTML 생성
 */
function buildMonthlyMemoTimelineHtml(s, monthPrefix) {
    const allDates = new Set();
    if (s.records) Object.keys(s.records).forEach(d => allDates.add(d));
    if (s.shared_records) Object.keys(s.shared_records).forEach(d => allDates.add(d));
    const monthlyEvents = Array.from(allDates).filter(date => date.startsWith(monthPrefix)).sort();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

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

    if (monthlyEvents.length === 0) {
        return `<div class="hist-list-empty">
            <i class="fas fa-inbox" style="font-size:28px;margin-bottom:10px;display:block;color:#cbd5e1;"></i>
            이번 달 메모 기록이 없습니다.
            <div style="margin-top:6px;font-size:11px;color:#cbd5e1;">수업 후 출석 모달의 메모 영역에 작성하면 이곳에 누적됩니다.</div>
        </div>`;
    }

    let html = '';
    monthlyEvents.forEach(date => {
        const privateMemo = getMemo(s.records, date);
        const sharedMemo = getMemo(s.shared_records, date);
        const dayNum = parseInt(date.split('-')[2], 10);
        const dow = dayNames[new Date(date).getDay()];

        let memosHtml = '';
        if (privateMemo || sharedMemo) {
            memosHtml = '<div class="hist-day-memos">';
            if (privateMemo) {
                memosHtml += `<div class="hist-memo-block"><div class="hist-memo-label"><i class="fas fa-lock"></i> 개인 메모</div><div>${privateMemo}</div></div>`;
            }
            if (sharedMemo) {
                memosHtml += `<div class="hist-memo-block"><div>${sharedMemo}</div></div>`;
            }
            memosHtml += '</div>';
        } else {
            memosHtml = '<div class="hist-memo-empty">기록 없음</div>';
        }

        // 검색·필터용 raw 텍스트 — data-attr 로 카드에 보관
        const rawText = (String(privateMemo || '') + ' ' + String(sharedMemo || ''))
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        const rawAttr = rawText.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        html += `<div class="hist-day-card" data-memo-text="${rawAttr}">
            <div class="hist-day-header">
                <span class="hist-day-date">${dayNum}일</span>
                <span class="hist-day-dow">${dow}요일</span>
            </div>
            ${memosHtml}
        </div>`;
    });
    return html;
}

/**
 * history-modal 검색·태그 필터 — 모달 내 .hist-day-card 의 data-memo-text 와
 * 검색어/태그 패턴(정규식)을 매칭해 클라이언트 필터링.
 *   _activeHistSearch: 현재 검색어 (소문자)
 *   _activeHistTagPattern: 활성 칩의 data-filter (예: "보강", "시험|테스트|점수")
 */
let _activeHistSearch = '';
let _activeHistTagPattern = '';
function _applyHistFilter() {
    const cards = document.querySelectorAll('#history-timeline .hist-day-card');
    let visible = 0;
    const q = _activeHistSearch.trim().toLowerCase();
    let pattern = null;
    if (_activeHistTagPattern) {
        try { pattern = new RegExp(_activeHistTagPattern, 'i'); } catch (_) { pattern = null; }
    }
    cards.forEach(card => {
        const txt = card.getAttribute('data-memo-text') || '';
        let show = true;
        if (q) show = show && txt.includes(q);
        if (pattern) show = show && pattern.test(txt);
        card.classList.toggle('is-hidden', !show);
        if (show) visible++;
    });
    const info = document.getElementById('hist-count-info');
    if (info) info.textContent = `${visible}/${cards.length}일`;
    // 결과 0건 안내
    let noRes = document.getElementById('hist-no-results-msg');
    if (visible === 0 && cards.length > 0) {
        if (!noRes) {
            const tl = document.getElementById('history-timeline');
            if (tl) {
                noRes = document.createElement('div');
                noRes.id = 'hist-no-results-msg';
                noRes.className = 'hist-no-results';
                noRes.innerHTML = '<i class="fas fa-search" style="font-size:24px;opacity:0.4;display:block;margin-bottom:8px;"></i>조건에 맞는 메모가 없습니다.';
                tl.appendChild(noRes);
            }
        }
    } else if (noRes) {
        noRes.remove();
    }
}
function _resetHistFilter() {
    _activeHistSearch = '';
    _activeHistTagPattern = '';
    const inp = document.getElementById('hist-search-input');
    if (inp) inp.value = '';
    document.querySelectorAll('#hist-tag-chips .hist-tag-chip').forEach(c => {
        c.classList.toggle('active', !c.dataset.filter);
    });
}
function _bindHistFilterToolbarOnce() {
    const inp = document.getElementById('hist-search-input');
    if (inp && !inp.dataset.bound) {
        inp.dataset.bound = '1';
        let t = null;
        inp.addEventListener('input', (e) => {
            _activeHistSearch = e.target.value || '';
            clearTimeout(t);
            t = setTimeout(_applyHistFilter, 80);
        });
    }
    const chips = document.querySelectorAll('#hist-tag-chips .hist-tag-chip');
    chips.forEach(chip => {
        if (chip.dataset.bound) return;
        chip.dataset.bound = '1';
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            _activeHistTagPattern = chip.dataset.filter || '';
            _applyHistFilter();
        });
    });
}

/**
 * history-modal 의 현재 표시 월 상태 — 월 네비게이션을 위해 전역 추적.
 */
const _histState = { sid: null, year: 0, month: 0, memoOnly: false };

/**
 * 주어진 월의 메모 + 종합평가를 history-modal 에 로드/렌더링.
 * 월 변경(prev/next/picker) 시에도 동일 헬퍼 사용.
 */
async function _renderHistoryForMonth(year, month) {
    const sid = _histState.sid;
    if (!sid) return;
    const s = students.find(x => String(x.id) === String(sid));
    if (!s) return;

    _histState.year = year;
    _histState.month = month;

    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const subtitle = document.getElementById('hist-subtitle');
    if (subtitle) subtitle.textContent = `${year}년 ${month}월`;
    const picker = document.getElementById('hist-month-picker');
    if (picker) picker.value = monthPrefix;

    const container = document.getElementById('history-timeline');
    if (container) container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--gray);">로딩 중...</div>';
    historyActionContext = { studentId: String(sid), monthPrefix };

    await hydrateMonthlyClassMemosForStudent(s, sid, monthPrefix);

    if (container) container.innerHTML = buildMonthlyMemoTimelineHtml(s, monthPrefix);

    // 검색·필터 — 월 바뀌면 매번 초기화 + 카운트 갱신
    _bindHistFilterToolbarOnce();
    _resetHistFilter();
    _applyHistFilter();

    if (_histState.memoOnly) return;

    // 종합평가 섹션 — 월별 분리 저장이라 매번 재로드
    const evalMonthLabel = document.getElementById('eval-current-month');
    const evalTextarea = document.getElementById('eval-textarea-main');
    const evalCharCount = document.getElementById('eval-char-main');
    const evalSaveBtn = document.getElementById('eval-save-btn');
    if (evalMonthLabel) evalMonthLabel.textContent = `${year}년 ${month}월`;
    if (evalTextarea) {
        evalTextarea.value = '';
        evalTextarea.dataset.studentId = sid;
        evalTextarea.dataset.evalMonth = monthPrefix;
        evalTextarea.oninput = function() {
            if (evalCharCount) evalCharCount.textContent = this.value.length;
        };
    }
    if (evalCharCount) evalCharCount.textContent = '0';
    if (evalSaveBtn) {
        evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
        evalSaveBtn.classList.remove('saved');
    }
    try {
        if (typeof window.getStudentEvaluation === 'function') {
            const evalData = await window.getStudentEvaluation(sid, monthPrefix);
            if (evalData && evalData.comment && evalTextarea) {
                evalTextarea.value = evalData.comment;
                if (evalCharCount) evalCharCount.textContent = evalData.comment.length;
            }
        }
    } catch (e) {
        console.error('[history] 종합평가 로드 실패:', e);
    }
}

/** 이전 달 이동 */
window.goPrevHistMonth = function() {
    let { year, month } = _histState;
    if (!year || !month) return;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    _renderHistoryForMonth(year, month);
};

/** 다음 달 이동 */
window.goNextHistMonth = function() {
    let { year, month } = _histState;
    if (!year || !month) return;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    _renderHistoryForMonth(year, month);
};

/** input[type=month] 직접 선택 */
window.setHistMonth = function(ymStr) {
    if (!ymStr) return;
    const m = String(ymStr).match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return;
    _renderHistoryForMonth(parseInt(m[1], 10), parseInt(m[2], 10));
};

/**
 * 월별 학습 기록 모달(`history-modal`).
 * @param {boolean} [memoOnly=false] true면 수업관리「이번달 기록」경로 — 날짜별 메모만 보이고 종합평가 블록은 숨김.
 */
window.openHistoryModal = async function(memoOnly) {
    const sid = document.getElementById('att-student-id').value;
    const s = students.find(x => String(x.id) === String(sid));
    if(!s) return;
    const memoOnlyMode = memoOnly === true;

    document.getElementById('history-modal').style.display = 'flex';
    document.getElementById('hist-title').textContent = `${s.name} (${s.grade})${s.school ? ' · ' + s.school : ''}`;

    const statsEl = document.getElementById('hist-stats');
    const overviewEl = document.getElementById('hist-overview');
    if (statsEl) { statsEl.innerHTML = ''; statsEl.style.display = 'none'; }
    if (overviewEl) { overviewEl.innerHTML = ''; overviewEl.style.display = 'none'; }

    const evalSection = document.getElementById('eval-section');
    if (evalSection) evalSection.style.display = memoOnlyMode ? 'none' : '';

    // 초기 월 = currentDate 기준
    _histState.sid = String(sid);
    _histState.memoOnly = memoOnlyMode;
    const initialYear = currentDate.getFullYear();
    const initialMonth = currentDate.getMonth() + 1;
    await _renderHistoryForMonth(initialYear, initialMonth);
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

/** 학생 목록 「평가」모달: 기록 / 점수 / 그래프 탭 전환 */
/**
 * 학생 「평가」모달: 선택한 월 기준으로 기록·점수·종합평가·차트 범위를 다시 로드한다.
 * @param {string} sid
 * @param {string} monthPrefix YYYY-MM
 * @param {{ initialTab?: 'record'|'score'|'chart' }} [options]
 */
async function loadStudentEvalModalContent(sid, monthPrefix, options) {
    const initialTab = (options && options.initialTab) || 'record';
    const s = students.find((x) => String(x.id) === String(sid));
    if (!s) return;

    historyActionContext = { studentId: String(sid), monthPrefix };

    const modal = document.getElementById('student-eval-modal');
    if (modal) modal.dataset.studentEvalStudentId = String(sid);

    const picker = document.getElementById('student-eval-month-picker');
    if (picker) picker.value = monthPrefix;

    const subEl = document.getElementById('student-eval-subtitle');
    if (subEl) subEl.textContent = '학습 · 평가';

    const timelineEl = document.getElementById('student-eval-timeline');
    if (timelineEl) timelineEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);">로딩 중...</div>';

    await hydrateMonthlyClassMemosForStudent(s, sid, monthPrefix);
    if (timelineEl) timelineEl.innerHTML = buildMonthlyMemoTimelineHtml(s, monthPrefix);

    const evalMonthLabel = document.getElementById('student-eval-month-label');
    const evalTextarea = document.getElementById('student-eval-textarea');
    const evalCharCount = document.getElementById('student-eval-char');
    const evalSaveBtn = document.getElementById('student-eval-save-btn');
    const y = parseInt(monthPrefix.slice(0, 4), 10);
    const m = parseInt(monthPrefix.slice(5, 7), 10);
    if (evalMonthLabel) evalMonthLabel.textContent = `${y}년 ${m}월`;
    const refineWrap = document.getElementById('student-eval-refine-wrap');
    if (refineWrap) refineWrap.style.display = 'none';
    const refineIn = document.getElementById('student-eval-refine-input');
    if (refineIn) refineIn.value = '';

    if (evalTextarea) {
        evalTextarea.value = '';
        evalTextarea.dataset.studentId = sid;
        evalTextarea.dataset.evalMonth = monthPrefix;
        evalTextarea.dataset.parentVisible = '0';
        evalTextarea.oninput = function() {
            if (evalCharCount) evalCharCount.textContent = this.value.length;
        };
    }
    if (evalCharCount) evalCharCount.textContent = '0';
    if (evalSaveBtn) {
        evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
        evalSaveBtn.classList.remove('saved');
    }

    try {
        if (typeof window.getStudentEvaluation === 'function') {
            const evalData = await window.getStudentEvaluation(sid, monthPrefix);
            if (evalTextarea && evalData) {
                if (evalData.comment) {
                    evalTextarea.value = evalData.comment;
                    if (evalCharCount) evalCharCount.textContent = String(evalData.comment || '').length;
                }
                evalTextarea.dataset.parentVisible = evalData.parent_portal_visible ? '1' : '0';
            }
        }
    } catch (e) {
        console.error('[loadStudentEvalModalContent] 종합평가 로드 실패:', e);
    }

    if (typeof window.updateStudentEvalParentToggleUi === 'function') {
        window.updateStudentEvalParentToggleUi();
    }

    try {
        const styleAppend = document.getElementById('student-eval-ai-style-append');
        if (styleAppend) styleAppend.value = '';
    } catch (e) {
        console.warn('[loadStudentEvalModalContent] AI 고정 지침 입력 초기화:', e);
    }

    const monthLabel = `${monthPrefix.slice(0, 4)}년 ${monthPrefix.slice(5)}월`;
    await renderTestScoreSection(sid, monthPrefix, monthLabel);

    const chartStartEl = document.getElementById('student-eval-chart-start-month');
    const chartEndEl = document.getElementById('student-eval-chart-end-month');
    if (chartStartEl && chartEndEl) {
        const anchorIdx = evalChartMonthToIndex(monthPrefix);
        if (anchorIdx != null) {
            const startIdx = Math.max(0, anchorIdx - 2);
            chartStartEl.value = evalChartIndexToMonth(startIdx);
            chartEndEl.value = evalChartIndexToMonth(anchorIdx);
        }
    }

    window.switchStudentEvalTab(initialTab);
}

/** 평가 모달에서 `input type="month"` 변경 시 */
window.onStudentEvalModalMonthChange = async function() {
    const picker = document.getElementById('student-eval-month-picker');
    const modal = document.getElementById('student-eval-modal');
    const ta = document.getElementById('student-eval-textarea');
    const sid = modal && modal.dataset.studentEvalStudentId;
    if (!picker || !picker.value || !sid) return;
    const newMonth = picker.value;
    const prevMonth = ta && ta.dataset.evalMonth ? String(ta.dataset.evalMonth) : '';
    if (newMonth === prevMonth) return;

    if (ta && ta.value.trim() && typeof showConfirm === 'function') {
        const ok = await showConfirm('입력한 평가 문구가 저장되지 않았을 수 있습니다. 월을 바꿀까요?', { okText: '바꾸기', cancelText: '취소' });
        if (!ok) {
            picker.value = prevMonth || '';
            return;
        }
    }

    let tab = 'record';
    const tabR = document.getElementById('student-eval-tab-record');
    const tabS = document.getElementById('student-eval-tab-score');
    const tabC = document.getElementById('student-eval-tab-chart');
    if (tabC && tabC.classList.contains('active')) tab = 'chart';
    else if (tabS && tabS.classList.contains('active')) tab = 'score';

    await loadStudentEvalModalContent(sid, newMonth, { initialTab: tab });
};

window.switchStudentEvalTab = function(tab) {
    const t = tab === 'score' ? 'score' : (tab === 'chart' ? 'chart' : 'record');
    const isRecord = t === 'record';
    const isScore = t === 'score';
    const isChart = t === 'chart';
    const panelR = document.getElementById('student-eval-panel-record');
    const panelS = document.getElementById('student-eval-panel-score');
    const panelC = document.getElementById('student-eval-panel-chart');
    const tabR = document.getElementById('student-eval-tab-record');
    const tabS = document.getElementById('student-eval-tab-score');
    const tabC = document.getElementById('student-eval-tab-chart');
    if (panelR) panelR.style.display = isRecord ? 'block' : 'none';
    if (panelS) panelS.style.display = isScore ? 'block' : 'none';
    if (panelC) panelC.style.display = isChart ? 'block' : 'none';
    if (tabR) tabR.classList.toggle('active', isRecord);
    if (tabS) tabS.classList.toggle('active', isScore);
    if (tabC) tabC.classList.toggle('active', isChart);
    if (isChart && typeof window.renderStudentEvalChartPanel === 'function') {
        window.renderStudentEvalChartPanel();
    }
};

/**
 * 학생 목록 전용 「평가」모달 — 기록 탭(수업관리 월별 메모), 점수 탭(테스트 점수), 하단 종합평가 고정
 * @param {string} studentId
 * @param {{ initialTab?: 'record'|'score'|'chart', evalMonth?: string }} [options] evalMonth: YYYY-MM (과거 월 조회)
 */
window.openStudentEvalModal = async function(studentId, options) {
    let initialTab = 'record';
    if (options && options.initialTab === 'score') initialTab = 'score';
    else if (options && options.initialTab === 'chart') initialTab = 'chart';
    const sid = String(studentId || '');
    if (!sid) return;
    const s = students.find((x) => String(x.id) === String(sid));
    if (!s) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    closeModal('history-modal');

    const curYear = currentDate.getFullYear();
    const curMonth = currentDate.getMonth() + 1;
    let monthPrefix = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    if (options && options.evalMonth && /^\d{4}-\d{2}$/.test(String(options.evalMonth))) {
        monthPrefix = String(options.evalMonth);
    }

    const modal = document.getElementById('student-eval-modal');
    if (!modal) {
        showToast('평가 화면을 찾을 수 없습니다.', 'warning');
        return;
    }
    modal.style.display = 'flex';

    const titleEl = document.getElementById('student-eval-title');
    if (titleEl) titleEl.textContent = `${s.name} (${s.grade})${s.school ? ' · ' + s.school : ''}`;

    await loadStudentEvalModalContent(sid, monthPrefix, { initialTab });
};

window.saveStudentEvalFromModal = async function() {
    const evalTextarea = document.getElementById('student-eval-textarea');
    const evalSaveBtn = document.getElementById('student-eval-save-btn');
    if (!evalTextarea) return;

    const studentId = evalTextarea.dataset.studentId;
    const evalMonth = evalTextarea.dataset.evalMonth;
    const comment = evalTextarea.value.trim();

    if (!studentId || !evalMonth) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    if (evalSaveBtn) {
        evalSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';
        evalSaveBtn.disabled = true;
    }

    const vis = evalTextarea.dataset.parentVisible === '1';

    try {
        await window.saveStudentEvaluation(studentId, evalMonth, comment, currentTeacherId, {
            parentPortalVisible: vis
        });

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
        console.error('[saveStudentEvalFromModal] 종합평가 저장 실패:', e);
        if (evalSaveBtn) {
            evalSaveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
            evalSaveBtn.disabled = false;
        }
        const msg = (e && e.message) || '';
        if (msg.includes('parent_portal_visible') || (e && String(e).includes('column'))) {
            showToast('DB에 parent_portal_visible 컬럼이 없습니다. SUPABASE_EVAL_PARENT_VISIBLE_AI_20260329.sql을 적용해주세요.', 'error');
        } else {
            showToast('종합평가 저장에 실패했습니다.', 'error');
        }
    }
};

window.updateStudentEvalParentToggleUi = function() {
    const ta = document.getElementById('student-eval-textarea');
    const btn = document.getElementById('student-eval-parent-toggle-btn');
    const icon = document.getElementById('student-eval-parent-toggle-icon');
    const label = document.getElementById('student-eval-parent-toggle-label');
    if (!ta || !btn || !label) return;
    const on = ta.dataset.parentVisible === '1';
    btn.classList.toggle('is-on', on);
    if (icon) icon.className = on ? 'fas fa-eye' : 'fas fa-eye-slash';
    label.textContent = on ? '학부모 공개 중' : '학부모 비공개';
};

window.toggleStudentEvalRefinePanel = function() {
    const wrap = document.getElementById('student-eval-refine-wrap');
    if (!wrap) return;
    const hidden = wrap.style.display === 'none' || wrap.style.display === '';
    wrap.style.display = hidden ? 'block' : 'none';
};

window.toggleStudentEvalParentVisible = async function() {
    const ta = document.getElementById('student-eval-textarea');
    if (!ta) return;
    const sid = ta.dataset.studentId;
    const month = ta.dataset.evalMonth;
    if (!sid || !month) {
        showToast('학생·월 정보가 없습니다.', 'warning');
        return;
    }
    const next = ta.dataset.parentVisible !== '1';
    try {
        await window.saveStudentEvaluation(sid, month, ta.value.trim(), currentTeacherId, {
            parentPortalVisible: next
        });
        ta.dataset.parentVisible = next ? '1' : '0';
        window.updateStudentEvalParentToggleUi();
        showToast(next ? '학부모 포털에 공개되었습니다.' : '학부모 포털에서 숨겼습니다.', 'success');
    } catch (e) {
        console.error('[toggleStudentEvalParentVisible]', e);
        const msg = (e && e.message) || '';
        if (msg.includes('parent_portal_visible') || (e && String(e).includes('column'))) {
            showToast('DB 마이그레이션(SUPABASE_EVAL_PARENT_VISIBLE_AI_20260329.sql)을 먼저 적용해주세요.', 'error');
        } else {
            showToast('설정 저장에 실패했습니다.', 'error');
        }
    }
};

window.runStudentEvalAiGenerate = async function(mode) {
    const genBtn = document.getElementById('student-eval-ai-generate-btn');
    const refBtn = document.getElementById('student-eval-refine-run-btn');
    const ta = document.getElementById('student-eval-textarea');
    if (!ta) return;
    if (typeof supabase === 'undefined') {
        showToast('Supabase에 연결되지 않았습니다.', 'error');
        return;
    }

    const sid = ta.dataset.studentId;
    const month = ta.dataset.evalMonth;
    if (!sid || !month) {
        showToast('학생 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    if (mode === 'refine') {
        const instr = (document.getElementById('student-eval-refine-input')?.value || '').trim();
        if (!instr) {
            showToast('추가 요청사항을 입력해주세요.', 'warning');
            return;
        }
        if (!ta.value.trim()) {
            showToast('먼저 종합 평가를 작성하거나 AI 생성을 실행해주세요.', 'warning');
            return;
        }
    }

    await supabase.auth.refreshSession().catch(() => {});
    let accessToken = null;
    try {
        const { data: sess } = await supabase.auth.getSession();
        accessToken = sess && sess.session && sess.session.access_token ? sess.session.access_token : null;
        if (!accessToken) {
            const { data: ref } = await supabase.auth.refreshSession();
            accessToken = ref && ref.session && ref.session.access_token ? ref.session.access_token : null;
        }
    } catch (e) {
        console.warn('[runStudentEvalAiGenerate] 세션 조회:', e);
    }
    if (!accessToken) {
        showToast('로그인 세션이 없거나 만료되었습니다. 다시 로그인해주세요.', 'error');
        return;
    }

    const body = {
        studentId: parseInt(sid, 10),
        evalMonth: month,
        mode: mode === 'refine' ? 'refine' : 'generate'
    };
    if (mode === 'refine') {
        body.currentComment = ta.value.trim();
        body.refinementInstruction = (document.getElementById('student-eval-refine-input')?.value || '').trim();
    }

    const busy = mode === 'refine' ? refBtn : genBtn;
    const prevHtml = busy ? busy.innerHTML : '';
    if (busy) {
        busy.disabled = true;
        busy.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
    }
    if (genBtn && mode === 'refine') genBtn.disabled = true;

    try {
        const { data, error } = await supabase.functions.invoke('generate-student-eval-report', {
            body,
            headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (error) {
            console.error('[runStudentEvalAiGenerate]', error);
            showToast('AI 요청에 실패했습니다. Edge 함수 재배포(supabase/config.toml의 verify_jwt)와 네트워크를 확인해주세요.', 'error');
            return;
        }
        if (!data || !data.ok) {
            const map = {
                unauthorized: '다시 로그인해주세요.',
                forbidden: '이 학생에 대한 권한이 없습니다.',
                gemini_not_configured: 'Supabase에 GEMINI_API_KEY 시크릿을 설정해주세요.',
                refine_missing: '수정 요청 내용을 확인해주세요.',
                invalid_input: '입력값이 올바르지 않습니다.',
                empty_output: 'AI 응답이 비었습니다. 다시 시도해주세요.',
                gemini_http: 'AI 서버 오류입니다. 잠시 후 다시 시도해주세요.'
            };
            showToast(map[data.error] || '생성에 실패했습니다.', 'error');
            return;
        }
        const text = stripLeadingEvalArtifact(String(data.text || '')).slice(0, STUDENT_EVAL_COMMENT_MAX_CHARS);
        ta.value = text;
        const cc = document.getElementById('student-eval-char');
        if (cc) cc.textContent = String(text.length);
        ta.dataset.parentVisible = '0';
        window.updateStudentEvalParentToggleUi();
        await window.saveStudentEvaluation(sid, month, text, currentTeacherId, { parentPortalVisible: false });
        showToast(
            mode === 'refine'
                ? '다시 작성되어 저장했습니다.'
                : 'AI 초안을 저장했습니다. 학부모 공개는 별도로 켜주세요.',
            'success'
        );
    } catch (e) {
        console.error('[runStudentEvalAiGenerate]', e);
        showToast('오류가 발생했습니다.', 'error');
    } finally {
        if (busy) {
            busy.disabled = false;
            busy.innerHTML = prevHtml;
        }
        if (genBtn) genBtn.disabled = false;
    }
};

/** 종합평가: 원장 AI 고정 지침 누적 저장 */
window.saveOwnerEvalAiStyleNoteFromModal = async function() {
    const ta = document.getElementById('student-eval-ai-style-append');
    if (!ta || typeof window.appendOwnerStudentEvalAiStyleNote !== 'function') return;
    const ok = await window.appendOwnerStudentEvalAiStyleNote(ta.value);
    if (ok) ta.value = '';
};

window.onScheduleFontSizeInput = function (val) {
    const el = document.getElementById('schedule-font-size-val');
    if (el) el.textContent = `${val}px`;
};

window.resetScheduleEntryForm = function () {
    const editId = document.getElementById('schedule-edit-id');
    if (editId) editId.value = '';
    const nameEl = document.getElementById('schedule-name');
    if (nameEl) nameEl.value = '';
    const typeEl = document.getElementById('schedule-type');
    if (typeEl) typeEl.value = 'academy';
    const rangeEl = document.getElementById('schedule-font-size');
    if (rangeEl) rangeEl.value = String(DEFAULT_SCHEDULE_FONT_SIZE);
    onScheduleFontSizeInput(String(DEFAULT_SCHEDULE_FONT_SIZE));
    setHolidayTextColor('#ef4444');
    setHolidayBgColor('');
    const anchor = document.getElementById('setting-date-str')?.value;
    if (anchor) {
        const s = document.getElementById('schedule-start-date');
        const e = document.getElementById('schedule-end-date');
        if (s) s.value = anchor;
        if (e) e.value = anchor;
    }
};

function renderScheduleExistingListForModal(dateStr) {
    const container = document.getElementById('schedule-existing-list');
    if (!container) return;
    const entries = getCustomHolidayEntriesOnly(dateStr);
    if (!entries.length) {
        container.innerHTML =
            '<div class="schedule-list-empty">등록된 일정이 없습니다. 스케줄 이름을 입력한 뒤 저장하면 추가됩니다.</div>';
        return;
    }
    container.innerHTML = entries.map((e, idx) => {
        const typeLabel = e.scheduleType === 'academy' ? '학원' : '개인';
        const tc = e.textColor || e.color || defaultColor;
        const bc = e.bgColor != null && e.bgColor !== '' ? e.bgColor : '';
        const bgDot =
            bc !== ''
                ? `<span class="sched-dot sched-dot-bg" style="background:${bc}" title="배경색"></span>`
                : '<span class="sched-dot sched-dot-bg sched-dot-bg-empty" title="배경 없음"></span>';
        return `<div class="schedule-list-item">
      <div class="sched-dots" aria-hidden="true">
        <span class="sched-dot" style="background:${tc}" title="글자색"></span>
        ${bgDot}
      </div>
      <div class="sched-list-main">
        <span class="sched-name">${escapeHtml(e.name)}</span>
        <span class="sched-meta">${typeLabel} · ${e.fontSize || DEFAULT_SCHEDULE_FONT_SIZE}px</span>
      </div>
      <div class="sched-list-actions">
        <button type="button" class="sched-mini-btn" onclick="editScheduleEntryInModal(${idx})">편집</button>
        <button type="button" class="sched-mini-btn danger" onclick="deleteScheduleEntryInModal(${idx})">삭제</button>
      </div>
    </div>`;
    }).join('');
}

window.editScheduleEntryInModal = function (idx) {
    const dateStr = document.getElementById('setting-date-str')?.value;
    if (!dateStr) return;
    const entries = getCustomHolidayEntriesOnly(dateStr);
    const e = entries[Number(idx)];
    if (!e) return;
    const editId = document.getElementById('schedule-edit-id');
    if (editId) editId.value = e.id != null ? String(e.id) : '';
    document.getElementById('schedule-name').value = e.name;
    document.getElementById('schedule-type').value = e.scheduleType || 'academy';
    setHolidayTextColor(e.textColor || e.color || '#ef4444');
    setHolidayBgColor(e.bgColor != null && e.bgColor !== '' ? e.bgColor : '');
    const r = document.getElementById('schedule-font-size');
    const fs = e.fontSize || DEFAULT_SCHEDULE_FONT_SIZE;
    if (r) r.value = String(fs);
    onScheduleFontSizeInput(String(fs));
    document.getElementById('schedule-start-date').value = dateStr;
    document.getElementById('schedule-end-date').value = dateStr;
};

window.deleteScheduleEntryInModal = async function (idx) {
    const dateStr = document.getElementById('setting-date-str')?.value;
    if (!dateStr) return;
    const entries = getCustomHolidayEntriesOnly(dateStr).slice();
    const e = entries[Number(idx)];
    if (!e) return;
    if (!(await showConfirm(`"${e.name}" 일정을 삭제할까요?`, { type: 'danger', title: '삭제 확인', okText: '삭제' }))) return;
    if (e.id != null && typeof deleteHolidayFromDatabaseById === 'function') {
        try {
            await deleteHolidayFromDatabaseById(e.id);
        } catch (err) {
            console.error('스케줄 DB 삭제 실패:', err);
            showToast('DB 삭제에 실패했습니다. 네트워크·권한을 확인하세요.', 'error');
            return;
        }
    }
    entries.splice(Number(idx), 1);
    if (entries.length) customHolidays[dateStr] = entries;
    else delete customHolidays[dateStr];
    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));
    renderScheduleExistingListForModal(dateStr);
    const deleteBtn = document.getElementById('schedule-delete-btn');
    if (deleteBtn) deleteBtn.style.display = getCustomHolidayEntriesOnly(dateStr).length ? 'inline-flex' : 'none';
    renderCalendar();
    showToast('일정이 삭제되었습니다.', 'success');
};

window.openDaySettings = function (dateStr) {
    document.getElementById('day-settings-modal').style.display = 'flex';
    document.getElementById('day-settings-title').textContent = `${dateStr} 설정`;
    document.getElementById('setting-date-str').value = dateStr;

    resetScheduleEntryForm();
    renderScheduleExistingListForModal(dateStr);

    const deleteBtn = document.getElementById('schedule-delete-btn');
    const customList = getCustomHolidayEntriesOnly(dateStr);
    if (deleteBtn) deleteBtn.style.display = customList.length ? 'inline-flex' : 'none';

    document.getElementById('schedule-start-date').value = dateStr;
    document.getElementById('schedule-end-date').value = dateStr;

    document.getElementById('is-red-day').value = customList.length ? 'true' : '';
    document.getElementById('day-name').value = '';

    setTimeout(() => setupHolidayColorChips(), 0);
};

window.saveDaySettings = async function () {
    const anchorDate = document.getElementById('setting-date-str').value;
    const scheduleName = (document.getElementById('schedule-name')?.value || '').trim();
    const textColor = document.getElementById('holiday-text-color')?.value || '#ef4444';
    const bgRaw = (document.getElementById('holiday-bg-color')?.value ?? '').trim();
    const bgColor = bgRaw === '' ? null : bgRaw;
    const scheduleType = document.getElementById('schedule-type')?.value || 'academy';
    const startDate = document.getElementById('schedule-start-date')?.value || anchorDate;
    const endDate = document.getElementById('schedule-end-date')?.value || anchorDate;
    const editIdRaw = (document.getElementById('schedule-edit-id')?.value || '').trim();
    const editId = editIdRaw ? Number(editIdRaw) : null;
    const fontSizeRaw = Number(document.getElementById('schedule-font-size')?.value);
    const fontSize = Number.isFinite(fontSizeRaw) ? Math.min(32, Math.max(8, Math.round(fontSizeRaw))) : DEFAULT_SCHEDULE_FONT_SIZE;

    if (!scheduleName) {
        showToast('스케줄 이름을 입력하거나, 목록에서 삭제하세요.', 'warning');
        return;
    }
    if (startDate > endDate) {
        showToast('종료일이 시작일보다 빠릅니다.', 'warning');
        return;
    }

    const typeLabel = scheduleType === 'academy' ? '학원 전체 일정' : '개인 스케줄';
    const teacherIdForRow = scheduleType === 'academy' ? 'academy' : currentTeacherId;

    if (editId && Number.isFinite(editId)) {
        if (!(await showConfirm(`"${scheduleName}" 일정을 수정합니다.\n\n날짜: ${anchorDate}\n\n계속할까요?`, { type: 'question' }))) return;
        const arr = getCustomHolidayEntriesOnly(anchorDate).slice();
        const ix = arr.findIndex((x) => x.id != null && String(x.id) === String(editId));
        if (ix >= 0) {
            arr[ix] = {
                ...arr[ix],
                name: scheduleName,
                color: textColor,
                textColor,
                bgColor,
                scheduleType,
                fontSize
            };
            customHolidays[anchorDate] = arr;
        }
        if (typeof updateHolidayInDatabase === 'function') {
            try {
                await updateHolidayInDatabase(editId, { name: scheduleName, color: textColor, bgColor, fontSize });
            } catch (dbError) {
                console.error('스케줄 DB 수정 실패:', dbError);
                showToast('DB 수정 실패: 마이그레이션(Supabase SQL) 적용 여부를 확인하세요.', 'error');
                return;
            }
        }
    } else {
        if (!(await showConfirm(`"${scheduleName}"을(를) ${typeLabel}로 추가합니다.\n\n기간: ${startDate} ~ ${endDate}\n(각 날짜에 기존 일정에 이어서 추가됩니다)\n\n계속할까요?`, { type: 'question' }))) return;

        const start = new Date(startDate);
        const end = new Date(endDate);
        const inserts = [];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const ds = d.toISOString().split('T')[0];
            const prev = getCustomHolidayEntriesOnly(ds).slice();
            const newEntry = {
                id: null,
                name: scheduleName,
                color: textColor,
                textColor,
                bgColor,
                scheduleType,
                fontSize
            };
            if (typeof insertHolidayToDatabase === 'function') {
                try {
                    const row = await insertHolidayToDatabase({
                        teacherId: teacherIdForRow,
                        date: ds,
                        name: scheduleName,
                        color: textColor,
                        bgColor,
                        fontSize
                    });
                    if (row && row.id != null) newEntry.id = Number(row.id);
                } catch (dbError) {
                    console.error('스케줄 DB 저장 실패:', ds, dbError);
                    showToast(`DB 저장 실패 (${ds}). holidays 테이블 마이그레이션을 확인하세요.`, 'error');
                    return;
                }
            }
            prev.push(newEntry);
            customHolidays[ds] = prev;
            inserts.push(ds);
        }
        console.log(`스케줄 추가 완료: ${scheduleName} (${inserts.length}일)`);
    }

    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));
    resetScheduleEntryForm();
    renderScheduleExistingListForModal(anchorDate);
    const deleteBtn = document.getElementById('schedule-delete-btn');
    if (deleteBtn) deleteBtn.style.display = getCustomHolidayEntriesOnly(anchorDate).length ? 'inline-flex' : 'none';
    closeModal('day-settings-modal');
    renderCalendar();
    showToast('저장되었습니다.', 'success');
};

/** 이 날짜의 사용자 등록 일정을 모두 삭제 (DB 행 전부) */
window.deleteScheduleFromModal = async function () {
    const dateStr = document.getElementById('setting-date-str').value;
    if (!dateStr) return;

    const entries = getCustomHolidayEntriesOnly(dateStr);
    if (!entries.length) {
        showToast('삭제할 스케줄이 없습니다.', 'info');
        closeModal('day-settings-modal');
        return;
    }

    if (!(await showConfirm(`${dateStr}에 등록된 사용자 일정 ${entries.length}건을 모두 삭제할까요?`, { type: 'danger', okText: '삭제' }))) return;

    for (const e of entries) {
        if (e.id != null && typeof deleteHolidayFromDatabaseById === 'function') {
            try {
                await deleteHolidayFromDatabaseById(e.id);
            } catch (dbError) {
                console.error('스케줄 DB 삭제 실패:', dbError);
            }
        }
    }
    delete customHolidays[dateStr];

    const holKey = `academy_holidays__${currentTeacherId || 'no-teacher'}`;
    localStorage.setItem(holKey, JSON.stringify(customHolidays));

    closeModal('day-settings-modal');
    renderCalendar();
    showToast('일정이 삭제되었습니다.', 'success');
};

/**
 * Supabase public.payments 를 로컬 students[].payments 에 병합
 * - ledger_json 이 있으면 updatedAt 비교 후 더 최신 쪽을 반영
 * - 레거시 DB 행만 있으면 최소 원장 객체로 복원
 */
function mergeRemotePaymentsIntoPaymentsMap(students, remoteRows) {
    if (!remoteRows || !remoteRows.length || !students || !students.length) return;
    const byStudent = new Map();
    for (const row of remoteRows) {
        const sid = String(row.student_id);
        if (!byStudent.has(sid)) byStudent.set(sid, []);
        byStudent.get(sid).push(row);
    }
    for (const s of students) {
        const sid = String(s.id);
        const rows = byStudent.get(sid);
        if (!rows) continue;
        if (!s.payments) s.payments = {};
        for (const row of rows) {
            const mk = row.payment_month;
            if (!mk) continue;
            const localMonth = s.payments[mk] || {};
            const localLedger = localMonth.ledger;
            const remoteLedger = row.ledger_json;

            if (remoteLedger && typeof remoteLedger === 'object') {
                const rTime = remoteLedger.updatedAt ? new Date(remoteLedger.updatedAt).getTime() : 0;
                const lTime = localLedger && localLedger.updatedAt ? new Date(localLedger.updatedAt).getTime() : 0;
                if (!localLedger || rTime > lTime) {
                    if (!s.payments[mk]) s.payments[mk] = {};
                    s.payments[mk].ledger = { ...remoteLedger };
                }
            } else if (!localLedger && (row.channel != null || row.supply_amount != null || row.paid_at_text || row.reference_id)) {
                if (!s.payments[mk]) s.payments[mk] = {};
                const refund = Number(row.refund_amount) || 0;
                const paidNet = Number(row.paid_amount) || 0;
                s.payments[mk].ledger = {
                    dueAmount: Number(row.amount) || 0,
                    paidAmount: paidNet + refund,
                    supplyAmount: Number(row.supply_amount) || 0,
                    vatAmount: Number(row.vat_amount) || 0,
                    paidAt: row.paid_at_text || (row.payment_date ? String(row.payment_date) : ''),
                    channel: row.channel || '',
                    method: row.method || '',
                    referenceId: row.reference_id || '',
                    evidenceType: row.evidence_type || 'manual',
                    evidenceNumber: row.evidence_number || '',
                    evidenceName: row.evidence_name || '',
                    unmatchedDeposit: Boolean(row.unmatched_deposit),
                    refundAmount: refund,
                    refundReason: String(row.refund_reason || ''),
                    note: row.memo || '',
                    updatedAt: new Date().toISOString(),
                    syncSource: 'db_flat_columns'
                };
            } else if (!localLedger && (row.amount != null || row.paid_amount != null)) {
                if (!s.payments[mk]) s.payments[mk] = {};
                s.payments[mk].ledger = {
                    dueAmount: Number(row.amount) || 0,
                    paidAmount: Number(row.paid_amount) || 0,
                    paidAt: row.payment_date ? String(row.payment_date) : '',
                    note: row.memo || '',
                    updatedAt: new Date().toISOString(),
                    syncSource: 'db_row_fallback'
                };
            }
        }
    }
}

async function loadAndCleanData() {
    let records = [];
    try {
        console.log('[loadAndCleanData] Supabase에서 학생 데이터 로드 중...');
        const ownerIdForCache = cachedLsGet('current_owner_id') || 'no-owner';
        const ownerKey = `academy_students__${ownerIdForCache}`;
        let localPaymentsByStudentId = new Map();
        try {
            const localRaw = localStorage.getItem(ownerKey);
            const localStudents = JSON.parse(localRaw || '[]');
            if (Array.isArray(localStudents)) {
                localPaymentsByStudentId = new Map(
                    localStudents
                        .map((s) => [String(s?.id || ''), s?.payments && typeof s.payments === 'object' ? s.payments : {}])
                        .filter(([id]) => !!id)
                );
            }
        } catch (e) {
            console.warn('[loadAndCleanData] 로컬 payments 캐시 로드 실패:', e);
        }
        
        // 학생 목록과 owner 전체 출석 기록·수납(payments)을 동시에 조회
        const attendancePromise = typeof getAttendanceRecordsByOwner === 'function'
            ? getAttendanceRecordsByOwner(null)
            : Promise.resolve([]);
        const remotePaymentsPromise = typeof getPaymentsByOwnerForSync === 'function'
            ? getPaymentsByOwnerForSync()
            : Promise.resolve([]);
        const [supabaseStudents, recordsFetched, remotePayments] = await Promise.all([
            getAllStudents(),
            attendancePromise,
            remotePaymentsPromise
        ]);
        records = recordsFetched || [];
        console.log('[loadAndCleanData] Supabase 학생 수:', supabaseStudents.length);
        
        if (supabaseStudents && supabaseStudents.length > 0) {
            // Supabase 데이터를 앱 형식으로 변환
            students = supabaseStudents.map(s => {
                const metaFromMemo = parseStudentMetaFromMemo(s.memo || '');
                const weeklyPatternFromMemo = parseWeeklyPatternFromMemo(s.memo || '');
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
                memo: stripWeeklyPatternFromMemo(stripStudentMetaFromMemo(s.memo || '')),
                weeklyPattern: weeklyPatternFromMemo,
                registerDate: s.register_date || '',
                parentCode: s.parent_code || '',
                studentCode: s.student_code || '',
                status: s.status || 'active',
                statusChangedDate: s.status_changed_date || null,
                teacher_id: s.teacher_id || '',
                events: [],
                attendance: {},
                records: {},
                shared_records: {},
                // 수납: 로컬 캐시 우선 병합 후, Supabase payments(ledger_json)로 최신분 보강
                payments: localPaymentsByStudentId.get(String(s.id)) || {}
            });
            });
            mergeRemotePaymentsIntoPaymentsMap(students, remotePayments || []);
            // 로컬 스토리지에도 백업 저장
            localStorage.setItem(ownerKey, JSON.stringify(students));
            console.log(`[loadAndCleanData] Supabase에서 학생 데이터 로드 완료: ${students.length}명`);
        } else {
            // Supabase에 학생이 없으면 students를 빈 배열로 강제 (로컬 fallback 금지)
            students = [];
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
        const isAttendanceReasonMemo = (txt) => {
            const t = String(txt || '').trim();
            if (!t) return false;
            const patterns = [
                '[전화번호인증]',
                '전화번호인증',
                '[지각후인증]',
                '지각후인증',
                '[수업종료후임시]',
                '수업종료후임시',
                '임시출석'
            ];
            return patterns.some(p => t.includes(p));
        };
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

                    // 개인 메모 동기화 (DB → 로컬 records) : class_memo 우선
                    const memoCandidate = (record.class_memo !== undefined && record.class_memo !== null)
                        ? record.class_memo
                        : record.memo;
                    if (memoCandidate && String(memoCandidate).trim() && !isAttendanceReasonMemo(memoCandidate)) {
                        if (!student.records) student.records = {};
                        if (typeof student.records[dateKey] === 'string') {
                            const prev = student.records[dateKey];
                            student.records[dateKey] = {};
                            student.records[dateKey]['default'] = prev;
                        }
                        if (!student.records[dateKey] || typeof student.records[dateKey] !== 'object') {
                            student.records[dateKey] = {};
                        }
                        student.records[dateKey][scheduledTimeKey] = memoCandidate;
                    }

                    // 공유 메모 동기화 (DB → 로컬 shared_records) : class_shared_memo 우선
                    const sharedCandidate = (record.class_shared_memo !== undefined && record.class_shared_memo !== null)
                        ? record.class_shared_memo
                        : record.shared_memo;
                    if (sharedCandidate && String(sharedCandidate).trim() && !isAttendanceReasonMemo(sharedCandidate)) {
                        if (!student.shared_records) student.shared_records = {};
                        if (typeof student.shared_records[dateKey] === 'string') {
                            const prev = student.shared_records[dateKey];
                            student.shared_records[dateKey] = {};
                            student.shared_records[dateKey]['default'] = prev;
                        }
                        if (!student.shared_records[dateKey] || typeof student.shared_records[dateKey] !== 'object') {
                            student.shared_records[dateKey] = {};
                        }
                        student.shared_records[dateKey][scheduledTimeKey] = sharedCandidate;
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

        // ★ 공유 메모 별도 조회: teacher_id 무관하게 모든 공유 메모를 가져와서 students에 반영
        const ownerId = cachedLsGet('current_owner_id');
        if (ownerId && students.length > 0) {
            try {
                const { data: sharedData, error: sharedErr } = await supabase
                    .from('attendance_records')
                    .select('student_id, attendance_date, scheduled_time, teacher_id, shared_memo, class_shared_memo')
                    .eq('owner_user_id', ownerId)
                    ;

                if (!sharedErr && sharedData && sharedData.length > 0) {
                    sharedData.forEach(rec => {
                        const sharedCandidate = (rec.class_shared_memo !== undefined && rec.class_shared_memo !== null)
                            ? rec.class_shared_memo
                            : rec.shared_memo;
                        if (!sharedCandidate || !String(sharedCandidate).trim()) return;
                        if (isAttendanceReasonMemo(sharedCandidate)) return;
                        const student = studentById.get(String(rec.student_id));
                        if (!student) return;
                        if (!student.shared_records) student.shared_records = {};
                        const dk = rec.attendance_date;
                        const tk = `${rec.scheduled_time || 'default'}__${rec.teacher_id || 'unknown'}`;
                        if (!student.shared_records[dk] || typeof student.shared_records[dk] !== 'object') {
                            student.shared_records[dk] = {};
                        }
                        student.shared_records[dk][tk] = sharedCandidate;
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
                dbHolidays.forEach((h) => {
                    const ds = h.holiday_date;
                    if (!customHolidays[ds]) customHolidays[ds] = [];
                    const fs = h.font_size != null ? Number(h.font_size) : DEFAULT_SCHEDULE_FONT_SIZE;
                    const tc = h.color || '#ef4444';
                    const bg = h.bg_color != null && h.bg_color !== '' ? h.bg_color : null;
                    customHolidays[ds].push({
                        id: h.id != null ? Number(h.id) : null,
                        name: h.holiday_name,
                        color: tc,
                        textColor: tc,
                        bgColor: bg,
                        scheduleType: h.scheduleType || (h.teacher_id === 'academy' ? 'academy' : 'personal'),
                        fontSize: Number.isFinite(fs) ? Math.min(32, Math.max(8, Math.round(fs))) : DEFAULT_SCHEDULE_FONT_SIZE
                    });
                });
                console.log(`스케줄 DB 로드 (${currentTeacherId}): ${dbHolidays.length}행 (학원전체 + 개인, 날짜당 복수 가능)`);
                
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

/** DB에 start_time이 비어 있는 레거시/수동 행 — 캘린더·겹침 검사용 기본 슬롯 */
const DEFAULT_SCHEDULE_START_FALLBACK = '09:00';

/** owner_user_id 기준 schedules 전체 (PostgREST 기본 1000행 제한 회피) */
async function fetchSchedulesForOwnerPaged(ownerId) {
    if (!ownerId || typeof supabase === 'undefined') return [];
    const pageSize = 1000;
    let from = 0;
    const all = [];
    for (;;) {
        const { data, error } = await supabase
            .from('schedules')
            .select('teacher_id, student_id, schedule_date, start_time, duration')
            .eq('owner_user_id', ownerId)
            .range(from, from + pageSize - 1);
        if (error) {
            console.error('[fetchSchedulesForOwnerPaged]', error);
            return all;
        }
        const chunk = data || [];
        all.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

/**
 * owner 전체 fetch(`loadAllTeachersScheduleData`의 otherTeachers)에서 특정 teacher_id로
 * 묶인 버킷을 `teacherScheduleData[teacherId]`와 **합집합** 병합한다.
 * `getSchedulesByTeacher` + `loadTeacherScheduleData`의 owner 보강만으로는
 * 호출 순서·해석 차이로 빈틈이 남을 수 있어, 동일 DB를 두 경로로 맞춘다.
 */
function mergeScheduleBucketsIntoTeacherScheduleData(teacherId, additions) {
    if (!teacherId || !additions || typeof additions !== 'object') return;
    const tid = String(teacherId).trim();
    if (!tid) return;
    if (!teacherScheduleData[tid]) teacherScheduleData[tid] = {};
    Object.keys(additions).forEach((sidRaw) => {
        const sid = String(sidRaw).trim();
        if (!sid || sid === 'null' || sid === 'undefined') return;
        const byDate = additions[sidRaw];
        if (!byDate || typeof byDate !== 'object') return;
        if (!teacherScheduleData[tid][sid]) teacherScheduleData[tid][sid] = {};
        Object.keys(byDate).forEach((dk) => {
            const nk = normalizeScheduleDateKeyLocal(dk);
            if (!nk) return;
            const incoming = normalizeScheduleEntries(byDate[dk]);
            if (!incoming.length) return;
            let next = [...getScheduleEntries(tid, sid, nk)];
            incoming.forEach((ent) => {
                let st = normalizeScheduleTimeKey(ent?.start || '');
                if (!st || st === 'default') st = DEFAULT_SCHEDULE_START_FALLBACK;
                const duration = parseInt(ent?.duration, 10) || 60;
                next = upsertScheduleEntry(next, { start: st, duration }).list;
            });
            setScheduleEntries(tid, sid, nk, next);
        });
    });
}

// 선생님별 일정 데이터 로드
// opts.skipOwnerPagedHydrate: 곧바로 `loadAllTeachersScheduleData(동일 owner fetch 결과)`를 호출할 때
//   owner `schedules` 전체를 두 번 가져오지 않도록 생략한다.
// opts.skipRefreshCurrentTeacherStudents: `loadAndCleanData`와 병렬 실행 시 끝에서 갱신하지 않고
//   호출부에서 한 번만 `refreshCurrentTeacherStudents` 하도록 할 때 사용.
async function loadTeacherScheduleData(teacherId, opts) {
    const {
        skipOwnerPagedHydrate = false,
        skipRefreshCurrentTeacherStudents = false
    } = opts && typeof opts === 'object' ? opts : {};
    try {
        const normalizedTeacherId = String(resolveKnownTeacherId(teacherId) || teacherId || '').trim();
        const appendScheduleEntry = (ownerTid, schedule) => {
            const sid = String(schedule?.student_id || '').trim();
            const date = normalizeScheduleDateKeyLocal(String(schedule?.schedule_date || '').trim());
            let start = normalizeScheduleTimeKey(schedule?.start_time || '');
            if (!start || start === 'default') {
                start = DEFAULT_SCHEDULE_START_FALLBACK;
            }
            if (!ownerTid || !sid || !date) return;
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
        // 수파베이스에서 먼저 로드 — 두 fetch 를 Promise.all 로 병렬화 (대략 1RTT 절약)
        if (typeof getSchedulesByTeacher === 'function') {
            try {
                const ownerId = cachedLsGet('current_owner_id');
                const ownerHydrate = (!skipOwnerPagedHydrate && ownerId && typeof supabase !== 'undefined' && typeof fetchSchedulesForOwnerPaged === 'function')
                    ? fetchSchedulesForOwnerPaged(ownerId).catch((e) => {
                        console.warn('[loadTeacherScheduleData] owner 전체 보강 조회 실패:', e);
                        return null;
                    })
                    : Promise.resolve(null);

                const [dbSchedules, ownerSchedules] = await Promise.all([
                    getSchedulesByTeacher(teacherId),
                    ownerHydrate,
                ]);

                teacherScheduleData[teacherId] = {};

                (dbSchedules || []).forEach(schedule => {
                    appendScheduleEntry(teacherId, schedule);
                });

                if (Array.isArray(ownerSchedules)) {
                    ownerSchedules.forEach((row) => {
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

                console.log(`일정 DB 로드 (${teacherId}): ${(dbSchedules || []).length}개`);
                
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
        normalizeAllTeacherScheduleDataDateKeys();
        if (teacherId === currentTeacherId && !skipRefreshCurrentTeacherStudents) {
            await refreshCurrentTeacherStudents();
        }
    } catch (e) {
        console.error('선생님 일정 데이터 로드 실패:', e);
        teacherScheduleData[teacherId] = {};
    }
}

/** 일정 DB 변경(삭제·저장 등) 후: 현재 선생님 로드 + 전체 보기용 타 선생님 버킷 동기화 */
async function reloadScheduleDataAfterOwnerMutation() {
    const tid = currentTeacherId;
    if (!tid) return;
    await loadTeacherScheduleData(tid);
    if (typeof loadAllTeachersScheduleData === 'function') {
        await loadAllTeachersScheduleData();
    }
}

// ★ 모든 선생님의 일정 데이터 로드 (겹침 확인/알림 등에 필요)
// prefetchedSchedules: `fetchSchedulesForOwnerPaged` 결과를 넘기면 네트워크 1회 생략(선생님 선택 진입 최적화)
async function loadAllTeachersScheduleData(prefetchedSchedules) {
    allScopeScheduleLoading = true;
    if (timetableScope === 'all') {
        allScopeScheduleHydrated = false;
    }
    try {
        if (typeof supabase === 'undefined') return;
        const ownerId = cachedLsGet('current_owner_id');
        if (!ownerId) return;

        const data = Array.isArray(prefetchedSchedules)
            ? prefetchedSchedules
            : await fetchSchedulesForOwnerPaged(ownerId);

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
            const date = normalizeScheduleDateKeyLocal(String(schedule.schedule_date || '').trim());
            let startRaw = schedule.start_time ? String(schedule.start_time).substring(0, 5) : '';
            if (!startRaw || String(startRaw).trim() === '') {
                startRaw = DEFAULT_SCHEDULE_START_FALLBACK;
            }
            const entry = {
                start: startRaw,
                duration: schedule.duration
            };

            if (!date) return;

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

        // 현재 선생님: owner 전체 해석(otherTeachers)을 teacherScheduleData와 합집합 병합
        if (currentTeacherId) {
            const curKey = String(currentTeacherId);
            const curBucket = otherTeachers[curKey];
            if (curBucket && Object.keys(curBucket).length) {
                mergeScheduleBucketsIntoTeacherScheduleData(curKey, curBucket);
                try {
                    const key = `teacher_schedule_data__${curKey}`;
                    localStorage.setItem(key, JSON.stringify(teacherScheduleData[curKey] || {}));
                } catch (_) { /* ignore */ }
            }
        }

        // 현재 선생님 데이터는 유지하고, 다른 선생님 데이터를 병합
        const knownTeacherIds = (teacherList || [])
            .map((t) => String(t.id || '').trim())
            .filter(Boolean);
        const knownSet = new Set(knownTeacherIds.map(String));
        // 알려진 선생님(현재 제외): DB에 해당 teacher_id 행이 없으면 otherTeachers[tid]가 비어 있음 → 빈 객체로 동기화
        // (이전 구현은 for (tid in otherTeachers)만 갱신해, 일정이 전부 삭제된 선생님의 오래된 teacherScheduleData가 남을 수 있었음)
        knownTeacherIds.forEach((kid) => {
            if (String(kid) === String(currentTeacherId)) return;
            teacherScheduleData[kid] = otherTeachers[kid] || {};
        });
        for (const tid in otherTeachers) {
            if (String(tid) === String(currentTeacherId)) continue;
            if (!knownSet.has(String(tid))) {
                teacherScheduleData[tid] = otherTeachers[tid];
            }
        }

        const otherCount = knownTeacherIds.filter((t) => String(t) !== String(currentTeacherId)).length;
        console.log(`[loadAllTeachersScheduleData] 다른 선생님(알려진 ${otherCount}명) 동기화 · DB 총 ${(data || []).length}건`);
        normalizeLegacyTeacherScheduleOwnership();
        normalizeAllTeacherScheduleDataDateKeys();
    } catch (e) {
        console.error('[loadAllTeachersScheduleData] 예외:', e);
    } finally {
        allScopeScheduleLoading = false;
        allScopeScheduleHydrated = true;
        try {
            if (currentTeacherId && typeof refreshCurrentTeacherStudents === 'function') {
                refreshCurrentTeacherStudents();
            }
        } catch (_) { /* ignore */ }
        // 전체 선생님 모드: 본 함수 시작 시 loading=true가 되며, 디바운스된 renderCalendar(50ms)가
        // 이 구간과 겹치면 모든 셀이 「집계중」으로 박힌 뒤 완료 후 재페인트가 없어 고정되는 버그가 난다.
        try {
            if (typeof window.renderCalendar === 'function') {
                window.renderCalendar(true);
            }
        } catch (_) { /* ignore */ }
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

    const byStudentId = new Map((students || []).map((s) => [String(s.id), s]));
    const out = [];

    mergedIds.forEach((idStr) => {
        let s = byStudentId.get(idStr);
        if (!s) {
            // 일정 DB에는 있으나 전역 students에 아직 없거나(로드 순서)·삭제 잔존 행 등 — 캘린더 집계에서 누락 방지
            const numericId = /^\d+$/.test(idStr) ? parseInt(idStr, 10) : idStr;
            s = {
                id: numericId,
                name: `학생 #${idStr}`,
                grade: '-',
                school: '',
                status: 'active',
                _scheduleOnlyStudent: true
            };
        }
        out.push(s);
    });

    // 활성 학생 + 퇴원/휴원(종료일 유무와 관계없이 목록에 포함 — `shouldShowScheduleForStudent`가 일별 표시 제어)
    return out.filter((s) => {
        if (s._scheduleOnlyStudent) return true;
        if (s.status === 'active') return true;
        if (s.status === 'archived' || s.status === 'paused') return true;
        return false;
    });
}

// 퇴원/휴원 학생의 일정을 해당 날짜에 표시할지 판단
function shouldShowScheduleForStudent(student, dateStr) {
    if (!student) return false;
    const day = normalizeScheduleDateKeyLocal(String(dateStr || '').trim());
    if (!day) return false;
    if (student.status === 'active') return true;
    if (student.status === 'archived' || student.status === 'paused') {
        if (!student.statusChangedDate) return true;
        const end = normalizeScheduleDateKeyLocal(String(student.statusChangedDate || '').trim());
        if (!end) return true;
        return day <= end;
    }
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

    await window.openStudentEvalModal(sid, {
        initialTab: focusScoreInput ? 'score' : 'record'
    });
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
    
    // 검색어 필터링 — 이름·학년·학교·전화·#태그·메모
    // 검색어가 #로 시작하면 태그 전용 매칭 (예: "#월수반" → s.memo 의 #월수반 매칭)
    if(searchQuery) {
        const isTagQuery = searchQuery.startsWith('#');
        const tagOnly = isTagQuery ? searchQuery.slice(1).trim() : '';
        filtered = filtered.filter(s => {
            if (tagOnly) {
                const tags = (typeof extractStudentTagsFromMemo === 'function')
                    ? extractStudentTagsFromMemo(s.memo)
                    : [];
                return tags.some(t => t.toLowerCase().includes(tagOnly));
            }
            return (
                (s.name || '').toLowerCase().includes(searchQuery) ||
                (s.grade || '').toLowerCase().includes(searchQuery) ||
                (s.school || '').toLowerCase().includes(searchQuery) ||
                (s.studentPhone || '').toLowerCase().includes(searchQuery) ||
                (s.parentPhone || '').toLowerCase().includes(searchQuery) ||
                (s.memo || '').toLowerCase().includes(searchQuery)
            );
        });
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
            ? `<div style="text-align:center;padding:40px 20px;color:#94a3b8;">
                <i class="fas fa-search" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.4;"></i>
                <p style="font-size:13px;margin:4px 0 0;">"${searchQuery}" 검색 결과가 없습니다</p>
                <button class="empty-state-cta secondary" type="button" onclick="(function(){var el=document.getElementById('drawer-search-input');if(el){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}})();">
                    <i class="fas fa-times" aria-hidden="true"></i> 검색 초기화
                </button>
              </div>`
            : (showInactiveOnly
                ? `<div style="text-align:center;padding:40px 20px;color:#94a3b8;">
                    <i class="fas fa-user-slash" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.4;"></i>
                    <p style="font-size:13px;margin:4px 0 0;">퇴원/휴원 학생이 없습니다</p>
                  </div>`
                : `<div style="text-align:center;padding:40px 20px;color:#94a3b8;">
                    <i class="fas fa-user-plus" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.4;"></i>
                    <p style="font-size:13px;margin:4px 0 0;">등록된 학생이 없습니다</p>
                    <button class="empty-state-cta" type="button" onclick="prepareRegister && prepareRegister()">
                        <i class="fas fa-plus" aria-hidden="true"></i> 첫 학생 등록
                    </button>
                  </div>`);
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

        // teacherOptions 캐시 — 학생마다 forEach 안에서 N×M 문자열 빌드를 한 번씩만
        // (assigned teacher id 단위로 재사용; 100명 × 5선생 = 6 항목 캐시로 정착)
        const _teacherOptionsBase = (teacherList || []).map(t => ({
            id: String(t.id),
            name: String(t.name || '')
        }));
        const _teacherOptionsCache = new Map();
        const buildTeacherOptionsHtml = (assignedId) => {
            const key = String(assignedId || '');
            if (_teacherOptionsCache.has(key)) return _teacherOptionsCache.get(key);
            const html = _teacherOptionsBase.map(({ id, name }) =>
                `<option value="${id}" ${id === key ? 'selected' : ''}>${name}</option>`
            ).join('');
            _teacherOptionsCache.set(key, html);
            return html;
        };
        // 그룹별 멤버 수 — 학생마다 filtered.filter 를 다시 도는 비용 제거
        const _groupCounts = new Map();
        if (currentStudentSort === 'grade' || currentStudentSort === 'school') {
            filtered.forEach(x => {
                const k = getGroupKey(x);
                if (k !== null) _groupCounts.set(k, (_groupCounts.get(k) || 0) + 1);
            });
        }

        filtered.forEach((s, idx) => {
            const groupKey = getGroupKey(s);

            // 그룹 헤더 삽입
            if (groupKey !== null && groupKey !== lastGroup) {
                if (lastGroup !== null) {
                    html += `</div>`; // 이전 그룹 래퍼 닫기
                }
                const style = getGroupStyle(groupKey);
                const membersInGroup = _groupCounts.get(groupKey) || 0;
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
            const teacherOptions = buildTeacherOptionsHtml(assignedTeacherId);
            const assignControl = `
                <select class="m-input" style="width: 84px; min-width: 84px; max-width: 84px; padding: 4px 6px; font-size: 11px;" onchange="setStudentAssignment('${s.id}', this.value)">
                    <option value="">미배정</option>
                    ${teacherOptions}
                </select>
            `;
            const schoolLabel = s.school ? `<span class="student-school-label">${s.school}</span>` : '';
            const isDup = dupNames.has((s.name || '').trim());
            const dupBadge = isDup ? `<span class="dup-name-badge" title="동명이인"><i class="fas fa-user-group"></i></span>` : '';
            // s.memo 에서 #해시태그 추출 → 색상 chip 으로 시각화 (드로어 검색에서 #월수반 으로 매칭됨)
            const tagsHtml = (typeof renderStudentTagsFromMemo === 'function')
                ? renderStudentTagsFromMemo(s.memo)
                : '';
            html += `<div class="student-item ${itemClass}${isDup ? ' has-dup-name' : ''}">
                <div class="student-info" onclick="prepareEdit('${s.id}')">
                    <b>${s.name} ${dupBadge}<span>${s.grade}</span></b>
                    ${schoolLabel}
                    <span>${s.studentPhone || '-'}</span>
                    ${tagsHtml}
                </div>
                <div class="student-quick-actions">
                    <button type="button" class="student-quick-btn eval" onclick="event.stopPropagation(); openHistoryFromStudentList('${s.id}', false)" title="수업 메모·점수·종합평가">
                        <i class="fas fa-star"></i> 평가
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
                    <div class="qr-ops-label">임시 체크 미확정</div>
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
                <button type="button" class="qr-ops-btn alt" onclick="openEmergencyQueueAction()"><i class="fas fa-hourglass-half"></i> 임시 체크 확정</button>
            </div>
        </div>
    `;

    if (total === 0) {
        const hasAction = typeof window.openTodayScheduleSuggestion === 'function';
        el.innerHTML = `
            ${dashboardHtml}
            <div class="qr-schedule-missing-alert">
                <div class="qr-schedule-missing-title"><i class="fas fa-triangle-exclamation"></i> 오늘 등록된 수업이 없습니다</div>
                <div class="qr-schedule-missing-desc">QR 스캔 시 임시 체크 기록이 누적될 수 있어, 먼저 오늘 일정을 등록하는 것을 권장합니다.</div>
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
    if (id === 'teacher-password-modal') {
        const u = document.getElementById('teacher-password-modal-username-ac');
        const chip = document.getElementById('current-teacher-name');
        if (u) u.value = chip && chip.textContent ? chip.textContent.trim() : '';
    }
    if (id === 'period-delete-modal' && typeof window.updatePeriodDeletePreview === 'function') {
        window.updatePeriodDeletePreview();
    }
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
        document.getElementById('sch-duration-min').value = '100';

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

// 일정 등록 기본 수업시간은 학년과 무관하게 100분으로 통일
function updateDurationByGrade() {
    const durationInput = document.getElementById('sch-duration-min');
    const hintEl = document.getElementById('sch-duration-hint');
    if (!durationInput || !hintEl) return;
    durationInput.value = 100;
    hintEl.style.display = 'none';
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
    _resetWeeklyPatternUI();
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
    _populateWeeklyPatternUI(s.weeklyPattern || null);
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

// ============================================================
// 주간 기본 일정 (학생 메모 메타에 임베드 — 마이그레이션 0)
//   marker: [학생주간일정]days=1,3,5|start=16:00|duration=100
//   요일: 0=일,1=월,...,6=토
// ============================================================
const _WEEKLY_PATTERN_MARKER = '[학생주간일정]';

function parseWeeklyPatternFromMemo(memoText) {
    const lines = String(memoText || '').split('\n');
    const line = lines.find((l) => l.startsWith(_WEEKLY_PATTERN_MARKER));
    if (!line) return null;
    const payload = line.slice(_WEEKLY_PATTERN_MARKER.length);
    const map = {};
    payload.split('|').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx >= 0) map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    });
    const days = String(map.days || '')
        .split(',')
        .map((n) => parseInt(n, 10))
        .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);
    const duration = parseInt(map.duration || '0', 10) || 0;
    const start = String(map.start || '').trim();
    if (days.length === 0 || !start || !duration) return null;
    return { days, start, duration };
}

function stripWeeklyPatternFromMemo(memoText) {
    return String(memoText || '')
        .split('\n')
        .filter((l) => !l.startsWith(_WEEKLY_PATTERN_MARKER))
        .join('\n')
        .trim();
}

function buildMemoWithWeeklyPattern(memoText, pattern) {
    const stripped = stripWeeklyPatternFromMemo(memoText || '').trim();
    if (!pattern || !Array.isArray(pattern.days) || pattern.days.length === 0
        || !pattern.start || !pattern.duration) {
        return stripped;
    }
    const sortedDays = [...new Set(pattern.days)].sort((a, b) => a - b);
    const line = `${_WEEKLY_PATTERN_MARKER}days=${sortedDays.join(',')}`
        + `|start=${pattern.start}|duration=${pattern.duration}`;
    return stripped ? `${stripped}\n${line}` : line;
}

/** 학생 등록 모달의 주간 패턴 UI → 객체 변환 (불완전하면 null) */
function _readWeeklyPatternFromUI() {
    const checks = document.querySelectorAll('#reg-weekly-days input[type="checkbox"]:checked');
    const days = Array.from(checks)
        .map((c) => parseInt(c.value, 10))
        .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);
    const startEl = document.getElementById('reg-weekly-start');
    const durEl = document.getElementById('reg-weekly-duration');
    const start = (startEl?.value || '').trim();
    const duration = parseInt(durEl?.value || '0', 10) || 0;
    if (days.length === 0 || !start || !duration) return null;
    return { days, start, duration };
}

function _resetWeeklyPatternUI() {
    document.querySelectorAll('#reg-weekly-days input[type="checkbox"]')
        .forEach((c) => { c.checked = false; });
    const startEl = document.getElementById('reg-weekly-start');
    const durEl = document.getElementById('reg-weekly-duration');
    if (startEl) startEl.value = '';
    if (durEl) durEl.value = '';
}

function _populateWeeklyPatternUI(pattern) {
    document.querySelectorAll('#reg-weekly-days input[type="checkbox"]')
        .forEach((c) => {
            c.checked = !!(pattern && Array.isArray(pattern.days)
                && pattern.days.includes(parseInt(c.value, 10)));
        });
    const startEl = document.getElementById('reg-weekly-start');
    const durEl = document.getElementById('reg-weekly-duration');
    if (startEl) startEl.value = pattern?.start || '';
    if (durEl) durEl.value = pattern?.duration ? String(pattern.duration) : '';
}

/**
 * 학생 1명에 대해 주간 패턴 기반 미래 N주치 일정을 자동 생성.
 *   - 휴일(getHolidayInfo) skip
 *   - 같은 (teacher, student, date, start) 이미 있으면 skip
 *   - 과거(오늘 이전) 자동 skip — fromDate 기본 = 오늘
 *   - DB(saveSchedulesToDatabaseBatch) 까지 동기화
 * 반환: { count, skippedHoliday, skippedExisting }
 */
async function applyStudentWeeklyPattern(studentId, options) {
    const opts = options || {};
    const days = Array.isArray(opts.days) ? opts.days : [];
    const startTime = String(opts.startTime || '').trim();
    const durationMin = parseInt(opts.durationMin || 0, 10) || 0;
    const weeks = parseInt(opts.weeks || 12, 10) || 12;
    const excludeHolidays = opts.excludeHolidays !== false;

    const result = { count: 0, skippedHoliday: 0, skippedExisting: 0 };
    if (!studentId || days.length === 0 || !startTime || !durationMin) return result;

    const student = students.find((s) => String(s.id) === String(studentId));
    if (!student) return result;

    // 담당 선생님 결정 — 학생에 배정된 teacher_id 우선, 없으면 currentTeacherId
    const targetTeacherId = String(
        (typeof getAssignedTeacherId === 'function' && getAssignedTeacherId(String(studentId)))
        || student.teacher_id
        || currentTeacherId
        || ''
    ).trim();
    if (!targetTeacherId) {
        console.warn('[applyStudentWeeklyPattern] 대상 선생님 미확정 — 패턴 적용 생략');
        return result;
    }

    if (!teacherScheduleData[targetTeacherId]) teacherScheduleData[targetTeacherId] = {};
    if (!teacherScheduleData[targetTeacherId][studentId]) teacherScheduleData[targetTeacherId][studentId] = {};
    if (typeof assignStudentToTeacher === 'function') {
        try { assignStudentToTeacher(studentId); } catch (e) {}
    }

    // 시작 = 오늘 (fromDate 옵션 있으면 그날부터)
    const start = opts.fromDate ? new Date(opts.fromDate) : new Date();
    start.setHours(0, 0, 0, 0);

    const scheduleBatch = [];
    for (let i = 0; i < weeks * 7; i++) {
        const cur = new Date(start);
        cur.setDate(start.getDate() + i);
        if (!days.includes(cur.getDay())) continue;
        const off = cur.getTimezoneOffset() * 60000;
        const dStr = new Date(cur.getTime() - off).toISOString().split('T')[0];
        if (excludeHolidays && typeof getHolidayInfo === 'function' && getHolidayInfo(dStr)) {
            result.skippedHoliday++;
            continue;
        }
        const entries = (typeof getScheduleEntries === 'function')
            ? getScheduleEntries(targetTeacherId, String(studentId), dStr)
            : [];
        const exists = entries.some((item) => item.start === startTime);
        if (exists) { result.skippedExisting++; continue; }
        const updated = (typeof upsertScheduleEntry === 'function')
            ? upsertScheduleEntry(entries, { start: startTime, duration: durationMin })
            : { list: [{ start: startTime, duration: durationMin }] };
        if (typeof setScheduleEntries === 'function') {
            setScheduleEntries(targetTeacherId, String(studentId), dStr, updated.list);
        }
        scheduleBatch.push({
            teacherId: targetTeacherId, studentId, date: dStr,
            startTime, duration: durationMin
        });
        result.count++;
    }

    if (typeof saveData === 'function') saveData();
    if (typeof persistTeacherScheduleLocal === 'function') persistTeacherScheduleLocal();

    if (scheduleBatch.length) {
        try {
            if (typeof saveSchedulesToDatabaseBatch === 'function') {
                await saveSchedulesToDatabaseBatch(scheduleBatch);
            } else if (typeof saveScheduleToDatabase === 'function') {
                await Promise.allSettled(scheduleBatch.map((item) => saveScheduleToDatabase(item)));
            }
        } catch (dbErr) {
            console.warn('[applyStudentWeeklyPattern] DB 동기화 실패(로컬은 반영됨):', dbErr);
        }
    }

    return result;
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
    const userMemo = document.getElementById('reg-memo').value.trim();
    const weeklyPatternFromUI = _readWeeklyPatternFromUI();
    // 메모에 [학생주간일정] 메타 라인 임베드 (DB 마이그레이션 0)
    const memo = buildMemoWithWeeklyPattern(userMemo, weeklyPatternFromUI);
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
                // 메모리 업데이트 — memo 는 사용자 입력만 (메타 마커 제거)
                const idx = students.findIndex(s => String(s.id) === String(id));
                if (idx > -1) {
                    students[idx] = {
                        ...students[idx],
                        ...localData,
                        memo: userMemo,
                        weeklyPattern: weeklyPatternFromUI,
                    };
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

                // 메모리에 추가 — memo 는 사용자 입력만 + weeklyPattern 별도
                students.push({
                    id: newStudentId,
                    ...localData,
                    memo: userMemo,
                    weeklyPattern: weeklyPatternFromUI,
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

        // 주간 패턴 자동 일정 생성 — 미래 12주치 (휴일/중복/과거 skip)
        let savedStudentId = id;
        if (!savedStudentId) {
            // 신규 학생: 방금 추가된 학생 (마지막 push)
            const last = students[students.length - 1];
            if (last) savedStudentId = last.id;
        }
        if (weeklyPatternFromUI && savedStudentId) {
            try {
                const genResult = await applyStudentWeeklyPattern(savedStudentId, {
                    days: weeklyPatternFromUI.days,
                    startTime: weeklyPatternFromUI.start,
                    durationMin: weeklyPatternFromUI.duration,
                    weeks: 12,
                    excludeHolidays: true,
                });
                if (genResult.count > 0) {
                    showToast(
                        `주간 일정 ${genResult.count}건 자동 생성됨` +
                        (genResult.skippedExisting > 0 ? ` · 중복 ${genResult.skippedExisting}건 제외` : '') +
                        (genResult.skippedHoliday > 0 ? ` · 휴일 ${genResult.skippedHoliday}건 제외` : ''),
                        'success'
                    );
                } else if (genResult.skippedExisting > 0 || genResult.skippedHoliday > 0) {
                    showToast('이미 등록된 일정만 있어 추가 생성된 일정이 없습니다.', 'info');
                }
            } catch (genErr) {
                console.error('[handleStudentSave] 주간 일정 자동 생성 실패:', genErr);
                showToast('주간 일정 자동 생성 실패: ' + (genErr.message || ''), 'warning');
            }
        }

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
