# moyura

**🔗 라이브: [htyong.com](https://htyong.com) · 🎨 UI 컴포넌트 카탈로그(Storybook): [design.htyong.com](https://design.htyong.com)**

**모임(moim) 도메인 중심의 B2C 생산성·유틸리티 앱** — 모임 생성부터 초대·채팅·일정/장소/투표 조율·회비 정산까지 하나의 흐름으로 묶는다. React Native(Expo) 웹뷰 하이브리드 아키텍처로 iOS·Android·Web을 단일 웹 UI로 공유한다.

> 상위 제품 도메인의 일부 방향성은 미확정(TBD)이며, 현재는 "모임" 기능군이 첫 제품 축으로 구체화되어 구현되어 있다. 구현 현황의 단일 출처는 [`.moai/project/tech.md`](.moai/project/tech.md)의 "구현됨 vs 계획됨" 표다.

---

## 아키텍처 — RN 웹뷰 하이브리드

핵심 화면(모임·채팅·투표·정산 등)은 웹(Next.js)에서 렌더링하고, 모바일 앱은 이를 WebView로 호스팅하는 **네이티브 셸**로 동작한다. 세 앱의 역할은 다음과 같다.

| 구성 요소 | 스택 | 역할 |
|-----------|------|------|
| `apps/mobile` | Expo (React Native) + expo-router | 앱 셸 / 네이티브 래퍼 — 웹 콘텐츠를 WebView로 호스팅, 네이티브 권한·배포·디바이스 연동(Google Sign-In, FCM 푸시, 딥링크) |
| `apps/web` | Next.js 16 (App Router) | 실제 UI/화면 — SSR + Server Actions, 모임/채팅/투표/정산 전 기능의 렌더링 주체 |
| `apps/backend` | NestJS 11 | REST API — 인증·인가, 도메인 로직, Realtime 브로드캐스트 트리거 소유 |

- 네이티브 ↔ WebView는 nonce 인증 postMessage 브리지로 세션·명령을 교환한다.
- 실시간(채팅·투표·멤버 목록)은 Supabase Realtime broadcast를 사용하며, 트리거·RLS는 Prisma 마이그레이션이 소유한다.

---

## 기술 스택

- **모노레포**: pnpm workspaces (`10.27.0`) + Nx (`21.6.x`)
- **언어**: TypeScript (web `^5` / backend `^5.7` / mobile `~6.0`), Node `>=20`
- **모바일**: Expo `~56`, React Native `0.85`, react-native-webview, expo-router, expo-notifications(FCM), @react-native-google-signin
- **웹**: Next.js `16.2` (App Router, React Compiler), React 19, Tailwind CSS v4, @supabase/ssr
- **백엔드**: NestJS `11`, Prisma `7` + `@prisma/adapter-pg`, Zod `4`(env 검증), jose(JWKS 검증), firebase-admin(FCM), @nestjs/swagger(OpenAPI)
- **데이터/인증**: Supabase (PostgreSQL, Auth, Realtime, Storage)
- **타입 공유**: OpenAPI → `@moyura/api-client`(`packages/api-client`)로 타입드 클라이언트 자동 생성

---

## 모노레포 구조

```
moyura/
├── apps/
│   ├── backend/     NestJS API (Prisma 스키마·마이그레이션 소유)
│   ├── web/         Next.js App Router (실제 UI)
│   └── mobile/      Expo RN 앱 셸 (WebView 호스트)
├── packages/
│   ├── api-client/  OpenAPI 기반 타입드 API 클라이언트 (@moyura/api-client)
│   └── config/      공유 설정 스텁
├── supabase/        Supabase CLI 로컬 스택 + config.toml (플랫폼 설정 소유)
├── .moai/           프로젝트 문서·SPEC (product/tech/structure, .moai/project)
├── DEPLOY.md        prod 배포 런북 (LOCAL → PRODUCTION)
└── nx.json / pnpm-workspace.yaml
```

### 백엔드 도메인 모듈 (`apps/backend/src`)

| 모듈 | 책임 |
|------|------|
| `auth` | Supabase Auth ES256 JWKS 검증 가드 (authn) |
| `profile` | `Profile` 모델, `GET/PATCH /me`, 이름 온보딩 |
| `moim` | 모임 CRUD·멤버십, 강퇴/소유권 양도/정원, `assertMember`/`assertOwner` 인가 단일 출처 |
| `invite` | 초대 링크 발급/폐기(owner 전용), 게스트 익명 가입(멱등) |
| `chat` | 모임 채팅 (keyset 페이지네이션 + Realtime broadcast) |
| `poll` | 투표 (단일/다중 선택, 마감, 날짜 투표 자동 확정) |
| `schedule` | 일정 조율 |
| `expense` | 회비/정산 (기록·집계·정산 마킹) |
| `notification` / `push` | 인앱 알림 fan-out + FCM 디바이스 토큰·백그라운드 푸시 |
| `safety` | 신고·차단 (UGC 모더레이션, 뷰어별 숨김 필터) |
| `account` | 회원 탈퇴 (툼스톤 테이블로 부활 차단) |

---

## 주요 구현 기능

- **인증**: Supabase Auth 기반 이메일/비밀번호 + PKCE 콜백, 네이티브 Google Sign-In(bridge command), provider-agnostic 이름 온보딩
- **모임**: 생성·조회·멤버십, 일정/장소 필드, 멤버 강퇴·소유권 양도·정원(기본 15명)
- **초대/게스트**: CSPRNG 토큰 초대 링크, `moyura://invite` 딥링크, 익명 로그인 게스트 참여
- **이벤트 트라이어드**: 일정·장소·투표를 한 모임 안에서 조율. 날짜 투표 마감 시 최다 득표 날짜를 모임 일정으로 자동 확정
- **실시간**: 채팅·투표 결과·멤버 목록이 Supabase Realtime broadcast로 라이브 갱신
- **회비/정산**: 지출 기록·카테고리·분담 집계 + 1:1 정산 마킹
- **알림**: 인앱 알림 배지·피드 + FCM 백그라운드 푸시
- **스토어 정책 대응**: 신고·차단, 회원 탈퇴

각 기능은 `.moai/specs/SPEC-*` 문서로 명세화되어 있다.

---

## 로컬 개발

### 사전 요구사항

- Node `>=20`, pnpm `10.27.0`
- Supabase CLI (레포에 devDependency로 포함)
- (모바일) Xcode / iOS 시뮬레이터 — 모바일 검증은 iOS 시뮬레이터 기준

### 설치

```bash
pnpm install
```

### 로컬 Supabase 스택

```bash
pnpm db:start      # supabase start (로컬 PostgreSQL :54322)
pnpm db:status
pnpm db:stop
```

### 앱 실행

```bash
pnpm dev:backend   # Prisma generate + NestJS watch (:3000)
pnpm dev:web       # Next.js dev
pnpm dev:mobile    # Expo start
```

### 품질 게이트 (Nx run-many)

```bash
pnpm build         # nx run-many -t build
pnpm lint          # nx run-many -t lint
pnpm test          # nx run-many -t test
pnpm typecheck     # nx run-many -t typecheck
pnpm graph         # 프로젝트 의존성 그래프
```

- 백엔드 테스트: Jest / 모바일: Vitest / 웹: ESLint·타입체크·빌드 기반 검증

---

## 데이터베이스 정책

Supabase 사용은 하이브리드다 — 책임을 명확히 분리한다.

| 책임 | 소유자 | 배포 |
|------|--------|------|
| DB 스키마 / 트리거 / RLS | **Prisma** (`apps/backend/prisma/migrations/`) | `prisma migrate deploy` |
| 플랫폼 설정 (auth / providers / realtime / storage) | **Supabase** (`supabase/config.toml` + 대시보드) | `supabase config push` 또는 대시보드 |

> `supabase db push`는 사용하지 않는다. 스키마·Realtime 트리거·RLS 정책은 전적으로 Prisma 마이그레이션이 소유하며 `migrate deploy` 한 번으로 함께 적용된다.

---

## 배포

- **web**: Vercel — [htyong.com](https://htyong.com)
- **UI 컴포넌트 카탈로그(Storybook)**: Vercel — [design.htyong.com](https://design.htyong.com) (`apps/web/components/ui` 공용 프리미티브, 실 디자인 시스템으로 렌더)
- **backend**: Render (Cloud Run 서울 리전 이관 설계 진행)
- **DB/Auth/Realtime**: Supabase
- **mobile**: EAS Build

전체 절차·환경 변수·시크릿 관리는 [`DEPLOY.md`](DEPLOY.md)를 단일 출처로 참조한다. 실값·시크릿은 절대 커밋하지 않는다.

---

## 문서

- [`.moai/project/product.md`](.moai/project/product.md) — 제품 비전
- [`.moai/project/tech.md`](.moai/project/tech.md) — 기술 스택 및 구현/계획 현황 (SSOT)
- [`.moai/project/structure.md`](.moai/project/structure.md) — 코드베이스 구조
- [`DEPLOY.md`](DEPLOY.md) — 배포 런북
- [`CHANGELOG.md`](CHANGELOG.md) — 변경 이력
