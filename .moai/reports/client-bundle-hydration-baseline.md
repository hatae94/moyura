# 클라이언트 번들/Hydration 성능 — Baseline & 분석

- 대상: `apps/web` (Next.js 16 App Router, React 19 + React Compiler)
- 작성일: 2026-06-25 (KST)
- 목적: **개선 착수 전 baseline 확보**. 개선 후 동일 프로토콜로 재측정하여 before/after를 정량 비교한다.
- 측정 시점 코드: master `d88d051` (리전/dedup/loading 개선 반영 후, 번들 개선 전)

---

## 0. 측정 프로토콜 (after 재측정 시 반드시 동일하게)

측정 변동이 크므로(아래 §3 참고) 단일 측정은 신뢰하지 않는다. 다음 프로토콜을 고정한다.

- **대상 페이지**: `https://moyura-web.vercel.app/home` (로그인 상태, 빈 계정 = 모임 0개)
- **테스트 계정**: `gkxo5959@naver.com` (모임 0 — 데이터 변수 제거)
- **클라이언트 위치**: 한국 (로컬 chrome-devtools)
- **측정 방법**: `navigate_page(reload)` + Performance API(`evaluate_script`). performance trace의 reload는 trace 오버헤드로 LCP가 과대 측정되므로(아래 outlier 참고) **navigate 방식으로 통일**한다.
- **조건 매트릭스**: CPU throttle {1x 데스크톱, 4x 모바일WebView 근사} × 캐시 {cold=ignoreCache true, warm=false}
- **반복**: 각 조건 최소 3회, 첫 cold 1회는 CDN warm-up이므로 outlier 처리, 중앙값/범위로 보고
- **지표**: FCP, domInteractive(JS 평가 완료 근사), domComplete, LCP

> 재측정 evaluate 스니펫은 §부록에 보존.

---

## 1. 요약 (TL;DR)

- First Load JS는 **224KB(압축) / 760KB(decoded)** — 빈 `/home` 기준에도 이만큼 로드된다.
- 최대 청크 2개: **supabase-js 전체(realtime 포함) 240KB raw / 62KB gz**, **React-DOM 224KB raw / 69KB gz**.
- **supabase-js가 모든 페이지에 전역 로드**된다. 원인은 root layout의 `NativeBridgeProvider` → `bridge-client.ts` → `lib/supabase/client` import 체인. realtime은 채팅/멤버/투표/경비에만 필요한데 `/home`·`/explore`·`/notifications`에도 딸려온다.
- LCP 요소는 SSR 텍스트인데 **render delay가 LCP의 98%** — 네트워크가 아니라 **JS 파싱/평가(CPU)**가 페인트를 막는 구조.
- → 최대 최적화 기회: **supabase-js를 전역 번들에서 분리(지연 로드)**.

---

## 2. 번들 구성 (정적 분석)

빌드: `next build` (Next 16.2.6 Turbopack). 모든 라우트 `ƒ (Dynamic)`.

`.next/static/chunks` 총 **1.1MB raw**. 주요 청크:

| 청크 | raw | gzip | 내용(시그니처 식별) |
|------|-----|------|---------------------|
| `0d24832m2qz0s.js` | 237.6KB | 62.5KB | **@supabase/supabase-js** (GoTrueClient·RealtimeClient·supabase) |
| `0beour40jawbj.js` | 222.0KB | 69.3KB | **react-dom** (프레임워크) |
| `03~yq9q893hmn.js` | 110.0KB | 38.6KB | (앱/공유) |
| `0hq~u2-jdcpxv.js` | 107.2KB | 28.5KB | (앱/공유) |
| `04wskstb8a49d.js` | 53.4KB | 12.6KB | (앱/공유) |

실측 전송(`/home` cold): JS **224KB 압축 / 760KB decoded**, 13개 청크, 폰트 2개.

### supabase-js 전역 로드 체인 (핵심)

```
app/layout.tsx (모든 페이지 공통)
  └─ NativeBridgeProvider (client)            lib/native-bridge/NativeBridgeProvider.tsx
       └─ installNativeTokenBridge/...         lib/native-bridge/bridge-client.ts
            └─ import { createClient }         @/lib/supabase/client  ("use client")
                 └─ createBrowserClient        @supabase/ssr → @supabase/supabase-js (realtime 포함)
```

- `(main)` 레이아웃의 `ShellSessionAnnouncer`도 동일 `bridge-client` 경유로 supabase를 끌어온다.
- bridge는 네이티브 WebView 안에서만 실제 동작(`window.ReactNativeWebView` 가드)하고 일반 브라우저는 no-op이지만, **정적 import라 번들·파싱 비용은 모든 환경에서 발생**한다.

---

## 3. 런타임 Baseline (반복 측정)

방법: navigate reload + Performance API. 단위 ms.

### 3.1 4x throttle (모바일 WebView 근사) — 주 baseline

| 회차 | 캐시 | FCP | domInteractive | domComplete | LCP |
|------|------|-----|----------------|-------------|-----|
| #1 | cold | 1128 | 1125 | 1952 | 1412 | ← 첫 cold(CDN warm-up, outlier) |
| #2 | cold | 720 | 745 | 746 | 1020 |
| #3 | cold | 812 | 846 | 847 | 1112 |
| #4 | warm | 760 | 743 | 743 | 1060 |

**4x 대표값(중앙값, outlier 제외):** FCP ~810 · domInteractive ~745 · LCP ~1060ms

### 3.2 1x throttle (데스크톱) — 참고

| 회차 | 캐시 | FCP | domInteractive | domComplete | LCP |
|------|------|-----|----------------|-------------|-----|
| #1 | cold | 792 | 794 | 1295 | 1092 |
| #2 | warm | 652 | 665 | 665 | 968 |

### 3.3 측정 변동성 경고 (중요)

- 동일 조건에서도 LCP 1020~1412ms로 출렁임 → **단일 측정 비교 금지**.
- performance **trace** 방식 4x warm은 LCP 3660 / domInteractive 3324로 측정됨 — trace 계측 오버헤드가 섞인 **outlier**. navigate 방식(LCP 1060)이 실제에 가깝다. after 비교 시 동일 방식 필수.

---

## 4. 분석: render delay가 큰 이유

- LCP 요소 = SSR 텍스트(인사말/제목 SPAN). 네트워크 fetch 없음에도 **render delay가 LCP의 98%**.
- 즉 SSR HTML은 빨리 도착(TTFB ~70ms)하지만, **First Load JS(760KB decoded) 파싱·평가가 메인스레드를 점유**해 첫 페인트가 밀린다.
- warm(전송 7KB, 다운로드 0)에서도 4x domInteractive가 수백ms~1s대 → 병목은 네트워크가 아니라 **CPU(JS 평가)**.
- 그 760KB의 큰 비중이 **불필요하게 전역 로드되는 supabase-js(realtime 포함, decoded ~ 큰 청크)**.

---

## 5. 최적화 기회 (우선순위)

| # | 항목 | 기대 효과 | 리스크 |
|---|------|-----------|--------|
| 1 | **supabase-js 전역 제거 → 지연 로드** — `bridge-client.ts`의 `@/lib/supabase/client` 정적 import를 `await import()`로 전환(네이티브 셸에서 실제 필요 시점에만). `/home`·`/explore`·`/notifications` 등 realtime 미사용 경로에서 supabase-js(240KB) 제거 | First Load JS 대폭 감소, 모바일 hydration 시간 단축 | 네이티브 브리지/세션 핸드오버 타이밍 — WebView 회귀 테스트 필요 |
| 2 | realtime 미사용 페이지에서 supabase client 사용처 점검(폼/초대 등 GoTrue만 필요한 경우 realtime 미로딩 경로 검토) | 추가 절감 | supabase-js 단일 패키지라 부분 import 제약 |
| 3 | 폰트(Geist) LCP 영향 점검 — `next/font` display 전략(swap/optional) | FCP/LCP 소폭 | 낮음 |
| 4 | 큰 공유 청크(110/108KB) 내용 규명 후 코드 분할 | 중간 | 낮음 |

> React Compiler(`reactCompiler: true`)는 이미 활성으로 hydration 최적화에 기여 중. 추가 도입 항목 아님.

---

## 6. 다음 단계

1. (분석 완료) ← 현재 문서
2. 최적화 #1(supabase 지연 로드) 구현 — 사용자 승인 후
3. **동일 프로토콜(§0)로 after 측정** → 본 문서에 "After" 섹션 추가하여 before/after 비교

---

## 부록: 재측정 스니펫 (동일 조건 재현용)

CPU throttle은 chrome-devtools `emulate(cpuThrottlingRate: 4)`로 설정. 각 reload(`navigate_page(reload, ignoreCache)`) 후:

```js
() => {
  const r = {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  r.fcp = fcp ? Math.round(fcp.startTime) : null;
  const nav = performance.getEntriesByType('navigation')[0];
  r.domInteractive = Math.round(nav.domInteractive);
  r.domComplete = Math.round(nav.domComplete);
  r.jsTransferKB = Math.round(performance.getEntriesByType('resource')
    .filter(x => x.name.includes('/_next/static/') && x.name.endsWith('.js'))
    .reduce((a, x) => a + (x.transferSize || 0), 0) / 1024);
  return new Promise(res => {
    let lcp = null;
    try { new PerformanceObserver(l => { const e = l.getEntries(); lcp = e[e.length-1].startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
    setTimeout(() => { r.lcp = lcp ? Math.round(lcp) : null; res(r); }, 700);
  });
}
```

번들 정적 측정: `du -sh .next/static/chunks`, `ls -lS .next/static/chunks/*.js`, 청크 시그니처 `grep -c "GoTrueClient\|RealtimeClient" <chunk>`.
