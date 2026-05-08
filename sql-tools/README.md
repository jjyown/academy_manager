# SQL 운영 도구

운영 중 수동 실행하는 진단·복구 스크립트. 마이그레이션이 아니므로 **순서·번호 없음**, 필요할 때 그때그때 실행.

## 진단

| 파일 | 용도 |
|------|------|
| `health_check.sql` | 테이블/RLS/FK/인덱스 진단 (DRY-RUN) |
| `core_security_maintenance.sql` | 핵심 보안 점검 (DRY-RUN) |
| `verify_student_schema.sql` | students 컬럼 검증 |
| `verify_student_test_score.sql` | student_test_scores 컬럼 검증 |
| `teachers_policy_harden_and_verify.sql` | teachers 정책 재검증 |

## 복구·재적용

| 파일 | 용도 |
|------|------|
| `restore_auth_code_public_access.sql` | 학부모/학생 인증코드 공개 정책 복구 |
| `restore_parent_portal_attendance_read.sql` | 학부모 포털 출석 읽기 정책 복구 |
| `backup_table_rls_fix.sql` | 백업 테이블 RLS 잠금 |
| `backup_rls_batch_maintenance.sql` | 백업 RLS 배치 점검 |
