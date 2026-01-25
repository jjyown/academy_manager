// Supabase 데이터베이스 함수들

// 현재 로그인한 사용자 정보
let currentUser = null;

// 사용자 정보 가져오기
window.getCurrentUser = async function() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            currentUser = session.user;
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
                teacher_id: user.id,
                name: studentData.name,
                grade: studentData.grade,
                phone: studentData.phone,
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

// 학생 삭제
window.deleteStudent = async function(studentId) {
    try {
        const { error } = await supabase
            .from('students')
            .delete()
            .eq('id', studentId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('학생 삭제 실패:', error);
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
