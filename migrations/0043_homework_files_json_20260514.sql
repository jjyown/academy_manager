begin;

alter table homework_submissions
  add column if not exists files_json jsonb default '[]'::jsonb;

create index if not exists hw_files_json_gin_idx
  on homework_submissions using gin (files_json);

commit;

-- 검증
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'homework_submissions'
  and column_name = 'files_json';
