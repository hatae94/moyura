# SPEC-PROFILE-001 Acceptance

> 웹은 테스트 하니스 부재 → build/lint/tsc + 데스크톱/디바이스 워크스루로 검증(프로젝트 메모리 `web-no-test-harness`). 백엔드 무변경(기존 me jest 회귀).

## AC-1: 개인정보 조회 (← REQ-PROF-002)

- **Given** 로그인(이름 보유) 사용자가 `/profile`(마이) 에 진입하면 **Then** 이메일(read-only)·가입일(read-only)·표시 이름이 표시된다.
- [x] Server Component requireNamedSession → 이메일(session.user.email)/가입일(createdAt)/이름(profile.name) 렌더. — web tsc/lint/build 0
- [ ] 디바이스: iOS "마이" 탭 WebView 개인정보 표시 실관찰 — PENDING device-gated

## AC-2: 표시 이름 수정 (← REQ-PROF-003)

- **Given** 표시 이름을 바꿔 "저장" 하면 **Then** `PATCH /me` 로 영속되고 "저장되었습니다" 피드백이 같은 화면에 표시된다.
- **And** 빈 값 저장 → "이름을 입력해 주세요" 오류(머무름). 백엔드 실패 → 일반화된 오류(토큰/상세 비노출).
- [x] `updateProfileAction`(patchMe + revalidatePath) + `profile-form`(useActionState, ok/error 피드백). — web tsc/lint/build 0
- [ ] 디바이스: iOS "마이" 탭에서 이름 수정 → 저장 → 반영(모임/멤버 표시 이름 갱신) 실관찰 — PENDING device-gated

## AC-3: 가드 (← REQ-PROF-004)

- **Given** 미인증/이름 미보유 → `/login` 또는 `/onboarding` 리다이렉트((main) + requireNamedSession 상속).
- [x] (main)/layout + 페이지 requireNamedSession 가드. — me/page 패턴 미러, tsc 0

## AC-4: 로그아웃 + 모바일/회귀 (← REQ-PROF-005/006, REQ-PROF-001)

- [x] 로그아웃(signOutAction 재사용) 버튼.
- [x] 모바일 "마이" 탭(`(tabs)/profile.tsx`, `${WEB_URL}/profile` WebView) 신규 네이티브 코드 0 — 웹 페이지가 양 표면 커버.
- [x] 백엔드 무변경(기존 me 라우트/jest 회귀), Meetup 오렌지 토큰 일관, web build 0.
- [ ] 디바이스: 로그아웃 → 세션 해제 → 로그인 화면 실관찰 — PENDING device-gated

## device-gate

남은 device-gate: iOS 시뮬레이터/기기 "마이" 탭 WebView 워크스루(개인정보 표시 + 이름 수정 저장 반영 + 로그아웃). 사용자 수면 중이라 보류 — 깨어난 뒤 확인. 그 전까지 status `in-progress`(mobile-spec-device-gated).
