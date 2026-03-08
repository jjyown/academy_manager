# Deployment Checklist (Quick)

운영 반영 여부를 5분 내 확인하는 최소 체크리스트입니다.

## A. 배포 전 (1분)

- [ ] GitHub 기본 브랜치에 최신 커밋 반영 확인
- [ ] 변경 파일에 아래 항목 포함 확인
  - `grading-server/main.py` (`/health/runtime`)
  - `grading-server/routers/grading.py` (동적 timeout)
  - `grading-server/config.py` (timeout 설정)

## B. Railway 배포 확인 (2분)

- [ ] Railway 서비스의 Root Directory가 `grading-server`인지 확인
- [ ] 최근 Deploy 로그가 성공(Success)인지 확인
- [ ] 최신 커밋 SHA가 배포 대상과 일치하는지 확인

## C. 운영 API 반영 확인 (1분)

아래 명령 실행:

```powershell
powershell -ExecutionPolicy Bypass -File qa-artifacts/verify_runtime_after_deploy.ps1
```

판정:
- [ ] `health:200`
- [ ] `health_runtime:200`  ← 이게 핵심

## D. 실패 시 즉시 조치 (1분)

- `health_runtime:404`면:
  - [ ] 배포 대상 브랜치/프로젝트가 맞는지 재확인
  - [ ] Railway에서 수동 Redeploy 1회
  - [ ] 같은 명령 재실행 후 결과 비교

## E. 완료 기준

- [ ] `/health/runtime`가 200으로 확인됨
- [ ] `qa-artifacts/runtime-regrade-check-report.json`이 최신 시간으로 갱신됨
