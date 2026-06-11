# Plan: SPEC-MOBILE-004 — 모바일 네이티브 Google 로그인

> 구현 계획. SPEC-MOBILE-004/spec.md + research.md(2026-06-11) 기반.
> 개발 방법론: brownfield 기존 코드 수정 — 기존 동작 보존 우선.

---

## 1. 기술 스택 (정확한 패키지 / 버전 제약)

production stable만 사용한다. beta/alpha 금지. 버전은 run 단계에서 `npx expo install`로 Expo 56 호환 확정한다(아래 [VERIFY] 표시 항목).

| 패키지 | 위치 | 제약 | 비고 |
|--------|------|------|------|
| `@react-native-google-signin/google-signin` | apps/mobile | [VERIFY] Expo 56 config plugin 호환 stable. `npx expo install`로 확정 | EAS dev build 필수(Expo Go 불가). **무료 Original API** 사용 여부 버전별 공식 문서 확인 |
| `@supabase/supabase-js` | apps/mobile (신규) | [VERIFY] 웹과 동일 메이저 라인 stable | 현재 mobile에 미존재. `signInWithIdToken` 호출용 |
| `expo-secure-store` | apps/mobile | `~56.0.4` (기존) | 토큰 저장 — 재사용 |
| Prisma | apps/backend | 7.x (기존, schema.prisma) | `Profile.name` 마이그레이션 |
| Expo SDK | apps/mobile | `~56.0.x` (기존) | config plugin 추가 후 `pod install` 필수(iOS) |

기존 고정 버전(참고): `react-native@0.85.3`, `react@19.2.3`, `react-native-webview@13.16.1`, `expo@~56.0.6`.

---

## 2. 단계별 작업 분해 (Task Decomposition by Phase)

우선순위 라벨 사용(시간 추정 금지).

### Phase A — 스키마 마이그레이션 (Priority High)

- A1. `apps/backend/prisma/schema.prisma` `Profile`에 `name String?`(nullable) 추가
  - Reference: `apps/backend/prisma/schema.prisma:22-28` (현재 id/createdAt만)
- A2. Prisma 마이그레이션 생성·적용 (`prisma.config.ts` DIRECT_URL 경유)
- A3. `me.controller.ts` / `profile.service.ts`에 이름 업데이트 엔드포인트 추가(예: `PATCH /me { name }`) — 정확한 API 형태는 설계 결정
  - Reference: `apps/backend/src/profile/me.controller.ts:20-35` (`@Controller('me')`, `GET`, `upsertBySub`)

### Phase B — 웹 이름 영속 배선 (Priority High)

- B1. `signUpAction`이 폼의 `name`을 읽어 가입 시 영속하도록 수정(Supabase `signUp` options.data 또는 가입 직후 Profile 반영 — 설계 결정)
  - Reference: `apps/web/lib/auth/actions.ts:30-47` (현재 email/password만)
- B2. `login-form.tsx` 이름 필드(이미 존재, decorative)와 action 배선 정합 확인
  - Reference: `apps/web/app/login/login-form.tsx:181-194`

### Phase C — 이름 온보딩 페이지 + 가드 (Priority High)

- C1. 이름 입력 온보딩 웹 페이지 신규(provider 비종속, WebView/데스크톱 공용)
- C2. 보호 경로 진입 가드: `Profile.name` 미보유 시 온보딩으로 리다이렉트
  - Reference(콜백·redirect 패턴): `apps/web/app/auth/callback/route.ts:26-50` (`safeNextPath`, redirect 가드)
- C3. Google `user_metadata` 이름 prefill 기본값 처리

### Phase D — 네이티브 SDK 통합 (Priority High)

- D1. `@react-native-google-signin/google-signin` + `@supabase/supabase-js` 설치(`npx expo install`)
- D2. `app.json` config plugin 설정 + iOS URL scheme(`com.googleusercontent.apps.<IOS_CLIENT_ID>`) + Android SHA-1
- D3. Google Cloud Console iOS/Android 클라이언트 ID 발급 + Supabase provider authorized client IDs 등록
- D4. EAS dev build 준비

### Phase E — signInWithIdToken + 브리지 인터셉트·주입 (Priority High)

- E1. 네이티브 Google Sign-In 모듈: 로그인 → `idToken` 획득
- E2. `supabase.auth.signInWithIdToken({ provider: 'google', token })` → access/refresh 토큰
- E3. WebView 내 Google 버튼 동작 인터셉트 분기를 `useAuthBridge`에 추가
  - Reference: `apps/mobile/hooks/useAuthBridge.ts:122-157` (`runOAuthBridge`, `onShouldStartLoadWithRequest` 인터셉트 패턴)
- E4. `saveTokens` 저장 → 기존 `session:restore` 주입
  - Reference: `apps/mobile/lib/auth/token-store.ts` (`saveTokens`), `apps/mobile/hooks/useAuthBridge.ts:209-238` (`injectRestore`)
  - Reference: `apps/mobile/lib/auth/bridge-protocol.ts:24-56` (`BRIDGE_MESSAGE_TYPES.RESTORE`, v1 스키마 — 무변경 재사용)

### Phase F — 디바이스 종단 검증 (Priority High — 완료 게이트)

- F1. EAS dev build 디바이스에서 Google 네이티브 로그인 → 세션 주입 → 온보딩 → `/me` 종단 검증
- F2. 신규/기존/이름 미보유 3 케이스 디바이스 확인

---

## 3. 구현 중 확인 체크포인트 (사용자 명시 요구)

사용자의 명시적 지시에 따라 다음 항목을 구현 과정에서 반드시 확인하여 진행한다:

- [ ] **신규 Google 가입 시 온보딩 이름 입력 강제** 확인 (Profile.name null → 온보딩 차단)
- [ ] **이메일 가입 name 영속** 확인 (`signUpAction`이 실제로 name을 저장하는지 — 현재 미배선)
- [ ] **기존 무이름 유저 리다이렉트** 확인 (이름 미보유 기존 사용자도 온보딩으로 유도)
- [ ] **이름 수집이 provider 비종속**인지 확인 (Google 경로와 이메일 경로가 동일 온보딩/영속 경로 공유, 향후 Apple 재사용 가능)
- [ ] **무료 Original API 사용** 확인 (Universal/OneTap 유료 정책 회피)

### 3.1 선결 설계 결정 (run 단계 시작 전 확정 — Phase A/B 착수 전)

다음 두 미확정 설계 결정은 **mid-implementation churn 방지를 위해 Phase A/B 작업 착수 전에 확정**한다(plan-audit D7):

- [ ] **이름 업데이트 엔드포인트 형태 확정** — `PATCH /me { name }` vs 별도 엔드포인트. Phase A3 착수 전 결정.
- [ ] **이메일 가입 이름 영속 방식 확정** — Supabase `signUp` `options.data`에 name 전달 후 `GET /me` UPSERT가 반영 vs 가입 직후 명시적 Profile 업데이트 호출. Phase B1 착수 전 결정.

---

## 4. 리스크 분석 및 완화 (Risk Analysis & Mitigation)

| 리스크 | 완화 |
|--------|------|
| App Store 4.8 (Apple 미제공 → iOS 거부) | Android(Google Play) 제출 우선 타깃. Apple Sign-In 별도 SPEC. 온보딩/세션을 provider 비종속 설계로 Apple 추가 비용 최소화. |
| EAS dev build 루프 비용 | config plugin 설정 후 dev build 1회 생성 → JS 변경은 dev build에서 fast refresh. 네이티브 설정 변경 시에만 재빌드. |
| nonce 로컬 skip / prod 강제 분기 | 로컬 `skip_nonce_check=true`(OD-5) 유지. prod nonce 핸들링은 follow-up으로 문서화(네이티브 SDK가 nonce 전달 가능한지 설계 시 확인). |
| Google 클라이언트 ID 발급 | Phase D3에서 iOS/Android 클라이언트 신규 발급 + Supabase authorized client IDs 등록을 선행 의존성으로 명시. |

---

## 5. mx_plan (MX 태그 계획)

- **[PRESERVE/EXTEND] `apps/mobile/hooks/useAuthBridge.ts` L103–109 @MX:ANCHOR**: 토큰이 JS 브리지를 가로지르는 단일 동기화·인증 경계(fan_in ≥ 3). 네이티브 SDK 경로가 이 경계를 통과하므로 **반드시 보존**하고, Google 인터셉트 분기 추가로 fan_in이 늘면 @MX:REASON을 갱신한다(절대 auto-delete 금지).
- **[NEW @MX:NOTE]** 네이티브 Google Sign-In 모듈 + `signInWithIdToken` 래퍼: idToken→Supabase 세션 변환 의도·신규/기존 분기 설명.
- **[NEW @MX:WARN 후보]** `signInWithIdToken` 호출 경계: nonce 로컬 skip / prod 강제 분기(보안 민감) → @MX:REASON 필수.
- **[NEW @MX:NOTE 후보]** 온보딩 가드: `Profile.name` 미보유 분기(신규/기존 판별의 단일 권위 지점).
- **[ANCHOR 후보]** 백엔드 이름 업데이트 엔드포인트(`PATCH /me`)가 fan_in ≥ 3이 되면 @MX:ANCHOR 승격 검토.

---

## 6. 완료 정의 / 디바이스 검증 요구

- 자동 게이트(typecheck 0 / lint 0 / vitest / web build / expo export)는 **필요조건이지만 충분조건이 아니다**.
- 프로젝트 메모리 규칙: 모바일 WebView SPEC은 **디바이스 OAuth 검증 전까지 in-progress 유지**. 자동 게이트 통과만으로 complete 처리 금지.
- 따라서 본 SPEC status는 Phase F(디바이스 종단 검증) 완료 후에만 완료로 전환한다.
