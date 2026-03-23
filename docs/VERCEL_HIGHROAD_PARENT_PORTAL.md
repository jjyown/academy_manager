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
| **Output Directory** | 루트 `vercel.json`에 **`"outputDirectory": "."`** — `index.html`·`parent-portal/` 등이 **저장소 루트**에 있고 `public/`을 쓰지 않음. 기본값이 `public`이면 `No Output Directory named "public" found` 오류. |
| **학부모 포털 URL** | `https://highroad-math.vercel.app/parent-portal` (`vercel.json` 리라이트) |

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

## `Vercel CLI` 버전 줄 직후로만 보일 때

- UI가 **스트리밍 중**이면 그 다음 줄(`Running "install" command: ...` 등)이 **잠시 뒤에** 붙습니다. 페이지를 **새로고침**하거나, 실패한 배포 카드를 열어 **맨 아래까지 스크롤**해 보세요.
- 배포 요약 상단에 **빨간 한 줄 요약**(예: `Command "npm install" exited with 1`)이 따로 나오는 경우가 있어, Build Log 본문과 **함께** 확인합니다.
- 그래도 `install` 단계가 **전혀** 안 보이면: GitHub 해당 커밋(예: `bf31b47`)의 루트 `vercel.json`이 **유효한 JSON**인지(쉼표·따옴표 오류 없음) 확인합니다. 로컬에서 `vercel.json`을 저장한 뒤 **푸시**했는지도 확인합니다.
- 로컬 터미널에서 프로젝트를 연결한 뒤 `npx vercel build`를 실행하면, 대시보드보다 **긴 전체 로그**를 보기 쉽습니다.

### 정말로 `Running "vercel build"` / `Vercel CLI` 몇 줄만 있고 그 아래가 비어 있을 때

정상 빌드라면 곧이어 **`Running "install" command`** 또는 **`Installing dependencies`** 같은 줄이 나옵니다. **그게 전혀 없다**면 다음을 순서대로 확인합니다.

1. **로그 필터**: Build Logs 상단에 **에러만 보기**·레벨 필터가 있으면 **전체(All)** 로 두고 다시 확인합니다.
2. **프로젝트 Node 버전 고정**: **Settings → General → Node.js Version**을 **20.x**로 명시합니다. (`package.json`의 `engines`와 맞춤.)
3. **같은 배포의 다른 탭**: 실패한 배포 페이지에서 **Summary / Source / Deployment** 영역에 **한 줄짜리 실패 사유**가 따로 있는지 봅니다.
4. **CLI로 확인** (로컬): 저장소 루트에서 `npx vercel link`로 프로젝트 연결 후 `npx vercel build`를 실행하면 터미널에 **대시보드보다 긴 로그**가 나올 수 있습니다.
5. **그래도 원인 문구가 없으면**: 배포 **URL 또는 Deployment ID**를 남기고 [Vercel 상태 페이지](https://www.vercel-status.com/)·지원 채널을 고려합니다. (로그가 비어 있는 것은 드물며, 플랫폼/일시 오류 가능성도 있습니다.)

## 브라우저 콘솔: GitHub에 `main`이 없다는 오류

개발자 도구(F12) **Console**에 아래와 **비슷한 메시지**가 보이면, Build Log가 짧게 끊겨 보이는 이유를 설명할 수 있습니다.

`The provided GitHub repository does not contain the requested branch or commit reference "main"`

**의미:** Vercel이 연결한 저장소에서 **`main` 브랜치(또는 지정한 프로덕션 브랜치)를 찾지 못했습니다.** (빈 저장소, 아직 푸시 없음, 기본 브랜치가 `master` 등 다른 이름, 잘못된 저장소 연결.)

**조치:**

1. **GitHub**에서 `jjyown/academy_manager`(또는 연결한 URL)를 열어 **브랜치 목록**에 `main`이 있는지 확인합니다.
2. 없으면 로컬에서 `main`을 만들고 **`git push -u origin main`** 으로 올리거나, GitHub 기본 브랜치를 `main`으로 맞춥니다.
3. Vercel **Project → Settings → Git → Production Branch**를 GitHub와 **동일한 브랜치 이름**으로 설정합니다.
4. 저장소가 **비어 있지 않은지**(최소 `README`라도 커밋되어 있는지) 확인합니다.

이때 콘솔의 `/api/v2/projects/...` **404** 는 대시보드가 저장소 메타를 못 불러올 때 **부수적으로** 뜰 수 있어, 위 Git 문제를 먼저 해결하는 편이 좋습니다.

## `npm install` 직후 로그가 멈춘 것처럼 보일 때

- 로그에 `Running "install" command: npm install ...` 다음에 **실제 에러(빨간 줄·`npm ERR!`)** 가 이어집니다. **아래로 스크롤**해야 합니다. 10줄만 보이면 실패 원인이 잘립니다.
- 노란 **`engines` / Node 버전 경고**는 Vercel이 “메이저 자동 업그레이드 가능”을 알리는 것이며, **그 자체가 빌드 실패 원인은 아닙니다.** 레포에서는 `package.json`의 `engines.node`를 `20.x`처럼 **고정**해 경고를 줄일 수 있습니다.

## 배포가 곧바로 실패할 때 (로그가 짧고 에러 한 줄이 안 보일 때)

1. **Build Logs를 끝까지 스크롤**합니다. `Running "vercel build"` 직후에 나오는 **첫 번째 빨간 줄**이 실제 원인입니다.
2. **GitHub `main`의 `package.json`**이 로컬과 같은지 확인합니다. 예전에 잘못된 `dependencies`(존재하지 않는 패키지 버전)가 남아 있으면 **Install** 단계에서 멈춥니다. 로컬에서 수정했다면 **커밋·푸시 후 Redeploy**가 필요합니다.
3. **Root Directory**는 반드시 **저장소 루트**(비우기 또는 `.`)입니다. `parent-portal`만 루트로 두면 안 됩니다(위 문서 참고).
4. **Project Settings → Build & Development Settings**에서 Build/Install Command에 **대시보드에서 잘못된 override**가 켜져 있지 않은지 확인합니다. 루트 `vercel.json`의 `buildCommand`/`installCommand`와 충돌하면 예상과 다르게 동작할 수 있습니다.

## 배포 실패: `No Output Directory named "public" found`

**증상 (Build Log):** `Error: No Output Directory named "public" found after the Build completed.`

**원인:** Vercel(또는 프로젝트 설정)이 정적 산출물을 **`public/`** 아래에서 찾는데, 이 저장소는 **`index.html`이 루트**이고 `public/` 디렉터리를 배포 단위로 쓰지 않는다.

**조치:** 루트 `vercel.json`에 **`"outputDirectory": "."`** 를 넣어 배포 루트를 저장소 루트로 고정한다. 대시보드 **Output Directory** override가 `public`으로 켜져 있으면 끄거나 **`.`** 로 맞춘다.

## 배포 실패: `npm install` / `No matching version found for supabase-js`

루트 `package.json`에 존재하지 않는 패키지 버전이 있으면 Vercel이 **Install** 단계에서 실패합니다. (예: `supabase-js@^2.0.0` — npm에 해당 버전이 없음.)  
이 저장소는 브라우저에서 CDN으로 Supabase를 쓰므로 **의존성을 비우는 것**이 배포에 맞습니다. 최신 `package.json`을 푸시한 뒤 **Redeploy** 하세요.
