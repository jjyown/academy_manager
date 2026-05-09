// 학부모 포털 - report.js (전면 개편)
// ============================================================

// ========== Supabase 초기화 ==========
/** localStorage·수동 입력 시 흔한 호스트 오타 교정(잘못된 프로젝트 → Invalid login credentials) */
function normalizeSupabaseProjectUrl(url) {
	const u = String(url || '').trim().replace(/\/+$/, '');
	if (!u) return u;
	const lower = u.toLowerCase();
	const fixes = [
		['https://jzcrpdeomjmtfekcgqu.supabase.co', 'https://jzcrpdeomjmytfekcgqu.supabase.co'],
		['https://izcrpdeominmtfekcgqu.supabase.co', 'https://jzcrpdeomjmytfekcgqu.supabase.co']
	];
	for (const [bad, good] of fixes) {
		if (lower === bad) {
			console.warn('[supabase] URL 오타 교정:', bad, '→', good);
			return good;
		}
	}
	return u;
}

function resolveRuntimeSupabaseConfig() {
	const env = (typeof window !== 'undefined' && window.env) ? window.env : {};
	const ls = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null;
	const fromStorageUrl = ls ? (ls.getItem('academy_supabase_url') || ls.getItem('REACT_APP_SUPABASE_URL')) : '';
	const fromStorageKey = ls ? (ls.getItem('academy_supabase_anon_key') || ls.getItem('REACT_APP_SUPABASE_ANON_KEY')) : '';
	return {
		url: normalizeSupabaseProjectUrl(
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
	auth: {
		flowType: 'pkce',
		persistSession: false,
		autoRefreshToken: false,
		detectSessionInUrl: false
	}
});

const _isLocal = ['localhost','127.0.0.1'].includes(location.hostname);
const GRADING_SERVER_URL_HW = (localStorage.getItem('grading_server_url') || '').trim()
	|| (_isLocal ? 'https://academymanager-production.up.railway.app' : 'https://academymanager-production.up.railway.app');

// ========== State ==========
let currentStudent = null;
let teacherAuthList = [];
let authorizedTeacher = null;
let pendingEvaluationSave = false;
// 출결 탭은 학부모 포털에서 비노출 (별도 앱으로 대체) — 기본은 숙제 탭
let currentTab = 'homework';

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
let hwAssignments = [];
let hwAssignmentsLoaded = false; // API 호출 성공 여부(0건이어도 true)
let hwDateStatus = {};
let hwSelectedDate = null;
let hwLoaded = false;
/** 제출 id → 확정 채점 요약 (public-portal-grading API) */
let hwGradingBySubmissionId = {};

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

/**
 * 출석 이력 모달과 동일한 인증 시각 원본 (`qr-attendance.js` resolveHistoryMeta → authIso).
 * `check_in_time`은 번호 인증 등에만 사용하고, 무조건 3순위로 쓰면 처리/체크 시각과 섞여 학부모 화면과 이력이 어긋날 수 있음.
 */
function resolveParentPortalAuthIso(rec) {
	if (!rec) return null;
	if (rec.auth_time) return rec.auth_time;
	if (rec.qr_scanned && rec.qr_scan_time) return rec.qr_scan_time;
	const judgment = String(rec.qr_judgment || '');
	const memoText = String(rec.memo || '');
	const source = String(rec.attendance_source || '').trim();
	const hasPhoneAuth =
		source === 'phone' ||
		source === 'teacher_manual' ||
		judgment.includes('전화번호인증') ||
		memoText.includes('[전화번호인증]');
	if (hasPhoneAuth && rec.check_in_time) return rec.check_in_time;
	return null;
}

/** 출결 레코드에서 인증 시각(Date) — 이력 화면「인증시간」과 동일 소스 */
function getParentPortalAuthTimestamp(rec) {
	const raw = resolveParentPortalAuthIso(rec);
	if (!raw) return null;
	const d = new Date(raw);
	return isNaN(d.getTime()) ? null : d;
}

function formatParentPortalAuthTime(rec) {
	const d = getParentPortalAuthTimestamp(rec);
	if (!d) return null;
	return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** attendance_date + scheduled_time(HH:MM) 로컬 시작 시각 */
function getParentPortalScheduledStart(rec) {
	if (!rec || !rec.attendance_date || !rec.scheduled_time) return null;
	const [h, m] = String(rec.scheduled_time).split(':').map(Number);
	if (isNaN(h) || isNaN(m)) return null;
	const [y, mo, d] = String(rec.attendance_date).split('-').map(Number);
	if (!y || !mo || !d) return null;
	return new Date(y, mo - 1, d, h, m, 0, 0);
}

/** 지각: 인증 시각 − 수업 시작(분), 음수는 0으로 클램프 */
function getParentPortalLateMinutes(rec) {
	if (!rec || String(rec.status) !== 'late') return null;
	const start = getParentPortalScheduledStart(rec);
	const auth = getParentPortalAuthTimestamp(rec);
	if (!start || !auth) return null;
	return Math.max(0, Math.round((auth.getTime() - start.getTime()) / 60000));
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

		if (currentStudent && currentStudent.id != null) {
			try {
				sessionStorage.removeItem(`parent_verified__${currentStudent.id}`);
			} catch (e) { /* 무시 */ }
		}
		currentStudent = null;
		sessionStorage.removeItem('pp_current_student');
		try { sessionStorage.removeItem('pp_portal_code'); } catch (_) {}
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

	// 종합평가 탭: 인증코드로 이미 조회한 학부모는 추가 인증 없이 표시
	if (tab === 'eval' && currentStudent && isParentVerified()) {
		const v = document.getElementById('eval-month-selector')?.value;
		if (v) loadEvaluation(v);
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

		if (authError) {
			const m = String(authError.message || '');
			const low = m.toLowerCase();
			let hint = '';
			if (low.includes('invalid login') || low.includes('invalid credential') || low.includes('email not confirmed')) {
				hint = ' (비밀번호·이메일 확인, Supabase Auth에서 사용자 삭제 여부 확인. 저장된 URL 오타 시 개발자도구 → Application → Local Storage에서 academy_supabase_url 등을 삭제 후 재시도)';
			}
			throw new Error('로그인 실패: ' + m + hint);
		}
		if (!authData.user) throw new Error('로그인에 실패했습니다.');

		adminUser = authData.user;

		const { data: roleRow, error: roleErr } = await supabaseClient
			.from('users')
			.select('role')
			.eq('id', adminUser.id)
			.single();
		if (roleErr || roleRow?.role !== 'admin') {
			await supabaseClient.auth.signOut();
			throw new Error('관리자 권한이 없습니다. 원장(관리자) 계정으로 로그인해주세요. (users.role=admin 확인)');
		}

		// 선생님 정보 조회 (owner_user_id = auth user id) — teachers 행이 없으면 여기서 실패
		const { data: teachers, error: tErr } = await supabaseClient
			.from('teachers')
			.select('id, name, phone')
			.eq('owner_user_id', adminUser.id)
			.limit(1);

		if (tErr) throw tErr;
		const teacher = (teachers && teachers.length > 0) ? teachers[0] : null;
		if (!teacher) {
			await supabaseClient.auth.signOut();
			throw new Error('이 원장 계정에 연결된 선생님(teachers) 행이 없습니다. 메인 관리 앱에서 선생님을 한 명 이상 등록한 뒤 다시 시도하세요.');
		}

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
	try { sessionStorage.removeItem('pp_portal_code'); } catch (_) {}

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
		try {
			sessionStorage.setItem('pp_portal_code', normalizeParentPortalCode(code));
		} catch (_) {}
		setParentVerified();
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

	// Load data — 출결은 학부모 포털에서 비노출(loadQuickStats / loadMonthlyAttendance 호출하지 않음)
	switchTab('homework');
	await Promise.all([
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
			.select('id, student_id, teacher_id, attendance_date, status, scheduled_time, auth_time, check_in_time, qr_scanned, qr_scan_time, qr_judgment, attendance_source, memo')
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

		const st = String(rec.status || '');
		const isAbsent = st === 'absent';
		const showAuth = !isAbsent && (st === 'present' || st === 'late' || st === 'makeup' || st === 'etc');
		const authLabel = showAuth ? formatParentPortalAuthTime(rec) : null;

		let metaHtml = '';
		// 지각 + 수업·인증 모두: 한 줄(nowrap)로 좌·우 정렬 — 부모 flex-wrap으로 줄바꿈 지그재그 방지
		if (st === 'late' && rec.scheduled_time && showAuth && authLabel) {
			const lateMin = getParentPortalLateMinutes(rec);
			const lateLine = lateMin != null
				? `<div class="att-late-min-line">${lateMin}분 지각</div>`
				: '';
			metaHtml = `<div class="att-meta-late-row"><span class="att-meta-class"><i class="fas fa-clock"></i>수업 ${formatKoreanTime(rec.scheduled_time)}</span><div class="att-meta-auth-col">${lateLine}<span class="att-meta-auth"><i class="fas fa-fingerprint"></i>인증 ${authLabel}</span></div></div>`;
		} else {
			const metaParts = [];
			if (rec.scheduled_time) {
				metaParts.push(`<span class="att-meta-class"><i class="fas fa-clock"></i>수업 ${formatKoreanTime(rec.scheduled_time)}</span>`);
			}
			if (showAuth && authLabel) {
				metaParts.push(`<span class="att-meta-auth"><i class="fas fa-fingerprint"></i>인증 ${authLabel}</span>`);
			}
			metaHtml = metaParts.join('');
		}
		// 선생님 이름
		const tName = getAttTeacherName(rec.teacher_id);
		const teacherLabel = `<span class="att-teacher-label"><i class="fas fa-chalkboard-user"></i>${escapeHtml(tName)}</span>`;

		// 메모: 선생님이 출석 이력 하단에 적은 내용 — 지각·결석·보강·기타일 때만 학부모에게 노출(일반 출석은 미표시)
		const memoRaw = String(rec.memo || '').trim();
		const showMemoBox =
			(st === 'late' || st === 'absent' || st === 'makeup' || st === 'etc') && memoRaw.length > 0;
		const memoText = showMemoBox ? escapeHtml(memoRaw) : '';
		const memoHtml = memoText
			? `<div class="att-detail-memo" style="margin-top:6px;padding:6px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:12px;color:var(--text-sec);line-height:1.5;display:flex;align-items:flex-start;gap:5px;"><i class="fas fa-comment-dots" style="margin-top:2px;font-size:11px;opacity:0.6;flex-shrink:0;"></i><span>${memoText}</span></div>`
			: '';

		item.innerHTML = `
			<div class="att-detail-icon" style="background:${iconBg};color:${iconColor};">
				<span>${si.icon}</span>
			</div>
			<div class="att-detail-info">
				<div class="att-detail-status">
					<span style="color:${iconColor};">${si.text}</span>
					${teacherLabel}
				</div>
				<div class="att-detail-meta">${metaHtml}</div>
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
	// 원장/선생님이 관리자 경로로 조회 시 종합평가 잠금 없음
	if (isAdminMode) return true;
	// 랜딩에서 학부모 인증코드로 학생 조회에 성공한 경우 = 동일 세션에서 이미 검증됨
	return sessionStorage.getItem(`parent_verified__${currentStudent.id}`) === 'true';
}

function setParentVerified() {
	if (!currentStudent) return;
	sessionStorage.setItem(`parent_verified__${currentStudent.id}`, 'true');
}

async function loadEvaluationState(monthStr) {
	updateEvalLockUI();
	if (currentStudent && isParentVerified()) {
		await loadEvaluation(monthStr);
	}
}

/** @deprecated 추가 학부모 인증 UI 제거 후 호환용(콘텐츠 영역 표시) */
function updateEvalLockUI() {
	const content = document.getElementById('eval-content');
	if (content) content.classList.add('visible');
}

async function loadEvaluation(monthStr) {
	if (!currentStudent) return;
	if (!isParentVerified()) return;
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
		// RLS: parent_portal_visible=false 이면 행이 조회되지 않음 → 학부모에게 비공개로 간주
		textarea.value = data && typeof data.comment === 'string' ? data.comment : '';
		updateEvalCharCount();

		// 선생님 인증 여부에 따라 수정 가능 여부 결정
		const teacher = getAuthorizedTeacher();
		if (teacher) {
			textarea.readOnly = false;
			textarea.placeholder = '학생에 대한 종합 평가를 작성하세요 (최대 2000자)';
			document.getElementById('eval-save-row').style.display = 'flex';
			document.querySelector('.eval-hint').textContent = `${teacher.name} 선생님으로 수정 가능`;
		} else {
			textarea.readOnly = true;
			if (!data) {
				textarea.placeholder =
					'아직 공개된 종합 평가가 없습니다. 선생님이 작성 후 「학부모 공개」를 켜면 여기에 표시됩니다.';
			} else {
				textarea.placeholder = '이번 달 종합 평가가 아직 작성되지 않았습니다.';
			}
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
			select.onchange = function() {
				const u = document.getElementById('teacher-auth-username-ac');
				if (!u) return;
				const tid = this.value;
				const te = teacherAuthList.find(x => String(x.id) === String(tid));
				u.value = te ? (te.name || '') : '';
			};
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
	const uac = document.getElementById('teacher-auth-username-ac');
	if (uac) uac.value = '';
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
		let parentVisible = false;
		const { data: existing } = await supabaseClient
			.from('student_evaluations')
			.select('parent_portal_visible')
			.eq('student_id', currentStudent.id)
			.eq('eval_month', monthStr)
			.maybeSingle();
		if (existing && typeof existing.parent_portal_visible === 'boolean') {
			parentVisible = existing.parent_portal_visible;
		}

		const row = {
			student_id: currentStudent.id,
			eval_month: monthStr,
			owner_user_id: teacher.owner_user_id || null,
			teacher_id: teacher.id,
			comment: comment,
			updated_at: new Date().toISOString()
		};
		if (typeof existing?.parent_portal_visible === 'boolean') {
			row.parent_portal_visible = parentVisible;
		}

		const { error } = await supabaseClient
			.from('student_evaluations')
			.upsert(row, { onConflict: 'student_id,eval_month' });
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

function getPpPortalVerificationCode() {
	if (typeof isAdminMode !== 'undefined' && isAdminMode) return '';
	try {
		return sessionStorage.getItem('pp_portal_code') || '';
	} catch (_) {
		return '';
	}
}

/** Drive `uc?id=` 링크를 썸네일용 lh3 URL로 (채점 UI와 동일 패턴) */
function portalDriveImageDisplayUrl(url) {
	if (!url || typeof url !== 'string') return '';
	const m = url.match(/drive\.google\.com\/uc\?id=([^&]+)/);
	if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w1200`;
	const m2 = url.match(/\/file\/d\/([^/]+)/);
	if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}=w1200`;
	return url;
}

async function fetchHwPortalGradingMap() {
	hwGradingBySubmissionId = {};
	const vcode = getPpPortalVerificationCode();
	if (!GRADING_SERVER_URL_HW || !vcode || !currentStudent || currentStudent.id == null) return;
	try {
		const base = GRADING_SERVER_URL_HW.replace(/\/$/, '');
		const url = new URL(`${base}/api/public-portal-grading/student-results`);
		url.searchParams.set('student_id', String(currentStudent.id));
		url.searchParams.set('verification_code', vcode);
		const res = await fetch(url.toString());
		const body = await res.json().catch(() => ({}));
		if (!res.ok) return;
		for (const r of body.data || []) {
			if (r.homework_submission_id != null) {
				hwGradingBySubmissionId[String(r.homework_submission_id)] = r;
			}
		}
	} catch (e) {
		console.warn('[parent-portal] grading map fetch failed:', e);
	}
}

function appendPortalGradingBlock(container, grading, verificationCode) {
	if (!grading) return;
	const wrap = document.createElement('div');
	wrap.className = 'hw-detail-grading';

	const head = document.createElement('div');
	head.className = 'hw-grading-head';
	head.innerHTML = '<i class="fas fa-check-double"></i> 확정 채점';
	wrap.appendChild(head);

	if (grading.total_score != null && grading.max_score != null) {
		const score = document.createElement('div');
		score.className = 'hw-grading-score';
		score.innerHTML = `<i class="fas fa-chart-simple"></i> 점수: <strong>${escapeHtml(String(grading.total_score))}</strong> / ${escapeHtml(String(grading.max_score))}`;
		wrap.appendChild(score);
	}

	const countParts = [];
	if (grading.correct_count != null) countParts.push(`맞음 ${grading.correct_count}`);
	if (grading.wrong_count != null) countParts.push(`틀림 ${grading.wrong_count}`);
	if (grading.unanswered_count != null) countParts.push(`미응답 ${grading.unanswered_count}`);
	if (countParts.length) {
		const c = document.createElement('div');
		c.className = 'hw-grading-counts';
		c.textContent = countParts.join(' · ');
		wrap.appendChild(c);
	}

	const imgs = grading.central_graded_image_urls;
	if (Array.isArray(imgs) && imgs.length) {
		const row = document.createElement('div');
		row.className = 'hw-grading-images';
		imgs.forEach((rawUrl, j) => {
			const u = portalDriveImageDisplayUrl(rawUrl);
			if (!u) return;
			const a = document.createElement('a');
			a.className = 'hw-grading-img-link';
			a.href = u;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			const img = document.createElement('img');
			img.className = 'hw-grading-thumb';
			img.alt = `채점 ${j + 1}`;
			img.loading = 'lazy';
			img.src = u;
			a.appendChild(img);
			row.appendChild(a);
		});
		if (row.childNodes.length) wrap.appendChild(row);
	}

	if (verificationCode && grading.id != null) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'hw-grading-items-btn';
		btn.innerHTML = '<i class="fas fa-list-ol"></i> 문항별 결과';
		btn.addEventListener('click', () => openPortalGradingItemsModal(grading.id, verificationCode));
		wrap.appendChild(btn);
	}

	container.appendChild(wrap);
}

async function openPortalGradingItemsModal(resultId, verificationCode) {
	document.getElementById('pp-grading-items-modal')?.remove();

	const overlay = document.createElement('div');
	overlay.id = 'pp-grading-items-modal';
	overlay.className = 'pp-grading-modal-overlay';
	overlay.innerHTML = `
		<div class="pp-grading-modal">
			<div class="pp-grading-modal-head">
				<span>문항별 결과</span>
				<button type="button" class="pp-grading-modal-close" aria-label="닫기">&times;</button>
			</div>
			<div class="pp-grading-modal-body"><p class="pp-grading-loading">불러오는 중…</p></div>
		</div>`;
	document.body.appendChild(overlay);

	const close = () => overlay.remove();
	overlay.querySelector('.pp-grading-modal-close')?.addEventListener('click', close);
	overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

	const bodyEl = overlay.querySelector('.pp-grading-modal-body');
	if (!GRADING_SERVER_URL_HW) {
		bodyEl.innerHTML = '<p class="pp-grading-err">채점 서버 URL이 설정되지 않았습니다</p>';
		return;
	}
	try {
		const base = GRADING_SERVER_URL_HW.replace(/\/$/, '');
		const url = new URL(`${base}/api/public-portal-grading/results/${resultId}/items`);
		url.searchParams.set('verification_code', verificationCode);
		const res = await fetch(url.toString());
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			bodyEl.innerHTML = `<p class="pp-grading-err">${escapeHtml(data.detail || data.error || `HTTP ${res.status}`)}</p>`;
			return;
		}
		const items = data.data || [];
		if (!items.length) {
			bodyEl.innerHTML = '<p class="pp-grading-empty">문항 데이터가 없습니다</p>';
			return;
		}
		let rows = '';
		for (const it of items) {
			const qn = it.question_label || `#${it.question_number}`;
			const corr = it.is_correct === true ? '○' : it.is_correct === false ? '×' : '—';
			rows += `<tr><td>${escapeHtml(String(qn))}</td><td>${escapeHtml(corr)}</td><td>${escapeHtml(String(it.student_answer ?? ''))}</td><td>${escapeHtml(String(it.correct_answer ?? ''))}</td></tr>`;
		}
		bodyEl.innerHTML = `
			<table class="pp-grading-items-table">
				<thead><tr><th>문항</th><th>정오</th><th>학생 답</th><th>정답</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>`;
	} catch (e) {
		bodyEl.innerHTML = `<p class="pp-grading-err">${escapeHtml(String(e.message || e))}</p>`;
	}
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
			.select('id, submission_date, file_name, file_size, status, created_at, grading_status')
			.eq('student_id', currentStudent.id)
			.gte('submission_date', startDate)
			.lte('submission_date', endDate)
			.in('status', ['uploaded', 'manual'])
			.order('created_at', { ascending: false });

		// 숙제 마감은 선생님 배정(grading_assignments, GET /api/homework-assignments)만 신뢰 — 수업 schedules로 폴백하지 않음
		const assignmentsPromise = (async () => {
			if (!GRADING_SERVER_URL_HW) return { ok: false, data: [] };
			try {
				const base = GRADING_SERVER_URL_HW.replace(/\/$/, '');
				const url = new URL(`${base}/api/homework-assignments`);
				url.searchParams.set('teacher_id', String(currentStudent.owner_user_id || ''));
				url.searchParams.set('student_id', String(currentStudent.id || ''));
				url.searchParams.set('date_from', startDate);
				url.searchParams.set('date_to', endDate);
				const res = await fetch(url.toString());
				const body = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
				return { ok: true, data: body?.data || [] };
			} catch (e) {
				console.warn('[parent-portal] assignments fetch failed:', e);
				return { ok: false, data: [] };
			}
		})();

		const [subResult, assignResult] = await Promise.all([subPromise, assignmentsPromise]);

		hwSubmissions = (subResult.error ? [] : subResult.data) || [];
		if (assignResult && assignResult.ok) {
			hwAssignments = assignResult.data || [];
			hwAssignmentsLoaded = true;
		} else {
			hwAssignments = [];
			hwAssignmentsLoaded = false;
		}

		await fetchHwPortalGradingMap();
	} catch (e) {
		console.error('Homework fetch error:', e);
		hwSubmissions = [];
		hwAssignments = [];
		hwAssignmentsLoaded = false;
		hwGradingBySubmissionId = {};
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

	const subMap = {};
	hwSubmissions.forEach(s => {
		if (!subMap[s.submission_date]) subMap[s.submission_date] = [];
		subMap[s.submission_date].push(s);
	});

	const useAssignments = !!hwAssignmentsLoaded;

	// 배정 맵: grading_assignments 기반(API /api/homework-assignments)
	const assignmentMap = {};
	if (useAssignments) {
		hwAssignments.forEach(a => {
			const dateStr = a?.due_date;
			if (!dateStr) return;
			const t = (a?.due_time ? String(a.due_time).slice(0, 5) : '').trim() || '23:59';
			if (!assignmentMap[dateStr] || t < assignmentMap[dateStr]) assignmentMap[dateStr] = t;
		});
	}

	const lastDay = new Date(hwYear, hwMonth + 1, 0);
	for (let d = 1; d <= lastDay.getDate(); d++) {
		const dateStr = `${hwYear}-${String(hwMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		const subs = subMap[dateStr] || [];

		if (!useAssignments) continue;

		// 배정 없는 날은 상태 엔트리 생성하지 않음(Q1)
		const hasAssignment = !!assignmentMap[dateStr];
		if (!hasAssignment) continue;

		const scheduleTime = assignmentMap[dateStr];

		const hasManual = subs.some(s => s.status === 'manual');
		if (hasManual) {
			hwDateStatus[dateStr] = { status: 'manual', scheduleTime };
			continue;
		}

		const uploadedSubs = subs.filter(s => s.status === 'uploaded');
		if (uploadedSubs.length === 0) {
			const [dh, dm] = (scheduleTime || '23:59').split(':').map(Number);
			const deadline = new Date(hwYear, hwMonth, d, dh, dm);
			hwDateStatus[dateStr] = deadline <= today
				? { status: 'missed', scheduleTime }
				: { status: 'pending', scheduleTime };
			continue;
		}

		const [sh, sm] = (scheduleTime || '23:59').split(':').map(Number);
		const deadlineMinutes = sh * 60 + sm;

		const hasOnTime = uploadedSubs.some(s => {
			const ct = new Date(s.created_at);
			const ctMinutes = ct.getHours() * 60 + ct.getMinutes();
			const ctDateStr = `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
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
		cell.dataset.date = dateStr;  // 학사일정 클라이언트가 cellSelector 로 활용
		// 셀 내부를 명시 구조화: 날짜 숫자 + 숙제 상태 아이콘 (이전엔 textContent 만 사용)
		cell.innerHTML = '';
		const dayNum = document.createElement('div');
		dayNum.className = 'hw-cal-day-num';
		dayNum.textContent = String(d);
		cell.appendChild(dayNum);
		// 숙제 제출 상태 → ○(제출) △(미흡) ✕(미제출) 직관 아이콘
		if (ds && !isFuture) {
			let icon = '', cls2 = '';
			if (ds.status === 'on_time' || ds.status === 'submitted' || ds.status === 'manual') {
				icon = '○'; cls2 = 'hw-icon-ok';
			} else if (ds.status === 'late') {
				icon = '△'; cls2 = 'hw-icon-late';
			} else if (ds.status === 'missed') {
				icon = '✕'; cls2 = 'hw-icon-miss';
			}
			if (icon) {
				const ic = document.createElement('div');
				ic.className = 'hw-cal-status-icon ' + cls2;
				ic.textContent = icon;
				ic.setAttribute('aria-label', ds.status);
				cell.appendChild(ic);
			}
		}

		if (!isFuture) {
			cell.onclick = () => selectHwDate(dateStr);
		}

		grid.appendChild(cell);
	}

	// 학생 학교의 학사일정을 cell 본문에 텍스트로 직접 표기 (호버 의존 X)
	if (window.AcademicEventsClient && currentStudent && currentStudent.school) {
		try {
			window.AcademicEventsClient.renderBadgesOnGrid({
				schoolName: currentStudent.school,
				gridEl: grid,
				cellSelector: '.hw-cal-cell[data-date]',
				dateExtractor: (cell) => cell.dataset.date,
				mode: 'text',
			});
		} catch (e) { console.warn('[acev] hw cal text err', e); }
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
		schedDiv.innerHTML = `<i class="fas fa-clock"></i> 제출 마감: ${ds.scheduleTime}`;
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

			const gs = String(sub.grading_status || '');
			if (gs === 'confirmed') {
				const g = hwGradingBySubmissionId[String(sub.id)];
				if (g) appendPortalGradingBlock(bodyEl, g, getPpPortalVerificationCode());
			} else if (gs === 'review_needed') {
				const pending = document.createElement('div');
				pending.className = 'hw-detail-grading-pending';
				pending.innerHTML = '<i class="fas fa-pen-to-square"></i> 선생님 검토·수정 중입니다. 확정 후 점수와 채점 이미지가 표시됩니다.';
				bodyEl.appendChild(pending);
			}
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
				setParentVerified();
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
				// 데이터 로드 — 출결 비노출
				switchTab('homework');
				Promise.all([
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

	// Teacher auth Enter key
	const teacherPw = document.getElementById('teacher-auth-password');
	if (teacherPw) teacherPw.addEventListener('keypress', e => { if (e.key === 'Enter') handleTeacherAuth(); });

	// Modal outside click
	['admin-auth-modal'].forEach(id => {
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
			closeTeacherAuthModal();
			closeAdminLoginModal();
		}
	});

	// Pre-load teacher list
	loadTeacherAuthList();
});
