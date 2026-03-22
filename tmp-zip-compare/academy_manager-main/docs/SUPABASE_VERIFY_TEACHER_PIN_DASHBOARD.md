# verify-teacher-pin — Supabase 대시보드 설정 (401 해결)

선생님 **입장** 시 `verify-teacher-pin` 호출이 **401 Unauthorized**로만 보일 때, 아래를 확인하세요.

## Settings → 「JWT Keys」 페이지와 헷갈리지 마세요

스크린샷에 보이는 **Project Settings → CONFIGURATION → JWT Keys** 는 **프로젝트 전체에서 로그인 토큰을 어떤 키로 서명할지** 보는 화면입니다 (예: **ECC (P-256)** / 이전 **Legacy HS256**).  
몇 달 전 키가 바뀐 것은 Supabase 쪽 **정상 업그레이드**이고, **브라우저 앱은 `supabase-js`로 로그인**하므로 여기서 키를 직접 복사해 쓰지 않습니다.

**입장 401을 줄이려고 끄는 설정은 여기가 아니라**, 아래 **「Edge Functions → verify-teacher-pin」** 쪽의 **함수별 JWT 검증**입니다.

## 1) Edge Function에서 JWT 검증 끄기 (권장)

게이트웨이가 **함수 코드보다 먼저** JWT를 검사하면, 세션·키 형식에 따라 **401만** 보이고 본문(JSON)이 비는 경우가 있습니다.

1. [Supabase Dashboard](https://supabase.com/dashboard) → 본인 프로젝트 선택  
   (프로젝트 ref: `jzcrpdeomjmytfekcgqu`)
2. 왼쪽 **Edge Functions** 메뉴
3. **`verify-teacher-pin`** 함수 선택
4. **Function configuration** 에서  
   **「Verify JWT with legacy secret」** 토글을 **OFF** 로 둔다.  
   (화면 설명: *Recommended: OFF* — PIN은 함수 코드에서 검증하므로 게이트웨이 JWT 검사는 끄는 것이 맞음)  
5. **Save changes** 를 눌러 저장한다. (토글을 바꾸면 저장 버튼이 활성화됨)  
6. 1~2분 뒤 브라우저에서 **강력 새로고침(Ctrl+F5)** 후 다시 **입장** 시도

PIN 검증은 함수 **내부**에서 `service_role`로 처리하므로, 게이트웨이 JWT를 꺼도 PIN 자체는 서버에서 검증됩니다.

## 2) 함수 재배포 (코드·config 반영)

로컬에서:

```bash
npx supabase@latest functions deploy verify-teacher-pin
```

`supabase/config.toml`에 `[functions.verify-teacher-pin] verify_jwt = false`가 있으면 배포 시 함께 반영되는 경우가 많습니다. 그래도 대시보드에서 한 번 더 확인하는 것이 안전합니다.

## 3) 그다음 확인할 것

- 관리자 로그인 후 **세션이 만료**되지 않았는지 → 만료 시 **관리자 로그인으로 돌아가기** 후 다시 로그인
- **비밀번호(숫자 PIN)** 가 해당 선생님 계정과 일치하는지

---

- 문서 기준일: 2026-03-22
