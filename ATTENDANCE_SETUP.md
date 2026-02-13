# QR코드 출석 관리 시스템 설정

## 1. Supabase 테이블 생성

다음 SQL을 Supabase SQL Editor에서 실행하세요:

```sql
-- 출석 기록 테이블
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 출석 정보
    attendance_date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    scheduled_time TIME,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'late', 'absent', 'makeup')),
    
    -- QR 코드 정보
    qr_scanned BOOLEAN DEFAULT FALSE,
    qr_scan_time TIMESTAMP WITH TIME ZONE,
    
    -- 메모
    memo TEXT,
    
    -- 변경사유 (상태 변경 시 기록)
    change_reason TEXT,
    original_status VARCHAR(20),
    changed_at TIMESTAMP WITH TIME ZONE,
    
    -- 메타 데이터
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 같은 날 같은 학생/선생님 중복 기록 방지
    UNIQUE(student_id, attendance_date, teacher_id)
);

-- 인덱스 생성 (성능 향상)
CREATE INDEX idx_attendance_student ON attendance_records(student_id);
CREATE INDEX idx_attendance_teacher ON attendance_records(teacher_id);
CREATE INDEX idx_attendance_owner ON attendance_records(owner_user_id);
CREATE INDEX idx_attendance_date ON attendance_records(attendance_date);

-- RLS (Row Level Security) 활성화
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 자신의 데이터만 조회/수정/삭제 가능
CREATE POLICY "Users can manage their own attendance records"
ON attendance_records
FOR ALL
USING (owner_user_id = auth.uid());

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_updated_at_trigger
BEFORE UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION update_attendance_updated_at();

-- students 테이블에 QR 코드 데이터 컬럼 추가 (이미 있다면 에러 무시)
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE students ADD COLUMN qr_code_data TEXT;
    EXCEPTION
        WHEN duplicate_column THEN 
            RAISE NOTICE 'Column qr_code_data already exists in students table.';
    END;
END $$;

-- QR 코드는 학생 ID를 기반으로 생성됩니다
-- 형식: STUDENT_<ID>_<NAME>
```

## 2. 필요한 라이브러리

### QR코드 생성: qrcode.js
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
```

### QR코드 스캔: html5-qrcode
```html
<script src="https://unpkg.com/html5-qrcode"></script>
```

## 3. 출석 상태 코드

- `present`: 출석 (✅)
- `late`: 지각 (⏰)
- `absent`: 결석 (❌)
- `makeup`: 보강 (⚠️)

## 4. 자동 출석 체크 로직

1. 학생이 QR코드 스캔
2. 현재 시간과 예정된 수업 시간 비교
3. 수업 시작 시간 기준:
   - 10분 전 ~ 수업 시작: **출석**
   - 수업 시작 후 1~15분: **지각**
   - 수업 시작 후 15분 이후: **결석** (수동 처리 필요)
4. 출석 기록을 데이터베이스에 저장
5. 시간표에 자동으로 상태 반영

## 5. 구현 단계

1. ✅ 데이터베이스 테이블 생성
2. 학생별 QR코드 생성 및 표시
3. QR코드 스캔 페이지 구현
4. 출석 기록 저장 및 조회 기능
5. 시간표 UI 수정 (출석/지각/결석/보강)
6. 자동 출석 체크 로직 구현
7. 학생별 출석 기록 조회 페이지
8. 관리자 메뉴에 QR 출석 관리 추가
