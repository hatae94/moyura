# Acceptance — SPEC-MOIM-001 (모임 도메인)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 모든 AC는 단일 REQ를 커버한다(1:1+).

## Given/When/Then 시나리오

### AC-1 (REQ-MOIM-004) — 모임 생성 + 생성자 자동 멤버십
- **Given** 인증된 사용자 U (검증된 sub) 와 nickname "호스트"
- **When** `POST /moims { name, nickname: "호스트" }`
- **Then** 201 + 모임 생성 + U가 `role=owner`, `nickname="호스트"`인 멤버십으로 존재 (단일 트랜잭션)

### AC-2 (REQ-MOIM-002) — 비멤버 멤버 목록/단건 조회 403
- **Given** 모임 A의 비멤버이지만 인증된 사용자 V
- **When** `GET /moims/A/members` (그리고 `GET /moims/A`)
- **Then** 403 (401 아님 — V는 인증됨)

### AC-3 (REQ-MOIM-001) — 미인증 401 (전 라우트)
- **Given** Authorization 헤더 없음
- **When** 모임 라우트 각각(`POST /moims`, `GET /moims`, `GET /moims/:id`, `GET /moims/:id/members`, `DELETE /moims/:id`, `DELETE /moims/:id/membership`) 호출
- **Then** 각각 401 + 부작용 없음 (파라미터라이즈드 테스트로 전 라우트 커버)

### AC-4 (REQ-MOIM-007) — 일반 멤버 탈퇴
- **Given** 모임 A의 owner가 아닌 멤버 W
- **When** `DELETE /moims/A/membership`
- **Then** 204 + W의 멤버십 제거 (해당 멤버십만, 다른 멤버 불변)

### AC-5 (REQ-MOIM-006) — 멤버 목록 nickname 포함
- **Given** 모임 A에 owner "호스트" + member "참가자1"
- **When** 멤버가 `GET /moims/A/members`
- **Then** 200 + 두 멤버의 nickname("호스트", "참가자1")이 응답에 포함

### AC-6 (REQ-MOIM-005) — 모임 조회 (단건/목록)
- **Given** 모임 A, B의 멤버인 사용자 U
- **When** `GET /moims/A` 및 `GET /moims`
- **Then** 단건은 모임 A 정보 200; 목록은 U가 속한 모임(A, B)만 반환

### AC-7 (REQ-MOIM-003) — owner 전용 삭제
- **Given** 모임 A의 owner U / 비-owner 멤버 W
- **When** W가 `DELETE /moims/A`
- **Then** 403 (모임 미삭제); **그리고** U가 `DELETE /moims/A` → 204 + 모임 및 종속 멤버십 Cascade 삭제

### AC-8 (REQ-MOIM-008) — owner 탈퇴 금지
- **Given** 모임 A의 owner U
- **When** U가 `DELETE /moims/A/membership`
- **Then** 403 + U의 owner 멤버십 불변 (퇴장은 모임 삭제로만 가능)

## 엣지 케이스

- nickname 빈 문자열/누락 → 400 (DTO 검증)
- 존재하지 않는 모임 id로 조회 → 404
- 비멤버가 `DELETE /moims/A/membership`(가입한 적 없음) → **404** (멤버십 부재, 결정됨 — 부작용 없음)
- 마지막 일반 멤버 탈퇴 후 owner만 남은 모임 → 정상(owner는 항상 잔존, REQ-MOIM-008)

## 품질 게이트 기준

- **백엔드 테스트**: jest, statement 커버리지 **85%+** (TRUST 5).
- `nx run backend:typecheck` 통과 (Prisma generate 의존).
- `pnpm --filter @moyura/backend test` green.
- 마이그레이션 로컬 `:54322` 적용 성공 (drift 없음 — 본 SPEC은 수동 SQL 없음).
- api-client 재생성 후 `nx run api-client:build` 통과.

## Definition of Done

- [ ] `Moim`, `MoimMember`(nickname) 모델 + 마이그레이션 적용
- [ ] 멤버십 인가 헬퍼 단일 출처 구현 + @MX:ANCHOR
- [ ] 모임 생성/조회(단건·목록)/삭제(owner 전용) + 멤버 목록 + 탈퇴(owner 금지) 라우트 (전 라우트 가드)
- [ ] 401/403 구분 + owner-leave 403 + owner-only-delete 403 테스트 통과
- [ ] 커버리지 85%+, typecheck/test green
- [ ] openapi.json + api-client 재생성
