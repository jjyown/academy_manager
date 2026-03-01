# Predeploy Readiness Check

생성 목적: 운영 반영 전, 현재 로컬 상태가 배포 가능한지 빠르게 판정.

## 점검 결과

- 브랜치: `main` (`main...origin/main`)
- 원격: `origin=https://github.com/jjyown/academy_manager.git`
- 최신 로컬 커밋: `a7a3bc8 대규모 업데이트`
- 워크트리 상태: **dirty** (수정/신규 파일 다수 존재)

## 판정

- 현재 상태에서는 GitHub 기반 배포 시 최신 변경이 반영되지 않을 수 있음.
- 이유: 수정 파일이 아직 커밋/푸시되지 않아 원격 코드와 로컬 코드가 다름.

## 배포 전 필수 조치

1. 변경 파일 커밋
2. `origin/main` 푸시
3. Railway 재배포
4. `qa-artifacts/verify_runtime_after_deploy.ps1` 재실행
