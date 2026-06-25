# WebView Native-Feel — 웹 측 성능 Baseline (개선 전)

- 대상: `apps/web` (Next.js 16 App Router, React 19 + React Compiler) — 배포본 `https://moyura-web.vercel.app`
- 작성일: 2026-06-25 (KST)
- 보강 측정일: **2026-06-25 (KST)** — 데이터 보유 계정(`gkxo5959@naver.com`) 확보 후 account-gated 항목 직접 실측 완료
- 목적: `SPEC-WEBVIEW-NATIVE-FEEL-001` 착수 **전 상태(before)** 확보. 개선 후 동일 프로토콜로 재측정하여 native-feel KPI를 before/after 정량 비교한다.
- 측정자: chrome-devtools MCP (데스크톱 Chrome, 한국 로컬)
- 재사용 프로토콜: `client-bundle-hydration-baseline.md` §0 (navigate + Performance API, 4x throttle, cold/warm, outlier 처리, 재측정 스니펫)

---

## 0. 핵심 요약 (TL;DR)

- **(보강 2026-06-25) account-gated KPI 4종을 실데이터 계정으로 직접 실측 완료.** `gkxo5959@naver.com`이 이제 모임 **1개("Qwe")** 를 보유(이전 baseline 시점엔 0개) — 데이터 상태가 바뀌었음을 명시.
- **/home 실데이터 콜드스타트**: 4x throttle에서 FCP 중앙 ~668ms · domInteractive ~774ms · **LCP 중앙 ~968ms** (range 948–1028). 빈 계정 인용치(LCP ~1044ms)와 **유사~소폭 빠름** — 모임 1개로는 리스트 렌더 부담이 거의 안 늘었다(카드 1장). First Load JS 158KB transfer / 519KB decoded / 10청크(supabase 지연 분리 정상).
- **탭↔탭 RSC 전환(실측)**: `/home` ~722ms · `/explore` ~553ms · `/notifications` ~539ms · `/profile` ~555ms. 기존 인용치(~560–700ms)와 **일치**, `/home` 최장 재확인. 전부 `icn1::sin1` MISS(per-user 무캐싱).
- **list→detail(`/home/[id]`) 신규 실측**: RSC 전환 중앙 **~1211ms**(탭 전환의 약 1.7배) — 상세는 백엔드 조회(멤버·일정·투표·경비)가 많고, 라우트 번들에 **supabase-js(236KB decoded)가 포함**된다(First Load JS **231KB transfer / 783KB decoded / 12청크** — `/home`보다 +264KB decoded). 상세 콜드 **LCP ~1708ms** / domInteractive ~1654ms — `/home`(LCP ~968)보다 현저히 무겁다. **상세가 native-feel 최대 잔여 병목.**
- **탭-탭 INP(실측)**: performance trace 기준 **INP 15ms**, click 이벤트 16ms, long task 0건, CLS 0.00 — 탭 탭 인터랙션 자체는 깨끗하다. 체감 전환 지연은 인터랙션 지연이 아니라 **RSC 네트워크 왕복(~553ms)** 이 지배한다(정직한 구분).
- **스크롤(실측)**: 상세 페이지가 스크롤 가능(305px 오버플로). 프로그래매틱 스크롤 중 **long task 0건**, 프레임 델타 ~16–17ms 일정(드롭 프레임 없음), CLS 0.00 — lab(4x, warm) 기준 **jank 없음**. 단 실 터치 모멘텀 스크롤 fps는 여전히 device-gated.
- **로그인(앱 셸) 콜드스타트(기존 실측 유지)**: 4x throttle에서 FCP ~268ms / LCP ~268–300ms / domInteractive ~224ms / CLS 0.05. 정적 로그인 UI라 LCP가 render-delay에 덜 지배 — `/home`의 native-feel 콜드스타트를 대체하지 못한다.
- **번들 측면 관측(유지)**: 로그인 라우트는 여전히 **supabase-js(237.6KB decoded)를 즉시 로드**(auth `signInWithPassword`가 supabase client 직접 import). 지연 로드 최적화(`8793916`)는 `/home`·`/explore` 등 realtime 미사용 인증 라우트에만 적용. **상세(`/home/[id]`)는 realtime 사용 라우트라 supabase가 다시 들어온다**(정상).
- 함수 리전 `icn1::sin1`(서울 엣지 → 싱가포르 함수) 유지 확인.

---

## 1. 측정 환경

| 항목 | 값 |
|------|-----|
| 측정일 | 2026-06-25 (KST) — 로그인 셸분 + **account-gated 보강분(실데이터 계정)** |
| 대상 URL | `https://moyura-web.vercel.app` |
| 배포 리전 | 함수 `sin1`(싱가포르), 엣지 `icn1`(서울). 응답 헤더 `x-vercel-id: icn1::sin1::...` 로 확정 |
| 클라이언트 | 한국 로컬, 데스크톱 Chrome (chrome-devtools MCP) |
| 측정 계정 (보강 실측분) | **`gkxo5959@naver.com` (이메일 로그인 성공)** — 모임 **1개** 보유. account-gated KPI(/home 실데이터·탭 전환·list→detail·INP·스크롤) 직접 실측 |
| 측정 계정 (로그인 셸분) | 비로그인 / 로그인 셸 — 정적 UI (인증 데이터 무관) |
| 인용분 계정 | `gkxo5959@naver.com` (인용 시점엔 모임 0개) — `client-bundle-hydration-baseline.md`·`web-page-transition-performance.md` 측정 시 사용 |
| 도구 | `navigate_page`, `evaluate_script`(Performance API), `emulate(cpuThrottlingRate:4)`, `performance_start_trace`(INP/CLS/long-task), 동일-origin `fetch(?_rsc=)`(RSC 전환 타이밍), Event Timing / LongTask Observer |
| 프로토콜 | navigate(reload) + Performance API. 각 조건 3회+ 반복, 첫 cold는 CDN/캐시 warm-up outlier로 제외, 중앙값·범위 보고 |

### 데이터 상태 기록 (LCP 영향 변수)

- **보강 실측분 (2026-06-25)**: `gkxo5959@naver.com` 계정 = 모임 **1개**("Qwe", 상세 `/home/8b85578e-c2d9-49ce-803d-0587fe25712f`, 2026-06-25 개설). 상세 페이지는 멤버 1명·투표 2개·경비/채팅 진입점 포함. **이전 baseline 인용 시점엔 이 계정이 모임 0개였으나, 현재는 1개로 데이터 상태가 변경됨** — `/home` LCP에 영향. 다만 카드 1장이라 빈 계정 대비 리스트 렌더 부담 증가는 미미.
- 로그인 셸분: 정적 UI라 인증 데이터에 무관.
- 인용분: 모임 **0개** 시점. 모임 수가 늘면 `/home` 리스트 렌더로 LCP가 더 늘 수 있다(상한 미측정).

---

## 2. KPI Baseline 표

> source 표기: **측정**=chrome-devtools 실측(로그인 셸분, 비로그인) / **측정 ²–⁵**=2026-06-25 데이터 계정(`gkxo5959`, 모임 1개) 로그인 후 보강 실측(각주에 조건 명시) / **인용**=기존 baseline 리포트 실측치 재인용(동일 프로토콜·배포). 4x throttle을 주 기준으로, 1x는 참고.

### 2.1 콜드스타트 (cold-start)

| 지표 | 라우트 | 4x 중앙값 (범위) | 1x 참고 | source |
|------|--------|------------------|---------|--------|
| FCP | `/login`(셸) | **~268ms** (252–276) | 252ms | 측정 |
| domInteractive (hydration proxy) | `/login`(셸) | **~224ms** (221–227) | 222ms | 측정 |
| domComplete | `/login`(셸) | **~273ms** (271–745*) | 268ms | 측정 |
| LCP | `/login`(셸) | **~268ms** (navigate) / 300ms (trace) | 252ms | 측정 |
| CLS | `/login`(셸) | **0.05** | — | 측정 (trace) |
| First Load JS (transfer) | `/login`(셸) | **222KB** | 222KB | 측정 |
| First Load JS (decoded, 파싱 대상) | `/login`(셸) | **757KB** | 757KB | 측정 |
| JS 청크 수 | `/login`(셸) | **11** | 11 | 측정 |
| — | | | | |
| FCP | `/home`(인증, 실데이터) | **~668ms** (648–708) | 644/788ms | **측정 ²** |
| domInteractive (hydration proxy) | `/home`(인증, 실데이터) | **~774ms** (751–842) | 754/849ms | **측정 ²** |
| domComplete | `/home`(인증, 실데이터) | **~774ms** (751–842) | 754/850ms | **측정 ²** |
| LCP | `/home`(인증, 실데이터) | **~968ms** (948–1028; warm-up cold 1116) | 944/1088ms | **측정 ²** |
| First Load JS (transfer) | `/home`(인증, 실데이터) | **158KB** | — | **측정 ²** (supabase 지연 분리 정상) |
| First Load JS (decoded) | `/home`(인증, 실데이터) | **519KB** | — | **측정 ²** |
| JS 청크 수 | `/home`(인증, 실데이터) | **10** | — | **측정 ²** |
| — | | | | |
| FCP | `/home/[id]`(상세, 실데이터) | **~700ms** (692–708; warm-up 740) | — | **측정 ²** |
| domInteractive (hydration proxy) | `/home/[id]`(상세) | **~1654ms** (1628–1679; warm-up 1406) | — | **측정 ²** |
| LCP | `/home/[id]`(상세) | **~1708ms** (1692–1724; warm-up 1456) | — | **측정 ²** |
| First Load JS (transfer) | `/home/[id]`(상세) | **231KB** | — | **측정 ²** (supabase 포함) |
| First Load JS (decoded) | `/home/[id]`(상세) | **783KB** | — | **측정 ²** (supabase-js 236KB 포함) |
| JS 청크 수 | `/home/[id]`(상세) | **12** | — | **측정 ²** |
| — | | | | |
| (참고) LCP | `/home`(인증, 빈 계정) | ~1044ms (1000–1112) | 968–1092ms | 인용¹ |

\* domComplete 745ms는 첫 cold(warm-up outlier) 1건(로그인 셸). 안정 구간 271–273ms.
¹ `client-bundle-hydration-baseline.md` §3·§6 (supabase-js 지연 로드 적용 후 master `eed11f5`, 빈 계정 상태).
² **측정완료 2026-06-25** — `gkxo5959@naver.com`(모임 1개) 로그인, 4x throttle, navigate(reload)+Performance API, 첫 cold(warm-up) outlier 제외 후 #2/#3/#4 중앙값·범위. 1x 참고치는 #1/#2 두 회. TTFB ~9–10ms(warm-document — §5 한계 참조).

**라우트별 번들 차이 (중요):**

| 라우트 | First Load JS decoded | 최대 청크 | supabase-js(~237KB) | 비고 |
|--------|----------------------|-----------|----------------------|------|
| `/login` (셸) | **757KB** | supabase-js 237.6KB | **즉시 로드** | auth가 supabase client 직접 import |
| `/home`·`/explore`·`/profile`·`/notifications` (인증) | **519KB** (측정 ²) | react-dom 222KB | async 분리(지연) | supabase 지연 로드 최적 적용 |
| `/home/[id]` (모임 상세, 인증) | **783KB** (측정 ²) | supabase-js 236KB | **포함** | realtime(채팅·투표·멤버) 사용 라우트라 supabase 재포함 — `/home` 대비 +264KB decoded |

→ 로그인 라우트는 최적화 미적용 경로. `/home`(519KB) native-feel 콜드스타트는 이제 실데이터 측정치(측정 ²)로 확정. **상세(`/home/[id]`)는 supabase 포함(783KB)이라 가장 무겁다** — 진단(상세가 supabase 64KB 로드)대로 realtime 의존이 상세 라우트 번들·LCP를 키운다.

### 2.2 라우트 전환 (soft-nav, RSC 응답)

탭↔탭 전환 RSC 응답 시간 — 한국 클라이언트 → 서울 엣지 → sin1 함수 → 싱가포르 백엔드, warm, 동일-origin `fetch(<route>?_rsc=…, {RSC:1})` 3라운드.

| 경로 | 중앙값 | 범위 | source |
|------|--------|------|--------|
| `/home` | **~722ms** | 703–757 | **측정 ³** |
| `/profile` | **~555ms** | 538–560 | **측정 ³** |
| `/explore` | **~553ms** | 544–558 | **측정 ³** |
| `/notifications` | **~539ms** | 537–584 | **측정 ³** |
| `/home → /home/[id]` (list→detail) | **~1211ms** | 1205–1570(warm-up) | **측정 ³** |

- `/home`이 탭 중 최장: `getMe`+`listMoims` 백엔드 조회 포함(가드 dedup으로 `getMe` 1회). 나머지 탭은 백엔드 조회 적어 더 빠름. **기존 인용치(~560–700ms)와 일치** 재확인.
- **list→detail(`/home/[id]`)이 탭 전환의 약 1.7배(~1211ms)** — 상세 RSC는 멤버·일정·투표·경비 등 조회가 많아 백엔드 왕복이 무겁다. RSC payload 18KB. 첫 회 1570ms는 warm-up outlier로 제외 시 ~1208ms.
- 전부 `x-vercel-cache: MISS`(per-user 무캐싱), 리전 `icn1::sin1` 재확인.
- ³ **측정완료 2026-06-25** — `gkxo5959@naver.com`(모임 1개) 로그인, 4x throttle, 동일-origin RSC fetch 3라운드 중앙값·범위. (참고: `web-page-transition-performance.md` §6.2 인용치와 정합.)

### 2.3 INP / 응답성

| 시나리오 | 4x 측정값 | 해석 | source |
|----------|-----------|------|--------|
| **인증 앱 탭 탭(tab→tab, /home→/explore)** | **INP 15ms** (trace), click 이벤트 16ms, long task 0건, CLS 0.00 | 탭 탭 인터랙션 자체는 깨끗하다(메인스레드 블로킹 없음). P75 200ms 목표 대비 큰 여유. **체감 전환 지연(~553ms)은 INP가 아니라 RSC 네트워크 왕복이 지배** | **측정 ⁴** |
| 로그인 폼 토글(버튼 클릭) | max event 56ms (processing 1ms, input delay 1ms), long task 0건 | presentation-delay 지배, 메인스레드 블로킹 거의 없음 | 측정 |

- 측정 방식: 탭 탭 INP는 `performance_start_trace`(reload:false, autoStop:false) 중 실제 탭 클릭 → INP/CLS/long-task 분석. 보조로 `PerformanceObserver({type:'event'/'longtask'})`도 설치(click 이벤트 16ms·long task 0 일치).
- 중요(정직성): 탭 탭 INP는 **15ms로 매우 낮다 — 인터랙션 응답성은 문제가 아니다.** native-feel에서 체감되는 탭 전환 지연의 본질은 인터랙션 지연이 아니라 **§2.2의 RSC 네트워크 왕복(~553ms, MISS·싱가포르 함수)** 이다. 개선 타깃을 INP가 아니라 전환 네트워크/프리페치로 잡아야 함.
- ⁴ **측정완료 2026-06-25** — `gkxo5959@naver.com`(모임 1개) 로그인, 4x throttle. CrUX field INP는 본 페이지 데이터 없음(n/a).

### 2.4 스크롤 (jank / long task)

| 항목 | 결과 | source |
|------|------|--------|
| 상세 페이지(`/home/[id]`) 스크롤 중 long task | **0건** | **측정 ⁵** |
| 스크롤 프레임 델타 | **~16–17ms 일정** (드롭 프레임 없음), CLS 0.00 | **측정 ⁵** |
| `/home`(모임 1개) 스크롤 | **N/A** | scrollHeight=viewportHeight(851) — 모임 카드 1장이라 오버플로 없음. 스크롤 불가 |

- 측정 대상: 모임 상세(`/home/[id]`)는 멤버·투표 2개·경비/채팅 진입점 포함으로 **스크롤 가능(305px 오버플로)**. 문서 자체 스크롤(내부 스크롤 컨테이너 없음).
- 측정 방식: `performance_start_trace`(reload:false) 중 `requestAnimationFrame` 기반 프로그래매틱 스크롤(아래로→위로 왕복) → long-task 인사이트·프레임 델타·CLS 확인. 보조 `PerformanceObserver({type:'longtask'})`로도 0건 재확인.
- 결과: lab(4x, warm)에서 **jank 없음** — 스크롤 핸들러/리페인트가 메인스레드를 막지 않는다.
- 한계(중요): 305px는 **짧은 오버플로**이고, `window.scrollTo` 프로그래매틱 스크롤은 터치 모멘텀 스크롤보다 가볍다. 즉 본 측정은 **스크롤-핸들러/리페인트 jank**까지만 검증 — 실 WebView **터치 모멘텀 스크롤 fps**는 여전히 device-gated(§3.2).
- ⁵ **측정완료 2026-06-25** — `gkxo5959@naver.com`(모임 1개) 로그인, 상세 페이지, 4x throttle.

---

## 3. 측정 불가 · gated 항목 (명시)

### 3.1 Account-gated (계정/데이터 접근 제약) — **해소: 2026-06-25 실측 완료**

배포본은 `/home`·`/explore`·`/profile`·`/notifications` 등 **모든 메인 라우트가 auth-gated**(비로그인 시 `/login` 리다이렉트). **2026-06-25 데이터 보유 계정(`gkxo5959@naver.com`, 이메일 로그인)을 확보하여 아래 account-gated KPI를 전부 직접 실측 완료**:

| KPI | 상태 | 결과 위치 |
|-----|------|-----------|
| `/home` 인증 콜드스타트(실데이터 LCP) | **측정완료 2026-06-25** | §2.1 (LCP ~968ms, 모임 1개) |
| 탭↔탭 RSC 전환 | **측정완료 2026-06-25** | §2.2 (722/553/539/555ms) |
| list→detail(`/home/[id]`) 전환 + 상세 콜드스타트 | **측정완료 2026-06-25** | §2.1·§2.2 (전환 ~1211ms, 상세 LCP ~1708ms) |
| 탭 탭 INP | **측정완료 2026-06-25** | §2.3 (INP 15ms) |
| 스크롤 long task / jank | **측정완료 2026-06-25** | §2.4 (상세, long task 0건) |

데이터 상태: 측정 계정은 모임 **1개**("Qwe"). 모임 0개 인용치 대비 `/home` LCP는 유사~소폭 빠름(카드 1장). **모임 수가 크게 늘면 `/home` LCP·스크롤 부담이 더 커질 수 있음**(상한은 미측정 — N개 데이터 계정 확보 시 후속).

#### (기록 보존) 직전 세션 로그인 실패 이력 — 보강 측정 전

직전 baseline 작성 세션에서는 데이터 계정 로그인이 막혀 위 항목을 인용치로 채웠다. 당시 실패 이력:

| 시도 | 결과 |
|------|------|
| `owner-test@moyura.dev / Owner1234!` (프로젝트 메모리) | `Invalid login credentials` — 로컬 Supabase 전용 계정, hosted 미존재 |
| 신규 이메일 가입 (`@moyura.dev`) | `Email address is invalid` — 도메인 거부 |
| 신규 이메일 가입 (`@gmail.com`) | 가입 성공하나 `Email not confirmed` — 인박스 접근 불가 |
| 기존 `gkxo5959@naver.com` | 비밀번호 미보유로 복귀 불가 |

→ 본 보강 세션에서 해당 계정 비밀번호(`Cndqnr26!`)를 확보, 이메일 로그인으로 해소함.

### 3.2 Device-gated (실기기 WebView 내부 — 데스크톱 chrome-devtools로 측정 불가)

| 지표 | 사유 |
|------|------|
| 실 on-device 콜드스타트(splash→첫 paint) | `react-native-webview` 내부 + 네이티브 셸 워밍업/스플래시 핸드오프는 실기기 전용. 4x throttle은 근사일 뿐 |
| 스크롤 fps / 부드러움 | WebView 렌더 파이프라인(`androidLayerType`, GPU 합성)은 실기기에서만 |
| 전환 smoothness(슬라이드 push/pop 체감) | View Transitions·스냅샷 플래시 제거 효과는 실 WebView 안에서만 체감 측정 가능 |
| INP P75 (field/CrUX) | 본 페이지 CrUX 데이터 없음(`n/a`). lab 측정만 가능 |

---

## 4. After 재측정 시 동일 재현 프로토콜

### 4.1 조건 고정

- 대상: `/home`(로그인, 데이터 상태 명시), 상세 `/home/[id]`(모임 상세), 셸 비교는 `/login`.
- 계정: `gkxo5959@naver.com` / `Cndqnr26!` — 이메일 로그인(`/login` → "이메일로 계속하기" → 폼). **재측정 시 모임 수를 동일(현재 1개)하게 유지**해야 `/home` LCP·스크롤 변수가 통제됨. 모임 수가 바뀌면 그 상태를 명시.
- CPU throttle: `emulate(cpuThrottlingRate: 4)` 주 기준, 1x 참고. 네트워크 throttle 없음(한국 고속망).
- 방식: 콜드스타트는 `navigate_page(reload)` + Performance API. **trace reload는 LCP 과대 측정** 경향(§5) — navigate 방식으로 통일. 탭/상세 전환은 동일-origin `fetch(?_rsc=)`. INP·스크롤은 `performance_start_trace(reload:false, autoStop:false)` 중 실제 인터랙션.
- 반복: 각 조건 3회+, 첫 cold(warm-up) outlier 제외, 중앙값·범위.

### 4.2 콜드스타트 재측정 스니펫 (navigate reload 직후 실행)

```js
() => {
  const r = {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  r.fcp = fcp ? Math.round(fcp.startTime) : null;
  const nav = performance.getEntriesByType('navigation')[0];
  r.domInteractive = Math.round(nav.domInteractive);
  r.domComplete = Math.round(nav.domComplete);
  r.ttfb = Math.round(nav.responseStart);
  const jsRes = performance.getEntriesByType('resource')
    .filter(x => x.name.includes('/_next/static/') && x.name.endsWith('.js'));
  r.jsTransferKB = Math.round(jsRes.reduce((a,x)=>a+(x.transferSize||0),0)/1024);
  r.jsDecodedKB  = Math.round(jsRes.reduce((a,x)=>a+(x.decodedBodySize||0),0)/1024);
  r.jsChunkCount = jsRes.length;
  return new Promise(res => {
    let lcp = null;
    try { new PerformanceObserver(l => { const e=l.getEntries(); lcp=e[e.length-1].startTime; })
      .observe({ type:'largest-contentful-paint', buffered:true }); } catch(e){}
    setTimeout(() => { r.lcp = lcp ? Math.round(lcp) : null; res(r); }, 700);
  });
}
```

### 4.3 INP / 인터랙션 재측정 스니펫 (클릭 전에 설치 → 인터랙션 → 800ms 후 수집)

```js
// 1) 인터랙션 전에 옵저버 설치
() => {
  window.__perf = { events: [], longtasks: [] };
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.events.push({
    name:e.name, duration:Math.round(e.duration),
    processingTime: Math.round((e.processingEnd||0)-(e.processingStart||0)),
    inputDelay: Math.round((e.processingStart||0)-e.startTime) }); })
    .observe({ type:'event', buffered:true, durationThreshold:16 });
  new PerformanceObserver(l => { for (const e of l.getEntries())
    window.__perf.longtasks.push({ duration:Math.round(e.duration) }); })
    .observe({ type:'longtask', buffered:true });
  return { installed:true };
}
// 2) click() 으로 탭/버튼 인터랙션 수행
// 3) 800ms 후 수집: max event duration, long task 수
() => new Promise(res => setTimeout(() => {
  const ev=window.__perf.events, lt=window.__perf.longtasks;
  res({ maxEventDuration: Math.max(0,...ev.map(e=>e.duration)),
        longtaskCount: lt.length, maxLongtask: Math.max(0,...lt.map(e=>e.duration)) });
}, 800));
```

### 4.4 탭/상세 전환(RSC) 재측정 스니펫 (로그인 상태에서 evaluate)

```js
async () => {
  // 탭: ['/home','/explore','/notifications','/profile'], 상세: '/home/<id>'
  const routes = ['/home', '/explore', '/notifications', '/profile'];
  const rounds = 3, rsc = Math.random().toString(36).slice(2,8), out = {};
  for (const route of routes) {
    out[route] = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const resp = await fetch(`${location.origin}${route}?_rsc=${rsc}${i}`,
        { headers: { 'RSC':'1', 'Next-Router-Prefetch':'0' }, cache:'no-store', credentials:'include' });
      await resp.text();
      out[route].push({ ms: Math.round(performance.now()-t0), status: resp.status,
        vercelId: resp.headers.get('x-vercel-id'), cache: resp.headers.get('x-vercel-cache') });
    }
  }
  return out;  // 첫 회 warm-up outlier 제외, 중앙값·범위. icn1::sin1 / MISS 기대
}
```

### 4.5 탭-탭 INP 재측정 (performance_start_trace 사용)

1. `/home`에서 `performance_start_trace(reload:false, autoStop:false)`
2. 탭(예: 탐색) 클릭 → 소프트 내비
3. `performance_stop_trace` → 요약의 `INP` / `INPBreakdown` / `CLS` 확인 (탭 탭 ~15ms 기대)
   - 보조: §4.3 옵저버 스니펫으로 click 이벤트·long task 0 교차 확인

### 4.6 스크롤 jank 재측정 (스크롤 가능한 상세 페이지에서)

```js
// performance_start_trace(reload:false) 시작 후 실행 → stop_trace 요약의 long-task/CLS 확인
() => new Promise(resolve => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  let y = 0; const step = 15, deltas = []; let last = performance.now();
  function tick() {
    const now = performance.now(); deltas.push(Math.round(now-last)); last = now;
    y += step; window.scrollTo(0, y <= max ? y : Math.max(0, 2*max - y));
    if (y < max*2) requestAnimationFrame(tick);
    else { window.scrollTo(0,0); resolve({ maxScroll:max, frameDeltas:deltas }); }
  }
  requestAnimationFrame(tick);  // 프레임 델타 ~16-17ms·long task 0 기대
});
```

> 주의: `/home`(모임 1개)은 오버플로 없어 스크롤 불가 → 스크롤은 **상세(`/home/[id]`)** 에서 측정. 모임이 많아져 `/home`이 스크롤 가능해지면 `/home`에서도 측정.

### 4.7 번들 / 리전 확인

- 라우트별 청크: `list_network_requests(resourceTypes:["script"])` + 위 스니펫 `jsDecodedKB`/`jsChunkCount`.
- 청크 시그니처(supabase 여부): decoded ~236–238KB 청크 존재 = supabase-js 동봉. **`/home`에는 없어야 정상**(지연 분리, 측정 ²), **상세 `/home/[id]`에는 있는 게 정상**(realtime 사용, 측정 ²).
- 리전: `fetch(url,{cache:'no-store'})` 후 `x-vercel-id`(`icn1::sin1` 기대), `x-vercel-cache`(per-user `MISS`).

---

## 5. 한계 · 변동성 경고

- **측정 변동성**: 기존 baseline 경고대로 `/home` LCP는 cold 1020–1412ms로 ±400ms 출렁임 → **단일 측정 비교 금지**, 중앙값·범위로 평가. 보강분도 동일 — `/home` LCP 948–1116(warm-up 포함), 상세 LCP 1456(warm-up)–1724.
- **warm-document 한계(보강분에도 적용)**: 보강 `/home`·상세 측정도 `ignoreCache:true`에도 TTFB ~9–10ms·청크 transferSize 캐시 제공 관측 = **warm-document** 측정이다. 특히 **1x 참고치가 4x와 거의 동일**(/home 1x LCP 944–1088 ≈ 4x LCP 948–1028)한 것이 그 증거 — 다운로드가 0이고 JS 평가도 캐시·JIT warm이라 CPU 스로틀 차이가 거의 안 드러난다. 진짜 네트워크 콜드(모바일 데이터·저사양)에서는 transfer(/home 158KB, 상세 231KB) 다운로드 + 파싱 비용이 추가된다.
- **trace vs navigate**: 동일 로그인 셸도 navigate LCP ~268ms vs trace LCP 300ms — trace 계측 오버헤드 포함. 콜드스타트 비교는 **navigate 방식으로 통일**(INP·스크롤·long-task만 trace 사용).
- **INP는 병목이 아니다(정직한 구분)**: 탭 탭 INP 15ms로 인터랙션 응답성은 깨끗하다. native-feel 탭 전환 체감 지연의 본질은 **RSC 네트워크 왕복(~553ms, MISS·싱가포르 함수)** 이며, list→detail은 더 무겁다(~1211ms). 개선은 INP가 아니라 전환 네트워크/프리페치/번들을 타깃해야 함.
- **상세(`/home/[id]`)가 최대 잔여 병목**: supabase-js 재포함(decoded 783KB, +264KB vs /home), LCP ~1708ms, 전환 ~1211ms. realtime 의존이 상세 라우트를 무겁게 한다 — after 개선 시 상세를 별도 KPI로 추적 권장.
- **데이터 상태 변경 주의**: 측정 계정이 모임 0개(인용 시점)→1개(보강 시점)로 바뀌었다. `/home` LCP는 카드 1장이라 거의 영향 없었으나, **모임 N개(수십+) 상한은 미측정**. after 재측정 시 동일 모임 수 유지 필수.
- **로그인 셸 ≠ /home 콜드스타트**: 로그인 UI는 정적이라 render-delay가 작다(LCP≈FCP). `/home`은 인증 대시보드 hydration으로 render-delay가 LCP의 대부분을 차지. **두 라우트를 같은 KPI로 비교 금지.**
- **백엔드 콜드스타트 별개 변수**: Render free 플랜 ~50s 슬립 후 첫 진입은 전환·`/home`·상세 수치를 크게 키운다(웹 native-feel 범위 밖, warm 상태 측정 기준).
- **정직성**: 본 리포트의 모든 "측정" 수치는 2026-06-25 chrome-devtools 실측(보강분은 `gkxo5959@naver.com` 로그인)이며, "인용" 수치는 동일 프로토콜로 측정된 기존 리포트에서 가져온 것이다. device-gated 항목은 추정치를 넣지 않고 §3.2에 명시했다.
