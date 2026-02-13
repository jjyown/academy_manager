// 학생 출결 조회 시스템 - 학부모 포털
console.log('[report.js] 파일 로드 시작');

// ========== Supabase 초기화 ==========
const SUPABASE_URL = 'https://jzcrpdeomjmytfekcgqu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6X3mtsIpdMkLWgo9aUbZTg_ihtAA3cu';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		persistSession: false,
		autoRefreshToken: false,
		detectSessionInUrl: false
	}
});

let currentStudent = null;
let html5QrcodeScanner = null;
let currentFacingMode = "environment"; // 카메라 방향
let pendingEvaluationSave = false;
let teacherAuthList = [];
let authorizedTeacher = null;
let parentVerifiedStudentId = null;

function normalizePhone(value) {
	return String(value || '').replace(/\D/g, '');
}

function normalizeName(value) {
	return String(value || '').trim().toLowerCase();
}

function formatPhone(value) {
	const digits = normalizePhone(value).slice(0, 11);
	if (digits.length <= 3) return digits;
	if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
	return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function getEmptyStateElement() {
	return document.getElementById('empty-state');
}

// ========== 검색 함수 ==========
async function handleSearch() {
	const nameInput = document.getElementById('search-name');
	const phoneInput = document.getElementById('search-phone');
	const name = nameInput.value.trim();
	const phoneRaw = phoneInput.value.trim();
	const phoneDigits = normalizePhone(phoneRaw);

	if (!name || !phoneRaw) {
		showAlert('학생 이름과 전화번호를 모두 입력해주세요', 'info');
		return;
	}

	if (phoneDigits.length < 8) {
		showAlert('전화번호를 정확히 입력해주세요', 'info');
		return;
	}

	showLoading();

	try {
		console.log('[검색] 이름:', name, '전화번호:', phoneDigits);
        
		const nameKey = normalizeName(name);
		let candidates = [];

		// 1) 이름으로 먼저 조회
		const { data: nameData, error: nameError } = await supabaseClient
			.from('students')
			.select('id, name, school, grade, phone, parent_phone, owner_user_id, teacher_id, qr_code_data')
			.ilike('name', `%${name}%`);

		console.log('[검색 결과-이름] 에러:', nameError, '데이터:', nameData);

		if (nameError) throw nameError;
		if (Array.isArray(nameData) && nameData.length > 0) {
			candidates = nameData;
		}

		// 2) 이름 결과가 없으면 전화번호로 보조 조회
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
				.select('id, name, school, grade, phone, parent_phone, owner_user_id, teacher_id, qr_code_data')
				.or(orQuery);

			console.log('[검색 결과-전화] 에러:', phoneError, '데이터:', phoneData);
			if (phoneError) throw phoneError;
			if (Array.isArray(phoneData) && phoneData.length > 0) {
				candidates = phoneData;
			}
		}

		const matched = (candidates || []).find(student => {
			const studentName = normalizeName(student.name || '');
			if (!studentName || !studentName.includes(nameKey)) return false;
			const studentPhone = normalizePhone(student.phone || '');
			const parentPhone = normalizePhone(student.parent_phone || '');
			const phoneList = [studentPhone, parentPhone].filter(Boolean);
			return phoneList.some(storedPhone => (
				storedPhone === phoneDigits
				|| storedPhone.endsWith(phoneDigits)
				|| phoneDigits.endsWith(storedPhone)
			));
		});

		if (!matched) {
			showAlert('이름과 전화번호가 일치하지 않습니다', 'info');
			document.getElementById('result-section').classList.remove('active');
			const emptyState = getEmptyStateElement();
			if (emptyState) {
				emptyState.style.display = 'block';
			}
			return;
		}

		currentStudent = matched;
		await displayStudentInfo();
        
		showAlert(`${currentStudent.name} 학생의 정보를 조회했습니다`, 'success');
	} catch (error) {
		console.error('검색 오류:', error);
		showAlert('검색 중 오류가 발생했습니다', 'error');
	}
}

// ========== QR 스캔 함수 ==========
function openQRScanner() {
	document.getElementById('qr-modal').classList.add('active');
	startQRScanner();
}

function closeQRScanner() {
	document.getElementById('qr-modal').classList.remove('active');
	stopQRScanner();
}

async function startQRScanner() {
	try {
		// 기존 스캐너 중지
		if (html5QrcodeScanner) {
			try {
				await html5QrcodeScanner.stop();
			} catch (e) {
				// 무시
			}
			html5QrcodeScanner = null;
		}

		html5QrcodeScanner = new Html5Qrcode("qr-reader");
		const config = {
			fps: 10,
			qrbox: { width: 250, height: 250 },
			rememberLastUsedCamera: true,
			facingMode: currentFacingMode
		};

		await html5QrcodeScanner.start(
			{ facingMode: currentFacingMode },
			config,
			onQRCodeSuccess,
			onQRCodeError
		);

		console.log('[QR 스캔] 시작 - 카메라:', currentFacingMode);
	} catch (error) {
		console.error('[QR 스캔] 시작 오류:', error);
		showAlert('카메라를 사용할 수 없습니다. 권한을 확인해주세요.', 'error');
	}
}

function stopQRScanner() {
	if (html5QrcodeScanner) {
		html5QrcodeScanner.stop()
			.then(() => {
				html5QrcodeScanner = null;
			})
			.catch(() => {
				html5QrcodeScanner = null;
			});
	}
}

function toggleCamera() {
	currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
	startQRScanner();
}

async function onQRCodeSuccess(decodedText, decodedResult) {
	console.log('[QR 스캔] 성공:', decodedText);

	// QR 코드 형식: STUDENT_[ID]_[TOKEN]
	const match = decodedText.match(/STUDENT_(\d+)_/);
    
	if (!match) {
		showAlert('유효한 QR 코드가 아닙니다', 'error');
		return;
	}

	const studentId = match[1];
	const token = decodedText.split('_').slice(2).join('_');

	try {
		const { data: student, error } = await supabaseClient
			.from('students')
			.select('id, name, school, grade, phone, parent_phone, owner_user_id, teacher_id, qr_code_data')
			.eq('id', studentId)
			.maybeSingle();

		if (error) throw error;
		if (!student) {
			showAlert('등록되지 않은 학생입니다', 'error');
			return;
		}

		if (student.qr_code_data && token && student.qr_code_data !== token) {
			showAlert('유효하지 않은 QR 코드입니다', 'error');
			return;
		}

		currentStudent = student;
        
		// 모달 닫기
		document.getElementById('qr-modal').classList.remove('active');
		if (html5QrcodeScanner) {
			html5QrcodeScanner.stop().catch(() => {});
			html5QrcodeScanner = null;
		}
        
		await displayStudentInfo();
		showAlert(`${currentStudent.name} 학생의 정보를 조회했습니다`, 'success');
	} catch (error) {
		console.error('QR 스캔 처리 오류:', error);
		showAlert('QR 코드 처리 중 오류가 발생했습니다', 'error');
	}
}

function onQRCodeError(errorMessage) {
	// 에러를 계속 스캔하도록 무시
	console.debug('[QR 스캔] 에러:', errorMessage);
}

// ========== 학생 정보 표시 ==========
async function displayStudentInfo() {
	if (!currentStudent) return;

	// 검색 결과 섹션 표시
	document.getElementById('result-section').classList.add('active');
	const emptyState = getEmptyStateElement();
	if (emptyState) {
		emptyState.style.display = 'none';
	}

	// 학생 정보 표시
	document.getElementById('student-name').textContent = currentStudent.name;
	const displayPhone = currentStudent.parent_phone || currentStudent.phone || '미등록';
	document.getElementById('student-phone').textContent = `📞 ${displayPhone}`;

	// 월 선택기 초기화 (현재 월)
	const today = new Date();
	const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
	document.getElementById('month-selector').value = monthStr;
	updateEvaluationMonthLabel(monthStr);
    
	// 출결 데이터 가져오기
	await displayMonthlyAttendance(monthStr);

	// 출석률 통계 표시 (최근 30일)
	await displayAttendanceStats();

	// 종합 평가 섹션 표시
	document.getElementById('evaluation-section').classList.add('active');

	// 학부모 인증 상태 반영
	updateEvaluationLockState();
	if (isParentVerified()) {
		await loadEvaluation(monthStr);
	}

	// 검색창 초기화
	document.getElementById('search-name').value = currentStudent.name || '';
	document.getElementById('search-phone').value = currentStudent.parent_phone || currentStudent.phone || '';
}

// ========== 월별 출결 기록 조회 ==========
async function displayMonthlyAttendance(monthStr) {
	if (!currentStudent) return;

	showLoading();

	try {
		const [year, month] = monthStr.split('-');
		const startDate = `${year}-${month}-01`;
		const lastDay = new Date(year, month, 0).getDate();
		const endDate = `${year}-${month}-${lastDay}`;

		const { data: records, error } = await supabaseClient
			.from('attendance_records')
			.select('id, student_id, teacher_id, attendance_date, status, scheduled_time, check_in_time, qr_scanned, memo')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', startDate)
			.lte('attendance_date', endDate)
			.order('attendance_date', { ascending: false });

		if (error) throw error;

		const attendanceList = document.getElementById('attendance-list');
		attendanceList.innerHTML = '';

		if (!records || records.length === 0) {
			attendanceList.innerHTML = `
				<div class="empty-state">
					<p>${year}년 ${month}월 출결 기록이 없습니다</p>
				</div>
			`;
			await displayMonthlyStats(monthStr);
			hideLoading();
			return;
		}

		// 담당 선생님 기준 분리
		const primaryTeacherId = currentStudent.teacher_id ? String(currentStudent.teacher_id) : '';
		const primaryByDate = new Map();
		const otherByDate = new Map();

		records.forEach(r => {
			const key = r.attendance_date;
			if (primaryTeacherId && String(r.teacher_id) === primaryTeacherId) {
				if (!primaryByDate.has(key)) primaryByDate.set(key, []);
				primaryByDate.get(key).push(r);
			} else {
				if (!otherByDate.has(key)) otherByDate.set(key, []);
				otherByDate.get(key).push(r);
			}
		});

		// 담당 선생님 기록이 있는 날짜 (+ 담당만 있는 게 아니라 전체 날짜도 포함)
		const allDates = new Set([...primaryByDate.keys(), ...otherByDate.keys()]);
		const dateList = Array.from(allDates).sort((a, b) => new Date(b) - new Date(a));

		const getTeacherName = (tid) => {
			const t = teacherAuthList.find(t => String(t.id) === String(tid));
			return t ? t.name : `선생님`;
		};

		dateList.forEach(dateKey => {
			const myRecords = primaryByDate.get(dateKey) || [];
			const otherRecords = otherByDate.get(dateKey) || [];
			const primaryRecord = myRecords[0] || null;
			const displayRecord = primaryRecord || otherRecords[0] || null;
			if (!displayRecord) return;

			const date = new Date(dateKey);
			const formattedDate = date.toLocaleDateString('ko-KR', {
				month: '2-digit', day: '2-digit', weekday: 'short'
			});

			const time = getAttendanceTimeLabel(displayRecord);
			const status = displayRecord.status || '';

			let statusClass = 'status-absent';
			let statusText = '결석';
			let statusIcon = '❌';
			if (status === 'present') { statusClass = 'status-present'; statusText = '출석'; statusIcon = '✅'; }
			else if (status === 'late') { statusClass = 'status-late'; statusText = '지각'; statusIcon = '⏰'; }
			else if (status === 'makeup' || status === 'etc') { statusClass = 'status-makeup'; statusText = '보강'; statusIcon = '🔁'; }

			// 호버 툴팁 (다른 선생님 일정이 있는 경우)
			const hasOther = otherRecords.length > 0 && primaryRecord;
			let tooltipHtml = '';
			if (hasOther) {
				const myName = getTeacherName(primaryTeacherId);
				const myTime = getAttendanceTimeLabel(primaryRecord);
				const myStatusInfo = ppGetStatusInfo(primaryRecord.status);

				let items = `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><span style="font-weight:700;color:#93c5fd;">${myName}</span><span style="color:#94a3b8;font-size:12px;">${myTime}</span><span style="background:${myStatusInfo.color};color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${myStatusInfo.label}</span></div>`;

				const otherTeacherIds = [...new Set(otherRecords.map(r => String(r.teacher_id)))];
				otherTeacherIds.forEach(tid => {
					const rec = otherRecords.find(r => String(r.teacher_id) === tid);
					if (!rec) return;
					const tName = getTeacherName(tid);
					const tTime = getAttendanceTimeLabel(rec);
					const tInfo = ppGetStatusInfo(rec.status);
					items += `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;"><span style="font-weight:600;color:#e2e8f0;">${tName}</span><span style="color:#94a3b8;font-size:12px;">${tTime}</span><span style="background:${tInfo.color};color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${tInfo.label}</span></div>`;
				});

				tooltipHtml = `<div class="pp-day-tooltip" style="display:none;position:absolute;bottom:calc(100% + 8px);left:12px;background:#1e293b;color:white;padding:12px 14px;border-radius:10px;font-size:13px;min-width:220px;max-width:300px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.25);line-height:1.5;"><div style="font-weight:700;margin-bottom:6px;font-size:12px;color:#94a3b8;">${formattedDate} 전체 일정</div>${items}<div style="position:absolute;bottom:-6px;left:24px;width:12px;height:12px;background:#1e293b;rotate:45deg;border-radius:2px;"></div></div>`;
			}

			const item = document.createElement('div');
			item.className = 'attendance-item';
			if (hasOther) {
				item.setAttribute('data-has-tooltip', 'true');
				item.style.position = 'relative';
				item.style.cursor = 'pointer';
			}
			item.innerHTML = `
				${tooltipHtml}
				<div class="attendance-date">${formattedDate}</div>
				<div class="attendance-time">${time}</div>
				<div class="attendance-status ${statusClass}">${statusIcon} ${statusText}</div>
			`;
			attendanceList.appendChild(item);
		});

		// 호버 툴팁 이벤트 바인딩
		attendanceList.querySelectorAll('.attendance-item[data-has-tooltip="true"]').forEach(row => {
			const tooltip = row.querySelector('.pp-day-tooltip');
			if (!tooltip) return;
			row.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
			row.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				const isVisible = tooltip.style.display === 'block';
				attendanceList.querySelectorAll('.pp-day-tooltip').forEach(t => t.style.display = 'none');
				tooltip.style.display = isVisible ? 'none' : 'block';
			});
		});
		attendanceList.addEventListener('click', (e) => {
			if (e.target.closest('.attendance-item[data-has-tooltip="true"]')) return;
			attendanceList.querySelectorAll('.pp-day-tooltip').forEach(t => t.style.display = 'none');
		});

		await displayMonthlyStats(monthStr);
		hideLoading();
	} catch (error) {
		console.error('월별 출결 기록 조회 오류:', error);
		showAlert('출결 기록을 불러올 수 없습니다', 'error');
	}
}

// 학부모 포털용 상태 정보 헬퍼
function ppGetStatusInfo(status) {
	switch (status) {
		case 'present': return { label: '출석', color: '#10b981' };
		case 'late': return { label: '지각', color: '#f59e0b' };
		case 'absent': return { label: '결석', color: '#ef4444' };
		case 'makeup': case 'etc': return { label: '보강', color: '#8b5cf6' };
		default: return { label: '미처리', color: '#94a3b8' };
	}
}

// ========== 월별 통계 ==========
async function displayMonthlyStats(monthStr) {
	if (!currentStudent) return;

	try {
		const [year, month] = monthStr.split('-');
		const startDate = `${year}-${month}-01`;
		const lastDay = new Date(year, month, 0).getDate();
		const endDate = `${year}-${month}-${lastDay}`;

		const { data: records, error } = await supabaseClient
			.from('attendance_records')
			.select('status, attendance_date, check_in_time, created_at')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', startDate)
			.lte('attendance_date', endDate);

		if (error) throw error;

		const normalized = normalizeAttendanceRecordsByDate(records || []);

		const stats = {
			present: 0,
			late: 0,
			absent: 0,
			total: normalized?.length || 0
		};

		normalized?.forEach(record => {
			if (record.status === 'present' || record.status === 'makeup') {
				stats.present++;
			} else if (record.status === 'late') {
				stats.late++;
			} else {
				stats.absent++;
			}
		});

		const monthlyRate = stats.total > 0 
			? Math.round((stats.present / stats.total) * 100)
			: 0;

		document.getElementById('monthly-rate').textContent = `${monthlyRate}%`;
		document.getElementById('monthly-present').textContent = stats.present;
		document.getElementById('monthly-late').textContent = stats.late;
		document.getElementById('monthly-absent').textContent = stats.absent;
	} catch (error) {
		console.error('월별 통계 조회 오류:', error);
	}
}

// ========== 월 선택 함수 ==========
function handleMonthChange() {
	const monthSelector = document.getElementById('month-selector');
	const selectedMonth = monthSelector.value;
	if (selectedMonth && currentStudent) {
		updateEvaluationMonthLabel(selectedMonth);
		displayMonthlyAttendance(selectedMonth);
		loadEvaluation(selectedMonth);
	}
}

function handlePrevMonth() {
	const monthSelector = document.getElementById('month-selector');
	const [year, month] = monthSelector.value.split('-');
	let prevMonth = parseInt(month) - 1;
	let prevYear = parseInt(year);
    
	if (prevMonth < 1) {
		prevMonth = 12;
		prevYear -= 1;
	}
    
	monthSelector.value = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
	handleMonthChange();
}

function handleNextMonth() {
	const monthSelector = document.getElementById('month-selector');
	const [year, month] = monthSelector.value.split('-');
	let nextMonth = parseInt(month) + 1;
	let nextYear = parseInt(year);
    
	if (nextMonth > 12) {
		nextMonth = 1;
		nextYear += 1;
	}
    
	monthSelector.value = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
	handleMonthChange();
}

function updateEvaluationMonthLabel(monthStr) {
	const label = document.getElementById('evaluation-month');
	if (!label) return;
	const [year, month] = monthStr.split('-');
	label.textContent = `${year}년 ${parseInt(month)}월`;
}

// ========== 학부모 인증 ==========
function isParentVerified() {
	if (!currentStudent) return false;
	const key = `parent_verified__${currentStudent.id}`;
	return sessionStorage.getItem(key) === 'true';
}

function setParentVerified() {
	if (!currentStudent) return;
	const key = `parent_verified__${currentStudent.id}`;
	sessionStorage.setItem(key, 'true');
}

function updateEvaluationLockState() {
	const lock = document.getElementById('evaluation-lock');
	const content = document.getElementById('evaluation-content');
	if (!lock || !content) return;
	if (isParentVerified()) {
		lock.style.display = 'none';
		content.classList.remove('hidden');
	} else {
		lock.style.display = 'block';
		content.classList.add('hidden');
		document.getElementById('evaluation-textarea').value = '';
		updateCharCount();
	}
}

function openParentAuthModal() {
	const modal = document.getElementById('parent-auth-modal');
	if (modal) modal.classList.add('active');
	const input = document.getElementById('parent-auth-password');
	if (input) input.focus();
}

function closeParentAuthModal() {
	const modal = document.getElementById('parent-auth-modal');
	if (modal) modal.classList.remove('active');
	const input = document.getElementById('parent-auth-password');
	if (input) input.value = '';
}

async function handleParentAuth() {
	if (!currentStudent) return;
	const password = document.getElementById('parent-auth-password')?.value.trim();
	if (!password) {
		showAlert('학부모 비밀번호를 입력해주세요', 'info');
		return;
	}

	try {
		const parentPhone = normalizePhone(currentStudent.parent_phone || currentStudent.phone || '');
		console.log('[학부모 인증] 전화번호:', parentPhone);
		if (parentPhone.length < 11) {
			showAlert('학부모 전화번호가 등록되지 않았습니다', 'info');
			return;
		}
		// 010-4539-7459 → 가운데 블록 뒤 2자리(39) + 마지막 블록 앞 2자리(74) = 3974
		const middle2 = parentPhone.slice(5, 7); // 가운데 블록 뒤 2자리
		const last2 = parentPhone.slice(7, 9);   // 마지막 블록 앞 2자리
		const expected = middle2 + last2;
		console.log('[학부모 인증] 가운데뒤2:', middle2, '마지막앞2:', last2, '→ 변환:', expected);
		console.log('[학부모 인증] 입력값:', password);
		if (password !== expected) {
			showAlert('비밀번호가 일치하지 않습니다', 'error');
			return;
		}

		setParentVerified();
		closeParentAuthModal();
		updateEvaluationLockState();
		const monthStr = document.getElementById('month-selector')?.value;
		if (monthStr) {
			await loadEvaluation(monthStr);
		}
		showAlert('학부모 인증 완료', 'success');
	} catch (error) {
		console.error('학부모 인증 오류:', error);
		showAlert('학부모 인증에 실패했습니다', 'error');
	}
}

// ========== 선생님 인증 (종합평가 저장용) ==========
async function hashPin(pin) {
	const enc = new TextEncoder().encode(pin);
	const hash = await crypto.subtle.digest('SHA-256', enc);
	return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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
	} catch (error) {
		console.error('선생님 목록 로드 오류:', error);
		showAlert('선생님 목록을 불러올 수 없습니다', 'error');
	}
}

function openTeacherAuthModal() {
	const modal = document.getElementById('admin-auth-modal');
	if (modal) modal.classList.add('active');
	loadTeacherAuthList();
	const select = document.getElementById('teacher-auth-select');
	if (select) select.focus();
}

function closeTeacherAuthModal() {
	const modal = document.getElementById('admin-auth-modal');
	if (modal) modal.classList.remove('active');
	const pwInput = document.getElementById('teacher-auth-password');
	if (pwInput) pwInput.value = '';
}

function getAuthorizedTeacher() {
	if (authorizedTeacher) return authorizedTeacher;
	const storedId = sessionStorage.getItem('parent_portal_teacher_id');
	if (!storedId) return null;
	const teacher = teacherAuthList.find(t => String(t.id) === String(storedId));
	if (teacher) return teacher;
	return null;
}

async function handleTeacherAuth() {
	const teacherId = document.getElementById('teacher-auth-select')?.value;
	const password = document.getElementById('teacher-auth-password')?.value.trim();

	if (!teacherId) {
		showAlert('선생님을 선택해주세요', 'info');
		return;
	}
	if (!password) {
		showAlert('비밀번호를 입력해주세요', 'info');
		return;
	}

	const teacher = teacherAuthList.find(t => String(t.id) === String(teacherId));
	if (!teacher) {
		showAlert('선택한 선생님을 찾을 수 없습니다', 'error');
		return;
	}

	try {
		const inputHash = await hashPin(password);
		if (inputHash !== teacher.pin_hash) {
			showAlert('비밀번호가 일치하지 않습니다', 'error');
			return;
		}

		authorizedTeacher = teacher;
		sessionStorage.setItem('parent_portal_teacher_id', teacher.id);
		closeTeacherAuthModal();
		showAlert('선생님 인증 완료', 'success');

		if (pendingEvaluationSave) {
			pendingEvaluationSave = false;
			await saveEvaluation();
		}
	} catch (error) {
		console.error('선생님 인증 오류:', error);
		showAlert('선생님 인증에 실패했습니다', 'error');
	}
}

// ========== 기존 출결 기록 표시 함수 ==========

function createAttendanceItem(record) {
	const item = document.createElement('div');
	item.className = 'attendance-item';

	const recordDate = record.attendance_date || record.date;
	const date = recordDate ? new Date(recordDate) : null;
	const formattedDate = date
		? date.toLocaleDateString('ko-KR', {
			month: '2-digit',
			day: '2-digit',
			weekday: 'short'
		})
		: '-';

	const time = getAttendanceTimeLabel(record);
	const scheduleHint = record.scheduled_time || record.time;
	if (scheduleHint) {
		item.title = formatKoreanTimeLabel(scheduleHint);
	}
    
	let statusClass = 'status-absent';
	let statusText = '결석';
	let statusIcon = '❌';

	if (record.status === 'present') {
		statusClass = 'status-present';
		statusText = '출석';
		statusIcon = '✅';
	} else if (record.status === 'late') {
		statusClass = 'status-late';
		statusText = '지각';
		statusIcon = '⏰';
	} else if (record.status === 'makeup' || record.status === 'etc') {
		statusClass = 'status-makeup';
		statusText = '보강';
		statusIcon = '🔁';
	}

	item.innerHTML = `
		<div class="attendance-date">${formattedDate}</div>
		<div class="attendance-time">${time}</div>
		<div class="attendance-status ${statusClass}">${statusIcon} ${statusText}</div>
	`;

	return item;
}

// ========== 출석률 통계 ==========
async function displayAttendanceStats() {
	if (!currentStudent) return;

	try {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		const isoDate = thirtyDaysAgo.toISOString().split('T')[0];

		const { data: records, error } = await supabaseClient
			.from('attendance_records')
			.select('status, attendance_date, check_in_time, created_at')
			.eq('student_id', String(currentStudent.id))
			.gte('attendance_date', isoDate);

		if (error) throw error;

		const normalized = normalizeAttendanceRecordsByDate(records || []);

		const stats = {
			present: 0,
			late: 0,
			absent: 0,
			total: normalized?.length || 0
		};

		normalized?.forEach(record => {
			if (record.status === 'present' || record.status === 'makeup') {
				stats.present++;
			} else if (record.status === 'late') {
				stats.late++;
			} else {
				stats.absent++;
			}
		});

		const attendanceRate = stats.total > 0 
			? Math.round((stats.present / stats.total) * 100)
			: 0;

		const statsContainer = document.getElementById('attendance-stats');
		statsContainer.innerHTML = `
			<div class="stat-item">
				<div class="stat-value">${attendanceRate}%</div>
				<div class="stat-label">출석률</div>
			</div>
			<div class="stat-item">
				<div class="stat-value">${stats.present}</div>
				<div class="stat-label">출석</div>
			</div>
			<div class="stat-item">
				<div class="stat-value">${stats.late}</div>
				<div class="stat-label">지각</div>
			</div>
		`;
	} catch (error) {
		console.error('통계 조회 오류:', error);
	}
}

function normalizeAttendanceRecordsByDate(records) {
	return (records || []).slice().sort((a, b) => {
		const dateA = a.attendance_date ? new Date(a.attendance_date).getTime() : 0;
		const dateB = b.attendance_date ? new Date(b.attendance_date).getTime() : 0;
		if (dateA !== dateB) return dateB - dateA;
		return getRecordTimeMs(a) - getRecordTimeMs(b);
	});
}

function getRecordTimeMs(record) {
	if (record.check_in_time) return new Date(record.check_in_time).getTime();
	if (record.qr_scan_time) return new Date(record.qr_scan_time).getTime();
	if (record.scheduled_time) return getScheduledTimeMs(record.attendance_date, record.scheduled_time);
	if (record.time) return getScheduledTimeMs(record.attendance_date, record.time);
	const timeVal = record.updated_at || record.created_at || null;
	return timeVal ? new Date(timeVal).getTime() : 0;
}

function getAttendanceTimeLabel(record) {
	if (record.scheduled_time) {
		return formatKoreanTimeLabel(record.scheduled_time);
	}
	if (record.time) {
		return formatKoreanTimeLabel(record.time);
	}
	if (record.check_in_time) {
		return new Date(record.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
	}
	if (record.qr_scan_time) {
		return new Date(record.qr_scan_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
	}
	return '-';
}

function formatKoreanTimeLabel(timeStr) {
	if (!timeStr) return '-';
	const base = new Date('2000-01-01T00:00:00');
	const [h, m] = String(timeStr).split(':').map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return String(timeStr).substring(0, 5);
	base.setHours(h, m, 0, 0);
	return base.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function getScheduledTimeMs(dateStr, timeStr) {
	if (!timeStr) return 0;
	const baseDate = dateStr ? new Date(dateStr) : new Date();
	const [h, m] = String(timeStr).split(':').map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return baseDate.getTime();
	const next = new Date(baseDate);
	next.setHours(h, m, 0, 0);
	return next.getTime();
}

// ========== 종합 평가 저장/로드 ==========
async function loadEvaluation(monthStr) {
	if (!currentStudent) return;
	if (!isParentVerified()) return;

	const targetMonth = monthStr || document.getElementById('month-selector')?.value;
	if (!targetMonth) return;

	try {
		const { data: evaluation, error } = await supabaseClient
			.from('student_evaluations')
			.select('comment')
			.eq('student_id', currentStudent.id)
			.eq('eval_month', targetMonth)
			.maybeSingle();

		if (error && error.code !== 'PGRST116') { // PGRST116 = 레코드 없음
			throw error;
		}

		const textarea = document.getElementById('evaluation-textarea');
		textarea.value = evaluation?.comment || '';
		updateCharCount();
	} catch (error) {
		console.error('평가 로드 오류:', error);
	}
}

async function saveEvaluation() {
	if (!currentStudent) return;

	const comment = document.getElementById('evaluation-textarea').value.trim();
	const monthStr = document.getElementById('month-selector')?.value;

	if (!monthStr) {
		showAlert('월을 선택해주세요', 'info');
		return;
	}

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
			}, {
				onConflict: 'student_id,eval_month'
			});

		if (error) throw error;

		showAlert('평가가 저장되었습니다', 'success');
	} catch (error) {
		console.error('평가 저장 오류:', error);
		showAlert('평가 저장에 실패했습니다', 'error');
	}
}

function resetEvaluation() {
	if (confirm('평가 내용을 초기화하시겠습니까?')) {
		document.getElementById('evaluation-textarea').value = '';
		updateCharCount();
	}
}

function updateCharCount() {
	const textarea = document.getElementById('evaluation-textarea');
	const charCount = document.getElementById('char-count');
	charCount.textContent = textarea.value.length;
}

// ========== 알림 함수 ==========
function showAlert(message, type = 'info') {
	const container = document.getElementById('alert-container');
	const alert = document.createElement('div');
	alert.className = `alert alert-${type} show`;
	alert.textContent = message;

	container.innerHTML = '';
	container.appendChild(alert);

	// 3초 후 자동 삭제
	setTimeout(() => {
		alert.classList.remove('show');
		setTimeout(() => alert.remove(), 300);
	}, 3000);
}

function showLoading() {
	const attendanceList = document.getElementById('attendance-list');
	attendanceList.innerHTML = `
		<div class="loading">
			<div class="spinner"></div>
			<p>로딩 중...</p>
		</div>
	`;
}

function hideLoading() {
	// 로딩 상태 제거
}

// ========== 이벤트 리스너 ==========
document.addEventListener('DOMContentLoaded', () => {
	console.log('[report.js] DOM 로드 완료');

	// 검색창 엔터 키
	['search-name', 'search-phone'].forEach(id => {
		const input = document.getElementById(id);
		if (!input) return;
		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				handleSearch();
			}
		});
	});

	// 전화번호 입력 자동 하이픈
	const phoneInput = document.getElementById('search-phone');
	if (phoneInput) {
		phoneInput.addEventListener('input', (e) => {
			const formatted = formatPhone(e.target.value);
			if (e.target.value !== formatted) {
				e.target.value = formatted;
			}
		});
	}

	// 평가 textarea 글자수 표시
	document.getElementById('evaluation-textarea').addEventListener('input', updateCharCount);

	// 모달 외부 클릭 시 닫기
	document.getElementById('qr-modal').addEventListener('click', (e) => {
		if (e.target.id === 'qr-modal') {
			closeQRScanner();
		}
	});

	const adminModal = document.getElementById('admin-auth-modal');
	if (adminModal) {
		adminModal.addEventListener('click', (e) => {
			if (e.target.id === 'admin-auth-modal') {
				closeTeacherAuthModal();
			}
		});
	}

	const parentModal = document.getElementById('parent-auth-modal');
	if (parentModal) {
		parentModal.addEventListener('click', (e) => {
			if (e.target.id === 'parent-auth-modal') {
				closeParentAuthModal();
			}
		});
	}

	// ESC 키로 모달 닫기
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeQRScanner();
			closeTeacherAuthModal();
			closeParentAuthModal();
		}
	});
});

// ========== 정리 함수 ==========
window.addEventListener('beforeunload', () => {
	stopQRScanner();
});

console.log('[report.js] 로드 완료');
