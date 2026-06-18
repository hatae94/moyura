# SPEC-MOIM-003 (compact)

> 모임 상세 화면(MeetupDetail) — 홈 카드 탭 → 상세, 멤버/채팅 진입. 압축본(overview·research 참조 생략). 권위 출처는 spec.md/plan.md/acceptance.md.

- id: SPEC-MOIM-003 / status: draft / version: 0.1.0 / priority: medium / issue_number: 0
- 계약: SPEC-MOBILE-003 네비게이션 계약 준수(R-NC1/R-NC2/R-NC3). 백엔드 무변경(엔드포인트·인가 존재). 스키마 확장 0.

## REQ (EARS)

- **REQ-MOIM3-001** (Event): WHEN `/home` 요청 → `GET /moims` 실 데이터 카드 렌더, 각 카드 `/home/{id}` 링크. 0개면 빈 상태.
- **REQ-MOIM3-002** (Event): WHEN `/home/{id}` 요청 → `GET /moims/:id` + `:id/members` 로 이름 + 멤버(nickname+role) 렌더, "채팅 입장" → `/moims/{id}/chat`. WebView/데스크톱 parity.
- **REQ-MOIM3-003** (Event): WHEN 모바일 셸에서 `/home/{id}` 네비 → in-WebView 차단 + 네이티브 push `(tabs)/home/[id]`(R-NC2 nested 확장) 가 `${WEB_URL}/home/{id}` 호스팅(R-NC1). 네이티브 back → 목록 복귀. 인증 URL·단일 탭 디스패치 무변경(R-NC3, 회귀 0).
- **REQ-MOIM3-004** (State): WHILE 데스크톱(RN bridge 부재) → `/home`·`/home/{id}` 일반 Next 라우팅, 디스패치 없음, 상세 content parity.
- **REQ-MOIM3-005** (State/Unwanted): `/home/{id}` 는 `(main)/layout.tsx` `requireNamedSession()` 상속 — 미인증→/login, 이름없음→/onboarding. IF 비멤버 → 백엔드 403 약화 없이 안전 결과(notFound/안내), 콘텐츠·토큰 비노출.
- **REQ-MOIM3-006** (Ubiquitous): api-client `listMoims()` 타입드 편의 메서드(목록). path 파라미터 조회(`:id`/`:id/members`)는 `chat/api.ts` 패턴(구체 경로 + `request(path as never)`) — `request()` 템플릿 미치환. Bearer 헤더만.

## AC (6)

- AC-1: 홈 실 모임 목록 + `/home/{id}` 링크(mock 미사용, 빈 상태 유지).
- AC-2: 상세 = 이름 + 멤버(nickname+role) + 채팅 입장 링크.
- AC-3: (디바이스) 모바일 카드 탭 → 네이티브 push → 웹 상세 호스팅 → back 목록 복귀. 순수 vitest: detail 분류 + push + 회귀 0.
- AC-4: 데스크톱 일반 Next 라우팅, 디스패치 0, parity.
- AC-5: `(main)` 가드 상속(미인증→/login, 이름없음→/onboarding). 비멤버 403 안전 처리.
- AC-6: web build/lint, tsc(web+mobile+api-client), mobile vitest, expo export 0 error.

## 변경 파일

- MODIFY: `packages/api-client/src/index.ts`(listMoims+MoimResponse), `apps/web/app/(main)/home/page.tsx`(실조회→prop), `HomeTab.tsx`(mock제거·실바인딩·링크·필터단일화), `apps/mobile/lib/route-map-core.ts`(detailRouteForUrl), `apps/mobile/hooks/auth-bridge-core.ts`(decideWebViewLoad push 변형 additive).
- NEW: `apps/web/lib/moim/api.ts`(getMoim/getMoimMembers), `apps/web/app/(main)/home/[id]/page.tsx`(상세 Server Component), `apps/mobile/app/(tabs)/home/_layout.tsx`(Stack), `home/index.tsx`(탭 이전), `home/[id].tsx`(상세 BridgedWebView), mobile vitest 케이스.
- REMOVE: `apps/mobile/app/(tabs)/home.tsx`(디렉터리화 대체), `apps/web/app/(main)/home/_mock.ts`(참조0 시).
- 백엔드: 무변경.

## Exclusions (What NOT to Build)

- Moim 스키마 필드 확장(date/time/location/desc/RSVP/vote/status) 금지.
- 상세에서 모임 수정/삭제 UI, 모임 생성 배선 금지.
- status 필터 기능(데이터 없음), per-card 멤버 수 조회 금지.
- 백엔드 엔드포인트/가드/인가 변경 금지.
- 상세 화면 realtime 금지(채팅 페이지에 유지).
- MeetupDetail 전용 신규 Figma 프레임 기반 디자인(부재 — 기존 (main) 디자인 일관) — Figma 블로커 금지.

## 게이트

- 자동: web build/lint, tsc×3, mobile vitest, expo export 0 error.
- **디바이스 종단(완료 전환 필수)**: iOS 시뮬레이터 dev build 라이브 — 홈 실목록→카드탭→네이티브 push→웹 상세→back 복귀→채팅 입장. 그 전 status=in-progress.
