-- ============================================================
-- 자동 채점 시스템 DB 테이블
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 0) 중앙 관리 드라이브 설정 (원장님 jjyown@gmail.com)
-- teachers 테이블에 "중앙 관리자" 역할 플래그 추가
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_central_admin BOOLEAN DEFAULT FALSE;
-- 중앙 드라이브의 refresh_token은 기존 google_drive_refresh_token 컬럼 사용
-- is_central_admin=true 인 선생님의 토큰이 중앙 드라이브 토큰

-- homework_submissions 테이블에 중앙 + 선생님 드라이브 정보 추가
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS central_drive_file_id TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS central_drive_file_url TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS teacher_drive_file_id TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS teacher_drive_file_url TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'pending'
    CHECK (grading_status IN ('pending', 'grading', 'graded', 'confirmed'));

-- 1) 교재/정답 관리 (중앙 드라이브에 저장)
CREATE TABLE IF NOT EXISTS answer_keys (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                          -- "수학 문제집 A"
    subject TEXT DEFAULT '',                      -- 과목
    drive_file_id TEXT,                           -- 정답 PDF 드라이브 ID (중앙 드라이브)
    drive_folder_id TEXT,                         -- 소속 폴더 ID (중앙 드라이브)
    total_questions INTEGER DEFAULT 0,            -- 총 문제 수
    answers_json JSONB DEFAULT '{}',              -- {"1":"③","2":"①",...}
    question_types_json JSONB DEFAULT '{}',       -- {"1":"mc","2":"mc","5":"essay"}
    parsed BOOLEAN DEFAULT FALSE,                 -- 정답 추출 완료 여부
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) 과제 배정
CREATE TABLE IF NOT EXISTS grading_assignments (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answer_key_id BIGINT REFERENCES answer_keys(id) ON DELETE SET NULL,
    title TEXT NOT NULL,                          -- "수학 42~45쪽"
    page_range TEXT DEFAULT '',                   -- "42-45"
    assigned_students JSONB DEFAULT '[]',         -- [student_id, ...]
    due_date DATE,
    mode TEXT DEFAULT 'assigned' CHECK (mode IN ('assigned', 'auto_search')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) 채점 결과 (학생별)
CREATE TABLE IF NOT EXISTS grading_results (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assignment_id BIGINT REFERENCES grading_assignments(id) ON DELETE SET NULL,
    answer_key_id BIGINT REFERENCES answer_keys(id) ON DELETE SET NULL,
    homework_submission_id BIGINT,                -- homework_submissions와 연결
    mode TEXT DEFAULT 'assigned' CHECK (mode IN ('assigned', 'auto_search', 'instant')),
    total_score NUMERIC(5,1) DEFAULT 0,
    max_score NUMERIC(5,1) DEFAULT 100,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    uncertain_count INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    status TEXT DEFAULT 'grading' CHECK (status IN ('grading', 'review_needed', 'confirmed')),
    -- 중앙 드라이브(jjyown) 원본 파일
    central_original_drive_ids JSONB DEFAULT '[]',
    -- 중앙 드라이브(jjyown) 채점 결과 이미지
    central_graded_drive_ids JSONB DEFAULT '[]',
    central_graded_image_urls JSONB DEFAULT '[]',
    -- 선생님 드라이브 채점 결과 이미지 (최종 전송)
    teacher_graded_drive_ids JSONB DEFAULT '[]',
    teacher_graded_image_urls JSONB DEFAULT '[]',
    teacher_annotations JSONB DEFAULT '[]',       -- 선생님 필기 데이터
    teacher_memo TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) 문항별 상세
CREATE TABLE IF NOT EXISTS grading_items (
    id BIGSERIAL PRIMARY KEY,
    result_id BIGINT NOT NULL REFERENCES grading_results(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'short_answer', 'essay')),
    student_answer TEXT DEFAULT '',
    correct_answer TEXT DEFAULT '',
    is_correct BOOLEAN,
    confidence NUMERIC(5,2) DEFAULT 0,
    ocr1_answer TEXT DEFAULT '',
    ocr2_answer TEXT DEFAULT '',
    ai_score NUMERIC(5,1),
    ai_max_score NUMERIC(5,1) DEFAULT 10,
    ai_feedback TEXT DEFAULT '',
    teacher_score NUMERIC(5,1),
    teacher_feedback TEXT DEFAULT '',
    position_x NUMERIC(7,2),
    position_y NUMERIC(7,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5) 채점 통계 (반 전체 / 월별)
CREATE TABLE IF NOT EXISTS grading_stats (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answer_key_id BIGINT REFERENCES answer_keys(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    avg_score NUMERIC(5,1) DEFAULT 0,
    max_student_score NUMERIC(5,1) DEFAULT 0,
    min_student_score NUMERIC(5,1) DEFAULT 0,
    most_wrong_json JSONB DEFAULT '[]',
    student_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6) 종합평가 자동화 (기존 eval과 연동)
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT TRUE;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS ai_draft TEXT DEFAULT '';

-- ============================================================
-- 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_answer_keys_teacher ON answer_keys(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grading_assignments_teacher ON grading_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_student ON grading_results(student_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_teacher ON grading_results(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_assignment ON grading_results(assignment_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_status ON grading_results(status);
CREATE INDEX IF NOT EXISTS idx_grading_results_homework ON grading_results(homework_submission_id);
CREATE INDEX IF NOT EXISTS idx_grading_items_result ON grading_items(result_id);
CREATE INDEX IF NOT EXISTS idx_grading_stats_teacher_month ON grading_stats(teacher_id, month);
CREATE INDEX IF NOT EXISTS idx_homework_grading_status ON homework_submissions(grading_status);

-- ============================================================
-- RLS 정책
-- ============================================================
ALTER TABLE answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_stats ENABLE ROW LEVEL SECURITY;

-- answer_keys: 모든 인증된 사용자 조회 + 본인만 수정
CREATE POLICY answer_keys_read ON answer_keys FOR SELECT USING (true);
CREATE POLICY answer_keys_write ON answer_keys FOR ALL USING (auth.uid() = teacher_id);

-- grading_assignments: 본인 데이터만
CREATE POLICY grading_assignments_teacher_all ON grading_assignments FOR ALL USING (auth.uid() = teacher_id);

-- grading_results: 선생님은 본인 것, 학생/학부모는 조회만
CREATE POLICY grading_results_teacher_all ON grading_results FOR ALL USING (auth.uid() = teacher_id);
CREATE POLICY grading_results_public_read ON grading_results FOR SELECT USING (true);

-- grading_items: 조회 공개 + 선생님만 수정
CREATE POLICY grading_items_public_read ON grading_items FOR SELECT USING (true);
CREATE POLICY grading_items_teacher_all ON grading_items FOR ALL USING (
    EXISTS (SELECT 1 FROM grading_results gr WHERE gr.id = grading_items.result_id AND gr.teacher_id = auth.uid())
);

-- grading_stats: 선생님만
CREATE POLICY grading_stats_teacher_all ON grading_stats FOR ALL USING (auth.uid() = teacher_id);
