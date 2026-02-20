// ============================================
// 수납 관리 기능 (Card-based UI, 검색, 일괄 완납, 프로그레스)
// ============================================

let paymentSearchQuery = '';

window.openPaymentModal = function() {
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
    setPaymentFilter('all');
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
    renderPaymentList();
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
        const md = s.payments?.[monthKey] || {};
        const tuition = { amount: md.tuition?.amount ?? s.defaultFee ?? 0, date: md.tuition?.date || '' };
        const textbook = { amount: md.textbook?.amount ?? s.defaultTextbookFee ?? 0, date: md.textbook?.date || '' };
        const special = { amount: md.special?.amount ?? s.specialLectureFee ?? 0, date: md.special?.date || '' };
        const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
        const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);
        let status;
        if (totalDue === 0) status = 'no_charge';
        else if (totalPaid >= totalDue) status = 'paid';
        else if (totalPaid > 0) status = 'partial';
        else status = 'unpaid';
        return { student: s, monthKey, fees: { tuition, textbook, special }, summary: { totalDue, totalPaid, status } };
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
    if (allData.length === 0) {
        container.innerHTML = '<div class="pay-empty"><i class="fas fa-inbox"></i><p>등록된 재원생이 없습니다</p></div>';
        updateDashboard(allData);
        return;
    }

    let filtered = allData.filter(item => {
        if (currentPaymentFilter === 'unpaid') return item.summary.status === 'unpaid' || item.summary.status === 'partial';
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

    const order = { unpaid: 0, partial: 1, paid: 2, no_charge: 3 };
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
}

function updateDashboard(allData) {
    let totalDue = 0, totalPaid = 0, paidCount = 0, unpaidCount = 0;
    (allData || []).forEach(item => {
        totalDue += item.summary.totalDue;
        totalPaid += item.summary.totalPaid;
        if (item.summary.status === 'paid') paidCount++;
        else if (item.summary.status === 'unpaid' || item.summary.status === 'partial') unpaidCount++;
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
        unpaid:    { text: '미납', cls: 'pay-status-unpaid' },
        partial:   { text: '일부납', cls: 'pay-status-partial' },
        no_charge: { text: '청구없음', cls: 'pay-status-none' }
    };
    const st = statusMap[status] || statusMap.no_charge;
    const progressPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

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
                ${feeRow('tuition', '수강료', 'fa-book')}
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
                </div>
            </div>
        </div>`;
}

window.togglePaymentDetail = function(sid) {
    const card = document.getElementById(`payment-row-${sid}`);
    if (!card) return;
    const detail = card.querySelector('.pay-card-detail');
    const chevron = card.querySelector('.pay-chevron');
    detail.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate');
}

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
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const student = students.find(s => String(s.id) === String(sid));
    if (!student) return;
    const md = student.payments?.[monthKey] || {};
    const tuition = { amount: md.tuition?.amount ?? student.defaultFee ?? 0, date: md.tuition?.date || '' };
    const textbook = { amount: md.textbook?.amount ?? student.defaultTextbookFee ?? 0, date: md.textbook?.date || '' };
    const special = { amount: md.special?.amount ?? student.specialLectureFee ?? 0, date: md.special?.date || '' };
    const totalDue = (tuition.amount || 0) + (textbook.amount || 0) + (special.amount || 0);
    const totalPaid = (tuition.date ? (tuition.amount || 0) : 0) + (textbook.date ? (textbook.amount || 0) : 0) + (special.date ? (special.amount || 0) : 0);
    let status;
    if (totalDue === 0) status = 'no_charge';
    else if (totalPaid >= totalDue) status = 'paid';
    else if (totalPaid > 0) status = 'partial';
    else status = 'unpaid';
    const item = { student, monthKey, fees: { tuition, textbook, special }, summary: { totalDue, totalPaid, status } };
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

window.batchQuickPayAll = async function() {
    const year = currentPaymentDate.getFullYear();
    const month = currentPaymentDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const allData = buildPaymentData(monthKey);
    const unpaid = allData.filter(d => d.summary.status === 'unpaid' || d.summary.status === 'partial');
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
