// QR 출석 관리 시스템

// QR 스캐너 인스턴스
let html5QrcodeScanner = null;
let currentStudentForAttendance = null;
let currentFacingMode = "environment"; // "environment" (후방) 또는 "user" (전방)

// ========== QR 코드 생성 ==========

// 학생별 고유 QR 코드 데이터 생성
window.generateQRCodeData = function(studentId) {
    // 형식: STUDENT_<UUID>_<현재시간타임스탬프>
    return `STUDENT_${studentId}_${Date.now()}`;
}

// QR 코드 이미지 생성
window.generateQRCode = function(containerId, qrData, size = 200) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // 기존 QR 코드 제거
    container.innerHTML = '';
    
    // QRCode.js 라이브러리 사용
    new QRCode(container, {
        text: qrData,
        width: size,
        height: size,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

// ========== QR 스캔 페이지 ==========

// QR 스캔 페이지 열기
window.openQRScanPage = function() {
    console.log('[openQRScanPage] QR 스캔 페이지 열기');
    
    // 모달 닫기
    closeModal('qr-attendance-modal');
    
    // QR 스캔 페이지 표시
    document.getElementById('qr-scan-page').style.display = 'flex';
    document.getElementById('qr-scan-result').style.display = 'none';
    
    // QR 스캐너 즉시 시작
    setTimeout(() => {
        startQRScanner();
    }, 100);
}

// 카메라 전환 (전방 ↔ 후방)
window.switchCamera = async function() {
    console.log('[switchCamera] 카메라 전환 시작');
    
    if (!html5QrcodeScanner) {
        console.warn('[switchCamera] 실행 중인 스캐너가 없습니다');
        return;
    }
    
    try {
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
        alert('카메라 전환에 실패했습니다.');
    }
}

// QR 스캔 페이지 닫기
window.closeQRScanPage = function() {
    console.log('[closeQRScanPage] QR 스캔 페이지 닫기');
    
    // 스캐너 중지
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            console.log('[closeQRScanPage] 스캐너 중지 완료');
            html5QrcodeScanner.clear().then(() => {
                console.log('[closeQRScanPage] 스캐너 정리 완료');
            }).catch(err => {
                console.error('[closeQRScanPage] 스캐너 정리 실패:', err);
            });
        }).catch(err => {
            console.error('[closeQRScanPage] 스캐너 중지 실패:', err);
        });
        html5QrcodeScanner = null;
    }
    
    // 카메라 모드 초기화 (다음에 열 때 후방 카메라로)
    currentFacingMode = "environment";
    
    // 페이지 숨기기
    document.getElementById('qr-scan-page').style.display = 'none';
}

// QR 스캐너 시작
function startQRScanner() {
    if (html5QrcodeScanner) {
        console.log('[startQRScanner] 이미 실행 중인 스캐너가 있습니다');
        return;
    }
    
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 }
    };
    
    html5QrcodeScanner = new Html5Qrcode("qr-reader");
    
    html5QrcodeScanner.start(
        { facingMode: currentFacingMode }, // 현재 설정된 카메라 사용
        config,
        onQRScanSuccess,
        onQRScanFailure
    ).catch(err => {
        console.error('[startQRScanner] 카메라 시작 실패:', err);
        alert('카메라를 시작할 수 없습니다. 카메라 권한을 확인해주세요.');
    });
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
        alert('QR 코드를 읽을 수 없습니다. 다시 시도해주세요.');
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
async function processAttendanceFromQR(qrData) {
    try {
        console.log('[processAttendanceFromQR] === 출석 처리 시작 ===');
        console.log('[processAttendanceFromQR] 스캔된 QR 데이터:', qrData);
        console.log('[processAttendanceFromQR] QR 데이터 타입:', typeof qrData);
        console.log('[processAttendanceFromQR] QR 데이터 길이:', qrData ? qrData.length : 0);
        
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
        
        // 3. 학생 ID 추출
        const dataWithoutPrefix = qrData.substring(8); // "STUDENT_" 제거
        console.log('[processAttendanceFromQR] Prefix 제거 후:', dataWithoutPrefix);
        
        const firstUnderscoreIndex = dataWithoutPrefix.indexOf('_');
        
        if (firstUnderscoreIndex === -1) {
            console.error('[processAttendanceFromQR] 언더스코어를 찾을 수 없음');
            throw new Error('QR 코드 형식이 올바르지 않습니다.');
        }
        
        const studentId = dataWithoutPrefix.substring(0, firstUnderscoreIndex);
        console.log('[processAttendanceFromQR] 추출된 학생 ID:', studentId);
        console.log('[processAttendanceFromQR] 현재 선생님 ID:', currentTeacherId);
        console.log('[processAttendanceFromQR] currentTeacherStudents 수:', currentTeacherStudents.length);
        
        // 4. 학생 정보 조회
        let student = currentTeacherStudents.find(s => String(s.id) === String(studentId));
        
        console.log('[processAttendanceFromQR] currentTeacherStudents에서 찾기:', !!student);
        
        if (!student) {
            // 전체 students 배열에서 찾기
            student = students.find(s => String(s.id) === String(studentId));
            console.log('[processAttendanceFromQR] students 배열에서 찾기:', !!student);
        }
        
        if (!student) {
            console.error('[processAttendanceFromQR] 학생을 찾을 수 없음. ID:', studentId);
            console.error('[processAttendanceFromQR] 사용 가능한 학생 IDs:', currentTeacherStudents.map(s => s.id));
            showQRScanToast(null, 'unregistered', null);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        console.log('[processAttendanceFromQR] 학생 찾음:', student.name);
        
        // 5. 오늘 날짜
        const today = new Date();
        const dateStr = formatDateToYYYYMMDD(today);
        console.log('[processAttendanceFromQR] 오늘 날짜:', dateStr);
        
        // 5-1. 이미 처리된 출석인지 확인
        if (student.attendance && student.attendance[dateStr]) {
            const existingStatus = student.attendance[dateStr];
            showQRScanToast(student, 'already_processed', existingStatus);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        // 6. 수업 일정 확인
        const teacherSchedule = teacherScheduleData[currentTeacherId] || {};
        const studentSchedule = teacherSchedule[studentId] || {};
        const classInfo = studentSchedule[dateStr];
        
        console.log('[processAttendanceFromQR] 수업 일정:', classInfo);
        
        if (!classInfo) {
            throw new Error(`${student.name} 학생의 오늘(${dateStr}) 수업 일정이 없습니다.\n\n시간표에서 일정을 먼저 등록해주세요.`);
        }
        
        // 7. 출석 상태 판단
        const attendanceStatus = determineAttendanceStatus(today, classInfo.start);
        console.log('[processAttendanceFromQR] 출석 상태:', attendanceStatus);
        
        // 8. 출석 기록 저장 (데이터베이스)
        try {
            await saveAttendanceRecord({
                studentId: studentId,
                teacherId: currentTeacherId,
                attendanceDate: dateStr,
                checkInTime: today.toISOString(),
                scheduledTime: classInfo.start,
                status: attendanceStatus,
                qrScanned: true,
                qrScanTime: today.toISOString()
            });
            console.log('[processAttendanceFromQR] 데이터베이스 저장 완료');
        } catch (dbError) {
            console.error('[processAttendanceFromQR] 데이터베이스 저장 실패:', dbError);
            // 데이터베이스 저장 실패해도 로컬 저장은 계속 진행
        }
        
        // 9. 로컬 데이터에 반영
        const sIdx = students.findIndex(s => String(s.id) === String(studentId));
        if (sIdx > -1) {
            if (!students[sIdx].attendance) students[sIdx].attendance = {};
            students[sIdx].attendance[dateStr] = attendanceStatus;
            saveData();
            console.log('[processAttendanceFromQR] 로컬 데이터 저장 완료');
        }
        
        // 10. 화면 업데이트
        renderCalendar();
        console.log('[processAttendanceFromQR] 화면 업데이트 완료');
        
        // 11. 결과 표시 (토스트 알림)
        showQRScanToast(student, attendanceStatus, today);
        
        // 스캐너 자동 재개
        setTimeout(() => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.resume();
            }
        }, 2500);
        
        console.log('[processAttendanceFromQR] === 출석 처리 완료 ===');
        
    } catch (error) {
        console.error('[processAttendanceFromQR] 에러:', error);
        console.error('[processAttendanceFromQR] 에러 스택:', error.stack);
        showQRScanToast(null, 'error', error.message);
        
        // 스캐너 재개
        setTimeout(() => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.resume();
            }
        }, 2000);
    }
}

// 출석 상태 판단 (현재 시간과 예정 시간 비교)
function determineAttendanceStatus(currentTime, scheduledTimeStr) {
    // scheduledTimeStr: "HH:MM" 형식
    const [scheduledHour, scheduledMinute] = scheduledTimeStr.split(':').map(Number);
    
    const scheduledTime = new Date(currentTime);
    scheduledTime.setHours(scheduledHour, scheduledMinute, 0, 0);
    
    const diffMinutes = (currentTime - scheduledTime) / (1000 * 60);
    
    console.log('[determineAttendanceStatus] 시간 차이(분):', diffMinutes);
    console.log('[determineAttendanceStatus] 예정 시간:', scheduledTimeStr);
    console.log('[determineAttendanceStatus] 현재 시간:', currentTime.toLocaleTimeString('ko-KR'));
    
    // 수업 시작 전에 오면: 출석
    if (diffMinutes <= 0) {
        return 'present';
    } 
    // 수업 시작 후 30분 이내: 지각
    else if (diffMinutes > 0 && diffMinutes <= 30) {
        return 'late';
    } 
    // 수업 시작 후 30분 이후: 결석
    else {
        return 'absent';
    }
}

// QR 스캔 토스트 알림 표시
function showQRScanToast(student, status, extra) {
    // 기존 토스트 제거
    const existingToast = document.querySelector('.qr-scan-toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    let icon = '';
    let name = '';
    let statusText = '';
    let statusColor = '';
    let timeText = '';
    
    if (status === 'present') {
        icon = '✅';
        name = `${student.name} (${student.grade})`;
        statusText = '출석 완료';
        statusColor = '#10b981';
        timeText = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } else if (status === 'late') {
        icon = '⏰';
        name = `${student.name} (${student.grade})`;
        statusText = '지각 처리';
        statusColor = '#f59e0b';
        timeText = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
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
    }
    
    // 토스트 생성
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
    
    // 애니메이션 실행
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // 2.5초 후 제거
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 2500);
}

// ========== QR 출석 관리 모달 ==========

// QR 출석 관리 모달 열기
window.openQRAttendanceModal = async function() {
    console.log('[openQRAttendanceModal] QR 출석 관리 모달 열기');
    
    // 관리자 권한 확인
    const userRole = localStorage.getItem('current_user_role');
    if (userRole !== 'admin') {
        alert('QR 출석 관리는 관리자만 접근할 수 있습니다.');
        return;
    }
    
    document.getElementById('qr-attendance-modal').style.display = 'flex';
    
    // 오늘의 출석 현황 로드
    await loadTodayAttendance();
}

// 오늘의 출석 현황 로드
async function loadTodayAttendance() {
    try {
        const today = formatDateToYYYYMMDD(new Date());
        const listDiv = document.getElementById('today-attendance-list');
        
        listDiv.innerHTML = '<p style="color: #64748b;">로딩 중...</p>';
        
        // 오늘 수업이 있는 학생들 조회
        const todayStudents = currentTeacherStudents.filter(s => 
            s.events && s.events.includes(today)
        );
        
        if (todayStudents.length === 0) {
            listDiv.innerHTML = '<p style="color: #64748b;">오늘 수업이 예정된 학생이 없습니다.</p>';
            return;
        }
        
        // 출석 기록 조회
        const attendanceRecords = await getAttendanceRecordsByDate(today);
        
        let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
        
        for (const student of todayStudents) {
            const record = attendanceRecords.find(r => String(r.student_id) === String(student.id));
            const status = student.attendance && student.attendance[today];
            
            let statusBadge = '';
            if (status === 'present') {
                statusBadge = '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 6px; font-size: 12px;">✅ 출석</span>';
            } else if (status === 'late') {
                statusBadge = '<span style="background: #f59e0b; color: white; padding: 4px 12px; border-radius: 6px; font-size: 12px;">⏰ 지각</span>';
            } else if (status === 'absent') {
                statusBadge = '<span style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 6px; font-size: 12px;">❌ 결석</span>';
            } else if (status === 'makeup' || status === 'etc') {
                statusBadge = '<span style="background: #8b5cf6; color: white; padding: 4px 12px; border-radius: 6px; font-size: 12px;">⚠️ 보강</span>';
            } else {
                statusBadge = '<span style="background: #64748b; color: white; padding: 4px 12px; border-radius: 6px; font-size: 12px;">-</span>';
            }
            
            const checkInTime = record && record.check_in_time 
                ? new Date(record.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                : '-';
            
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0;">
                    <div>
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 5px;">
                            ${student.name} <span style="color: #64748b; font-size: 14px;">(${student.grade})</span>
                        </div>
                        <div style="font-size: 13px; color: #64748b;">
                            체크인: ${checkInTime}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${statusBadge}
                        <button onclick="showStudentAttendanceHistory('${student.id}')" style="background: #4f46e5; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                            기록 보기
                        </button>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        listDiv.innerHTML = html;
        
    } catch (error) {
        console.error('[loadTodayAttendance] 에러:', error);
        document.getElementById('today-attendance-list').innerHTML = 
            '<p style="color: #ef4444;">출석 현황을 불러올 수 없습니다.</p>';
    }
}

// ========== 학생 QR 코드 목록 ==========

// 학생 QR 코드 목록 표시
window.showStudentQRList = function() {
    console.log('[showStudentQRList] 학생 QR 코드 목록 표시');
    
    closeModal('qr-attendance-modal');
    document.getElementById('student-qr-list-modal').style.display = 'flex';
    
    renderStudentQRList();
}

// 학생 QR 코드 목록 렌더링
function renderStudentQRList() {
    const listDiv = document.getElementById('student-qr-list');
    
    if (currentTeacherStudents.length === 0) {
        listDiv.innerHTML = '<p style="color: #64748b; text-align: center;">등록된 학생이 없습니다.</p>';
        return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    
    for (const student of currentTeacherStudents) {
        // 학생 이름에서 특수문자 제거 (이모지 등)
        const cleanName = student.name.replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, '');
        const qrData = `STUDENT_${student.id}_${cleanName}`;
        const qrId = `qr-${student.id}`;
        const accordionId = `accordion-${student.id}`;
        
        html += `
            <div style="border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: white;">
                <div onclick="toggleQRAccordion('${accordionId}', '${qrId}', '${qrData}')" 
                     style="padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; transition: background 0.2s;"
                     onmouseover="this.style.background='#f1f5f9'" 
                     onmouseout="this.style.background='#f8fafc'">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1e293b;">${student.name}</h3>
                        <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">${student.grade}</p>
                    </div>
                    <i id="icon-${accordionId}" class="fas fa-chevron-down" style="color: #64748b; transition: transform 0.3s;"></i>
                </div>
                <div id="${accordionId}" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out;">
                    <div style="padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                        <div id="${qrId}" style="display: flex; justify-content: center; margin-bottom: 15px;"></div>
                        <button onclick="downloadQRCode('${qrId}', '${student.name}')" style="background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: background 0.2s;"
                                onmouseover="this.style.background='#059669'"
                                onmouseout="this.style.background='#10b981'">
                            <i class="fas fa-download"></i> 다운로드
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    listDiv.innerHTML = html;
}

// QR 아코디언 토글
window.toggleQRAccordion = function(accordionId, qrId, qrData) {
    const accordion = document.getElementById(accordionId);
    const icon = document.getElementById(`icon-${accordionId}`);
    const qrContainer = document.getElementById(qrId);
    
    if (accordion.style.maxHeight && accordion.style.maxHeight !== '0px') {
        // 닫기
        accordion.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
    } else {
        // 열기
        accordion.style.maxHeight = accordion.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
        
        // QR 코드가 아직 생성되지 않았으면 생성
        if (!qrContainer.hasChildNodes()) {
            setTimeout(() => {
                generateQRCode(qrId, qrData, 200);
                // QR 생성 후 높이 재조정
                accordion.style.maxHeight = accordion.scrollHeight + 'px';
            }, 50);
        }
    }
}

// QR 코드 목록 필터링
window.filterQRStudentList = function() {
    const searchText = document.getElementById('qr-student-search').value.toLowerCase();
    const listDiv = document.getElementById('student-qr-list');
    const items = listDiv.querySelectorAll('& > div > div');
    
    items.forEach(item => {
        const studentName = item.querySelector('h3').textContent.toLowerCase();
        if (studentName.includes(searchText)) {
            item.parentElement.style.display = 'block';
        } else {
            item.parentElement.style.display = 'none';
        }
    });
}

// QR 코드 다운로드
window.downloadQRCode = function(qrId, studentName) {
    const qrContainer = document.getElementById(qrId);
    const canvas = qrContainer.querySelector('canvas');
    
    if (!canvas) {
        alert('QR 코드를 찾을 수 없습니다.');
        return;
    }
    
    // Canvas를 이미지로 변환하여 다운로드
    const link = document.createElement('a');
    link.download = `QR_${studentName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// ========== 학생별 출석 기록 ==========

// 학생별 출석 기록 보기
window.showStudentAttendanceHistory = function(studentId) {
    console.log('[showStudentAttendanceHistory] 학생 출석 기록:', studentId);
    
    currentStudentForAttendance = studentId;
    
    // 현재 월로 초기화
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('attendance-history-month').value = monthStr;
    
    // 학생 이름 표시
    const student = currentTeacherStudents.find(s => String(s.id) === String(studentId));
    if (student) {
        document.getElementById('attendance-history-title').textContent = 
            `${student.name}님의 출석 기록`;
    }
    
    // 모달 표시
    closeModal('qr-attendance-modal');
    document.getElementById('student-attendance-history-modal').style.display = 'flex';
    
    // 출석 기록 로드
    loadStudentAttendanceHistory();
}

// 학생 출석 기록 로드
window.loadStudentAttendanceHistory = async function() {
    try {
        if (!currentStudentForAttendance) return;
        
        const monthStr = document.getElementById('attendance-history-month').value;
        if (!monthStr) {
            alert('조회할 월을 선택해주세요.');
            return;
        }
        
        const [year, month] = monthStr.split('-').map(Number);
        const contentDiv = document.getElementById('attendance-history-content');
        
        contentDiv.innerHTML = '<p style="color: #64748b;">로딩 중...</p>';
        
        // 해당 월의 출석 기록 조회
        const records = await getStudentAttendanceRecordsByMonth(currentStudentForAttendance, year, month);
        
        if (records.length === 0) {
            contentDiv.innerHTML = `<p style="color: #64748b; text-align: center;">
                ${year}년 ${month}월의 출석 기록이 없습니다.
            </p>`;
            return;
        }
        
        // 출석, 지각, 결석, 보강 통계
        const stats = {
            present: records.filter(r => r.status === 'present').length,
            late: records.filter(r => r.status === 'late').length,
            absent: records.filter(r => r.status === 'absent').length,
            makeup: records.filter(r => r.status === 'makeup' || r.status === 'etc').length
        };
        
        const totalDays = stats.present + stats.late + stats.absent + stats.makeup;
        
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
            
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                <h3 style="margin: 0; font-size: 18px; color: #1e293b;">상세 기록</h3>
                <span style="font-size: 14px; color: #64748b; font-weight: 500;">총 ${totalDays}일</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
        `;
        
        // 날짜 역순으로 정렬
        records.sort((a, b) => new Date(b.attendance_date) - new Date(a.attendance_date));
        
        for (const record of records) {
            const date = new Date(record.attendance_date);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const checkInTime = record.check_in_time 
                ? new Date(record.check_in_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                : '-';
            
            let statusBadge = '';
            let statusColor = '';
            let bgColor = '#ffffff';
            let borderColor = '#e2e8f0';
            
            if (record.status === 'present') {
                statusBadge = '출석';
                statusColor = '#10b981';
                bgColor = '#f0fdf4';
                borderColor = '#86efac';
            } else if (record.status === 'late') {
                statusBadge = '지각';
                statusColor = '#f59e0b';
                bgColor = '#fffbeb';
                borderColor = '#fcd34d';
            } else if (record.status === 'absent') {
                statusBadge = '결석';
                statusColor = '#ef4444';
                bgColor = '#fef2f2';
                borderColor = '#fca5a5';
            } else if (record.status === 'makeup' || record.status === 'etc') {
                statusBadge = '보강';
                statusColor = '#8b5cf6';
                bgColor = '#faf5ff';
                borderColor = '#c4b5fd';
            }
            
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; background: ${bgColor}; border-radius: 12px; border-left: 4px solid ${statusColor}; border-top: 1px solid ${borderColor}; border-right: 1px solid ${borderColor}; border-bottom: 1px solid ${borderColor}; transition: all 0.2s;">
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 15px; color: #1e293b; margin-bottom: 6px;">${dateStr} (${getDayOfWeek(date)})</div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 13px; color: #64748b; display: flex; align-items: center; gap: 4px;">
                                <span style="opacity: 0.7;">⏰</span> ${checkInTime}
                            </span>
                            ${record.qr_scanned ? '<span style="font-size: 12px; color: #10b981; background: #dcfce7; padding: 3px 8px; border-radius: 6px; font-weight: 600;">📱 QR</span>' : ''}
                        </div>
                    </div>
                    <div style="background: ${statusColor}; color: white; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 14px; white-space: nowrap;">
                        ${statusBadge}
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        contentDiv.innerHTML = html;
        
    } catch (error) {
        console.error('[loadStudentAttendanceHistory] 에러:', error);
        document.getElementById('attendance-history-content').innerHTML = 
            '<p style="color: #ef4444;">출석 기록을 불러올 수 없습니다.</p>';
    }
}

// 요일 구하기
function getDayOfWeek(date) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[date.getDay()];
}

// ========== 유틸리티 함수 ==========

// 날짜를 YYYY-MM-DD 형식으로 변환
function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 학생 ID로 학생 정보 조회
async function getStudentById(studentId) {
    // 먼저 메모리에서 검색
    let student = students.find(s => String(s.id) === String(studentId));
    
    if (student) {
        return student;
    }
    
    // 데이터베이스에서 검색
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .eq('id', studentId)
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[getStudentById] 에러:', error);
        return null;
    }
}

// ========== 출석 기록 데이터베이스 함수 ==========

// 출석 기록 저장
async function saveAttendanceRecord(recordData) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const record = {
            student_id: recordData.studentId,
            teacher_id: recordData.teacherId,
            owner_user_id: ownerId,
            attendance_date: recordData.attendanceDate,
            check_in_time: recordData.checkInTime,
            scheduled_time: recordData.scheduledTime,
            status: recordData.status,
            qr_scanned: recordData.qrScanned || false,
            qr_scan_time: recordData.qrScanTime || null,
            memo: recordData.memo || null
        };
        
        console.log('[saveAttendanceRecord] 저장할 기록:', record);
        
        // Upsert (중복 시 업데이트)
        const { data, error } = await supabase
            .from('attendance_records')
            .upsert(record, { 
                onConflict: 'student_id,attendance_date',
                ignoreDuplicates: false 
            })
            .select()
            .single();
        
        if (error) throw error;
        
        console.log('[saveAttendanceRecord] 저장 성공:', data);
        return data;
    } catch (error) {
        console.error('[saveAttendanceRecord] 에러:', error);
        throw error;
    }
}

// 날짜별 출석 기록 조회
async function getAttendanceRecordsByDate(dateStr) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const { data, error } = await supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', currentTeacherId)
            .eq('attendance_date', dateStr)
            .order('check_in_time', { ascending: false });
        
        if (error) throw error;
        
        return data || [];
    } catch (error) {
        console.error('[getAttendanceRecordsByDate] 에러:', error);
        return [];
    }
}

// 학생별 월간 출석 기록 조회
async function getStudentAttendanceRecordsByMonth(studentId, year, month) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        // 해당 월의 시작일과 종료일
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0); // 해당 월의 마지막 날
        const endDateStr = formatDateToYYYYMMDD(endDate);
        
        const { data, error } = await supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('student_id', studentId)
            .gte('attendance_date', startDate)
            .lte('attendance_date', endDateStr)
            .order('attendance_date', { ascending: true });
        
        if (error) throw error;
        
        return data || [];
    } catch (error) {
        console.error('[getStudentAttendanceRecordsByMonth] 에러:', error);
        return [];
    }
}
