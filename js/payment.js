// ============================================
// 수납 관리 기능 (Card-based UI, 검색, 일괄 완납, 프로그레스)
// ============================================

let paymentSearchQuery = '';
let paymentAiDraft = null;
let paymentAiDrafts = [];
let currentPaymentManagementTab = 'income';
const EXPENSE_LEDGER_TABLE = 'expense_ledgers';
const EXPENSE_REMOTE_SELECT_BASE = 'id, created_at, month_key, expense_date, category, amount, method, vendor, vat_type, note';
const EXPENSE_REMOTE_SELECT_WITH_TAX = `${EXPENSE_REMOTE_SELECT_BASE}, supply_amount, vat_amount, evidence_type, evidence_number`;
const CLOSE_RECONCILE_CHANNELS = [
    { key: 'kpay', ledgerKey: '결제선생' },
    { key: 'bizzle', ledgerKey: '비즐' },
    { key: 'bank', ledgerKey: '통장' },
    { key: 'etc', ledgerKey: '기타' },
];
let expenseRemoteChecked = false;
let expenseRemoteEnabled = false;
let expenseRemoteWarned = false;
let expenseRemoteTaxColumnsEnabled = null;
let payTermHelpPopupEl = null;
let payTermHelpActiveBtn = null;
const TAX_REMINDER_STORAGE_PREFIX = 'payment_tax_filing_reminder';
const TAX_MONTHLY_CHECKLIST_PREFIX = 'payment_tax_monthly_checklist';
const PAYMENT_CLOSE_PANEL_PREF_KEY_PREFIX = 'payment_close_panel_pref';

function getActiveStudents() {
    return (students || []).filter(s => s.status === 'active');
}

function buildStudentOptionsHtml(activeStudents) {
    return '<option value="">학생 선택</option>' + activeStudents
        .map(s => `<option value="${s.id}">${s.name}${s.grade ? ` (${s.grade})` : ''}</option>`)
        .join('');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPaymentHelperServerUrl() {
    const configured = (localStorage.getItem('grading_server_url') || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    const host = window.location.hostname || '';
    const isLocal = window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1';
    return isLocal ? 'https://academymanager-production.up.railway.app' : '';
}

async function getAuthHeadersForPaymentHelper() {
    if (typeof supabase === 'undefined' || !supabase.auth) return {};
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (err) {
        console.warn('[payment-ai] 세션 토큰 조회 실패:', err);
        return {};
    }
}

function getCurrentOwnerIdForPayment() {
    const ownerId = typeof cachedLsGet === 'function'
        ? cachedLsGet('current_owner_id')
        : localStorage.getItem('current_owner_id');
    return (ownerId || 'global').trim() || 'global';
}

function getUnmatchedStorageKey() {
    return `payment_unmatched_queue:${getCurrentOwnerIdForPayment()}`;
}

function getExpenseStorageKey() {
    return `payment_expense_ledger:${getCurrentOwnerIdForPayment()}`;
}

function getCloseReconcileStorageKey() {
    return `payment_close_reconcile:${getCurrentOwnerIdForPayment()}`;
}

function loadCloseReconcileMap() {
    try {
        const raw = localStorage.getItem(getCloseReconcileStorageKey());
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('[payment-close] 대사 데이터 로드 실패:', err);
        return {};
    }
}

function saveCloseReconcileMap(map) {
    const next = map && typeof map === 'object' ? map : {};
    localStorage.setItem(getCloseReconcileStorageKey(), JSON.stringify(next));
}

function getCloseReconcileByMonth(monthKey) {
    const map = loadCloseReconcileMap();
    const row = map[monthKey] || {};
    return {
        kpay: Math.max(0, parseAmount(row.kpay || 0)),
        bizzle: Math.max(0, parseAmount(row.bizzle || 0)),
        bank: Math.max(0, parseAmount(row.bank || 0)),
        etc: Math.max(0, parseAmount(row.etc || 0)),
    };
}

function saveCloseReconcileByMonth(monthKey, payload) {
    if (!monthKey) return;
    const map = loadCloseReconcileMap();
    map[monthKey] = {
        kpay: Math.max(0, parseAmount(payload?.kpay || 0)),
        bizzle: Math.max(0, parseAmount(payload?.bizzle || 0)),
        bank: Math.max(0, parseAmount(payload?.bank || 0)),
        etc: Math.max(0, parseAmount(payload?.etc || 0)),
    };
    saveCloseReconcileMap(map);
}

function loadExpenseLedger() {
    try {
        const raw = localStorage.getItem(getExpenseStorageKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('[payment-expense] 비용 원장 로드 실패:', err);
        return [];
    }
}

function saveExpenseLedgerRows(rows) {
    const next = Array.isArray(rows) ? rows : [];
    localStorage.setItem(getExpenseStorageKey(), JSON.stringify(next));
}

function isMissingTableError(error) {
    const code = String(error?.code || '');
    const msg = String(error?.message || '').toLowerCase();
    return code === '42P01' || msg.includes('does not exist') || msg.includes('relation');
}

function isMissingColumnError(error) {
    const code = String(error?.code || '');
    const msg = String(error?.message || '').toLowerCase();
    return code === '42703' || msg.includes('undefined column');
}

function splitExpenseTaxMetaFromNote(note) {
    const raw = String(note || '');
    const marker = '[세무메타]';
    const lines = raw.split('\n');
    const metaLine = lines.find(line => line.startsWith(marker)) || '';
    const cleanedNote = lines.filter(line => !line.startsWith(marker)).join('\n').trim();
    const meta = { supplyAmount: 0, vatAmount: 0, evidenceType: '', evidenceNumber: '' };
    if (!metaLine) return { note: cleanedNote, ...meta };

    const body = metaLine.replace(marker, '').trim();
    body.split('|').map(x => x.trim()).forEach(part => {
        if (part.startsWith('공급가액=')) meta.supplyAmount = Math.max(0, parseAmount(part.slice('공급가액='.length)));
        if (part.startsWith('세액=')) meta.vatAmount = Math.max(0, parseAmount(part.slice('세액='.length)));
        if (part.startsWith('증빙유형=')) meta.evidenceType = part.slice('증빙유형='.length).trim();
        if (part.startsWith('증빙번호=')) meta.evidenceNumber = part.slice('증빙번호='.length).trim();
    });
    return { note: cleanedNote, ...meta };
}

function composeExpenseNoteWithTaxMeta(baseNote, row) {
    const note = String(baseNote || '').trim();
    const supplyAmount = Math.max(0, parseAmount(row?.supplyAmount || 0));
    const vatAmount = Math.max(0, parseAmount(row?.vatAmount || 0));
    const evidenceType = String(row?.evidenceType || '').trim();
    const evidenceNumber = String(row?.evidenceNumber || '').trim();
    const metaLine = `[세무메타] 공급가액=${supplyAmount}|세액=${vatAmount}|증빙유형=${evidenceType}|증빙번호=${evidenceNumber}`;
    return note ? `${note}\n${metaLine}` : metaLine;
}

function toRemoteExpenseRow(row, opts = {}) {
    const legacyMode = Boolean(opts.legacyMode);
    const noteWithMeta = composeExpenseNoteWithTaxMeta(row?.note || '', row);
    const payload = {
        id: String(row.id || ''),
        owner_user_id: getCurrentOwnerIdForPayment(),
        month_key: String(row.monthKey || ''),
        expense_date: String(row.expenseDate || ''),
        category: String(row.category || '기타'),
        amount: Math.max(0, parseAmount(row.amount)),
        method: String(row.method || ''),
        vendor: String(row.vendor || ''),
        vat_type: String(row.vatType || ''),
        note: legacyMode ? noteWithMeta : String(row.note || ''),
    };
    if (legacyMode) return payload;
    return {
        ...payload,
        supply_amount: Math.max(0, parseAmount(row.supplyAmount)),
        vat_amount: Math.max(0, parseAmount(row.vatAmount)),
        evidence_type: String(row.evidenceType || ''),
        evidence_number: String(row.evidenceNumber || ''),
    };
}

function toLocalExpenseRow(row, opts = {}) {
    const legacyMode = Boolean(opts.legacyMode);
    const parsed = splitExpenseTaxMetaFromNote(row.note || '');
    return {
        id: String(row.id || ''),
        createdAt: row.created_at || new Date().toISOString(),
        monthKey: String(row.month_key || ''),
        expenseDate: String(row.expense_date || ''),
        category: String(row.category || '기타'),
        amount: Math.max(0, parseAmount(row.amount)),
        method: String(row.method || ''),
        vendor: String(row.vendor || ''),
        vatType: String(row.vat_type || ''),
        supplyAmount: legacyMode
            ? Math.max(0, parseAmount(parsed.supplyAmount))
            : Math.max(0, parseAmount(row.supply_amount ?? parsed.supplyAmount)),
        vatAmount: legacyMode
            ? Math.max(0, parseAmount(parsed.vatAmount))
            : Math.max(0, parseAmount(row.vat_amount ?? parsed.vatAmount)),
        evidenceType: legacyMode
            ? String(parsed.evidenceType || '')
            : String(row.evidence_type || parsed.evidenceType || ''),
        evidenceNumber: legacyMode
            ? String(parsed.evidenceNumber || '')
            : String(row.evidence_number || parsed.evidenceNumber || ''),
        note: String(legacyMode ? parsed.note : (row.note ?? parsed.note ?? '')),
    };
}

async function ensureExpenseRemoteAvailable() {
    if (expenseRemoteChecked) return expenseRemoteEnabled;
    expenseRemoteChecked = true;
    if (typeof supabase === 'undefined' || !supabase?.from) return false;
    const ownerId = getCurrentOwnerIdForPayment();
    if (!ownerId || ownerId === 'global') return false;

    try {
        const { error } = await supabase
            .from(EXPENSE_LEDGER_TABLE)
            .select('id')
            .eq('owner_user_id', ownerId)
            .limit(1);
        if (error) {
            if (!isMissingTableError(error) && !expenseRemoteWarned) {
                expenseRemoteWarned = true;
                console.warn('[payment-expense] 비용 테이블 점검 실패:', error);
            }
            expenseRemoteEnabled = false;
            return false;
        }
        expenseRemoteEnabled = true;
        return true;
    } catch (err) {
        if (!expenseRemoteWarned) {
            expenseRemoteWarned = true;
            console.warn('[payment-expense] 비용 테이블 점검 예외:', err);
        }
        expenseRemoteEnabled = false;
        return false;
    }
}

async function syncExpenseLedgerFromRemote() {
    const ok = await ensureExpenseRemoteAvailable();
    if (!ok) return false;
    const ownerId = getCurrentOwnerIdForPayment();
    try {
        let data = null;
        let error = null;
        let legacyMode = expenseRemoteTaxColumnsEnabled === false;

        if (!legacyMode) {
            const res = await supabase
                .from(EXPENSE_LEDGER_TABLE)
                .select(EXPENSE_REMOTE_SELECT_WITH_TAX)
                .eq('owner_user_id', ownerId)
                .order('created_at', { ascending: false });
            data = res.data;
            error = res.error;
            if (!error) {
                expenseRemoteTaxColumnsEnabled = true;
            } else if (isMissingColumnError(error)) {
                legacyMode = true;
                expenseRemoteTaxColumnsEnabled = false;
            }
        }

        if (legacyMode) {
            const legacyRes = await supabase
                .from(EXPENSE_LEDGER_TABLE)
                .select(EXPENSE_REMOTE_SELECT_BASE)
                .eq('owner_user_id', ownerId)
                .order('created_at', { ascending: false });
            data = legacyRes.data;
            error = legacyRes.error;
        }

        if (error) {
            if (isMissingTableError(error)) expenseRemoteEnabled = false;
            if (!expenseRemoteWarned) {
                expenseRemoteWarned = true;
                console.warn('[payment-expense] 비용 원장 동기화 실패:', error);
            }
            return false;
        }
        const rows = Array.isArray(data) ? data.map(row => toLocalExpenseRow(row, { legacyMode })) : [];
        saveExpenseLedgerRows(rows);
        return true;
    } catch (err) {
        if (!expenseRemoteWarned) {
            expenseRemoteWarned = true;
            console.warn('[payment-expense] 비용 원장 동기화 예외:', err);
        }
        return false;
    }
}

async function upsertExpenseRowRemote(row) {
    const ok = await ensureExpenseRemoteAvailable();
    if (!ok) return false;
    try {
        if (expenseRemoteTaxColumnsEnabled === false) {
            const legacyPayload = toRemoteExpenseRow(row, { legacyMode: true });
            const legacyRes = await supabase.from(EXPENSE_LEDGER_TABLE).upsert(legacyPayload, { onConflict: 'id' });
            if (legacyRes.error) {
                if (isMissingTableError(legacyRes.error)) expenseRemoteEnabled = false;
                throw legacyRes.error;
            }
            return true;
        }

        const payload = toRemoteExpenseRow(row, { legacyMode: false });
        const { error } = await supabase.from(EXPENSE_LEDGER_TABLE).upsert(payload, { onConflict: 'id' });
        if (!error) {
            expenseRemoteTaxColumnsEnabled = true;
            return true;
        }
        if (isMissingColumnError(error)) {
            expenseRemoteTaxColumnsEnabled = false;
            const legacyPayload = toRemoteExpenseRow(row, { legacyMode: true });
            const legacyRes = await supabase.from(EXPENSE_LEDGER_TABLE).upsert(legacyPayload, { onConflict: 'id' });
            if (legacyRes.error) {
                if (isMissingTableError(legacyRes.error)) expenseRemoteEnabled = false;
                throw legacyRes.error;
            }
            return true;
        }
        if (isMissingTableError(error)) expenseRemoteEnabled = false;
        throw error;
    } catch (err) {
        console.warn('[payment-expense] 비용 원장 저장 동기화 실패:', err);
        return false;
    }
}

async function deleteExpenseRowRemote(entryId) {
    const ok = await ensureExpenseRemoteAvailable();
    if (!ok) return false;
    try {
        const ownerId = getCurrentOwnerIdForPayment();
        const { error } = await supabase
            .from(EXPENSE_LEDGER_TABLE)
            .delete()
            .eq('id', entryId)
            .eq('owner_user_id', ownerId);
        if (error) {
            if (isMissingTableError(error)) expenseRemoteEnabled = false;
            throw error;
        }
        return true;
    } catch (err) {
        console.warn('[payment-expense] 비용 원장 삭제 동기화 실패:', err);
        return false;
    }
}

function getCurrentPaymentMonthRange() {
    const monthKey = getCurrentPaymentMonthKey();
    const [year, month] = String(monthKey || '').split('-').map(Number);
    if (!year || !month) {
        return { monthKey: '', monthStart: '', monthEnd: '' };
    }
    const monthStart = `${monthKey}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
    return { monthKey, monthStart, monthEnd };
}

function getExpenseRowsByMonth(monthKey) {
    return loadExpenseLedger()
        .filter(item => String(item.monthKey || '') === String(monthKey || ''))
        .map(item => {
            const parsed = splitExpenseTaxMetaFromNote(item.note || '');
            const amount = Math.max(0, parseAmount(item.amount));
            return {
                ...item,
                amount,
                supplyAmount: Math.max(0, parseAmount(item.supplyAmount ?? parsed.supplyAmount ?? amount)),
                vatAmount: Math.max(0, parseAmount(item.vatAmount ?? parsed.vatAmount ?? 0)),
                evidenceType: String(item.evidenceType || parsed.evidenceType || ''),
                evidenceNumber: String(item.evidenceNumber || parsed.evidenceNumber || ''),
                note: String(parsed.note || item.note || ''),
            };
        })
        .sort((a, b) => {
            const dateDiff = String(b.expenseDate || '').localeCompare(String(a.expenseDate || ''));
            return dateDiff !== 0 ? dateDiff : String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });
}

function updateExpenseSummary(monthKey) {
    const rows = getExpenseRowsByMonth(monthKey);
    const totalAmount = rows.reduce((acc, row) => acc + Math.max(0, parseAmount(row.amount)), 0);
    const categoryTotals = rows.reduce((acc, row) => {
        const key = String(row.category || '기타');
        acc[key] = (acc[key] || 0) + Math.max(0, parseAmount(row.amount));
        return acc;
    }, {});

    setTextById('pay-expense-month-total', `${totalAmount.toLocaleString()}원`);
    setTextById('pay-expense-month-count', `${rows.length}건`);
    setTextById('pay-expense-consumable-total', `${(categoryTotals['소모품'] || 0).toLocaleString()}원`);
    setTextById('pay-expense-fixture-total', `${(categoryTotals['비품'] || 0).toLocaleString()}원`);
}

function renderExpenseList(monthKey) {
    const container = document.getElementById('pay-expense-list');
    if (!container) return;
    const rows = getExpenseRowsByMonth(monthKey);
    if (!rows.length) {
        container.innerHTML = '<div class="pay-empty"><i class="fas fa-receipt"></i><p>해당 월 비용 내역이 없습니다</p></div>';
        return;
    }

    container.innerHTML = rows.map(row => `
        <div class="pay-expense-item">
            <div class="pay-expense-item-main">
                <div class="pay-expense-item-top">
                    <strong>${escapeHtml(row.category || '기타')}</strong>
                    <span>${escapeHtml(row.expenseDate || '-')}</span>
                </div>
                <div class="pay-expense-item-meta">
                    <span>${escapeHtml(row.vendor || '-')}</span>
                    <span>${escapeHtml(row.method || '-')}</span>
                    <span>${escapeHtml(row.vatType || '-')}</span>
                    <span>공급가액 ${Math.max(0, parseAmount(row.supplyAmount)).toLocaleString()}원</span>
                    <span>세액 ${Math.max(0, parseAmount(row.vatAmount)).toLocaleString()}원</span>
                    <span>${escapeHtml(row.evidenceType || '증빙미기재')}</span>
                    <span>${escapeHtml(row.evidenceNumber || '-')}</span>
                </div>
                <div class="pay-expense-item-note">${escapeHtml(row.note || '')}</div>
            </div>
            <div class="pay-expense-item-side">
                <strong>${Math.max(0, parseAmount(row.amount)).toLocaleString()}원</strong>
                <button class="pay-unmatched-btn remove" onclick="deleteExpenseLedgerEntry('${row.id}')">삭제</button>
            </div>
        </div>
    `).join('');
}

function loadUnmatchedQueue() {
    try {
        const raw = localStorage.getItem(getUnmatchedStorageKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('[payment] 미확인입금 큐 로드 실패:', err);
        return [];
    }
}

function saveUnmatchedQueue(queue) {
    const list = Array.isArray(queue) ? queue : [];
    localStorage.setItem(getUnmatchedStorageKey(), JSON.stringify(list));
}

function addUnmatchedEntry(payload) {
    const queue = loadUnmatchedQueue();
    queue.unshift({
        id: `unmatched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        monthKey: String(payload.monthKey || ''),
        dueAmount: Math.max(0, parseAmount(payload.dueAmount)),
        paidAmount: Math.max(0, parseAmount(payload.paidAmount)),
        supplyAmount: Math.max(0, parseAmount(payload.supplyAmount)),
        vatAmount: Math.max(0, parseAmount(payload.vatAmount)),
        paidAt: String(payload.paidAt || '').trim(),
        channel: String(payload.channel || '').trim(),
        method: String(payload.method || '').trim(),
        referenceId: String(payload.referenceId || '').trim(),
        evidenceNumber: String(payload.evidenceNumber || '').trim(),
        refundAmount: Math.max(0, parseAmount(payload.refundAmount)),
        refundReason: String(payload.refundReason || '').trim(),
        note: String(payload.note || '').trim(),
        evidenceType: String(payload.evidenceType || 'manual').trim(),
        evidenceName: String(payload.evidenceName || '').trim(),
    });
    saveUnmatchedQueue(queue);
}

function removeUnmatchedEntry(entryId) {
    const queue = loadUnmatchedQueue();
    const next = queue.filter(item => String(item.id) !== String(entryId));
    saveUnmatchedQueue(next);
}

function getUnmatchedEntry(entryId) {
    const queue = loadUnmatchedQueue();
    return queue.find(item => String(item.id) === String(entryId)) || null;
}

function getUnmatchedRowsByMonth(monthKey) {
    return loadUnmatchedQueue()
        .filter(item => String(item.monthKey || '') === String(monthKey || ''))
        .map(item => {
            const dueAmount = Math.max(0, parseAmount(item.dueAmount));
            const paidGross = Math.max(0, parseAmount(item.paidAmount));
            const refundAmount = Math.max(0, parseAmount(item.refundAmount));
            const paidNet = Math.max(0, paidGross - refundAmount);
            return {
                studentId: '',
                studentName: '',
                grade: '',
                school: '',
                monthKey: String(item.monthKey || ''),
                status: 'unmatched',
                statusLabel: '미확인입금',
                dueAmount,
                paidGross,
                supplyAmount: Math.max(0, parseAmount(item.supplyAmount || paidGross)),
                vatAmount: Math.max(0, parseAmount(item.vatAmount)),
                refundAmount,
                paidNet,
                outstanding: Math.max(0, dueAmount - paidNet),
                channel: normalizeChannel(item.channel || ''),
                method: String(item.method || '').trim() || '-',
                paidAt: String(item.paidAt || '').trim(),
                referenceId: String(item.referenceId || '').trim(),
                unmatchedDeposit: true,
                refundReason: String(item.refundReason || '').trim(),
                note: String(item.note || '').trim(),
                evidenceType: String(item.evidenceType || 'manual').trim(),
                evidenceNumber: String(item.evidenceNumber || '').trim(),
                evidenceName: String(item.evidenceName || '').trim()
            };
        });
}

function getUnmatchedQueueForMonth(monthKey) {
    return loadUnmatchedQueue().filter(item => String(item.monthKey || '') === String(monthKey || ''));
}

function renderUnmatchedQueueList(monthKey) {
    const container = document.getElementById('pay-unmatched-list');
    const countEl = document.getElementById('pay-unmatched-queue-count');
    if (!container || !countEl) return;

    const list = getUnmatchedQueueForMonth(monthKey);
    countEl.textContent = `${list.length}건`;

    if (list.length === 0) {
        container.innerHTML = '<div class="pay-unmatched-empty">현재 월의 미확인입금이 없습니다.</div>';
        return;
    }

    const studentOptions = buildStudentOptionsHtml(getActiveStudents());
    container.innerHTML = list.map(item => {
        const paidGross = Math.max(0, parseAmount(item.paidAmount));
        const refund = Math.max(0, parseAmount(item.refundAmount));
        const paidNet = Math.max(0, paidGross - refund);
        const due = Math.max(0, parseAmount(item.dueAmount));
        return `
            <div class="pay-unmatched-item">
                <div class="pay-unmatched-top">
                    <div>
                        <div class="pay-unmatched-meta">${(item.channel || '-')}/${(item.method || '-')} · 순수납 ${paidNet.toLocaleString()}원</div>
                        <div class="pay-unmatched-submeta">
                            청구 ${due.toLocaleString()}원 · 수납일 ${(item.paidAt || '-')} · 참조 ${(item.referenceId || '-')}
                        </div>
                    </div>
                </div>
                <div class="pay-unmatched-actions">
                    <select class="pay-unmatched-select" id="unmatched-student-${item.id}">
                        ${studentOptions}
                    </select>
                    <button class="pay-unmatched-btn assign" onclick="assignUnmatchedToStudent('${item.id}')">학생에 연결</button>
                    <button class="pay-unmatched-btn remove" onclick="deleteUnmatchedEntry('${item.id}')">대기함에서 삭제</button>
                </div>
            </div>
        `;
    }).join('');
}

window.assignUnmatchedToStudent = function(entryId) {
    const select = document.getElementById(`unmatched-student-${entryId}`);
    const studentId = select?.value || '';
    if (!studentId) {
        showToast('연결할 학생을 선택해주세요.', 'warning');
        return;
    }

    const entry = getUnmatchedEntry(entryId);
    if (!entry) {
        showToast('미확인입금 항목을 찾을 수 없습니다.', 'warning');
        return;
    }

    try {
        saveLedgerEntryByStudentId(studentId, entry.monthKey, {
            dueAmount: entry.dueAmount,
            paidAmount: entry.paidAmount,
            paidAt: entry.paidAt,
            channel: entry.channel,
            method: entry.method,
            referenceId: entry.referenceId,
            unmatchedDeposit: false,
            refundAmount: entry.refundAmount,
            refundReason: entry.refundReason,
            note: `[미확인입금 매칭] ${entry.note || ''}`.trim(),
            evidenceType: entry.evidenceType || 'manual',
            evidenceName: entry.evidenceName || ''
        });
        removeUnmatchedEntry(entryId);
        saveData();
        renderPaymentList();
        showToast('미확인입금을 학생 원장으로 연결했습니다.', 'success');
    } catch (err) {
        showToast(err.message || '학생 연결 실패', 'error');
    }
}

window.deleteUnmatchedEntry = function(entryId) {
    removeUnmatchedEntry(entryId);
    renderPaymentList();
    showToast('입금 확인대기함에서 삭제했습니다.', 'info');
}

function normalizeChannel(channel) {
    const raw = String(channel || '').trim();
    if (!raw) return '기타';
    if (raw.includes('결제선생')) return '결제선생';
    if (raw.includes('비즐')) return '비즐';
    if (raw.includes('통장') || raw.includes('계좌')) return '통장';
    return '기타';
}

function statusToLabel(status) {
    return {
        paid: '완납',
        billed: '청구됨',
        partial: '부분수납',
        unmatched: '미확인입금',
        no_charge: '청구없음'
    }[status] || '청구됨';
}

function getMonthLedgerRows(monthKey) {
    const monthData = buildPaymentData(monthKey);
    const studentRows = monthData.map(item => {
        const ledger = item.student?.payments?.[monthKey]?.ledger || {};
        const dueAmount = Math.max(0, parseAmount(item.summary.totalDue));
        const paidGross = Math.max(0, parseAmount(item.summary.totalPaidGross ?? item.summary.totalPaid));
        const refundAmount = Math.max(0, parseAmount(item.summary.refundAmount || 0));
        const paidNet = Math.max(0, parseAmount(item.summary.totalPaid));
        const supplyAmount = Math.max(0, parseAmount(ledger.supplyAmount || paidGross));
        const vatAmount = Math.max(0, parseAmount(ledger.vatAmount || 0));
        const outstanding = Math.max(0, dueAmount - paidNet);
        const channel = normalizeChannel(ledger.channel || item.summary.ledgerMeta?.channel || '');
        const method = String(ledger.method || item.summary.ledgerMeta?.method || '').trim() || '-';
        return {
            studentId: item.student.id,
            studentName: item.student.name || '',
            grade: item.student.grade || '',
            school: item.student.school || '',
            monthKey,
            status: item.summary.status,
            statusLabel: statusToLabel(item.summary.status),
            dueAmount,
            paidGross,
            supplyAmount,
            vatAmount,
            refundAmount,
            paidNet,
            outstanding,
            channel,
            method,
            paidAt: String(ledger.paidAt || item.summary.ledgerMeta?.paidAt || '').trim(),
            referenceId: String(ledger.referenceId || item.summary.ledgerMeta?.referenceId || '').trim(),
            unmatchedDeposit: Boolean(ledger.unmatchedDeposit || item.summary.status === 'unmatched'),
            refundReason: String(ledger.refundReason || item.summary.ledgerMeta?.refundReason || '').trim(),
            note: String(ledger.note || '').trim(),
            evidenceType: String(ledger.evidenceType || (item.summary.source === 'ledger' ? 'manual' : 'legacy')).trim(),
            evidenceNumber: String(ledger.evidenceNumber || '').trim(),
            evidenceName: String(ledger.evidenceName || '').trim()
        };
    });
    return [...studentRows, ...getUnmatchedRowsByMonth(monthKey)];
}

function setTextById(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setDiffStyleById(id, diff) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-positive', 'is-negative', 'is-zero');
    if (diff > 0) el.classList.add('is-positive');
    else if (diff < 0) el.classList.add('is-negative');
    else el.classList.add('is-zero');
}

function formatSignedWon(diff) {
    const abs = Math.abs(diff).toLocaleString();
    if (diff > 0) return `+${abs}원`;
    if (diff < 0) return `-${abs}원`;
    return `${abs}원`;
}

function updateCloseReconcileSummary(monthKey, channelTotals) {
    const reconcile = getCloseReconcileByMonth(monthKey);
    let totalDiff = 0;

    CLOSE_RECONCILE_CHANNELS.forEach(cfg => {
        const inputId = `pay-channel-${cfg.key}-actual`;
        const diffId = `pay-channel-${cfg.key}-diff`;
        const ledgerAmount = Math.max(0, parseAmount(channelTotals[cfg.ledgerKey] || 0));
        const actualAmount = Math.max(0, parseAmount(reconcile[cfg.key] || 0));
        const diff = ledgerAmount - actualAmount;
        totalDiff += diff;

        const input = document.getElementById(inputId);
        if (input && document.activeElement !== input) {
            input.value = actualAmount > 0 ? actualAmount.toLocaleString() : '';
        }
        setTextById(diffId, `차이 ${formatSignedWon(diff)}`);
        setDiffStyleById(diffId, diff);
    });

    setTextById('pay-reconcile-total', `장부와 실제 합계 차이 ${formatSignedWon(totalDiff)}`);
    setDiffStyleById('pay-reconcile-total', totalDiff);
}

function updateCloseSummary(monthKey) {
    const rows = getMonthLedgerRows(monthKey);
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const todayStr = new Date(today.getTime() - offset).toISOString().slice(0, 10);

    const todayRows = rows.filter(r => (r.paidAt || '').slice(0, 10) === todayStr && r.paidNet > 0);
    const todayAmount = todayRows.reduce((sum, r) => sum + r.paidNet, 0);
    const unmatchedCount = rows.filter(r => r.unmatchedDeposit).length;
    const outstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);

    const channelTotals = { 결제선생: 0, 비즐: 0, 통장: 0, 기타: 0 };
    rows.forEach(r => {
        channelTotals[r.channel] = (channelTotals[r.channel] || 0) + r.paidNet;
    });

    setTextById('pay-close-today-amount', `${todayAmount.toLocaleString()}원`);
    setTextById('pay-close-today-count', `${todayRows.length}건`);
    setTextById('pay-close-outstanding', `${outstanding.toLocaleString()}원`);
    setTextById('pay-close-unmatched', `${unmatchedCount}건`);
    setTextById('pay-channel-kpay', `${(channelTotals['결제선생'] || 0).toLocaleString()}원`);
    setTextById('pay-channel-bizzle', `${(channelTotals['비즐'] || 0).toLocaleString()}원`);
    setTextById('pay-channel-bank', `${(channelTotals['통장'] || 0).toLocaleString()}원`);
    setTextById('pay-channel-etc', `${(channelTotals['기타'] || 0).toLocaleString()}원`);
    updateCloseReconcileSummary(monthKey, channelTotals);
}

window.updateCloseReconcileInput = function(channelKey, value) {
    if (!['kpay', 'bizzle', 'bank', 'etc'].includes(channelKey)) return;
    const monthKey = getCurrentPaymentMonthKey();
    const reconcile = getCloseReconcileByMonth(monthKey);
    reconcile[channelKey] = Math.max(0, parseAmount(value || 0));
    saveCloseReconcileByMonth(monthKey, reconcile);
    updateCloseSummary(monthKey);
}

function escapeCsvCell(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsvFile(filename, headers, rows) {
    const headerLine = headers.map(escapeCsvCell).join(',');
    const lines = rows.map(row => row.map(escapeCsvCell).join(','));
    const csv = '\uFEFF' + [headerLine, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getCsvAddonOptions() {
    return {
        includeReconcile: Boolean(document.getElementById('pay-csv-option-reconcile')?.checked),
        includePayrollMeta: Boolean(document.getElementById('pay-csv-option-payroll')?.checked),
    };
}

function extractPayrollDetailMeta(note) {
    const marker = '[인건비상세]';
    const lines = String(note || '').split('\n');
    const metaLine = lines.find(line => line.startsWith(marker));
    return metaLine ? metaLine.replace(marker, '').trim() : '';
}

function buildReconcileAddonRows(monthKey, ledgerRows) {
    const channelTotals = { 결제선생: 0, 비즐: 0, 통장: 0, 기타: 0 };
    (ledgerRows || []).forEach(r => {
        const key = String(r.channel || '기타');
        channelTotals[key] = (channelTotals[key] || 0) + Math.max(0, parseAmount(r.paidNet));
    });
    const reconcile = getCloseReconcileByMonth(monthKey);
    let totalDiff = 0;
    const rows = CLOSE_RECONCILE_CHANNELS.map(cfg => {
        const ledgerAmount = Math.max(0, parseAmount(channelTotals[cfg.ledgerKey] || 0));
        const actualAmount = Math.max(0, parseAmount(reconcile[cfg.key] || 0));
        const diff = ledgerAmount - actualAmount;
        totalDiff += diff;
        return {
            section: '대사차이',
            item: cfg.ledgerKey,
            value1: ledgerAmount,
            value2: actualAmount,
            value3: diff,
        };
    });
    rows.push({
        section: '대사차이',
        item: '합계',
        value1: '-',
        value2: '-',
        value3: totalDiff,
    });
    return rows;
}

function buildPayrollAddonRows(monthKey) {
    const payrollRows = getExpenseRowsByMonth(monthKey).filter(r => isPayrollExpenseCategory(r.category));
    if (!payrollRows.length) {
        return [{ section: '인건비상세', item: '데이터 없음', value1: '', value2: '', value3: '' }];
    }
    return payrollRows.map(r => {
        const incomeType = String(r.payrollIncomeType || '').trim();
        const detailMeta = extractPayrollDetailMeta(r.note) || '';
        const mergedMeta = incomeType
            ? `소득유형:${incomeType}${detailMeta ? ` | ${detailMeta}` : ''}`
            : (detailMeta || '-');
        return {
            section: '인건비상세',
            item: `${r.category} / ${r.expenseDate || '-'} / ${r.vendor || '-'}`,
            value1: Math.max(0, parseAmount(r.amount)),
            value2: mergedMeta,
            value3: r.evidenceNumber || '-',
        };
    });
}

function mergeCsvWithAddonColumns(headers, baseRows, addonRows) {
    const addonHeaders = ['추가섹션', '추가항목', '추가값1', '추가값2', '추가값3'];
    const nextHeaders = [...headers, ...addonHeaders];
    const paddedBaseRows = (baseRows || []).map(row => [...row, '', '', '', '', '']);
    const blank = new Array(headers.length).fill('');
    const normalizedAddonRows = (addonRows || []).map(addon => ([
        ...blank,
        addon.section || '',
        addon.item || '',
        addon.value1 ?? '',
        addon.value2 ?? '',
        addon.value3 ?? ''
    ]));
    return { headers: nextHeaders, rows: [...paddedBaseRows, ...normalizedAddonRows] };
}

function getCurrentPaymentMonthKey() {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

function getPaymentClosePanelPrefKey() {
    return `${PAYMENT_CLOSE_PANEL_PREF_KEY_PREFIX}:${getCurrentOwnerIdForPayment()}`;
}

function loadPaymentClosePanelCollapsedPref() {
    try {
        const raw = localStorage.getItem(getPaymentClosePanelPrefKey());
        if (raw === null || raw === undefined || raw === '') return null;
        return raw === '1';
    } catch (err) {
        return null;
    }
}

function savePaymentClosePanelCollapsedPref(collapsed) {
    try {
        localStorage.setItem(getPaymentClosePanelPrefKey(), collapsed ? '1' : '0');
    } catch (err) {
        // ignore storage failures
    }
}

function parseAmount(value) {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value).replace(/[^0-9-]/g, '');
    const parsed = parseInt(cleaned, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getTodayLocalYmd() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function getTaxReminderStorageKey() {
    return `${TAX_REMINDER_STORAGE_PREFIX}:${getCurrentOwnerIdForPayment()}`;
}

function getTaxMonthlyChecklistStorageKey() {
    return `${TAX_MONTHLY_CHECKLIST_PREFIX}:${getCurrentOwnerIdForPayment()}`;
}

function loadTaxMonthlyChecklistMap() {
    try {
        const raw = localStorage.getItem(getTaxMonthlyChecklistStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('[payment-tax] 월 체크리스트 로드 실패:', err);
        return {};
    }
}

function saveTaxMonthlyChecklistMap(next) {
    const safe = next && typeof next === 'object' ? next : {};
    localStorage.setItem(getTaxMonthlyChecklistStorageKey(), JSON.stringify(safe));
}

function getTaxMonthlyChecklist(monthKey) {
    const map = loadTaxMonthlyChecklistMap();
    const row = map[String(monthKey || '')];
    return row && typeof row === 'object' ? row : {};
}

function updateTaxMonthlyChecklist(monthKey, patch) {
    const key = String(monthKey || '');
    if (!key) return;
    const map = loadTaxMonthlyChecklistMap();
    const prev = map[key] && typeof map[key] === 'object' ? map[key] : {};
    map[key] = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    saveTaxMonthlyChecklistMap(map);
}

function loadTaxReminderState() {
    try {
        const raw = localStorage.getItem(getTaxReminderStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('[payment-tax] 신고 알림 상태 로드 실패:', err);
        return {};
    }
}

function saveTaxReminderState(next) {
    const safe = next && typeof next === 'object' ? next : {};
    localStorage.setItem(getTaxReminderStorageKey(), JSON.stringify(safe));
}

function toYmd(date) {
    if (!(date instanceof Date)) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getRelativeMonthKey(baseDate, monthDelta) {
    const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    base.setMonth(base.getMonth() + monthDelta);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthKeyToDate(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    if (!year || !month) return null;
    return new Date(year, month - 1, 1);
}

function hasPayrollInMonth(monthKey) {
    const checklist = getTaxMonthlyChecklist(monthKey);
    if (checklist.payrollPaid === true) return true;
    if (checklist.payrollPaid === false) return false;
    return getExpenseRowsByMonth(monthKey).some(row =>
        isPayrollExpenseCategory(row.category) && parseAmount(row.amount) > 0
    );
}

function isDateInRange(targetYmd, startYmd, endYmd) {
    return targetYmd >= startYmd && targetYmd <= endYmd;
}

function getTaxReminderItems(todayYmd) {
    const today = new Date(`${todayYmd}T00:00:00`);
    const year = today.getFullYear();
    const state = loadTaxReminderState();

    const items = [];

    const bizStart = `${year}-01-01`;
    const bizDue = `${year}-02-10`;
    const bizEnd = `${year}-02-28`;
    if (isDateInRange(todayYmd, bizStart, bizEnd)) {
        items.push({
            id: `business_status_${year}`,
            title: `${year}년 사업장 현황신고 확인`,
            dueDate: bizDue,
            periodText: '매년 1월 1일 ~ 2월 10일',
            desc: '교습소(면세) 수입금액/시설 현황 신고 대상입니다.',
            overdue: todayYmd > bizDue,
            state: state[`business_status_${year}`] || {},
        });
    }

    const incomeStart = `${year}-05-01`;
    const incomeDue = `${year}-05-31`;
    const incomeEnd = `${year}-06-15`;
    if (isDateInRange(todayYmd, incomeStart, incomeEnd)) {
        items.push({
            id: `income_tax_${year}`,
            title: `${year}년 종합소득세 신고 확인`,
            dueDate: incomeDue,
            periodText: '매년 5월 1일 ~ 5월 31일',
            desc: '연간 수입/비용을 바탕으로 종합소득세 신고·납부를 진행합니다.',
            overdue: todayYmd > incomeDue,
            state: state[`income_tax_${year}`] || {},
        });
    }

    const prevMonthKey = getRelativeMonthKey(today, -1);
    const hasPayroll = hasPayrollInMonth(prevMonthKey);
    if (hasPayroll) {
        const withholdingDue = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-10`;
        const withholdingEnd = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-20`;
        if (isDateInRange(todayYmd, `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-01`, withholdingEnd)) {
            items.push({
                id: `withholding_${year}_${String(today.getMonth() + 1).padStart(2, '0')}`,
                title: `${prevMonthKey} 인건비 지급분 원천세 신고 확인`,
                dueDate: withholdingDue,
                periodText: '지급월의 다음 달 10일까지',
                desc: '인건비/강사비 지급이 있으면 원천세 신고 대상인지 확인이 필요합니다.',
                overdue: todayYmd > withholdingDue,
                state: state[`withholding_${year}_${String(today.getMonth() + 1).padStart(2, '0')}`] || {},
            });
        }
    }

    return { items, state };
}

async function maybePromptTaxFilingCheck() {
    const todayYmd = getTodayLocalYmd();
    const { items, state } = getTaxReminderItems(todayYmd);
    if (!items.length) return;

    for (const item of items) {
        const done = Boolean(item.state?.doneAt);
        const promptedToday = item.state?.lastPromptAt === todayYmd;
        if (done || promptedToday) continue;

        state[item.id] = { ...(state[item.id] || {}), lastPromptAt: todayYmd };
        saveTaxReminderState(state);

        const message = [
            `${item.title}`,
            `신고기간: ${item.periodText}`,
            `기준기한: ${item.dueDate}`,
            `${item.desc}`,
            item.overdue ? '\n기한이 지났을 수 있습니다. 실제 신고 여부를 꼭 확인해주세요.' : '',
            '\n이미 신고를 끝냈다면 [완료 처리]를 눌러주세요.'
        ].join('\n');

        const ok = await showConfirm(message, {
            title: '세무 신고 일정 확인',
            type: item.overdue ? 'warn' : 'question',
            okText: '완료 처리',
            cancelText: '나중에',
        });
        if (!ok) continue;

        state[item.id] = {
            ...(state[item.id] || {}),
            doneAt: `${todayYmd}T00:00:00`,
            lastPromptAt: todayYmd,
        };
        saveTaxReminderState(state);
        showToast(`"${item.title}" 완료로 체크했습니다.`, 'success');
    }
}

function renderMonthlyTaxChecklist(monthKey) {
    const container = document.getElementById('pay-tax-monthly-checklist');
    if (!container) return;
    const baseDate = parseMonthKeyToDate(monthKey) || new Date();
    const prevMonthKey = getRelativeMonthKey(baseDate, -1);
    const now = new Date();
    const currentMonthKey = getRelativeMonthKey(now, 0);
    const isCurrentMonth = monthKey === currentMonthKey;
    const todayYmd = getTodayLocalYmd();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const withholdingWindow = isDateInRange(
        todayYmd,
        `${currentYear}-${currentMonth}-01`,
        `${currentYear}-${currentMonth}-20`
    );
    const current = getTaxMonthlyChecklist(monthKey);
    const prevHasPayroll = hasPayrollInMonth(prevMonthKey);
    const evidenceDone = Boolean(current.expenseEvidenceDone);
    const payrollPaid = current.payrollPaid === true
        ? true
        : (current.payrollPaid === false ? false : hasPayrollInMonth(monthKey));
    const withholdingChecked = Boolean(current.withholdingChecked);
    const canCheckMonthOps = isCurrentMonth;
    const canCheckWithholding = isCurrentMonth && prevHasPayroll && withholdingWindow;

    container.innerHTML = `
        <label class="pay-tax-check-item ${canCheckMonthOps ? '' : 'is-disabled'}">
            <input id="pay-tax-check-evidence" type="checkbox" ${evidenceDone ? 'checked' : ''}
                   ${canCheckMonthOps ? '' : 'disabled'}
                   onchange="updateMonthlyTaxChecklist('expenseEvidenceDone', this.checked)">
            <span>이번 달 비용 증빙 정리 완료${canCheckMonthOps ? '' : ' (현재 점검 대상 월 아님)'}</span>
        </label>
        <label class="pay-tax-check-item ${canCheckMonthOps ? '' : 'is-disabled'}">
            <input id="pay-tax-check-payroll" type="checkbox" ${payrollPaid ? 'checked' : ''}
                   ${canCheckMonthOps ? '' : 'disabled'}
                   onchange="updateMonthlyTaxChecklist('payrollPaid', this.checked)">
            <span>이번 달 인건비/강사비 지급 있음${canCheckMonthOps ? '' : ' (현재 점검 대상 월 아님)'}</span>
        </label>
        <label class="pay-tax-check-item ${canCheckWithholding ? '' : 'is-disabled'}">
            <input id="pay-tax-check-withholding" type="checkbox" ${withholdingChecked ? 'checked' : ''}
                   ${canCheckWithholding ? '' : 'disabled'}
                   onchange="updateMonthlyTaxChecklist('withholdingChecked', this.checked)">
            <span>전월 인건비 지급분 원천세 확인 완료${
                !isCurrentMonth
                    ? ' (현재 월에서만 점검)'
                    : (!prevHasPayroll ? ' (전월 지급 없음)' : (!withholdingWindow ? ' (원천세 점검 기간 아님)' : ''))
            }</span>
        </label>
    `;
}

function renderLaborAccountingChecklist(monthKey) {
    const laborContainer = document.getElementById('pay-labor-monthly-checklist');
    const accountingContainer = document.getElementById('pay-accounting-monthly-checklist');
    if (!laborContainer && !accountingContainer) return;
    const now = new Date();
    const currentMonthKey = getRelativeMonthKey(now, 0);
    const isCurrentMonth = monthKey === currentMonthKey;
    const current = getTaxMonthlyChecklist(monthKey);
    const payrollDetected = current.payrollPaid === true || hasPayrollInMonth(monthKey);
    const labor = {
        contractChecked: Boolean(current.laborContractChecked),
        incomeTypeChecked: Boolean(current.laborIncomeTypeChecked),
        withholdingChecked: Boolean(current.laborWithholdingChecked),
        insuranceChecked: Boolean(current.laborInsuranceChecked),
    };
    const accounting = {
        reconcileChecked: Boolean(current.accountingReconcileChecked),
        evidenceChecked: Boolean(current.accountingEvidenceChecked),
        csvChecked: Boolean(current.accountingCsvChecked),
        archiveChecked: Boolean(current.accountingArchiveChecked),
    };
    const canCheckLaborCommon = isCurrentMonth;
    const canCheckLaborPayroll = isCurrentMonth && payrollDetected;
    const canCheckAccounting = isCurrentMonth;
    if (laborContainer) {
        laborContainer.innerHTML = `
            <label class="pay-tax-check-item ${canCheckLaborCommon ? '' : 'is-disabled'}">
                <input type="checkbox" ${labor.contractChecked ? 'checked' : ''}
                       ${canCheckLaborCommon ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('laborContractChecked', this.checked)">
                <span>근로계약/위촉계약 상태 확인${canCheckLaborCommon ? '' : ' (현재 점검 대상 월 아님)'}</span>
            </label>
            <label class="pay-tax-check-item ${canCheckLaborPayroll ? '' : 'is-disabled'}">
                <input type="checkbox" ${labor.incomeTypeChecked ? 'checked' : ''}
                       ${canCheckLaborPayroll ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('laborIncomeTypeChecked', this.checked)">
                <span>인건비 소득유형(비율제/월급제) 확인${
                    !isCurrentMonth ? ' (현재 점검 대상 월 아님)' : (!payrollDetected ? ' (인건비 지급 없음)' : '')
                }</span>
            </label>
            <label class="pay-tax-check-item ${canCheckLaborPayroll ? '' : 'is-disabled'}">
                <input type="checkbox" ${labor.withholdingChecked ? 'checked' : ''}
                       ${canCheckLaborPayroll ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('laborWithholdingChecked', this.checked)">
                <span>원천세/지방소득세 계산값 확인${
                    !isCurrentMonth ? ' (현재 점검 대상 월 아님)' : (!payrollDetected ? ' (인건비 지급 없음)' : '')
                }</span>
            </label>
            <label class="pay-tax-check-item ${canCheckLaborPayroll ? '' : 'is-disabled'}">
                <input type="checkbox" ${labor.insuranceChecked ? 'checked' : ''}
                       ${canCheckLaborPayroll ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('laborInsuranceChecked', this.checked)">
                <span>4대보험/공제 대상 여부 확인${
                    !isCurrentMonth ? ' (현재 점검 대상 월 아님)' : (!payrollDetected ? ' (인건비 지급 없음)' : '')
                }</span>
            </label>
        `;
    }
    if (accountingContainer) {
        accountingContainer.innerHTML = `
            <label class="pay-tax-check-item ${canCheckAccounting ? '' : 'is-disabled'}">
                <input type="checkbox" ${accounting.reconcileChecked ? 'checked' : ''}
                       ${canCheckAccounting ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('accountingReconcileChecked', this.checked)">
                <span>장부-실제 대사 차이 확인${canCheckAccounting ? '' : ' (현재 점검 대상 월 아님)'}</span>
            </label>
            <label class="pay-tax-check-item ${canCheckAccounting ? '' : 'is-disabled'}">
                <input type="checkbox" ${accounting.evidenceChecked ? 'checked' : ''}
                       ${canCheckAccounting ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('accountingEvidenceChecked', this.checked)">
                <span>증빙유형/증빙번호 누락 확인${canCheckAccounting ? '' : ' (현재 점검 대상 월 아님)'}</span>
            </label>
            <label class="pay-tax-check-item ${canCheckAccounting ? '' : 'is-disabled'}">
                <input type="checkbox" ${accounting.csvChecked ? 'checked' : ''}
                       ${canCheckAccounting ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('accountingCsvChecked', this.checked)">
                <span>월 원장/수단별/비용 CSV 생성 확인${canCheckAccounting ? '' : ' (현재 점검 대상 월 아님)'}</span>
            </label>
            <label class="pay-tax-check-item ${canCheckAccounting ? '' : 'is-disabled'}">
                <input type="checkbox" ${accounting.archiveChecked ? 'checked' : ''}
                       ${canCheckAccounting ? '' : 'disabled'}
                       onchange="updateMonthlyTaxChecklist('accountingArchiveChecked', this.checked)">
                <span>회계사 제출 파일 보관/전달 확인${canCheckAccounting ? '' : ' (현재 점검 대상 월 아님)'}</span>
            </label>
        `;
    }
}

window.updateMonthlyTaxChecklist = function(field, checked) {
    const monthKey = getCurrentPaymentMonthKey();
    const patch = {};
    patch[String(field || '')] = Boolean(checked);
    updateTaxMonthlyChecklist(monthKey, patch);
    renderMonthlyTaxChecklist(monthKey);
    renderLaborAccountingChecklist(monthKey);
    showToast('월별 세무 체크 상태를 저장했습니다.', 'success');
}

function ensurePayTermHelpPopup() {
    if (payTermHelpPopupEl && document.body.contains(payTermHelpPopupEl)) return payTermHelpPopupEl;
    const popup = document.createElement('div');
    popup.id = 'pay-term-help-popup';
    popup.className = 'pay-term-popup hidden';
    document.body.appendChild(popup);
    payTermHelpPopupEl = popup;
    return popup;
}

function hidePayTermHelpPopup() {
    const popup = ensurePayTermHelpPopup();
    popup.classList.add('hidden');
    popup.textContent = '';
    if (payTermHelpActiveBtn) payTermHelpActiveBtn.classList.remove('is-open');
    payTermHelpActiveBtn = null;
}

function showPayTermHelpPopup(targetBtn) {
    if (!targetBtn) return;
    const helpText = String(targetBtn.dataset.help || targetBtn.getAttribute('title') || '').trim();
    if (!helpText) return;
    const popup = ensurePayTermHelpPopup();
    popup.textContent = helpText;
    popup.classList.remove('hidden');
    targetBtn.classList.add('is-open');
    payTermHelpActiveBtn = targetBtn;

    const rect = targetBtn.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;
    let left = window.scrollX + rect.left + (rect.width / 2) - (popupRect.width / 2);
    left = Math.max(window.scrollX + 12, Math.min(left, window.scrollX + window.innerWidth - popupRect.width - 12));
    let top = window.scrollY + rect.bottom + margin;
    if (top + popupRect.height > window.scrollY + window.innerHeight - 8) {
        top = window.scrollY + rect.top - popupRect.height - margin;
    }
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
}

function initPayTermHelpInteractions() {
    if (window.__payTermHelpBound) return;
    window.__payTermHelpBound = true;

    document.addEventListener('click', (event) => {
        const btn = event.target?.closest?.('.pay-term-help');
        if (btn) {
            event.preventDefault();
            event.stopPropagation();
            if (payTermHelpActiveBtn === btn) {
                hidePayTermHelpPopup();
            } else {
                if (payTermHelpActiveBtn) payTermHelpActiveBtn.classList.remove('is-open');
                showPayTermHelpPopup(btn);
            }
            return;
        }
        if (event.target?.closest?.('#pay-term-help-popup')) return;
        hidePayTermHelpPopup();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hidePayTermHelpPopup();
        const btn = event.target?.closest?.('.pay-term-help');
        if (!btn) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (payTermHelpActiveBtn === btn) hidePayTermHelpPopup();
            else showPayTermHelpPopup(btn);
        }
    });
}

function preparePayTermHelpButtons() {
    initPayTermHelpInteractions();
    document.querySelectorAll('.pay-term-help').forEach((el) => {
        if (!el.getAttribute('role')) el.setAttribute('role', 'button');
        if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '0');
        if (!el.dataset.help) {
            const title = String(el.getAttribute('title') || '').trim();
            if (title) el.dataset.help = title;
        }
        if (!el.getAttribute('aria-label')) {
            const helpText = String(el.dataset.help || '').trim();
            el.setAttribute('aria-label', helpText ? `도움말: ${helpText}` : '도움말');
        }
    });
}

function setFormattedAmountInputById(inputId, amount) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const n = Math.max(0, parseAmount(amount));
    input.value = n > 0 ? n.toLocaleString() : '';
}

function resetModalRequiredMarks(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.querySelectorAll('.is-required-missing').forEach(el => el.classList.remove('is-required-missing'));
    modal.querySelectorAll('.is-required-missing-group').forEach(el => el.classList.remove('is-required-missing-group'));
}

function markRequiredField(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return null;
    el.classList.add('is-required-missing');
    const group = el.closest('.input-group');
    if (group) group.classList.add('is-required-missing-group');
    return el;
}

function markAndFocusRequiredFields(inputIds) {
    let first = null;
    (inputIds || []).forEach(id => {
        const el = markRequiredField(id);
        if (!first && el) first = el;
    });
    if (first) {
        first.focus?.();
        first.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
}

function calcVatBreakdownFromGross(grossAmount) {
    const gross = Math.max(0, parseAmount(grossAmount));
    if (gross <= 0) return { supplyAmount: 0, vatAmount: 0 };
    const supplyAmount = Math.round(gross / 1.1);
    const vatAmount = Math.max(0, gross - supplyAmount);
    return { supplyAmount, vatAmount };
}

function applyPaymentTaxAutoFill(force = false) {
    const paidAmount = Math.max(0, parseAmount(document.getElementById('ledger-paid-amount')?.value || 0));
    const currentSupply = Math.max(0, parseAmount(document.getElementById('ledger-supply-amount')?.value || 0));
    const currentVat = Math.max(0, parseAmount(document.getElementById('ledger-vat-amount')?.value || 0));
    if (!force && (currentSupply > 0 || currentVat > 0)) return;
    setFormattedAmountInputById('ledger-supply-amount', paidAmount);
    setFormattedAmountInputById('ledger-vat-amount', 0);
}

function applyExpenseTaxAutoFill() {
    const amount = Math.max(0, parseAmount(document.getElementById('expense-amount')?.value || 0));
    const vatType = (document.getElementById('expense-vat-type')?.value || '').trim();
    if (amount <= 0) {
        setFormattedAmountInputById('expense-supply-amount', 0);
        setFormattedAmountInputById('expense-vat-amount', 0);
        return;
    }
    if (vatType === '부가세포함') {
        const calc = calcVatBreakdownFromGross(amount);
        setFormattedAmountInputById('expense-supply-amount', calc.supplyAmount);
        setFormattedAmountInputById('expense-vat-amount', calc.vatAmount);
        return;
    }
    setFormattedAmountInputById('expense-supply-amount', amount);
    setFormattedAmountInputById('expense-vat-amount', 0);
}

window.onPaymentPaidAmountInput = function(value) {
    const paidAmount = Math.max(0, parseAmount(value || 0));
    setFormattedAmountInputById('ledger-supply-amount', paidAmount);
    setFormattedAmountInputById('ledger-vat-amount', 0);
}

window.onExpenseAmountInput = function() {
    applyExpenseTaxAutoFill();
    applyExpensePayrollAutoFill();
}

window.onExpenseVatTypeChange = function() {
    applyExpenseTaxAutoFill();
}

function getOrCreateMonthData(student, monthKey) {
    if (!student.payments) student.payments = {};
    if (!student.payments[monthKey]) student.payments[monthKey] = {};
    return student.payments[monthKey];
}

function getPaymentSummary(student, monthKey, monthData) {
    const md = monthData || {};
    const ledger = md.ledger || null;

    if (ledger) {
        const totalDue = Math.max(0, parseAmount(ledger.dueAmount));
        const totalPaidGross = Math.max(0, parseAmount(ledger.paidAmount));
        const refundAmount = Math.max(0, parseAmount(ledger.refundAmount));
        const totalPaid = Math.max(0, totalPaidGross - refundAmount);
        const hasUnmatched = Boolean(ledger.unmatchedDeposit);
        let status = 'billed';

        if (hasUnmatched) status = 'unmatched';
        else if (totalDue === 0 && totalPaid === 0) status = 'no_charge';
        else if (totalPaid >= totalDue && totalDue > 0) status = 'paid';
        else if (totalPaid > 0) status = 'partial';

        return {
            totalDue,
            totalPaid,
            totalPaidGross,
            refundAmount,
            status,
            source: 'ledger',
            ledgerMeta: {
                channel: ledger.channel || '',
                method: ledger.method || '',
                paidAt: ledger.paidAt || '',
                referenceId: ledger.referenceId || '',
                supplyAmount: Math.max(0, parseAmount(ledger.supplyAmount || ledger.paidAmount || 0)),
                vatAmount: Math.max(0, parseAmount(ledger.vatAmount || 0)),
                evidenceType: ledger.evidenceType || '',
                evidenceNumber: ledger.evidenceNumber || '',
                refundReason: ledger.refundReason || ''
            }
        };
    }

    const tuition = { amount: md.tuition?.amount ?? student.defaultFee ?? 0, date: md.tuition?.date || '' };
    const textbook = { amount: md.textbook?.amount ?? student.defaultTextbookFee ?? 0, date: md.textbook?.date || '' };
    const special = { amount: md.special?.amount ?? student.specialLectureFee ?? 0, date: md.special?.date || '' };
    const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
    const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);

    let status;
    if (totalDue === 0) status = 'no_charge';
    else if (totalPaid >= totalDue) status = 'paid';
    else if (totalPaid > 0) status = 'partial';
    else status = 'billed';

    return {
        totalDue,
        totalPaid,
        totalPaidGross: totalPaid,
        refundAmount: 0,
        status,
        source: 'legacy',
        fees: { tuition, textbook, special }
    };
}

window.openPaymentModal = async function() {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('수납 관리는 관리자만 접근할 수 있습니다.', 'warning');
        return;
    }
    openModal('payment-modal');
    currentPaymentDate = new Date();
    paymentSearchQuery = '';
    const searchInput = document.getElementById('pay-search-input');
    if (searchInput) searchInput.value = '';
    initializePaymentClosePanelCompactMode();
    switchPaymentManagementTab('income');
    setPaymentFilter('all');
    // 비용 탭은 가능한 경우 원격(Supabase) 데이터와 동기화
    await syncExpenseLedgerFromRemote();
    await maybePromptTaxFilingCheck();
}

window.switchPaymentManagementTab = function(tab) {
    const next = tab === 'expense' ? 'expense' : 'income';
    currentPaymentManagementTab = next;
    const incomeBtn = document.getElementById('pay-main-tab-income');
    const expenseBtn = document.getElementById('pay-main-tab-expense');
    const incomeSection = document.getElementById('pay-main-section-income');
    const expenseSection = document.getElementById('pay-main-section-expense');

    if (incomeBtn) incomeBtn.classList.toggle('active', next === 'income');
    if (expenseBtn) expenseBtn.classList.toggle('active', next === 'expense');
    if (incomeSection) incomeSection.classList.toggle('hidden', next !== 'income');
    if (expenseSection) expenseSection.classList.toggle('hidden', next !== 'expense');

    if (next === 'income') {
        renderPaymentList();
    } else {
        renderExpenseTab();
        syncExpenseLedgerFromRemote().then(synced => {
            if (synced && currentPaymentManagementTab === 'expense') {
                renderExpenseTab();
            }
        });
    }
}

function renderExpenseTab() {
    const title = document.getElementById('payment-month-title');
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (title) title.textContent = `${year}년 ${month}월`;
    renderExpenseList(monthKey);
    updateExpenseSummary(monthKey);
}

window.togglePaymentClosePanel = function() {
    const panel = document.querySelector('.pay-close-panel');
    const btn = document.getElementById('pay-close-toggle-btn');
    if (!panel || !btn) return;
    const collapsed = panel.classList.toggle('collapsed');
    btn.textContent = collapsed ? '요약 펼치기' : '요약 접기';
    savePaymentClosePanelCollapsedPref(collapsed);
}

function initializePaymentClosePanelCompactMode() {
    const panel = document.querySelector('.pay-close-panel');
    const btn = document.getElementById('pay-close-toggle-btn');
    if (!panel || !btn) return;
    const saved = loadPaymentClosePanelCollapsedPref();
    const shouldCompactByViewport = window.innerWidth <= 920 || window.innerHeight <= 700;
    const collapsed = saved === null ? shouldCompactByViewport : saved;
    panel.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '요약 펼치기' : '요약 접기';
}

function getLedgerPrefill(student, monthKey) {
    const monthData = student?.payments?.[monthKey] || {};
    const summary = getPaymentSummary(student, monthKey, monthData);
    const ledger = monthData.ledger || {};
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const todayStr = new Date(today.getTime() - offset).toISOString().split('T')[0];

    return {
        dueAmount: parseAmount(ledger.dueAmount || summary.totalDue || 0),
        paidAmount: parseAmount(ledger.paidAmount || summary.totalPaidGross || summary.totalPaid || 0),
        supplyAmount: parseAmount(ledger.supplyAmount || ledger.paidAmount || summary.totalPaidGross || summary.totalPaid || 0),
        vatAmount: parseAmount(ledger.vatAmount || 0),
        paidAt: ledger.paidAt || (summary.totalPaid > 0 ? todayStr : ''),
        channel: ledger.channel || '통장',
        method: ledger.method || '계좌이체',
        referenceId: ledger.referenceId || '',
        evidenceType: ledger.evidenceType || 'manual',
        evidenceNumber: ledger.evidenceNumber || '',
        unmatchedDeposit: Boolean(ledger.unmatchedDeposit),
        refundAmount: parseAmount(ledger.refundAmount || 0),
        refundReason: String(ledger.refundReason || ''),
        note: ledger.note || ''
    };
}

function saveLedgerEntryByStudentId(studentId, monthKey, payload) {
    const student = (students || []).find(s => String(s.id) === String(studentId));
    if (!student) {
        throw new Error('학생 정보를 찾을 수 없습니다.');
    }
    const monthData = getOrCreateMonthData(student, monthKey);
    const normalizedPaidAmount = Math.max(0, parseAmount(payload.paidAmount));
    const normalizedSupplyAmount = Math.max(0, parseAmount(payload.supplyAmount));
    const normalizedVatAmount = Math.max(0, parseAmount(payload.vatAmount));
    const hasExplicitTaxBreakdown = (normalizedSupplyAmount + normalizedVatAmount) > 0;
    monthData.ledger = {
        dueAmount: Math.max(0, parseAmount(payload.dueAmount)),
        paidAmount: normalizedPaidAmount,
        supplyAmount: hasExplicitTaxBreakdown ? normalizedSupplyAmount : normalizedPaidAmount,
        vatAmount: hasExplicitTaxBreakdown ? normalizedVatAmount : 0,
        paidAt: (payload.paidAt || '').trim(),
        channel: (payload.channel || '').trim(),
        method: (payload.method || '').trim(),
        referenceId: (payload.referenceId || '').trim(),
        evidenceNumber: (payload.evidenceNumber || '').trim(),
        unmatchedDeposit: Boolean(payload.unmatchedDeposit),
        refundAmount: Math.max(0, parseAmount(payload.refundAmount)),
        refundReason: (payload.refundReason || '').trim(),
        note: (payload.note || '').trim(),
        updatedAt: new Date().toISOString(),
        evidenceType: payload.evidenceType || 'manual',
        evidenceName: (payload.evidenceName || '').trim()
    };
}

window.openPaymentLedgerModal = function(studentId = '', monthKey = '') {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('원장 입력은 관리자만 가능합니다.', 'warning');
        return;
    }

    const modal = document.getElementById('payment-ledger-modal');
    const studentSelect = document.getElementById('ledger-student-id');
    const monthInput = document.getElementById('ledger-month-key');
    if (!modal || !studentSelect || !monthInput) return;

    const activeStudents = getActiveStudents();
    studentSelect.innerHTML = buildStudentOptionsHtml(activeStudents);

    const targetMonth = monthKey || getCurrentPaymentMonthKey();
    monthInput.value = targetMonth;
    studentSelect.value = String(studentId || '');

    const dueInput = document.getElementById('ledger-due-amount');
    const paidInput = document.getElementById('ledger-paid-amount');
    const supplyInput = document.getElementById('ledger-supply-amount');
    const vatInput = document.getElementById('ledger-vat-amount');
    const paidAtInput = document.getElementById('ledger-paid-at');
    const channelInput = document.getElementById('ledger-channel');
    const methodInput = document.getElementById('ledger-method');
    const refInput = document.getElementById('ledger-reference-id');
    const evidenceTypeInput = document.getElementById('ledger-evidence-type');
    const evidenceNumberInput = document.getElementById('ledger-evidence-number');
    const unmatchedInput = document.getElementById('ledger-unmatched');
    const refundAmountInput = document.getElementById('ledger-refund-amount');
    const refundReasonInput = document.getElementById('ledger-refund-reason');
    const noteInput = document.getElementById('ledger-note');

    const selectedStudent = activeStudents.find(s => String(s.id) === String(studentId));
    const prefill = selectedStudent ? getLedgerPrefill(selectedStudent, targetMonth) : {
        dueAmount: 0,
        paidAmount: 0,
        supplyAmount: 0,
        vatAmount: 0,
        paidAt: '',
        channel: '통장',
        method: '계좌이체',
        referenceId: '',
        evidenceType: 'manual',
        evidenceNumber: '',
        unmatchedDeposit: false,
        refundAmount: 0,
        refundReason: '',
        note: ''
    };

    if (dueInput) dueInput.value = prefill.dueAmount ? prefill.dueAmount.toLocaleString() : '';
    if (paidInput) paidInput.value = prefill.paidAmount ? prefill.paidAmount.toLocaleString() : '';
    if (supplyInput) supplyInput.value = prefill.supplyAmount ? prefill.supplyAmount.toLocaleString() : '';
    if (vatInput) vatInput.value = prefill.vatAmount ? prefill.vatAmount.toLocaleString() : '';
    if (paidAtInput) paidAtInput.value = prefill.paidAt || '';
    if (channelInput) channelInput.value = prefill.channel;
    if (methodInput) methodInput.value = prefill.method;
    if (refInput) refInput.value = prefill.referenceId;
    if (evidenceTypeInput) evidenceTypeInput.value = prefill.evidenceType || 'manual';
    if (evidenceNumberInput) evidenceNumberInput.value = prefill.evidenceNumber || '';
    if (unmatchedInput) unmatchedInput.checked = prefill.unmatchedDeposit;
    if (refundAmountInput) refundAmountInput.value = prefill.refundAmount ? prefill.refundAmount.toLocaleString() : '';
    if (refundReasonInput) refundReasonInput.value = prefill.refundReason || '';
    if (noteInput) noteInput.value = prefill.note;
    resetModalRequiredMarks('payment-ledger-modal');
    applyPaymentTaxAutoFill(false);
    preparePayTermHelpButtons();

    openModal('payment-ledger-modal');
}

window.savePaymentLedger = function() {
    resetModalRequiredMarks('payment-ledger-modal');
    const studentId = document.getElementById('ledger-student-id')?.value || '';
    const monthKey = document.getElementById('ledger-month-key')?.value || '';
    const dueAmount = parseAmount(document.getElementById('ledger-due-amount')?.value || 0);
    const paidAmount = parseAmount(document.getElementById('ledger-paid-amount')?.value || 0);
    const supplyAmount = parseAmount(document.getElementById('ledger-supply-amount')?.value || 0);
    const vatAmount = parseAmount(document.getElementById('ledger-vat-amount')?.value || 0);
    const paidAt = (document.getElementById('ledger-paid-at')?.value || '').trim();
    const channel = (document.getElementById('ledger-channel')?.value || '').trim();
    const method = (document.getElementById('ledger-method')?.value || '').trim();
    const referenceId = (document.getElementById('ledger-reference-id')?.value || '').trim();
    const evidenceType = (document.getElementById('ledger-evidence-type')?.value || '').trim() || 'manual';
    const evidenceNumber = (document.getElementById('ledger-evidence-number')?.value || '').trim();
    const note = (document.getElementById('ledger-note')?.value || '').trim();
    const unmatchedDeposit = Boolean(document.getElementById('ledger-unmatched')?.checked);
    const refundAmount = parseAmount(document.getElementById('ledger-refund-amount')?.value || 0);
    const refundReason = (document.getElementById('ledger-refund-reason')?.value || '').trim();

    if (!monthKey) {
        markAndFocusRequiredFields(['ledger-month-key']);
        showToast('청구월을 선택해주세요.', 'warning');
        return;
    }
    if (dueAmount < 0 || paidAmount < 0) {
        showToast('금액은 0원 이상만 입력할 수 있습니다.', 'warning');
        return;
    }
    if (paidAmount > 0 && !paidAt) {
        markAndFocusRequiredFields(['ledger-paid-at']);
        showToast('수납금액이 있으면 수납일시를 입력해주세요.', 'warning');
        return;
    }
    if (supplyAmount + vatAmount > paidAmount && paidAmount > 0) {
        markAndFocusRequiredFields(['ledger-paid-amount', 'ledger-supply-amount', 'ledger-vat-amount']);
        showToast('공급가액 + 세액은 수납금액을 초과할 수 없습니다.', 'warning');
        return;
    }
    if (refundAmount > paidAmount) {
        markAndFocusRequiredFields(['ledger-refund-amount', 'ledger-paid-amount']);
        showToast('환불금액은 수납금액보다 클 수 없습니다.', 'warning');
        return;
    }
    if (!studentId && !unmatchedDeposit) {
        markAndFocusRequiredFields(['ledger-student-id', 'ledger-unmatched']);
        showToast('학생을 선택하거나 미확인입금으로 저장해주세요.', 'warning');
        return;
    }

    if (!studentId && unmatchedDeposit) {
        addUnmatchedEntry({
            monthKey,
            dueAmount,
            paidAmount,
            supplyAmount,
            vatAmount,
            paidAt,
            channel,
            method,
            referenceId,
            evidenceNumber,
            refundAmount,
            refundReason,
            note,
            evidenceType,
            evidenceName: '',
        });
        closeModal('payment-ledger-modal');
        renderPaymentList();
        showToast('학생 미지정 미확인입금으로 저장되었습니다.', 'success');
        return;
    }

    try {
        saveLedgerEntryByStudentId(studentId, monthKey, {
            dueAmount,
            paidAmount,
            supplyAmount,
            vatAmount,
            paidAt,
            channel,
            method,
            referenceId,
            evidenceNumber,
            unmatchedDeposit,
            refundAmount,
            refundReason,
            note,
            evidenceType,
            evidenceName: '',
        });
    } catch (err) {
        showToast(err.message || '원장 저장 실패', 'error');
        return;
    }

    saveData();
    closeModal('payment-ledger-modal');
    renderPaymentList();
    showToast('수납 원장 항목이 저장되었습니다.', 'success');
}

window.openPaymentAiModal = function() {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('AI 수납 도우미는 관리자만 사용할 수 있습니다.', 'warning');
        return;
    }

    const activeStudents = getActiveStudents();
    const studentSelect = document.getElementById('pay-ai-student-id');
    const monthInput = document.getElementById('pay-ai-month-key');
    const sourceType = document.getElementById('pay-ai-source-type');
    const extractMode = document.getElementById('pay-ai-extract-mode');
    const fileInput = document.getElementById('pay-ai-image-file');
    const runBtn = document.getElementById('pay-ai-run-btn');
    if (!studentSelect || !monthInput || !sourceType || !extractMode || !fileInput || !runBtn) return;

    studentSelect.innerHTML = buildStudentOptionsHtml(activeStudents);
    monthInput.value = getCurrentPaymentMonthKey();
    sourceType.value = '결제선생 화면';
    extractMode.value = 'single';
    fileInput.value = '';
    runBtn.disabled = false;
    runBtn.textContent = 'AI 추출 실행';

    openModal('payment-ai-modal');
}

function getSelectedStudentNameById(studentId) {
    const student = (students || []).find(s => String(s.id) === String(studentId));
    return student?.name || '';
}

window.runPaymentAiExtract = async function() {
    const fileInput = document.getElementById('pay-ai-image-file');
    const sourceType = document.getElementById('pay-ai-source-type');
    const studentId = document.getElementById('pay-ai-student-id')?.value || '';
    const monthKey = document.getElementById('pay-ai-month-key')?.value || '';
    const extractMode = document.getElementById('pay-ai-extract-mode')?.value || 'single';
    const runBtn = document.getElementById('pay-ai-run-btn');
    const file = fileInput?.files?.[0];
    if (!file) {
        showToast('증빙 이미지를 선택해주세요.', 'warning');
        return;
    }

    const serverUrl = getPaymentHelperServerUrl();
    if (!serverUrl) {
        showToast('채점 서버 주소가 설정되지 않았습니다. 설정 후 다시 시도해주세요.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('source_type', sourceType?.value || '기타');
    formData.append('student_hint', getSelectedStudentNameById(studentId));
    formData.append('month_hint', monthKey);
    formData.append('extract_mode', extractMode);

    try {
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'AI 추출 중...';
        }
        const authHeaders = await getAuthHeadersForPaymentHelper();
        const res = await fetch(`${serverUrl}/api/payments/extract`, {
            method: 'POST',
            headers: authHeaders,
            body: formData
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.detail || `AI 추출 실패 (${res.status})`);
        }
        const rawDrafts = Array.isArray(data?.drafts) ? data.drafts : (data?.draft ? [data.draft] : []);
        if (!rawDrafts.length) {
            throw new Error('AI 추출 결과가 비어 있습니다.');
        }

        const drivePath = String(data?.drive_path || '').trim();
        const driveFileId = String(data?.drive_file_id || '').trim();
        const driveSaved = Boolean(data?.drive_saved);
        const driveNote = drivePath
            ? `[드라이브증빙] ${drivePath}${driveFileId ? ` (file_id:${driveFileId})` : ''}`
            : '';
        paymentAiDrafts = rawDrafts.map(draft => {
            const base = { ...(draft || {}) };
            const baseNote = String(base.note || '').trim();
            const mergedNote = driveNote
                ? (baseNote ? `${baseNote}\n${driveNote}` : driveNote)
                : baseNote;
            return {
                ...base,
                note: mergedNote,
                sourceType: sourceType?.value || '기타',
                evidenceName: file.name || '',
                studentIdHint: studentId || '',
                monthKeyHint: monthKey || '',
                evidenceDriveFileId: driveFileId,
                evidenceDrivePath: drivePath,
                evidenceDriveUrl: String(data?.drive_url || '').trim(),
                evidenceDriveSaved: driveSaved
            };
        });
        paymentAiDraft = paymentAiDrafts[0] || null;
        if (data?.drive_saved) {
            showToast('AI 증빙 이미지를 Google Drive에 저장했습니다.', 'success');
        } else if (data?.drive_reason) {
            showToast(`AI 추출은 완료됐지만 Drive 저장은 실패했습니다: ${data.drive_reason}`, 'info');
        }

        closeModal('payment-ai-modal');
        if (extractMode === 'multi' || paymentAiDrafts.length > 1) {
            openPaymentAiMultiReviewModal(paymentAiDrafts);
        } else {
            openPaymentAiReviewModal(paymentAiDraft);
        }
    } catch (err) {
        showToast(`AI 추출 실패: ${err.message || err}`, 'error');
    } finally {
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.textContent = 'AI 추출 실행';
        }
    }
}

function openPaymentAiReviewModal(draft) {
    const activeStudents = getActiveStudents();
    const studentSelect = document.getElementById('pay-ai-review-student-id');
    const notesBox = document.getElementById('pay-ai-review-notes');
    if (!studentSelect) return;
    studentSelect.innerHTML = buildStudentOptionsHtml(activeStudents);

    const guessedByName = activeStudents.find(s => (s.name || '').trim() === (draft.student_name || '').trim());
    studentSelect.value = String(draft.studentIdHint || guessedByName?.id || '');

    const monthInput = document.getElementById('pay-ai-review-month-key');
    const dueInput = document.getElementById('pay-ai-review-due-amount');
    const paidInput = document.getElementById('pay-ai-review-paid-amount');
    const paidAtInput = document.getElementById('pay-ai-review-paid-at');
    const channelInput = document.getElementById('pay-ai-review-channel');
    const methodInput = document.getElementById('pay-ai-review-method');
    const referenceInput = document.getElementById('pay-ai-review-reference-id');
    const unmatchedInput = document.getElementById('pay-ai-review-unmatched');
    const refundAmountInput = document.getElementById('pay-ai-review-refund-amount');
    const refundReasonInput = document.getElementById('pay-ai-review-refund-reason');
    const noteInput = document.getElementById('pay-ai-review-note');

    if (monthInput) monthInput.value = draft.month_key || draft.monthKeyHint || getCurrentPaymentMonthKey();
    if (dueInput) dueInput.value = parseAmount(draft.due_amount || 0).toLocaleString();
    if (paidInput) paidInput.value = parseAmount(draft.paid_amount || 0).toLocaleString();
    if (paidAtInput) paidAtInput.value = (draft.paid_at || '').slice(0, 10);
    if (channelInput) channelInput.value = draft.channel || '통장';
    if (methodInput) methodInput.value = draft.method || '계좌이체';
    if (referenceInput) referenceInput.value = draft.reference_id || '';
    if (unmatchedInput) unmatchedInput.checked = Boolean(draft.unmatched_deposit);
    if (refundAmountInput) refundAmountInput.value = '';
    if (refundReasonInput) refundReasonInput.value = '';
    if (noteInput) {
        const aiMeta = `AI추출(${draft.sourceType || '기타'}, 신뢰도 ${parseAmount(draft.confidence || 0)}%)`;
        noteInput.value = `${draft.note || ''}${draft.note ? '\n' : ''}${aiMeta}`;
    }

    if (notesBox) {
        const notes = Array.isArray(draft.review_notes) ? draft.review_notes.filter(Boolean) : [];
        if (notes.length) {
            notesBox.innerHTML = `<strong>검토 포인트</strong><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
            notesBox.style.display = 'block';
        } else {
            notesBox.style.display = 'none';
            notesBox.innerHTML = '';
        }
    }

    openModal('payment-ai-review-modal');
}

function findStudentIdByName(activeStudents, name) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return '';
    const matched = activeStudents.find(s => String(s.name || '').trim() === normalizedName);
    return matched ? String(matched.id) : '';
}

function buildPaymentAiMultiRowHtml(draft, index, activeStudents) {
    const guessedStudentId = String(draft.studentIdHint || findStudentIdByName(activeStudents, draft.student_name));
    const monthKey = draft.month_key || draft.monthKeyHint || getCurrentPaymentMonthKey();
    const note = `${draft.note || ''}${draft.note ? '\n' : ''}AI추출(${draft.sourceType || '기타'}, 신뢰도 ${parseAmount(draft.confidence || 0)}%)`;
    const reviewNotes = Array.isArray(draft.review_notes) ? draft.review_notes.filter(Boolean) : [];
    const reviewNotesText = reviewNotes.length
        ? `<div class="pay-ai-multi-row-notes">검토: ${escapeHtml(reviewNotes.join(' / '))}</div>`
        : '';

    return `
        <div class="pay-ai-multi-row" data-index="${index}">
            <div class="pay-ai-multi-grid">
                <div class="input-group">
                    <label>학생</label>
                    <select class="m-input pay-ai-multi-student-id">${buildStudentOptionsHtml(activeStudents)}</select>
                </div>
                <div class="input-group">
                    <label>청구월</label>
                    <input type="month" class="m-input pay-ai-multi-month-key" value="${escapeHtml(monthKey)}">
                </div>
                <div class="input-group">
                    <label>청구금액</label>
                    <input type="text" class="m-input pay-ai-multi-due-amount" value="${parseAmount(draft.due_amount || 0).toLocaleString()}" oninput="formatNumberWithComma(this)">
                </div>
                <div class="input-group">
                    <label>수납금액</label>
                    <input type="text" class="m-input pay-ai-multi-paid-amount" value="${parseAmount(draft.paid_amount || 0).toLocaleString()}" oninput="formatNumberWithComma(this)">
                </div>
                <div class="input-group">
                    <label>수납일시</label>
                    <input type="date" class="m-input pay-ai-multi-paid-at" value="${escapeHtml((draft.paid_at || '').slice(0, 10))}">
                </div>
                <div class="input-group">
                    <label>결제경로</label>
                    <select class="m-input pay-ai-multi-channel">
                        <option value="결제선생" ${draft.channel === '결제선생' ? 'selected' : ''}>결제선생</option>
                        <option value="비즐" ${draft.channel === '비즐' ? 'selected' : ''}>비즐</option>
                        <option value="통장" ${draft.channel === '통장' ? 'selected' : ''}>통장</option>
                        <option value="기타" ${draft.channel === '기타' ? 'selected' : ''}>기타</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>결제수단</label>
                    <select class="m-input pay-ai-multi-method">
                        <option value="카드" ${draft.method === '카드' ? 'selected' : ''}>카드</option>
                        <option value="동백전" ${draft.method === '동백전' ? 'selected' : ''}>동백전</option>
                        <option value="계좌이체" ${draft.method === '계좌이체' ? 'selected' : ''}>계좌이체</option>
                        <option value="현금" ${draft.method === '현금' ? 'selected' : ''}>현금</option>
                        <option value="기타" ${draft.method === '기타' ? 'selected' : ''}>기타</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>거래확인번호</label>
                    <input type="text" class="m-input pay-ai-multi-reference-id" value="${escapeHtml(draft.reference_id || '')}">
                </div>
                <div class="input-group" style="grid-column: 1 / -1;">
                    <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="pay-ai-multi-unmatched" ${draft.unmatched_deposit ? 'checked' : ''}>
                        미확인입금으로 보관(학생 미선택 저장 가능)
                    </label>
                </div>
                <div class="input-group">
                    <label>환불금액(선택)</label>
                    <input type="text" class="m-input pay-ai-multi-refund-amount" value="" oninput="formatNumberWithComma(this)">
                </div>
                <div class="input-group">
                    <label>환불사유(선택)</label>
                    <input type="text" class="m-input pay-ai-multi-refund-reason" value="">
                </div>
                <div class="input-group" style="grid-column: 1 / -1;">
                    <label>메모</label>
                    <textarea class="m-input pay-ai-multi-note" rows="2">${escapeHtml(note)}</textarea>
                </div>
            </div>
            ${reviewNotesText}
        </div>
    `;
}

function openPaymentAiMultiReviewModal(drafts) {
    const activeStudents = getActiveStudents();
    const wrap = document.getElementById('pay-ai-multi-review-table-wrap');
    const notesBox = document.getElementById('pay-ai-multi-review-notes');
    if (!wrap) return;

    wrap.innerHTML = drafts.map((draft, index) => buildPaymentAiMultiRowHtml(draft, index, activeStudents)).join('');
    wrap.querySelectorAll('.pay-ai-multi-row').forEach((row, idx) => {
        const select = row.querySelector('.pay-ai-multi-student-id');
        if (select) {
            const guessedStudentId = String(drafts[idx]?.studentIdHint || findStudentIdByName(activeStudents, drafts[idx]?.student_name));
            select.value = guessedStudentId;
        }
    });

    if (notesBox) {
        notesBox.style.display = 'block';
        notesBox.innerHTML = `총 ${drafts.length}건 추출됨. 학생/월/금액/수납일을 우선 검토해주세요.`;
    }
    openModal('payment-ai-multi-review-modal');
}

window.savePaymentAiMultiReview = function(forceUnmatched = false) {
    const rows = Array.from(document.querySelectorAll('#pay-ai-multi-review-table-wrap .pay-ai-multi-row'));
    if (!rows.length) {
        showToast('저장할 항목이 없습니다.', 'warning');
        return;
    }

    let successCount = 0;
    const failed = [];

    rows.forEach((row, idx) => {
        const draftMeta = paymentAiDrafts[idx] || {};
        const studentId = row.querySelector('.pay-ai-multi-student-id')?.value || '';
        const monthKey = row.querySelector('.pay-ai-multi-month-key')?.value || '';
        const dueAmount = parseAmount(row.querySelector('.pay-ai-multi-due-amount')?.value || 0);
        const paidAmount = parseAmount(row.querySelector('.pay-ai-multi-paid-amount')?.value || 0);
        const paidAt = (row.querySelector('.pay-ai-multi-paid-at')?.value || '').trim();
        const channel = (row.querySelector('.pay-ai-multi-channel')?.value || '').trim();
        const method = (row.querySelector('.pay-ai-multi-method')?.value || '').trim();
        const referenceId = (row.querySelector('.pay-ai-multi-reference-id')?.value || '').trim();
        const note = (row.querySelector('.pay-ai-multi-note')?.value || '').trim();
        const unmatchedChecked = Boolean(row.querySelector('.pay-ai-multi-unmatched')?.checked);
        const refundAmount = parseAmount(row.querySelector('.pay-ai-multi-refund-amount')?.value || 0);
        const refundReason = (row.querySelector('.pay-ai-multi-refund-reason')?.value || '').trim();
        const unmatchedDeposit = forceUnmatched || unmatchedChecked;

        try {
            if (!monthKey) throw new Error('청구월 필요');
            if (dueAmount < 0 || paidAmount < 0) throw new Error('금액은 0원 이상');
            if (paidAmount > 0 && !paidAt) throw new Error('수납일시 필요');
            if (refundAmount > paidAmount) throw new Error('환불금액 초과');
            if (!studentId && !unmatchedDeposit) throw new Error('학생 선택 또는 미확인입금 체크 필요');

            if (!studentId && unmatchedDeposit) {
                addUnmatchedEntry({
                    monthKey,
                    dueAmount,
                    paidAmount,
                    paidAt,
                    channel,
                    method,
                    referenceId,
                    refundAmount,
                    refundReason,
                    note,
                    evidenceType: 'ai_extract',
                    evidenceName: draftMeta?.evidenceName || ''
                });
            } else {
                saveLedgerEntryByStudentId(studentId, monthKey, {
                    dueAmount,
                    paidAmount,
                    paidAt,
                    channel,
                    method,
                    referenceId,
                    unmatchedDeposit,
                    refundAmount,
                    refundReason,
                    note,
                    evidenceType: 'ai_extract',
                    evidenceName: draftMeta?.evidenceName || ''
                });
            }
            successCount += 1;
        } catch (err) {
            failed.push(`${idx + 1}행: ${err.message || '저장 실패'}`);
        }
    });

    if (!successCount) {
        showToast(`저장 실패 (${failed[0] || '오류'})`, 'error');
        return;
    }

    saveData();
    closeModal('payment-ai-multi-review-modal');
    renderPaymentList();
    if (failed.length) {
        showToast(`${successCount}건 저장, ${failed.length}건 실패`, 'warning');
        console.warn('[payment-ai-multi] 일부 저장 실패:', failed);
    } else {
        showToast(`${successCount}건이 저장되었습니다.`, 'success');
    }
}

window.savePaymentAiReview = function(forceUnmatched = false) {
    const studentId = document.getElementById('pay-ai-review-student-id')?.value || '';
    const monthKey = document.getElementById('pay-ai-review-month-key')?.value || '';
    const dueAmount = parseAmount(document.getElementById('pay-ai-review-due-amount')?.value || 0);
    const paidAmount = parseAmount(document.getElementById('pay-ai-review-paid-amount')?.value || 0);
    const paidAt = (document.getElementById('pay-ai-review-paid-at')?.value || '').trim();
    const channel = (document.getElementById('pay-ai-review-channel')?.value || '').trim();
    const method = (document.getElementById('pay-ai-review-method')?.value || '').trim();
    const referenceId = (document.getElementById('pay-ai-review-reference-id')?.value || '').trim();
    const note = (document.getElementById('pay-ai-review-note')?.value || '').trim();
    const unmatchedChecked = Boolean(document.getElementById('pay-ai-review-unmatched')?.checked);
    const refundAmount = parseAmount(document.getElementById('pay-ai-review-refund-amount')?.value || 0);
    const refundReason = (document.getElementById('pay-ai-review-refund-reason')?.value || '').trim();
    const unmatchedDeposit = forceUnmatched || unmatchedChecked;

    if (!monthKey) {
        showToast('청구월을 선택해주세요.', 'warning');
        return;
    }
    if (dueAmount < 0 || paidAmount < 0) {
        showToast('금액은 0원 이상만 입력할 수 있습니다.', 'warning');
        return;
    }
    if (paidAmount > 0 && !paidAt) {
        showToast('수납금액이 있으면 수납일시를 입력해주세요.', 'warning');
        return;
    }
    if (refundAmount > paidAmount) {
        showToast('환불금액은 수납금액보다 클 수 없습니다.', 'warning');
        return;
    }
    if (!studentId && !unmatchedDeposit) {
        showToast('학생을 선택하거나 미확인입금으로 저장해주세요.', 'warning');
        return;
    }

    if (!studentId && unmatchedDeposit) {
        addUnmatchedEntry({
            monthKey,
            dueAmount,
            paidAmount,
            paidAt,
            channel,
            method,
            referenceId,
            refundAmount,
            refundReason,
            note,
            evidenceType: 'ai_extract',
            evidenceName: paymentAiDraft?.evidenceName || ''
        });
        saveData();
        closeModal('payment-ai-review-modal');
        renderPaymentList();
        showToast('학생 미지정 미확인입금으로 저장되었습니다.', 'success');
        return;
    }

    try {
        saveLedgerEntryByStudentId(studentId, monthKey, {
            dueAmount,
            paidAmount,
            paidAt,
            channel,
            method,
            referenceId,
            unmatchedDeposit,
            refundAmount,
            refundReason,
            note,
            evidenceType: 'ai_extract',
            evidenceName: paymentAiDraft?.evidenceName || ''
        });
    } catch (err) {
        showToast(err.message || '원장 저장 실패', 'error');
        return;
    }

    saveData();
    closeModal('payment-ai-review-modal');
    renderPaymentList();
    showToast(unmatchedDeposit ? '미확인입금으로 저장되었습니다.' : 'AI 검토 결과가 저장되었습니다.', 'success');
}

window.openHomeworkPage = function() {
    const hasOrigin = window.location.origin && window.location.origin !== 'null';
    const targetUrl = hasOrigin ? `${window.location.origin}/homework/` : './homework/';
    window.open(targetUrl, '_blank');
}

window.openGradingPage = function() {
    const hasOrigin = window.location.origin && window.location.origin !== 'null';
    const targetUrl = hasOrigin ? `${window.location.origin}/grading/` : './grading/';
    window.open(targetUrl, '_blank');
}

window.openParentPortal = function() {
    const storedUrl = (window.PARENT_PORTAL_URL || localStorage.getItem('parent_portal_url') || '').trim();
    const hasOrigin = window.location.origin && window.location.origin !== 'null';
    const defaultUrl = hasOrigin ? `${window.location.origin}/parent-portal` : './parent-portal/';
    const targetUrl = storedUrl || defaultUrl;
    window.open(targetUrl, '_blank');
}

window.movePaymentMonth = function(offset) {
    const day = currentPaymentDate.getDate();
    currentPaymentDate.setDate(1);
    currentPaymentDate.setMonth(currentPaymentDate.getMonth() + offset);
    const lastDay = new Date(currentPaymentDate.getFullYear(), currentPaymentDate.getMonth() + 1, 0).getDate();
    currentPaymentDate.setDate(Math.min(day, lastDay));
    if (currentPaymentManagementTab === 'expense') {
        renderExpenseTab();
        return;
    }
    renderPaymentList();
}

function isPayrollExpenseCategory(category) {
    const c = String(category || '').trim();
    return c === '인건비' || c === '강사비';
}

function getDefaultPayrollIncomeTypeByCategory(category) {
    const c = String(category || '').trim();
    if (c === '강사비') return '비율제강사';
    if (c === '인건비') return '월급제강사';
    return '';
}

function calcBusinessPayrollTax(grossAmount) {
    const gross = Math.max(0, parseAmount(grossAmount));
    const withholding = Math.round(gross * 0.03);
    const localTax = Math.round(withholding * 0.1);
    const netAmount = Math.max(0, gross - withholding - localTax);
    return { withholding, localTax, netAmount };
}

function setExpensePayrollFieldMode({ autoTax }) {
    const withholdingInput = document.getElementById('expense-payroll-withholding');
    const localTaxInput = document.getElementById('expense-payroll-local-tax');
    const withholdingBadge = document.getElementById('expense-payroll-withholding-badge');
    const localTaxBadge = document.getElementById('expense-payroll-local-tax-badge');
    [withholdingInput, localTaxInput].forEach(input => {
        if (!input) return;
        input.readOnly = Boolean(autoTax);
        input.classList.toggle('pay-auto-input', Boolean(autoTax));
    });
    if (withholdingBadge) {
        withholdingBadge.textContent = autoTax ? '자동계산' : '직접입력';
        withholdingBadge.classList.toggle('is-auto', autoTax);
        withholdingBadge.classList.toggle('is-manual', !autoTax);
    }
    if (localTaxBadge) {
        localTaxBadge.textContent = autoTax ? '자동계산' : '직접입력';
        localTaxBadge.classList.toggle('is-auto', autoTax);
        localTaxBadge.classList.toggle('is-manual', !autoTax);
    }
}

function updateExpensePayrollHelpText(payrollType) {
    const help = document.getElementById('expense-payroll-help');
    if (!help) return;
    if (payrollType === '비율제강사') {
        help.textContent = '비율제 강사(사업소득): 원천세 3.0% + 지방소득세 0.3%가 자동 계산됩니다.';
        return;
    }
    if (payrollType === '월급제강사') {
        help.textContent = '월급제 강사(근로소득): 원천세/지방소득세/공제를 직접 입력하면 실지급액이 자동 계산됩니다.';
        return;
    }
    help.textContent = '소득유형을 먼저 선택하면 필요한 항목이 자동으로 안내됩니다.';
}

function applyExpensePayrollAutoFill() {
    const category = (document.getElementById('expense-category')?.value || '').trim();
    const payrollType = (document.getElementById('expense-payroll-income-type')?.value || '').trim();
    const grossAmount = Math.max(0, parseAmount(document.getElementById('expense-amount')?.value || 0));
    const withholdingInput = document.getElementById('expense-payroll-withholding');
    const localTaxInput = document.getElementById('expense-payroll-local-tax');
    const insuranceInput = document.getElementById('expense-payroll-insurance');
    const netInput = document.getElementById('expense-payroll-net');
    if (!withholdingInput || !localTaxInput || !insuranceInput || !netInput) return;
    if (!isPayrollExpenseCategory(category)) {
        setFormattedAmountInputById('expense-payroll-withholding', 0);
        setFormattedAmountInputById('expense-payroll-local-tax', 0);
        setFormattedAmountInputById('expense-payroll-net', 0);
        updateExpensePayrollHelpText('');
        setExpensePayrollFieldMode({ autoTax: true });
        return;
    }

    const autoTax = payrollType === '비율제강사';
    setExpensePayrollFieldMode({ autoTax });
    updateExpensePayrollHelpText(payrollType);

    if (autoTax) {
        const calc = calcBusinessPayrollTax(grossAmount);
        setFormattedAmountInputById('expense-payroll-withholding', calc.withholding);
        setFormattedAmountInputById('expense-payroll-local-tax', calc.localTax);
    }

    const withholding = Math.max(0, parseAmount(withholdingInput.value || 0));
    const localTax = Math.max(0, parseAmount(localTaxInput.value || 0));
    const insurance = Math.max(0, parseAmount(insuranceInput.value || 0));
    const net = Math.max(0, grossAmount - withholding - localTax - insurance);
    setFormattedAmountInputById('expense-payroll-net', net);
}

window.toggleExpensePayrollFields = function(category) {
    const panel = document.getElementById('expense-payroll-fields');
    if (!panel) return;
    const isPayroll = isPayrollExpenseCategory(category);
    panel.classList.toggle('hidden', !isPayroll);
    const payrollTypeInput = document.getElementById('expense-payroll-income-type');
    if (isPayroll && payrollTypeInput && !payrollTypeInput.value) {
        payrollTypeInput.value = getDefaultPayrollIncomeTypeByCategory(category);
    }
    applyExpensePayrollAutoFill();
}

window.onExpensePayrollTypeChange = function() {
    applyExpensePayrollAutoFill();
}

window.onExpensePayrollDeductionInput = function() {
    applyExpensePayrollAutoFill();
}

window.openExpenseLedgerModal = function() {
    const role = getCurrentTeacherRole();
    if (role !== 'admin') {
        showToast('비용 등록은 관리자만 가능합니다.', 'warning');
        return;
    }
    const { monthKey, monthStart } = getCurrentPaymentMonthRange();
    const monthInput = document.getElementById('expense-month-key');
    const dateInput = document.getElementById('expense-date');
    const categoryInput = document.getElementById('expense-category');
    const amountInput = document.getElementById('expense-amount');
    const supplyAmountInput = document.getElementById('expense-supply-amount');
    const vatAmountInput = document.getElementById('expense-vat-amount');
    const methodInput = document.getElementById('expense-method');
    const vendorInput = document.getElementById('expense-vendor');
    const vatTypeInput = document.getElementById('expense-vat-type');
    const evidenceTypeInput = document.getElementById('expense-evidence-type');
    const evidenceNumberInput = document.getElementById('expense-evidence-number');
    const noteInput = document.getElementById('expense-note');
    const payrollIncomeTypeInput = document.getElementById('expense-payroll-income-type');
    const payrollTargetInput = document.getElementById('expense-payroll-target');
    const payrollMonthInput = document.getElementById('expense-payroll-month');
    const payrollWithholdingInput = document.getElementById('expense-payroll-withholding');
    const payrollLocalTaxInput = document.getElementById('expense-payroll-local-tax');
    const payrollInsuranceInput = document.getElementById('expense-payroll-insurance');
    const payrollNetInput = document.getElementById('expense-payroll-net');
    if (!monthInput || !dateInput || !categoryInput || !amountInput || !methodInput || !vendorInput || !vatTypeInput || !noteInput) return;

    monthInput.value = monthKey || '';
    dateInput.value = monthStart || '';
    categoryInput.value = '소모품';
    amountInput.value = '';
    if (supplyAmountInput) supplyAmountInput.value = '';
    if (vatAmountInput) vatAmountInput.value = '';
    methodInput.value = '계좌이체';
    vendorInput.value = '';
    vatTypeInput.value = '부가세포함';
    if (evidenceTypeInput) evidenceTypeInput.value = '세금계산서';
    if (evidenceNumberInput) evidenceNumberInput.value = '';
    noteInput.value = '';
    if (payrollIncomeTypeInput) payrollIncomeTypeInput.value = '';
    if (payrollTargetInput) payrollTargetInput.value = '';
    if (payrollMonthInput) payrollMonthInput.value = monthKey || '';
    if (payrollWithholdingInput) payrollWithholdingInput.value = '';
    if (payrollLocalTaxInput) payrollLocalTaxInput.value = '';
    if (payrollInsuranceInput) payrollInsuranceInput.value = '';
    if (payrollNetInput) payrollNetInput.value = '';
    window.toggleExpensePayrollFields(categoryInput.value);
    resetModalRequiredMarks('expense-ledger-modal');
    applyExpenseTaxAutoFill();
    applyExpensePayrollAutoFill();
    preparePayTermHelpButtons();
    openModal('expense-ledger-modal');
}

window.saveExpenseLedgerEntry = async function() {
    resetModalRequiredMarks('expense-ledger-modal');
    const monthKey = (document.getElementById('expense-month-key')?.value || '').trim();
    const expenseDate = (document.getElementById('expense-date')?.value || '').trim();
    const category = (document.getElementById('expense-category')?.value || '').trim();
    const amount = parseAmount(document.getElementById('expense-amount')?.value || 0);
    let supplyAmount = parseAmount(document.getElementById('expense-supply-amount')?.value || 0);
    let vatAmount = parseAmount(document.getElementById('expense-vat-amount')?.value || 0);
    const method = (document.getElementById('expense-method')?.value || '').trim();
    const vendor = (document.getElementById('expense-vendor')?.value || '').trim();
    const vatType = (document.getElementById('expense-vat-type')?.value || '').trim();
    const evidenceType = (document.getElementById('expense-evidence-type')?.value || '').trim();
    const evidenceNumber = (document.getElementById('expense-evidence-number')?.value || '').trim();
    const baseNote = (document.getElementById('expense-note')?.value || '').trim();
    const payrollIncomeType = (document.getElementById('expense-payroll-income-type')?.value || '').trim();
    const payrollTarget = (document.getElementById('expense-payroll-target')?.value || '').trim();
    const payrollMonth = (document.getElementById('expense-payroll-month')?.value || '').trim();
    let payrollWithholding = Math.max(0, parseAmount(document.getElementById('expense-payroll-withholding')?.value || 0));
    let payrollLocalTax = Math.max(0, parseAmount(document.getElementById('expense-payroll-local-tax')?.value || 0));
    const payrollInsurance = Math.max(0, parseAmount(document.getElementById('expense-payroll-insurance')?.value || 0));
    let payrollNetAmount = Math.max(0, amount - payrollWithholding - payrollLocalTax - payrollInsurance);
    let note = baseNote;

    if (!monthKey) {
        markAndFocusRequiredFields(['expense-month-key']);
        showToast('비용 귀속월을 선택해주세요.', 'warning');
        return;
    }
    if (!expenseDate) {
        markAndFocusRequiredFields(['expense-date']);
        showToast('지출일을 선택해주세요.', 'warning');
        return;
    }
    if (amount <= 0) {
        markAndFocusRequiredFields(['expense-amount']);
        showToast('비용 금액은 1원 이상 입력해주세요.', 'warning');
        return;
    }
    if (!category) {
        markAndFocusRequiredFields(['expense-category']);
        showToast('비용 분류를 선택해주세요.', 'warning');
        return;
    }
    if (!vendor) {
        markAndFocusRequiredFields(['expense-vendor']);
        showToast('거래처를 입력해주세요.', 'warning');
        return;
    }
    if (!evidenceType) {
        markAndFocusRequiredFields(['expense-evidence-type']);
        showToast('증빙유형을 선택해주세요.', 'warning');
        return;
    }
    if (supplyAmount + vatAmount === 0) {
        supplyAmount = amount;
        vatAmount = 0;
    }
    if (supplyAmount + vatAmount > amount) {
        markAndFocusRequiredFields(['expense-amount', 'expense-supply-amount', 'expense-vat-amount']);
        showToast('공급가액 + 세액은 비용 금액을 초과할 수 없습니다.', 'warning');
        return;
    }
    if (isPayrollExpenseCategory(category) && !payrollTarget) {
        markAndFocusRequiredFields(['expense-payroll-target']);
        showToast('인건비/강사비는 지급 대상을 입력해주세요.', 'warning');
        return;
    }
    if (isPayrollExpenseCategory(category) && !payrollIncomeType) {
        markAndFocusRequiredFields(['expense-payroll-income-type']);
        showToast('인건비/강사비는 소득유형을 선택해주세요.', 'warning');
        return;
    }
    if (isPayrollExpenseCategory(category) && !payrollMonth) {
        markAndFocusRequiredFields(['expense-payroll-month']);
        showToast('인건비/강사비는 지급월을 입력해주세요.', 'warning');
        return;
    }
    if (isPayrollExpenseCategory(category) && payrollIncomeType === '비율제강사') {
        const calc = calcBusinessPayrollTax(amount);
        payrollWithholding = calc.withholding;
        payrollLocalTax = calc.localTax;
        payrollNetAmount = calc.netAmount;
    } else if (isPayrollExpenseCategory(category)) {
        const deductionTotal = payrollWithholding + payrollLocalTax + payrollInsurance;
        if (deductionTotal > amount) {
            markAndFocusRequiredFields([
                'expense-amount',
                'expense-payroll-withholding',
                'expense-payroll-local-tax',
                'expense-payroll-insurance'
            ]);
            showToast('원천세/지방소득세/공제 합계가 지급금액보다 큽니다.', 'warning');
            return;
        }
        payrollNetAmount = Math.max(0, amount - deductionTotal);
    }

    if (isPayrollExpenseCategory(category)) {
        const detailParts = [];
        detailParts.push(`소득유형:${payrollIncomeType || '-'}`);
        detailParts.push(`대상:${payrollTarget || '-'}`);
        detailParts.push(`지급월:${payrollMonth || monthKey}`);
        detailParts.push(`원천세:${payrollWithholding.toLocaleString()}원`);
        detailParts.push(`지방소득세:${payrollLocalTax.toLocaleString()}원`);
        if (payrollInsurance > 0) detailParts.push(`공제:${payrollInsurance.toLocaleString()}원`);
        detailParts.push(`실지급액:${payrollNetAmount.toLocaleString()}원`);
        const detailLine = `[인건비상세] ${detailParts.join(' | ')}`;
        note = note ? `${note}\n${detailLine}` : detailLine;
    }

    const rows = loadExpenseLedger();
    const newRow = {
        id: `expense_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        monthKey,
        expenseDate,
        category,
        amount: Math.max(0, amount),
        supplyAmount: Math.max(0, supplyAmount),
        vatAmount: Math.max(0, vatAmount),
        method,
        vendor,
        vatType,
        evidenceType,
        evidenceNumber,
        payrollIncomeType,
        payrollTarget,
        payrollMonth: payrollMonth || monthKey,
        payrollWithholding: Math.max(0, payrollWithholding),
        payrollLocalTax: Math.max(0, payrollLocalTax),
        payrollInsurance: Math.max(0, payrollInsurance),
        payrollNetAmount: Math.max(0, payrollNetAmount),
        note,
    };
    rows.unshift(newRow);
    saveExpenseLedgerRows(rows);
    saveData();
    closeModal('expense-ledger-modal');
    renderExpenseTab();
    showToast('비용 내역이 저장되었습니다.', 'success');
    const synced = await upsertExpenseRowRemote(newRow);
    if (!synced && expenseRemoteChecked) {
        showToast('비용 내역은 로컬에 저장되었습니다. 서버 동기화는 확인이 필요합니다.', 'info');
    }
}

window.deleteExpenseLedgerEntry = async function(entryId) {
    if (!entryId) return;
    const rows = loadExpenseLedger();
    const next = rows.filter(row => String(row.id) !== String(entryId));
    saveExpenseLedgerRows(next);
    saveData();
    renderExpenseTab();
    showToast('비용 내역을 삭제했습니다.', 'info');
    const synced = await deleteExpenseRowRemote(entryId);
    if (!synced && expenseRemoteChecked) {
        showToast('로컬에서는 삭제되었습니다. 서버 동기화는 확인이 필요합니다.', 'info');
    }
}

function isStudentEligibleForPaymentMonth(student, monthKey) {
    if (!student || !monthKey) return true;
    const regDate = student.registerDate || '';
    if (!regDate || regDate.length < 7) return true;
    const regMonthKey = regDate.slice(0, 7);
    return regMonthKey <= monthKey;
}

function buildPaymentData(monthKey) {
    const activeStudents = students.filter(s => s.status === 'active');
    const eligible = activeStudents.filter(s => isStudentEligibleForPaymentMonth(s, monthKey));
    return eligible.map(s => {
        const monthData = s.payments?.[monthKey] || {};
        const summary = getPaymentSummary(s, monthKey, monthData);
        return {
            student: s,
            monthKey,
            fees: summary.fees || { tuition: { amount: 0, date: '' }, textbook: { amount: 0, date: '' }, special: { amount: 0, date: '' } },
            summary
        };
    });
}

window.renderPaymentList = function() {
    const container = document.getElementById('payment-list-container');
    const title = document.getElementById('payment-month-title');
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    title.textContent = `${year}년 ${month}월`;

    const searchEl = document.getElementById('pay-search-input');
    paymentSearchQuery = (searchEl?.value || '').trim().toLowerCase();

    const allData = buildPaymentData(monthKey);
    renderMonthlyTaxChecklist(monthKey);
    renderLaborAccountingChecklist(monthKey);
    renderUnmatchedQueueList(monthKey);
    if (allData.length === 0) {
        container.innerHTML = '<div class="pay-empty"><i class="fas fa-inbox"></i><p>등록된 재원생이 없습니다</p></div>';
        updateDashboard(allData);
        updateCloseSummary(monthKey);
        return;
    }

    let filtered = allData.filter(item => {
        if (currentPaymentFilter === 'unpaid') return item.summary.status === 'billed' || item.summary.status === 'partial' || item.summary.status === 'unmatched';
        if (currentPaymentFilter === 'paid') return item.summary.status === 'paid';
        return true;
    });
    if (paymentSearchQuery) {
        filtered = filtered.filter(item => 
            item.student.name.toLowerCase().includes(paymentSearchQuery) ||
            (item.student.grade || '').toLowerCase().includes(paymentSearchQuery) ||
            (item.student.school || '').toLowerCase().includes(paymentSearchQuery)
        );
    }

    const order = { unmatched: 0, billed: 1, partial: 2, paid: 3, no_charge: 4 };
    filtered.sort((a, b) => {
        const diff = (order[a.summary.status] ?? 9) - (order[b.summary.status] ?? 9);
        return diff !== 0 ? diff : a.student.name.localeCompare(b.student.name);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="pay-empty"><i class="fas fa-search"></i><p>검색 결과가 없습니다</p></div>';
    } else {
        container.innerHTML = filtered.map(item => buildPayCard(item)).join('');
    }
    updateDashboard(allData);
    updateCloseSummary(monthKey);
}

function updateDashboard(allData) {
    let totalDue = 0, totalPaid = 0, paidCount = 0, unpaidCount = 0;
    (allData || []).forEach(item => {
        totalDue += item.summary.totalDue;
        totalPaid += item.summary.totalPaid;
        if (item.summary.status === 'paid') paidCount++;
        else if (item.summary.status === 'billed' || item.summary.status === 'partial' || item.summary.status === 'unmatched') unpaidCount++;
    });
    const rate = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
    const circumference = 2 * Math.PI * 34;
    document.getElementById('pay-progress-pct').textContent = rate + '%';
    const fillEl = document.getElementById('pay-progress-fill');
    if (fillEl) {
        fillEl.style.strokeDasharray = circumference;
        fillEl.style.strokeDashoffset = circumference - (circumference * rate / 100);
    }
    document.getElementById('total-collected').textContent = totalPaid.toLocaleString() + '원';
    document.getElementById('total-due-amount').textContent = totalDue.toLocaleString() + '원';
    document.getElementById('count-paid').textContent = paidCount + '명';
    document.getElementById('count-unpaid').textContent = unpaidCount + '명';
}

function buildPayCard(item) {
    const { student, summary, fees, monthKey } = item;
    const { totalDue, totalPaid, status } = summary;
    const statusMap = {
        paid:      { text: '완납', cls: 'pay-status-paid' },
        billed:    { text: '청구됨', cls: 'pay-status-billed' },
        partial:   { text: '부분수납', cls: 'pay-status-partial' },
        unmatched: { text: '미확인입금', cls: 'pay-status-unmatched' },
        no_charge: { text: '청구없음', cls: 'pay-status-none' }
    };
    const st = statusMap[status] || statusMap.no_charge;
    const progressPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
    const hasLedger = summary.source === 'ledger';
    const ledgerMeta = summary.ledgerMeta || {};

    const feeRow = (type, label, icon) => {
        const f = fees[type];
        const isPaid = !!f.date;
        return `
            <div class="pay-fee-row ${isPaid ? 'is-paid' : ''}">
                <div class="pay-fee-info">
                    <i class="fas ${icon}"></i>
                    <span class="pay-fee-label">${label}</span>
                    <span class="pay-fee-amount">${(f.amount || 0).toLocaleString()}원</span>
                </div>
                <div class="pay-fee-actions">
                    ${isPaid
                        ? `<span class="pay-fee-date"><i class="fas fa-check-circle"></i> ${f.date}</span>
                           <button class="pay-fee-btn cancel" onclick="cancelPayment('${student.id}','${monthKey}','${type}')"><i class="fas fa-undo"></i></button>`
                        : `<button class="pay-fee-btn confirm" onclick="quickPay('${student.id}','${monthKey}','${type}')"><i class="fas fa-check"></i> 완납</button>`
                    }
                </div>
            </div>`;
    };

    return `
        <div class="pay-card ${st.cls}" id="payment-row-${student.id}">
            <div class="pay-card-head" onclick="togglePaymentDetail('${student.id}')">
                <div class="pay-card-left">
                    <span class="pay-card-name">${student.name}</span>
                    <span class="pay-card-grade">${student.grade || ''}</span>
                    ${student.school ? `<span class="pay-card-school">${student.school}</span>` : ''}
                </div>
                <div class="pay-card-right">
                    <div class="pay-card-amounts">
                        <span class="pay-card-paid">${totalPaid.toLocaleString()}원</span>
                        <span class="pay-card-sep">/</span>
                        <span class="pay-card-due">${totalDue.toLocaleString()}원</span>
                    </div>
                    <span class="pay-badge ${st.cls}">${st.text}</span>
                    <i class="fas fa-chevron-down pay-chevron"></i>
                </div>
            </div>
            <div class="pay-card-progress">
                <div class="pay-card-bar" style="width: ${progressPct}%"></div>
            </div>
            <div class="pay-card-detail hidden">
                <div class="pay-card-detail-scroll">
                ${hasLedger
                    ? `<div class="pay-ledger-summary">
                            <div class="pay-ledger-row"><span>결제경로</span><strong>${ledgerMeta.channel || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>결제수단</span><strong>${ledgerMeta.method || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>수납일</span><strong>${ledgerMeta.paidAt || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>거래확인번호</span><strong>${ledgerMeta.referenceId || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>공급가액</span><strong>${Math.max(0, parseAmount(ledgerMeta.supplyAmount)).toLocaleString()}원</strong></div>
                            <div class="pay-ledger-row"><span>세액</span><strong>${Math.max(0, parseAmount(ledgerMeta.vatAmount)).toLocaleString()}원</strong></div>
                            <div class="pay-ledger-row"><span>증빙유형</span><strong>${ledgerMeta.evidenceType || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>증빙번호</span><strong>${ledgerMeta.evidenceNumber || '-'}</strong></div>
                            <div class="pay-ledger-row"><span>환불금액</span><strong>${(summary.refundAmount || 0).toLocaleString()}원</strong></div>
                            <div class="pay-ledger-row"><span>환불사유</span><strong>${ledgerMeta.refundReason || '-'}</strong></div>
                        </div>`
                    : `${feeRow('tuition', '수강료', 'fa-book')}
                       ${feeRow('textbook', '교재비', 'fa-book-open')}
                       ${feeRow('special', '특강비', 'fa-star')}
                       <div class="pay-fee-edit-row">
                           <button class="pay-edit-amounts-btn" onclick="toggleAmountEdit('${student.id}','${monthKey}')">
                               <i class="fas fa-pen"></i> 금액 수정
                           </button>
                       </div>
                       <div class="pay-amount-editor hidden" id="pay-amount-editor-${student.id}">
                           <div class="pay-edit-field">
                               <label>수강료</label>
                               <input type="text" value="${fees.tuition.amount ? fees.tuition.amount.toLocaleString() : ''}" placeholder="0"
                                      oninput="formatNumberWithComma(this)"
                                      onchange="updatePayment('${student.id}','${monthKey}','tuition','amount',this.value)">
                           </div>
                           <div class="pay-edit-field">
                               <label>교재비</label>
                               <input type="text" value="${fees.textbook.amount ? fees.textbook.amount.toLocaleString() : ''}" placeholder="0"
                                      oninput="formatNumberWithComma(this)"
                                      onchange="updatePayment('${student.id}','${monthKey}','textbook','amount',this.value)">
                           </div>
                           <div class="pay-edit-field">
                               <label>특강비</label>
                               <input type="text" value="${fees.special.amount ? fees.special.amount.toLocaleString() : ''}" placeholder="0"
                                      oninput="formatNumberWithComma(this)"
                                      onchange="updatePayment('${student.id}','${monthKey}','special','amount',this.value)">
                           </div>
                       </div>`
                }
                <div class="pay-fee-edit-row">
                    <button class="pay-edit-amounts-btn" onclick="openPaymentLedgerModal('${student.id}','${monthKey}')">
                        <i class="fas fa-receipt"></i> 원장 입력 ${hasLedger ? '수정' : '등록'}
                    </button>
                </div>
                </div>
            </div>
        </div>`;
}

window.togglePaymentDetail = function(sid) {
    const card = document.getElementById(`payment-row-${sid}`);
    if (!card) return;
    const detail = card.querySelector('.pay-card-detail');
    const detailScroll = card.querySelector('.pay-card-detail-scroll');
    const chevron = card.querySelector('.pay-chevron');
    const willOpen = detail.classList.contains('hidden');

    // 수납 카드는 한 번에 1개만 펼쳐 아코디언처럼 동작하도록 고정
    if (willOpen) {
        document.querySelectorAll('#payment-list-container .pay-card').forEach(otherCard => {
            if (otherCard.id === card.id) return;
            const otherDetail = otherCard.querySelector('.pay-card-detail');
            const otherChevron = otherCard.querySelector('.pay-chevron');
            if (otherDetail && !otherDetail.classList.contains('hidden')) {
                otherDetail.classList.add('hidden');
            }
            if (otherChevron) otherChevron.classList.remove('rotate');
            otherCard.classList.remove('is-expanded');
        });
    }

    detail.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate');
    card.classList.toggle('is-expanded', willOpen);
    if (!willOpen) card.classList.remove('is-expanded');
    if (willOpen) {
        if (detailScroll) detailScroll.scrollTop = 0;
        // 펼침 직후 카드가 잘리지 않도록 리스트 컨테이너를 자동 스크롤
        requestAnimationFrame(() => {
            ensurePaymentCardVisible(card);
        });
    }
}

function ensurePaymentCardVisible(card) {
    const list = document.getElementById('payment-list-container');
    if (!list || !card) return;
    const listRect = list.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const detail = card.querySelector('.pay-card-detail');
    const detailRect = detail && !detail.classList.contains('hidden')
        ? detail.getBoundingClientRect()
        : null;
    const targetBottom = detailRect ? detailRect.bottom : cardRect.bottom;
    const targetTop = Math.min(cardRect.top, detailRect ? detailRect.top : cardRect.top);
    const topGap = targetTop - listRect.top;
    const bottomGap = targetBottom - listRect.bottom;
    const padding = 14;
    if (topGap < 0) {
        list.scrollTop += topGap - padding;
        return;
    }
    if (bottomGap > 0) {
        list.scrollTop += bottomGap + padding;
    }
}

window.addEventListener('resize', () => {
    const modal = document.getElementById('payment-modal');
    if (!modal || modal.style.display === 'none') return;
    initializePaymentClosePanelCompactMode();
});

window.toggleAmountEdit = function(sid, monthKey) {
    const editor = document.getElementById(`pay-amount-editor-${sid}`);
    if (editor) editor.classList.toggle('hidden');
}

window.quickPay = function(sid, monthKey, type) {
    const sIdx = students.findIndex(s => String(s.id) === String(sid));
    if (sIdx === -1) return;
    const student = students[sIdx];
    if (!student.payments) student.payments = {};
    if (!student.payments[monthKey]) student.payments[monthKey] = {};
    if (!student.payments[monthKey][type]) student.payments[monthKey][type] = { amount: 0, date: '' };
    const cur = student.payments[monthKey][type].amount;
    if (!cur || cur === 0) {
        let def = 0;
        if (type === 'tuition') def = student.defaultFee || 0;
        else if (type === 'textbook') def = student.defaultTextbookFee || 0;
        else if (type === 'special') def = student.specialLectureFee || 0;
        if (def > 0) student.payments[monthKey][type].amount = def;
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
    const target = student.payments[monthKey][type];
    if (field === 'amount') {
        const num = parseInt(value.replace(/,/g, ''));
        target.amount = isNaN(num) ? 0 : num;
    } else if (field === 'date') {
        target.date = value;
    }
    saveData();
    rerenderStudentPayCard(sid);
    updateDashboardFromCurrent();
}

function rerenderStudentPayCard(sid) {
    const monthKey = getCurrentPaymentMonthKey();
    const student = students.find(s => String(s.id) === String(sid));
    if (!student) return;
    const md = student.payments?.[monthKey] || {};
    const summary = getPaymentSummary(student, monthKey, md);
    const item = { student, monthKey, fees: summary.fees || { tuition: { amount: 0, date: '' }, textbook: { amount: 0, date: '' }, special: { amount: 0, date: '' } }, summary };
    const el = document.getElementById(`payment-row-${sid}`);
    if (el) {
        const wasOpen = !el.querySelector('.pay-card-detail')?.classList.contains('hidden');
        el.outerHTML = buildPayCard(item);
        if (wasOpen) {
            const newEl = document.getElementById(`payment-row-${sid}`);
            const detail = newEl?.querySelector('.pay-card-detail');
            const chevron = newEl?.querySelector('.pay-chevron');
            if (detail) detail.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate');
        }
    }
}

function updateDashboardFromCurrent() {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    updateDashboard(buildPaymentData(monthKey));
}

window.downloadMonthlyLedgerCsv = function() {
    const monthKey = getCurrentPaymentMonthKey();
    const rows = getMonthLedgerRows(monthKey);
    const options = getCsvAddonOptions();
    const filename = `수납원장_${monthKey}.csv`;
    const baseHeaders = ['청구월', '학생명', '학년', '상태', '청구금액', '수납총액', '공급가액', '세액', '환불금액', '순수납액', '미수금', '결제경로', '결제수단', '수납일', '거래확인번호', '미확인입금', '증빙유형', '증빙번호', '증빙파일', '메모'];
    const baseRows = rows.map(r => [
        r.monthKey, r.studentName, r.grade, r.statusLabel,
        r.dueAmount, r.paidGross, r.supplyAmount, r.vatAmount, r.refundAmount, r.paidNet, r.outstanding,
        r.channel, r.method, r.paidAt, r.referenceId,
        r.unmatchedDeposit ? 'Y' : 'N', r.evidenceType, r.evidenceNumber, r.evidenceName, r.note
    ]);

    let headers = baseHeaders;
    let csvRows = baseRows;
    const addonRows = [];
    if (options.includeReconcile) addonRows.push(...buildReconcileAddonRows(monthKey, rows));
    if (options.includePayrollMeta) addonRows.push(...buildPayrollAddonRows(monthKey));
    if (addonRows.length > 0) {
        const merged = mergeCsvWithAddonColumns(baseHeaders, baseRows, addonRows);
        headers = merged.headers;
        csvRows = merged.rows;
    }

    downloadCsvFile(
        filename,
        headers,
        csvRows
    );
    showToast('월 원장 CSV를 다운로드했습니다.', 'success');
}

window.downloadOutstandingCsv = function() {
    const monthKey = getCurrentPaymentMonthKey();
    const rows = getMonthLedgerRows(monthKey).filter(r => r.outstanding > 0 || r.status === 'unmatched');
    const filename = `미수금_${monthKey}.csv`;
    downloadCsvFile(
        filename,
        ['청구월', '학생명', '학년', '상태', '청구금액', '순수납액', '미수금', '결제경로', '결제수단', '수납일', '거래확인번호', '증빙유형', '증빙번호', '메모'],
        rows.map(r => [
            r.monthKey, r.studentName, r.grade, r.statusLabel,
            r.dueAmount, r.paidNet, r.outstanding,
            r.channel, r.method, r.paidAt, r.referenceId, r.evidenceType, r.evidenceNumber, r.note
        ])
    );
    showToast('미수금 CSV를 다운로드했습니다.', 'success');
}

window.downloadMethodSummaryCsv = function() {
    const monthKey = getCurrentPaymentMonthKey();
    const rows = getMonthLedgerRows(monthKey);
    const options = getCsvAddonOptions();
    const bucket = {};
    rows.forEach(r => {
        const methodKey = r.method || '-';
        if (!bucket[methodKey]) bucket[methodKey] = { method: methodKey, count: 0, gross: 0, refund: 0, net: 0 };
        bucket[methodKey].count += 1;
        bucket[methodKey].gross += r.paidGross;
        bucket[methodKey].refund += r.refundAmount;
        bucket[methodKey].net += r.paidNet;
    });
    const summaryRows = Object.values(bucket).sort((a, b) => b.net - a.net);
    const baseHeaders = ['청구월', '결제수단', '건수', '수납총액', '환불금액', '순수납액'];
    const baseRows = summaryRows.map(r => [monthKey, r.method, r.count, r.gross, r.refund, r.net]);
    let headers = baseHeaders;
    let csvRows = baseRows;
    const addonRows = [];
    if (options.includeReconcile) addonRows.push(...buildReconcileAddonRows(monthKey, rows));
    if (options.includePayrollMeta) addonRows.push(...buildPayrollAddonRows(monthKey));
    if (addonRows.length > 0) {
        const merged = mergeCsvWithAddonColumns(baseHeaders, baseRows, addonRows);
        headers = merged.headers;
        csvRows = merged.rows;
    }
    downloadCsvFile(
        `수단별합계_${monthKey}.csv`,
        headers,
        csvRows
    );
    showToast('수단별 합계 CSV를 다운로드했습니다.', 'success');
}

window.downloadRefundCsv = function() {
    const monthKey = getCurrentPaymentMonthKey();
    const rows = getMonthLedgerRows(monthKey).filter(r => r.refundAmount > 0);
    downloadCsvFile(
        `환불내역_${monthKey}.csv`,
        ['청구월', '학생명', '학년', '환불금액', '환불사유', '결제경로', '결제수단', '거래확인번호', '증빙유형', '증빙번호', '메모'],
        rows.map(r => [
            r.monthKey, r.studentName, r.grade, r.refundAmount, r.refundReason,
            r.channel, r.method, r.referenceId, r.evidenceType, r.evidenceNumber, r.note
        ])
    );
    showToast(rows.length ? '환불내역 CSV를 다운로드했습니다.' : '환불 데이터가 없어 빈 CSV를 다운로드했습니다.', 'info');
}

window.downloadExpenseCsv = function() {
    const monthKey = getCurrentPaymentMonthKey();
    const rows = getExpenseRowsByMonth(monthKey);
    downloadCsvFile(
        `비용원장_${monthKey}.csv`,
        ['귀속월', '지출일', '분류', '금액', '공급가액', '세액', '결제수단', '거래처', '부가세구분', '증빙유형', '증빙번호', '메모'],
        rows.map(r => [
            r.monthKey,
            r.expenseDate,
            r.category,
            r.amount,
            r.supplyAmount,
            r.vatAmount,
            r.method,
            r.vendor,
            r.vatType,
            r.evidenceType,
            r.evidenceNumber,
            r.note
        ])
    );
    showToast(rows.length ? '비용 CSV를 다운로드했습니다.' : '해당 월 비용 데이터가 없어 빈 CSV를 다운로드했습니다.', 'info');
}

window.batchQuickPayAll = async function() {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const allData = buildPaymentData(monthKey);
    const unpaid = allData.filter(d => d.summary.status === 'billed' || d.summary.status === 'partial' || d.summary.status === 'unmatched');
    if (unpaid.length === 0) { showToast('미납 학생이 없습니다.', 'info'); return; }
    if (!(await showConfirm(`미납 학생 ${unpaid.length}명을 전원 오늘 날짜로 완납 처리하시겠습니까?`, { type: 'warn', title: '일괄 처리' }))) return;
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const dateStr = new Date(today.getTime() - offset).toISOString().split('T')[0];
    unpaid.forEach(item => {
        const s = item.student;
        if (!s.payments) s.payments = {};
        if (!s.payments[monthKey]) s.payments[monthKey] = {};
        ['tuition', 'textbook', 'special'].forEach(type => {
            if (!s.payments[monthKey][type]) s.payments[monthKey][type] = { amount: 0, date: '' };
            const t = s.payments[monthKey][type];
            if (!t.amount || t.amount === 0) {
                let def = 0;
                if (type === 'tuition') def = s.defaultFee || 0;
                else if (type === 'textbook') def = s.defaultTextbookFee || 0;
                else if (type === 'special') def = s.specialLectureFee || 0;
                if (def > 0) t.amount = def;
            }
            if (t.amount > 0 && !t.date) t.date = dateStr;
        });
    });
    saveData();
    renderPaymentList();
}
