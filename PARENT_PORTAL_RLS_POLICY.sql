-- 학부모 포털 접근 권한 설정
-- Supabase SQL Editor에서 실행하세요

-- 1. students 테이블 - 공개 읽기 (이름과 전화번호로만 조회)
CREATE POLICY "Anyone can read students" ON public.students
    FOR SELECT USING (true);

-- 2. attendance_records 테이블 - 공개 읽기
CREATE POLICY "Anyone can read attendance records" ON public.attendance_records
    FOR SELECT USING (true);

-- 3. student_evaluations 테이블 - 공개 읽기 및 쓰기
CREATE POLICY "Anyone can read evaluations" ON public.student_evaluations
    FOR SELECT USING (true);

CREATE POLICY "Anyone can insert evaluations" ON public.student_evaluations
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update evaluations" ON public.student_evaluations
    FOR UPDATE USING (true);

-- 4. teachers 테이블 - 공개 읽기 (선생님 인증 목록 조회용)
CREATE POLICY "Anyone can read teachers" ON public.teachers
    FOR SELECT USING (true);
