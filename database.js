// Supabase 데이터베이스 함수들
// 최적화: 세션 캐싱, 불필요한 쿼리 제거, select 최적화

// ========== 세션 캐싱 ==========
let _cachedUser = null;
let _cachedSession = null;
let _sessionCacheTime = 0;
const SESSION_CACHE_TTL = 180000; // 3분 (성능 최적화: 불필요한 세션 체크 감소)

// 캐시된 세션 가져오기 (불필요한 중복 호출 방지)
async function _getSession() {
    const now = Date.now();
    if (_cachedSession && (now - _sessionCacheTime) < SESSION_CACHE_TTL) {
        return _cachedSession;
    }
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        _cachedSession = null;
        _cachedUser = null;
        return null;
    }
    _cachedSession = session;
    _sessionCacheTime = now;
    return session;
}

// owner_user_id 빠른 조회 (localStorage 우선, 없으면 세션에서)
function _getOwnerId() {
    const ownerId = localStorage.getItem('current_owner_id');
    if (ownerId) return ownerId;
    if (_cachedSession) return _cachedSession.user.id;
    return null;
}

// 세션 변경 감지 → 캐시 무효화
if (typeof supabase !== 'undefined') {
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
            _cachedUser = null;
            _cachedSession = null;
            _sessionCacheTime = 0;
        }
    });
}

// ========== 사용자 정보 ==========

window.getCurrentUser = async function() {
    // 캐시된 사용자 정보가 있으면 바로 반환
    if (_cachedUser) return _cachedUser;

    try {
        const session = await _getSession();
        if (!session) return null;

        const { data: userData, error } = await supabase
            .from('users')
            .select('id, email, name, role')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error('사용자 정보 조회 실패:', error);
            _cachedUser = { ...session.user, role: 'user' };
        } else {
            _cachedUser = userData;
        }
        return _cachedUser;
    } catch (error) {
        console.error('사용자 정보 조회 실패:', error);
        return null;
    }
}

// 캐시 강제 초기화 (로그아웃 등)
window.clearUserCache = function() {
    _cachedUser = null;
    _cachedSession = null;
    _sessionCacheTime = 0;
}


// ========== 학생 관련 함수 ==========

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

window.addStudent = async function(studentData) {
    try {
        const user = _cachedUser || await getCurrentUser();
        if (!user) {
            showToast('로그인이 필요합니다', 'warning');
            return null;
        }

        let regDate = studentData.register_date;
        if (!regDate || regDate === '' || regDate === '연도-월-일') regDate = null;

        const { data, error } = await supabase
            .from('students')
            .insert([{
                owner_user_id: user.id,
                teacher_id: user.id,
                name: studentData.name,
                school: studentData.school || '',
                grade: studentData.grade,
                phone: studentData.phone || '',
                parent_phone: studentData.parent_phone || '',
                default_fee: studentData.default_fee || 0,
                special_lecture_fee: studentData.special_lecture_fee || 0,
                default_textbook_fee: studentData.default_textbook_fee || 0,
                memo: studentData.memo || '',
                register_date: regDate,
                status: studentData.status || 'active'
            }])
            .select()
            .single();

        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('학생 추가 실패:', error);
        return null;
    }
}

window.updateStudent = async function(studentId, updateData) {
    try {
        const { data, error } = await supabase
            .from('students')
            .update(updateData)
            .eq('id', studentId)
            .select()
            .single();

        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('학생 수정 실패:', error);
        return null;
    }
}

window.deleteStudent = async function(studentId) {
    try {
        const numericId = parseInt(studentId);
        if (isNaN(numericId)) {
            console.error('[deleteStudent] 잘못된 학생 ID:', studentId);
            throw new Error('잘못된 학생 ID');
        }

        // 관련 데이터 병렬 삭제 (순서 무관한 항목들을 동시에 처리 - 성능 4배 향상)
        const [schedRes, attRes, payRes, evalRes] = await Promise.allSettled([
            supabase.from('schedules').delete().eq('student_id', numericId),
            supabase.from('attendance_records').delete().eq('student_id', numericId),
            supabase.from('payments').delete().eq('student_id', numericId),
            supabase.from('student_evaluations').delete().eq('student_id', numericId)
        ]);

        // 실패 로깅 (관련 데이터가 없을 수 있으므로 에러는 경고만)
        const labels = ['일정', '출석 기록', '결제 기록', '평가 기록'];
        [schedRes, attRes, payRes, evalRes].forEach((res, i) => {
            if (res.status === 'rejected' || res.value?.error) {
                console.warn(`[deleteStudent] ${labels[i]} 삭제 실패:`, res.reason || res.value?.error);
            }
        });

        // 학생 본체 삭제 (이것은 반드시 성공해야 함)
        const { error: studentError } = await supabase
            .from('students')
            .delete()
            .eq('id', numericId);

        if (studentError) {
            throw new Error('학생 삭제 실패: ' + studentError.message);
        }

        console.log('[deleteStudent] 학생 삭제 완료 - ID:', numericId);
        return true;
    } catch (error) {
        console.error('[deleteStudent] 삭제 프로세스 실패:', error);
        return false;
    }
}


// ========== 출석 기록 조회 ==========

window.getAttendanceRecordsByOwner = async function(teacherId = null) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) return [];

        let query = supabase
            .from('attendance_records')
            .select('id, student_id, teacher_id, attendance_date, status, scheduled_time, check_in_time, qr_scanned, memo, shared_memo')
            .eq('owner_user_id', ownerId)
            .order('attendance_date', { ascending: true });

        const effectiveTeacherId = teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : null);
        if (effectiveTeacherId) {
            query = query.eq('teacher_id', String(effectiveTeacherId));
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[getAttendanceRecordsByOwner] 에러:', error);
        return [];
    }
}


// ========== 선생님 관리 ==========

window.getMyTeachers = async function() {
    try {
        const session = await _getSession();
        if (!session) return [];

        const { data, error } = await supabase
            .from('teachers')
            .select('id, name, phone, email, google_email, google_sub, created_at')
            .eq('owner_user_id', session.user.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('선생님 목록 조회 실패:', err);
        return [];
    }
}

window.deleteTeacherById = async function(teacherId) {
    try {
        const session = await _getSession();
        if (!session) {
            showToast('로그인이 필요합니다', 'warning');
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
        showToast('선생님 삭제 실패: ' + err.message, 'error');
        return false;
    }
}


// ========== 일정(Schedules) 관련 함수 ==========

window.saveScheduleToDatabase = async function(scheduleData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[saveScheduleToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        const { data, error } = await supabase
            .from('schedules')
            .upsert({
                owner_user_id: ownerId,
                teacher_id: scheduleData.teacherId,
                student_id: parseInt(scheduleData.studentId),
                schedule_date: scheduleData.date,
                start_time: scheduleData.startTime,
                duration: parseInt(scheduleData.duration)
            }, {
                onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
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

window.saveSchedulesToDatabaseBatch = async function(scheduleList) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[saveSchedulesToDatabaseBatch] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        if (!Array.isArray(scheduleList) || scheduleList.length === 0) return [];

        const payload = scheduleList.map(item => ({
            owner_user_id: ownerId,
            teacher_id: item.teacherId,
            student_id: parseInt(item.studentId),
            schedule_date: item.date,
            start_time: item.startTime,
            duration: parseInt(item.duration)
        }));

        // 청크 사이즈를 500으로 증가 (Supabase 기본 제한 1000)
        const chunkSize = 500;
        
        if (payload.length <= chunkSize) {
            // 단일 청크면 바로 전송
            const { data, error } = await supabase
                .from('schedules')
                .upsert(payload, {
                    onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
                    ignoreDuplicates: false
                })
                .select();
            if (error) throw error;
            return data || [];
        }

        // 다중 청크: 병렬 처리
        const chunks = [];
        for (let i = 0; i < payload.length; i += chunkSize) {
            chunks.push(payload.slice(i, i + chunkSize));
        }

        const results = await Promise.all(chunks.map(chunk =>
            supabase
                .from('schedules')
                .upsert(chunk, {
                    onConflict: 'owner_user_id,teacher_id,student_id,schedule_date,start_time',
                    ignoreDuplicates: false
                })
                .select()
        ));

        // 결과 합치기 & 에러 체크
        let combined = [];
        for (const result of results) {
            if (result.error) throw result.error;
            if (result.data) combined = combined.concat(result.data);
        }
        return combined;
    } catch (error) {
        console.error('[saveSchedulesToDatabaseBatch] 에러:', error);
        throw error;
    }
}

window.getSchedulesByTeacher = async function(teacherId) {
    try {
        const ownerId = _getOwnerId();

        const { data, error } = await supabase
            .from('schedules')
            .select('id, student_id, schedule_date, start_time, duration')
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

window.getSchedulesByStudent = async function(studentId) {
    try {
        const ownerId = _getOwnerId();
        const numericId = parseInt(studentId);

        const { data, error } = await supabase
            .from('schedules')
            .select('id, teacher_id, schedule_date, start_time, duration')
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

window.deleteScheduleFromDatabase = async function(studentId, date, teacherId = null, startTime = null) {
    try {
        const numericId = parseInt(studentId);
        const effectiveTeacherId = teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : null);
        if (!effectiveTeacherId) {
            console.warn('[deleteScheduleFromDatabase] teacherId가 없어 삭제를 중단합니다.');
            return false;
        }

        let query = supabase
            .from('schedules')
            .delete()
            .eq('student_id', numericId)
            .eq('schedule_date', date)
            .eq('teacher_id', effectiveTeacherId);

        if (startTime) query = query.eq('start_time', startTime);

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteScheduleFromDatabase] 에러:', error);
        throw error;
    }
}

window.deleteSchedulesByRange = async function(studentId, startDate, endDate, teacherId = null) {
    try {
        const numericId = parseInt(studentId);
        const effectiveTeacherId = teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : null);
        if (!effectiveTeacherId) {
            console.warn('[deleteSchedulesByRange] teacherId가 없어 삭제를 중단합니다.');
            return false;
        }

        const ownerId = _getOwnerId();
        let query = supabase
            .from('schedules')
            .delete()
            .eq('student_id', numericId)
            .eq('teacher_id', effectiveTeacherId);

        if (ownerId) query = query.eq('owner_user_id', ownerId);
        if (startDate) query = query.gte('schedule_date', startDate);
        if (endDate) query = query.lte('schedule_date', endDate);

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteSchedulesByRange] 에러:', error);
        throw error;
    }
}

window.deleteSchedulesByTeacherRange = async function(startDate, endDate, teacherId = null) {
    try {
        const effectiveTeacherId = teacherId || (typeof currentTeacherId !== 'undefined' ? currentTeacherId : null);
        if (!effectiveTeacherId) {
            console.warn('[deleteSchedulesByTeacherRange] teacherId가 없어 삭제를 중단합니다.');
            return false;
        }

        const ownerId = _getOwnerId();
        let query = supabase
            .from('schedules')
            .delete()
            .eq('teacher_id', effectiveTeacherId);

        if (ownerId) query = query.eq('owner_user_id', ownerId);
        if (startDate) query = query.gte('schedule_date', startDate);
        if (endDate) query = query.lte('schedule_date', endDate);

        const { error } = await query;
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[deleteSchedulesByTeacherRange] 에러:', error);
        throw error;
    }
}


// ========== 커스텀 휴일(Holidays) 관련 함수 ==========

window.saveHolidayToDatabase = async function(holidayData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[saveHolidayToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        const { data, error } = await supabase
            .from('holidays')
            .upsert({
                owner_user_id: ownerId,
                teacher_id: holidayData.teacherId,
                holiday_date: holidayData.date,
                holiday_name: holidayData.name,
                color: holidayData.color || '#ef4444'
            }, {
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

window.getHolidaysByTeacher = async function(teacherId) {
    try {
        const ownerId = _getOwnerId();

        // 개인 스케줄 + 학원 전체 일정(teacher_id='academy') 모두 조회
        const { data, error } = await supabase
            .from('holidays')
            .select('id, holiday_date, holiday_name, color, teacher_id')
            .eq('owner_user_id', ownerId)
            .in('teacher_id', [teacherId, 'academy'])
            .order('holiday_date', { ascending: true });

        if (error) throw error;
        return (data || []).map(h => ({
            ...h,
            scheduleType: h.teacher_id === 'academy' ? 'academy' : 'personal'
        }));
    } catch (error) {
        console.error('[getHolidaysByTeacher] 에러:', error);
        return [];
    }
}

window.deleteHolidayFromDatabase = async function(teacherId, date) {
    try {
        const ownerId = _getOwnerId();

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


// ========== 결제(Payments) 관련 함수 ==========

window.savePaymentToDatabase = async function(paymentData) {
    try {
        const ownerId = _getOwnerId();
        if (!ownerId) {
            console.warn('[savePaymentToDatabase] current_owner_id 없음 - 저장 중단');
            throw new Error('로그인이 필요합니다');
        }

        const { data, error } = await supabase
            .from('payments')
            .upsert({
                owner_user_id: ownerId,
                teacher_id: paymentData.teacherId,
                student_id: parseInt(paymentData.studentId),
                payment_month: paymentData.month,
                amount: parseInt(paymentData.amount),
                paid_amount: parseInt(paymentData.paidAmount || 0),
                payment_status: paymentData.status || 'unpaid',
                payment_date: paymentData.paymentDate || null,
                memo: paymentData.memo || null
            }, {
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

window.getPaymentsByMonth = async function(teacherId, month) {
    try {
        const ownerId = _getOwnerId();

        const { data, error } = await supabase
            .from('payments')
            .select('id, student_id, amount, paid_amount, payment_status, payment_date, memo')
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

window.getPaymentsByStudent = async function(studentId) {
    try {
        const ownerId = _getOwnerId();
        const numericId = parseInt(studentId);

        const { data, error } = await supabase
            .from('payments')
            .select('id, payment_month, amount, paid_amount, payment_status, payment_date, memo')
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
