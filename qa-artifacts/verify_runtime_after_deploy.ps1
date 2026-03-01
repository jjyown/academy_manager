$ErrorActionPreference = "Stop"

$baseUrl = "https://academymanager-production.up.railway.app"
$teacherId = "508b3497-2923-4c16-b220-5099092dab76"
$resultId = 34

Write-Host "== Step 1/3: health endpoint checks =="
curl.exe --max-time 15 -s -o NUL -w "health:%{http_code} time:%{time_total}`n" "$baseUrl/health"
curl.exe --max-time 15 -s -o NUL -w "health_runtime:%{http_code} time:%{time_total}`n" "$baseUrl/health/runtime"

Write-Host "== Step 2/3: runtime + regrade integrated check =="
python "qa-artifacts/run_runtime_regrade_check.py" `
  --base-url "$baseUrl" `
  --teacher-id "$teacherId" `
  --result-id $resultId `
  --timeout 8 `
  --poll-count 2 `
  --poll-interval 2 `
  --out-file "qa-artifacts/runtime-regrade-check-report.json"

Write-Host "== Step 3/3: quick summary from report =="
python -c "import json; d=json.load(open('qa-artifacts/runtime-regrade-check-report.json', encoding='utf-8')); print('health_runtime=', d['checks']['health_runtime'].get('status_code')); rows=((d['checks'].get('results') or {}).get('json') or {}).get('data') or []; r=next((x for x in rows if x.get('id')==34), {}); print('result34_status=', r.get('status')); print('result34_error=', (r.get('error_message') or '')[:120])"

Write-Host "Done. Report: qa-artifacts/runtime-regrade-check-report.json"
