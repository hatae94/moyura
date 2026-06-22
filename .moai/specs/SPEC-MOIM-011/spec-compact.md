# SPEC-MOIM-011 (Compact)

> 초대 링크 생성 UI + 딥링크 (invite-create UI + moyura://invite 딥링크). 압축본 — 전체는 spec.md/plan.md/acceptance.md.

## 한 줄 요약

초대 백엔드(SPEC-INVITE)는 완성됐으나 (1) 초대를 _만들_ UI 가 없고 (2) 초대 링크에서 앱으로 들어올 딥링크가 없다. 본 SPEC 은 owner 전용 "초대하기"(웹, 발급+링크+복사) + 커스텀 scheme `moyura://invite/{token}` 딥링크(모바일 네이티브 라우트 → WebView 수락 페이지) + 웹 수락 페이지 "앱에서 열기" 버튼을 더한다. **백엔드 무변경.** **모바일은 변경됨**(신규 라우트 — device-gated).

## 확정 설계 결정 (재논의 없음)

- 딥링크 = **커스텀 scheme `moyura://invite/{token}`**(Universal Links 아님 — localhost 에서 associatedDomains 불가, 제외). expo-router 파일 라우트가 scheme path 매핑.
- 웹→앱 = **명시적 "앱에서 열기" 버튼**(모바일 브라우저 한정). 자동 리다이렉트 없음. 미설치 → scheme no-op + 웹 닉네임 폼 폴백. 데스크톱 미노출.
- 스코프 = **한 SPEC**(생성 UI + 딥링크).

## EARS 요구사항 (REQ) → AC

| REQ | 요지 | AC |
|-----|------|----|
| REQ-MOIM11-001 | 백엔드 무변경 — 발급/목록/폐기/수락 4개 라우트 재사용, CreateInviteDto(expiresAt?/maxUses?)·token 그대로, 기본값(+7d/무제한), 기존 jest GREEN | AC-1 |
| REQ-MOIM11-002 | 발급 헬퍼 `lib/moim/invites.ts createInvite(api,moimId,body?)` — polls.ts 구체-경로 미러, token 반환, 로컬 미러 타입(schema 재생성 없음), Bearer 헤더만 | AC-2 |
| REQ-MOIM11-003 | 초대 생성 UI — owner 전용 "초대하기"(비-owner 미노출, 백엔드 403 이중 방어), 발급 → 링크 `{origin}/invite/{token}` 표시 → 복사(navigator.clipboard) → 피드백, 오류 일반화, Meetup 오렌지 | AC-3 |
| REQ-MOIM11-004 | 모바일 딥링크 라우트 `app/invite/[token]` — `${WEB_URL}/invite/{token}` BridgedWebView 호스팅(MOIM-003 미러), `moyura://invite/{token}` → 라우트 해석, 공개 랜딩(가드 미상속), 빈 token 안전, 수락 WebView 위임, OAuth 딥링크/탭 회귀 0 | AC-4 |
| REQ-MOIM11-005 | 웹 수락 "앱에서 열기" 버튼 — 모바일 한정(데스크톱 미노출), `window.location=moyura://invite/{token}`, 자동 리다이렉트 없음, 기존 닉네임 폼/익명/submitAccept/리다이렉트 보존, scheme 실패 시 웹 폴백 | AC-5 |
| REQ-MOIM11-006 | 보안 — 토큰 owner 한정(이중 방어), 수락 SupabaseAuthGuard, 버튼/딥링크는 이미 URL 의 토큰 그대로(새 채널 0), 오류 일반화 | AC-6 |
| REQ-MOIM11-007 | 회귀 보존 + 신규 컴파일 — 모임 상세/모바일 셸/수락 흐름 보존, backend invite jest GREEN, web tsc·lint·build 0, mobile tsc·vitest·expo export 0 | AC-7 |

## 수정/신규 파일 (델타)

- **[EXISTING/NO CHANGE]** `apps/backend/src/invite/**`(백엔드 무변경) · `apps/web/lib/invite/accept.ts` · `apps/web/lib/moim/polls.ts` · `apps/mobile/app.json`(scheme "moyura" 이미 설정) · `oauth.ts` · `route-map-core.ts` · `BridgedWebView.tsx` · `web-url.ts` · `(tabs)/home/[id].tsx`
- **[MODIFY]** `apps/web/app/invite/[token]/page.tsx`("앱에서 열기" 버튼 — 모바일 한정, 기존 폼 보존) · `apps/web/app/(main)/home/[id]/page.tsx`(owner 판정 + InviteSection prop) · `apps/mobile/app/_layout.tsx`(필요 시 scheme path linking)
- **[ADD]** `apps/web/lib/moim/invites.ts`(createInvite + InviteResult 미러) · `apps/web/app/(main)/home/[id]/invite-section.tsx`(owner 전용 Client 섬) · (선택) `invite-actions.ts`(Server Action) · `apps/mobile/app/invite/[token].tsx`(네이티브 라우트 → WebView) · (필요 시) `apps/mobile/app/invite/_layout.tsx`
- **[BREAK/REMOVE]** 없음(순수 추가).

## Exclusions (§4)

Universal Links/https 자동 열기 · 자동 scheme 리다이렉트(버튼만) · 초대 목록/폐기/관리 UI · per-invite 만료/maxUses 입력 UI(백엔드 기본값) · QR · OS 공유 시트 · Android 딥링크/app-links · 백엔드 invite 라우트 변경 · 새 수락 경로(WebView 위임) · api-client schema 재생성 · 네이티브 초대 생성 화면.

## 품질 게이트

backend 무변경(invite jest GREEN 회귀) → web tsc/lint/`nx run web:build` 0(생성 섬+헬퍼+수락 버튼) → mobile tsc/vitest 회귀 0(route-map-core)/`expo export` 0(신규 라우트) → **디바이스 종단**(owner 발급·복사 / `simctl openurl moyura://invite/{token}` 앱 열림 → WebView 수락 → 가입 / 미설치·데스크톱 폴백 / OAuth·탭·detail-push 회귀 0). web 생성·복사·수락 버튼 렌더는 데스크톱 브라우저 선검증 가능, scheme→앱 + "앱에서 열기" 발화는 iOS 시뮬레이터/기기 전용 → status `in-progress`(device-gated, ios-only).
