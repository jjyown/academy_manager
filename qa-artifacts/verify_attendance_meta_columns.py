from __future__ import annotations

from pathlib import Path
import sys
import urllib.request
import urllib.error


def read_env(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def main() -> int:
    env_path = Path("grading-server/.env")
    if not env_path.exists():
        print("ENV_NOT_FOUND: grading-server/.env")
        return 2

    env = read_env(env_path)
    supabase_url = env.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_ANON_KEY") or ""
    if not supabase_url or not supabase_key:
        print("MISSING_SUPABASE_ENV: SUPABASE_URL or SUPABASE_SERVICE_KEY")
        return 3

    endpoint = (
        f"{supabase_url}/rest/v1/attendance_records"
        "?select=attendance_source,auth_time,presence_checked,processed_at&limit=1"
    )
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
    req = urllib.request.Request(endpoint, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"STATUS: {resp.status}")
            print(body[:500])
            if resp.status == 200:
                print("VERIFY_OK")
                return 0
            return 1
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"STATUS: {exc.code}")
        print(body[:500])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
