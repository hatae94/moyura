---
id: SPEC-WEB-STORYBOOK-001
version: 0.2.0
status: completed
created: 2026-07-22
updated: 2026-07-22
author: hatae
priority: medium
issue_number: 0
---

# SPEC-WEB-STORYBOOK-001 — apps/web 공용 UI 컴포넌트 카탈로그 (Storybook 도입)

## HISTORY

- 2026-07-22 (v0.2.0): **run-phase 완료 → status draft→completed.** `@storybook/react-vite`(SB 10.5.3) 배선 + 5 primitive(button/card/avatar/input/badge) + 5 colocate stories 구현. AUTO 게이트 전수 통과: `build-storybook` 성공(스토리 렌더 0에러, 산출물 CSS 에 `--primary`/`gradient-brand` 실 주입 확인) · `next build` 무회귀 · `eslint` clean. Tailwind v4 배선 = Vite postcss auto-load(폴백 `@tailwindcss/vite` 불요, CP-2 1차 통과). `@/` alias = `viteFinal` 배선(CP-3). CP-1 재확인(primitive 무 `next/*`) → react-vite 유지. 제약 준수: presentational 불변(next/supabase/bridge import 0) · 코어-only(a11y/test-runner/vitest 애드온 0) · globals.css 무변경 · `packages/design-tokens` 미생성(SD-1 연기) · 콜사이트 무이관(사용자 opt-out) · 하네스 무설치. 부수: `eslint.config.mjs` 에 `storybook-static/**` ignore 1줄(빌드 산출물 lint 제외), `.gitignore` `/storybook-static/`, nx `build-storybook` 타깃(SD-3). 디바이스 게이트 불요(web 빌드타임 SPEC).
- 2026-07-22 (v0.1.1): **SD-1 확정 — `packages/design-tokens` 패키지 연기(option B, 사용자 확정).** 본 SPEC 은 토큰 패키지를 만들지 않고, primitive 가 globals.css 시맨틱 토큰(`bg-primary` 등)을 Tailwind 유틸로 소비하는 것으로 "토큰 소비" 를 충족한다. 근거: (1) 단일출처(globals.css) 보존, (2) dual-source drift 회피, (3) 1차 SPEC 최소화, (4) RN 토큰-프로젝션은 RN 이 실제 착수될 때 후속 SPEC 으로 도입. 영향: M4/REQ-SB-005 는 "globals.css 토큰 소비 + design-tokens 패키지 비생성(후속 SPEC 이관)" 으로 확정, AC-SB-005 는 option B 만 바인딩(option A 는 본 SPEC 범위 밖), 델타 마커 `packages/design-tokens` 행은 [DEFERRED] 로 이동. SD-2/SD-3 무변경.
- 2026-07-22 (v0.1.0): 최초 작성 (draft, plan-phase). **근거: [research.md](./research.md)** — 사용자 소크라테스 인터뷰로 전 결정 확정(재론 없음)됨을 EARS/AC 로 인코딩. `apps/web` 에 흩어진 공용 UI(라우트 폴더 colocate, 공유 `components/` 부재 — `<button>` 21파일·`rounded-2xl` 103회·`rounded-full` 60회·`<input>` 28회·`gradient-brand` 25파일)를 **Storybook 문서 카탈로그**로 한곳에 시각화한다. **범위 = 컴포넌트 카탈로그/문서화**(전체 디자인시스템 추출·시각회귀테스트 아님 — 가장 가벼운 시작점 + 후속 확장 토대). **1차 배치 5 primitives**: Button/Card/Avatar/Input/Badge(반복 근거 기반). **위치 전략**: per-app 컴포넌트 홈(web=`apps/web/components/ui/`, 미래 RN=`apps/mobile/components/ui/`) + Storybook Composition(`refs`, 지금은 web ref 1개) + **디자인 토큰(값)만** 공유(구현 코드는 플랫폼별 — web `react-dom`+Tailwind vs RN primitives+`StyleSheet` 는 `react-native-web` 재작성 없이 공유 불가, research §1.4). **빌더 권장 = `@storybook/react-vite`**(5 primitive 는 `next/*` 미의존 → Next 16 프레임워크 지원 랙과 디커플링·경량; research §2). **툴링 = Storybook 코어만**(a11y/interaction/visual-test 애드온·새 테스트 러너 없음). **검증 = build/lint/storybook-build 정적 게이트**(web 무 테스트 하네스 — quality.yaml=tdd 이나 RED-GREEN 유닛 금지, research §7). **서브결정 SD-1(design-tokens 패키지)**: 최초 작성 시 미해결로 남겼고, v0.1.1(2026-07-22)에서 **연기(option B)**로 확정 — 토큰 패키지 비생성, globals.css 시맨틱 토큰 소비로 대체(RN 준비는 RN 착수 시 후속 SPEC).

---

## Background (배경)

`moyura` 모노레포(pnpm workspace + Nx)의 `apps/web`(Next.js 16.2.6 / React 19.2.4 / Tailwind CSS v4 CSS-first)는 **공유 `components/` 디렉터리가 없다**. 공용 UI 는 라우트 폴더에 colocate 되어(`app/(main)/_components/`, `app/login/login-form.tsx`, `app/moims/new/create-moim-form.tsx`, `app/(main)/home/[id]/*-section.tsx` …) 같은 시각 패턴이 파일마다 인라인 복제된다(코드 직접 확인 — research §1.3):

- `<button` 21파일, `gradient-brand` 25파일, `rounded-2xl` 103회(카드 표면), `rounded-full` 60회(아바타/필/아이콘버튼), `<input` 28회/10파일.

디자인 시스템의 실질 단일출처는 `apps/web/app/globals.css` 다 — `:root` 의 CSS 변수(`--primary:#ff5436`, `--radius:1rem`, 인스타 `--gradient-brand` 등) + `@theme inline` 으로 Tailwind v4 유틸(`bg-primary`/`rounded-2xl`/`bg-card`)로 노출 + 커스텀 `@utility`(`pt-page`/`bg-gradient-brand`/`content-auto-*`). 즉 흩어진 것은 **컴포넌트**이지 토큰이 아니다.

**현재의 한계 (이 SPEC 이 해소):** 어떤 공용 UI 가 존재하는지, 각 컴포넌트가 어떤 variant/state 를 갖는지 **한곳에서 볼 카탈로그가 없다**. 새 화면을 만들 때 기존 패턴을 재발견·재복제하게 되고, 디자인 일관성이 코드 리뷰에만 의존한다. 본 SPEC 은 가장 가벼운 시작점 — **Storybook 문서 카탈로그** — 로 핵심 primitive 5종을 variant/state 별로 문서화하고, 미래 RN 확장(Composition + 토큰 공유)의 아키텍처만 못박는다. 콜사이트 마이그레이션·시각회귀·RN Storybook 은 후속 SPEC 으로 분리한다.

---

## Goal (목표)

`apps/web/components/ui/` 에 반복 근거에서 도출한 5 canonical primitive(Button/Card/Avatar/Input/Badge)를 만들고, 각각 colocate `*.stories.tsx` 로 variant/state 를 문서화하며, `@storybook/react-vite` 빌더 + `.storybook/{main,preview}` 배선(실 디자인 시스템 `globals.css` import)으로 **`build-storybook` 이 성공하고 모든 스토리가 실제 디자인 시스템으로 렌더**되게 한다. web 앱 자체(`next build`/`eslint`)는 무회귀(기존 콜사이트 강제 이관 없음). 미래 root Storybook Composition(per-app 홈 + `refs` + 토큰-only 공유) 아키텍처는 **문서화만** 한다. 판정은 build/lint/storybook-build 정적 게이트 + 스토리 렌더로 한다(무 테스트 하네스).

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **전체 디자인시스템 추출 아님.** 모든 콜사이트를 primitive 로 리팩터링하거나 전 컴포넌트를 카탈로그화하지 않는다. 1차 배치는 **5 primitive 만**(Button/Card/Avatar/Input/Badge). 카탈로그/문서화가 목적이지 아키텍처 전면 재편이 아니다.
- **콜사이트 마이그레이션 아님(OUT — 후속 SPEC).** `<button>`/`<input>`/`rounded-2xl` 인라인 100+ 콜사이트를 새 primitive 로 교체하지 않는다. 단, primitive API 수용성 증명을 위한 **1~2개 콜사이트/ primitive 의 대표 마이그레이션은 OPTIONAL** 로 허용(게이트 아님).
- **시각회귀/인터랙션/a11y 테스트 도구 아님.** `@storybook/test-runner`·Chromatic·`@storybook/addon-a11y`·play function 인터랙션 러너·새 테스트 프레임워크를 도입하지 않는다. Storybook **코어만**.
- **RN Storybook·`apps/mobile/components/ui/` 구현 아님(OUT — 후속 SPEC).** 미래 RN(react-native Storybook builder)·모바일 primitive 는 구현하지 않는다. **아키텍처(목표 형태)만 문서화**한다.
- **root Composition 호스트 구현 아님.** `refs` 로 web+RN 을 합치는 root Storybook 을 실제로 세우지 않는다(지금 ref = web 1개). **설계만**.
- **`packages/design-tokens` 생성 아님(SD-1 연기 확정 — OUT, 후속 SPEC).** 별도 토큰 패키지를 만들지 않는다. primitive 는 globals.css 시맨틱 토큰(Tailwind 유틸)을 소비한다. CSS 변수를 못 읽는 RN 을 위한 토큰-프로젝션 패키지는 RN 이 실제 착수될 때 후속 SPEC 으로 도입한다(단일출처 보존 + drift 회피 + 1차 SPEC 최소화).
- **globals.css 디자인 시스템 변경 없음.** 토큰·유틸·그라데이션·색을 신규 생성/변경하지 않는다. primitive 는 **기존 토큰을 소비**만 한다(신규 값 발명 금지).
- **`next build`/런타임 동작 회귀 없음.** Storybook 추가는 web 앱 라우트 트리·번들·런타임을 바꾸지 않는다(빌드 타깃 분리).

---

## EARS Requirements

> 모듈 ≤5(M1~M5). 각 요구는 acceptance.md 의 AC 와 1:1(REQ-SB-00N ↔ AC-SB-00N). `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존 / `[DOC]` 문서화만(구현 없음).

### M1. Storybook 인프라 배선 (react-vite 빌더 + 실 디자인 시스템)

- **REQ-SB-001 (Ubiquitous)** `[NEW] apps/web/.storybook/main.ts` + `[MODIFY] apps/web/package.json`(+선택 `project.json`): The web app **shall** provide a Storybook workspace configured with the `@storybook/react-vite` builder (framework 필드 `'@storybook/react-vite'`), exposing a `build-storybook` script (및 dev `storybook` 스크립트). The tooling **shall** be Storybook **core only** — a11y / interaction test-runner / visual-regression / new test-framework 애드온을 포함하지 **않는다**(Unwanted). **[구현 중 확인]** 빌더 적합성(react-vite vs `@storybook/nextjs-vite`)은 어떤 primitive 도 `next/image`/`next/link`/`next/font`/`next/router` 를 요구하지 않음을 재확인하고, 요구가 생기면 `@storybook/nextjs-vite` 로 전환한다(research §2.2; plan §4 체크포인트와 이중 배치).

- **REQ-SB-002 (Ubiquitous)** `[NEW] apps/web/.storybook/preview.tsx`: The Storybook preview **shall** import `apps/web/app/globals.css` so that every story renders with the **actual** Tailwind v4 design system (`:root` 토큰·`@theme` 유틸·`@utility`·`gradient-brand`). The Storybook Vite build **shall** resolve the `@/*` path alias and process Tailwind v4 via the project `postcss.config.mjs`(`@tailwindcss/postcss`) — 이 배선이 실패하면 스토리가 스타일 없이 렌더된다(회귀 신호). **[구현 중 확인]** postcss auto-load 실패 시 `@tailwindcss/vite` 플러그인 폴백을 `viteFinal` 에서 적용(research §3.2).

### M2. UI Primitives (canonical, presentational)

- **REQ-SB-003 (Ubiquitous)** `[NEW] apps/web/components/ui/{button,card,avatar,input,badge}.tsx`: The web app **shall** provide five canonical presentational primitives whose props/variants are **derived from the observed repeated patterns**(반복 근거 — research §1.3), not invented: `Button`(예: variant primary/gradient·secondary·ghost·destructive, size, disabled/loading state), `Card`(surface `rounded-2xl`·padding·header/body slot), `Avatar`(`rounded-full`·size·fallback), `Input`(label·error/disabled state·`input-background` 토큰), `Badge`(pill variant·tone). Each primitive **shall** be presentational only — no data fetching, no network, no `next/*` framework dependency, no `supabase`/bridge import — so it renders standalone in Storybook. Primitives **shall** consume the existing design tokens via Tailwind utilities(`bg-primary`/`rounded-2xl`/`bg-card` 등) — 신규 토큰/색을 만들지 않는다(Unwanted).

### M3. Stories (variant/state 문서화, 실 디자인 시스템 렌더)

- **REQ-SB-004 (Event-driven)** `[NEW] apps/web/components/ui/{button,card,avatar,input,badge}.stories.tsx`: **WHEN** Storybook builds (`build-storybook`), each of the 5 primitives **shall** have a colocated `*.stories.tsx` that documents its variants/states(예: Button 의 각 variant·size·loading·disabled; Input 의 default·error·disabled; Badge 의 tone 별), and every story **shall** render without error against the design system imported in preview(REQ-SB-002). Stories **shall** use CSF(Component Story Format) with typed `Meta`/`StoryObj` — 새 러너나 play-function 인터랙션 테스트를 요구하지 않는다.

### M4. Design Tokens (서브결정 SD-1 — 연기 확정: globals.css 토큰 소비)

> **SD-1 확정(2026-07-22, v0.1.1): 연기(option B).** `packages/design-tokens` 패키지는 **본 SPEC 에서 만들지 않는다**. 아래 요구는 globals.css 시맨틱 토큰 소비를 바인딩 기준으로 한다. 별도 토큰 패키지(option A)는 본 SPEC 범위 밖이며, RN 이 실제 착수될 때 후속 SPEC 으로 도입한다.

- **REQ-SB-005 (Ubiquitous + Unwanted 혼합)** `[EXISTING] apps/web/app/globals.css`(무변경, 토큰 SoT) + `[EXISTING] apps/web/components/ui/*.tsx`(M2 primitive): The new primitives **shall** consume the existing **globals.css semantic design tokens** via Tailwind utilities(`bg-primary`/`bg-card`/`text-primary-foreground`/`rounded-2xl`/`bg-gradient-brand` 등) as the single source of truth for design values — thereby proving "token consumption" without a separate tokens package. The web app **shall NOT** create a `packages/design-tokens` module in this SPEC, and primitives **shall NOT** hardcode inline color/radius hex values that duplicate the tokens(Unwanted — dual-source drift 회피, 단일출처 globals.css 보존). The RN token-projection layer(CSS 변수를 못 읽는 RN `StyleSheet` 를 위한 값 추출)는 **deferred to a follow-up SPEC**, introduced when RN actually lands(research §5). globals.css **shall remain unchanged**(신규 토큰/색 발명 금지).

### M5. 회귀 보존 + Composition 목표 아키텍처(문서화만)

- **REQ-SB-006 (Ubiquitous, 회귀)** `[EXISTING] apps/web/app/**` + `[MODIFY] apps/web/package.json`(scripts 추가만): The additions **shall not** regress `apps/web` `next build` or `eslint`. Existing route-colocated components and `globals.css` **shall remain unchanged**(강제 콜사이트 이관 없음 — Non-Goal). The Storybook build target **shall** be separate from the Next build target(스토리북 추가가 web 런타임/번들에 영향 0). New async 코드(있다면) **shall** include error handling(전역 사용자 규칙).

- **REQ-SB-007 (Ubiquitous, 문서화만)** `[DOC] spec.md/plan.md`: The SPEC **shall** document the target root Storybook **Composition** architecture — per-app 컴포넌트 홈(web=`apps/web/components/ui/`, 미래 RN=`apps/mobile/components/ui/`) + `refs` 로 web(현재 1개)·미래 RN 을 합침 + **토큰-only 공유**(구현은 플랫폼별, research §1.4/§6) — **without implementing** the RN Storybook or the root Composition host(design-only, 구현 범위 밖).

---

## 델타 마커 (변경 분류)

| 마커 | 대상 | 내용 | 모듈 |
|------|------|------|------|
| `[NEW]` | `apps/web/.storybook/main.ts` | react-vite 빌더 framework 설정 + stories glob + `viteFinal`(`@/*` alias, 필요 시 tailwind vite 폴백) | M1 |
| `[NEW]` | `apps/web/.storybook/preview.tsx` | `import "../app/globals.css"` (실 디자인 시스템) + 기본 parameters | M1 |
| `[MODIFY]` | `apps/web/package.json` | devDeps(`storybook`, `@storybook/react-vite`, `@storybook/react`, `@vitejs/plugin-react`, `vite`) + scripts(`storybook`, `build-storybook`) | M1 |
| `[MODIFY]` | `apps/web/project.json`(선택) | nx `build-storybook` 타깃(캐시) 추가 — nx run-many 통합용(선택) | M1 |
| `[NEW]` | `apps/web/components/ui/{button,card,avatar,input,badge}.tsx` | 5 canonical primitive(반복 근거 도출, presentational, 토큰 소비) | M2 |
| `[NEW]` | `apps/web/components/ui/{button,card,avatar,input,badge}.stories.tsx` | primitive 별 variant/state 스토리(CSF) | M3 |
| `[DEFERRED]` | `packages/design-tokens/**` | **SD-1=연기 확정** — 본 SPEC 비생성, 후속 SPEC(RN 착수 시). 대신 primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸) 소비 | M4 |
| `[EXISTING]` | `apps/web/app/globals.css` | 무변경 — 토큰 소비원(preview import) | M1/M2 |
| `[EXISTING]` | `apps/web/app/**` 기존 컴포넌트 | 무변경 — 강제 이관 없음(대표 1~2개 OPTIONAL) | M5 |
| `[DOC]` | Composition 목표 아키텍처 | RN Storybook·root 호스트 문서화만(구현 0) | M5 |

---

## 설계 노트

- **흩어진 것은 컴포넌트, 토큰이 아니다.** globals.css `@theme` 가 이미 토큰 SoT 라서, primitive 를 Tailwind 유틸로 스타일링하면 별도 토큰 패키지 없이도 "토큰 소비" 가 성립한다(research §1.2). **이것이 SD-1 을 "연기(option B)" 로 확정한 이유다**(2026-07-22 v0.1.1) — web 만 보면 토큰 패키지가 불필요하고, 유일한 신규 소비자(CSS 변수를 못 읽는 RN)는 RN 이 실제 착수될 때 생기므로, 그때 후속 SPEC 으로 토큰-프로젝션을 도입한다. 지금 패키지를 만들면 globals.css 와 dual-source drift 만 남는다.
- **왜 react-vite 인가.** 5 primitive 는 순수 presentational 이고 `next/*` 를 안 쓴다(research §1.3 확인). Next 16 은 매우 신규라 `@storybook/nextjs(-vite)` 의 프레임워크 지원이 뒤따르지 않을 위험이 있다(docs 는 Next ≥14.1 만 명시). react-vite 는 이 랙과 디커플링되고, Vite 가 web 의 `postcss.config.mjs` 를 auto-load 해 Tailwind v4 가 그대로 동작한다. next 기능이 필요해지면 `@storybook/nextjs-vite` 로 전환(에스컴 해치).
- **토큰-only 공유 + Composition 의 근거.** web(react-dom+Tailwind className) 과 RN(primitives+StyleSheet, nativewind 없음) 은 구현 코드를 직접 공유할 수 없다 — 진짜 공유엔 `react-native-web` + 웹 재작성이 필요(고비용, 기각). 그래서 **값(토큰)만 공유하고 구현은 플랫폼별로 두되, Storybook Composition(`refs`)으로 하나의 카탈로그로 합친다**(research §1.4/§6). 지금은 web ref 1개, RN 은 미래.
- **presentational 불변.** primitive 가 supabase/bridge/네트워크/`next/*` 를 import 하면 Storybook 에서 standalone 렌더가 깨진다. 그래서 5 primitive 는 순수 표시 컴포넌트로 강제한다(REQ-SB-003) — 데이터는 콜사이트가 props 로 주입.
- **무 하네스 정직성.** web 은 테스트 러너가 없고 사용자가 web SPEC 에 하네스 도입을 반복 거부했다(프로젝트 메모리). 그래서 검증은 `build-storybook`(스토리 렌더 성공) + `next build`(무회귀) + `eslint`(clean) 정적 게이트로 한다. 이 SPEC 의 산출물은 본질적으로 카탈로그/문서라 유닛 테스트보다 빌드-렌더 검증이 자연스럽다(quality.yaml=tdd 와의 정합은 plan §4).

---

## 리스크

| 리스크 | 심각도 | 내용 · 대응 |
|--------|--------|-------------|
| **Tailwind v4 + Storybook(Vite) 배선 미검증** | Medium | Storybook 공식 Tailwind recipe 는 v3 기준(v4/`@tailwindcss/postcss` 미명시 — research §4). **대응**: web 이 이미 프로덕션에서 `@tailwindcss/postcss`+CSS-first 사용 + Vite postcss auto-load 메커니즘에 근거; 실패 시 `@tailwindcss/vite` 플러그인 폴백(REQ-SB-002 구현 중 확인). 최종 확정 = `build-storybook`+스토리 렌더 실측. |
| **`@/*` alias 미해석** | Medium | Storybook Vite 는 tsconfig paths 를 자동 해석 안 함 → `@/` import 시 빌드 실패. **대응**: `viteFinal` alias 배선(또는 `vite-tsconfig-paths`); primitive 를 self-contained 로 만들어 `@/` import 최소화. |
| **Next 16 + Storybook Next 프레임워크 지원 랙** | Medium | 만약 nextjs-vite 로 갔을 때 Next 16 미지원 가능(docs Next ≥14.1). **대응**: react-vite 권장으로 디커플링(리스크 회피). |
| **design-tokens dual-source drift (SD-1)** | ~~Medium~~ 해소 | `packages/design-tokens` 를 지금 만들면 globals.css 와 값 이원화 → 단일출처 위반·drift. **해소: SD-1 을 연기(option B)로 확정**(2026-07-22 v0.1.1) — 본 SPEC 은 패키지를 만들지 않고 globals.css 시맨틱 토큰만 소비하므로 drift 0. RN 착수 시 후속 SPEC 에서 토큰-프로젝션 도입 시점에 재평가. |
| **scope creep — 콜사이트 이관 유혹** | Low | primitive 를 만들면 100+ 콜사이트를 "겸사겸사" 교체하고 싶어짐 → minimal-change 위반·회귀 위험. **대응**: Non-Goal 에 명시, 대표 1~2개만 OPTIONAL, 이관은 후속 SPEC. |
| **React 19 공식 명시 부재** | Low | Storybook docs 가 React 19 를 명시 호출 안 함(≥16.8 범위 내 — research §4). **대응**: `build-storybook` 성공으로 실증 판정. |

---

## Open Decisions / Sub-Decisions

| ID | 주제 | 상태 / 권장 | 영향 |
|----|------|-------------|------|
| **SD-1** | `packages/design-tokens` 지금 생성 vs 연기 | **RESOLVED (2026-07-22, v0.1.1) — 연기(option B) 확정(사용자).** 본 SPEC 은 토큰 패키지를 만들지 않고 primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸)을 소비한다. 근거: 단일출처(globals.css) 보존 + dual-source drift 회피 + 1차 SPEC 최소화 + RN 토큰-프로젝션은 RN 실제 착수 시 후속 SPEC. research §5. | M4/REQ-SB-005 = globals.css 토큰 소비(바인딩), design-tokens 패키지 후속 SPEC 이관. AC-SB-005 = option B 만 바인딩. |
| **SD-2** | 빌더 react-vite vs nextjs-vite | **권장 = react-vite(구현 중 재확인).** 5 primitive 가 `next/*` 미의존임을 구현 시 재확인; 요구 생기면 nextjs-vite. research §2.2. | 빌더 패키지·`.storybook/main.ts` framework 필드. |
| **SD-3** | nx `build-storybook` 타깃 추가 여부 | **권장 = 추가(선택).** `nx run-many -t build-storybook` 통합·캐시. 미추가 시 `pnpm --filter @moyura/web build-storybook` 직접 호출로 충분. | `apps/web/project.json` 1개 타깃. |

---

## 검증 게이트

> 무 테스트 하네스 — 전부 정적/빌드 게이트(유닛 러너 없음). 상세 커맨드·AC 매핑은 [acceptance.md](./acceptance.md).

- **AUTO 게이트**: `pnpm --filter @moyura/web build-storybook` 성공 + 5 primitive 스토리 전부 렌더 에러 0; `pnpm --filter @moyura/web build`(`next build`) 무회귀; `pnpm --filter @moyura/web lint`(eslint) clean; 5 primitive 파일 + 5 stories 파일 존재(정적); preview 가 `globals.css` import(정적); 툴링 코어-only(a11y/test-runner/visual 애드온 부재 — package.json 검사).
- **완료 정책**: 위 AUTO 게이트 통과 시 status draft→completed(디바이스 게이트 불요 — web 빌드 타임 SPEC, 모바일 WebView SPEC 아님). SD-1 = 연기 확정이므로 M4 는 globals.css 토큰 소비만(design-tokens 패키지 후속 SPEC).

---

## Sources (출처)

- [research.md](./research.md) — 본 SPEC 의 1차 근거(코드 직접 확인 + WebFetch 버전 검증). 빌더 결정 §2, Tailwind v4 배선 §3, 정직성 갭 §4, SD-1 §5, Composition §6.
- `.moai/specs/SPEC-WEB-VIEWPORT-001/spec.md`, `.moai/specs/SPEC-WEBVIEW-NATIVE-FEEL-001/{spec,acceptance}.md` — 프로젝트 SPEC 하우스 스타일 미러(frontmatter 8필드, HISTORY, Background/Goal/Non-Goals, EARS+[DELTA], 모듈 ≤5, AC 1:1, 검증 게이트).
- 외부(WebFetch 검증 — research §Sources 재수록): Storybook install/react-vite/nextjs/tailwind recipe, Tailwind CSS Next.js 가이드.
