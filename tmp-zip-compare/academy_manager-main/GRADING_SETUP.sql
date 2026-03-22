-- ============================================================
-- 자동 채점 시스템 DB 테이블
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 0) 중앙 관리 드라이브 설정 (원장님 jjyown@gmail.com)
-- teachers 테이블에 "중앙 관리자" 역할 플래그 추가
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_central_admin BOOLEAN DEFAULT FALSE;
-- 채점 관리 로그인용 이메일 컬럼
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email TEXT;
-- 중앙 드라이브의 refresh_token은 기존 google_drive_refresh_token 컬럼 사용
-- is_central_admin=true 인 선생님의 토큰이 중앙 드라이브 토큰

-- homework_submissions 테이블에 중앙 + 선생님 드라이브 정보 추가
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS central_drive_file_id TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS central_drive_file_url TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS teacher_drive_file_id TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS teacher_drive_file_url TEXT;
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'pending'
    CHECK (grading_status IN ('pending', 'grading', 'graded', 'confirmed', 'grading_failed'));

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
    page_images_json JSONB DEFAULT '[]',          -- [{page,drive_file_id,url}, ...]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 테이블에 컬럼이 없으면 추가
ALTER TABLE answer_keys ADD COLUMN IF NOT EXISTS page_images_json JSONB DEFAULT '[]';
ALTER TABLE answer_keys ADD COLUMN IF NOT EXISTS bookmarks_json JSONB DEFAULT '[]';

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
    unanswered_count INTEGER DEFAULT 0,             -- 미풀이 문제 수
    total_questions INTEGER DEFAULT 0,
    page_info TEXT DEFAULT '',                       -- 채점 페이지 정보 (예: "쎈 공통수학1 p.45-47")
    status TEXT DEFAULT 'grading' CHECK (status IN ('grading', 'review_needed', 'confirmed', 'failed', 'regrading')),
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
    question_label TEXT DEFAULT '',                    -- 소문제 포함 원본 라벨 (예: "3(1)", "3(2)")
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

-- 6) 종합평가 자동화
CREATE TABLE IF NOT EXISTS evaluations (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    month TEXT NOT NULL,                              -- "2026-02"
    content TEXT DEFAULT '',                          -- 종합평가 내용
    auto_generated BOOLEAN DEFAULT FALSE,             -- AI 자동 생성 여부
    approved BOOLEAN DEFAULT TRUE,                    -- 선생님 승인 여부
    ai_draft TEXT DEFAULT '',                         -- AI 초안
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7) 학생-교재 연결 (학생이 현재 풀고 있는 교재 목록)
CREATE TABLE IF NOT EXISTS student_books (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    answer_key_id BIGINT NOT NULL REFERENCES answer_keys(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8) 알림
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT DEFAULT 'info',
    title TEXT DEFAULT '',
    message TEXT DEFAULT '',
    data JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- UNIQUE 제약조건 (upsert용)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_grading_stats_teacher_key_month'
  ) THEN
    ALTER TABLE grading_stats
      ADD CONSTRAINT uq_grading_stats_teacher_key_month
      UNIQUE (teacher_id, answer_key_id, month);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_evaluations_teacher_student_month'
  ) THEN
    ALTER TABLE evaluations
      ADD CONSTRAINT uq_evaluations_teacher_student_month
      UNIQUE (teacher_id, student_id, month);
  END IF;
END $$;

-- student_books: 같은 학생에게 같은 교재 중복 방지
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_books_student_key'
  ) THEN
    ALTER TABLE student_books
      ADD CONSTRAINT uq_student_books_student_key
      UNIQUE (student_id, answer_key_id);
  END IF;
END $$;

-- answer_keys: 같은 선생님이 같은 제목으로 중복 등록 방지
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_answer_keys_teacher_title'
  ) THEN
    ALTER TABLE answer_keys
      ADD CONSTRAINT uq_answer_keys_teacher_title
      UNIQUE (teacher_id, title);
  END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_notifications_teacher ON notifications(teacher_id);
CREATE INDEX IF NOT EXISTS idx_student_books_student ON student_books(student_id);
CREATE INDEX IF NOT EXISTS idx_student_books_teacher ON student_books(teacher_id);

-- ============================================================
-- RLS 정책
-- ============================================================
ALTER TABLE answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- teachers: 인증된 사용자만 조회 가능 (채점 관리 로그인 확인용)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'teachers_read_all' AND tablename = 'teachers') THEN
    EXECUTE 'CREATE POLICY teachers_read_all ON teachers FOR SELECT USING (auth.role() = ''authenticated'')';
  END IF;
END $$;

-- answer_keys: 인증된 사용자만 조회 + 본인만 수정
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'answer_keys_read' AND tablename = 'answer_keys') THEN
    EXECUTE 'CREATE POLICY answer_keys_read ON answer_keys FOR SELECT USING (auth.role() = ''authenticated'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'answer_keys_write' AND tablename = 'answer_keys') THEN
    EXECUTE 'CREATE POLICY answer_keys_write ON answer_keys FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;

-- grading_assignments: 본인 데이터만
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_assignments_teacher_all' AND tablename = 'grading_assignments') THEN
    EXECUTE 'CREATE POLICY grading_assignments_teacher_all ON grading_assignments FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;

-- grading_results: 선생님은 본인 것, 인증된 사용자는 조회만
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_results_teacher_all' AND tablename = 'grading_results') THEN
    EXECUTE 'CREATE POLICY grading_results_teacher_all ON grading_results FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_results_authenticated_read' AND tablename = 'grading_results') THEN
    EXECUTE 'CREATE POLICY grading_results_authenticated_read ON grading_results FOR SELECT USING (auth.role() = ''authenticated'')';
  END IF;
END $$;

-- grading_items: 인증된 사용자만 조회 + 선생님만 수정
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_items_authenticated_read' AND tablename = 'grading_items') THEN
    EXECUTE 'CREATE POLICY grading_items_authenticated_read ON grading_items FOR SELECT USING (auth.role() = ''authenticated'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_items_teacher_all' AND tablename = 'grading_items') THEN
    EXECUTE 'CREATE POLICY grading_items_teacher_all ON grading_items FOR ALL USING (EXISTS (SELECT 1 FROM grading_results gr WHERE gr.id = grading_items.result_id AND gr.teacher_id = auth.uid()))';
  END IF;
END $$;

-- grading_stats: 선생님만
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'grading_stats_teacher_all' AND tablename = 'grading_stats') THEN
    EXECUTE 'CREATE POLICY grading_stats_teacher_all ON grading_stats FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;

-- evaluations: RLS 활성화 + 정책
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'evaluations_teacher_all' AND tablename = 'evaluations') THEN
    EXECUTE 'CREATE POLICY evaluations_teacher_all ON evaluations FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'evaluations_authenticated_read' AND tablename = 'evaluations') THEN
    EXECUTE 'CREATE POLICY evaluations_authenticated_read ON evaluations FOR SELECT USING (auth.role() = ''authenticated'')';
  END IF;
END $$;

-- student_books: 본인 데이터만
ALTER TABLE student_books ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'student_books_teacher_all' AND tablename = 'student_books') THEN
    EXECUTE 'CREATE POLICY student_books_teacher_all ON student_books FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;

-- notifications: 본인 알림만
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_teacher_all' AND tablename = 'notifications') THEN
    EXECUTE 'CREATE POLICY notifications_teacher_all ON notifications FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;

-- ============================================================
-- 마이그레이션: Smart Grading 컬럼 추가
-- ============================================================
ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS unanswered_count INTEGER DEFAULT 0;
ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS page_info TEXT DEFAULT '';
ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT '';

-- ============================================================
-- 마이그레이션: CHECK 제약조건 확장 (기존 DB에서 실행)
-- ============================================================
-- grading_results.status: 'failed', 'regrading' 추가
ALTER TABLE grading_results DROP CONSTRAINT IF EXISTS grading_results_status_check;
ALTER TABLE grading_results ADD CONSTRAINT grading_results_status_check
    CHECK (status IN ('grading', 'review_needed', 'confirmed', 'failed', 'regrading'));

-- homework_submissions.grading_status: 'grading_failed' 추가
ALTER TABLE homework_submissions DROP CONSTRAINT IF EXISTS homework_submissions_grading_status_check;
ALTER TABLE homework_submissions ADD CONSTRAINT homework_submissions_grading_status_check
    CHECK (grading_status IN ('pending', 'grading', 'graded', 'confirmed', 'grading_failed'));

-- grading_items.question_label: 소문제 구분용 라벨 컬럼 추가
ALTER TABLE grading_items ADD COLUMN IF NOT EXISTS question_label TEXT DEFAULT '';

-- answer_keys.grade_level: 학년별 교재 분류용 컬럼 추가
ALTER TABLE answer_keys ADD COLUMN IF NOT EXISTS grade_level TEXT DEFAULT '';

-- ============================================================
-- AI 피드백 학습 테이블: 선생님 수정 → AI 개선
-- ============================================================
CREATE TABLE IF NOT EXISTS grading_feedback (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID REFERENCES auth.users(id),
    result_id BIGINT REFERENCES grading_results(id) ON DELETE SET NULL,
    item_id BIGINT REFERENCES grading_items(id) ON DELETE SET NULL,
    question_number INTEGER,
    question_type TEXT DEFAULT 'multiple_choice',
    ai_answer TEXT NOT NULL DEFAULT '',
    correct_answer TEXT DEFAULT '',
    teacher_corrected_answer TEXT NOT NULL DEFAULT '',
    error_type TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grading_feedback_teacher ON grading_feedback(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grading_feedback_type ON grading_feedback(error_type);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feedback_teacher_all') THEN
    EXECUTE 'CREATE POLICY feedback_teacher_all ON grading_feedback FOR ALL USING (auth.uid() = teacher_id)';
  END IF;
END $$;
ALTER TABLE grading_feedback ENABLE ROW LEVEL SECURITY;
