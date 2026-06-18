# SPEC-MOIM-003 구현 계획 (plan.md)

> 모임 상세 화면(MeetupDetail) — 홈 카드 탭 → 상세, 멤버/채팅 진입. spec.md v0.1.0 기준.
> 시간 추정 금지 — 우선순위(High/Medium/Low)와 단계 순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

하이브리드 아키텍처(웹=콘텐츠, 모바일=네이티브 네비게이션) 위에서 4개 패키지를 순서대로 배선한다:

1. **api-client** (`packages/api-client`) — 목록 조회 편의 메서드 추가. 모든 상위 배선의 기반.
2. **web** (`apps/web`) — 홈 mock→real, 상세 페이지 신규, 상세/멤버 조회 헬퍼.
3. **mobile** (`apps/mobile`) — 순수 코어에 detail-push 분류 추가 → expo-router 홈 탭 디렉터리화 + 상세 라우트.
4. **검증** — build/lint/tsc/vitest/expo export + 디바이스 종단.

백엔드는 무변경(엔드포인트·인가 이미 존재). 스키마 확장 없음.

## 2. 마일스톤 (Priority-based, 순서 의존)

### M1 (High) — api-client 목록 표면 [REQ-MOIM3-006]

- `packages/api-client/src/index.ts`:
  - `MoimResponse = components['schemas']['MoimResponseDto']` 타입 별칭 추가.
  - `ApiClient.listMoims(): Promise<MoimResponse[]>` 편의 메서드 추가 — `getMe`/`patchMe` 패턴, path 키 `/moims` 는 리터럴이라 generic `request('/moims', 'get')` 으로 타입 안전.
  - 토큰은 기존 `getToken`/Bearer 경로 그대로(R-A9 보존).
- 검증: `tsc`(api-client) 0 error.

### M2 (High) — 웹 상세/멤버 조회 헬퍼 [REQ-MOIM3-002/006]

- `apps/web/lib/moim/api.ts` 신규 — `chat/api.ts` 패턴 미러:
  - `getMoim(api, id): Promise<MoimDetail>` — 구체 경로 `/moims/${encodeURIComponent(id)}` + `request(path as never, "get")`.
  - `getMoimMembers(api, id): Promise<MoimMember[]>` — `/moims/${id}/members` 동일 패턴(chat/api.ts `loadMembers` 와 사실상 동형 — 재사용 검토하되 chat 모듈 의존을 피해 독립 헬퍼 권장).
  - 타입(`MoimDetail`, `MoimMember`)은 로컬 인터페이스로 정의(chat/api.ts 와 동일 스타일).
  - 에러: `ApiError` status 보존(403/404 분기에 사용).

### M3 (High) — 웹 상세 페이지 [REQ-MOIM3-002/004/005]

- `apps/web/app/(main)/home/[id]/page.tsx` 신규 (Server Component):
  - `params: Promise<{ id: string }>` 언랩(Next 16 — 서버는 await, 클라이언트는 use()).
  - 서버 supabase 세션에서 access_token 도출(page.tsx 패턴) → `createApiClient({ baseUrl, getToken })`.
  - `getMoim(id)` + `getMoimMembers(id)` 병렬 조회.
  - 403(`ApiError`) → 비멤버 안전 처리(`notFound()` 또는 안내 + 홈 복귀 링크). 404 → `notFound()`.
  - 렌더: 모임 이름(헤더), 멤버 목록(nickname + role owner/member 배지), "채팅 입장" 링크(`/moims/{id}/chat`).
  - 디자인: 기존 `(main)` 페이지 Tailwind 토큰·lucide-react 아이콘과 일관. 신규 Figma 프레임 없음.
- 가드: `(main)/layout.tsx` `requireNamedSession()` 상속(신규 가드 파일 없음).
- 검증: `nx run web:build` 0 error.

### M4 (High) — 홈 탭 mock→real 배선 [REQ-MOIM3-001]

- `apps/web/app/(main)/home/page.tsx`:
  - 서버에서 access_token 으로 `listMoims()` 조회 → `HomeTab` 에 `moims` prop 전달(기존 displayName/avatar/greeting 도출 보존).
- `apps/web/app/(main)/home/HomeTab.tsx`:
  - `MOCK_MEETUPS` import 제거, `moims: MoimResponse[]` prop 수신.
  - `MeetupCard` → 실 모임 카드: 이름 + 생성일 표시, 데이터 없는 필드(시간/장소/상태/멤버수) 제거(§5 degrade). 카드를 `/home/{id}` 링크(`next/link`)로 전환.
  - 필터 칩: status 데이터 없음 → "전체" 단일화 또는 제거(최소 churn 선택).
  - 빈 상태 UI 유지(REQ-MOIM3-001).
- `apps/web/app/(main)/home/_mock.ts`: 참조 0 확인 후 삭제(잔여 참조 시 유지).
- 검증: `nx run web:build` + lint 0 error.

### M5 (High) — 모바일 detail-push 순수 분류 [REQ-MOIM3-003]

- `apps/mobile/lib/route-map-core.ts`:
  - `detailRouteForUrl(url): { route: AppRoute; id: string } | null` 추가 — 정확히 2 세그먼트이고 segment[0] 이 `APP_ROUTE_SET` 멤버일 때 `{ route, id: segment[1] }`, 그 외 null. 기존 `routeForUrl`(단일 세그먼트) 무변경.
- `apps/mobile/hooks/auth-bridge-core.ts` `decideWebViewLoad`:
  - 신뢰 origin + `currentUrl` 의 라우트와 detail 타깃의 라우트가 같은 탭일 때 `{ action: "push", route, id }` 반환(additive 변형). 우선순위: oauth-intercept > tab-switch dispatch > detail push > origin 판정.
  - 오버로드 타입에 push 변형 추가하되 `currentUrl` 부재 시 비활성(회귀 0). 기존 exhaustive switch 소비자 하위호환.
- vitest 신규 케이스: `/home/123` detail 분류, 같은 탭 detail push 디스패치, 다른 origin/인증 URL 비디스패치, currentUrl 부재 회귀 0.
- 검증: mobile vitest 통과 + `tsc`(mobile) 0 error.

### M6 (High) — expo-router 홈 탭 디렉터리화 + 상세 라우트 [REQ-MOIM3-003]

- `apps/mobile/app/(tabs)/home.tsx` 삭제 → 디렉터리 `(tabs)/home/` 로 전환:
  - `(tabs)/home/_layout.tsx` — expo-router `Stack`(headerShown 정책은 BridgedWebView 풀스크린에 맞춰 결정).
  - `(tabs)/home/index.tsx` — 기존 `TabWebView route="home"` 이전.
  - `(tabs)/home/[id].tsx` — `useLocalSearchParams` 로 `id` 획득 → `${WEB_URL}/home/${id}` 조립(`urlForRoute` 와 일관된 URL 결합) → `BridgedWebView sourceUri routeContext="(tabs)"`.
- `decideWebViewLoad` push 결과를 소비하는 측(useAuthBridge / BridgedWebView onShouldStartLoad)에서 `router.push('/home/[id]')` 디스패치 배선.
- `(tabs)/_layout.tsx` `Tabs.Screen name="home"` 디렉터리 기반 동작 확인(탭바 보존).
- 검증: `expo export` + `tsc`(mobile) 0 error.

### M7 (Medium) — 통합 검증 + 디바이스 종단

- 전체 게이트: web build/lint, tsc(web+mobile+api-client), mobile vitest, expo export 0 error.
- 디바이스 종단(완료 전환 필수): iOS 시뮬레이터 dev build — 홈 실 모임 목록 → 카드 탭 → 네이티브 상세 push → 웹 상세(이름/멤버/채팅 입장) 렌더 → 네이티브 back → 홈 목록 복귀.

## 3. 구현 중 확인 체크포인트 (구현 단계 필수 확인)

> spec.md REQ-MOIM3-005/006 의 shall-요구사항을 구현 과정에서 반드시 점검하며 진행한다(사용자 관례 — 이중 배치).

- **백엔드 인가 보존 확인**: `GET /moims/:id` 비멤버 403 동작이 실제로 유지되는지 확인하고, 웹 상세가 이를 약화 없이 안전 처리(403→notFound/안내)하는지 점검. 인가를 웹에서 우회/약화하지 않는다.
- **request 템플릿 미치환 확인**: `api.request('/moims/{id}', 'get')` 가 `{id}` 를 치환하지 않음을 인지하고, path 파라미터 조회는 반드시 구체 경로 조립(`chat/api.ts` 패턴)을 사용한다.
- **mock→real degrade 정직성**: 카드가 실 데이터 없는 필드(시간/장소/상태/멤버수)를 허위로 채우지 않는지 확인. status 필터를 데이터 없이 구현하지 않는다.
- **순수 코어 격리**: detail-push 분류 로직에 RN/expo import 가 섞이지 않는지 확인(vitest node 환경 순수성 — mobile-pure-core-test-seam).
- **회귀 0(R-NC3)**: 단일 세그먼트 탭 디스패치·인증 URL(/login, /auth/callback) 동작이 detail-push 추가로 변하지 않는지 vitest 로 보증.

## 4. 파일 변경 요약 (file-by-file)

| 파일 | 종류 | 변경 |
|------|------|------|
| `packages/api-client/src/index.ts` | MODIFY | `MoimResponse` 별칭 + `listMoims()` 편의 메서드 |
| `apps/web/lib/moim/api.ts` | NEW | `getMoim`/`getMoimMembers` (chat/api.ts 패턴) |
| `apps/web/app/(main)/home/[id]/page.tsx` | NEW | 상세 Server Component(이름/멤버/채팅 입장) |
| `apps/web/app/(main)/home/page.tsx` | MODIFY | `listMoims()` 서버 조회 → HomeTab prop |
| `apps/web/app/(main)/home/HomeTab.tsx` | MODIFY | mock 제거, 실 데이터 바인딩, `/home/{id}` 링크, 필터 단일화 |
| `apps/web/app/(main)/home/_mock.ts` | REMOVE | 참조 0 확인 후 삭제 |
| `apps/mobile/lib/route-map-core.ts` | MODIFY | `detailRouteForUrl` 순수 분류 추가 |
| `apps/mobile/hooks/auth-bridge-core.ts` | MODIFY | `decideWebViewLoad` push 변형 추가(additive) |
| `apps/mobile/app/(tabs)/home.tsx` | REMOVE | 디렉터리화로 대체 |
| `apps/mobile/app/(tabs)/home/_layout.tsx` | NEW | Stack |
| `apps/mobile/app/(tabs)/home/index.tsx` | NEW | 기존 TabWebView route="home" 이전 |
| `apps/mobile/app/(tabs)/home/[id].tsx` | NEW | 상세 BridgedWebView(`${WEB_URL}/home/{id}`) |
| mobile vitest (route-map) | NEW | detail 분류 + push 디스패치 + 회귀 0 케이스 |

## 5. 리스크 & 완화 (요약 — 상세는 spec.md §6)

- 홈 탭 디렉터리화 회귀(MEDIUM) → BridgedWebView 재사용 + 디바이스 검증.
- detail 자체 이동 누수(MEDIUM) → push 분기 + vitest.
- request 템플릿 미치환(LOW) → chat/api.ts 패턴 준수.

## 6. 의존성 / 순서

- M1 → (M2, M4 가 의존) → M3 → M4 (웹 흐름).
- M5 → M6 (모바일 흐름). M5 는 순수 단위테스트로 선행 검증.
- M3/M4(웹 상세·홈) 가 먼저 동작해야 모바일 상세 push 가 호스팅할 웹 URL 이 존재한다 → 웹 우선, 모바일 후행 권장.
- M7 은 전 단계 완료 후.
