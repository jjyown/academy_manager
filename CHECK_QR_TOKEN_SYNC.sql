-- QR 토큰 동기화 문제 진단 SQL

-- 1. students 테이블에 qr_code_data 컬럼 존재 확인
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'students' 
AND column_name = 'qr_code_data';

-- 2. students 테이블의 RLS 정책 확인
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'students'
ORDER BY cmd, policyname;

-- 3. students 테이블의 권한 확인
SELECT 
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'students'
ORDER BY grantee, privilege_type;

-- 4. 현재 저장된 QR 토큰 데이터 샘플 확인 (개인정보 제외)
SELECT 
    id,
    name,
    CASE 
        WHEN qr_code_data IS NULL THEN 'NULL'
        WHEN qr_code_data = '' THEN 'EMPTY'
        ELSE 'EXISTS (' || LENGTH(qr_code_data) || ' chars)'
    END as qr_token_status,
    LEFT(qr_code_data, 20) || '...' as token_preview
FROM students
ORDER BY id
LIMIT 10;

-- 5. qr_code_data가 NULL인 학생 수 확인
SELECT 
    COUNT(*) as total_students,
    COUNT(qr_code_data) as students_with_token,
    COUNT(*) - COUNT(qr_code_data) as students_without_token
FROM students;

-- 6. RLS가 활성화되어 있는지 확인
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'students';

-- 7. 문제 해결을 위한 권장 사항:
-- 만약 UPDATE 권한이 없거나 RLS 정책이 UPDATE를 막고 있다면 다음을 실행:

-- RLS 정책 추가 (소유자만 자신의 학생 업데이트 가능)
/*
CREATE POLICY "Users can update their own students"
ON students
FOR UPDATE
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());
*/

-- 또는 qr_code_data 컬럼에 대한 UPDATE 권한 부여
/*
GRANT UPDATE (qr_code_data) ON students TO authenticated;
*/

-- 8. 트리거나 함수가 업데이트를 방해하는지 확인
SELECT 
    trigger_name,
    event_manipulation,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'students'
ORDER BY trigger_name;
