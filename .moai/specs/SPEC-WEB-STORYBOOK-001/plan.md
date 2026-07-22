# Plan — SPEC-WEB-STORYBOOK-001 (apps/web 공용 UI Storybook 카탈로그)

> 리서치: [research.md](./research.md) | 요구/AC: [spec.md](./spec.md) · [acceptance.md](./acceptance.md)
> 원칙: minimal-change(요청 외 리팩터 금지), 기존 콜사이트 무이관, 새 토큰/색 발명 금지, async 도입 시 에러 핸들링. 코드/식별자 영어, 코드 주석 한국어(`code_comments: ko`).

## 1. 기술 접근

`apps/web` 에 **빌드 타깃이 분리된** Storybook(`@storybook/react-vite`)을 추가하고, 반복 근거에서 도출한 5 primitive 를 `apps/web/components/ui/` 에 신설, 각 primitive 에 colocate 스토리를 붙인다. preview 가 실 `globals.css` 를 import 해 스토리가 프로덕션과 동일한 Tailwind v4 디자인 시스템으로 렌더된다. web 앱 런타임/`next build` 는 무영향(Storybook 은 별도 타깃).

핵심 설계:
- **빌더 = `@storybook/react-vite`**(SD-2). 5 primitive 가 `next/*` 미의존이라 Next 16 프레임워크 지원 랙과 디커플링. Vite 가 web `postcss.config.mjs`(`@tailwindcss/postcss`) auto-load → Tailwind v4 그대로.
- **preview.tsx 가 디자인 시스템의 진입점**: `import "../app/globals.css"`. 이 한 줄이 `:root` 토큰 + `@theme` 유틸 + `@utility`(`gradient-brand`/`content-auto-*`)를 전부 스토리에 주입한다(load-bearing).
- **primitive = presentational only**: 데이터/네트워크/`next/*`/supabase/bridge import 0 → Storybook standalone 렌더 보장. 콜사이트가 props 로 데이터 주입.
- **토큰(SD-1 — 연기 확정)**: `packages/design-tokens` 패키지를 만들지 않는다(2026-07-22 v0.1.1 확정). primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸)을 소비한다. dual-source drift 회피 + 단일출처 보존. 아래 M4 참조.

## 2. 데이터 모델

해당 없음 — DB/스키마/API 변경 0. 순수 프론트엔드 카탈로그(컴포넌트 + 스토리 + 빌드 설정). 신규 런타임 상태·네트워크 없음.

## 3. 마일스톤 (file-by-file, Priority + depends, 시간 추정 없음)

### M1 — Storybook 인프라 배선 (Priority High) — REQ-SB-001/002

- **[MODIFY] `apps/web/package.json`**: devDeps 추가(`storybook`, `@storybook/react-vite`, `@storybook/react`, `@vitejs/plugin-react`, `vite` — 정확한 버전은 `npm create storybook@latest` 가 pin; Node 20+ 확인). scripts: `"storybook": "storybook dev -p 6006"`, `"build-storybook": "storybook build"`.
- **[NEW] `apps/web/.storybook/main.ts`**: `framework: { name: "@storybook/react-vite", options: {} }`, `stories: ["../components/ui/**/*.stories.@(tsx)"]`, `addons: []`(코어 only — a11y/test-runner/visual 없음). `viteFinal`: `@/*` → `apps/web` 루트 alias 배선(또는 `vite-tsconfig-paths`); postcss auto-load 실패 시 `@tailwindcss/vite` 플러그인 폴백(구현 중 확인).
- **[NEW] `apps/web/.storybook/preview.tsx`**: `import "../app/globals.css";` + 기본 `parameters`(layout `centered`, controls matchers). 다크 토글 없음(globals.css light 전용).
- **[MODIFY, 선택] `apps/web/project.json`**: nx `build-storybook` 타깃(캐시, `command: "storybook build", cwd: "apps/web"`) — SD-3. 미추가 시 pnpm filter 직접 호출.
- depends: 없음(선행 마일스톤).

### M2 — UI Primitives (Priority High, depends M1 배선) — REQ-SB-003

각 파일 presentational only, props/variants 는 반복 근거(research §1.3)에서 도출, Tailwind 유틸로 기존 토큰 소비:
- **[NEW] `apps/web/components/ui/button.tsx`**: variant(primary/gradient·secondary·ghost·destructive) × size × disabled/loading. `bg-gradient-brand`/`bg-primary`/`rounded-full`|`rounded-2xl` 등 기존 유틸. loading 시 async 핸들러 가정 없음(순수 표시 — onClick 은 콜사이트 소유).
- **[NEW] `apps/web/components/ui/card.tsx`**: surface(`rounded-2xl bg-card` + border/shadow), padding, header/body slot(children/`asChild` 없이 단순 slot props).
- **[NEW] `apps/web/components/ui/avatar.tsx`**: `rounded-full` size 스케일 + image + fallback(initial). image 로드 실패 fallback 은 순수 상태(네트워크 없음).
- **[NEW] `apps/web/components/ui/input.tsx`**: label + `input-background` 토큰 + error/disabled state. 순수 controlled/uncontrolled 표시(폼 로직은 콜사이트).
- **[NEW] `apps/web/components/ui/badge.tsx`**: pill(`rounded-full`) variant × tone(primary/muted/destructive/gradient).
- [HARD] 어떤 primitive 도 `supabase`/`@/lib/native-bridge`/`next/*`/네트워크 import 금지(REQ-SB-003 presentational 불변).

### M3 — Stories (Priority High, depends M2) — REQ-SB-004

- **[NEW] `apps/web/components/ui/button.stories.tsx`**: variant/size/loading/disabled 조합별 스토리(CSF `Meta`/`StoryObj`).
- **[NEW] `apps/web/components/ui/card.stories.tsx`**: 기본/헤더 있음/콘텐츠 밀도별.
- **[NEW] `apps/web/components/ui/avatar.stories.tsx`**: size별/이미지/이니셜 fallback.
- **[NEW] `apps/web/components/ui/input.stories.tsx`**: default/error/disabled/label.
- **[NEW] `apps/web/components/ui/badge.stories.tsx`**: tone별.
- 각 스토리는 preview 의 globals.css 로 실 디자인 시스템 렌더(REQ-SB-002 의존). play-function/인터랙션 테스트 없음.

### M4 — Design Tokens (Priority Medium, **SD-1 = 연기 확정**) — REQ-SB-005

> **SD-1 RESOLVED (2026-07-22, v0.1.1): 연기(option B).** `packages/design-tokens` 패키지를 **본 SPEC 에서 만들지 않는다**. run 단계에서 별도 사용자 확정 불요(이미 확정).

- **바인딩 기준**: primitive 가 globals.css 시맨틱 토큰(`bg-primary`/`bg-card`/`text-primary-foreground`/`rounded-2xl`/`bg-gradient-brand`)을 **Tailwind 유틸로 소비**하는 것으로 "토큰 소비" 를 충족한다(AC-SB-005 option B). 별도 값 파일/패키지 없음.
- **[EXISTING] `apps/web/app/globals.css`**: 무변경, 토큰 SoT. primitive 가 인라인 hex 색/radius 를 하드코딩하지 않도록 확인(토큰 유틸만 사용 — dual-source 방지).
- **[DEFERRED → 후속 SPEC] `packages/design-tokens`**: CSS 변수를 못 읽는 RN `StyleSheet` 를 위한 토큰-프로젝션(globals.css 값 추출 + 값→CSS 변수 생성 자동화)은 **RN 이 실제 착수될 때** 별도 SPEC 으로 도입. 본 SPEC 범위 밖.
- depends: M2.

### M5 — 회귀 게이트 + Composition 문서화 (Priority Medium) — REQ-SB-006/007

- **회귀(REQ-SB-006)**: `next build`·`eslint` 무회귀 확인(콜사이트 무변경, globals.css 무변경). Storybook devDeps 추가가 web 런타임/번들에 영향 0(빌드 타깃 분리) 확인.
- **[DOC] Composition 아키텍처(REQ-SB-007)**: spec.md/plan.md 에 목표 형태 문서화만 — per-app 홈(web=`components/ui/`, 미래 RN=`apps/mobile/components/ui/`) + root Storybook `refs`(현재 web 1개) + 토큰-only 공유. RN Storybook·root 호스트 **구현 없음**.
- **[OPTIONAL] 대표 콜사이트 1~2개/ primitive**: API 수용성 증명용(예: `login-form.tsx` 의 1개 button 을 `<Button>` 로 교체) — 게이트 아님, 하고 싶을 때만.
- depends: M2/M3.

## 4. 구현 단계 검증 체크포인트 (구현 중 확인 — spec 요구와 이중 배치)

> 사용자 "구현 과정에서 확인하여 진행" 관례(spec-conventions). 아래는 spec.md REQ 의 `[구현 중 확인]` + 잔여 서브결정(SD-2 빌더/SD-3 nx 타깃 — 구현 시 확정)과 1:1. **SD-1(토큰)은 이미 확정(연기)** 이라 확인 대상 아님.

- **CP-1 (빌더 SD-2, REQ-SB-001)**: primitive 착수 전, 5 primitive 중 어느 것도 `next/image`/`next/link`/`next/font`/`next/router` 를 요구하지 않음을 재확인. 요구 발견 시 → `@storybook/nextjs-vite` 전환 후 진행.
- **CP-2 (Tailwind 배선 SD/REQ-SB-002)**: 첫 스토리 렌더 시 globals.css 스타일(토큰·gradient)이 실제 적용되는지 육안 확인. 미적용 → `viteFinal` 에 `@tailwindcss/vite` 폴백 적용 후 재확인.
- **CP-3 (`@/*` alias, REQ-SB-002)**: `build-storybook` 시 alias 해석 실패면 `viteFinal` alias 또는 `vite-tsconfig-paths` 추가. primitive 의 `@/` import 는 최소화.
- **CP-4 (토큰 SD-1, REQ-SB-005)**: **SD-1 은 이미 확정됨(2026-07-22 v0.1.1 — 연기/option B).** run 단계에서 별도 AskUserQuestion 불요. primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸)만 소비하고 인라인 hex 색/radius 하드코딩이 없는지 확인. `packages/design-tokens` 는 만들지 않는다(후속 SPEC).
- **CP-5 (무하네스, §5)**: 유닛 테스트 러너·play-function 인터랙션 러너를 도입하지 않는다(도입 유혹 차단). 검증은 build/lint/storybook-build 만.

## 5. TDD-모드 ↔ 무하네스 정합 (검증 접근 명시)

- `quality.yaml development_mode: "tdd"` 이나 **apps/web 은 테스트 하네스가 없고 사용자가 web SPEC 하네스 도입을 반복 거부**(프로젝트 메모리 web-no-test-harness). 본 SPEC 산출물은 카탈로그/문서(컴포넌트+스토리+빌드 설정)라 RED-GREEN 유닛보다 **빌드-렌더 검증**이 자연스럽다.
- **정합 결론**: 본 SPEC 의 "테스트" = **`build-storybook` 성공 + 스토리 전수 렌더 무에러**(각 스토리가 사실상 컴포넌트의 실행 가능한 명세/스모크). 여기에 `next build` 무회귀 + `eslint` clean 을 더한 **정적 게이트**로 TDD 의 "검증 가능" 요건을 대체한다. 새 테스트 프레임워크/러너 도입 금지(CP-5). run 단계에서 하네스가 필요하다는 판단이 서면 **사용자에게 먼저 물어본다**(무단 설치 금지).

## 6. @MX 태그 대상 (plan-phase 식별 — run 에서 생성)

- **`@MX:NOTE`** — `apps/web/.storybook/preview.tsx`: `globals.css` import 가 디자인 시스템 단일 진입점(제거/이동 시 전 스토리 스타일 소실 — load-bearing).
- **`@MX:NOTE`** — 각 `components/ui/*.tsx`: canonical primitive 임 + presentational 불변(데이터/`next/*`/bridge import 금지) 명시.
- **`@MX:ANCHOR` 후보** — `apps/web/components/ui/button.tsx` 등: 향후 콜사이트가 다수 import 하는 계약 경계(현재 fan_in 0, 이관 SPEC 진행 시 승격). run 단계에서 실제 fan_in ≥3 되면 ANCHOR 부여.
- **`@MX:NOTE`** — 각 `components/ui/*.tsx`(토큰 소비 지점): globals.css 시맨틱 토큰(Tailwind 유틸)만 소비하고 인라인 hex 색/radius 를 하드코딩하지 않는다(SD-1=연기 확정 — 단일출처 globals.css 보존). `packages/design-tokens` 는 본 SPEC 에서 생성하지 않음(후속 SPEC — RN 착수 시).
- **`@MX:NOTE`** — `apps/web/.storybook/main.ts`: 빌더=react-vite 선택 근거(next/* 미의존 + Next16 디커플링) 한 줄.

## 7. 위임 / 협의 권장

- **run 단계 구현**: `manager-develop`(cycle_type=autofix 또는 tdd-무하네스 변형) — 정적 게이트 기반. 프론트엔드 컴포넌트 설계는 도메인 작업 스폰(general-purpose, frontend whitelist)로.
- **Storybook/Vite 설정 이슈**: Context7(`/storybookjs/storybook`) + 공식 docs(WebFetch) 재확인. Tailwind v4 배선 실패 시 research §3.2 폴백.
- **SD-1**: **확정됨(2026-07-22 v0.1.1 — 연기/option B)**, run 단계 사용자 확정 불요. design-tokens 패키지는 후속 SPEC(RN 착수 시).
