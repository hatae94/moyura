# 모바일 iOS WebView 검증 런북 — MOIM-003~010 + CHAT-001

작성일: 2026-06-22
대상: QA(직접 실행) — iOS 시뮬레이터 전용(Android 제외, 프로젝트 메모리 `ios-simulator-only`)
목적: device-gated SPEC(MOIM-003~010, CHAT-001)을 iOS 시뮬레이터 dev build 에서 라이브 검증해 `in-progress → completed` 전환 근거를 확보한다.

> **분담 메모**: 웹 UI 멀티탭 워크스루(2-멤버 실시간 포함)는 2026-06-22 자율 검증 완료(아래 §0). 본 런북은 **모바일 WebView 셸 안에서의 동작** + **네이티브 Google Sign-In(MOBILE-004)** 만 다룬다 — 이 둘이 자동 게이트/웹 검증으로 대체 불가한 genuine device-gate 다.

---

## 0. 이미 검증된 것 (재검증 불필요)

| 표면 | 검증 방식 | 결과 |
|------|-----------|------|
| 백엔드 로직(투표/마감/finalize/RLS) | jest 308 + *.live.mts(실 Supabase) | poll-finalize 15/15, poll-place-finalize 13/13, poll-realtime 7/7 PASS |
| 웹 UI 2-멤버 실시간 워크스루 | chrome-devtools 2 격리 세션(앨리스/밥), 2026-06-22 | MOIM-005~010 PASS (§아래) |
| 타입/린트/빌드 | tsc·lint·nx build·mobile vitest 215 | 0 error |

**웹 워크스루로 확인된 것(모바일에서 재확인만)**: 투표 생성/단일 투표/다중 토글/마감/날짜 확정→헤더 일정/장소 확정→헤더 장소/실시간 전파(생성·투표·마감·헤더 모두 리로드 없이 상대 멤버 반영)/per-user myVotes 정확/비멤버 RLS 차단/생성자 전용 마감 버튼/3-way 종류 선택.

**모바일에서만 확인 가능한 것(genuine device-gate)**:
1. 네이티브 Google Sign-In(MOBILE-004) — 인앱 SDK 로그인(외부 브라우저 이탈 없이).
2. 위 모든 흐름이 **react-native-webview 안에서** 동작(WebView 내 Supabase Realtime WebSocket / Server Action / router.refresh).
3. 하이브리드 네이티브 크롬(expo-router 탭바 + 상세 push, MOIM-003).

---

## 1. 사전 준비 (환경)

로컬 스택(검증 시작 시점에 이미 기동돼 있어야 함):

| 서비스 | 확인 명령 | 기대 |
|--------|-----------|------|
| Supabase 로컬 | `lsof -ti:54321` | 리스닝(API), :54322 DB |
| 백엔드(NestJS) | `lsof -ti:3001` + 로그에 `Mapped {/moims/:id/polls/:pollId/close}` | 최신 코드 기동 |
| 웹(Next) | `lsof -ti:3000` | 리스닝 |

> 백엔드 재기동이 필요하면 stale 방지: `for pid in $(lsof -ti:3001); do kill "$pid"; done` 후 `npx nx run backend:start:dev`, 로그에서 close 라우트 매핑 확인(프로젝트 메모리 `stale backend EADDRINUSE`).

모바일 env(`apps/mobile/.env`) 확인 — 시뮬레이터는 호스트 localhost 를 직접 접근하므로 그대로 사용:
- `EXPO_PUBLIC_WEB_URL=http://localhost:3000`
- `EXPO_PUBLIC_API_BASE_URL=http://localhost:3001`
- `EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321` (+ ANON)
- 네이티브 Google Sign-In client ID(app.json iosUrlScheme + `configureGoogleSignIn` webClientId/iosClientId, MOBILE-004) — 실제 Google OAuth 자격증명 필요.

---

## 2. 시뮬레이터 + 앱 기동

```bash
# (1) Metro 번들러
cd apps/mobile && npx expo start

# (2) 별도 터미널 — iOS dev build 설치+실행(네이티브 모듈 @react-native-google-signin 때문에 Expo Go 불가)
cd apps/mobile && npx expo run:ios
#   - 최초/네이티브 변경 시 pod install 필요(withModularHeaders 플러그인 → AppCheckCore modular headers).
#   - 빌드 후 시뮬레이터에 dev build 설치 + Metro 연결.
```

확인: 시뮬레이터에 앱이 뜨고 Metro 에 연결됨(로그인 화면).

---

## 3. 로그인 — 네이티브 Google Sign-In (MOBILE-004, genuine device-gate)

1. 로그인 화면에서 **"Google로 계속하기"** 탭.
2. **기대**: 외부 Safari 로 이탈하지 않고 **네이티브 Google Sign-In 시트**가 인앱으로 뜬다(MOBILE-004 핵심 — bridge `auth:google-request` → 네이티브 SDK 직접 호출).
3. 테스트 Google 계정으로 로그인.
4. 최초 로그인 시 이름 온보딩(`/onboarding`) → 이름 입력 → 홈.
5. **체크**: 로그인 후 홈 탭바(expo-router 네이티브 크롬)가 보이고, 웹 하단 탭바는 숨겨짐(`data-shell="native"`, 이중 탭바 금지 — SPEC-MOBILE-003 R-WB3).

> 멀티 멤버 실시간 검증을 위해 계정 2개 필요. 두 번째 멤버는 (a) 데스크톱 브라우저 탭(웹 워크스루에서 쓴 이메일 계정 재사용) 또는 (b) 두 번째 시뮬레이터/계정. 권장: **시뮬레이터(멤버 A) + 데스크톱 브라우저(멤버 B)** 조합으로 cross-surface 실시간 확인.

---

## 4. SPEC별 검증 체크리스트 (in-WebView)

각 항목을 시뮬레이터에서 직접 수행하고 [ ]→[x] 표시. 모임 상세(`/home/{id}`)는 WebView 안에서 렌더된다.

### MOIM-003 모임 상세 진입 + 네이티브 push
- [ ] 홈 탭 → 모임 카드 탭 → 상세가 네이티브 push 로 열림(expo-router Stack), 상세 콘텐츠는 WebView 렌더.
- [ ] 뒤로가기(네이티브 제스처/헤더) 동작.

### MOIM-004 모임 생성 + 일정/장소 필드
- [ ] "새 모임 만들기" → 이름/호스트 이름 입력 + (선택) 일정(datetime)·장소 입력 → 생성 → 상세 진입.
- [ ] 일정 미설정 시 "일정 미정", 설정 시 포맷 표시. 장소 설정 시 표시.

### MOIM-005 단일 선택 투표
- [ ] 상세에서 "투표 만들기" → 일반 종류 + 질문/선택지 2개 → 생성.
- [ ] 선택지 탭 → 득표 수/퍼센트 반영, 내 선택 강조("내 선택이 반영됐어요").
- [ ] 다른 선택지 탭 → 교체(총 1표 유지).

### MOIM-006 다중 선택
- [ ] "여러 개 선택 허용" 켜고 생성 → "여러 개 선택 가능" 안내 + 체크박스형 옵션.
- [ ] 여러 옵션 탭 → 동시 강조(토글 추가), 다시 탭 → 해제(토글 제거).

### MOIM-007 마감 + 투표 차단
- [ ] 생성자에게만 "마감하기" 노출(비생성자 계정에선 미노출).
- [ ] (선택) 마감 시각 datetime 입력 → "마감 예정" 표시.
- [ ] "마감하기" 탭 → "마감됨" 배지 + 투표 컨트롤 비활성화 + 결과 유지("마감된 투표예요").
- [ ] 마감된 투표 탭 시 투표 안 됨(409 차단 — UI 비활성).

### MOIM-008 날짜 투표 자동 확정
- [ ] "날짜" 종류 선택 → 선택지가 datetime 입력으로 전환 → 날짜 2개 입력 → 생성.
- [ ] 옵션이 포맷된 날짜로 표시(raw ISO 아님). "마감하면 최다 득표 날짜가 모임 일정으로 확정돼요" 안내.
- [ ] 단일 승자 만들고 "마감하기" → **모임 헤더 일정(startsAt)이 그 날짜로 확정 갱신**.
- [ ] 동점/무표로 마감 시 일정 미확정 + 안내.

### MOIM-009 투표 결과 실시간 갱신 (cross-surface)
- [ ] 시뮬레이터(멤버 A) + 데스크톱 브라우저(멤버 B)에서 **같은 모임 상세**를 동시에 연다.
- [ ] 한쪽에서 투표 생성 → 다른 쪽이 **리로드 없이** 새 투표 등장.
- [ ] 한쪽에서 투표 → 다른 쪽 득표 수 라이브 갱신.
- [ ] 한쪽에서 마감 → 다른 쪽 "마감됨" 라이브 반영.
- [ ] 날짜/장소 투표 finalize → 다른 쪽 **모임 헤더 일정/장소 라이브 확정**.
- [ ] **핵심**: WebView 안에서 Supabase Realtime WebSocket 이 차단 없이 연결되고 router.refresh 가 WebView 네비게이션 컨텍스트에서 재렌더를 일으키는지(웹 데스크톱에선 확인됨 — WebView 가 관건).
- [ ] 비멤버 계정은 그 모임 상세 접근 시 차단(RLS — 비멤버는 상세/실시간 미수신).

### MOIM-010 장소 투표 자동 확정
- [ ] "장소" 종류 선택 → 선택지가 텍스트(장소명) 입력 → 장소 2개 입력 → 생성.
- [ ] "마감하면 최다 득표 장소가 모임 장소로 확정돼요" 안내, 옵션은 장소명 텍스트.
- [ ] 단일 승자 만들고 "마감하기" → **모임 헤더 장소(location)가 그 장소로 확정 갱신**.

### CHAT-001 실시간 채팅 (이미 라이브 검증됨 — WebView 재확인)
- [ ] "채팅 입장" → 채팅 화면(WebView). 메시지 전송 → 다른 멤버에게 실시간 수신.
- [ ] 비멤버 차단(RLS).

---

## 5. completed 전환 기준

각 SPEC의 위 체크리스트가 시뮬레이터에서 모두 PASS 하면:
1. `.moai/specs/SPEC-{ID}/acceptance.md` 에 "iOS 시뮬레이터 검증 완료(YYYY-MM-DD)" 증거 추가.
2. `.moai/specs/SPEC-{ID}/spec.md` frontmatter `status: in-progress → completed`, HISTORY 항목 추가.
3. `manager-docs` sync 로 CHANGELOG/structure/tech 의 status 표 갱신.

> 일부만 통과 시: 통과분만 completed, 나머지는 in-progress 유지 + 미통과 사유 기록.

---

## 6. 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| Google Sign-In 외부 브라우저 이탈 | bridge `auth:google-request` 미동작 | useAuthBridge onMessage + nativeGoogleSignInRef 확인(MOBILE-004) |
| WebView 가 빈 화면/연결 실패 | EXPO_PUBLIC_WEB_URL 미설정/오류 | .env 의 localhost:3000 확인, 백엔드/웹 기동 확인 |
| 실시간 미수신(WebView) | WebView 내 WebSocket 차단/CSP | proxy.ts connect-src 에 ws://localhost:54321 포함 확인(CHAT-001 CSP 수정), Supabase 기동 확인 |
| pod install 실패 | AppCheckCore modular headers | withModularHeaders 플러그인 → `use_modular_headers!` Podfile 주입 확인 |
| 마감/투표 후 화면 미갱신 | router.refresh / Server Action | WebView 안 네비게이션 컨텍스트 확인(데스크톱은 확인됨) |

---

## 부록 A. 웹 UI 멀티탭 워크스루 결과 (2026-06-22, 자율 검증)

chrome-devtools 2 격리 세션(앨리스=생성자/방장, 밥=멤버), 모임 1개:

| SPEC | 검증 내용 | 결과 |
|------|-----------|------|
| MOIM-005 | 일반 투표 생성 + 단일 투표(라면 1표 100%) | PASS |
| MOIM-006 | 다중 선택 투표(토요일+일요일 동시 체크, 각 1표) | PASS |
| MOIM-007 | 생성자 전용 "마감하기" + 마감됨 배지 + 비활성 + 결과 유지 | PASS |
| MOIM-008 | 날짜 투표(포맷 표시) finalize → 헤더 일정 "2026년 7월 4일 오후 6:00" 확정 | PASS |
| MOIM-009 | 생성/투표/마감/헤더 finalize 모두 상대 멤버에게 리로드 없이 라이브 전파, per-user myVotes 정확 | PASS |
| MOIM-010 | 장소 투표(텍스트) finalize → 헤더 장소 "강남역 2번 출구" 확정, 3-way 종류 선택 | PASS |

→ 웹 표면은 검증 완료. 모바일 WebView + 네이티브 Google Sign-In 검증만 남음(본 런북).
