# Academy Manager — 시스템 아키텍처

> 마지막 갱신: 2026-05-10
>
> Mermaid 다이어그램은 GitHub·VS Code (Markdown Preview Mermaid Support 확장) 등에서
> 자동으로 이미지로 렌더링됩니다. 미리보기가 안 보이면 [mermaid.live](https://mermaid.live) 에 코드를 붙여넣어 확인.

---

## 1. 전체 시스템 — Top-level Architecture

```mermaid
flowchart LR
    %% ================== 클라이언트 ==================
    subgraph CLIENT["🖥️ 클라이언트 (브라우저)"]
        direction TB
        MAIN["메인 앱<br/>(원장·선생님)<br/><i>index.html / script.js</i>"]
        PARENT["학부모 포털<br/><i>parent-portal/index.html</i>"]
        HW["숙제 제출 페이지<br/><i>homework/index.html</i>"]
        GR["채점 관리 페이지<br/><i>grading/index.html</i>"]
    end

    %% ================== Supabase ==================
    subgraph SUPABASE["☁️ Supabase Cloud"]
        direction TB
        AUTH["🔐 Auth<br/>이메일·비밀번호"]
        DB[("🗄️ PostgreSQL<br/>RLS 적용")]
        STORAGE["📦 Storage<br/>student-eval-reports<br/>(public bucket)"]

        subgraph EDGE["⚡ Edge Functions (Deno)"]
            EF1["generate-student-eval-report<br/><b>Gemini 2.5-flash 2단계</b>"]
            EF2["collect-admissions-knowledge<br/><b>Gemini 2.5-flash + scrape</b>"]
            EF3["upload-homework"]
            EF4["verify-teacher-pin"]
            EF5["send-reset-code"]
            EF6["exchange-google-token"]
        end

        subgraph CRON["⏰ pg_cron"]
            CR1["admissions_knowledge_weekly<br/>매주 월 06:00 KST"]
        end
    end

    %% ================== 외부 서비스 ==================
    subgraph EXTERNAL["🌐 외부 API · 서비스"]
        direction TB
        GEMINI["🤖 Google Gemini<br/>2.5-flash"]
        OPENAI["🤖 OpenAI<br/>GPT-4o (Vision OCR)"]
        NEIS["🏫 NEIS Open API<br/>학사일정"]
        KYOBIT["📰 kyobit.com"]
        VERITAS["📰 veritas-a.com"]
        GDRIVE["☁️ Google Drive<br/>숙제 원본·채점 결과"]
    end

    %% ================== Railway ==================
    subgraph RAILWAY["🚂 Railway (Python)"]
        GRSERVER["grading-server<br/>FastAPI · OCR 채점<br/><i>gpt-4o + gemini-2.5-flash</i>"]
    end

    %% ================== 클라이언트 ↔ Supabase ==================
    MAIN -->|"CRUD · RLS"| DB
    MAIN -->|"세션"| AUTH
    MAIN -->|"이미지 리포트<br/>업로드"| STORAGE
    MAIN -->|"AI 호출"| EF1
    MAIN -->|"수동 갱신"| EF2

    PARENT -->|"읽기 (parent_portal_visible=true)"| DB
    PARENT -->|"평가 이미지<br/>public read"| STORAGE
    PARENT -->|"PIN 검증"| EF4

    HW -->|"숙제 조회·업로드"| EF3
    HW -->|"읽기"| DB
    HW -->|"파일 업로드"| GDRIVE

    GR -->|"채점 세션"| EF4
    GR -->|"채점 요청"| GRSERVER

    %% ================== Supabase 내부 ==================
    EF1 -->|"학생 데이터"| DB
    EF1 -->|"AI 호출"| GEMINI
    EF2 -->|"기사 fetch"| KYOBIT
    EF2 -->|"기사 fetch"| VERITAS
    EF2 -->|"요약"| GEMINI
    EF2 -->|"저장"| DB
    EF3 -->|"메타 저장"| DB
    EF3 -->|"파일"| GDRIVE
    EF6 --> GDRIVE
    CR1 -.->|"net.http_post<br/>x-cron-secret"| EF2

    %% ================== Railway ==================
    GRSERVER -->|"OCR Vision"| OPENAI
    GRSERVER -->|"답안 검증"| GEMINI
    GRSERVER -->|"채점 결과"| DB
    GRSERVER -->|"교재·답지<br/>업로드/다운로드"| GDRIVE

    %% ================== 학사일정 (NEIS) ==================
    MAIN -.->|"학교 검색·일정"| NEIS
    HW -.->|"학생 학교<br/>학사일정"| NEIS
    PARENT -.->|"학생 학교<br/>학사일정"| NEIS

    classDef supabase fill:#3ecf8e22,stroke:#3ecf8e,color:#000
    classDef edge fill:#3ecf8e44,stroke:#3ecf8e,color:#000
    classDef external fill:#ddd,stroke:#666,color:#000
    classDef client fill:#6366f122,stroke:#6366f1,color:#000
    classDef cron fill:#fef3c7,stroke:#d97706,color:#000

    class AUTH,DB,STORAGE supabase
    class EF1,EF2,EF3,EF4,EF5,EF6 edge
    class GEMINI,OPENAI,NEIS,KYOBIT,VERITAS,GDRIVE,GRSERVER external
    class MAIN,PARENT,HW,GR client
    class CR1 cron
```

---

## 2. 종합평가 AI 데이터 흐름 — 3-Tier RAG 파이프라인

```mermaid
flowchart TB
    START(["원장: 학생 모달<br/>→ AI 생성 클릭"])

    subgraph TIER1["🧭 Tier 1 — 입시 정보 수집 (주 1회 자동 + 수동)"]
        direction TB
        CRON1["⏰ 매주 월 06:00 KST<br/>cron.schedule"]
        T1FN["collect-admissions-knowledge<br/>Edge Function"]
        T1FN -->|"fetch articleList × 10"| KY[("kyobit.com<br/>5개 섹션")]
        T1FN -->|"fetch articleList × 10"| VR[("veritas-a.com<br/>5개 섹션")]
        T1FN -->|"본문 fetch × 24"| KY
        T1FN -->|"본문 fetch × 24"| VR
        T1FN -->|"6학년대 분류·요약 (Gemini 2.5-flash)"| GEMINI1[("Gemini")]
        T1FN -->|"INSERT 6 rows"| AKDB[("admissions_knowledge<br/>elementary/middle/high1~3/retake")]
        CRON1 -.-> T1FN
    end

    subgraph TIER2["🎓 Tier 2 — 입시 전문가 사전 분석 (Stage 1)"]
        direction TB
        T2FN["runAdmissionsExpertAnalysis()"]
        T2FN -->|"학년 → grade_band 매칭"| AKDB
        T2FN -->|"학생 출결·숙제·점수·메모"| STUDB[("students<br/>+ schedules<br/>+ attendance_records<br/>+ student_test_scores<br/>+ student_evaluations.class_memos")]
        T2FN -->|"고정 지침 합산"| STYLE[("student_eval_ai_style_entries")]
        T2FN -->|"내부 분석 노트 생성<br/>5섹션 (A~E)"| GEMINI2[("Gemini")]
    end

    subgraph TIER3["📝 Tier 3 — 학부모용 종합평가 작성 (Stage 2)"]
        direction TB
        T3FN["generate-student-eval-report<br/>main handler"]
        T3FN -->|"systemInstruction + admissionsBlock + ownerStyleNote"| GEMINI3[("Gemini")]
        GEMINI3 -->|"01~04 4섹션 텍스트"| OUT["postProcessEvalText<br/>→ 클라이언트 textarea"]
    end

    subgraph TIER4["🖼️ Tier 4 — 이미지 리포트 발송"]
        direction TB
        IMGGEN["html2canvas<br/>→ PNG Blob"]
        IMGUP["Storage 업로드<br/>student-eval-reports/<br/>{owner}/{student}_{month}.png"]
        IMGURL["student_evaluations.image_url<br/>저장"]
        IMGGEN --> IMGUP --> IMGURL
        PRTL[/"학부모 포털:<br/>image_url 우선 표시<br/>(텍스트 폴백)"/]
        IMGURL --> PRTL
    end

    START --> T2FN
    T2FN --> T3FN
    OUT --> EDIT(["원장: 편집·저장"])
    EDIT --> TOGGLE(["학부모 공개 ON"])
    TOGGLE -->|"image_url 비어있으면<br/>자동 생성"| IMGGEN
    TOGGLE -->|"이미 있으면 스킵"| IMGURL

    classDef tier fill:#eef2ff,stroke:#6366f1,color:#000
    classDef gem fill:#fef3c7,stroke:#d97706,color:#000
    classDef db fill:#3ecf8e22,stroke:#3ecf8e,color:#000

    class TIER1,TIER2,TIER3,TIER4 tier
    class GEMINI1,GEMINI2,GEMINI3 gem
    class AKDB,STUDB,STYLE,IMGURL db
```

---

## 3. 주요 DB 테이블 ER (간소화)

```mermaid
erDiagram
    users ||--o{ teachers : "owns (owner_user_id)"
    users ||--o{ students : "owns"
    users ||--o{ schedules : "owns"
    users ||--o{ attendance_records : "owns"
    users ||--o{ payments : "owns"
    users ||--o{ holidays : "owns"
    users ||--o{ student_evaluations : "owns"
    users ||--o{ student_test_scores : "owns"
    users ||--o{ admissions_knowledge : "owns"
    users ||--o{ student_eval_ai_style_entries : "owns"
    users ||--o{ homework_submissions : "owns"
    users ||--o{ grading_assignments : "owns"
    users ||--o{ notifications : "owns"

    teachers ||--o{ students : "manages (teacher_id)"
    teachers ||--o{ schedules : "manages"
    teachers ||--o{ holidays : "or 'academy'"

    students ||--o{ schedules : ""
    students ||--o{ attendance_records : ""
    students ||--o{ payments : "(student_id, payment_month)"
    students ||--o{ student_evaluations : "(student_id, eval_month) UNIQUE"
    students ||--o{ student_test_scores : ""
    students ||--o{ homework_submissions : ""

    grading_assignments ||--o{ grading_results : ""
    grading_results ||--o{ grading_items : ""

    users {
        uuid id PK
        text email
        text name
        text role
        text student_eval_ai_style_note "deprecated"
    }
    students {
        bigint id PK
        uuid owner_user_id FK
        uuid teacher_id FK
        text name
        text grade
        text school
        text status "active|archived|paused|graduated"
        text parent_code
        text student_code
    }
    student_evaluations {
        bigint id PK
        uuid owner_user_id FK
        bigint student_id FK
        text eval_month
        text comment
        text image_url "학부모 포털 이미지"
        boolean parent_portal_visible
        jsonb class_memos
        jsonb class_shared_memos
    }
    admissions_knowledge {
        bigint id PK
        uuid owner_user_id FK
        text topic_key
        text grade_band
        text title
        text content
        text source "auto_scrape|manual"
        date valid_until
    }
    student_eval_ai_style_entries {
        uuid id PK
        uuid owner_user_id FK
        text content
        timestamptz created_at
    }
    schedules {
        bigint id PK
        uuid owner_user_id FK
        uuid teacher_id FK
        bigint student_id FK
        date schedule_date
        time start_time
        int duration
    }
    holidays {
        bigint id PK
        uuid owner_user_id FK
        text teacher_id "uuid or 'academy'"
        date holiday_date
        text holiday_name
        text color
    }
    homework_submissions {
        bigint id PK
        uuid owner_user_id FK
        bigint student_id FK
        date submission_date
        text status "uploaded|manual|failed|deleted"
        bigint grading_assignment_id FK
        text grading_status
    }
```

---

## 4. AI 모델 사용 매트릭스

| 호출 위치 | 모델 | 용도 | 비용 (대략) |
|---|---|---|---|
| `generate-student-eval-report` Stage 1 | gemini-2.5-flash | 입시 전문가 사전 분석 | $0.001 / 평가 |
| `generate-student-eval-report` Stage 2 | gemini-2.5-flash | 학부모용 4섹션 작성 | $0.002 / 평가 |
| `collect-admissions-knowledge` | gemini-2.5-flash | 6학년대 트렌드 요약 | $0.003 / 회 (주 1회) |
| `grading-server` 일반 검증 | gemini-2.5-flash | 채점 답안 검증 | 호출당 $0.001 |
| `grading-server` 일괄 OCR | gpt-4o | 다중 이미지 OCR (chunk) | 호출당 $0.02–0.05 |
| `grading-server` 타이브레이크 OCR | gpt-4o | 1문제 정밀 검증 | 호출당 $0.01 |

---

## 5. 인증·권한 (RLS 요약)

| 리소스 | 누구 | 제한 |
|---|---|---|
| `students` | 원장 | `owner_user_id = auth.uid()` |
| `schedules`, `attendance_records`, `payments` | 원장 | 동일 |
| `student_evaluations` SELECT | 원장 + 학부모(파라미터로 부모 코드 검증) | parent_portal_visible=true 시 학부모 조회 가능 |
| `student_evaluations.image_url` | 학부모 | 동일 (텍스트 대신 이미지 우선) |
| `student-eval-reports` Storage | public read | 누구나 URL 알면 가능 (실제 path 는 owner_uuid + 학생 ID 조합으로 추측 어려움) |
| `admissions_knowledge` | 원장만 | RLS 4개 정책 (select/insert/update/delete) |
| `student_eval_ai_style_entries` | 원장만 | RLS |

---

## 6. 외부 API 키 위치

| API 키 | 저장 위치 | 사용처 |
|---|---|---|
| `GEMINI_API_KEY` | Supabase Edge Secrets, Railway env | Edge Functions, grading-server |
| `OPENAI_API_KEY` | Railway env | grading-server (OCR) |
| `CRON_SECRET` | Supabase Edge Secrets, pg_cron job body | 자동 갱신 인증 |
| Google OAuth | Supabase Edge Secrets, Railway env | Drive 업로드 |
| NEIS API key | 클라이언트 JS 하드코딩 (공개 키) | 학사일정 |

---

## 7. 데이터 라이프사이클

```mermaid
sequenceDiagram
    autonumber
    participant 원장
    participant App as 메인 앱
    participant DB as Supabase DB
    participant Edge as Edge Functions
    participant Storage
    participant 학부모 as 학부모 포털

    %% 평가 생성
    원장->>App: 학생 모달 → AI 생성 클릭
    App->>Edge: generate-student-eval-report (mode=generate)
    Edge->>DB: 학생·메모·점수·출결·고정지침·입시정보 SELECT
    Edge->>Edge: Stage 1 → Stage 2 (Gemini × 2)
    Edge-->>App: 4섹션 텍스트
    원장->>App: 읽고 편집

    %% 저장 + 학부모 공개
    원장->>App: 학부모 공개 토글 ON
    App->>App: image_url 없으면 자동으로 이미지 생성
    App->>App: html2canvas → PNG Blob
    App->>Storage: PUT student-eval-reports/{owner}/{student}_{month}.png
    App->>DB: UPDATE student_evaluations.image_url
    App-->>원장: "학부모 포털 발송 완료"

    %% 학부모 조회
    학부모->>App: 종합평가 탭
    App->>DB: SELECT comment, image_url WHERE parent_portal_visible=true
    DB-->>App: image_url 반환
    App->>Storage: GET 이미지 (public)
    Storage-->>App: PNG
    App-->>학부모: 이미지만 표시 (텍스트 숨김)
```
