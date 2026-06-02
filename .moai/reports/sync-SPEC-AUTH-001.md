# Sync Report — SPEC-AUTH-001

- 일자: 2026-06-02
- 전략: main_direct (PR 없음)
- 대상 SPEC: SPEC-AUTH-001 (Supabase 인증, authn-only)
- 상태 전이: `draft` (v0.2.0) → `completed` (v0.3.0)
- 구현 커밋: `6ca29fd`, `87e74ea`, `841f35e`, `d54adb0` (`master`)
- 독립 평가: evaluator-active **PASS** (Functionality 0.95 / Security 0.97 / Craft 0.78 / Consistency 0.93)

## 갱신/생성된 파일

| 파일 | 변경 |
|------|------|
| `.moai/specs/SPEC-AUTH-001/spec.md` | frontmatter `status: completed`, `version: 0.3.0`; HISTORY v0.3.0 라인 추가; "## Implementation Notes" 섹션 추가(품질/평가 결과 + 실제 구현 사실 + AC 충족/연기 + evaluator MAJOR) |
| `.moai/project/tech.md` | 요약 표에 SPEC-AUTH-001 IMPLEMENTED 행 추가; Auth 항목을 seam → 실제 인증(jose 6.2.3 ES256 JWKS, @supabase/ssr 0.10.3, Profile 모델, api-client Bearer)으로 갱신; follow-up 노트 갱신(소셜 키/이메일 확인·재설정/RBAC/프런트 테스트 타겟); 설정 파일 표에 auth/profile/web supabase 경로 추가 |
| `.moai/project/structure.md` | 디렉터리 트리 확장(backend `src/{auth,profile}` + `prisma/migrations`; web `lib/{supabase,auth}`·`app/{auth/callback,login,me}`·`proxy.ts`; mobile `lib/auth/oauth.ts`; supabase config provider 블록); "## 인증 흐름" 섹션 추가(웹 세션 → Bearer → JWKS 가드 → Profile upsert → GET /me); api-client 행에 Bearer/getMe 반영 |
| `CHANGELOG.md` | `[Unreleased]` Added에 SPEC-AUTH-001 엔트리(가드/profile/`/me`/웹 세션/소셜·모바일 스캐폴드); api-client Changed에 Bearer 추가 |
| `.moai/project/product.md` | 비범위 노트를 "인증 미구현" → "B2C 인증(로그인) 구현됨(authn-only), 후속 과제·제품 기능은 TBD"로 갱신 |
| `.moai/reports/sync-SPEC-AUTH-001.md` (신규) | 본 보고서 |

> 참고: `acceptance.md`/`plan.md`는 YAML frontmatter가 없는 문서(첫 줄이 `#` 헤더)다. 따라서 "frontmatter status/version" 갱신은 해당 없음 — 두 파일은 수정하지 않았다.

## 구현 사실 검증 (디스크 대조)

문서에 기록한 모든 사실은 실제 저장소 상태로 검증함:
- 백엔드: `apps/backend/src/auth/{supabase-auth.guard,token-verifier.service,auth.config,current-user.decorator}.ts`, `apps/backend/src/profile/{me.controller,profile.service,profile-response.dto,profile.module}.ts` 존재. `apps/backend/prisma/migrations/20260602095934_init_profile/` 존재. `schema.prisma`에 `model Profile { id String @id; createdAt; @@map("profile") }`. `jose ^6.2.3`(backend package.json).
- 웹: `apps/web/lib/supabase/{client,server,middleware}.ts`, `apps/web/lib/auth/{actions,callback}.ts`, `apps/web/app/auth/callback/route.ts`, `app/login`, `app/me`, `apps/web/proxy.ts` 존재. `@supabase/ssr 0.10.3` + `@supabase/supabase-js 2.106.2`(web package.json).
- 모바일: `apps/mobile/lib/auth/oauth.ts`, app.json scheme `"moyura"`.
- 소셜: `supabase/config.toml` `[auth.external.apple|google|kakao]` 블록 존재.
- api-client: `packages/api-client/src/index.ts`에 `getToken`/`Authorization: Bearer`/`getMe` 구현 확인.

## 차이 요약 (plan vs actual — 모두 설계 결정/명시된 연기)

- **plan과 일치**: 가드 ES256 JWKS + HS256 폴백, per-route `@UseGuards`(OD-7 권장안), Profile `id=sub` PK 단일 키, Bearer 전달(OD-3), 네이티브 토큰 저장소 미도입(OD-4). beyond-plan 실질 차이 없음(`proxy.ts`는 Next 16 미들웨어 컨벤션, 이탈 아님).
- **설계상 연기**(gap 아님 — Non-Goals/Exclusions 명시): 실제 소셜 provider 키(R-F3), 모바일 런타임 OAuth 라운드트립(디바이스 필요 — 코드+config 스캐폴드만), 이메일 확인 + 비밀번호 재설정(R-G6), RBAC/인가, prod HTTPS 강제(평가 MINOR).
- **evaluator MAJOR(문서화된 후속 과제)**: web/mobile/api-client 자동 테스트 타겟 부재 — 테스트 가능한 순수 함수(`resolveCallbackOutcome`/`resolveSupabaseConfig`/api-client Bearer/`launchSocialOAuth`)가 회귀 보호되지 않음(빌드 시점 node sanity로만 검증). spec.md Implementation Notes + tech.md follow-up에 명시.

## 확인 사항

- 소스 코드 미수정 — 문서(`.moai/`, `CHANGELOG.md`)만 갱신.
- 커밋 미수행 — 오케스트레이터가 커밋.
- 연기 항목은 gap이 아닌 설계 결정으로, evaluator MAJOR는 문서화된 후속 과제로 명시됨.
- product.md는 인증 구현 한 줄 노트만 추가, 제품 비전 세부는 TBD 유지.
