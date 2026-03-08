# Deploy And Verify Runtime

동적 timeout 반영 여부를 운영에서 빠르게 확인하기 위한 절차입니다.

## 1) 배포 전 체크

- 로컬 변경 사항 확인: `git status --short`
- 핵심 변경 파일 포함 여부:
  - `grading-server/main.py` (`/health/runtime`)
  - `grading-server/config.py` (timeout env)
  - `grading-server/routers/grading.py` (동적 timeout 계산)
  - `grading-server/.env.example` (env 문서화)

## 2) 배포

- GitHub에 커밋/푸시
- Railway에서 해당 서비스 재배포
  - Root Directory: `grading-server`
  - Healthcheck: `/health`

## 3) 운영 반영 1차 확인 (필수)

- 엔드포인트 확인:
  - `GET /health` → 200
  - `GET /health/runtime` → 200 이어야 함
- `/health/runtime` 응답에 아래 키가 보여야 반영 성공:
  - `timeouts.grading_timeout_base_seconds`
  - `timeouts.grading_timeout_per_image_seconds`
  - `timeouts.grading_timeout_max_seconds`

## 4) 운영 반영 2차 확인 (통합 스크립트)

아래 명령으로 리포트를 다시 생성:

```bash
python qa-artifacts/run_runtime_regrade_check.py \
  --base-url https://academymanager-production.up.railway.app \
  --teacher-id 508b3497-2923-4c16-b220-5099092dab76 \
  --result-id 34 \
  --timeout 8 \
  --poll-count 2 \
  --poll-interval 2
```

생성 파일:
- `qa-artifacts/runtime-regrade-check-report.json`

판정 기준:
- `checks.health_runtime.status_code == 200` 이면 최신 코드 반영됨
- 여전히 404면 미배포/배포 경로 오류

## 5) 후속 판단

- runtime 반영 완료 + `result_id=34`가 계속 timeout이면:
  - 실제 채점 경로 병목(외부 API/이미지량) 조사로 전환
- runtime 반영 미완료(404)면:
  - 배포 파이프라인/배포 대상 브랜치 문제 우선 해결
