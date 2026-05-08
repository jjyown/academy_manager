-- ============================================================
-- attendance_records memo 분리(출석 사유 vs 수업관리)
-- 목적:
--   - attendance_records.memo/shared_memo: 출석기록(지각/결석/보강 등) 메모
--   - attendance_records.class_memo/class_shared_memo: 수업관리 모달(공부 상태) 메모
-- ============================================================

begin;

alter table public.attendance_records
  add column if not exists class_memo text;

alter table public.attendance_records
  add column if not exists class_shared_memo text;

-- 기존 데이터 백필(backfill)
-- memo/shared_memo 컬럼에 섞여 있던 "출석 사유용 자동 문구"를 제외하고,
-- 나머지를 class_memo/class_shared_memo 로 옮겨서 이후에는 용도 분리가 유지되도록 합니다.
update public.attendance_records
set class_memo = memo
where class_memo is null
  and memo is not null
  and memo not ilike '%전화번호인증%'
  and memo not ilike '%지각후인증%'
  and memo not ilike '%수업종료후임시%'
  and memo not ilike '%임시출석%';

update public.attendance_records
set class_shared_memo = shared_memo
where class_shared_memo is null
  and shared_memo is not null
  and shared_memo not ilike '%전화번호인증%'
  and shared_memo not ilike '%지각후인증%'
  and shared_memo not ilike '%수업종료후임시%'
  and shared_memo not ilike '%임시출석%';

commit;

