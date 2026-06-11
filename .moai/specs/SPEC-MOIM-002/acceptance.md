# Acceptance — SPEC-MOIM-002 (초대 링크 + 게스트 참여)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 모든 AC는 단일 REQ를 커버한다(1:1+). 실패 코드 고정: 미지 404 / 만료·폐기 410 / max_uses 초과 409 / 인가 403.

## Given/When/Then 시나리오

### AC-1 (REQ-INV-001) — host 초대 발급
- **Given** 모임 A의 owner U
- **When** `POST /moims/A/invites { maxUses?: 5 }`
- **Then** 201 + 초대 생성 (token ≥128-bit 엔트로피, `expiresAt = now+7d` 기본, `usedCount=0`) + 토큰 반환

### AC-2 (REQ-INV-005) — 게스트 초대 수락 + 가입
- **Given** 유효 토큰 T (미만료·미폐기·max_uses 여유) + 익명 로그인 세션(실제 sub) + nickname "게스트1"
- **When** `POST /invites/T/accept { nickname: "게스트1" }`
- **Then** 200 + 해당 모임에 멤버십(role=member, nickname="게스트1") 생성 + 초대 `usedCount` 1 증가

### AC-3 (REQ-INV-006) — 미지/만료/폐기/초과 토큰 거부 (고정 코드)
- **Given** (a) 미지 토큰 / (b) 만료 토큰 / (c) 폐기 토큰 / (d) max_uses 초과 토큰
- **When** `POST /invites/:token/accept`
- **Then** (a) 404 / (b) 410 / (c) 410 / (d) 409 + 멤버십 미생성 + `usedCount` 불변

### AC-4 (REQ-INV-003) — host 초대 폐기
- **Given** 모임 A의 owner + 유효 초대 I
- **When** `DELETE /moims/A/invites/I`
- **Then** 200 + I가 폐기 상태(`revokedAt` 설정) → 이후 수락 410 (AC-3c)

### AC-5 (REQ-INV-004) — 비-owner 초대 관리 차단 (발급/목록/폐기)
- **Given** 모임 A의 일반 멤버 V (비-owner)
- **When** V가 (a) `POST /moims/A/invites` / (b) `GET /moims/A/invites` / (c) `DELETE /moims/A/invites/I`
- **Then** 세 경우 모두 403 + 부작용 없음 (목록 응답의 live 토큰 미노출)

### AC-6 (REQ-INV-002) — owner 초대 목록 조회
- **Given** 모임 A의 owner U + 유효/폐기 초대 다수
- **When** U가 `GET /moims/A/invites`
- **Then** 200 + 해당 모임의 초대 목록(각 상태 포함) 반환

### AC-7 (REQ-INV-005, 멱등) — 이미 멤버의 재수락
- **Given** 이미 모임 A의 멤버인 사용자 + 유효 토큰 T
- **When** `POST /invites/T/accept` 재호출
- **Then** 200 + 중복 멤버십 미생성 + `usedCount` 불변 (멱등)

### AC-8 (REQ-INV-007) — 게스트 웹 랜딩 흐름
- **Given** 세션 없는 방문자가 `/invite/[token]` 진입
- **When** 페이지 로드 → 익명 로그인 → nickname 입력 → 수락 제출
- **Then** 익명 세션 확보 + 멤버십 생성 + `/moims/[id]/chat`로 리다이렉트 (웹 검증: `nx build web` + `lint`)

## 엣지 케이스

- nickname 빈/누락 → 400 (REQ-INV-005 입력 검증)
- 존재하지 않는 토큰 → 404 (AC-3a와 동일)
- max_uses 경계 동시 다발 수락 → 사용 횟수 조건부 원자 증가로 초과 방지(409)
- expiresAt 상한(30일) 초과 발급 요청 → 400 (REQ-INV-001 상한)
- 쿠키 삭제 후 같은 링크 재방문 → 새 익명 sub로 별도 게스트 참여(기존 멤버십과 분리 — 문서화된 제약, 버그 아님)

## 품질 게이트 기준

- **백엔드 테스트**: jest, 커버리지 **85%+** (토큰 검증·만료·폐기·max_uses·멱등·owner 403·목록 owner 전용 경로 포함).
- **웹**: 테스트 하니스 없음 → `nx build web` + `lint`만 (기존 합의).
- 토큰 엔트로피 ≥128-bit 검증(생성 단위 테스트).
- `auth.enable_anonymous_sign_ins = true` 로컬 적용 확인.
- openapi.json + api-client 재생성 후 typecheck 통과.

## Definition of Done

- [ ] `MoimInvite` 모델 + 마이그레이션
- [ ] 발급/목록/폐기 (전부 owner 전용, 비-owner 403) + 수락(검증/멱등/usedCount)
- [ ] 실패 코드 고정(404/410/409/403) 단위 테스트
- [ ] 웹 `/invite/[token]` 랜딩 (익명 로그인 → nickname → accept → /moims/:id/chat)
- [ ] `enable_anonymous_sign_ins = true`
- [ ] 백엔드 커버리지 85%+, 웹 build/lint green
- [ ] abuse 완화(rate limit/만료 상한/revoke/maxUses) 문서화
- [ ] openapi + api-client 재생성
