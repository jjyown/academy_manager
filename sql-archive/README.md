# SQL 아카이브 — 비상 롤백 전용

`migrations/` 의 APPLY 마이그레이션이 운영 중 문제가 발생했을 때 되돌리기 위한 ROLLBACK 스크립트만 보관.

**실행하지 마세요.** APPLY가 정상 운영 중인 한 이 스크립트는 RLS 정책을 헐겁게 만들어 보안 사고로 이어집니다.

| 파일 | 짝 마이그레이션 |
|------|----------------|
| `0010_reharden_stage1_rollback_20260321.sql` | `migrations/0010_reharden_stage1_apply_20260321.sql` |
| `0011_reharden_stage2_rollback_20260321.sql` | `migrations/0011_reharden_stage2_attendance_apply_20260321.sql` |
| `0012_reharden_stage3_rollback_20260321.sql` | `migrations/0012_reharden_stage3_students_schedules_apply_20260321.sql` |
