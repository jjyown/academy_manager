// 학부모 포털 - report.js (전면 개편)
// ============================================================

// ========== Supabase 초기화 ==========
const SUPABASE_URL = 'https://jzcrpdeomjmytfekcgqu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// ========== State ==========
let currentStudent = null;
let html5QrcodeScanner = null;
let currentFacingMode = 'environment';
let teacherAuthList = [];
let authorizedTeacher = null;
let pendingEvaluationSave = false;
let currentTab = 'attendance';

// ========== Utilities ==========
function normalizePhone(v) { return String(v || '').replace(/\D/g, ''); }
function normalizeName(v) { return String(v || '').trim().toLowerCase(); }
function formatPhone(v) {
	const d = normalizePhone(v).slice(0, 11);
	if (d.length <= 3) return d;
	if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`;
	return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
}

function showAlert(msg, type) {
	const el = document.getElementById('landing-alert');
	if (!el) return;
	el.className = `landing-alert show ${type || 'info'}`;
	el.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>${msg}`;
	clearTimeout(el._timer);
	el._timer = setTimeout(() => { el.classList.remove('show'); }, 4000);
}

function getCurrentMonthStr() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function formatKoreanTime(timeStr) {
	if (!timeStr) return '-';
	const [h, m] = String(timeStr).split(':').map(Number);
	if (isNaN(h) || isNaN(m)) return String(timeStr).substring(0, 5);
	const base = new Date(2000, 0, 1, h, m);
	return base.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function getTimeLabel(record) {
	if (record.scheduled_time) return formatKoreanTime(record.scheduled_time);
	if (record.time) return formatKoreanTime(record.time);
	if (record.check_in_time) return new Date(record.check_in_time).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
	return '-';
}

function getStatusInfo(status) {
	switch(status) {
		case 'present': return { text: '출석', cls: 'present', icon: '✅' };
		case 'late': return { text: '지각', cls: 'late', icon: '⏰' };
		case 'makeup': case 'etc': return { text: '보강', cls: 'makeup', icon: '🔁' };
		default: return { text: '결석', cls: 'absent', icon: '❌' };
	}
}

function getDayOfWeek(dateStr) {
	const days = ['일','월','화','수','목','금','토'];
	return days[new Date(dateStr).getDay()];
}

// ========== Page Navigation ==========
function showDashboard() {
	const landing = document.getElementById('page-landing');
	const dashboard = document.getElementById('page-dashboard');
	landing.style.opacity = '0';
	landing.style.transition = 'opacity 0.2s ease';
	setTimeout(() => {
		landing.style.display = 'none';
		landing.style.opacity = '1';
		dashboard.style.display = 'block';
		dashboard.style.opacity = '0';
		dashboard.style.transition = 'opacity 0.3s ease';
		requestAnimationFrame(() => { dashboard.style.opacity = '1'; });
		window.scrollTo(0, 0);
	}, 200);
}

function goBackToLanding() {
	const landing = document.getElementById('page-landing');
	const dashboard = document.getElementById('page-dashboard');
	dashboard.style.opacity = '0';
	dashboard.style.transition = 'opacity 0.2s ease';
	setTimeout(() => {
		dashboard.style.display = 'none';
		dashboard.style.opacity = '1';
		landing.style.display = 'flex';
		landing.style.opacity = '0';
		landing.style.transition = 'opacity 0.3s ease';
		requestAnimationFrame(() => { landing.style.opacity = '1'; });
		currentStudent = null;
		// ★ sessionStorage에서 학생 정보 제거
		sessionStorage.removeItem('pp_current_student');
		window.scrollTo(0, 0);
	}, 200);
}
window.goBackToLanding = goBackToLanding;

// ========== Tab Switching ==========
function switchTab(tab) {
	currentTab = tab;
	document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
	document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
	
	const tabBtn = document.querySelector(`.dash-tab[onclick*="${tab}"]`);
	const tabPanel = document.getElementById(`tab-${tab}`);
	if (tabBtn) tabBtn.classList.add('active');
	if (tabPanel) tabPanel.classList.add('active');
}
window.switchTab = switchTab;

// ========== Search ==========
async function handleSearch() {
	const name = document.getElementById('search-name').value.trim();
	const phoneRaw = document.getElementById('search-phone').value.trim();
	const phoneDigits = normalizePhone(phoneRaw);

	if (!name || !phoneRaw) {
		showAlert('학생 이름과 전화번호를 모두 입력해주세요', 'info');
		return;
	}
	if (phoneDigits.length < 8) {
		showAlert('전화번호를 정확히 입력해주세요', 'info');
		return;
	}

	// Disable button
	const btn = document.querySelector('.btn-primary');
	if (btn) { btn.disabled = true; btn.innerHTML = '<div class="pp-spinner" style="width:20px;height:20px;border-width:2px;"></div>'; }

	try {
		const nameKey = normalizeName(name);
		let candidates = [];

		// 1) 이름으로 조회
		const { data: nameData, error: nameError } = await supabaseClient
			.from('students')
			.select('id, name, school, grade, phone, parent_phone, parent_code, owner_user_id, teacher_id, qr_code_data')
			.ilike('name', `%${name}%`);
		if (nameError) throw nameError;
		if (nameData?.length > 0) candidates = nameData;

		// 2) 이름 결과 없으면 전화번호로 보조 조회
		if (candidates.length === 0) {
			const formatted = formatPhone(phoneDigits);
			const orQuery = [
				`phone.ilike.%${phoneDigits}%`,
				`parent_phone.ilike.%${phoneDigits}%`,
				formatted ? `phone.ilike.%${formatted}%` : null,
				formatted ? `parent_phone.ilike.%${formatted}%` : null
			].filter(Boolean).join(',');

			const { data: phoneData, error: phoneError } = await supabaseClient
				.from('students')
			.select('id, name, school, grade, phone, parent_phone, parent_code, owner_user_id, teacher_id, qr_code_data')
			.or(orQuery);
			if (phoneError) throw phoneError;
			if (phoneData?.length > 0) candidates = phoneData;
		}

		// 매칭
		const matched = (candidates || []).find(s => {
			const sName = normalizeName(s.name);
			if (!sName.includes(nameKey)) return false;
			const phones = [normalizePhone(s.phone), normalizePhone(s.parent_phone)].filter(Boolean);
			return phones.some(p => p === phoneDigits || p.endsWith(phoneDigits) || phoneDigits.endsWith(p));
		});

		if (!matched) {
			showAlert('학생 정보를 찾을 수 없습니다. 이름과 전화번호를 확인해주세요.', 'error');
			return;
		}

		currentStudent = matched;
		await initDashboard();
	} catch (err) {
		console.error('검색 오류:', err);
		showAlert('검색 중 오류가 발생했습니다', 'error');
	} finally {
		if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> 조회하기'; }
	}
}
window.handleSearch = handleSearch;

// ========== QR Scanner ==========
let currentQRMode = 'camera';
let selectedQRFile = null;

function openQRScanner() {
	document.getElementById('qr-modal').classList.add('active');
	switchQRMode('camera');
}
window.openQRScanner = openQRScanner;

function closeQRScanner() {
	document.getElementById('qr-modal').classList.remove('active');
	stopQRScanner();
	resetQRFilePanel();
}
window.closeQRScanner = closeQRScanner;

function switchQRMode(mode) {
	currentQRMode = mode;
	// 탭 활성화
	document.getElementById('qr-tab-camera').classList.toggle('active', mode === 'camera');
	document.getElementById('qr-tab-image').classList.toggle('active', mode === 'image');
	// 패널 전환
	document.getElementById('qr-camera-panel').style.display = mode === 'camera' ? '' : 'none';
	document.getElementById('qr-image-panel').style.display = mode === 'image' ? '' : 'none';

	if (mode === 'camera') {
		startQRScanner();
	} else {
		stopQRScanner();
	}
}
window.switchQRMode = switchQRMode;

async function startQRScanner() {
	if (html5QrcodeScanner) { try { await html5QrcodeScanner.stop(); } catch(e){} html5QrcodeScanner = null; }
	try {
		html5QrcodeScanner = new Html5Qrcode('qr-reader');
		await html5QrcodeScanner.start(
			{ facingMode: currentFacingMode },
			{ fps: 10, qrbox: { width: 250, height: 250 } },
			onQRSuccess, () => {}
		);
	} catch(e) {
		console.error('QR 스캔 오류:', e);
		ppShowToast('카메라를 사용할 수 없습니다', 'error');
	}
}

function stopQRScanner() {
	if (html5QrcodeScanner) {
		html5QrcodeScanner.stop().catch(()=>{});
		html5QrcodeScanner = null;
	}
}

function toggleCamera() {
	currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
	startQRScanner();
}
window.toggleCamera = toggleCamera;

// ========== QR 이미지 파일 스캔 ==========
function resetQRFilePanel() {
	selectedQRFile = null;
	const fileInput = document.getElementById('qr-file-input');
	if (fileInput) fileInput.value = '';
	const preview = document.getElementById('qr-preview-area');
	const dropContent = document.getElementById('qr-drop-content');
	const scanBtn = document.getElementById('qr-scan-file-btn');
	const status = document.getElementById('qr-file-status');
	if (preview) preview.style.display = 'none';
	if (dropContent) dropContent.style.display = '';
	if (scanBtn) scanBtn.style.display = 'none';
	if (status) status.style.display = 'none';
}

function handleQRFileSelect(event) {
	const file = event.target.files?.[0];
	if (!file) return;
	if (!file.type.startsWith('image/')) {
		ppShowToast('이미지 파일만 선택 가능합니다', 'error');
		return;
	}

	selectedQRFile = file;
	showQRFilePreview(file);

	// 이미지 선택 즉시 자동 스캔 시작
	scanQRFromFile();
}
window.handleQRFileSelect = handleQRFileSelect;

function showQRFilePreview(file) {
	const reader = new FileReader();
	reader.onload = function(e) {
		const img = document.getElementById('qr-preview-img');
		const previewArea = document.getElementById('qr-preview-area');
		const dropContent = document.getElementById('qr-drop-content');
		const scanBtn = document.getElementById('qr-scan-file-btn');

		if (img) img.src = e.target.result;
		if (previewArea) previewArea.style.display = 'block';
		if (dropContent) dropContent.style.display = 'none';
		if (scanBtn) scanBtn.style.display = '';
	};
	reader.readAsDataURL(file);
}

async function scanQRFromFile() {
	if (!selectedQRFile) {
		ppShowToast('이미지를 먼저 선택해주세요', 'info');
		return;
	}

	const statusEl = document.getElementById('qr-file-status');
	statusEl.style.display = 'flex';
	statusEl.className = 'qr-file-status processing';
	statusEl.innerHTML = '<div class="pp-spinner" style="width:18px;height:18px;border-width:2px;flex-shrink:0;"></div> QR 코드 인식 중...';

	try {
		// html5-qrcode의 scanFile 메서드 사용
		const scanner = new Html5Qrcode('qr-file-scan-temp');
		const decoded = await scanner.scanFile(selectedQRFile, /* showImage */ false);
		try { scanner.clear(); } catch(_) {}

		statusEl.className = 'qr-file-status success';
		statusEl.innerHTML = '<i class="fas fa-check-circle"></i> QR 코드 인식 성공! 학생 정보를 조회합니다...';

		// 인식 성공 → 기존 QR 처리 로직 호출
		await onQRSuccess(decoded);
	} catch(e) {
		console.error('QR 이미지 인식 오류:', e);
		statusEl.className = 'qr-file-status error';
		statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> QR 코드를 인식할 수 없습니다. 다른 이미지를 시도해주세요.';
	}
}
window.scanQRFromFile = scanQRFromFile;

async function onQRSuccess(decoded) {
	const match = decoded.match(/STUDENT_(\d+)_/);
	if (!match) { ppShowToast('유효한 QR 코드가 아닙니다', 'error'); return; }

	const studentId = match[1];
	const token = decoded.split('_').slice(2).join('_');

	try {
		const { data: student, error } = await supabaseClient
			.from('students')
			.select('id, name, school, grade, phone, parent_phone, parent_code, owner_user_id, teacher_id, qr_code_data')
			.eq('id', studentId)
			.maybeSingle();
		if (error) throw error;
		if (!student) { ppShowToast('등록되지 않은 학생입니다', 'error'); return; }
		if (student.qr_code_data && token && student.qr_code_data !== token) {
			ppShowToast('유효하지 않은 QR 코드입니다', 'error'); return;
		}

		currentStudent = student;
		closeQRScanner();
		await initDashboard();
		ppShowToast(`${student.name} 학생 조회 완료`, 'success');
	} catch(e) {
		console.error('QR 처리 오류:', e);
		ppShowToast('QR 처리 중 오류가 발생했습니다', 'error');
	}
}

// ========== Dashboard Init ==========
async function initDashboard() {
	if (!currentStudent) return;

	// ★ sessionStorage에 학생 정보 저장 (새로고침 시 복원용)
	try {
		sessionStorage.setItem('pp_current_student', JSON.stringify(currentStudent));
	} catch (e) { /* 무시 */ }

	// Update header
	document.getElementById('dash-avatar').textContent = (currentStudent.name || '?').charAt(0);
	document.getElementById('dash-name').textContent = currentStudent.name;
	document.getElementById('dash-grade').textContent = currentStudent.grade || '-';
	document.getElementById('dash-school').textContent = currentStudent.school || '-';

	// Set month selectors
	const monthStr = getCurrentMonthStr();
	document.getElementById('month-selector').value = monthStr;
	document.getElementById('eval-month-selector').value = monthStr;

	showDashboard();

	// Load data
	switchTab('attendance');
	await Promise.all([
		loadQuickStats(),
		loadMonthlyAttendance(monthStr),
		loadEvaluationState(monthStr)
	]);
}

// ========== Quick Stats (최근 30일) ==========
async function loadQuickStats() {
	if (!currentStudent) return;
	try {
		const thirtyAgo = new Date();
		thirtyAgo.setDate(thirtyAgo.getDate() - 30);
		const isoDate = thirtyAgo.toISOString().split('T')[0];

		const { data, error } = await supabaseClient
			.from('attendance_records')
			.select('status, attendance_date')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', isoDate);
		if (error) throw error;

		const stats = { present: 0, late: 0, absent: 0, total: 0 };
		// 날짜별 최신 기록만 사용
		const byDate = {};
		(data || []).forEach(r => {
			const key = r.attendance_date;
			if (!byDate[key]) byDate[key] = r;
		});
		Object.values(byDate).forEach(r => {
			stats.total++;
			if (r.status === 'present' || r.status === 'makeup' || r.status === 'etc') stats.present++;
			else if (r.status === 'late') stats.late++;
			else stats.absent++;
		});

		const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
		document.getElementById('qs-rate').textContent = `${rate}%`;
		document.getElementById('qs-present').textContent = stats.present;
		document.getElementById('qs-late').textContent = stats.late;
		document.getElementById('qs-absent').textContent = stats.absent;
	} catch(e) { console.error('통계 오류:', e); }
}

// ========== Monthly Attendance ==========
async function loadMonthlyAttendance(monthStr) {
	if (!currentStudent) return;
	// 선생님 목록이 아직 로드 안됐으면 대기 (호버 툴팁에 이름 필요)
	if (teacherAuthList.length === 0) {
		try { await loadTeacherAuthList(); } catch(e) { /* 무시 */ }
	}
	const listEl = document.getElementById('att-list');
	// 스켈레톤 로딩
	let skeletonHtml = '';
	for (let i = 0; i < 4; i++) {
		skeletonHtml += `<div class="skeleton-row">
			<div style="min-width:52px;"><div class="skeleton-block" style="width:32px;height:22px;margin-bottom:4px;"></div><div class="skeleton-block" style="width:40px;height:12px;"></div></div>
			<div style="flex:1;"><div class="skeleton-block" style="width:80px;height:14px;margin-bottom:4px;"></div><div class="skeleton-block" style="width:120px;height:10px;"></div></div>
			<div class="skeleton-block" style="width:52px;height:24px;border-radius:20px;"></div>
		</div>`;
	}
	listEl.innerHTML = skeletonHtml;

	try {
		const [year, month] = monthStr.split('-');
		const startDate = `${year}-${month}-01`;
		const lastDay = new Date(year, month, 0).getDate();
		const endDate = `${year}-${month}-${lastDay}`;

		const { data: records, error } = await supabaseClient
			.from('attendance_records')
			.select('id, student_id, teacher_id, attendance_date, status, scheduled_time, check_in_time, qr_scanned, qr_scan_time, memo, shared_memo')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', startDate)
			.lte('attendance_date', endDate)
			.order('attendance_date', { ascending: false });
		if (error) throw error;

		// 날짜별 그룹
		const byDate = new Map();
		(records || []).forEach(r => {
			const key = r.attendance_date;
			if (!byDate.has(key)) byDate.set(key, []);
			byDate.get(key).push(r);
		});

		// 월 통계 계산
		const stats = { present: 0, late: 0, absent: 0, total: 0 };
		const dateKeys = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

		dateKeys.forEach(dateKey => {
			const recs = byDate.get(dateKey);
			// 담당 선생님 기록 우선
			const primaryTid = currentStudent.teacher_id ? String(currentStudent.teacher_id) : '';
			const primary = recs.find(r => primaryTid && String(r.teacher_id) === primaryTid);
			const display = primary || recs[0];
			if (!display) return;

			stats.total++;
			if (display.status === 'present' || display.status === 'makeup' || display.status === 'etc') stats.present++;
			else if (display.status === 'late') stats.late++;
			else stats.absent++;
		});

		const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
		document.getElementById('ms-rate').textContent = `${rate}%`;
		document.getElementById('ms-present').textContent = stats.present;
		document.getElementById('ms-late').textContent = stats.late;
		document.getElementById('ms-absent').textContent = stats.absent;

		// Render list
		if (dateKeys.length === 0) {
			listEl.innerHTML = `<div class="att-empty"><i class="fas fa-calendar-xmark"></i>${year}년 ${parseInt(month)}월 출결 기록이 없습니다</div>`;
			return;
		}

		// 선생님 이름 매핑 함수
		function getTeacherName(tid) {
			if (!tid) return '알 수 없음';
			const t = teacherAuthList.find(x => String(x.id) === String(tid));
			return t ? t.name : '선생님';
		}

		let html = '';
		dateKeys.forEach(dateKey => {
			const recs = byDate.get(dateKey);
			const primaryTid = currentStudent.teacher_id ? String(currentStudent.teacher_id) : '';
			const primary = recs.find(r => primaryTid && String(r.teacher_id) === primaryTid);
			const display = primary || recs[0];
			if (!display) return;

			const d = new Date(dateKey);
			const dayNum = d.getDate();
			const dow = getDayOfWeek(dateKey);
			const dayOfWeek = d.getDay(); // 0=일, 6=토
			const dowClass = dayOfWeek === 0 ? ' dow-sun' : dayOfWeek === 6 ? ' dow-sat' : '';
			const time = getTimeLabel(display);
			const si = getStatusInfo(display.status);
			const stClass = si.cls === 'present' ? 'st-present' : si.cls === 'late' ? 'st-late' : si.cls === 'absent' ? 'st-absent' : 'st-makeup';
			const memo = display.shared_memo ? display.shared_memo.substring(0, 30) : '';

			// ★ QR 스캔 시간 표시
			let qrLabel = '';
			if (display.qr_scanned && display.qr_scan_time) {
				const scanTime = new Date(display.qr_scan_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
				qrLabel = `<div class="att-qr-tag"><i class="fas fa-qrcode"></i> ${scanTime} 스캔</div>`;
			}

			// ★ 같은 날짜에 다른 선생님 기록이 있으면 호버 툴팁 생성
			const otherRecs = recs.filter(r => r !== display);
			const hasMultiple = otherRecs.length > 0;
			let tooltipHtml = '';
			if (hasMultiple) {
				const displayTName = getTeacherName(display.teacher_id);
				const displayTime = getTimeLabel(display);
				const displaySi = getStatusInfo(display.status);
				let items = `<div class="pp-tooltip-item pp-tooltip-primary"><span class="pp-tooltip-name primary">${displayTName}</span><span class="pp-tooltip-time">${displayTime}</span><span class="pp-tooltip-badge" style="background:${displaySi.cls === 'present' ? '#10b981' : displaySi.cls === 'late' ? '#f59e0b' : displaySi.cls === 'absent' ? '#ef4444' : '#8b5cf6'}">${displaySi.text}</span></div>`;

				otherRecs.forEach(r => {
					const tName = getTeacherName(r.teacher_id);
					const tTime = getTimeLabel(r);
					const tSi = getStatusInfo(r.status);
					items += `<div class="pp-tooltip-item"><span class="pp-tooltip-name">${tName}</span><span class="pp-tooltip-time">${tTime}</span><span class="pp-tooltip-badge" style="background:${tSi.cls === 'present' ? '#10b981' : tSi.cls === 'late' ? '#f59e0b' : tSi.cls === 'absent' ? '#ef4444' : '#8b5cf6'}">${tSi.text}</span></div>`;
				});

				const shortDate = `${d.getMonth()+1}/${dayNum}`;
				tooltipHtml = `<div class="pp-att-tooltip">\n<div class="pp-tooltip-header">${shortDate} 전체 일정</div>\n${items}\n<div class="pp-tooltip-arrow"></div>\n</div>`;
			}

			html += `<div class="att-day ${stClass}${hasMultiple ? ' has-tooltip' : ''}">
				${tooltipHtml}
				<div class="att-date-col">
					<div class="att-date-num">${dayNum}</div>
					<div class="att-date-dow${dowClass}">${dow}요일</div>
				</div>
				<div class="att-mid">
					<div class="att-time">${time}</div>
					${qrLabel}
					${memo ? `<div class="att-memo-preview"><i class="fas fa-comment" style="font-size:9px;margin-right:3px;opacity:0.5;"></i>${memo}${display.shared_memo.length > 30 ? '...' : ''}</div>` : ''}
				</div>
				<div class="att-badge ${si.cls}">${si.icon} ${si.text}</div>
			</div>`;
		});

		listEl.innerHTML = html;

		// ★ 호버/터치 이벤트로 툴팁 표시
		listEl.querySelectorAll('.att-day.has-tooltip').forEach(row => {
			const tooltip = row.querySelector('.pp-att-tooltip');
			if (!tooltip) return;
			row.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
			row.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
			row.addEventListener('click', (e) => {
				if (e.target.closest('select')) return;
				e.stopPropagation();
				const isVisible = tooltip.style.display === 'block';
				// 다른 툴팁 모두 닫기
				listEl.querySelectorAll('.pp-att-tooltip').forEach(t => { t.style.display = 'none'; });
				tooltip.style.display = isVisible ? 'none' : 'block';
			});
		});
		// 외부 클릭 시 툴팁 닫기 (한 번만 등록)
		if (!listEl._tooltipCloseRegistered) {
			document.addEventListener('click', () => {
				document.querySelectorAll('.pp-att-tooltip').forEach(t => { t.style.display = 'none'; });
			});
			listEl._tooltipCloseRegistered = true;
		}
	} catch(e) {
		console.error('출결 조회 오류:', e);
		listEl.innerHTML = '<div class="att-empty"><i class="fas fa-exclamation-triangle"></i>출결 기록을 불러올 수 없습니다</div>';
	}
}

// ========== Month Navigation (Attendance) ==========
function handleMonthChange() {
	const v = document.getElementById('month-selector').value;
	if (v && currentStudent) loadMonthlyAttendance(v);
}
window.handleMonthChange = handleMonthChange;

function handlePrevMonth() {
	const el = document.getElementById('month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let pm = m - 1, py = y;
	if (pm < 1) { pm = 12; py--; }
	el.value = `${py}-${String(pm).padStart(2,'0')}`;
	handleMonthChange();
}
window.handlePrevMonth = handlePrevMonth;

function handleNextMonth() {
	const el = document.getElementById('month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let nm = m + 1, ny = y;
	if (nm > 12) { nm = 1; ny++; }
	el.value = `${ny}-${String(nm).padStart(2,'0')}`;
	handleMonthChange();
}
window.handleNextMonth = handleNextMonth;

// ========== Memos ==========
async function loadMemos(monthStr) {
	if (!currentStudent) return;
	const listEl = document.getElementById('memo-list');
	let memoSkel = '';
	for (let i = 0; i < 3; i++) {
		memoSkel += `<div style="padding:16px;background:var(--bg-elevated);border-radius:12px;border-left:3px solid var(--border);">
			<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><div class="skeleton-block" style="width:100px;height:14px;"></div><div class="skeleton-block" style="width:40px;height:18px;border-radius:6px;"></div></div>
			<div class="skeleton-block" style="width:100%;height:12px;margin-bottom:6px;"></div>
			<div class="skeleton-block" style="width:70%;height:12px;"></div>
		</div>`;
	}
	listEl.innerHTML = memoSkel;

	try {
		const [year, month] = monthStr.split('-');
		const startDate = `${year}-${month}-01`;
		const lastDay = new Date(year, month, 0).getDate();
		const endDate = `${year}-${month}-${lastDay}`;

		const { data, error } = await supabaseClient
			.from('attendance_records')
			.select('attendance_date, status, scheduled_time, shared_memo, teacher_id')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', startDate)
			.lte('attendance_date', endDate)
			.order('attendance_date', { ascending: false });
		if (error) throw error;

		// shared_memo가 있는 기록만 필터
		const withMemo = (data || []).filter(r => r.shared_memo && r.shared_memo.trim());

		if (withMemo.length === 0) {
			listEl.innerHTML = `<div class="memo-empty"><i class="fas fa-sticky-note"></i>${year}년 ${parseInt(month)}월 수업 메모가 없습니다</div>`;
			return;
		}

		let html = '';
		withMemo.forEach(r => {
			const d = new Date(r.attendance_date);
			const dateLabel = `${d.getMonth()+1}/${d.getDate()} (${getDayOfWeek(r.attendance_date)})`;
			const si = getStatusInfo(r.status);
			const time = r.scheduled_time ? formatKoreanTime(r.scheduled_time) : '';

			html += `<div class="memo-card">
				<div class="memo-card-header">
					<span class="memo-card-date"><i class="fas fa-calendar-day"></i>${dateLabel}${time ? ' ' + time : ''}</span>
					<span class="memo-card-badge att-badge ${si.cls}" style="font-size:10px;padding:2px 8px;">${si.text}</span>
				</div>
				<div class="memo-card-text">${r.shared_memo}</div>
			</div>`;
		});

		listEl.innerHTML = html;
	} catch(e) {
		console.error('메모 조회 오류:', e);
		listEl.innerHTML = '<div class="memo-empty"><i class="fas fa-exclamation-triangle"></i>메모를 불러올 수 없습니다</div>';
	}
}

function handleMemoMonthChange() {
	const v = document.getElementById('memo-month-selector').value;
	if (v && currentStudent) loadMemos(v);
}
window.handleMemoMonthChange = handleMemoMonthChange;

function handlePrevMonthMemo() {
	const el = document.getElementById('memo-month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let pm = m-1, py = y; if(pm<1){pm=12;py--;}
	el.value = `${py}-${String(pm).padStart(2,'0')}`;
	handleMemoMonthChange();
}
window.handlePrevMonthMemo = handlePrevMonthMemo;

function handleNextMonthMemo() {
	const el = document.getElementById('memo-month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let nm = m+1, ny = y; if(nm>12){nm=1;ny++;}
	el.value = `${ny}-${String(nm).padStart(2,'0')}`;
	handleMemoMonthChange();
}
window.handleNextMonthMemo = handleNextMonthMemo;

// ========== Evaluation ==========
function isParentVerified() {
	if (!currentStudent) return false;
	return sessionStorage.getItem(`parent_verified__${currentStudent.id}`) === 'true';
}

function setParentVerified() {
	if (!currentStudent) return;
	sessionStorage.setItem(`parent_verified__${currentStudent.id}`, 'true');
}

async function loadEvaluationState(monthStr) {
	updateEvalLockUI();
	if (isParentVerified()) {
		await loadEvaluation(monthStr);
	}
}

function updateEvalLockUI() {
	const lock = document.getElementById('eval-lock');
	const content = document.getElementById('eval-content');
	if (isParentVerified()) {
		lock.style.display = 'none';
		content.classList.add('visible');
	} else {
		lock.style.display = '';
		content.classList.remove('visible');
	}
}

async function loadEvaluation(monthStr) {
	if (!currentStudent || !isParentVerified()) return;
	const target = monthStr || document.getElementById('eval-month-selector')?.value;
	if (!target) return;

	const [y, m] = target.split('-');
	document.getElementById('eval-month-label').textContent = `${y}년 ${parseInt(m)}월 종합 평가`;

	try {
		const { data, error } = await supabaseClient
			.from('student_evaluations')
			.select('comment')
			.eq('student_id', currentStudent.id)
			.eq('eval_month', target)
			.maybeSingle();
		if (error && error.code !== 'PGRST116') throw error;

		const textarea = document.getElementById('eval-textarea');
		textarea.value = data?.comment || '';
		updateEvalCharCount();

		// 선생님 인증 여부에 따라 수정 가능 여부 결정
		const teacher = getAuthorizedTeacher();
		if (teacher) {
			textarea.readOnly = false;
			textarea.placeholder = '학생에 대한 종합 평가를 작성하세요 (최대 500자)';
			document.getElementById('eval-save-row').style.display = 'flex';
			document.querySelector('.eval-hint').textContent = `${teacher.name} 선생님으로 수정 가능`;
		} else {
			textarea.readOnly = true;
			textarea.placeholder = '이번 달 종합 평가가 아직 작성되지 않았습니다.';
			document.getElementById('eval-save-row').style.display = 'none';
			document.querySelector('.eval-hint').textContent = '읽기 전용';
		}
	} catch(e) {
		console.error('평가 로드 오류:', e);
	}
}

function updateEvalCharCount() {
	const ta = document.getElementById('eval-textarea');
	const cnt = document.getElementById('eval-char-count');
	if (ta && cnt) cnt.textContent = ta.value.length;
}

function handleEvalMonthChange() {
	const v = document.getElementById('eval-month-selector').value;
	if (v && currentStudent) {
		loadEvaluation(v);
	}
}
window.handleEvalMonthChange = handleEvalMonthChange;

function handlePrevMonthEval() {
	const el = document.getElementById('eval-month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let pm = m-1, py = y; if(pm<1){pm=12;py--;}
	el.value = `${py}-${String(pm).padStart(2,'0')}`;
	handleEvalMonthChange();
}
window.handlePrevMonthEval = handlePrevMonthEval;

function handleNextMonthEval() {
	const el = document.getElementById('eval-month-selector');
	const [y, m] = el.value.split('-').map(Number);
	let nm = m+1, ny = y; if(nm>12){nm=1;ny++;}
	el.value = `${ny}-${String(nm).padStart(2,'0')}`;
	handleEvalMonthChange();
}
window.handleNextMonthEval = handleNextMonthEval;

// ========== Parent Auth ==========
function openParentAuthModal() {
	// 인증코드 미발급 체크
	if (currentStudent && !currentStudent.parent_code) {
		ppShowToast('인증코드가 발급되지 않았습니다. 선생님에게 요청하세요.', 'warning');
		return;
	}
	document.getElementById('parent-auth-modal').classList.add('active');
	const input = document.getElementById('parent-auth-password');
	if (input) { input.value = ''; setTimeout(() => input.focus(), 200); }
	// 실패 메시지 초기화
	const failMsg = document.getElementById('parent-auth-fail-msg');
	if (failMsg) failMsg.style.display = 'none';
	// 버튼 활성화
	const btn = document.getElementById('parent-auth-btn');
	if (btn) { btn.disabled = false; btn.style.opacity = ''; }
}
window.openParentAuthModal = openParentAuthModal;

function closeParentAuthModal() {
	document.getElementById('parent-auth-modal').classList.remove('active');
}
window.closeParentAuthModal = closeParentAuthModal;

async function handleParentAuth() {
	if (!currentStudent) return;
	const code = document.getElementById('parent-auth-password')?.value.trim();
	if (!code) { ppShowToast('인증코드를 입력해주세요', 'info'); return; }

	const expected = currentStudent.parent_code;
	if (!expected) {
		ppShowToast('인증코드가 발급되지 않았습니다. 선생님에게 요청하세요.', 'warning');
		return;
	}

	// 실패 횟수 체크
	const failKey = `parent_auth_fail__${currentStudent.id}`;
	const failCount = parseInt(sessionStorage.getItem(failKey) || '0');
	if (failCount >= 5) {
		const failMsg = document.getElementById('parent-auth-fail-msg');
		if (failMsg) { failMsg.textContent = '인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.'; failMsg.style.display = 'block'; }
		return;
	}

	if (code !== expected) {
		const newFail = failCount + 1;
		sessionStorage.setItem(failKey, String(newFail));
		const remaining = 5 - newFail;
		const failMsg = document.getElementById('parent-auth-fail-msg');
		if (remaining <= 0) {
			if (failMsg) { failMsg.textContent = '인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.'; failMsg.style.display = 'block'; }
			const btn = document.getElementById('parent-auth-btn');
			if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
			// 3분 후 자동 해제
			setTimeout(() => { sessionStorage.removeItem(failKey); if (btn) { btn.disabled = false; btn.style.opacity = ''; } if (failMsg) failMsg.style.display = 'none'; }, 180000);
		} else {
			if (failMsg) { failMsg.textContent = `인증코드가 일치하지 않습니다. (${remaining}회 남음)`; failMsg.style.display = 'block'; }
		}
		ppShowToast('인증코드가 일치하지 않습니다', 'error');
		return;
	}

	// 성공 - 실패 횟수 초기화
	sessionStorage.removeItem(failKey);
	setParentVerified();
	closeParentAuthModal();
	updateEvalLockUI();
	const monthStr = document.getElementById('eval-month-selector')?.value;
	if (monthStr) await loadEvaluation(monthStr);
	ppShowToast('학부모 인증 완료', 'success');
}
window.handleParentAuth = handleParentAuth;

// ========== Teacher Auth ==========
async function hashPin(pin) {
	const enc = new TextEncoder().encode(pin);
	const hash = await crypto.subtle.digest('SHA-256', enc);
	return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function loadTeacherAuthList() {
	try {
		const { data, error } = await supabaseClient
			.from('teachers')
			.select('id, name, pin_hash, owner_user_id')
			.order('created_at', { ascending: true });
		if (error) throw error;
		teacherAuthList = data || [];

		const select = document.getElementById('teacher-auth-select');
		if (select) {
			select.innerHTML = '<option value="">선생님 선택</option>';
			teacherAuthList.forEach(t => {
				const opt = document.createElement('option');
				opt.value = t.id;
				opt.textContent = t.name;
				select.appendChild(opt);
			});
		}
	} catch(e) { console.error('선생님 목록 오류:', e); }
}

function getAuthorizedTeacher() {
	if (authorizedTeacher) return authorizedTeacher;
	const storedId = sessionStorage.getItem('parent_portal_teacher_id');
	if (!storedId) return null;
	return teacherAuthList.find(t => String(t.id) === String(storedId)) || null;
}

function openTeacherAuthModal() {
	document.getElementById('admin-auth-modal').classList.add('active');
	loadTeacherAuthList();
}
window.openTeacherAuthModal = openTeacherAuthModal;

function closeTeacherAuthModal() {
	document.getElementById('admin-auth-modal').classList.remove('active');
	const pw = document.getElementById('teacher-auth-password');
	if (pw) pw.value = '';
}
window.closeTeacherAuthModal = closeTeacherAuthModal;

async function handleTeacherAuth() {
	const teacherId = document.getElementById('teacher-auth-select')?.value;
	const password = document.getElementById('teacher-auth-password')?.value.trim();
	if (!teacherId) { ppShowToast('선생님을 선택해주세요', 'info'); return; }
	if (!password) { ppShowToast('비밀번호를 입력해주세요', 'info'); return; }

	const teacher = teacherAuthList.find(t => String(t.id) === String(teacherId));
	if (!teacher) { ppShowToast('선생님을 찾을 수 없습니다', 'error'); return; }

	try {
		const inputHash = await hashPin(password);
		if (inputHash !== teacher.pin_hash) {
			ppShowToast('비밀번호가 일치하지 않습니다', 'error');
			return;
		}
		authorizedTeacher = teacher;
		sessionStorage.setItem('parent_portal_teacher_id', teacher.id);
		closeTeacherAuthModal();
		ppShowToast('선생님 인증 완료', 'success');

		// 평가 수정 가능 상태로 전환
		const monthStr = document.getElementById('eval-month-selector')?.value;
		if (monthStr) await loadEvaluation(monthStr);

		if (pendingEvaluationSave) {
			pendingEvaluationSave = false;
			await saveEvaluation();
		}
	} catch(e) {
		console.error('선생님 인증 오류:', e);
		ppShowToast('인증에 실패했습니다', 'error');
	}
}
window.handleTeacherAuth = handleTeacherAuth;

// ========== Save Evaluation ==========
async function saveEvaluation() {
	if (!currentStudent) return;
	const comment = document.getElementById('eval-textarea').value.trim();
	const monthStr = document.getElementById('eval-month-selector')?.value;
	if (!monthStr) { ppShowToast('월을 선택해주세요', 'info'); return; }

	const teacher = getAuthorizedTeacher();
	if (!teacher) {
		pendingEvaluationSave = true;
		openTeacherAuthModal();
		return;
	}

	try {
		const { error } = await supabaseClient
			.from('student_evaluations')
			.upsert({
				student_id: currentStudent.id,
				eval_month: monthStr,
				owner_user_id: teacher.owner_user_id || null,
				teacher_id: teacher.id,
				comment: comment,
				updated_at: new Date().toISOString()
			}, { onConflict: 'student_id,eval_month' });
		if (error) throw error;
		ppShowToast('평가가 저장되었습니다', 'success');
	} catch(e) {
		console.error('평가 저장 오류:', e);
		ppShowToast('저장에 실패했습니다', 'error');
	}
}
window.saveEvaluation = saveEvaluation;

async function resetEvaluation() {
	document.getElementById('eval-textarea').value = '';
	updateEvalCharCount();
}
window.resetEvaluation = resetEvaluation;

// ========== Event Listeners ==========
document.addEventListener('DOMContentLoaded', () => {
	// ★ 새로고침 시 sessionStorage에서 학생 정보 복원
	try {
		const saved = sessionStorage.getItem('pp_current_student');
		if (saved) {
			const parsed = JSON.parse(saved);
			if (parsed && parsed.id) {
				currentStudent = parsed;
				// 즉시 대시보드 표시 (페이드 애니메이션 없이)
				document.getElementById('page-landing').style.display = 'none';
				document.getElementById('page-dashboard').style.display = 'block';
				document.getElementById('page-dashboard').style.opacity = '1';
				// 헤더 정보 설정
				document.getElementById('dash-avatar').textContent = (currentStudent.name || '?').charAt(0);
				document.getElementById('dash-name').textContent = currentStudent.name;
				document.getElementById('dash-grade').textContent = currentStudent.grade || '-';
				document.getElementById('dash-school').textContent = currentStudent.school || '-';
				// 월 선택기 설정
				const monthStr = getCurrentMonthStr();
				document.getElementById('month-selector').value = monthStr;
				document.getElementById('eval-month-selector').value = monthStr;
				// 데이터 로드
				switchTab('attendance');
				Promise.all([
					loadQuickStats(),
					loadMonthlyAttendance(monthStr),
					loadEvaluationState(monthStr)
				]).catch(e => console.error('[복원] 데이터 로드 실패:', e));
			}
		}
	} catch (e) {
		console.error('[복원] sessionStorage 파싱 실패:', e);
	}

	// Enter key search
	['search-name', 'search-phone'].forEach(id => {
		const el = document.getElementById(id);
		if (el) el.addEventListener('keypress', e => { if (e.key === 'Enter') handleSearch(); });
	});

	// Phone auto-format
	const phoneInput = document.getElementById('search-phone');
	if (phoneInput) {
		phoneInput.addEventListener('input', e => {
			const formatted = formatPhone(e.target.value);
			if (e.target.value !== formatted) e.target.value = formatted;
		});
	}

	// Eval char count
	const evalTa = document.getElementById('eval-textarea');
	if (evalTa) evalTa.addEventListener('input', updateEvalCharCount);

	// Parent auth Enter key
	const parentPw = document.getElementById('parent-auth-password');
	if (parentPw) parentPw.addEventListener('keypress', e => { if (e.key === 'Enter') handleParentAuth(); });

	// Teacher auth Enter key
	const teacherPw = document.getElementById('teacher-auth-password');
	if (teacherPw) teacherPw.addEventListener('keypress', e => { if (e.key === 'Enter') handleTeacherAuth(); });

	// Modal outside click
	['qr-modal', 'parent-auth-modal', 'admin-auth-modal'].forEach(id => {
		const el = document.getElementById(id);
		if (el) el.addEventListener('click', e => {
			if (e.target === el) {
				el.classList.remove('active');
				if (id === 'qr-modal') stopQRScanner();
			}
		});
	});

	// ESC key
	document.addEventListener('keydown', e => {
		if (e.key === 'Escape') {
			closeQRScanner();
			closeParentAuthModal();
			closeTeacherAuthModal();
		}
	});

	// QR 이미지 드래그 앤 드롭
	const dropZone = document.getElementById('qr-drop-zone');
	if (dropZone) {
		['dragenter', 'dragover'].forEach(evt => {
			dropZone.addEventListener(evt, e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.add('dragover');
			});
		});
		['dragleave', 'drop'].forEach(evt => {
			dropZone.addEventListener(evt, e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.remove('dragover');
			});
		});
		dropZone.addEventListener('drop', e => {
			const file = e.dataTransfer?.files?.[0];
			if (file && file.type.startsWith('image/')) {
				selectedQRFile = file;
				showQRFilePreview(file);
				scanQRFromFile();
			} else {
				ppShowToast('이미지 파일만 지원됩니다', 'error');
			}
		});
	}

	// Pre-load teacher list
	loadTeacherAuthList();
});

window.addEventListener('beforeunload', () => { stopQRScanner(); });
