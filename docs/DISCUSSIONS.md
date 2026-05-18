# academy_manager 토의록 (회의록)

> 사용자(=의뢰인)가 한 줄 요청 → Claude가 회의 진행자로서 관련 subagent 페르소나들 호출 → 페르소나끼리 다중 라운드 토의 → **모든 발언을 시간순으로 누적 기록**.
> **최신 토의가 상단.** 분기별로 종결 토의는 `docs/discussions-archive/YYYY-QN.md`로 분리.

---

## 역할 분담

| 역할 | 누가 | 무엇 |
|---|---|---|
| **의뢰인** | 사용자 (당신) | "이거 만들어주세요" 한 줄 요청 + 최종 결정 |
| **회의 진행자** | 메인 Claude | 페르소나 식별·호출·발언 정리·토의록 기록 |
| **참여 페르소나** | 관련 subagent 다수 | 라운드별 의견 교환·반박·종합 |
| **종합 발표자** | chief-reviewer | 마지막에 종합 + 의뢰인에게 결정 요청 |

---

## 사용법

### 토의 시작 — 의뢰인 한 줄
> "[주제] 토의해서 진행해주세요. 모든 발언 DISCUSSIONS.md에 기록"

자연어로도:
> "출석 화면에 결석 사유 입력 추가하는 거 토의해주세요"

→ Claude가 자동으로:
1. 관련 페르소나 식별 (예: product-manager / ui-ux-designer / education-expert / academy-developer)
2. **라운드 1**: 각자 독립 의견 (다른 페르소나 의견 안 보고)
3. **라운드 2**: 다른 의견 보고 보충·반박
4. **라운드 3**: chief-reviewer 종합
5. 모든 발언을 이 파일 상단에 시간순 누적
6. 의뢰인에게 결정 요청

### 토의 도중 의뢰인 개입 (선택)
관전 중 의견 추가하고 싶으면:
> "잠깐, 의뢰인 의견 — [...]"

→ `**HH:MM 의뢰인 발언**` 형식으로 기록 후 토의 계속.

### 토의 종결
의뢰인 결정 후:
> "이 토의 종결. [결론] 으로 처리. 구현은 academy-developer가"

### 토의 재개
보류·폐기됐던 거 다시 열기:
> "[주제] 토의 재개. 추가 의견 받자"
→ 같은 섹션 하단에 `### YYYY-MM-DD 재개` 추가

### Archive 분리
파일 길어지면 (50개 토의 초과 또는 분기 종료):
> "DISCUSSIONS.md 2026 Q2 종결 토의들 archive로 분리해줘"
→ `docs/discussions-archive/2026-Q2.md`로 이동

---

## 토의 템플릿 (시간순 회의록)

```markdown
## YYYY-MM-DD HH:MM <주제> [진행중|종결|보류|폐기]

**의뢰인 요청**: "원본 요청 한 줄 그대로"
**참여 페르소나**: <자동 식별된 목록>

### 라운드 1 — 독립 의견 (각자 다른 의견 안 보고 발언)

**HH:MM <페르소나 1> 발언**
의견 본문 1~3줄
결론: 찬성/반대/조건부

**HH:MM <페르소나 2> 발언**
...

### 라운드 2 — 교차 의견 (다른 의견 보고 보충·반박)

**HH:MM <페르소나 1> 재발언**
"<페르소나 2>의 의견에 동의/반박, 이유는..."

**HH:MM <페르소나 2> 추가**
...

### 라운드 3 — 종합

**HH:MM chief-reviewer 종합**
- 배포 가능 / 조건부 / 금지
- 조건 1~3줄

### 의뢰인 결정 대기
- [ ] 종합안 승인
- [ ] 추가 의견 요청
- [ ] 폐기

### 후속 변경 (의뢰인 결정 후 채움)
- 결정 일자: YYYY-MM-DD
- 결정: ...
- 후속 작업: 커밋 / PR / 변경 `path:line`
```

**상태값**: `진행중` / `종결` / `보류` / `폐기`

---

## 진행중·최근 종결 토의

<!-- 최신이 위. 아래로 누적. -->

## 2026-05-18 16:00 해설제작지 — 현 상태 유지 vs 개편 [진행중]

**의뢰인 요청**: "해설제작지(highroad-math-solution, Railway 라이브)를 지금처럼 운영할지 큰 개편을 할지 토의해주세요"
**참여 페르소나**: product-manager, cost-monitor, solution-writer, textbook-designer, academy-reviewer, chief-reviewer
**미참여 (영향 적음)**: security-reviewer (RLS/OAuth 영향 0건 — 단 PR-A' 진입 전 cost_counter RLS 검토 예정), education-expert, ui-ux-designer (운영자 도구라 학생·학부모 직접 영향 없음)

### 라운드 0 — 사용자 plan 초안 (현 상태 vs 개편 NO-GO 1차 결론)

의뢰인이 5명 1차 검토 + chief 1차 종합 결과를 plan 본문으로 정리해 본 검토 회차 요청. 큰 개편 NO-GO, PR-A(비용 가드) / PR-B(인쇄 품질) / PR-C(풀이 텍스트 품질) 3개 패키지 분할. Phase 6(academy_manager ↔ 해설제작지 import 연동) 보류.

### 라운드 1 — 본 검토 회차 독립 의견 (도메인별)

**16:05 academy-reviewer 발언**
Phase 6 보류 비용 = 0. `grading-server/integrations/highroad_solution.py:36` `is_enabled()` 가 env 미설정 시 False → 빈 결과 반환 graceful degrade. 매니저 측 채점/숙제 흐름 정상.
조건 ①: CLAUDE.md §4 DO에 PR-A-4 체크리스트 cross-reference 한 줄. ②: PR-A 체크리스트에 catch handler verbosity+sanitize 항목 포함.
최근 30일 LLM commit 다수(f23f0e0, 33a8214, ae533ad 등) — PR-A 가드 없었으면 동일 회귀 재발 가능.
결론: **조건부 OK**

**16:08 cost-monitor 발언**
$5/일 GCP Budget Alert = 사후 통보(lag 6~24h). 2026-05-09 5분 spike($36) 차단 불가, 실효성 < 5%.
카운터 자동 OFF = 저장처 미지정(Railway/Vercel 인스턴스 분리), 이미 발생 비용 회수 불가 → **불가**.
**사전 차단 3종 대안**: (a) Gemini API key 일일 quota hard cap $15/일 (GCP Console, 코드 0줄), (b) Supabase `cost_counter` 테이블 + 진입 가드 (UPSERT 원자성), (c) c80cd49 in-flight 가드 유지.
PR-C self-check 비용 정량: 일일 baseline 7일치 export 선행 없이 진입 금지.
Cloudflare Workers Analytics/Datadog 단일 사용자 ROI 낮음(과잉).
결론: **조건부** — PR-A는 PR-A'로 사전차단 3종 재설계

**16:11 solution-writer 발언**
프롬프트 3룰만으론 부족. **5룰**로 확장: (a) 그래프/도형 참조 (c) 답안 형식(분수 vs 소수 / `\sqrt{2}/2` vs `1/\sqrt{2}` 표준) 추가. "비약 금지"는 모호 → "한 줄에 한 변형만(치환·전개·인수분해 중 하나)" 측정 가능 룰로 치환.
self-check 1패스: V1~V6 표면(LaTeX/괄호/placeholder) vs 의미 논리. 둘 다 필요. self-check가 V5 placeholder 일부 흡수 가능.
**Critical 누락**: self-check 실패 후속 흐름 미정. 무한 재생성 시 spike 회귀. → 1회 재생성 → 폐기 + "사람 검수 필요" 플래그(자동 큐 X, 단순 마킹).
baseline 30건 사전 측정 필수 (단원: 수1/수2/미적분/확통/기하 균등 + 난이도 2·3·4점 균등 + 4축 채점: 단계 누락/표기 일관성/공식 명시/계산 정확성).
PR-C 방향은 사용자 의도(memory `project_haeseol_workflow_intent` "해설 퀄리티 핵심")와 정합.
결론: **조건부**

**16:14 textbook-designer 발언**
resvg zoom 1.3→2.0 적정 (B4 2단·11.5pt 본문에서 154dpi 통과, 레이저 인쇄 가독 임계 150dpi 초과). 단 `equationRenderer.ts:95-96` 주석에 과거 "2.0 비대" 회귀 이력 — 표본 ≥3건 사전 검증 필수. 2.5/3.0은 B4 좁은 칼럼(70mm) 폭 초과 위험.
표지 메타박스 4개 부족: **학생명/점수칸/소요시간 추가**(자가채점·학원 분류 키, 시중 모의고사 표준).
**가로선 1줄 단독 불가**: `[정답]` `[해설]` 텍스트 라벨이 이미 있음(`examExplanationDocx.ts:828, :839`) → 이중 분리 효과 약함. **대안**: `[정답]` 회색 음영(`fill:D9D9D9`) 박스 + `[해설]` 좌측 2pt leader bar.
누락 동반 처리: footer 페이지번호(현재 정의 없음, B4 2단 인쇄물 표준은 하단 가운데).
SVG 직접 임베드 대안 불가 — docx 패키지 `ImageRun`이 PNG/JPEG/GIF/BMP만.
결론: **조건부**

### 라운드 2 — 교차 의견 (생략)

페르소나간 충돌이 명확히 분리됨(cost-monitor "$5 불가" vs plan "$5 OK"). 교차 라운드 없이 chief 종합으로 진입.

### 라운드 3 — chief-reviewer 종합

**16:18 chief-reviewer 종합**
plan 그대로 배포 **불가**. 보안 > 비용 > UX > 효율 우선순위에서 cost-monitor 지적이 최우선 — 비용 가드 실효성 미달이 차단 사유. plan PR-A 자체를 **PR-A'(사전 차단 3종)** 으로 교체.

**옵션 비교**:

| 옵션 | 기간 | 안전성 | 추천 |
|---|---|---|---|
| A. plan 원안 ($5 알림 + toggle OFF) | 1+1+2주 | spike 재발 가능 | 불가 |
| **B. PR-A'(사전차단 3종) + PR-B 보강 + PR-C 확장** | **1+1+3주 + baseline 7일 병렬** | spike 사전 차단 | **추천** |
| C. PR-A'만 먼저, PR-B/C 보류 | 1주 | 비용 안전, 품질 X | 사용자 의도 미충족 |

**채택**: 옵션 B. 1주 추가 분량은 1인 운영 부담 한도 안.

**미검토 영역**:
- security-reviewer: Supabase `cost_counter` 신규 테이블 RLS — PR-A' 진입 전 필수
- haeseol-reviewer: PR-C self-check 한도 — **해설 작업창에서 별도 호출** (본 매니저 작업창에선 호출 불가)
- ui-ux-designer / education-expert: PR-B 표지 / PR-C baseline 단원 선정 — 권장

### 의뢰인 결정
- [x] **옵션 B 채택** (2026-05-18 16:25). plan 수정 후 진행.

### 후속 변경

#### A. 본 매니저 작업창에서 즉시 진행 (3건)
1. docs/DISCUSSIONS.md 본 회의록 추가 (시간순 누적)
2. CLAUDE.md §4 DO에 safety guards + cross-reference bullet 추가
3. docs/CLAUDE_USAGE_GUIDE.md §10-5 신규 LLM PR 체크리스트 섹션 신설

#### B. 사용자 직접 (코드 외부, ~30분)
4. **GCP Console**: Gemini API key 일일 quota hard cap **$15/일** 적용
   - 경로 1 (직접 quota 제한): Google Cloud Console → APIs & Services → Enabled APIs & Services → "Generative Language API" → Quotas & System Limits → "Requests per minute per project" + "Tokens per minute per project" 임계치 하향
   - 경로 2 (예산 알림 + 자동 차단): Billing → Budgets & alerts → 새 예산 $15/일 + 100% 시 자동 차단 (Cloud Function pub/sub 트리거로 API key disable)
   - 적용 후 더미 호출로 quota 거부 확인
   - **PR-A' 코드 변경과 시간 분리** (memory `feedback_code_push_env_change_separation`)

#### C. 해설 작업창으로 이관 (별도 세션, 시간순)
5. `cost_counter` 마이그레이션 (Supabase `gsdhwuoyiboyzvtokrao`) + RLS — **security-reviewer 사전 호출**
6. 진입 가드 코드 — `autoPipeline.ts` 진입 시 `cost_counter` SELECT, 임계 초과 시 409
7. catch handler verbosity + sanitize 표준 적용
8. **PR-B 코드** — `equationRenderer.ts` zoom 1.3→2.0(표본 ≥3건 사전 검증), `examExplanationDocx.ts` 표지 메타 6개(제목·단원·학년·문항수·날짜·학생명+점수칸), 가로선→`[정답]` 음영(D9D9D9) 박스 + `[해설]` 좌측 2pt leader bar, footer 페이지번호
9. **PR-C** — baseline 30건 측정(7일, 단원·난이도 균등 병렬) → 5룰 프롬프트(비약 금지→"한 줄에 한 변형만" / 사용 공식 / 부호·치환 / 그래프 참조 / 답안 형식) + self-check 1회 재생성 한도 + 폐기 + "사람 검수 필요" 플래그
10. haeseol-reviewer 최종 검토

#### 회귀 안전망
- 본 plan 진입 전 git tag 안정 hash 저장
- 각 PR commit message에 rollback 명령 + 직전 commit hash 포함
- PR-A' 코드 적용과 GCP Quota 변경 시간 분리

#### 학습 노트 갱신 대상 (작업 종결 시)
- cost-monitor: "$5/일 사후 알림 한계 + GCP Quota hard cap + Supabase cost_counter 사전차단 패턴"
- solution-writer: "프롬프트 룰은 측정 가능해야(비약 금지 → 한 줄에 한 변형)" + "self-check 실패 시 재생성 1회 한도 + 사람 검수 플래그"
- textbook-designer: "B4 2단 본문 11.5pt 기준 resvg zoom 2.0 적정(154dpi)" + "라벨 + 음영/leader bar 조합이 가로선 단독보다 식별성 ↑"
- chief-reviewer: "비용 가드 실효성 < 5%면 보안 > 비용 우선순위에서 차단 사유"

---

## 2026-05-18 14:00 Subagent + 토의록 시스템 구축 [종결]

**의뢰인 요청**: "회사처럼 역할 분담해서 토의록 누적하면서 작업하는 방식으로 시스템 만들어주세요"
**참여 페르소나**: chief-reviewer, product-manager

### 라운드 1 — 독립 의견

**14:00 product-manager 발언**
채팅창 7개 분리는 관리 비용 폭발. 채팅창 3개 + subagent 분리 추천.
비전공자 1인 운영이라 페르소나별 호출 시점 명확히 정의 필요.
결론: **조건부 찬성** (페르소나 16개는 다소 많음, 한 달 후 정리 권장)

**14:02 chief-reviewer 발언**
16개 페르소나 (개발 2 / 검토 4 / 디자인 2 / 교육 콘텐츠 4 / 후기 2 / 기획·총괄 2) 구성 OK.
토의록 시스템과 연동해 결정 근거를 누적해야 비전공자 의뢰인 입장에서 의사결정 추적 가능.
결론: **찬성**

### 라운드 2 — 교차 의견

**14:05 product-manager 보충**
chief-reviewer의 16개 구성안 동의. 단 토의록은 "사용자=의뢰인, 페르소나끼리 토의" 형식이어야 비전공자가 결정 부담 안 느낌. 라운드별 회의록 형식 권장.

**14:07 chief-reviewer 추가**
동의. 토의록 템플릿을 시간순 발언 + 3라운드 구조로 명문화. 의뢰인 개입은 선택적 — 마지막 종합 단계에서 결정만.

### 라운드 3 — 종합

**14:10 chief-reviewer 종합**
**배포 가능.** 구조 확정:
- 16개 subagent + 채팅창 3개 + 토의록 시스템
- 토의록은 시간순 회의록 형식 (라운드 1~3)
- 의뢰인은 시작 트리거 + 최종 결정만 (개입은 선택)
- 분기별 archive 분리

### 의뢰인 결정
- [x] 승인 (2026-05-18). 시스템 구축 진행

### 후속 변경
- `~/.claude/agents/` 12개 마크다운 (글로벌)
- `academy_manager/.claude/agents/` 2개
- `시험지 해설 제작/highroad-math-solution/.claude/agents/` 2개
- `academy_manager/docs/CLAUDE_USAGE_GUIDE.md` §10-2 신설
- `academy_manager/docs/DISCUSSIONS.md` 본 파일 생성
- `시험지 해설 제작/.../docs/DISCUSSIONS.md` 자매 파일 생성
