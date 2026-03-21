// 학부모 포털 - report.js (전면 개편)
// ============================================================

// ========== Supabase 초기화 ==========
function resolveRuntimeSupabaseConfig() {
	const env = (typeof window !== 'undefined' && window.env) ? window.env : {};
	const ls = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null;
	const fromStorageUrl = ls ? (ls.getItem('academy_supabase_url') || ls.getItem('REACT_APP_SUPABASE_URL')) : '';
	const fromStorageKey = ls ? (ls.getItem('academy_supabase_anon_key') || ls.getItem('REACT_APP_SUPABASE_ANON_KEY')) : '';
	return {
		url: String(
			env.REACT_APP_SUPABASE_URL ||
			fromStorageUrl ||
			'https://jzcrpdeomjmytfekcgqu.supabase.co'
		).trim(),
		key: String(
			env.REACT_APP_SUPABASE_ANON_KEY ||
			fromStorageKey ||
			'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu'
		).trim()
	};
}

const runtimeSupabase = resolveRuntimeSupabaseConfig();
const SUPABASE_URL = runtimeSupabase.url;
const SUPABASE_ANON_KEY = runtimeSupabase.key;
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// ========== State ==========
let currentStudent = null;
let teacherAuthList = [];
let authorizedTeacher = null;
let pendingEvaluationSave = false;
let currentTab = 'attendance';

// ========== Admin State ==========
let isAdminMode = false;
let adminUser = null;
let adminTeacher = null;
let adminStudents = [];

// ========== Attendance Calendar State ==========
let attYear = new Date().getFullYear();
let attMonth = new Date().getMonth(); // 0-indexed
let attDateStatus = {}; // { dateStr: { status, records } }
let attAllRecords = []; // raw records for the month
let attSelectedDate = null;

// ========== Homework State ==========
let hwYear = new Date().getFullYear();
let hwMonth = new Date().getMonth(); // 0-indexed
let hwSubmissions = [];
let hwSchedules = [];
let hwDateStatus = {};
let hwSelectedDate = null;
let hwLoaded = false;

// ========== Utilities ==========

function showAlert(msg, type) {
	const el = document.getElementById('landing-alert');
	if (!el) return;
	el.className = `landing-alert show ${type || 'info'}`;
	el.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>${escapeHtml(msg)}`;
	clearTimeout(el._timer);
	el._timer = setTimeout(() => { el.classList.remove('show'); }, 4000);
}

function normalizeParentPortalCode(value) {
	const src = String(value || '').trim();
	if (!src) return '';
	let out = '';
	for (const ch of src) {
		const code = ch.charCodeAt(0);
		// Full-width digits/letters -> ASCII
		if (code >= 0xFF10 && code <= 0xFF19) {
			out += String.fromCharCode(code - 0xFF10 + 0x30);
			continue;
		}
		if (code >= 0xFF21 && code <= 0xFF3A) {
			out += String.fromCharCode(code - 0xFF21 + 0x41);
			continue;
		}
		if (code >= 0xFF41 && code <= 0xFF5A) {
			out += String.fromCharCode(code - 0xFF41 + 0x61);
			continue;
		}
		out += ch;
	}
	return out
		.toUpperCase()
		.replace(/[\s\-_]/g, '')
		.replace(/[^A-Z0-9]/g, '');
}

function getStudentSelectColumns() {
	return 'id, name, school, grade, phone, parent_phone, parent_code, owner_user_id, teacher_id';
}

async function findStudentByParentCode(inputCode) {
	const rawCode = String(inputCode || '').trim();
	const normalizedCode = normalizeParentPortalCode(rawCode);
	if (!normalizedCode) return null;

	const candidateById = new Map();
	const addCandidate = (row) => {
		if (!row || typeof row !== 'object') return;
		const key = String(row.id || '');
		if (!key) return;
		if (!candidateById.has(key)) candidateById.set(key, row);
	};

	const exactCandidates = [];
	if (rawCode) exactCandidates.push(rawCode);
	if (normalizedCode && normalizedCode !== rawCode) exactCandidates.push(normalizedCode);

	for (const code of exactCandidates) {
		const { data, error } = await supabaseClient
			.from('students')
			.select(getStudentSelectColumns())
			.eq('parent_code', code)
			.maybeSingle();
		if (error) throw error;
		if (data) addCandidate(data);
	}

	// Fallback: 포맷 차이(대소문자/구분자 등) 흡수를 위해 부분조회 후 정규화 정확일치 필터
	if (candidateById.size === 0) {
		const { data: fuzzyRows, error: fuzzyError } = await supabaseClient
			.from('students')
			.select(getStudentSelectColumns())
			.ilike('parent_code', `%${normalizedCode}%`)
			.limit(30);
		if (fuzzyError) throw fuzzyError;
		(fuzzyRows || []).forEach(addCandidate);
	}

	const matches = Array.from(candidateById.values()).filter((row) => {
		return normalizeParentPortalCode(row.parent_code) === normalizedCode;
	});

	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		throw new Error('동일 인증코드로 조회되는 학생이 여러 명입니다. 선생님에게 인증코드 재발급을 요청해주세요.');
	}
	return null;
}

async function probePublicStudentsAccess() {
	try {
		const { count, error } = await supabaseClient
			.from('students')
			.select('id', { count: 'exact', head: true })
			.limit(1);
		if (error) return { ok: false, error };
		return { ok: true, count: Number(count || 0) };
	} catch (error) {
		return { ok: false, error };
	}
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

function getStatusInfo(status) {
	switch(status) {
		case 'present': return { text: '출석', cls: 'present', icon: '✅' };
		case 'late': return { text: '지각', cls: 'late', icon: '⏰' };
		case 'makeup': case 'etc': return { text: '보강', cls: 'makeup', icon: '🔁' };
		default: return { text: '결석', cls: 'absent', icon: '❌' };
	}
}

// ========== Page Navigation ==========
function showDashboard() {
	const landing = document.getElementById('page-landing');
	const adminStudentsPage = document.getElementById('page-admin-students');
	const dashboard = document.getElementById('page-dashboard');
	// 이전 페이지 숨기기
	const prevPage = adminStudentsPage.style.display !== 'none' ? adminStudentsPage : landing;
	prevPage.style.opacity = '0';
	prevPage.style.transition = 'opacity 0.2s ease';
	setTimeout(() => {
		prevPage.style.display = 'none';
		prevPage.style.opacity = '1';
		landing.style.display = 'none';
		adminStudentsPage.style.display = 'none';
		dashboard.style.display = 'block';
		dashboard.style.opacity = '0';
		dashboard.style.transition = 'opacity 0.3s ease';
		requestAnimationFrame(() => { dashboard.style.opacity = '1'; });
		window.scrollTo(0, 0);
	}, 200);
}

function goBackToLanding() {
	const dashboard = document.getElementById('page-dashboard');
	dashboard.style.opacity = '0';
	dashboard.style.transition = 'opacity 0.2s ease';
	setTimeout(() => {
		dashboard.style.display = 'none';
		dashboard.style.opacity = '1';

		// 관리자 모드에서 진입한 경우 → 학생 목록으로 돌아가기
		if (isAdminMode) {
			document.getElementById('page-admin-students').style.display = 'block';
		} else {
			const landing = document.getElementById('page-landing');
			landing.style.display = 'flex';
			landing.style.opacity = '0';
			landing.style.transition = 'opacity 0.3s ease';
			requestAnimationFrame(() => { landing.style.opacity = '1'; });
		}

		currentStudent = null;
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

	// 숙제 탭 진입 시 데이터 로드
	if (tab === 'homework' && !hwLoaded && currentStudent) {
		hwYear = new Date().getFullYear();
		hwMonth = new Date().getMonth();
		hwSelectedDate = null;
		loadHomeworkData();
		hwLoaded = true;
	}

	// 채점 탭 진입 시 데이터 로드
	if (tab === 'grading' && currentStudent) {
		loadGradingResults();
	}
}
window.switchTab = switchTab;

// ========== Admin Login ==========
function escapeHtml(str) {
	if (!str) return '';
	return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showAdminLoginModal() {
	document.getElementById('admin-email').value = '';
	document.getElementById('admin-password').value = '';
	document.getElementById('admin-login-alert').className = 'landing-alert';
	document.getElementById('admin-login-modal').classList.add('active');
	setTimeout(() => document.getElementById('admin-email').focus(), 100);
}
window.showAdminLoginModal = showAdminLoginModal;

function closeAdminLoginModal() {
	document.getElementById('admin-login-modal').classList.remove('active');
}
window.closeAdminLoginModal = closeAdminLoginModal;

async function handleAdminLogin() {
	const email = document.getElementById('admin-email').value.trim();
	const password = document.getElementById('admin-password').value;
	const alertEl = document.getElementById('admin-login-alert');
	const btn = document.getElementById('admin-login-btn');

	if (!email || !password) {
		alertEl.className = 'landing-alert show error';
		alertEl.innerHTML = '<i class="fas fa-exclamation-circle"></i>이메일과 비밀번호를 모두 입력하세요.';
		return;
	}

	btn.disabled = true;
	btn.innerHTML = '<div class="pp-spinner" style="width:20px;height:20px;border-width:2px;"></div>';

	try {
		const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
			email: email,
			password: password
		});

		if (authError) throw new Error('로그인 실패: ' + authError.message);
		if (!authData.user) throw new Error('로그인에 실패했습니다.');

		adminUser = authData.user;

		const { data: roleRow, error: roleErr } = await supabaseClient
			.from('users')
			.select('role')
			.eq('id', adminUser.id)
			.single();
		if (roleErr || roleRow?.role !== 'admin') {
			await supabaseClient.auth.signOut();
			throw new Error('관리자 권한이 없습니다. 원장(관리자) 계정으로 로그인해주세요.');
		}

		// 선생님 정보 조회 (owner_user_id = auth user id)
		const { data: teachers, error: tErr } = await supabaseClient
			.from('teachers')
			.select('id, name, phone')
			.eq('owner_user_id', adminUser.id)
			.limit(1);

		if (tErr) throw tErr;
		const teacher = (teachers && teachers.length > 0) ? teachers[0] : null;
		if (!teacher) throw new Error('등록된 선생님 계정이 아닙니다.');

		adminTeacher = teacher;
		isAdminMode = true;
		closeAdminLoginModal();
		await loadAndShowAdminStudents();
	} catch (err) {
		alertEl.className = 'landing-alert show error';
		alertEl.innerHTML = '<i class="fas fa-exclamation-circle"></i>' + escapeHtml(err.message || '로그인에 실패했습니다.');
	} finally {
		btn.disabled = false;
		btn.innerHTML = '<i class="fas fa-unlock"></i> 로그인';
	}
}
window.handleAdminLogin = handleAdminLogin;

async function loadAndShowAdminStudents() {
	try {
		const { data: students, error } = await supabaseClient
			.from('students')
			.select('id, name, school, grade, phone, parent_phone, parent_code, owner_user_id, teacher_id')
			.eq('owner_user_id', adminUser.id)
			.eq('status', 'active')
			.order('name');

		if (error) throw error;
		adminStudents = students || [];

		renderAdminStudentList();

		document.getElementById('page-landing').style.display = 'none';
		document.getElementById('page-admin-students').style.display = 'block';
		document.getElementById('admin-list-label').innerHTML =
			'<span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);">' +
			'<i class="fas fa-shield" style="margin-right:4px;"></i>' + escapeHtml(adminTeacher.name) + ' 선생님</span>';
		window.scrollTo(0, 0);
	} catch (err) {
		console.error('학생 목록 오류:', err);
		alert('학생 목록을 불러올 수 없습니다: ' + err.message);
	}
}

function renderAdminStudentList() {
	const listEl = document.getElementById('admin-student-list');

	if (adminStudents.length === 0) {
		listEl.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--gray);"><i class="fas fa-users" style="font-size:32px;display:block;margin-bottom:12px;opacity:0.3;"></i>등록된 학생이 없습니다</div>';
		return;
	}

	listEl.innerHTML = adminStudents.map((s, i) => `
		<div class="admin-student-item" onclick="selectAdminStudent(${i})">
			<div class="admin-student-avatar">${escapeHtml(s.name.charAt(0))}</div>
			<div class="admin-student-info">
				<div class="admin-student-name">${escapeHtml(s.name)}</div>
				<div class="admin-student-meta">${escapeHtml(s.grade || '')}${s.school ? ' · ' + escapeHtml(s.school) : ''}</div>
			</div>
			<i class="fas fa-chevron-right admin-student-arrow"></i>
		</div>
	`).join('');
}

async function selectAdminStudent(index) {
	const student = adminStudents[index];
	if (!student) return;

	currentStudent = student;
	await initDashboard();
}
window.selectAdminStudent = selectAdminStudent;

function logoutAdmin() {
	supabaseClient.auth.signOut().catch(() => {});
	isAdminMode = false;
	adminUser = null;
	adminTeacher = null;
	adminStudents = [];
	currentStudent = null;
	sessionStorage.removeItem('pp_current_student');

	document.getElementById('page-admin-students').style.display = 'none';
	document.getElementById('page-dashboard').style.display = 'none';
	document.getElementById('page-landing').style.display = 'flex';
	window.scrollTo(0, 0);
}
window.logoutAdmin = logoutAdmin;

// Enter 키 처리
document.addEventListener('DOMContentLoaded', function() {
	const pw = document.getElementById('admin-password');
	if (pw) pw.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAdminLogin(); });
	const em = document.getElementById('admin-email');
	if (em) em.addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('admin-password').focus(); });
});

// ========== Search (인증코드 방식) ==========
async function handleSearch() {
	const code = document.getElementById('search-code').value.trim();

	if (!code) {
		showAlert('인증코드를 입력해주세요', 'info');
		return;
	}

	// Disable button
	const btn = document.querySelector('.btn-primary');
	if (btn) { btn.disabled = true; btn.innerHTML = '<div class="pp-spinner" style="width:20px;height:20px;border-width:2px;"></div>'; }

	try {
		const data = await findStudentByParentCode(code);
		if (!data) {
			const probe = await probePublicStudentsAccess();
			if (!probe.ok) {
				showAlert('인증코드 조회 권한을 확인해주세요. 현재 포털에서 학생 조회가 차단되어 있을 수 있습니다.', 'error');
			} else if ((probe.count || 0) === 0) {
				showAlert('조회 가능한 학생 데이터가 없습니다. 코드 재발급 또는 DB/RLS 설정을 확인해주세요.', 'error');
			} else {
				showAlert('유효하지 않은 인증코드입니다. 공백/하이픈 없이 다시 입력해보세요.', 'error');
			}
			return;
		}

		currentStudent = data;
		await initDashboard();
	} catch (err) {
		console.error('검색 오류:', err);
		showAlert('조회 중 오류가 발생했습니다', 'error');
	} finally {
		if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> 조회하기'; }
	}
}
window.handleSearch = handleSearch;

// ========== Dashboard Init ==========
async function initDashboard() {
	if (!currentStudent) return;

	// ★ sessionStorage에 학생 정보 저장 (새로고침 시 복원용) — 관리자 모드에서는 저장하지 않음
	if (!isAdminMode) {
		try {
			sessionStorage.setItem('pp_current_student', JSON.stringify(currentStudent));
		} catch (e) { /* 무시 */ }
	}

	// 출결/숙제 탭 초기화 (학생 변경 시 다시 로드)
	attYear = new Date().getFullYear();
	attMonth = new Date().getMonth();
	attSelectedDate = null;
	hwLoaded = false;
	hwSelectedDate = null;

	// Update header
	document.getElementById('dash-name').textContent = currentStudent.name;
	document.getElementById('dash-grade').textContent = currentStudent.grade || '-';
	document.getElementById('dash-school').textContent = currentStudent.school || '-';

	// Set month selectors (eval용)
	const monthStr = getCurrentMonthStr();
	document.getElementById('month-selector').value = monthStr;
	document.getElementById('eval-month-selector').value = monthStr;

	showDashboard();

	// Load data
	switchTab('attendance');
	await Promise.all([
		loadQuickStats(),
		loadMonthlyAttendance(),
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

		const rate = stats.total > 0 ? Math.round(((stats.present + stats.late) / stats.total) * 100) : 0;
		document.getElementById('qs-rate').textContent = `${rate}%`;
		document.getElementById('qs-present').textContent = stats.present;
		document.getElementById('qs-late').textContent = stats.late;
		document.getElementById('qs-absent').textContent = stats.absent;
	} catch(e) { console.error('통계 오류:', e); }
}

// ========== Monthly Attendance (Calendar) ==========
async function loadMonthlyAttendance() {
	if (!currentStudent) return;
	if (teacherAuthList.length === 0) {
		try { await loadTeacherAuthList(); } catch(e) { /* 무시 */ }
	}

	const year = attYear;
	const month = attMonth; // 0-indexed
	const monthNum = month + 1;
	const lastDay = new Date(year, monthNum, 0).getDate();
	const startDate = `${year}-${String(monthNum).padStart(2,'0')}-01`;
	const endDate = `${year}-${String(monthNum).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

	// 월 라벨 업데이트
	const label = document.getElementById('att-month-label');
	if (label) label.textContent = `${year}년 ${monthNum}월`;

	// hidden month-selector 동기화 (eval 등에서 사용)
	const sel = document.getElementById('month-selector');
	if (sel) sel.value = `${year}-${String(monthNum).padStart(2,'0')}`;

	try {
		const { data: records, error } = await supabaseClient
			.from('attendance_records')
			.select('id, student_id, teacher_id, attendance_date, status, scheduled_time, check_in_time, qr_scanned, qr_scan_time, memo')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', startDate)
			.lte('attendance_date', endDate)
			.order('attendance_date', { ascending: false });
		if (error) throw error;

		attAllRecords = records || [];
	} catch(e) {
		console.error('출결 조회 오류:', e);
		attAllRecords = [];
	}

	computeAttDateStatuses();
	renderAttCalendar();
	updateAttStats();

	if (attSelectedDate) {
		showAttDateDetail(attSelectedDate);
	} else {
		const detailCard = document.getElementById('att-detail-card');
		if (detailCard) detailCard.style.display = 'none';
	}
}

function getAttTeacherName(tid) {
	if (!tid) return '알 수 없음';
	const t = teacherAuthList.find(x => String(x.id) === String(tid));
	return t ? t.name : '선생님';
}

function computeAttDateStatuses() {
	attDateStatus = {};
	const primaryTid = currentStudent.teacher_id ? String(currentStudent.teacher_id) : '';

	// 날짜별 그룹
	const byDate = {};
	attAllRecords.forEach(r => {
		const key = r.attendance_date;
		if (!byDate[key]) byDate[key] = [];
		byDate[key].push(r);
	});

	const lastDay = new Date(attYear, attMonth + 1, 0);
	for (let d = 1; d <= lastDay.getDate(); d++) {
		const dateStr = `${attYear}-${String(attMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
		const recs = byDate[dateStr] || [];

		if (recs.length === 0) {
			attDateStatus[dateStr] = { status: 'none', records: [] };
			continue;
		}

		// 담당 선생님 기록 우선
		const primary = recs.find(r => primaryTid && String(r.teacher_id) === primaryTid);
		const display = primary || recs[0];
		attDateStatus[dateStr] = { status: display.status, records: recs, display };
	}
}

function renderAttCalendar() {
	const grid = document.getElementById('att-cal-grid');
	if (!grid) return;

	const dowCells = grid.querySelectorAll('.hw-cal-dow');
	grid.innerHTML = '';
	dowCells.forEach(c => grid.appendChild(c));

	const year = attYear;
	const month = attMonth;
	const firstDay = new Date(year, month, 1);
	const lastDay = new Date(year, month + 1, 0);
	const today = new Date();
	const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

	const startDow = firstDay.getDay();
	for (let i = 0; i < startDow; i++) {
		const cell = document.createElement('div');
		cell.className = 'hw-cal-cell empty';
		grid.appendChild(cell);
	}

	for (let d = 1; d <= lastDay.getDate(); d++) {
		const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
		const dow = new Date(year, month, d).getDay();
		const cell = document.createElement('div');
		let cls = 'hw-cal-cell';

		if (dateStr === todayStr) cls += ' today';
		if (attSelectedDate === dateStr) cls += ' selected';

		const cellDate = new Date(year, month, d);
		const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		const isFuture = cellDate > todayMidnight;
		if (isFuture) cls += ' future';

		if (dow === 0) cls += ' sun-day';
		if (dow === 6) cls += ' sat-day';

		// 출결 상태 클래스
		const ds = attDateStatus[dateStr];
		if (ds && ds.status !== 'none') {
			if (ds.status === 'present') cls += ' att-present';
			else if (ds.status === 'late') cls += ' att-late';
			else if (ds.status === 'absent') cls += ' att-absent';
			else if (ds.status === 'makeup' || ds.status === 'etc') cls += ' att-makeup';
		}

		cell.className = cls;
		cell.textContent = d;

		if (!isFuture && ds && ds.status !== 'none') {
			cell.style.cursor = 'pointer';
			cell.onclick = () => selectAttDate(dateStr);
		} else if (!isFuture) {
			cell.onclick = () => selectAttDate(dateStr);
		}

		grid.appendChild(cell);
	}
}

function updateAttStats() {
	let presentCount = 0, lateCount = 0, absentCount = 0, totalCount = 0;

	Object.values(attDateStatus).forEach(ds => {
		if (ds.status === 'none') return;
		totalCount++;
		if (ds.status === 'present' || ds.status === 'makeup' || ds.status === 'etc') presentCount++;
		else if (ds.status === 'late') lateCount++;
		else absentCount++;
	});

	const rate = totalCount > 0 ? Math.round(((presentCount + lateCount) / totalCount) * 100) : 0;
	const el = id => document.getElementById(id);
	if (el('ms-rate')) el('ms-rate').textContent = `${rate}%`;
	if (el('ms-present')) el('ms-present').textContent = presentCount;
	if (el('ms-late')) el('ms-late').textContent = lateCount;
	if (el('ms-absent')) el('ms-absent').textContent = absentCount;
}

function selectAttDate(dateStr) {
	attSelectedDate = dateStr;
	renderAttCalendar();
	showAttDateDetail(dateStr);
}

function showAttDateDetail(dateStr) {
	const detailCard = document.getElementById('att-detail-card');
	const titleEl = document.getElementById('att-detail-title');
	const bodyEl = document.getElementById('att-detail-body');
	if (!detailCard || !bodyEl) return;

	const parts = dateStr.split('-');
	const dayNames = ['일','월','화','수','목','금','토'];
	const dayOfWeek = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2])).getDay();
	if (titleEl) titleEl.innerHTML = `<i class="fas fa-clipboard-list"></i><span>${parseInt(parts[0])}년 ${parseInt(parts[1])}월 ${parseInt(parts[2])}일 (${dayNames[dayOfWeek]})</span>`;

	const ds = attDateStatus[dateStr] || { status: 'none', records: [] };
	bodyEl.innerHTML = '';

	if (!ds.records || ds.records.length === 0) {
		detailCard.style.display = 'block';
		bodyEl.innerHTML = '<div class="hw-detail-empty"><i class="fas fa-calendar-xmark"></i>이 날짜에 출결 기록이 없습니다</div>';
		return;
	}

	detailCard.style.display = 'block';

	// 기록이 여러개일 수 있으므로 모두 표시
	ds.records.forEach(rec => {
		const si = getStatusInfo(rec.status);
		const stClass = si.cls === 'present' ? 'st-present' : si.cls === 'late' ? 'st-late' : si.cls === 'absent' ? 'st-absent' : 'st-makeup';

		const item = document.createElement('div');
		item.className = `att-detail-item ${stClass}`;

		const iconBg = si.cls === 'present' ? 'var(--green-bg)' : si.cls === 'late' ? 'var(--yellow-bg)' : si.cls === 'absent' ? 'var(--red-bg)' : 'var(--teal-bg)';
		const iconColor = si.cls === 'present' ? 'var(--green)' : si.cls === 'late' ? 'var(--yellow)' : si.cls === 'absent' ? 'var(--red)' : 'var(--teal)';

		let metaParts = [];
		// 예정 시간
		if (rec.scheduled_time) {
			metaParts.push(`<span><i class="fas fa-clock"></i>수업 ${formatKoreanTime(rec.scheduled_time)}</span>`);
		}
		// QR 스캔 또는 선생님 확인
		if (rec.qr_scanned && rec.qr_scan_time) {
			const scanTime = new Date(rec.qr_scan_time).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
			metaParts.push(`<span style="color:var(--teal);"><i class="fas fa-qrcode"></i>QR 스캔 ${scanTime}</span>`);
		} else if (rec.check_in_time && !rec.qr_scanned) {
			const ct = new Date(rec.check_in_time);
			const checkStr = ct.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
			metaParts.push(`<span style="color:var(--primary);"><i class="fas fa-user-check"></i>선생님 확인 ${checkStr}</span>`);
		}
		// 선생님 이름
		const tName = getAttTeacherName(rec.teacher_id);
		const teacherLabel = `<span class="att-teacher-label"><i class="fas fa-chalkboard-user"></i>${escapeHtml(tName)}</span>`;

		// 메모 표시
		const memoText = rec.memo ? escapeHtml(rec.memo) : '';
		const memoHtml = memoText ? `<div class="att-detail-memo" style="margin-top:6px;padding:6px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:12px;color:var(--text-sec);line-height:1.5;display:flex;align-items:flex-start;gap:5px;"><i class="fas fa-comment-dots" style="margin-top:2px;font-size:11px;opacity:0.6;flex-shrink:0;"></i><span>${memoText}</span></div>` : '';

		item.innerHTML = `
			<div class="att-detail-icon" style="background:${iconBg};color:${iconColor};">
				<span>${si.icon}</span>
			</div>
			<div class="att-detail-info">
				<div class="att-detail-status">
					<span style="color:${iconColor};">${si.text}</span>
					${teacherLabel}
				</div>
				<div class="att-detail-meta">${metaParts.join('')}</div>
				${memoHtml}
			</div>
		`;
		bodyEl.appendChild(item);
	});
}

// ========== Month Navigation (Attendance) ==========
function handleMonthChange() {
	// 이제 attYear/attMonth 기반으로 동작
	if (currentStudent) loadMonthlyAttendance();
}
window.handleMonthChange = handleMonthChange;

function handlePrevMonth() {
	attMonth--;
	if (attMonth < 0) { attMonth = 11; attYear--; }
	attSelectedDate = null;
	loadMonthlyAttendance();
}
window.handlePrevMonth = handlePrevMonth;

function handleNextMonth() {
	attMonth++;
	if (attMonth > 11) { attMonth = 0; attYear++; }
	attSelectedDate = null;
	loadMonthlyAttendance();
}
window.handleNextMonth = handleNextMonth;

// ========== Evaluation ==========
function isParentVerified() {
	if (!currentStudent) return false;
	return sessionStorage.getItem(`parent_verified__${currentStudent.id}`) === 'true';
}

function setParentVerified() {
	if (!currentStudent) return;
	sessionStorage.setItem(`parent_verified__${currentStudent.id}`, 'true');
}

// ========== 채점 결과 (학부모 조회) ==========
async function loadGradingResults() {
	if (!currentStudent) return;
	const el = document.getElementById('grading-results-list');
	if (!el) return;

	el.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner" style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div></div>';

	try {
		const { data, error } = await supabaseClient.from('grading_results')
			.select('*, answer_keys(title, subject)')
			.eq('student_id', currentStudent.id)
			.eq('status', 'confirmed')
			.order('created_at', { ascending: false });

		if (error || !data?.length) {
			el.innerHTML = `<div style="text-align:center;padding:30px 0;color:var(--gray);font-size:13px;">
				<i class="fas fa-inbox" style="font-size:28px;margin-bottom:8px;opacity:0.4;display:block;"></i>
				채점 결과가 없습니다
			</div>`;
			return;
		}

		el.innerHTML = data.map(r => {
			const key = r.answer_keys;
			const date = new Date(r.created_at).toLocaleDateString('ko-KR');
			const scorePercent = r.max_score > 0 ? Math.round(r.total_score / r.max_score * 100) : 0;
			const scoreColor = scorePercent >= 80 ? 'var(--green)' : scorePercent >= 60 ? 'var(--yellow)' : 'var(--red)';
			const imgUrl = (r.central_graded_image_urls || r.teacher_graded_image_urls || [])[0] || '';

			return `<div style="background:var(--bg-elevated);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;" onclick="showGradingDetail(${r.id})">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
					<span style="font-size:14px;font-weight:700;">${escapeHtml(key?.title || '채점')}</span>
					<span style="font-size:18px;font-weight:800;color:${scoreColor};">${r.total_score}점</span>
				</div>
				<div style="font-size:12px;color:var(--gray);">
					${key?.subject ? key.subject + ' · ' : ''}${date} · 
					<span style="color:var(--green);">⭕${r.correct_count}</span> 
					<span style="color:var(--red);">✘${r.wrong_count}</span> 
					<span style="color:var(--yellow);">❓${r.uncertain_count}</span>
					${r.teacher_memo ? ' · <span style="color:var(--text-sec);"><i class="fas fa-comment"></i></span>' : ''}
				</div>
			</div>`;
		}).join('');
	} catch (err) {
		el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);font-size:13px;">로드 실패</div>';
	}
}
window.loadGradingResults = loadGradingResults;

async function showGradingDetail(resultId) {
	try {
		const { data: result } = await supabaseClient.from('grading_results').select('*, answer_keys(title, subject)').eq('id', resultId).maybeSingle();
		if (!result) return;

		const { data: items } = await supabaseClient.from('grading_items').select('*').eq('result_id', resultId).order('question_number');

		const imgUrl = (result.central_graded_image_urls || result.teacher_graded_image_urls || [])[0] || '';
		const key = result.answer_keys;

		let html = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.remove()">
			<div style="background:var(--bg-card);border-radius:16px;max-width:500px;width:100%;max-height:85vh;overflow-y:auto;padding:20px;" onclick="event.stopPropagation()">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
					<div style="font-size:16px;font-weight:700;">${escapeHtml(key?.title || '채점 상세')}</div>
					<button onclick="this.closest('[style*=fixed]').remove()" style="border:none;background:none;font-size:22px;color:var(--gray);cursor:pointer;">&times;</button>
				</div>

				<div style="display:flex;gap:8px;margin-bottom:16px;">
					<div style="flex:1;text-align:center;padding:14px;background:var(--bg-elevated);border-radius:12px;">
						<div style="font-size:28px;font-weight:800;color:var(--primary);">${result.total_score}/${result.max_score}</div>
						<div style="font-size:11px;color:var(--gray);margin-top:4px;">총점</div>
					</div>
					<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
						<div style="text-align:center;padding:10px;background:var(--bg-elevated);border-radius:10px;"><div style="font-size:16px;font-weight:700;color:var(--green);">${result.correct_count}</div><div style="font-size:10px;color:var(--gray);">정답</div></div>
						<div style="text-align:center;padding:10px;background:var(--bg-elevated);border-radius:10px;"><div style="font-size:16px;font-weight:700;color:var(--red);">${result.wrong_count}</div><div style="font-size:10px;color:var(--gray);">오답</div></div>
					</div>
				</div>`;

		// 문항별 그리드
		if (items?.length) {
			html += `<div style="margin-bottom:12px;"><div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-sec);">문항별 결과</div>
				<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(36px,1fr));gap:4px;">
				${items.map(item => {
					const bg = item.is_correct === true ? 'rgba(34,197,94,0.2)' : item.is_correct === false ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)';
					const color = item.is_correct === true ? 'var(--green)' : item.is_correct === false ? 'var(--red)' : 'var(--yellow)';
					const border = item.is_correct === true ? 'var(--green)' : item.is_correct === false ? 'var(--red)' : 'var(--yellow)';
					return `<div style="aspect-ratio:1;background:${bg};border:2px solid ${border};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${color};">${item.question_number}</div>`;
				}).join('')}</div></div>`;
		}

		// 채점 이미지
		if (imgUrl) {
			html += `<div style="margin-bottom:12px;"><div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-sec);">채점 이미지</div>
				<img src="${imgUrl}" style="width:100%;border-radius:12px;border:1px solid var(--border);" alt="채점 결과">
			</div>`;
		}

		// 선생님 메모
		if (result.teacher_memo) {
			html += `<div style="padding:12px;background:var(--bg-elevated);border-radius:12px;margin-bottom:8px;">
				<div style="font-size:12px;color:var(--gray);margin-bottom:4px;"><i class="fas fa-comment"></i> 선생님 메모</div>
				<div style="font-size:14px;">${escapeHtml(result.teacher_memo)}</div>
			</div>`;
		}

		html += `</div></div>`;

		const overlay = document.createElement('div');
		overlay.innerHTML = html;
		document.body.appendChild(overlay.firstElementChild);
	} catch (err) {
		console.error('[채점상세]', err);
	}
}
window.showGradingDetail = showGradingDetail;

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

	if (normalizeParentPortalCode(code) !== normalizeParentPortalCode(expected)) {
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
		'Missing teacherId or pin': '입력 정보가 부족합니다.'
	};
	if (map[code]) return map[code];
	if (/missing.*teacherid|pin/i.test(code)) return '입력 정보가 부족합니다.';
	return '비밀번호 확인에 실패했습니다.';
}

async function verifyTeacherPinWithServer(teacherId, pin, options = {}) {
	const normalizedTeacherId = String(teacherId || '').trim();
	const normalizedPin = String(pin || '').trim();
	if (!normalizedTeacherId || !normalizedPin) return { ok: false };
	const body = {
		teacherId: normalizedTeacherId,
		pin: normalizedPin,
		ownerUserId: options.ownerUserId || undefined,
		requireAdmin: !!options.requireAdmin
	};
	try {
		if (typeof window.invokeVerifyTeacherPin === 'function') {
			return await window.invokeVerifyTeacherPin(supabaseClient, body, { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
		}
		const { data, error } = await supabaseClient.functions.invoke('verify-teacher-pin', { body });
		if (error) return { ok: false, error: error.message || 'verify-teacher-pin failed' };
		return { ok: !!(data && data.ok), teacher: data?.teacher || null, error: data?.error || null };
	} catch (e) {
		return { ok: false, error: e?.message || String(e) };
	}
}

async function loadTeacherAuthList() {
	try {
		const { data, error } = await supabaseClient
			.from('teachers')
			.select('id, name, owner_user_id')
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
		const verifyResult = await verifyTeacherPinWithServer(teacher.id, password, {
			ownerUserId: teacher.owner_user_id || undefined
		});
		if (!verifyResult.ok) {
			ppShowToast(mapVerifyTeacherPinFailureToMessage(verifyResult) || '비밀번호가 일치하지 않습니다', 'error');
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

// ========== Homework Functions ==========

function formatFileSize(bytes) {
	if (!bytes || bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	let size = bytes;
	while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
	return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

async function loadHomeworkData() {
	if (!currentStudent) return;

	const year = hwYear;
	const month = hwMonth;
	const lastDay = new Date(year, month + 1, 0);

	const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
	const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

	// 월 라벨 업데이트
	const label = document.getElementById('hw-month-label');
	if (label) label.textContent = `${year}년 ${month + 1}월`;

	try {
		const subPromise = supabaseClient
			.from('homework_submissions')
			.select('id, submission_date, file_name, file_size, status, created_at')
			.eq('student_id', currentStudent.id)
			.gte('submission_date', startDate)
			.lte('submission_date', endDate)
			.in('status', ['uploaded', 'manual'])
			.order('created_at', { ascending: false });

		const schedPromise = supabaseClient
			.from('schedules')
			.select('schedule_date, start_time')
			.eq('student_id', currentStudent.id)
			.gte('schedule_date', startDate)
			.lte('schedule_date', endDate);

		const [subResult, schedResult] = await Promise.all([subPromise, schedPromise]);

		hwSubmissions = (subResult.error ? [] : subResult.data) || [];
		hwSchedules = (schedResult.error ? [] : schedResult.data) || [];
	} catch (e) {
		console.error('Homework fetch error:', e);
		hwSubmissions = [];
		hwSchedules = [];
	}

	computeHwDateStatuses();
	renderHwCalendar();
	updateHwStats();

	if (hwSelectedDate) {
		showHwDateDetail(hwSelectedDate);
	} else {
		const detailCard = document.getElementById('hw-detail-card');
		if (detailCard) detailCard.style.display = 'none';
	}
}

function computeHwDateStatuses() {
	hwDateStatus = {};
	const today = new Date();

	const scheduleMap = {};
	hwSchedules.forEach(s => {
		const t = (s.start_time || '').substring(0, 5);
		if (!scheduleMap[s.schedule_date] || t < scheduleMap[s.schedule_date]) {
			scheduleMap[s.schedule_date] = t;
		}
	});

	const subMap = {};
	hwSubmissions.forEach(s => {
		if (!subMap[s.submission_date]) subMap[s.submission_date] = [];
		subMap[s.submission_date].push(s);
	});

	const lastDay = new Date(hwYear, hwMonth + 1, 0);
	for (let d = 1; d <= lastDay.getDate(); d++) {
		const dateStr = `${hwYear}-${String(hwMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		const hasSchedule = !!scheduleMap[dateStr];
		const scheduleTime = scheduleMap[dateStr] || null;
		const subs = subMap[dateStr] || [];

		if (!hasSchedule) {
			if (subs.length > 0) {
				hwDateStatus[dateStr] = { status: 'submitted', scheduleTime: null };
			} else {
				hwDateStatus[dateStr] = { status: 'none', scheduleTime: null };
			}
			continue;
		}

		const hasManual = subs.some(s => s.status === 'manual');
		if (hasManual) {
			hwDateStatus[dateStr] = { status: 'manual', scheduleTime };
			continue;
		}

		const uploadedSubs = subs.filter(s => s.status === 'uploaded');
		if (uploadedSubs.length === 0) {
			const [dh, dm] = (scheduleTime || '23:59').split(':').map(Number);
			const deadline = new Date(hwYear, hwMonth, d, dh, dm);
			if (deadline <= today) {
				hwDateStatus[dateStr] = { status: 'missed', scheduleTime };
			} else {
				hwDateStatus[dateStr] = { status: 'pending', scheduleTime };
			}
			continue;
		}

		const [sh, sm] = (scheduleTime || '23:59').split(':').map(Number);
		const deadlineMinutes = sh * 60 + sm;

		const hasOnTime = uploadedSubs.some(s => {
			const ct = new Date(s.created_at);
			const ctMinutes = ct.getHours() * 60 + ct.getMinutes();
			const ctDateStr = `${ct.getFullYear()}-${String(ct.getMonth()+1).padStart(2,'0')}-${String(ct.getDate()).padStart(2,'0')}`;
			if (ctDateStr < dateStr) return true;
			if (ctDateStr === dateStr && ctMinutes <= deadlineMinutes) return true;
			return false;
		});

		hwDateStatus[dateStr] = {
			status: hasOnTime ? 'on_time' : 'late',
			scheduleTime
		};
	}
}

function renderHwCalendar() {
	const grid = document.getElementById('hw-cal-grid');
	if (!grid) return;

	const dowCells = grid.querySelectorAll('.hw-cal-dow');
	grid.innerHTML = '';
	dowCells.forEach(c => grid.appendChild(c));

	const year = hwYear;
	const month = hwMonth;
	const firstDay = new Date(year, month, 1);
	const lastDay = new Date(year, month + 1, 0);
	const today = new Date();
	const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

	const startDow = firstDay.getDay();
	for (let i = 0; i < startDow; i++) {
		const cell = document.createElement('div');
		cell.className = 'hw-cal-cell empty';
		grid.appendChild(cell);
	}

	for (let d = 1; d <= lastDay.getDate(); d++) {
		const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		const dow = new Date(year, month, d).getDay();
		const cell = document.createElement('div');
		let cls = 'hw-cal-cell';

		if (dateStr === todayStr) cls += ' today';
		if (hwSelectedDate === dateStr) cls += ' selected';

		const cellDate = new Date(year, month, d);
		const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		const isFuture = cellDate > todayMidnight;
		if (isFuture) cls += ' future';

		if (dow === 0) cls += ' sun-day';
		if (dow === 6) cls += ' sat-day';

		const ds = hwDateStatus[dateStr];
		if (ds) {
			if (ds.status === 'on_time') cls += ' hw-ontime';
			else if (ds.status === 'late') cls += ' hw-late';
			else if (ds.status === 'missed') cls += ' hw-missed';
			else if (ds.status === 'manual') cls += ' hw-manual';
			else if (ds.status === 'submitted') cls += ' hw-submitted';
			else if (ds.status === 'pending' && ds.scheduleTime) cls += ' hw-scheduled';
		}

		cell.className = cls;
		cell.textContent = d;

		if (!isFuture) {
			cell.onclick = () => selectHwDate(dateStr);
		}

		grid.appendChild(cell);
	}
}

function updateHwStats() {
	let onTimeCount = 0, lateCount = 0, missedCount = 0, totalScheduled = 0;
	const today = new Date();

	Object.entries(hwDateStatus).forEach(([dateStr, ds]) => {
		if (ds.status === 'submitted') {
			onTimeCount++;
			return;
		}
		if (!ds.scheduleTime) return;

		const [dh, dm] = (ds.scheduleTime || '23:59').split(':').map(Number);
		const parts = dateStr.split('-').map(Number);
		const deadline = new Date(parts[0], parts[1] - 1, parts[2], dh, dm);
		if (deadline > today) return;

		totalScheduled++;
		if (ds.status === 'on_time' || ds.status === 'manual') onTimeCount++;
		else if (ds.status === 'late') lateCount++;
		else if (ds.status === 'missed') missedCount++;
	});

	const el = id => document.getElementById(id);
	if (el('hw-st-submit')) el('hw-st-submit').textContent = onTimeCount;
	if (el('hw-st-late')) el('hw-st-late').textContent = lateCount;
	if (el('hw-st-missed')) el('hw-st-missed').textContent = missedCount;
	if (el('hw-st-total')) el('hw-st-total').textContent = totalScheduled;
}

function selectHwDate(dateStr) {
	hwSelectedDate = dateStr;
	renderHwCalendar();
	showHwDateDetail(dateStr);
}

function showHwDateDetail(dateStr) {
	const detailCard = document.getElementById('hw-detail-card');
	const titleEl = document.getElementById('hw-detail-title');
	const bodyEl = document.getElementById('hw-detail-body');
	if (!detailCard || !bodyEl) return;

	detailCard.style.display = 'block';

	const parts = dateStr.split('-');
	if (titleEl) titleEl.innerHTML = `<i class="fas fa-file-lines"></i><span>${parseInt(parts[0])}년 ${parseInt(parts[1])}월 ${parseInt(parts[2])}일 기록</span>`;

	const ds = hwDateStatus[dateStr] || { status: 'none', scheduleTime: null };
	const daySubmissions = hwSubmissions.filter(s => s.submission_date === dateStr);
	bodyEl.innerHTML = '';

	// 수업 시간 표시
	if (ds.scheduleTime) {
		const schedDiv = document.createElement('div');
		schedDiv.className = 'hw-sched-info';
		schedDiv.innerHTML = `<i class="fas fa-clock"></i> 수업 시작: ${ds.scheduleTime} &nbsp;|&nbsp; 제출 마감: ${ds.scheduleTime}`;
		bodyEl.appendChild(schedDiv);
	}

	if (daySubmissions.length === 0) {
		const emptyDiv = document.createElement('div');
		emptyDiv.className = 'hw-detail-empty';
		if (ds.scheduleTime && ds.status === 'missed') {
			emptyDiv.innerHTML = '<i class="fas fa-circle-xmark"></i>이 날짜에 제출한 숙제가 없습니다';
		} else if (ds.scheduleTime && ds.status === 'pending') {
			emptyDiv.innerHTML = '<i class="fas fa-hourglass-half"></i>아직 마감 전입니다';
		} else {
			emptyDiv.innerHTML = '<i class="fas fa-inbox"></i>이 날짜에 제출한 숙제가 없습니다';
		}
		bodyEl.appendChild(emptyDiv);
	} else {
		daySubmissions.forEach(sub => {
			const item = document.createElement('div');
			item.className = 'hw-detail-item';

			if (sub.status === 'manual') {
				item.innerHTML = `
					<div class="hw-detail-icon" style="background:var(--teal-bg);color:var(--teal);"><i class="fas fa-user-check"></i></div>
					<div class="hw-detail-info">
						<div class="hw-detail-name">${escapeHtml(sub.file_name || '관리자 확인')}</div>
						<div class="hw-detail-meta">
							<span class="hw-status-badge manual"><i class="fas fa-check"></i> 관리자 확인</span>
						</div>
					</div>
				`;
			} else {
				const createdAt = new Date(sub.created_at);
				const timeStr = `${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}`;
				const sizeStr = formatFileSize(sub.file_size || 0);

				let badgeHtml = '';
				if (ds.scheduleTime) {
					const [sh, sm] = ds.scheduleTime.split(':').map(Number);
					const deadlineMin = sh * 60 + sm;
					const subMin = createdAt.getHours() * 60 + createdAt.getMinutes();
					const ctDateStr = `${createdAt.getFullYear()}-${String(createdAt.getMonth()+1).padStart(2,'0')}-${String(createdAt.getDate()).padStart(2,'0')}`;
					if (ctDateStr < dateStr || subMin <= deadlineMin) {
						badgeHtml = '<span class="hw-status-badge on-time"><i class="fas fa-check"></i> 정각 제출</span>';
					} else {
						badgeHtml = '<span class="hw-status-badge late"><i class="fas fa-clock"></i> 늦게 제출</span>';
					}
				}

				item.innerHTML = `
					<div class="hw-detail-icon" style="background:var(--primary-light);color:var(--primary);"><i class="fas fa-file-zipper"></i></div>
					<div class="hw-detail-info">
						<div class="hw-detail-name">${escapeHtml(sub.file_name)}</div>
						<div class="hw-detail-meta">
							<span><i class="fas fa-clock" style="margin-right:3px;"></i>${timeStr}</span>
							<span><i class="fas fa-weight-hanging" style="margin-right:3px;"></i>${sizeStr}</span>
							${badgeHtml}
						</div>
					</div>
				`;
			}
			bodyEl.appendChild(item);
		});
	}
}

function handlePrevMonthHw() {
	hwMonth--;
	if (hwMonth < 0) { hwMonth = 11; hwYear--; }
	hwSelectedDate = null;
	loadHomeworkData();
}
window.handlePrevMonthHw = handlePrevMonthHw;

function handleNextMonthHw() {
	hwMonth++;
	if (hwMonth > 11) { hwMonth = 0; hwYear++; }
	hwSelectedDate = null;
	loadHomeworkData();
}
window.handleNextMonthHw = handleNextMonthHw;

// ========== Event Listeners ==========
document.addEventListener('DOMContentLoaded', () => {
	// ★ 새로고침 시 sessionStorage에서 학생 정보 복원
	try {
		const saved = sessionStorage.getItem('pp_current_student');
		if (saved) {
			const parsed = JSON.parse(saved);
			if (parsed && parsed.id) {
				currentStudent = parsed;
				// 출결/숙제 상태 초기화
				attYear = new Date().getFullYear();
				attMonth = new Date().getMonth();
				attSelectedDate = null;
				hwLoaded = false;
				hwSelectedDate = null;
				// 즉시 대시보드 표시 (페이드 애니메이션 없이)
				document.getElementById('page-landing').style.display = 'none';
				document.getElementById('page-dashboard').style.display = 'block';
				document.getElementById('page-dashboard').style.opacity = '1';
				// 헤더 정보 설정
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
					loadMonthlyAttendance(),
					loadEvaluationState(monthStr)
				]).catch(e => console.error('[복원] 데이터 로드 실패:', e));
			}
		}
	} catch (e) {
		console.error('[복원] sessionStorage 파싱 실패:', e);
	}

	// Enter key search
	const codeInput = document.getElementById('search-code');
	if (codeInput) codeInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleSearch(); });

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
	['parent-auth-modal', 'admin-auth-modal'].forEach(id => {
		const el = document.getElementById(id);
		if (el) el.addEventListener('click', e => {
			if (e.target === el) {
				el.classList.remove('active');
			}
		});
	});

	// Admin login modal outside click
	const adminLoginModal = document.getElementById('admin-login-modal');
	if (adminLoginModal) adminLoginModal.addEventListener('click', e => {
		if (e.target === adminLoginModal) closeAdminLoginModal();
	});

	// ESC key
	document.addEventListener('keydown', e => {
		if (e.key === 'Escape') {
			closeParentAuthModal();
			closeTeacherAuthModal();
			closeAdminLoginModal();
		}
	});

	// Pre-load teacher list
	loadTeacherAuthList();
});
