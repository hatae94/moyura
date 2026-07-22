# moyura 웹 렌더링 성능 진단 리포트

작성: Performance Audit (다중 에이전트 워크플로우 — 웹 리서치 4 + 코드 조사 5 + 적대적 검증 4)
작성일: 2026-07-14
대상: moyura 팀
범위: apps/web 전체 (특히 모임 상세 진입 ~5초 지연)
초점: 렌더링/체감 속도 (기능 결함 아님)

> 독립 교차 검증 완료: `layout.tsx:45/56`(직렬 가드), `page.tsx:59/83`(2-웨이브), `grep Suspense`=0, 라우트 세그먼트 설정 0개, Railway 이관 커밋 `6d1e5d4`, `render.yaml plan:free`=legacy — 모두 실제 코드/설정과 일치 확인.

---

## 1. 핵심 요약 (TL;DR)

- **가장 큰 레버 (단일 최우선): SSR 직렬 백엔드 워터폴 축소 + Suspense 스트리밍 도입.** 모임 상세는 첫 바이트 전에 **4개의 직렬 백엔드 왕복 웨이브**가 순차 실행되고, 앱 전체에 `<Suspense>`가 **0개**라 전체 HTML이 가장 깊은 fetch에 블록된다. 이 둘이 warm 상태 지연의 지배 요인이다.
- **콜드 스타트는 이제 근인이 아니다 (RED HERRING).** 백엔드는 2026-07-13 Render → Railway로 이관되어 **상시 기동(콜드 스타트 없음, warm API ~0.23s 실측)**. `render.yaml`의 `plan: free # 콜드스타트 ~50s`는 **stale legacy 파일**이며 라이브 인프라가 아니다. 과거 ~15-50s 무한스피너의 근인이었으나 현재는 해당 없음.
- **리전 불일치도 근인이 아니다 (RED HERRING).** SSR↔백엔드는 이미 인트라-싱가포르 정렬(`vercel.json regions:["sin1"]` + Railway Singapore). 가상 교차리전을 얹어도 순수 네트워크 추가분은 ~0.68-0.8s로 5s의 13-16%에 불과. **유일한 잔여 지리 리스크는 Supabase 프로젝트 리전 미확인** (대시보드 1회 확인 필요).
- **제로 캐시가 반복 진입을 느리게 만든다.** 모든 authed fetch가 `no-store`(api-client가 `cache`/`next` init 미전달)라 **100% 캐시 미스**. 같은 모임을 두 번 들어가도 매번 콜드 SSR을 반복하고, prefetch도 dynamic authed 라우트라 무효(staleTime 0)다.
- **무거운 클라이언트 섬(polls 24KB/members 18KB)은 렌더가 아니라 TTI(상호작용) 문제.** 첫 페인트는 SSR HTML로 이미 끝났고 하이드레이션은 그 뒤에 돌기 때문에 **체감 렌더 속도를 개선하려면 이걸 건드려선 안 된다.** 다만 별개의 실 이슈(실시간 채널 teardown race)는 존재.

**결론:** 지배 트리오는 (1) SSR 직렬 워터폴, (2) Suspense 스트리밍 부재, (3) 제로 캐시다. 콜드 스타트/리전은 이미 해결됐거나 기여도가 미미하다.

---

## 2. 왜 느린가: 근본 원인 분석 (영향도 순위)

> **Cold vs Warm 구분 (중요):** Railway 상시 기동이므로 **반복 진입(warm)이 지배 시나리오**다. 아래 원인은 대부분 warm 경로에서도 재현되며, 이것이 5s가 콜드 스타트로 설명되지 않는 핵심 근거다.

### 🔴 원인 1 (Critical) — SSR 직렬 백엔드 워터폴: 4개 웨이브가 순차 실행

**무엇:** 모임 상세는 첫 HTML 반환 전에 4개의 백엔드 왕복이 **직렬로** 실행된다. 각 await가 이전 await 완료를 기다린다.

- 웨이브 1: layout `requireNamedSession()` → `GET /me`
  - 근거: `apps/web/app/(main)/layout.tsx:45`, `require-named-session.ts:63 api.getMe()`
- 웨이브 2: layout `getUnreadCount()` → `GET /notifications/unread-count` (웨이브 1 **이후** 순차 await, 병렬 아님)
  - 근거: `apps/web/app/(main)/layout.tsx:56`, `lib/notifications/api.ts:63`
- 웨이브 3: page `Promise.all([getMoim, getMoimMembers])` (2콜 병렬 = 1 RTT)
  - 근거: `apps/web/app/(main)/home/[id]/page.tsx:59`
- 웨이브 4: page `Promise.allSettled([listPolls, getSchedule])` (2콜 병렬 = 1 RTT)
  - 근거: `page.tsx:83`, `lib/moim/polls.ts:41`, `lib/schedule/api.ts:58`

**회피 가능성 (검증됨):** 웨이브 4는 웨이브 3에 **의존하지 않는다.** `listPolls`/`getSchedule`는 인자가 `(api, moimId)`뿐이고 `moimId`는 params(`page.tsx:45`)에서 온다 — moim/members 산출값을 소비하지 않는다. 백엔드 인가도 `getMoim`이 통과한 `assertMember`와 동일 게이트. 즉 웨이브 3+4는 단일 `Promise.allSettled`로 병합 가능 → 페이지 2파→1파.

**추정 지연 기여 (warm, intra-Singapore):** 콜당 RTT<10ms + 핸들러 + DB ≈ 100-400ms(문서 컨텍스트상 warm API ~0.23s 실측, `tech.md:99`). **4 직렬 웨이브 = 이 지연의 4배 승수.** 이 승수가 per-call 지연을 5s급으로 증폭하는 실제 메커니즘이다. (추정치이며 warm-RTT 절감 상한 기준.)

**적용 범위:** 워터폴 자체는 상세 페이지가 최악. 웨이브 1+2(layout 배리어)는 **모든 (main) 라우트에 앱-와이드 적용**(home, explore, profile, notifications).

---

### 🔴 원인 2 (Critical) — 제로 캐시: 모든 authed fetch가 no-store, 반복 진입도 매번 콜드 SSR

**무엇:** 공유 api-client가 fetch에 `cache`/`next` 옵션을 **전혀 전달하지 않는다.** Authorization: Bearer 헤더 + `cookies()` 사용으로 Next 16이 모든 데이터 fetch를 dynamic no-store로 처리한다. → **100% 캐시 미스, 매 진입마다 전체 백엔드 비용 반복.**

- 근거: `packages/api-client/src/index.ts:181` `fetchImpl(url, {...init, method, headers, signal})` — cache/next 없음
- `app/`·`lib/` 전역에 `export const revalidate|dynamic|fetchCache` 없음 (grep empty)
- 유일한 재사용: `require-named-session.ts:41`의 React `cache()` (렌더 패스 내 `GET /me` 1회 dedup — 이건 이미 작동 중)

**부작용:** `getMoimMembers`는 상세/schedule/expenses 페이지에서 같은 moim에 대해 **각각 독립 재페치**. `getUnreadCount`는 모든 (main) 내비게이션마다 재페치.

**추정 지연 기여:** 반복 진입 시 warm 캐시였다면 0 RTT가 될 안정적 메타데이터(moim/members)가 매번 풀 백엔드 왕복. prefetch도 이 때문에 무효화된다(원인 5 참조).

**적용 범위:** 앱-와이드.

---

### 🟠 원인 3 (High) — Suspense 스트리밍 부재: 전체 HTML이 최심 fetch에 블록

**무엇:** `grep -rn Suspense apps/web/app apps/web/lib` → **매치 0.** 모든 서버 컴포넌트가 모든 데이터를 await한 뒤에야 JSX를 반환하므로 Next.js가 셸/헤더를 먼저 flush할 수 없다. 사용자는 `loading.tsx` 스켈레톤을 **전체 직렬 시간 내내** 응시한다.

- 근거: 상세 페이지가 헤더를 `moim.name`(`page.tsx:115`)에서 렌더하지만 같은 컴포넌트가 `:83`에서 polls/schedule를 await한 뒤 `:103`에서 반환
- `loading.tsx`는 12개 라우트 중 4개만 존재 — 라우트-전환 스켈레톤일 뿐 **페이지 내 섹션 스트리밍이 아님**

**추정 지연 기여:** 스트리밍이 있으면 첫 의미있는 페인트(헤더/셸)가 `max(all-waves)` → `guard+header 웨이브`로 단축. **상세 페이지 체감 지연 최대 개선 레버.**

**적용 범위:** 앱-와이드.

---

### 🟠 원인 4 (High) — (main) layout 이중 배리어: 모든 (main) 페이지가 GET /me + unread-count 프리픽스 부담

**무엇:** `MainLayout`이 `requireNamedSession()`(getSession → `GET /me`)을 완료 대기한 **뒤** `getUnreadCount()`를 시작한다. 두 콜은 독립적(둘 다 session token만 필요)인데 순차다. Next.js는 layout 데이터를 페이지 렌더 전에 해석하므로 이 2-웨이브 가드가 **모든 (main) 라우트의 하드 프리픽스**. `explore`는 완전 정적 페이지인데도 순수 가드 오버헤드로 두 웨이브를 부담.

- 근거: `layout.tsx:45` `await requireNamedSession()` 이후 `:56` `await getUnreadCount(api)` (순차)

**추정 지연 기여:** getUnreadCount 왕복 1개(warm ~100-300ms 추정)를 병렬화로 제거 가능.

**적용 범위:** 앱-와이드((main) 4개 라우트).

---

### 🟡 원인 5 (Medium) — Prefetch 무효화 + dynamic 라우트가 라우터 캐시에 저장 안 됨

**무엇:** 홈 카드가 `<Link href={/home/${moim.id}}>`(기본 prefetch)로 링크하지만, 상세 라우트가 완전 dynamic(`cookies()` + no-store)이라 RSC 페이로드가 **positive staleTime으로 저장되지 않는다**(dynamic 라우트 staleTime ≈ 0). 클릭 시 여전히 콜드 풀 dynamic RSC fetch = 위 워터폴 재실행. **prefetch가 사실상 무효.**

- 근거: `app/(main)/home/HomeTab.tsx:50-51` (prefetch prop 없음), 라우트가 `require-named-session.ts` cookies() + no-store로 dynamic

**추정 지연 기여:** "클릭 시 콜드 SSR" 체감이 실재. 셸을 static/PPR-eligible로 만들면 prefetch가 셸을 워밍해 클릭이 즉시 렌더.

**적용 범위:** dynamic authed 라우트 전반.

---

### 🟡 원인 6 (Medium) — Supabase 프로젝트 리전 미확인 (유일한 잔여 지리 리스크)

**무엇:** DB 리전이 레포에 파라미터 플레이스홀더(`aws-0-YOUR_REGION.pooler.supabase.com`)로만 있고 `supabase/config.toml`은 주석 처리된 예시뿐. 실제 리전은 대시보드에만 존재해 소스로 확인 불가. **웹 핫패스는 GoTrue를 치지 않으므로**(로컬 디코드/검증) 영향은 백엔드→DB 홉 하나로 국한되고, 이미 warm ~0.23s 측정에 반영됐을 가능성이 높다.

- 근거: `apps/backend/.env.production.example:12`, `supabase/config.toml:397 # tenant_region = "us"`(주석), Supabase 호스트 `qzibltkabfiaaxjtvmbz.supabase.co`(`tech.md:219`)

**추정 지연 기여:** 만약 US 리전이면 4웨이브마다 숨은 크로스리전 DB hop(각 ~180-250ms 추정) → warm 지연 증가. Singapore(ap-southeast-1)면 ~0.

**적용 범위:** 백엔드 DB 접근 전반. **대시보드 1회 확인으로 blind spot 종료.**

---

### ⬜ 반증된 원인들 (조사했으나 근인 아님 — 여기에 시간 쓰지 말 것)

| 가설 | 판정 | 근거 |
|---|---|---|
| Vercel sin1 ↔ 백엔드 리전 불일치 | **refuted** | 이미 인트라-싱가포르 정렬(`vercel.json sin1` + Railway SG), warm 0.23s 실측. 가상 교차리전 얹어도 +0.68-0.8s(5s의 13-16%) |
| 백엔드 콜드 스타트(Render free sleep ~50s) | **refuted** | 2026-07-13 Railway 이관(`6d1e5d4`), 상시 기동. `render.yaml plan:free`는 stale legacy(`tech.md:193 [legacy/superseded]`), `keep-warm.yml` 제거됨 |
| 무거운 클라 섬 + 다중 실시간 채널이 렌더를 늦춤 | **refuted** | 첫 페인트는 SSR-driven, 하이드레이션/채널구독은 `useEffect`(post-paint). "다중 채널"도 과장 — singleton + topic dedupe로 **1 WebSocket / 2 topic join**(3-6 소켓 아님). 이건 TTI 문제, 렌더 문제 아님 |

---

## 3. 모임 상세가 특히 느린 이유

상세 페이지(`/home/[id]`)는 앱에서 **가장 깊은 직렬 체인**을 돈다:

```
[웨이브1] layout GET /me            ← 모든 (main) 공통 프리픽스
[웨이브2] layout GET /unread-count  ← 순차 (병렬화 가능)
[웨이브3] page  Promise.all([getMoim, getMoimMembers])
[웨이브4] page  Promise.allSettled([listPolls, getSchedule])  ← 웨이브3에 의존 안 함 (회피 가능 워터폴)
```

worked example (warm 기준):
1. **세션 체크:** `requireNamedSession`의 `getSession()`은 쿠키 로컬 디코드(0 RTT, 네트워크 없음). 하지만 바로 뒤 `api.getMe()`는 실제 `GET /me` 백엔드 왕복. layout+page 이중 호출은 React `cache()`로 dedup되어 **1회만** 실행(이미 최적화됨 — 회피할 이중 왕복 없음).
2. **백엔드 fan-out:** 위 4 웨이브. 다른 라우트(schedule/expenses)는 페이지 단일 배치(`Promise.all`)로 이미 잘 묶여 있어 총 2 웨이브인 반면, 상세만 **페이지 자체가 2 웨이브**(회피 가능한 웨이브 4 때문).
3. **교차리전 RTT:** 현재 인트라-싱가포르라 ~0 (과거 iad1↔SG 트랜스-퍼시픽 문제는 `regions:["sin1"]`로 해결됨).
4. **콜드 스타트:** Railway 이관으로 제거됨. warm ~0.23s/call.

**추가로 상세만 무거운 이유 (렌더가 아닌 TTI 축):**
- 항상 하이드레이션되는 무거운 클라 섬 2개: `polls-section.tsx`(24,430 bytes / 574 lines, `useActionState`+`useTransition`+lucide 11개+CreatePollForm 서브트리), `members-section.tsx`(18,942 bytes / 437 lines, ConfirmDialog+owner controls). **데이터가 비어도 무조건 shipping.** 비-owner가 owner 전용 UI(kick/transfer/max-edit) 코드까지 파싱/하이드레이션.
- 이건 **첫 페인트 이후** 상호작용 지연(TTI)을 늘릴 뿐 렌더 속도와 무관하다.

정리: 상세는 (a) 페이지 레벨 회피 가능 워터폴이 유일하게 존재하고, (b) 클라 섬이 가장 무겁고, (c) Suspense 부재의 손실이 가장 크다(스트리밍하면 헤더가 즉시 뜰 데이터가 가장 많음).

---

## 4. 업계 모범 사례 & 기업 사례

### 레이어 A — Next.js SSR / 스트리밍 (moyura에 가장 직접적)

| 기법 | 요지 | 출처 |
|---|---|---|
| **`<Suspense>` 섹션 스트리밍** | await-all-before-first-byte 대신 섹션별 Suspense. "streaming 없으면 TTFB = 가장 느린 쿼리, streaming하면 TTFB = 레이아웃/폴백 렌더 시간"(Next 공식). LCP 요소는 Suspense 밖 정적 셸에 둘 것 | https://nextjs.org/docs/app/guides/streaming |
| **`Promise.all`로 워터폴 제거** | 5개 직렬 200ms = 1000ms → 병렬 = 200ms. 독립 fetch는 동시 발사 | https://nextjs.org/docs/14/app/building-your-application/data-fetching/patterns |
| **Cache Components + `use cache` + PPR** | Next 16은 캐싱 opt-in. `cacheComponents:true`로 PPR 활성화 → 정적 셸은 빌드타임 프리렌더 후 엣지에서 즉시, dynamic 섹션만 origin 스트리밍 | https://nextjs.org/blog/next-16 |
| **Supabase `getClaims()` > `getUser()`** | `getUser()`는 Auth 서버 네트워크 콜(~0.5s), `getClaims()`는 WebCrypto 로컬 JWT 검증(캐시된 JWKS, 무네트워크). *(moyura는 이미 middleware `getClaims()` + `getSession()` 사용 — 이 antipattern 없음)* | https://supabase.com/docs/guides/auth/server-side/creating-a-client |
| **`loading.tsx`(전체) vs 명시적 `<Suspense>`(세분)** | 페이지 레벨 loading.tsx는 전체를 스켈레톤 뒤로 숨김(빠른-셸 기회 낭비). 세분 스트리밍엔 명시적 Suspense 권장 | https://nextjs.org/docs/app/guides/streaming |

### 레이어 B — 인프라 / 리전 / 콜드 스타트

| 기법 | 요지 | 출처 |
|---|---|---|
| **SSR 런타임 + 백엔드 + DB 리전 코로케이션** | Singapore-frontend가 US-backend 호출 시 매 콜당 트랜스-퍼시픽 RTT(~150-200ms). 엣지 프론트 + backend/DB는 한 리전에 pin. **Railway는 앱+Postgres를 동일 private network에 코로케이트** | https://docs.railway.com/platform/compare-to-vercel |
| **콜드 스타트 제거** | Render free는 ~15분 유휴 후 sleep, 30-60s 콜드 스타트가 SSR TTFB 전체에 얹힘. 유료 always-on이 정답, keep-alive ping은 임시방편 | https://blog.samkiel.dev/your-render-free-tier-is-not-broken-its-just-cold |
| **엣지 코로케이션 + subrequest 캐시** | Shopify Oxygen: V8-isolate 엣지 워커에 Storefront API 데이터 코로케이트, TTL + stale-while-revalidate | https://shopify.engineering/high-performance-hydrogen-powered-storefronts |

### 레이어 C — WebView / 네이티브 셸 (RN 셸 워밍)

| 기법 | 요지 / 실측 | 출처 |
|---|---|---|
| **네이티브 WebView 워밍업 + prerender pool** | 앱 실행 시 WebView 미리 생성 + 타겟 URL 조기 로드. **느린 10% open에서 ~2.5배 개선(~2s 절감)**. auth 쿠키 변경 시 DropAndFresh로 stale prerender 폐기 | https://medium.com/@timkabor/making-android-webview-2-5-faster-and-proving-it-with-data-827f035adfc6 |
| **iOS WKWebView warm pool** | 앱 실행 시 WKWebView pre-init(`prepare()` → `dequeue()`), **~40-45% 로드타임 감소**. `webViewWebContentProcessDidTerminate` 처리로 백그라운드 후 흰화면 방어 | https://github.com/bernikovich/WebViewWarmUper |
| **cover overlay + readiness signal + timeout** | WebView를 `opacity:0`로 숨기지 말 것(iOS가 occluded 판정 → JS 서스펜드). 별도 cover 오버레이를 fade, readiness 신호(`window.ReactNativeWebView.postMessage`)에 해제 + timeout 폴백 | 위 medium / Apple forums |
| **세션/쿠키 handoff** | 첫 SSR 요청이 이미 인증되도록 첫 내비게이션 **전** 세션 쿠키를 WebView 쿠키 스토어에 시딩(iOS WKHTTPCookieStore, `useWebKit=true`). *(moyura 기존 fix와 일치)* | https://dev.to/safaiyeh/react-native-authentication-with-webview-1nh |
| **단일 WebView 인스턴스 유지(unmount 금지)** | RN 내비게이션마다 unmount하면 Next.js 문서 풀 리로드+재-SSR+재-하이드레이션. 하나를 앱 생명주기 내내 유지, 웹 내부 소프트 내비게이션 | https://github.com/craftzdog/react-native-shared-webview |

### 레이어 D — 클라이언트 번들 / 하이드레이션 / 캐싱

| 기법 | 요지 / 실측 | 출처 / 기업 |
|---|---|---|
| **공격적 코드 스플리팅 + 번들 예산 CI** | 라우트+컴포넌트 스플리팅. **Pinterest 홈 JS 490KB→190KB(WAU +103% YoY)**; **Uber m.uber 50kB 코어, 2G에서 ~3s TTI** | Pinterest / Uber blog |
| **Cache-first app shell + service worker(Workbox)** | 서버 렌더 셸을 SW로 캐시, 반복 로드 즉시. Auth 앱은 셸/정적만 캐시(인증 HTML/유저 API는 금지, 로그아웃 시 클리어) | https://developer.chrome.com/docs/workbox/app-shell-model |
| **offline/local 번들 + file://** | **당근마켓(Karrot):** 각 SPA를 ZIP으로 백그라운드 다운로드 후 file://로 서빙 → "zero download time" 화면 전환. 단 file://는 origin 없어 일부 web API 불가 | https://maily.so/imblue/posts/mvpzlxgnzk9 |
| **WebView 에셋 요청 인터셉트** | **Myntra:** `shouldInterceptRequest`로 CSS/JS/폰트/이미지 로컬 서빙 → **느린 네트워크 로드 ~80% 개선, 에셋당 <10ms** | https://medium.com/myntra-engineering/leveraging-native-power-in-webview-105d248fe71 |
| **빌드타임 프리렌더(SSG/JAM) + 콘텐츠형 스켈레톤** | **토스(Toss):** LCP 요소 프리렌더로 **FCP→LCP 484ms→0ms**, 컴포넌트 레벨 Suspense, S3+CloudFront+Lambda@Edge | https://toss.tech/article/faster-initial-rendering |
| **SSR 서버 자체 최적화** | **토스:** Express→Node native http(~4-5pp CPU↓), 불필요 직렬화 제거, Yarn 업그레이드로 누적 **~20% CPU 감소** | https://toss.tech/article/ssr-server |
| **스트리밍 SSR + progressive hydration** | **Shopify Hydrogen:** React Suspense/RSC로 HTML 셸 스트리밍(빠른 TTFB), 컴포넌트별 데이터만 전송 | https://shopify.engineering/high-performance-hydrogen-powered-storefronts |
| **perf-critical 표면 네이티브화** | **Instagram:** WebView News 페이지를 네이티브로 전환해 공유 네트워크 스택/이미지 캐시 회수. **Airbnb Ghost Platform:** 네이티브 렌더 + 공유 GraphQL 백엔드 | Instagram / Airbnb eng |
| **배경 예측 prefetch** | **Instagram:** Explore/Stories/feed 미디어 네트워크-aware 프리페치, cache-first tray(+11% display-done) | https://instagram-engineering.com/improving-performance-with-background-data-prefetching-b191acb39898 |

---

## 5. 권장 개선안 (우선순위별)

> **moyura 특유의 재확인:** getClaims/getSession은 이미 최적(GoTrue 핫패스 왕복 없음), React cache() dedup 작동 중, 리전 정렬 완료, 콜드 스타트 제거됨. 아래는 **아직 열려 있는** 레버만 정렬했다.

### Tier 1 — Quick Wins (고효과/저난이도, 먼저)

| # | 조치 | 예상 효과 | 난이도 | 근거 (파일) |
|---|---|---|---|---|
| 1 | **페이지 웨이브 3+4 병합**: `Promise.allSettled([getMoim, getMoimMembers, listPolls, getSchedule])` 단일 파. moim/members는 must-succeed(404/403/throw 분기 유지), polls/schedule은 graceful-degrade. **콜별 status 개별 검사 필수** | 상세 페이지 −1 RTT (**warm ~100-400ms**, 추정) | 낮음 | `page.tsx:59, 83`; polls/schedule는 `(api,moimId)`만 소비 확인됨 |
| 2 | **layout 웨이브 1+2 병렬화**: getSession 직후 확보되는 token으로 `GET /me` 검증과 `getUnreadCount`를 `Promise.all` 동시 발사 | 모든 (main) 라우트 −1 RTT (**warm ~100-300ms**, 추정) | 중간 (requireNamedSession이 getSession 내부 소유 → 세션 노출 리팩터 필요) | `layout.tsx:45, 56` |
| 3 | **`<Suspense>` 스트리밍 도입**: 상세 페이지 헤더(`getMoim`)를 정적 셸에 두고 `MembersSection`/`PollsSection`/`ScheduleVoteBar`를 각각 Suspense+async 자식 서버 컴포넌트로. loading.tsx는 세분 스트리밍으로 대체 | 첫 의미있는 페인트 = `max(all-waves)` → `guard+header`. **체감 렌더 최대 개선** | 중간 | `grep Suspense` = 0매치; `page.tsx:108-176` |
| 4 | **읽기 전용 데이터 opt-in 캐싱**: `getMoim`/`getMoimMembers`/`listMoims`에 `next:{revalidate:15~30, tags:['moim-'+id]}` (또는 `use cache`), mutation 시 `revalidateTag`. polls/votes/unread는 no-store 유지. api-client에 next/cache passthrough 배선 필요 | 반복 진입 warm 히트 = **0 RTT**, 중복 members 페치 제거 | 중간 | `packages/api-client/src/index.ts:181` (현재 init 미전달) |
| 5 | **Supabase 리전 확인**: 대시보드 Settings→General에서 ap-southeast-1(Singapore) 여부 1회 확인 후 DEPLOY.md 기록 | US면 웨이브당 숨은 DB hop 제거 (**~180-250ms/wave**, 조건부); SG면 변화 없음(blind spot 종료) | 낮음 (인프라 확인, 코드 무변경) | `supabase/config.toml:397`, `.env.production.example:12` |

### Tier 2 — Larger Bets (고효과/중~고난이도)

| # | 조치 | 예상 효과 | 난이도 | 근거 |
|---|---|---|---|---|
| 6 | **PPR (Cache Components) 도입**: `cacheComponents:true`, 상세 셸+메타데이터+비개인화 데이터를 `use cache`로 → prefetch가 정적 셸을 워밍, 클릭 즉시 렌더 + dynamic 섹션만 스트리밍 | prefetch 실효화, "클릭 시 콜드 SSR" 체감 제거 | 높음 (Next 16 마이그레이션) | `next.config.ts` PPR 미설정; `HomeTab.tsx:50` prefetch 무효 |
| 7 | **집계 엔드포인트** `GET /moims/:id/detail`: moim+members+polls+schedule를 백엔드 1왕복으로 | 4웨이브 → 2웨이브(집계 후 셸+집계 1콜) | 높음 (백엔드 변경) | 4개 개별 콜 `page.tsx:59,83` |
| 8 | **WebView 워밍업 + cover handoff (모바일 셸)**: 앱 실행 시 단일 WebView 워밍 + Next 엔트리 URL 조기 로드, 세션 쿠키 시딩 후 DropAndFresh, cover 오버레이를 readiness 신호에 해제(timeout 폴백) | 느린 open ~2.5배(Android)/~40-45%(iOS) 개선(업계 실측), 흰화면/무한스피너 방어 | 높음 (네이티브) | SPEC-MOBILE-NAV-001 단일-WebView 수렴 중 |

### Tier 3 — TTI 개선 (렌더 아닌 상호작용 — 사용자 미보고 문제)

| # | 조치 | 예상 효과 | 난이도 | 근거 |
|---|---|---|---|---|
| 9 | **owner 전용/폼 UI lazy-load**: `CreatePollForm`, ConfirmDialog+owner controls를 `next/dynamic(ssr:false)`로. 읽기/투표/차단 경로는 eager | 하이드레이션/TTI 단축(비-owner가 안 쓰는 코드 미다운로드) | 중간 | `polls-section.tsx:301-523`, `members-section.tsx:62-112, 318-319` |
| 10 | **실시간 채널 teardown race 수정** (버그): polls/members가 공유 `moim:{id}` 채널을 각자 `removeChannel` → 먼저 unmount되는 쪽이 생존 구독자 채널을 strip. `useMoimChannel(moimId)` 단일 훅으로 통합 or ref-count | 내비게이션 후 "실시간 멈춤" 회귀 제거 (신뢰성) | 중간 | `usePollChannel.ts:45-47`, `useMemberChannel.ts:52-54`, `RealtimeClient.js:434-439` |

**우선순위 요약:** **1 → 3 → 4 → 2**가 warm 렌더 체감을 가장 크게 움직인다. 5는 저비용 확인이니 병행. 6~8은 근본 개선이나 투자 크다. 9~10은 사용자가 보고하지 않은 별개 축(TTI/신뢰성)이니 렌더 목표와 분리 관리.

---

## 6. 검증 방법 (before/after 실측)

### 🎯 가장 결정적인 단일 관측: 첫 vs 두 번째 진입 델타
같은 모임 상세를 **연속 2회** 진입해 소요 시간 측정.
- **둘 다 ~5s** → 콜드 스타트 완전 무관, warm 상태 SSR 아키텍처 문제 확정(원인 1~5가 지배). **이 리포트의 진단 검증됨.**
- **첫 진입만 느림** → Vercel 함수 콜드/RSC 캐시 워밍업 효과(Railway 백엔드 콜드 아님).

### 백엔드 warm 상태 확인
```bash
curl -w '\nTTFB: %{time_starttransfer}s  Total: %{time_total}s\n' -o /dev/null -s https://api.htyong.com/health
```
- ~0.2s면 백엔드 warm 확정(`tech.md:99` 실측과 일치). 첫 호출이 수 초면 Railway 대시보드 Settings에서 "sleep when inactive" 옵션 여부 1회 확인(무료 크레딧 소진 시 sleep — 유일한 잔여 콜드 리스크).

### SSR TTFB / 스트리밍 검증 (웹)
```bash
# 인증 쿠키 포함해 실제 상세 라우트 TTFB 측정
curl -w '\nTTFB: %{time_starttransfer}s  Total: %{time_total}s\n' -o /dev/null -s \
  -H 'Cookie: <supabase-auth-cookies>' https://<web-host>/home/<moimId>
```
- **TTFB가 크고 Total과 근접** → 스트리밍 안 됨(전체 HTML 블록). Suspense 도입 후 **TTFB↓ + Content Download 구간↑**이면 스트리밍 성공.
- 프록시/CDN 버퍼링 주의: nginx `X-Accel-Buffering: no`, gzip/brotli 청크 버퍼 확인.

### 리전 정합 회귀 감시
- 응답 헤더 `x-vercel-id` 관찰 → `icn1::iad1`(트랜스-퍼시픽 회귀) 아니라 `sin1` 계열인지. `vercel.json` 커밋 유지 + prod 모니터링에 스모크 체크.

### 캐시 효과 검증 (Tier1-#4 이후)
- Vercel 로그/응답 헤더에서 Data Cache HIT 여부. 반복 진입 시 백엔드 로그에 `getMoim`/`getMoimMembers` 재호출이 사라지는지 확인.

### 클라이언트 하이드레이션/TTI (Tier3용, 렌더와 분리 측정)
- Chrome DevTools Performance 패널: 같은 웹 빌드에서 long task/하이드레이션 비용, FCP↔TTI 갭.
- Next.js `useReportWebVitals`로 실기기 RUM(FCP/LCP/INP).
- 네이티브: WebView `onLoadStart`→`onLoadEnd`, cover-dismiss 신호 타임스탬프를 계측해 **네이티브 스핀업 vs 웹 문서/렌더 시간 분리**.
- WebView 채널 race: 상세 진입→다른 탭→복귀 반복 시 실시간 poll/member 업데이트가 유실되지 않는지.

### Supabase 리전
- 대시보드 Settings→General에서 리전 문자열 확인, ap-southeast-1(Singapore)이 아니면 4웨이브마다 숨은 크로스리전 DB hop 존재 → DEPLOY.md에 확정 리전 기록.

---

**최종 판단:** 사용자 체감 5s의 실제 근인은 **콜드 스타트도 리전도 아닌** (1) SSR 4-웨이브 직렬 워터폴, (2) Suspense 스트리밍 부재, (3) 제로 캐시의 복합이다. 가장 안전한 첫 수는 **페이지 웨이브 병합(Tier1-#1)** 과 **Suspense 스트리밍(Tier1-#3)** 이며, 이 둘만으로 상세 진입 체감이 유의미하게 개선된다. 반드시 **"첫 vs 두 번째 진입 델타"** 로 warm 문제임을 먼저 확정한 뒤 착수할 것.
