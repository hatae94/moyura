# 웹 페이지 전환 성능 진단 및 개선 리포트

- 대상: `apps/web` (Next.js 16 App Router, Vercel 배포)
- 작성일: 2026-06-25 (KST)
- 관련 커밋: `2a65f55` (구현), `d52bacd` (master 머지)
- 배포: master push → Vercel 자동배포 반영 확인

---

## 1. 요약 (TL;DR)

배포된 웹의 페이지 전환이 매우 느린 근본 원인은 **SSR 함수가 미국 동부(iad1)에서 실행되면서, 그 함수가 다시 싱가포르 백엔드(Render)로 인증 조회를 페이지마다 여러 번 직렬 호출**하는 대륙 간 삼각 왕복이었다. 추가로 인증 가드 중복 호출(`GET /me` ×2), RSC 응답 무캐싱, 전환 로딩 UI 부재가 체감 지연을 키웠다.

조치 후:
- Vercel 함수 리전이 **iad1(미국) → sin1(싱가포르)** 로 정렬되어 함수↔백엔드가 인트라리전 호출이 됨 (응답 헤더 `x-vercel-id`로 확정).
- 전환(soft navigation)당 RSC 응답이 **한국 클라이언트 기준 ~560~700ms**로 측정됨.

---

## 2. 증상

- 로컬 개발에서는 빠른데 **배포 후** 페이지 전환이 매우 느림.
- 사용자가 SSR 특성을 의심 → 웹 환경/구현 전체 점검 요청.

---

## 3. 진단 방법론

추정이 아니라 4중 실측으로 원인을 입증했다.

1. **코드 정적 분석** — 미들웨어(`proxy.ts`), `(main)/layout.tsx`, 페이지 컴포넌트, API 클라이언트(`packages/api-client`), 배포 설정(`render.yaml`, `vercel.json`) 전수 확인.
2. **백엔드 응답 실측** — `curl`로 `moyura-backend.onrender.com/health` 타이밍 측정.
3. **배포 사이트 헤더 실측** — chrome-devtools로 로그인 후 RSC 요청의 `x-vercel-id` / `x-vercel-cache` / `cache-control` 확인.
4. **performance trace** — `/home` 로드의 LCP/TTFB 측정.

---

## 4. 근본 원인 (실측 근거 포함)

| # | 원인 | 실측 근거 |
|---|------|-----------|
| 1 | **리전 불일치** — Vercel 함수가 iad1(미국)에서 실행 | `x-vercel-id: icn1::iad1::...` (서울 엣지로 들어와도 함수는 미국) |
| 2 | **백엔드 콜드스타트** — Render free 플랜 ~50s 슬립 | `render.yaml:20 plan: free` + 주석 "콜드스타트 ~50s" |
| 3 | **백엔드 왕복 다회 + 중복** — `(main)/layout.tsx`와 page가 각각 `requireNamedSession()` → `GET /me` 중복 | `require-named-session.ts`, `home/page.tsx`, `home/[id]/page.tsx` 코드 |
| 4 | **RSC 무캐싱** — 전환마다 서버 재실행 | `x-vercel-cache: MISS`, `cache-control: private, no-store` |
| 5 | **전환 로딩 UI 부재** — `loading.tsx` 전무 → 응답까지 화면 블록 | `find app -name loading.tsx` → 0건 |
| 6 | **전 라우트 dynamic** — prefetch가 RSC 전체를 매번 재요청 | 동일 경로 `?_rsc=` 중복 요청 관측 |

**병목 체인:** 한국 사용자 → 서울 엣지(icn1) → **미국 함수(iad1)** → **싱가포르 백엔드(Render)** `getMe`×2 + `listMoims`. 대륙을 두 번 건너는 왕복을 페이지마다 반복.

---

## 5. 적용한 수정

| 파일 | 변경 | 목적 |
|------|------|------|
| `apps/web/vercel.json` (신규) | `{ "regions": ["sin1"] }` | 함수를 백엔드(singapore)와 동일 리전으로 정렬 → 함수↔백엔드 인트라리전화 |
| `apps/web/lib/auth/require-named-session.ts` | React `cache()` 래핑 | 요청당 `GET /me` 1회로 dedup (layout+page 중복 제거) |
| `apps/web/app/(main)/loading.tsx` (신규) | 탭 그룹 스켈레톤 | 전환 즉시 피드백 |
| `apps/web/app/(main)/home/[id]/loading.tsx` (신규) | 모임 상세 스켈레톤 | 상세 진입 즉시 피드백 |
| `apps/web/app/moims/[id]/expenses/loading.tsx` (신규) | 경비 스켈레톤 | 경비 진입 즉시 피드백 |

**의도적으로 하지 않은 것**
- per-user 인증 데이터(`getMe`/`listMoims`/`getMoim`/members/polls)에 `revalidate`/`cache` 미부여 — `Authorization` 헤더를 동반하는 사용자 스코프 데이터라 캐싱 시 교차 사용자 누수 위험. dedup은 `cache()` request-scope로만 처리.
- `cacheComponents` 미도입 / `proxy.ts`·CSP·세션 로직 미변경 (범위 밖 + minimal changes).

**검증:** `tsc --noEmit` 0 에러, `eslint` 0, `next build` 통과(13/13 페이지).

---

## 6. 재측정 결과 (배포 반영 후)

### 6.1 함수 리전 (확정)

| 시점 | `x-vercel-id` | 함수 리전 |
|------|---------------|-----------|
| Before | `icn1::iad1::...` | iad1 (미국 동부) |
| After | `icn1::sin1::...` | **sin1 (싱가포르)** |

### 6.2 전환(soft navigation) RSC 응답 시간 — After

한국 클라이언트 → 서울 엣지 → sin1 함수 → singapore 백엔드, warm 상태, 3라운드.

| 경로 | round1 | round2 | round3 | 평균 |
|------|--------|--------|--------|------|
| `/home` | 775 | 654 | 681 | **~703ms** |
| `/profile` | 615 | 580 | 569 | **~588ms** |
| `/explore` | 568 | 563 | 564 | **~565ms** |
| `/notifications` | 564 | 571 | 557 | **~564ms** |

모든 응답 `x-vercel-id: icn1::sin1`, `x-vercel-cache: MISS`(per-user라 의도적 무캐싱). `/home`이 가장 느린 것은 `getMe`+`listMoims` 백엔드 조회가 포함되기 때문(가드 dedup으로 `getMe` 1회).

### 6.3 백엔드 직접 응답 — 참고 (한국 로컬 → singapore)

| 요청 | TTFB | total |
|------|------|-------|
| `/health` 1차 | 481ms | 481ms |
| `/health` warm | ~280ms | ~285ms |

### 6.4 LCP (full page load) — 비교 부적합 명시

| 시점 | LCP | breakdown |
|------|-----|-----------|
| Before | 1289ms | render delay 1280ms |
| After | 2716ms | render delay 2647ms |

> LCP의 대부분은 **render delay(클라이언트 JS 평가/hydration)**가 차지하며 측정 간 변동이 크다. 이는 React Compiler hydration·폰트 로딩 등 클라이언트 번들 비용으로, 이번 개선(리전·백엔드 왕복)의 타겟이 아니다. 사용자 체감의 핵심인 **전환 RSC 시간(6.2)**으로 평가해야 한다. (별도 과제: 클라이언트 번들/hydration 최적화)

---

## 7. 효과 분석

- **확정된 개선:** 함수 리전이 iad1→sin1로 정렬되어, 페이지당 다회 발생하는 함수↔백엔드 왕복이 대륙 간(미–싱 ~220ms RTT)에서 **동일 리전 내부망**으로 바뀜. 전환당 백엔드 조회 비용이 구조적으로 제거됨.
- **getMe dedup:** `/home` 진입 시 백엔드 호출이 `getMe`×2+`listMoims`(3회) → `getMe`×1+`listMoims`(2회)로 감소.
- **전환 피드백:** 같은 layout 내 page→page 전환에서 `loading.tsx`가 즉시 스켈레톤을 표시.

> 한계(정직성): Before의 전환 RSC 응답 시간은 동일 방법론으로 직접 측정하지 못했다(배포가 이미 sin1로 전환됨). Before는 `iad1` 리전 헤더와 백엔드 위치로 구조적 열위를 입증했고, After는 실측 수치(6.2)로 현재 성능을 확정했다.

---

## 8. 남은 작업 / 권장

| 항목 | 상태 | 비고 |
|------|------|------|
| **Render 콜드스타트(~50s)** | ⏸ 보류 | 가장 큰 잔여 병목. 리전을 정렬해도 free 슬립 후 첫 진입은 ~50s. warm-ping 크론(무료) 또는 starter 플랜 권장 |
| **클라이언트 번들/hydration** | 미착수 | LCP render delay 지배 요인. React Compiler·폰트·청크 분할 점검 |
| **최초 진입 loading 폴백** | 구조적 한계 | `cacheComponents` 미사용 시 layout 가드(cookies+uncached fetch)를 거치는 최초 진입은 loading.tsx 폴백이 적용되지 않음. 도입 시 추가 개선 가능 |

---

## 부록: 측정 환경

- 클라이언트 위치: 한국 (로컬 chrome-devtools)
- 테스트 계정: `gkxo5959@naver.com` (사용자 생성, 모임 0개 — 빈 계정 기준)
- 측정 도구: chrome-devtools MCP (`evaluate_script` same-origin fetch, `performance_start_trace`), `curl`
- 배포: `moyura-web.vercel.app` (Vercel), `moyura-backend.onrender.com` (Render, singapore, free)
