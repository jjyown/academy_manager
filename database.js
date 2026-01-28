// Supabase 데이터베이스 함수들

// 현재 로그인한 사용자 정보
let currentUser = null;

// 사용자 정보 가져오기
window.getCurrentUser = async function() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            // users 테이블에서 role 정보 포함하여 조회
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, email, name, role')
                .eq('id', session.user.id)
                .single();
            
            if (userError) {
                console.error('사용자 정보 조회 실패:', userError);
                currentUser = { ...session.user, role: 'user' };
            } else {
                currentUser = userData;
            }
            return currentUser;
        }
        return null;
    } catch (error) {
        console.error('사용자 정보 조회 실패:', error);
        return null;
    }
}

// ========== 학생 관련 함수 ==========

// 모든 학생 조회 (모든 선생님의 학생들)
window.getAllStudents = async function() {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('학생 조회 실패:', error);
        return [];
    }
}

// 현재 선생님이 등록한 학생만 조회
window.getMyStudents = async function() {
    try {
        const user = await getCurrentUser();
        if (!user) return [];

        const { data, error } = await supabase
            .from('students')
            .select('*')
            .eq('teacher_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('내 학생 조회 실패:', error);
        return [];
    }
}

// 학생 추가
window.addStudent = async function(studentData) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            alert('로그인이 필요합니다');
            return null;
        }

        const { data, error } = await supabase
            .from('students')
            .insert([{
                owner_user_id: user.id,
                teacher_id: user.id,
                name: studentData.name,
                grade: studentData.grade,
                phone: studentData.phone || studentData.studentPhone || '',
                parent_phone: studentData.parentPhone || '',
                default_fee: studentData.defaultFee || 0,
                special_lecture_fee: studentData.specialLectureFee || 0,
                default_textbook_fee: studentData.defaultTextbookFee || 0,
                memo: studentData.memo || '',
                register_date: studentData.registerDate || '',
                status: studentData.status || 'active'
            }])
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('학생 추가 실패:', error);
        return null;
    }
}

// 학생 수정
window.updateStudent = async function(studentId, updateData) {
    try {
        const { data, error } = await supabase
            .from('students')
            .update(updateData)
            .eq('id', studentId)
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('학생 수정 실패:', error);
        return null;
    }
}

// 학생 삭제 (관련 출석 기록도 함께 삭제)
window.deleteStudent = async function(studentId) {
    try {
        // studentId를 숫자로 변환 (문자열인 경우 대비)
        const numericId = parseInt(studentId);
        
        if (isNaN(numericId)) {
            console.error('[deleteStudent] 잘못된 학생 ID:', studentId);
            throw new Error('잘못된 학생 ID');
        }
        
        console.log('[deleteStudent] 학생 삭제 시작 - ID:', numericId, '(원본:', studentId, ')');
        
        // 1단계: 해당 학생의 모든 출석 기록 삭제
        console.log('[deleteStudent] 1단계: 출석 기록 삭제 중...');
        const { error: attendanceError } = await supabase
            .from('attendance_records')
            .delete()
            .eq('student_id', numericId);
        
        if (attendanceError) {
            console.error('[deleteStudent] 출석 기록 삭제 실패:', attendanceError);
            throw new Error('출석 기록 삭제 실패: ' + attendanceError.message);
        }
        console.log('[deleteStudent] 출석 기록 삭제 완료');
        
        // 2단계: 학생 데이터 삭제
        console.log('[deleteStudent] 2단계: 학생 데이터 삭제 중...');
        const { error: studentError } = await supabase
            .from('students')
            .delete()
            .eq('id', numericId);

        if (studentError) {
            console.error('[deleteStudent] 학생 삭제 실패:', studentError);
            throw new Error('학생 삭제 실패: ' + studentError.message);
        }
        
        console.log('[deleteStudent] 학생 삭제 완료 - ID:', numericId);
        return true;
    } catch (error) {
        console.error('[deleteStudent] 전체 삭제 프로세스 실패:', error);
        return false;
    }
}

// ========== 일정 관련 함수 ==========

// ========== 선생님 관리 (Supabase) ==========

// 내가 등록한 선생님 목록
window.getMyTeachers = async function() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return [];
        const { data, error } = await supabase
            .from('teachers')
            .select('id, name, phone, created_at')
            .eq('owner_user_id', session.user.id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('선생님 목록 조회 실패:', err);
        return [];
    }
}

// 관리자(소유자) 강제 삭제 - PIN 없이 진행
window.deleteTeacherById = async function(teacherId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            alert('로그인이 필요합니다');
            return false;
        }

        const { error } = await supabase
            .from('teachers')
            .delete()
            .eq('id', teacherId)
            .eq('owner_user_id', session.user.id);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('선생님 삭제 실패:', err);
        alert('선생님 삭제 실패: ' + err.message);
        return false;
    }
}


// 모든 일정 조회 (모든 선생님의 일정)
window.getAllSchedules = async function() {
    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .order('date', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('일정 조회 실패:', error);
        return [];
    }
}

// 특정 날짜의 일정 조회
window.getScheduleByDate = async function(dateStr) {
    try {
        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .eq('date', dateStr);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('특정 날짜 일정 조회 실패:', error);
        return [];
    }
}

// 일정 추가
window.addSchedule = async function(scheduleData) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            alert('로그인이 필요합니다');
            return null;
        }

        const { data, error } = await supabase
            .from('schedules')
            .insert([{
                teacher_id: user.id,
                date: scheduleData.date,
                student_ids: scheduleData.student_ids || [],
                notes: scheduleData.notes || ''
            }])
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('일정 추가 실패:', error);
        return null;
    }
}

// 일정 수정
window.updateSchedule = async function(scheduleId, updateData) {
    try {
        const { data, error } = await supabase
            .from('schedules')
            .update(updateData)
            .eq('id', scheduleId)
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('일정 수정 실패:', error);
        return null;
    }
}

// 일정 삭제
window.deleteSchedule = async function(scheduleId) {
    try {
        const { error } = await supabase
            .from('schedules')
            .delete()
            .eq('id', scheduleId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('일정 삭제 실패:', error);
        return false;
    }
}

// ========== 공휴일 관련 함수 ==========

// 모든 공휴일 조회
window.getHolidays = async function() {
    try {
        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .order('date', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('공휴일 조회 실패:', error);
        return [];
    }
}

// 공휴일 추가
window.addHoliday = async function(date, name) {
    try {
        const { data, error } = await supabase
            .from('holidays')
            .insert([{ date: date, name: name }])
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('공휴일 추가 실패:', error);
        return null;
    }
}

// 공휴일 삭제
window.deleteHoliday = async function(holidayId) {
    try {
        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('id', holidayId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('공휴일 삭제 실패:', error);
        return false;
    }
}

// ========== Schedules (일정) 관련 함수 ==========

// 일정 저장/업데이트 (Upsert)
window.saveScheduleToDatabase = async function(scheduleData) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const schedule = {
            owner_user_id: ownerId,
            teacher_id: scheduleData.teacherId,
            student_id: parseInt(scheduleData.studentId),
            schedule_date: scheduleData.date,
            start_time: scheduleData.startTime,
            duration: parseInt(scheduleData.duration)
        };
        
        const { data, error } = await supabase
            .from('schedules')
            .upsert(schedule, {
                onConflict: 'student_id,schedule_date',
                ignoreDuplicates: false
            })
            .select()
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[saveScheduleToDatabase] 에러:', error);
        throw error;
    }
}

// 특정 선생님의 일정 조회
window.getSchedulesByTeacher = async function(teacherId) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .order('schedule_date', { ascending: true });
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getSchedulesByTeacher] 에러:', error);
        return [];
    }
}

// 특정 학생의 일정 조회
window.getSchedulesByStudent = async function(studentId) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        const numericId = parseInt(studentId);
        
        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .order('schedule_date', { ascending: true });
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getSchedulesByStudent] 에러:', error);
        return [];
    }
}

// 일정 삭제
window.deleteScheduleFromDatabase = async function(studentId, date) {
    try {
        const numericId = parseInt(studentId);
        
        const { error } = await supabase
            .from('schedules')
            .delete()
            .eq('student_id', numericId)
            .eq('schedule_date', date);
        
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteScheduleFromDatabase] 에러:', error);
        throw error;
    }
}

// ========== Holidays (커스텀 휴일) 관련 함수 ==========

// 커스텀 휴일 저장/업데이트
window.saveHolidayToDatabase = async function(holidayData) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const holiday = {
            owner_user_id: ownerId,
            teacher_id: holidayData.teacherId,
            holiday_date: holidayData.date,
            holiday_name: holidayData.name,
            color: holidayData.color || '#ef4444'
        };
        
        const { data, error } = await supabase
            .from('holidays')
            .upsert(holiday, {
                onConflict: 'owner_user_id,teacher_id,holiday_date',
                ignoreDuplicates: false
            })
            .select()
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[saveHolidayToDatabase] 에러:', error);
        throw error;
    }
}

// 특정 선생님의 커스텀 휴일 조회
window.getHolidaysByTeacher = async function(teacherId) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .order('holiday_date', { ascending: true });
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getHolidaysByTeacher] 에러:', error);
        return [];
    }
}

// 커스텀 휴일 삭제
window.deleteHolidayFromDatabase = async function(teacherId, date) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .eq('holiday_date', date);
        
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteHolidayFromDatabase] 에러:', error);
        throw error;
    }
}

// ========== Payments (결제) 관련 함수 ==========

// 결제 정보 저장/업데이트
window.savePaymentToDatabase = async function(paymentData) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const payment = {
            owner_user_id: ownerId,
            teacher_id: paymentData.teacherId,
            student_id: parseInt(paymentData.studentId),
            payment_month: paymentData.month, // YYYY-MM
            amount: parseInt(paymentData.amount),
            paid_amount: parseInt(paymentData.paidAmount || 0),
            payment_status: paymentData.status || 'unpaid',
            payment_date: paymentData.paymentDate || null,
            memo: paymentData.memo || null
        };
        
        const { data, error } = await supabase
            .from('payments')
            .upsert(payment, {
                onConflict: 'student_id,payment_month',
                ignoreDuplicates: false
            })
            .select()
            .single();
        
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[savePaymentToDatabase] 에러:', error);
        throw error;
    }
}

// 특정 월의 결제 정보 조회
window.getPaymentsByMonth = async function(teacherId, month) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('teacher_id', teacherId)
            .eq('payment_month', month);
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getPaymentsByMonth] 에러:', error);
        return [];
    }
}

// 특정 학생의 결제 정보 조회
window.getPaymentsByStudent = async function(studentId) {
    try {
        const ownerId = localStorage.getItem('current_owner_id');
        const numericId = parseInt(studentId);
        
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .eq('owner_user_id', ownerId)
            .eq('student_id', numericId)
            .order('payment_month', { ascending: false });
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getPaymentsByStudent] 에러:', error);
        return [];
    }
}

