// QR 토큰 동기화 테스트 함수

// 콘솔에서 실행: testQRTokenSync(학생ID)
window.testQRTokenSync = async function(studentId) {
    console.log('========================================');
    console.log('QR 토큰 동기화 테스트 시작');
    console.log('학생 ID:', studentId);
    console.log('========================================');
    
    // 1. 현재 로컬 토큰 확인
    const localTokens = JSON.parse(localStorage.getItem('student_qr_tokens') || '{}');
    const localToken = localTokens[studentId];
    console.log('1. 로컬 토큰:', localToken ? localToken.substring(0, 30) + '...' : 'NULL');
    
    // 2. DB에서 토큰 조회
    let dbToken = null;
    try {
        const { data, error } = await supabase
            .from('students')
            .select('id, name, qr_code_data')
            .eq('id', parseInt(studentId))
            .maybeSingle();
        
        if (error) {
            console.error('2. DB 조회 실패:', error);
        } else if (!data) {
            console.log('2. DB에 학생 없음');
        } else {
            dbToken = data.qr_code_data;
            console.log('2. DB 토큰:', dbToken ? dbToken.substring(0, 30) + '...' : 'NULL');
            console.log('   학생 이름:', data.name);
        }
    } catch (e) {
        console.error('2. DB 조회 예외:', e);
    }
    
    // 3. 토큰 일치 여부 확인
    console.log('3. 토큰 일치:', localToken === dbToken ? '✅ 일치' : '❌ 불일치');
    if (localToken !== dbToken) {
        console.log('   로컬:', localToken || 'NULL');
        console.log('   DB:', dbToken || 'NULL');
    }
    
    // 4. 새 토큰 생성 및 저장 테스트
    console.log('4. 새 토큰 생성 테스트...');
    const newToken = `${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
    console.log('   생성된 토큰:', newToken.substring(0, 30) + '...');
    
    try {
        const { data, error } = await supabase
            .from('students')
            .update({ qr_code_data: newToken })
            .eq('id', parseInt(studentId))
            .select();
        
        if (error) {
            console.error('   ❌ DB 업데이트 실패:', error);
            console.error('   에러 코드:', error.code);
            console.error('   에러 메시지:', error.message);
        } else if (!data || data.length === 0) {
            console.error('   ❌ 업데이트된 행이 없음 (RLS 정책 문제 가능성)');
        } else {
            console.log('   ✅ DB 업데이트 성공');
            console.log('   영향받은 행:', data.length);
        }
    } catch (e) {
        console.error('   ❌ DB 업데이트 예외:', e);
    }
    
    // 5. 업데이트 후 재조회
    console.log('5. 업데이트 후 DB 재조회...');
    try {
        const { data, error } = await supabase
            .from('students')
            .select('qr_code_data')
            .eq('id', parseInt(studentId))
            .maybeSingle();
        
        if (error) {
            console.error('   ❌ 재조회 실패:', error);
        } else {
            const reloadedToken = data?.qr_code_data;
            console.log('   재조회된 토큰:', reloadedToken ? reloadedToken.substring(0, 30) + '...' : 'NULL');
            console.log('   저장 검증:', reloadedToken === newToken ? '✅ 일치' : '❌ 불일치');
        }
    } catch (e) {
        console.error('   ❌ 재조회 예외:', e);
    }
    
    // 6. 현재 사용자 확인
    console.log('6. 현재 사용자 정보...');
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            console.log('   사용자 ID:', user.id);
            console.log('   이메일:', user.email);
        } else {
            console.log('   ❌ 로그인되지 않음');
        }
    } catch (e) {
        console.error('   ❌ 사용자 조회 실패:', e);
    }
    
    // 7. students 테이블의 owner_user_id 확인
    console.log('7. 학생의 소유자 확인...');
    try {
        const { data, error } = await supabase
            .from('students')
            .select('id, name, owner_user_id')
            .eq('id', parseInt(studentId))
            .maybeSingle();
        
        if (error) {
            console.error('   ❌ 조회 실패:', error);
        } else if (data) {
            console.log('   학생 소유자 ID:', data.owner_user_id);
            
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                console.log('   소유자 일치:', data.owner_user_id === user.id ? '✅ 일치' : '❌ 불일치');
            }
        }
    } catch (e) {
        console.error('   ❌ 조회 예외:', e);
    }
    
    console.log('========================================');
    console.log('테스트 완료');
    console.log('========================================');
};

// 간단한 사용법 안내
console.log('QR 토큰 테스트 함수가 로드되었습니다.');
console.log('사용법: testQRTokenSync(학생ID)');
console.log('예: testQRTokenSync(1)');
