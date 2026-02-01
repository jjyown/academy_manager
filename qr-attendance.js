// QR 출석 관리 시스템
console.log('[qr-attendance.js] 파일 로드 시작');

// QR 스캐너 인스턴스
let html5QrcodeScanner = null;
let currentStudentForAttendance = null;
let currentFacingMode = "environment"; // "environment" (후방) 또는 "user" (전방)

// ========== QR 코드 생성 ==========

// 학생별 고유 QR 코드 데이터 생성
// QR코드 재발급 시마다 고유 토큰을 생성하여 로컬에 저장
window.generateQRCodeData = function(studentId) {
    // 고유 토큰 생성 (랜덤+시간)
    const qrToken = `${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
    // 학생별 토큰 저장 (로컬)
    let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
    qrTokens[studentId] = qrToken;
    localStorage.setItem('student_qr_tokens', JSON.stringify(qrTokens));
    return `STUDENT_${studentId}_${qrToken}`;
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
        quietZone: 10,
        quietZoneColor: "#ffffff"
    });
}

// ========== QR 스캔 페이지 ==========

// QR 스캔 페이지 열기
window.openQRScanPage = function() {
    console.log('[openQRScanPage] QR 스캔 페이지 열기');
    console.log('[openQRScanPage] students 수:', students ? students.length : 0);
    
    try {
        // 학생 데이터 확인 (전체 학생 배열에서)
        if (!students || students.length === 0) {
            alert('등록된 학생이 없습니다.\n먼저 학생을 등록해주세요.');
            return;
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
            alert('QR 스캔 페이지를 찾을 수 없습니다.');
            return;
        }
        
        const resultDiv = document.getElementById('qr-scan-result');
        if (resultDiv) {
            resultDiv.style.display = 'none';
        }
        
        // QR 스캐너 즉시 시작
        setTimeout(() => {
            startQRScanner();
        }, 100);
    } catch (error) {
        console.error('[openQRScanPage] 오류:', error);
        alert('QR 스캔 페이지를 열 수 없습니다.');
    }
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
            try {
                if (html5QrcodeScanner && typeof html5QrcodeScanner.clear === 'function') {
                    html5QrcodeScanner.clear();
                    console.log('[closeQRScanPage] 스캐너 정리 완료');
                }
            } catch (err) {
                console.error('[closeQRScanPage] 스캐너 정리 실패:', err);
            }
            html5QrcodeScanner = null;
        }).catch(err => {
            console.error('[closeQRScanPage] 스캐너 중지 실패:', err);
            html5QrcodeScanner = null;
        });
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

        // 3-1. QR토큰 유효성 검사 (재발급된 QR만 허용, 구버전 QR도 만료 처리)
        let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
        const validToken = qrTokens[studentId];
        if (!qrToken || !validToken || qrToken !== validToken) {
            showQRScanToast(null, 'expired_qr', null);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 2500);
            return;
        }
        
        // 4. 학생 정보 조회 (전체 학생 배열에서)
        // 학생 ID 타입 일치 보장 (number/string 혼용 방지)
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
        
        // 5. 오늘 날짜
        const today = new Date();
        const dateStr = formatDateToYYYYMMDD(today);
        
        // 5-1. QR토큰 만료 체크를 출석 기록 체크보다 먼저 수행
        if (qrToken) {
            let qrTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
            const validToken = qrTokens[studentId];
            if (!validToken || qrToken !== validToken) {
                showQRScanToast(student, 'expired_qr', null);
                setTimeout(() => {
                    if (html5QrcodeScanner) html5QrcodeScanner.resume();
                }, 2500);
                return;
            }
        }

        // 5-2. 데이터베이스에서 중복 출석 체크
        try {
            const existingRecord = await getAttendanceRecordByStudentAndDate(studentId, dateStr);
            if (existingRecord) {
                console.log('[processAttendanceFromQR] 이미 처리된 출석 기록 발견:', existingRecord);
                showQRScanToast(student, 'already_processed', existingRecord.status);
                setTimeout(() => {
                    if (html5QrcodeScanner) html5QrcodeScanner.resume();
                }, 2500);
                return;
            }
        } catch (dbError) {
            console.error('[processAttendanceFromQR] 데이터베이스 조회 실패:', dbError);
        }
        
        // 5-3. 로컬 메모리에서도 확인 (백업)
        if (student.attendance && student.attendance[dateStr]) {
            const existingStatus = student.attendance[dateStr];
            console.log('[processAttendanceFromQR] 로컬 메모리에 이미 기록됨:', existingStatus);
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
        
        if (!classInfo) {
            console.warn('[processAttendanceFromQR] 수업 일정 없음');
            showQRScanToast(student, 'no_schedule', dateStr);
            setTimeout(() => {
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 3000);
            return;
        }
        
        // 7. 출석 상태 판단 (60분 기준)
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
        }
        
        // 9. 로컬 데이터에 반영
        const sIdx = students.findIndex(s => String(s.id) === String(studentId));
        if (sIdx > -1) {
            if (!students[sIdx].attendance) students[sIdx].attendance = {};
            students[sIdx].attendance[dateStr] = attendanceStatus;
            
            // currentTeacherStudents 배열도 함께 업데이트
            const ctIdx = currentTeacherStudents.findIndex(s => String(s.id) === String(studentId));
            if (ctIdx > -1) {
                if (!currentTeacherStudents[ctIdx].attendance) currentTeacherStudents[ctIdx].attendance = {};
                currentTeacherStudents[ctIdx].attendance[dateStr] = attendanceStatus;
            }
            
            saveData();
            console.log('[processAttendanceFromQR] 로컬 데이터 저장 완료');
        }
        
        // 10. 화면 업데이트 (QR 출석 학생 ID 저장)
        lastQrScannedStudentId = studentId;
        renderCalendar();
        
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
        showQRScanToast(null, 'error', error.message);
        
        setTimeout(() => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.resume();
            }
        }, 2000);
    }
}

// 출석 상태 판단 (60분 기준)
function determineAttendanceStatus(currentTime, scheduledTimeStr) {
    const [scheduledHour, scheduledMinute] = scheduledTimeStr.split(':').map(Number);
    
    const scheduledTime = new Date(currentTime);
    scheduledTime.setHours(scheduledHour, scheduledMinute, 0, 0);
    
    const diffMinutes = (currentTime - scheduledTime) / (1000 * 60);
    
    console.log('[determineAttendanceStatus] 시간 차이(분):', diffMinutes);
    
    // 수업 시작 시간 또는 그 전에 오면: 출석
    if (diffMinutes <= 0) {
        return 'present';
    } 
    // 수업 시작 후 1분 ~ 60분 이내: 지각
    else if (diffMinutes > 0 && diffMinutes <= 60) {
        return 'late';
    } 
    // 수업 시작 후 60분 초과: 결석
    else {
        return 'absent';
    }
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

// ========== 학생 QR 코드 목록 ==========

window.showStudentQRList = function() {
    console.log('[showStudentQRList] 학생 QR 코드 목록 표시');
    
    try {
        if (typeof closeModal === 'function') {
            closeModal('qr-attendance-modal');
        }
        
        const modal = document.getElementById('student-qr-list-modal');
        if (modal) {
            modal.style.display = 'flex';
        } else {
            console.error('[showStudentQRList] student-qr-list-modal 요소를 찾을 수 없습니다');
            alert('학생 QR코드 모달을 찾을 수 없습니다.');
            return;
        }
        
        renderStudentQRList();
    } catch (error) {
        console.error('[showStudentQRList] 오류:', error);
        alert('학생 QR코드 목록을 표시할 수 없습니다.');
    }
}

function renderStudentQRList() {
    const listDiv = document.getElementById('student-qr-list');
    
    if (!Array.isArray(students) || students.length === 0) {
        listDiv.innerHTML = '<p style="color: #64748b; text-align: center;">등록된 학생이 없습니다.</p>';
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';

    for (const student of students) {
        // 항상 토큰 포함된 QR코드 데이터 생성 (최초/재발급 동일 패턴)
        const qrData = generateQRCodeData(student.id);
        const qrId = `qr-${student.id}`;
        const accordionId = `accordion-${student.id}`;

        console.log('[renderStudentQRList] 학생:', student.name, '| ID:', student.id, '| QR 데이터:', qrData);

        html += `
            <div style="border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: white;">
                <div onclick="toggleQRAccordion('${accordionId}', '${qrId}', '${qrData}')" 
                     style="padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; transition: background 0.2s;"
                     onmouseover="this.style.background='#f1f5f9'" 
                     onmouseout="this.style.background='#f8fafc'">
                    <div style="display: flex; align-items: baseline; gap: 10px;">
                        <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #1e293b;">${student.name}</h3>
                        <span style="color: #64748b; font-size: 13px; font-weight: 500;">${student.grade}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button onclick="event.stopPropagation(); regenerateQRCode('${student.id}', '${qrId}', '${accordionId}', '${student.name}')" 
                                style="background: #4f46e5; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 4px;"
                                onmouseover="this.style.background='#4338ca'" 
                                onmouseout="this.style.background='#4f46e5'"
                                title="QR코드 재발급">
                            <i class="fas fa-sync-alt" style="font-size: 11px;"></i> 재발급
                        </button>
                        <i id="icon-${accordionId}" class="fas fa-chevron-down" style="color: #64748b; transition: transform 0.3s; font-size: 14px;"></i>
                    </div>
                </div>
                <div id="${accordionId}" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out;">
                    <div style="padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                        <div id="${qrId}" style="display: flex; justify-content: center; margin-bottom: 15px;"></div>
                        <button onclick="downloadQRCode('${qrId}', '${student.name}')" style="background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;"
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

// QR 코드 재발급
window.regenerateQRCode = function(studentId, qrId, accordionId, cleanName) {
    console.log('[regenerateQRCode] QR 코드 재발급:', studentId);
    // 반드시 토큰 포함된 최신 QR 생성
    const newQrData = generateQRCodeData(studentId);
    console.log('[regenerateQRCode] 새 QR 데이터:', newQrData);

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

    showQRScanToast(null, 'regenerate_success', cleanName);

    console.log('[regenerateQRCode] QR 코드 재발급 완료');
}

window.toggleQRAccordion = function(accordionId, qrId, qrData) {
    const accordion = document.getElementById(accordionId);
    const icon = document.getElementById(`icon-${accordionId}`);
    const qrContainer = document.getElementById(qrId);
    
    if (accordion.style.maxHeight && accordion.style.maxHeight !== '0px') {
        accordion.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
    } else {
        accordion.style.maxHeight = accordion.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
        
        if (!qrContainer.hasChildNodes()) {
            setTimeout(() => {
                generateQRCode(qrId, qrData, 200);
                accordion.style.maxHeight = accordion.scrollHeight + 'px';
            }, 50);
        }
    }
}

window.downloadQRCode = function(qrId, studentName) {
    const qrContainer = document.getElementById(qrId);
    const canvas = qrContainer.querySelector('canvas');
    
    if (!canvas) {
        alert('QR 코드를 찾을 수 없습니다.');
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
    
    const student = currentTeacherStudents.find(s => String(s.id) === String(studentId));
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
            alert('조회할 월을 선택해주세요.');
            return;
        }
        
        const [year, month] = monthStr.split('-').map(Number);
        const contentDiv = document.getElementById('attendance-history-content');
        
        contentDiv.innerHTML = '<p style="color: #64748b;">로딩 중...</p>';
        
        const records = await getStudentAttendanceRecordsByMonth(currentStudentForAttendance, year, month);
        
        if (records.length === 0) {
            contentDiv.innerHTML = `<p style="color: #64748b; text-align: center;">
                ${year}년 ${month}월의 출석 기록이 없습니다.
            </p>`;
            return;
        }
        
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
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; background: ${bgColor}; border-radius: 12px; border-left: 4px solid ${statusColor}; border-top: 1px solid ${borderColor}; border-right: 1px solid ${borderColor}; border-bottom: 1px solid ${borderColor};">
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

function getDayOfWeek(date) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[date.getDay()];
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
        const numericId = parseInt(recordData.studentId);
        
        const record = {
            student_id: numericId,
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
        
        const { data, error } = await supabase
            .from('attendance_records')
            .upsert(record, { 
                onConflict: 'student_id,attendance_date',
                ignoreDuplicates: false 
            })
            .select()
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[saveAttendanceRecord] 에러:', error);
        throw error;
    }
}

async function getAttendanceRecordByStudentAndDate(studentId, dateStr) {
    try {
        const numericId = parseInt(studentId);
        
        const { data, error } = await supabase
            .from('attendance_records')
            .select('*')
            .eq('student_id', numericId)
            .eq('attendance_date', dateStr)
            .maybeSingle();
        
        if (error) {
            console.error('[getAttendanceRecordByStudentAndDate] 에러:', error);
            return null;
        }
        
        return data;
    } catch (error) {
        console.error('[getAttendanceRecordByStudentAndDate] 예외:', error);
        return null;
    }
}

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

async function getStudentAttendanceRecordsByMonth(studentId, year, month) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        const numericId = parseInt(studentId);
        
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0);
        const endDateStr = formatDateToYYYYMMDD(endDate);
        
        const { data, error } = await supabase
            .from('attendance_records')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
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

console.log('[qr-attendance.js] 파일 로드 완료');
console.log('[qr-attendance.js] openQRScanPage 함수:', typeof window.openQRScanPage);
console.log('[qr-attendance.js] showStudentQRList 함수:', typeof window.showStudentQRList);
