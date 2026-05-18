# Claude Code 사용설명서 (개인 프로젝트용)

> 이미지 팁 50개 + 실전 경험 정리. 1인 개발 기준.
> 클로드가 자동으로 읽는 룰(`CLAUDE.md`)과 별개 — **이 문서는 본인 참고용**입니다.
>
> 💡 **본인 질문 누적 기록**은 [CLAUDE_LEARNING_NOTES.md](CLAUDE_LEARNING_NOTES.md) 참고 (검색용).

---

## 한 줄 요약 (이것만 외워도 됨)

> **Plan 모드부터 → "왜?" 반박 → 검증 명령 실행 → 커밋(클로드가) → push(본인이)**

---

## 핵심 철학: 컨텍스트가 왕

| 원칙 | 의미 |
|---|---|
| **Fresh** (신선) | 주제 바뀌면 `/clear` |
| **Compact** (압축) | 매뉴얼은 짧게, 분할 |
| **Relevant** (관련) | 필요한 노트만 가져오기 |

> 클로드는 매번 컨텍스트만 보고 일하는 신입.
> **검수 라인(만들기 → 검수 → 고치기) 없으면 90% 실패.**

---

## 1️⃣ 일상 워크플로우

```
새 일
  └→ Plan 모드 (Shift+Tab)
       └→ 계획 받기 → "왜?" 반박
            └→ 동의되면 Plan 끝
                 └→ 코드 작성
                      └→ 검증 명령 실행 (필수)
                           └→ 클로드한테 커밋 시키기
                                └→ 본인이 직접 push
                                     └→ 끝나면 비자명한 것만 메모리 저장
```

### Step 1. 새 일 시작 → Plan 모드
- **진입 방법 2가지**:
  - 수동: `Shift+Tab` 1회 (UI 키)
  - **자동: "토의해주세요" 한마디 → Claude가 `EnterPlanMode` 자동 호출** (변형: "토의 좀", "회의해줘", "의견 들어봐")
- **바로 코드 짜지 말기.** 계획 받으면 **"이거 이렇게 하는 게 맞아?" / "왜?"** 로 반박.
- 옵션이 여러 개일 땐 **"옵션 비교 + 추천안 명시"** 형식으로 요청 (메모리에 선호도 저장됨).
- ⚠️ **2차 안전망**: 토의 첫 응답 상단에 **"Plan mode" 표시 1초 체크**. 없으면 "**plan mode 진입 안 했네, 다시**" 한마디로 강제. Claude가 가끔 룰 까먹음.

### Step 2. 검수 — 검증 명령 실행
변경한 영역에 맞춰 무조건 실행:

| 어디 고쳤나 | 검증 명령 |
|---|---|
| 메인 사이트 (HTML/JS) | `python -m http.server 8000` → 브라우저로 직접 클릭, F12 콘솔 에러 0개 |
| 채점 서버 (Python) | `python -c "from main import app"` → 필요시 `uvicorn main:app --reload` |
| Docker 전체 | `docker compose up --build` |
| Supabase 마이그레이션 | **SQL Editor에 직접 붙여넣기** (MCP `apply_migration` 절대 X) |

> 못 돌렸으면 **"못 돌렸다"고 명시**시키기. 통과한 척 금지.

### Step 3. 커밋·푸시 — 역할 분담
| 누가 | 뭘 |
|---|---|
| **클로드** | `git commit` (메시지 분류 정확함, 시간여행 안전망) |
| **본인** | `git push` (자동 push 절대 금지 — 메모리에 박혀있음) |

### Step 4. 끝나면 메모리 저장
- 비자명한 것만 골라서 `/memory` 또는 "**오늘 알아낸 거 메모리에 저장해줘**".
- TODO·일정·진행 상태는 메모리에 X (아래 §메모리 가이드 참고).

---

## 2️⃣ 단축키 (외울 거 6개)

| 키 | 동작 |
|---|---|
| `Shift+Tab` | 모드 전환 — Default / **Plan** / Auto-accept |
| `ESC` | 클로드가 엉뚱하게 가면 즉시 멈춤 |
| `ESC × 2` (입력창에 글 있음) | 입력창 비우기 |
| `ESC × 2` (입력창 비어있음) | **5분 전 시점으로 점프** (되돌리기) |
| `Ctrl + ESC` | Claude 포커스 토글 |
| `Shift + 클릭` | 파일·라인 빠른 참조 |

---

## 3️⃣ 모드 3종 (Shift+Tab으로 순환)

| 모드 | 동작 | 언제 |
|---|---|---|
| **Default** (바로 실행) | 매번 권한 묻고 실행 | 기본값 — 안전 |
| **Plan** (계획만 짜기) | 파일 수정 절대 안 함, 분석·계획만 | ✅ **새 일 시작 시 무조건** |
| **Auto-accept** (알아서) | 권한 안 묻고 자동 수락 | ⚠️ 단순 반복·익숙한 작업만 |

### Auto 모드 가이드
| 상황 | Auto OK? |
|---|---|
| 새 기능, 복잡한 리팩토링 | ❌ |
| 이름 일괄 변경, 포맷팅 | ✅ |
| 처음 만지는 코드 | ❌ |
| Git 커밋 잘 되어 있음 + 검증 명령 있음 | ✅ |

---

## 4️⃣ 슬래시 명령어

### 6개만 외워도 충분
| 명령 | 용도 |
|---|---|
| `/clear` | 대화 초기화 (주제 바뀔 때) |
| `/context` | 컨텍스트 사용률 확인 |
| `/compact` | 수동 요약 (긴 대화 압축) |
| `/model` | 모델 변경 |
| `/resume` | 이전 세션 이어하기 |
| `/help` | 도움말 |

### 부가
- `/memory` — 룰·노트 보기 (편집은 터미널 필요)
- `/mcp` — 외부 서비스 연결 상태
- `/permissions` — 권한 화이트리스트
- `/init` — 새 프로젝트에 매뉴얼 골격
- `/review` — PR/현재 브랜치 코드 검토 (Skill)
- `/security-review` — 보안 관점 검토 (Skill)

### 슬래시 명령의 정체 — 3가지 종류

`/<이름>` 한 줄이 실제로 어떻게 작동하는지 (질문 자주 나옴):

| 종류 | 예시 | 메커니즘 |
|---|---|---|
| **빌트인 CLI 명령** | `/clear`, `/help`, `/model`, `/context` | 하네스(Claude Code 자체) 기능. Claude 호출 안 함 |
| **스킬** (Anthropic 제공 / 플러그인) | `/review`, `/security-review`, `/init`, `/loop` | Skill 도구로 `.md` 파일 로드 → Claude가 지시 실행 |
| **커스텀 슬래시 명령** | 본인이 만든 `/검토`, `/grade` 등 | `~/.claude/commands/` 또는 `.claude/commands/`에 .md |

> **즉 `/review`는 스킬이에요.** 마크다운 파일에 "이 순서로 작업해라" 적힌 게 컨텍스트로 로드되면서 Claude가 그대로 실행.
> 글로벌 스킬 보려면 `ls ~/.claude/skills/`, 프로젝트 스킬은 `.claude/skills/`.

---

## 5️⃣ 모델 가이드

| 모델 | 비유 | 언제 |
|---|---|---|
| **Opus** | 시니어 | 계획·복잡 분석·아키텍처 |
| **Sonnet** | 주니어 | 단순 코드·반복 작업 |
| **opusplan** | 자동 전환 | **계획은 Opus, 코드는 Sonnet** ← 추천 |

`/model opusplan` 한 번 설정하면 토큰 절약 + 똑똑함.

---

## 6️⃣ 컨텍스트 관리

### `/context` 결과 보는 법
| 사용률 | 행동 |
|---|---|
| ~50% | 쾌적, 그대로 |
| 50~80% | `/compact` 고려 |
| 80%+ | **즉시 `/compact` 또는 `/clear` 후 `/resume`** |

### 자동 요약
시스템이 알아서 줄여줌. 하지만 주제 바뀌면 본인이 `/clear`하는 게 깔끔.

---

## 7️⃣ 메모리 vs CLAUDE.md vs 다른 도구

### 어디에 뭘 넣을지

| 종류 | 어디 | 예시 |
|---|---|---|
| **강제 룰** (반드시·절대) | `CLAUDE.md` DO/DON'T | "RLS 래핑 금지" |
| **맥락·교훈·이유** | memory (feedback 타입) | "왜냐하면 2026-05-09 회귀..." |
| **참고 위치** | memory (reference 타입) | "디버깅 엔드포인트 위치" |
| **본인 선호도** | memory (user 타입) | "1인 개발자" |
| **나중에 할 일** | TODO 주석 / Issues | `// TODO: 리팩토링` |
| **세션 내 단계** | TodoWrite (Claude 내장) | 복잡 작업 분해 |

### 좋은 메모리 vs 나쁜 메모리

| ✅ 좋음 | ❌ 안 맞음 |
|---|---|
| "RLS 래핑하면 망함" (재발 방지) | "버튼 색 빨강으로" (TODO) |
| "SQL Editor에서만 실행" (특이 규칙) | "오늘 회의 3시" (일정) |
| "Mathpix 폐기됨" (과거 결정) | "함수명 changeColor" (grep으로 찾음) |
| "비전공자 사용자" (선호도) | "Phase 5a 완료" ⚠️ 시간 지나면 거짓 |

> ⚠️ **진행 상태(Phase 1, Phase 2...) 같은 건 시간이 지나면 낡음.**
> "왜 이렇게 단계 나눴는지" 같은 의도만 남기는 게 더 낫습니다.

### 룰 업데이트 부탁하는 법

❌ 모호함:
> "반드시 해야 할 것 / 하지 말아야 할 것 추가해줘"

✅ 명확함:
> "**CLAUDE.md DO/DON'T에 ___ 추가**하고, **이유는 memory에 feedback으로** 저장해줘"

또는 단축:
> "**방금 그 실수 다시 안 그러게 룰로 박아줘**"

→ 클로드가 알아서 CLAUDE.md + memory 양쪽 업데이트.

---

## 8️⃣ 권한 운영 (이미 적용됨)

### 적용 상태
- 글로벌 `~/.claude/settings.json` — git/npm/pytest 등 안전 명령 자동 허용
- 프로젝트 `.claude/settings.local.json` — docker/uvicorn 등 본 프로젝트 한정
- **deny 등록됨**: `rm -rf`, `git push --force`, `supabase apply_migration` 등

### YOLO 모드 (`--dangerously-skip-permissions`)
- **안전한 환경(샌드박스/VM)에서만**. 일반 작업엔 비추.
- 켜더라도 `/permissions`로 위험 명령 deny 유지 필수.

---

## 9️⃣ 막혔을 때 처방전

| 증상 | 처방 |
|---|---|
| 엉뚱한 방향 | `ESC` → 멈추고 다시 지시 |
| 답변이 꼬임 | `ESC × 2` (빈 입력창) → 5분 전 점프 |
| 컨텍스트 80%+ | `/compact` |
| 어제 일 이어 | `/resume` |
| 같은 실수 반복 | "**다시 안 그러게 룰로 박아줘**" |
| MCP 연결 끊김 | `/mcp` 확인 후 재연결 |
| 권한 변경 적용 안 됨 | **세션 재시작** (새 창 띄우기) |

---

## 🔟 역할 분담 — 4가지 패턴 (회사처럼 일 나누기)

> "전문 엔지니어 → 검토자" 같은 분담을 어떻게 구성하는지.
> **채팅창 1개 = 터미널 1개 = Claude 세션 1개**라는 점부터 기억.

### 4가지 패턴 비교

| 방식 | 구조 | 언제 | 단점 |
|---|---|---|---|
| **① 한 채팅 + Subagent 자동 위임** | 메인 Claude가 내부적으로 Agent 도구로 전문 에이전트 호출 | 작업→검토 단순 파이프라인 | Claude가 알아서 부르므로 사람 통제 어려움 |
| **② 한 채팅 + 슬래시 명령** ⭐ | 작업 끝나고 `/review`·`/security-review` 명시 실행 | **1인 개발자 작업→검토** | 동시 진행 불가 |
| **③ 채팅 여러개 (worktree)** | `git worktree`로 폴더 복제 → 각각 별도 VSCode/터미널 | A기능·B기능 **병렬** 진행 | context switch 비용, merge 복잡 |
| **④ /ultrareview (클라우드)** | 브랜치/PR을 클라우드에 보내 멀티 에이전트 병렬 검토 | PR 직전 종합 검토 | 유료, 1회성 |

### 추천 흐름 (1인 개발 기준)

**기본은 ②번** — 한 채팅에서 작업 끝나면 `/review` 또는 `/security-review` 한 줄. 검토 리포트가 Subagent에서 생성되므로 메인 컨텍스트 안 더럽혀짐.

**병렬 필요할 때만 ③번** — 예: "채점 서버 리팩 + 학부모포털 버그" 같은 진짜 독립 작업.

```powershell
# worktree 만들기
git worktree add ../academy_manager-grading grading-branch
# 새 VSCode 창에서 ../academy_manager-grading 열고 Claude 켜기
```

**PR 직전 ④번** — `/ultrareview`로 종합 점검 한 번.

### 코치·작업 분리 (③번의 가벼운 버전)

| 창 | 역할 | 사용법 |
|---|---|---|
| 창 1 | **코치·자문** | "이거 어떻게 해?", "이 명령어 뭐야?" 질문만 |
| 창 2 | **실제 작업** | Plan → 코드 → 검증 → 커밋 |
| 창 3 (선택) | **다른 프로젝트** | 컨텍스트 분리 |

**팁**: 코치 창은 코드 수정 시키지 말고 질문만. 작업 창에서 막히면 코치 창에서 풀고 작업 창에서 실행.

---

## 🔟-2 Subagent 16개 운영 매뉴얼 (회사식 역할 분담)

> 회사처럼 "전문 개발자 → 검토자 → 도메인 전문가 → 사용자 후기 → 총괄" 역할 분담을 1인 개발 환경에서 구현한 구조.
> 2026-05-18 구축 완료. 16개 페르소나가 .claude/agents/ 마크다운으로 정의돼 있음.

### 16개 역할 한눈에

**개발자 (2)** — 작업창 메인 역할
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 1 | **academy-developer** | 매니저 전문 개발자 | `academy_manager/.claude/agents/` |
| 2 | **haeseol-developer** | 해설제작기 전문 개발자 | `시험지 해설 제작/highroad-math-solution/.claude/agents/` |

**검토자 (4)** — 코드·운영 위험 점검
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 3 | **academy-reviewer** | 매니저 코드 검토자 | `academy_manager/.claude/agents/` |
| 4 | **haeseol-reviewer** | 해설제작기 코드 검토자 | `시험지 해설 제작/.../.claude/agents/` |
| 5 | **security-reviewer** | 보안 검토자 (RLS/시크릿) | 글로벌 |
| 6 | **cost-monitor** | 비용 감시자 (LLM/OCR) | 글로벌 |

**디자인 (2)** — 화면 vs 종이 명확히 구분
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 7 | **ui-ux-designer** | 웹/앱 화면 UI/UX | 글로벌 |
| 8 | **textbook-designer** | **종이/PDF** 교재·시험지·해설지 | 글로벌 |

**교육 콘텐츠 전문 (4)** — 수학·학원 콘텐츠 품질
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 9 | **education-expert** | 학원 운영자 시점 종합 | 글로벌 |
| 10 | **curriculum-designer** | 교육과정·진도·단원 위계 | 글로벌 |
| 11 | **problem-author** | 수학 문제 출제 품질 | 글로벌 |
| 12 | **solution-writer** | 수학 해설 작성 품질 (해설제작기 핵심) | 글로벌 |

**사용자 후기 (2)** ⭐신규 — 실사용자 페르소나로 후기 작성
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 13 | **school-math-teacher** | 학교 수학 선생님 시점 후기 (학생 추천 가/부) | 글로벌 |
| 14 | **student-tester** | 학생 시점 후기 (학년별, 솔직한 학생 말투) | 글로벌 |

**기획·총괄 (2)**
| # | 이름 | 역할 | 위치 |
|---|---|---|---|
| 15 | **product-manager** | 제품 기획자 (필요성·MVP 축소) | 글로벌 |
| 16 | **chief-reviewer** | 여러 검토자 종합·배포 가/부 판정 | 글로벌 |

> 글로벌 12개는 두 프로젝트 양쪽에서 호출 가능. 프로젝트별 4개는 해당 프로젝트에서만.

#### 작업창별 호출 가능 개수 (헷갈리기 쉬움)

| 작업창 위치 | 호출 가능 | 안 보이는 페르소나 |
|---|---|---|
| 매니저 작업창 (`academy_manager/`) | **14개** (글로벌 12 + 매니저 2: `academy-developer`/`academy-reviewer`) | `haeseol-developer`/`haeseol-reviewer` (해설 작업창에서만) |
| 해설 작업창 (`시험지 해설 제작/highroad-math-solution/`) | **14개** (글로벌 12 + 해설 2: `haeseol-developer`/`haeseol-reviewer`) | `academy-developer`/`academy-reviewer` (매니저 작업창에서만) |
| 양쪽 합산 (중복 제거) | **16개** = 글로벌 12 + 매니저 2 + 해설 2 | — |

> ⚠️ **헷갈리지 말 것**: "16개 페르소나"는 전체 시스템 합산 기준. 한 작업창에서는 항상 14개만 호출 가능. 해설 관련 토의는 **해설 작업창**에서, 매니저 관련 토의는 **매니저 작업창**에서 해야 진짜 도메인 전문가가 호출됨. 잘못된 작업창에서 토의하면 다른 창의 전문가 대신 가장 가까운 대안(예: `academy-reviewer`)으로 매핑되는데 정확도 떨어짐.

### 교육·후기 도메인 7인 역할 분담

비전공자 입장에서 가장 헷갈리기 쉬운 부분. 7명이 어떻게 다른지:

**1) 콘텐츠 품질 검토자 4인** (교육 전문가 시점)
| 페르소나 | 한 줄 정체성 | 예시 질문 |
|---|---|---|
| **education-expert** | 학원 운영자 입장 종합 검토자 | "이 알림이 학부모 신뢰에 영향 줄까?" |
| **curriculum-designer** | 교육과정·진도 설계자 | "고1 수학 한 학기 진도로 이게 적정한가?" |
| **problem-author** | 문제 출제자 | "이 시험지 변별력 어때? 난이도 분포는?" |
| **solution-writer** | 해설 작성자 (수학적 풀이) | "이 풀이 단계 누락 없어? 학생이 이해할 수 있어?" |

**2) 사용자 후기 페르소나 2인** (실사용자 입장 — 후기 형식 산출물)
| 페르소나 | 한 줄 정체성 | 후기 톤 |
|---|---|---|
| **school-math-teacher** | 한국 고교 수학 교사 10년차 | 동료 교사·후배에게 "이 자료 학생한테 권할 만해?" 답하는 톤. 별점 + 권장/조건부/비권장 |
| **student-tester** | 중2/고1/고2/고3 학생 (학년 골라서) | 솔직한 학생 말투. 짜증나는 부분 명시. "친구한테 추천할 거 같다/아닌 거 같다" |

**3) 디자인 1인** (참고)
- **textbook-designer**: 종이/PDF 인쇄물 디자인. "이 해설지 인쇄하면 여백이랑 수식 잘 나와?"

### 검토자 vs 후기 페르소나 차이

| | 검토자 (education/curriculum/problem/solution) | 후기 페르소나 (teacher/student) |
|---|---|---|
| 산출물 | Critical/Major/Minor 리포트 | 별점 + 자연스러운 후기 본문 |
| 톤 | 분석적·전문가 | 실사용자 일상 말투 |
| 용도 | 코드·로직 개선 | 학원장이 "진짜 학생/학교가 이걸 어떻게 받아들일까" 감 잡기 |
| 표본 권장 | 1~3건도 OK | 같은 자료에 여러 페르소나 호출 (학년별/교사) |

**호출 순서 권장 (해설제작기 출력 검증 예)**:
```
1. solution-writer로 풀이 품질 분석 → Critical 0개?
2. textbook-designer로 PDF 레이아웃 점검 → 인쇄 적합?
3. school-math-teacher로 후기 → 학생에 권할 만한가?
4. student-tester (고2)로 후기 → 학생 입장 실제 느낌?
5. education-expert로 운영 입장 종합
```

### 채팅창 구조 — 3개 켜기

| 창 | 역할 | 폴더 | 주로 호출하는 subagent |
|---|---|---|---|
| **창 1** | 매니저 작업창 | `c:\Users\mirun\Desktop\academy_manager` | academy-developer 중심 |
| **창 2** | 해설제작기 작업창 | `c:\Users\mirun\Desktop\시험지 해설 제작\highroad-math-solution` | haeseol-developer 중심 |
| **창 3** | 리뷰·자문창 | 매니저 폴더에서 켜는 게 무난 | chief-reviewer / security / cost / product-manager |

**창 켜는 방법** (VSCode 기준):
1. VSCode에서 해당 폴더 열기 (`Ctrl+K, Ctrl+O`)
2. Claude Code 패널 열기 (또는 새 채팅 시작)
3. 한 워크스페이스에 여러 채팅 인스턴스 가능

### 호출 방법 3가지

#### ① 자연어 (가장 쉬움) ⭐
```
"이 출석 화면을 UI/UX 디자이너 관점에서 검토해줘"
"이 변경이 비용에 영향 있을까? cost-monitor 시켜봐"
"product-manager한테 이 기능 진짜 필요한지 물어봐"
```
→ 메인 Claude가 적합한 subagent 자동 호출. **이름 정확히 안 외워도 됨.**

#### ② 명시 호출
```
"academy-reviewer subagent로 방금 변경 검토해줘"
"security-reviewer 호출해서 RLS 점검"
```
→ 정확히 누구한테 시킬지 분명할 때.

#### ③ 슬래시 명령 + 묶음
자주 쓰는 조합은 `.claude/commands/` 또는 글로벌에 만들기.
- 예: `/배포전검토` = academy-reviewer → security-reviewer → cost-monitor → chief-reviewer 순차 호출

---

### 시나리오 1 — 매니저 신기능 ("출석 화면 추가")

**창 1 (매니저 작업창)** 에서 진행:

```
1. [Shift+Tab] Plan 모드 진입
   입력: "출석 화면에 학생별 결석 사유 입력 기능 추가하고 싶어"
   → 메인 Claude(academy-developer 역할)가 계획 작성

2. 계획 받은 후
   입력: "이 기능 진짜 필요한가? product-manager 관점도 듣자"
   → product-manager subagent 호출, "만들자/미루자/만들지 말자" 판단

3. (만들기로 결정) Plan 승인 후 코드 작성

4. 변경 후
   입력: "UI/UX 관점으로 와이어프레임 봐줘"
   → ui-ux-designer 호출

5. 학부모에게 결석 사유가 어떻게 보일지 우려되면
   입력: "교육 전문가 관점에서 학부모/학생 영향 봐줘"
   → education-expert 호출

6. 검증 명령 실행 후
   입력: "academy-reviewer로 변경 전체 검토"
   → academy-reviewer 호출, Critical/Major/Minor 리포트

7. 커밋 → 본인이 직접 push
```

### 시나리오 2 — 해설제작기 비용 우려 변경

**창 2 (해설제작기 작업창)** 에서 진행:

```
1. [Shift+Tab] Plan 모드
   입력: "OCR 실패율 높을 때 더 비싼 모델로 자동 진급하는 fallback 추가"

2. 계획 받자마자
   입력: "cost-monitor한테 이 변경 비용 영향 평가받자"
   → cost-monitor 호출
   → "이건 룰 위반(싼→비싼 자동 진급 금지). Critical." 응답 가능성 큼

3. (cost-monitor가 막으면) 계획 수정
   입력: "그럼 같은 모델 + 백오프 재시도로 바꿔서 다시 계획"
   → haeseol-developer가 재계획

4. 구현 후
   입력: "haeseol-reviewer로 점검"
   → 안전가드 3종 + 비용 추정 확인

5. 검증: 🖥️ 로컬 vs ☁️ 라이브 마커 명시 받기
6. 커밋 → 본인이 직접 push
```

### 시나리오 3 — 양 프로젝트 PR 종합 검토 (리뷰창)

**창 3 (리뷰창)** 에서 진행. 작업창들은 그대로 두고 검토만:

```
1. 입력: "academy_manager에 오늘 만든 PR #42, chief-reviewer로 종합 검토 시작"
   → chief-reviewer가 어떤 subagent 호출할지 결정:
      - 매니저 코드 변경 → academy-reviewer
      - 인증 부분 있음 → security-reviewer
      - UI 변경 있음 → ui-ux-designer

2. chief-reviewer가 각 호출 후 종합:
   - Critical 항목 / Major / 미검토 영역
   - 배포 가능 / 조건부 / 배포 금지 판정
   - 다음 액션 1~3개

3. 결과 보고 작업창으로 돌아가 fix
```

### 호출 시점 빠른 표 (16개 매핑)

| 상황 | 호출할 subagent |
|---|---|
| 새 기능 제안 직후 (가치 의심) | **product-manager** |
| 코드 작성 자체 | academy/haeseol-developer (메인 창에서 자동) |
| 변경 직후 코드 검토 | academy-reviewer / haeseol-reviewer |
| 웹·앱 **화면** 변경 | **ui-ux-designer** |
| **종이/PDF 인쇄물** 변경 (시험지·해설지·교재) | **textbook-designer** |
| 진도·단원·교과과정 영향 | **curriculum-designer** |
| 시험지 자동 생성·문제 출제·난이도 분포 | **problem-author** |
| LLM 해설 풀이 품질·단계 누락 점검 | **solution-writer** |
| 운영 흐름·학부모 알림·강사 부담 | **education-expert** |
| **학생/학부모에 배포 전 외부 시점 후기** | **school-math-teacher** / **student-tester** |
| 인증·RLS·시크릿·CORS·XSS | **security-reviewer** |
| LLM/OCR/자동화/폴링/fallback 변경 | **cost-monitor** |
| PR 직전 / 배포 직전 종합 | **chief-reviewer** (다 묶어서) |

### 시나리오 4 — 해설 PDF 배포 전 종합 검증 (콘텐츠 4인 + 후기 2인)

해설제작기에서 PDF 한 묶음 생성한 후 학생에게 배포하기 전:

**창 2 (해설제작기 작업창)** 또는 **창 3 (리뷰창)** 에서:

```
1. 표본 선정
   입력: "방금 만든 [고2 미적분I 1단원 해설 PDF] 표본 10개 검증"

2. 풀이 품질 (전문가 분석)
   입력: "solution-writer로 단계 누락·계산 오류 분석"
   → Critical 0개 확인

3. 인쇄 디자인
   입력: "textbook-designer로 PDF 레이아웃·인쇄 적합성 점검"

4. 교사 시점 후기 (외부 페르소나)
   입력: "school-math-teacher 후기 받자. 우리 학생들한테 보조 자료로 권할 만한가?"
   → 별점 + 권장/조건부/비권장 결론

5. 학생 시점 후기
   입력: "student-tester로 고2 학생 후기 받아줘. 솔직하게"
   → 짜증나는 부분·헷갈리는 부분 명시된 후기

6. 종합 판단
   입력: "education-expert로 학원 운영 시점 종합"
   → "배포해도 됨" / "수정 후 재검토" 판단

7. Critical 0개 + 후기 평가 ★★★☆☆ 이상이면 배포
```

### 자주 하는 실수

❌ 작업창에서 직접 코드 안 짜고 매번 subagent로 위임 → **작업창 메인 Claude가 academy-developer 페르소나 역할.** Subagent는 검토·자문·분석용.

❌ 모든 변경에 chief-reviewer 호출 → 비용 낭비. **Critical 위험 있는 변경(인증/비용/마이그레이션)만 종합 검토.**

❌ subagent 이름 정확히 외우려 함 → 자연어로 "디자이너 관점", "보안 관점"이라고만 해도 알아서 매칭됨.

❌ 검토 리포트만 받고 다음 단계로 진행 → **Critical 0개 확인하고 진행.** 사용자가 의식적으로 Major 수용 결정.

### 페르소나 수정·추가하려면

각 마크다운 파일 직접 편집:
- `~/.claude/agents/<이름>.md` (글로벌 6개)
- `c:\Users\mirun\Desktop\academy_manager\.claude\agents\<이름>.md` (매니저 2개)
- `c:\Users\mirun\Desktop\시험지 해설 제작\highroad-math-solution\.claude\agents\<이름>.md` (해설 2개)

수정 후 **새 채팅 세션부터** 적용. 현재 창은 그대로 두고 새 창에서 작업.

추가 역할 필요해지면(예: 배포 전문가, 테스트 전문가): "역할 ___ 추가해줘 — ___ 같은 시점에 호출되게" 한 줄로 요청.

---

## 🔟-3 토의록 시스템 (자율 협업 회의록 누적)

> 16개 페르소나가 실제 회사 직원처럼 협업. **의뢰인(사용자) = 한 줄 요청 + 최종 결정만.**
> 모든 발언 시간순으로 `docs/DISCUSSIONS.md` 에 누적.

### 역할 분담

| 역할 | 누가 | 할 일 |
|---|---|---|
| **의뢰인** | 사용자 (당신) | "이거 만들어주세요" 한 줄 + 최종 승인/거부 |
| **회의 진행자** | 메인 Claude | 페르소나 식별·호출·발언 정리·DISCUSSIONS.md 기록 |
| **참여자** | 관련 subagent들 | 라운드 1~3 의견 교환·반박·종합 |
| **종합 발표자** | chief-reviewer | 마지막 종합 + 의뢰인에게 결정 요청 |

### Claude가 **자동으로** 토의 시작하는 경우 (의뢰인 명령 없어도)

다음 신호 감지하면 메인 Claude가 자체 판단으로 토의 시작:

| 작업 신호 | 자동 호출되는 페르소나 (예시) |
|---|---|
| 새 기능 추가 / Plan 모드에서 식별 | product-manager, ui-ux-designer, 도메인 페르소나 |
| DB 스키마 변경 / 마이그레이션 작성 | academy-reviewer, security-reviewer |
| 인증·RLS 정책 변경 | security-reviewer, academy-reviewer |
| LLM/OCR 호출 추가 또는 fallback | cost-monitor, solution-writer, haeseol-reviewer |
| 외부 API 신규 호출 | security-reviewer, cost-monitor |
| 자동화 toggle / 스케줄 변경 | cost-monitor, product-manager |
| 영향 파일 3개 이상 변경 | 도메인 검토자 + chief-reviewer |
| 해설 PDF·시험지 출력 형식 변경 | solution-writer, textbook-designer, school-math-teacher, student-tester |

→ 이런 작업 신호 보이면 Claude가 **"이건 [이유]로 토의 필요. 페르소나 [...] 호출해서 시작합니다"** 한 줄 안내 후 자동 진행.

### 의뢰인이 명시 호출하는 경우

자동 트리거 안 걸려도 의뢰인이 의심나면:
> "토의해주세요" / "토의해서 진행해주세요"
> "이거 [페르소나 A]랑 [페르소나 B] 의견 받아서 토의록 시작"

→ Claude가 **즉시 Plan mode 자동 진입** (EnterPlanMode 도구 호출) + 토의 시작. 사용자는 Shift+Tab 누를 필요 X.

⚠️ **2차 안전망**: 첫 응답에서 mode 표시 "Plan mode" 보이는지 1초 체크. 안 보이면 "plan mode 진입 안 했네, 다시" 한마디로 강제. (Claude가 룰 까먹는 회귀 대비)

### 토의 면제 (단순 작업)

다음은 토의 없이 바로 작업:
- 타이포 fix
- 문서 수정
- 단일 변수 이름 변경
- 1줄짜리 명백한 버그 fix
- import 정리 같은 자명한 클린업

→ academy-developer / haeseol-developer가 바로 처리.

### 자동 토의 흐름 (Claude 내부 동작 — Plan 모드 자동 진입 포함)

```
[의뢰인 한 줄 요청]
    ↓
[Claude 자체 판단] "이건 토의 필요" / "토의 면제"
    ↓ (토의 필요 시)
[Claude가 EnterPlanMode 호출]
    ↓ (의뢰인 한 번 승인 클릭 — 안전장치)
[Plan 모드 진입]
    ↓
[페르소나 자동 식별] 어떤 도메인 영향? → 호출 대상 결정
    ↓
[라운드 1] 각자 독립 의견 (시간순 기록)
    ↓
[라운드 2] 다른 의견 보고 보충·반박 (시간순 기록)
    ↓
[라운드 3] chief-reviewer 종합 → Plan 작성
    ↓
[DISCUSSIONS.md 상단에 전체 발언 누적]
    ↓
[Claude가 ExitPlanMode 호출] → 의뢰인 Plan 승인/거부/수정
    ↓ (Plan 승인 시)
[academy-developer/haeseol-developer가 구현 시작]
```

**핵심**: 사용자가 Shift+Tab으로 Plan 모드 켜는 거 잊어도 OK — Claude가 자동 호출. 한 번 승인 클릭만 필요 (안전장치).

### 현업식 작업 라이프사이클 (Plan 승인 후)

Plan 승인 → 작업 시작 → 종결까지 단계화 (실제 회사 개발 워크플로우 모방):

```
[Plan 승인]
    ↓
[1. 구현] — academy-developer / haeseol-developer
    ↓
[2. 검증 명령 실행] — §3 검증 절차, 결과 OK/불가/불확실 명시
    ↓
[3. 검토 (선택)] — Critical 위험 영역만 자동 호출
   ├─ 보안 영향 → security-reviewer
   ├─ 비용 영향 → cost-monitor
   └─ 광범위 변경 → chief-reviewer 종합
    ↓
[4. 커밋 (Claude) → push (사용자가 직접)]
    ↓
[5. 배포 후 모니터링] — git log 확인 + 라이브 로그
   ├─ Vercel deploy log
   ├─ Railway log (해설제작기)
   ├─ Supabase advisor / log
   └─ 회귀 발견 시 즉시 토의 재개 또는 롤백
    ↓
[6. 학습 노트 추가] — 페르소나 마크다운 `## 학습 노트`에 새 룰
    ↓
[7. 토의록 후속 변경 채우기] — DISCUSSIONS.md 해당 토의 [종결] 처리
    ↓
[작업 종료]
```

### Git 히스토리 참고 (모든 페르소나 책무)

페르소나가 작업·토의 시 다음을 자체 조회:
- `git log --oneline -20` — 최근 변경 흐름
- `git log -p <file>` — 특정 파일 히스토리
- `git blame <file>` — 누가/왜 그 줄을 추가했나
- `git diff HEAD~N` — N 커밋 이전과 비교

**특히 검토자 페르소나**는 최근 30일 commit 패턴 점검 후 의견 작성:
- 회귀 사고 이력(2026-05-09 RLS / 비용 spike) 재현 가능성 점검
- 같은 영역 최근 변경 충돌 확인
- 미완료 작업 흔적 확인 (TODO 주석, // FIXME 등)

### 마무리까지 체크 — 작업 종결 조건

**다음 모두 완료되어야 "작업 종료"**:
- [ ] 검증 명령 실행 결과 명시 (못 돌렸으면 "못 돌렸다" 명시)
- [ ] 커밋 메시지 한국어 + Conventional Commits
- [ ] 사용자가 직접 push (Claude 자동 push 금지)
- [ ] 배포 후 최소 5분 모니터링 (로그 / advisor)
- [ ] 새 룰 발견 시 해당 페르소나 학습 노트에 추가
- [ ] DISCUSSIONS.md 후속 변경 섹션 채우고 [종결] 상태로 변경
- [ ] 회귀 발견 시 즉시 토의 재개 또는 롤백

### 페르소나 자율성 (꼭 알아둘 룰)

각 페르소나는 토의 시 **다른 페르소나 의견을 무조건 수용하지 않습니다**:

| 페르소나 결론 형식 | 의미 |
|---|---|
| **할만하다** (개발자) / **승인** (검토자) / **권한다** (후기) | 본인 도메인 관점에서 OK |
| **조건부** | 특정 수정/안전장치 추가 시 OK |
| **불가** / **거부** / **권하지 않는다** | 본인 도메인에서 안 됨 — **반드시 대안 제시** |

특히:
- **Critical 위반** (RLS 래핑, MCP apply_migration, LLM 싼→비싼 자동 진급 등)은 어떤 페르소나가 찬성해도 **academy-reviewer / haeseol-reviewer가 거부 유지**.
- **학생 페르소나(student-tester)** 는 어른 전문가가 "이 정도면 학생도 이해할 거" 해도 학생 입장에서 솔직히 반박 OK.
- **chief-reviewer** 의견 충돌 시 우선순위(보안 > 비용 > UX > 효율)로 명시 해결.

### 의뢰인 입장 행동 (당신이 할 일)

| 시점 | 할 일 |
|---|---|
| **평소** | "이거 만들어주세요"만 입력 |
| **자동 토의 시작 알림** | 관전 (or 도중 개입 "잠깐, 의뢰인 의견 — [...]") |
| **종합안 받음** | 승인 / 추가 의견 요청 / 폐기 결정 |
| **종결 후** | 작업 결과 commit · push 검토 |

### 토의록 위치

| 프로젝트 | 파일 |
|---|---|
| academy_manager | `docs/DISCUSSIONS.md` |
| 시험지 해설 제작 | `시험지 해설 제작/highroad-math-solution/docs/DISCUSSIONS.md` |

각 프로젝트 별도 누적. 오래된 종결 토의는 분기별 archive 분리 (`docs/discussions-archive/2026-Q2.md` 등).

### 시나리오 5 — 자동 토의 진행 예시

의뢰인이 매니저 창에서 한 줄만 입력:

```
의뢰인: "출석 화면에 결석 사유 입력 추가해주세요"
```

Claude 자동 진행:
```
Claude: "새 기능 추가 신호 감지. 토의 시작합니다.
        참여: product-manager / ui-ux-designer / education-expert / academy-developer.
        DISCUSSIONS.md에 시간순 기록합니다."

[라운드 1 자동 진행 — 4개 subagent 순차 호출, 각자 의견 받기]
[라운드 2 자동 진행 — 의견 교차, 보충·반박]
[라운드 3 자동 진행 — chief-reviewer 종합]

Claude: "토의 종결안 나왔습니다. DISCUSSIONS.md 상단에 누적했습니다.
        종합 결론: 만들자. 조건 — 결석 선택 시에만 사유 필드 노출, 옵션+자유 입력 병행.
        의뢰인 결정 부탁드립니다: 승인 / 추가 의견 / 폐기?"
```

의뢰인 답변:
```
의뢰인: "승인. 진행"
```

Claude:
```
Claude: "academy-developer가 구현 시작합니다.
        Plan 모드에서 마이그레이션 + UI 변경 + 검증 명령 순서로 진행."
```

---

## 🔟-4 자동 학습 시스템 + 페르소나 고도화

> 페르소나가 작업/토의 중 발견한 룰을 자동 누적해 점점 똑똑해지는 시스템.

### 학습 노트 위치
각 페르소나 마크다운 끝에 `## 학습 노트 (자동 누적)` 섹션:
- 글로벌 12개: `~/.claude/agents/<name>.md`
- 매니저 2개: `c:\Users\mirun\Desktop\academy_manager\.claude\agents\<name>.md`
- 해설 2개: `c:\Users\mirun\Desktop\시험지 해설 제작\highroad-math-solution\.claude\agents\<name>.md`

### 학습 노트 추가 트리거
1. **자동** — 작업/토의 중 새 룰 발견 시 Claude가 자체 판단으로 추가
2. **의뢰인 명령** — `"이 룰을 [페르소나]에 학습시켜줘"`
3. **토의 종결 시** — chief-reviewer 종합에 룰 포함되면 관련 페르소나에 자동 누적

### 학습 노트 형식
```markdown
### 2026-MM-DD — <한 줄 룰>
**근거**: 토의록 링크 또는 사건 출처 (예: DISCUSSIONS.md 2026-05-18 14:00 항목)
**적용 범위**: 언제/어디에 적용
```

### 학습 노트 효과
- 같은 페르소나 다음 호출 시 학습된 룰 자동 적용
- 회귀 사고 방지 (같은 실수 두 번 안 함)
- 도메인별 노하우 축적 (코드 외부에 명시적으로)

---

### 페르소나 고도화 검토 (옵션 보고)

페르소나 시스템을 점진적으로 개선할 수 있는 옵션들. **즉시 결정 필요 X — 한 달 사용 후 검토 권장**.

#### 옵션 A — 학습 노트 누적만 (기본, 즉시 시작) ⭐
- 현재 시스템 그대로
- 사용할수록 각 페르소나 마크다운에 룰 누적
- 별도 작업 불필요

#### 옵션 B — 분기별 페르소나 리뷰 (3개월 단위)
- 안 쓰이는 페르소나 식별 → 정리
- 자주 쓰이는 호출 조합 → skill로 묶음 (`/배포전검토` 등)
- 권장 시점: **2026-08-18 1차 리뷰**

#### 옵션 C — 페르소나 도구 권한 확장
- 현재: 검토자는 Read/Glob/Grep만, 일부 Bash
- 확장 후보 예시:
  - cost-monitor에 WebFetch 추가 (Railway/Google Cloud API 비용 조회)
  - chief-reviewer에 Bash 추가 (git log 자체 호출)
- 권장: 필요 발생 시점에만

#### 옵션 D — Description 정밀화 (호출 정확도 ↑)
- 실사용하면서 "잘못 호출되는 페르소나" 식별
- description 키워드 조정
- 권장: **2026-06-18** (한 달 사용 데이터 기반)

#### 옵션 E — 새 페르소나 추가
- 사용 중 빠진 도메인 발견되면 추가
- 후보:
  - **deployment-expert** (Vercel+Railway+Docker 배포)
  - **db-migration-specialist** (Supabase 마이그레이션 전담, RLS 정책)
  - **test-engineer** (검증 자동화)
  - **parent-comm-expert** (학부모 커뮤니케이션)
- 권장: 실사용 후 명확해지면

### 추천 진행 (1인 운영 기준)
| 시점 | 액션 |
|---|---|
| **지금 (2026-05-18)** | 옵션 A 자동 적용 (학습 노트 누적) |
| **2026-06-18** | 옵션 D 1차 (description 정밀화) |
| **2026-08-18** | 옵션 B 분기 리뷰 + 필요 시 C, E |
| **수시** | 학습 노트 보면서 페르소나 정체성 보정 |

> 비전공자 1인 운영 기준 — **고도화는 미루는 게 안전**. 지금은 옵션 A로 시작, 한 달 사용해보고 필요할 때 1개씩 추가.

---

### 외부 도구·스택 대안 검토 (페르소나 책무)

페르소나들은 **현재 스택에 안주하지 않고 더 나은 대안을 과감히 제시**할 책임:

#### 현재 스택
| 영역 | 현재 도구 | 단점 / 한계 |
|---|---|---|
| DB·Auth | Supabase | RLS 학습 곡선, advisor 경고, 일부 기능 부족 |
| 프론트 호스팅 | Vercel | 정적 사이트는 충분, 함수 호출량 늘면 비용 |
| 백엔드 호스팅 | Railway (해설) / Docker (매니저) | Railway egress 95% 이슈 이력 |
| OCR·LLM | Google Gemini (Vision + 풀이) | output 단가 차이, fallback 진급 위험 |
| 저장소 | Google Drive | 검색·동시성 약함, search-then-update 회피 패턴 |

#### 대안 검토 시 페르소나 책무
- **product-manager**: 새 도구가 학원 운영 가치를 더 주는가, 1인 부담 늘리는가
- **cost-monitor**: 단가·청구 모델 비교, 일일 최악 시나리오 추정
- **security-reviewer**: 보안 모델 차이 (관리형 vs 자체), 시크릿 관리 차이
- **academy-developer / haeseol-developer**: 마이그레이션 공수, 코드 변경 범위
- **chief-reviewer**: 종합 판단 — "지금 / 6개월 후 / 안 함"

#### 대안 검토 형식 (페르소나 발언 표준)
```
현재 [도구 A]
↓
대안 [도구 B]
- B가 나은 점: 1~3줄
- 마이그레이션 비용 (인시): N시간
- 1인 운영 부담 변화: ↑ / ↓ / 비슷
- 권장 시점: 지금 / 6개월 후 / 안 함
- 근거 1줄
```

#### 자주 거론되는 대안 (참고)
- **AWS (S3 + Lambda + RDS)**: 자유도 ↑, 학습 곡선 ↑, 1인 부담 ↑↑
- **Cloudflare (Workers + R2 + D1)**: edge 친화적, 저비용, 한국 RTT 변수
- **OpenAI GPT** / **Claude API**: Gemini 대안, 출력 안정성 비교 필요
- **Anthropic Files API**: PDF 처리 단순화 가능 (해설제작기 후보)
- **AWS Textract / Azure Document Intelligence**: OCR 대안
- **Notion API / Airtable**: Drive 대신 구조화 저장
- **Supabase 자체호스팅** vs **PostgreSQL 직접 (Neon, Render)**: 락인 해소

#### 사용자(의뢰인) 입장 기본 자세
- 비전공자 1인 운영 → 새 도구 학습 비용은 항상 큼
- "지금 바로 마이그레이션"은 드물게만 채택
- 다만 명확한 비용·보안·기능 이득이 보이면 **검토를 미루지 말 것**
- 대안 토의 자체는 자유롭게 — 결정만 신중하게

---

## 1️⃣1️⃣ 본 프로젝트 안전 룰 (memory 반영)

memory에 박혀있어 자동 적용되지만 본인도 의식해두면 좋음:

| 룰 | 이유 |
|---|---|
| `git push`는 **본인이 직접** | 자동 push 사고 방지 |
| 옵션 비교 시 **추천안 명시 요청** | 결정 부담 최소화 |
| RLS `auth.uid()` 래핑 X | 2026-05-09 회귀 |
| MCP `apply_migration` X | SQL Editor 직접 |
| OCR 신규는 Gemini Vision만 | Mathpix 폐기 |
| LLM 프롬프트에 expected_hint X | 17~20 누락 회귀 |
| 자동 작업 도입 시 **안전가드 3종** | 비활성 toggle + 리소스 한도 + 실패 모니터링 |

---

## 1️⃣2️⃣ Stage 2: 4가지 핵심 부품 (1단계 익숙해진 후)

| 부품 | 역할 | 본 프로젝트 예시 |
|---|---|---|
| **Skills** | 반복 작업 묶음 | "교재 파싱 결과 검증" 같은 워크플로우 |
| **Slash Commands** | 스킬 단축어 | `/grade`, `/migration` |
| **MCP** | 외부 서비스 연결선 | Supabase MCP (read-only로 운영 중) |
| **Subagents** | 분신 — 독립 컨텍스트로 일하는 보조 클로드 | `migration-reviewer`, `frontend-tester` |
| **Hooks** | 이벤트 자동 발동 | "Edit 후 자동 lint", "커밋 직전 자동 pytest" |

### 추천 도입 순서
1. 메모리·매뉴얼만으로 **1-2주 작업** → 어떤 반복이 짜증나는지 파악
2. 가장 짜증나는 거 **1개를 Subagent**로 (예: 마이그레이션 검수 전담)
3. 안정화 후 **Hook**으로 완전 자동화

---

## 1️⃣3️⃣ 트리거 단어 (한마디로 정해진 동작)

CLAUDE.md에 박혀있어 자동 작동:

| 트리거 | 동작 |
|---|---|
| "**검증해줘**" | §검증 절차 전체 실행 |
| "**마이그레이션 만들어줘**" | 트랜잭션 + 검증 SELECT 템플릿 |
| "**해설 제작**" / "**채점**" | grading-server 모듈 우선 |
| "**숙제 제출 흐름**" | homework/ + Edge Function |
| "**룰로 박아줘**" | CLAUDE.md DO/DON'T + memory 양쪽 업데이트 |

---

## 1️⃣4️⃣ 체크리스트 (모니터에 붙여두기)

```
□ 새 일 → Shift+Tab으로 Plan 모드부터
□ 계획 받고 "왜?", "이게 맞아?"로 반박
□ 옵션 받을 땐 추천안 명시 요청
□ 코드 후 검증 명령 무조건 실행
□ 작업 단위로 Claude한테 커밋 시키기
□ git push는 본인이 직접
□ 막히면 ESC, ESC×2 활용
□ 컨텍스트 80% 넘으면 /compact
□ 실수 반복하면 "룰로 박아줘"
□ 일 끝나면 비자명한 것만 메모리 저장
□ 권한·룰 변경 후엔 새 창 띄우기
```

---

## 1️⃣5️⃣ 자주 묻는 것

**Q. 사용설명서는 매번 열어둬야 하나?**
A. 아니요. **체크리스트만 모니터 옆에 메모**로. 가이드는 막혔을 때만.

**Q. 메모리에 진행 상태 적으면 안 됨?**
A. 적어도 되지만 **금방 낡음**. 진행 상태는 git log/README에 두고, 메모리엔 "왜 그렇게 결정했는지" 의도만.

**Q. settings·CLAUDE.md 바꾸면 바로 적용?**
A. 아니요. **새 세션부터** 적용. 이 창은 그대로 두고 새 창에서 작업하세요.

**Q. Auto 모드 항상 켜두면 안 됨?**
A. 비추. 단순 반복만. 새 기능·복잡 작업은 Default가 안전.

**Q. 옛 메모리가 코드랑 안 맞으면?**
A. **현재 코드를 신뢰**. 메모리는 어제 시점 스냅샷. 안 맞으면 메모리 업데이트해달라고 요청.

---

**Last updated**: 2026-05-18
**Source**: 이미지 50장 + 실전 대화 정리

---

## 변경 이력
- 2026-05-18: §10-3 자동 토의 시스템 신설 (의뢰인 한 줄 요청 → 자율 토의 → DISCUSSIONS.md 시간순 누적 → 자동 Plan 모드 진입 → chief-reviewer 종합). §10-4 자동 학습 시스템 + 고도화 옵션 신설. 16개 페르소나에 자율성 룰 + 학습 노트 섹션 추가 (다른 의견 무조건 수용 X, 불가 시 대안 제시). CLAUDE.md §4 DO에 자동 토의·자동 학습 룰 추가, §7 트리거에 "토의해주세요" / "[페르소나]에 학습시켜줘" 추가.
- 2026-05-18: §10-2 신설 — Subagent 16개 운영 매뉴얼 (개발 2 / 검토 4 / 디자인 2 / 교육 콘텐츠 4 / 후기 2 / 기획·총괄 2). 16개 .claude/agents/ 마크다운 생성. §4에 슬래시 명령 메커니즘 3종(빌트인/스킬/커스텀) 추가. §10을 "역할 분담 4가지 패턴"으로 확장.
- 2026-05-13: 초판
