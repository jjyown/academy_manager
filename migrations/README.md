# Supabase 마이그레이션

순서대로 적용된 SQL 마이그레이션. 운영에 반영된 스키마/RLS 정책은 모두 이 디렉토리에 들어 있다.

## 적용 순서

| 번호 | 파일 | 영역 |
|------|------|------|
| 0001 | supabase_complete_setup | 전체 초기 스키마 |
| 0002 | student_schema_update | 학생 컬럼 확장 |
| 0003 | expense_ledger_setup | 지출 원장 |
| 0004 | create_evaluations_table | 학생 평가 |
| 0005 | grading_setup | 채점 시스템 |
| 0006 | homework_setup | 숙제 제출 |
| 0007 | student_test_score_setup | 시험 점수 |
| 0008 | attendance_record_meta_update | 출석 메타 컬럼 |
| 0009 | teachers_public_read_hotfix_20260320 | (긴급) 선생님 공개 읽기 완화 |
| 0010 | reharden_stage1_apply_20260321 | RLS 1단계 재강화 (선생님) |
| 0011 | reharden_stage2_attendance_apply_20260321 | RLS 2단계 (출석 쓰기) |
| 0012 | reharden_stage3_students_schedules_apply_20260321 | RLS 3단계 (학생/일정) |
| 0013 | attendance_rls_write_hotfix_20260321 | (긴급) 출석 쓰기 패치 |
| 0014 | holidays_bg_color_20260322 | 공휴일 배경색 |
| 0015 | holidays_multi_font_20260322 | 공휴일 글자 크기 |
| 0016 | attendance_memo_split_20260323 | 출석 메모 분리 |
| 0017 | class_memo_to_student_evaluations_20260323 | 클래스 메모 |
| 0018 | payments_ledger_json_20260324 | 결제 원장 스냅샷 |
| 0019 | eval_parent_visible_ai_20260329 | 평가 학부모 공개 |
| 0020 | student_eval_ai_style_entries_20260329 | AI 평가 스타일 |
| 0021 | user_eval_ai_style_note_20260329 | 사용자 스타일 노트 |
| 0022 | users_rls_student_eval_style_note_20260329 | RLS 정책 (스타일 노트) |
| 0023 | grading_assignments_due_time_20260330 | 채점 과제 마감 시각 |
| 0024 | homework_submission_grading_assignment_20260330 | 숙제↔과제 연결 |
| 0025 | grading_confirm_drive_20260405 | 채점 확정 Drive 게시 |
| 0026 | consolidate_rls_policies_20260509 | RLS 정책 통합 |
| 0027 | revoke_trigger_func_execute_20260509 | 트리거 함수 EXECUTE 회수 |
| 0029 | index_cleanup_20260509 | 미사용 인덱스 정리 |
| 0030 | drop_answer_keys_broad_read_20260509 | answer_keys 광역 읽기 정책 제거 |
| 0031 | admissions_knowledge_20260510 | 입시 지식 베이스 테이블 |
| 0032 | admissions_knowledge_weekly_cron_20260510 | 입시 지식 주간 수집 cron |
| 0033 | student_eval_image_url_20260510 | 학생 평가 이미지 URL |
| 0034 | cleanup_expired_reset_codes_20260510 | 만료 reset code 자동 삭제 cron |
| 0035 | answer_keys_solution_source_20260510 | answer_keys.solution_source(jsonb) — 외부 해설 시스템 매핑 |
| 0036 | tighten_student_eval_reports_bucket_listing_20260511 | student-eval-reports 버킷의 광역 SELECT 정책 제거 + owner-only SELECT 정책 추가 (Advisor: public_bucket_allows_listing) |
| 0037 | answer_keys_source_type_20260511 | answer_keys.source_type('book'/'custom'/'manual') + custom_material_uploaded_at — 시중교재 vs 자체제작 숙제 PDF 구분 (Drive: 학생들에게 나간숙제 자료/ 폴더 도입과 동시 적용) |
| 0038 | grading_items_assistant_columns_20260511 | grading_items에 전문 채점조교 결과 4컬럼: student_answer_normalized / process_feedback / suggested_partial_score / process_review_flags |
| 0039 | weakness_analysis_slots_20260511 | grading_items.mistake_category(conceptual/computational/careless/transcription/time_pressure/unknown) + answer_keys.question_meta_json — 학생 취약점 누적 분석용 |

> 0028 은 결번. 운영에 적용된 모든 마이그레이션은 위 표 순서대로 실행되어 있다.

## 새 마이그레이션 추가 시

1. 다음 번호(`0040_...`)로 `migrations/` 에 추가. **번호 충돌 절대 금지** — 기존 번호 재사용 시 적용 누락 사고가 발생할 수 있다.
2. Supabase SQL Editor에서 실행 후 운영에 반영
3. 커밋 시 적용 일시(KST)와 작업 컨텍스트를 commit message에 명시
