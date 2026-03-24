-- ============================================================
-- class memo(수업관리) -> student_evaluations로 이동
-- ============================================================
-- 목표
-- - 출석기록 메모(memo/shared_memo)는 출석관리에서만 영향
-- - 수업관리 메모는 student_evaluations.class_memos/class_shared_memos에서만 로드/저장
-- - 기존 데이터는 attendance_records.class_*에서 백필(단, 기존에 memo/shared_memo에 섞여있던 값은 자동 구분이 어려움)

begin;

alter table public.student_evaluations
  add column if not exists class_memos jsonb;

alter table public.student_evaluations
  add column if not exists class_shared_memos jsonb;

-- personal memo 백필: class_memos[YYYY-MM-DD][HH:MM] = memo
with class_memos_daily as (
  select
    owner_user_id,
    student_id,
    substring(attendance_date::text from 1 for 7) as eval_month,
    substring(attendance_date::text from 1 for 10) as date_key,
    case
      when scheduled_time is null then 'default'
      when scheduled_time::text ~ '^\d{1,2}:\d{2}(:\d{2})?$'
        then lpad(split_part(scheduled_time::text, ':', 1), 2, '0') || ':' || split_part(scheduled_time::text, ':', 2)
      else 'default'
    end as time_key,
    class_memo as memo
  from public.attendance_records
  where class_memo is not null
),
class_memos_daily_map as (
  select
    owner_user_id,
    student_id,
    eval_month,
    date_key,
    jsonb_object_agg(time_key, memo) as daily_map
  from class_memos_daily
  group by owner_user_id, student_id, eval_month, date_key
),
class_memos_monthly_map as (
  select
    owner_user_id,
    student_id,
    eval_month,
    jsonb_object_agg(date_key, daily_map) as monthly_map
  from class_memos_daily_map
  group by owner_user_id, student_id, eval_month
)
update public.student_evaluations se
set class_memos = cm.monthly_map
from class_memos_monthly_map cm
where se.student_id = cm.student_id
  and se.eval_month = cm.eval_month;

-- shared memo 백필:
-- class_shared_memos[YYYY-MM-DD][HH:MM][teacher_id] = shared_memo(html/text)
with class_shared_daily as (
  select
    owner_user_id,
    student_id,
    substring(attendance_date::text from 1 for 7) as eval_month,
    substring(attendance_date::text from 1 for 10) as date_key,
    case
      when scheduled_time is null then 'default'
      when scheduled_time::text ~ '^\d{1,2}:\d{2}(:\d{2})?$'
        then lpad(split_part(scheduled_time::text, ':', 1), 2, '0') || ':' || split_part(scheduled_time::text, ':', 2)
      else 'default'
    end as time_key,
    teacher_id as teacher_key,
    class_shared_memo as memo
  from public.attendance_records
  where class_shared_memo is not null
),
class_shared_time_teacher_map as (
  select
    owner_user_id,
    student_id,
    eval_month,
    date_key,
    time_key,
    jsonb_object_agg(teacher_key, memo) as teacher_map
  from class_shared_daily
  group by owner_user_id, student_id, eval_month, date_key, time_key
),
class_shared_daily_map as (
  select
    owner_user_id,
    student_id,
    eval_month,
    date_key,
    jsonb_object_agg(time_key, teacher_map) as daily_map
  from class_shared_time_teacher_map
  group by owner_user_id, student_id, eval_month, date_key
),
class_shared_monthly_map as (
  select
    owner_user_id,
    student_id,
    eval_month,
    jsonb_object_agg(date_key, daily_map) as monthly_map
  from class_shared_daily_map
  group by owner_user_id, student_id, eval_month
)
update public.student_evaluations se
set class_shared_memos = cm.monthly_map
from class_shared_monthly_map cm
where se.student_id = cm.student_id
  and se.eval_month = cm.eval_month;

commit;

