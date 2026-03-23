# Vercel 배포 — highroad-math (학부모 포털 포함)

- 문서 기준일: 2026-03-23

## 목표 URL

| 구분 | 주소 (예시) |
|------|----------------|
| 기본 배포 도메인 | `https://highroad-math.vercel.app` |
| 학부모 포털 | `https://highroad-math.vercel.app/parent-portal` |

루트 `vercel.json`의 `name`이 `highroad-math`로 설정되어 있어, Vercel에서 **프로젝트 이름**을 동일하게 두면 기본 URL에 `highroad-math`가 포함됩니다.

## 중요: Root Directory는 저장소 루트로 두세요

**`parent-portal`만 Root Directory로 지정하면 안 됩니다.**

`parent-portal/index.html`이 `../css/sub-shared.css`, `../js/invoke-verify-teacher-pin.js` 처럼 **상위 폴더(저장소 루트)** 의 `css/`, `js/` 를 참조합니다. 배포 루트가 `parent-portal` 뿐이면 `../` 경로가 사라져 **스타일·스크립트 404**가 납니다.

| 설정 | 권장 |
|------|------|
| **Root Directory** | 비우기 또는 **`.`** (저장소 전체) |
| **Project Name** | `highroad-math` |
| 학부모 포털 URL | `https://highroad-math.vercel.app/parent-portal` (루트 전체 배포 시 `vercel.json` 리라이트 사용) |

학부모 포털 “만” 올리고 싶다면, 별도로 `css`·`js` 경로를 `parent-portal` 안으로 복사하거나 상대 경로를 수정하는 작업이 필요합니다. 현재 레포 구조 기준으로는 **전체 클론 배포**가 맞습니다.

## 배포 절차 (Vercel 대시보드)

1. [Vercel](https://vercel.com) 로그인 → **Add New…** → **Project**.
2. Git 저장소(`academy_manager` 등)를 **Import**합니다.
3. **Project Name**을 반드시 **`highroad-math`** 로 지정합니다. (다르면 `https://<다른이름>.vercel.app` 이 됩니다.)
4. **Root Directory**는 **설정하지 않음**(저장소 루트).
5. Framework Preset: **Other** (또는 정적 사이트). Build Command / Output Directory는 저장소 기본값이면 되고, 이 저장소는 정적 파일 + 루트 `vercel.json` 리라이트를 사용합니다.
6. **Deploy** 클릭.

## 학부모 포털만 공유할 때

학부모에게는 아래만 안내하면 됩니다.

```text
https://highroad-math.vercel.app/parent-portal
```

## 커스텀 도메인 (선택)

도메인을 이미 보유한 경우 Vercel 프로젝트 → **Settings** → **Domains**에서 연결합니다.  
예: `parent.highroad-math.com` → 동일 프로젝트에 추가 후 DNS 안내에 따라 설정.

## API 프록시

루트 `vercel.json`의 `rewrites`로 `/api/*`가 Railway 백엔드로 전달됩니다. 학부모 포털이 해당 API를 쓰는 경우에만 영향이 있습니다.

## Supabase / 보안 (확인 권장)

- 학부모 포털은 `parent-portal/report.js` 등에서 Supabase URL·anon 키를 사용합니다. 운영 키는 **환경 변수·서버 주입**으로 관리하는 편이 안전합니다.
- **Authentication** → **URL Configuration**에 실제 배포 출처를 넣을 필요가 있으면 `https://highroad-math.vercel.app` (및 커스텀 도메인)을 **Site URL** / **Redirect URLs**에 추가하세요.

## 로컬 `.env.local`과의 차이

정적 배포에서는 루트의 `.env.local`을 그대로 올리지 않는 것이 일반적입니다. Vercel **Environment Variables**에 `REACT_APP_SUPABASE_URL` 등을 넣어도, 현재 HTML은 빌드 시 주입되지 않으면 클라이언트에 자동 반영되지 않을 수 있습니다. 필요 시 `parent-portal`용 env 로더·설정을 별도로 맞추는 것을 권장합니다.

## 배포가 곧바로 실패할 때 (로그가 짧고 에러 한 줄이 안 보일 때)

1. **Build Logs를 끝까지 스크롤**합니다. `Running "vercel build"` 직후에 나오는 **첫 번째 빨간 줄**이 실제 원인입니다.
2. **GitHub `main`의 `package.json`**이 로컬과 같은지 확인합니다. 예전에 잘못된 `dependencies`(존재하지 않는 패키지 버전)가 남아 있으면 **Install** 단계에서 멈춥니다. 로컬에서 수정했다면 **커밋·푸시 후 Redeploy**가 필요합니다.
3. **Root Directory**는 반드시 **저장소 루트**(비우기 또는 `.`)입니다. `parent-portal`만 루트로 두면 안 됩니다(위 문서 참고).
4. **Project Settings → Build & Development Settings**에서 Build/Install Command에 **대시보드에서 잘못된 override**가 켜져 있지 않은지 확인합니다. 루트 `vercel.json`의 `buildCommand`/`installCommand`와 충돌하면 예상과 다르게 동작할 수 있습니다.

## 배포 실패: `npm install` / `No matching version found for supabase-js`

루트 `package.json`에 존재하지 않는 패키지 버전이 있으면 Vercel이 **Install** 단계에서 실패합니다. (예: `supabase-js@^2.0.0` — npm에 해당 버전이 없음.)  
이 저장소는 브라우저에서 CDN으로 Supabase를 쓰므로 **의존성을 비우는 것**이 배포에 맞습니다. 최신 `package.json`을 푸시한 뒤 **Redeploy** 하세요.
