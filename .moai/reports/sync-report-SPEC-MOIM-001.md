# Sync Report — SPEC-MOIM-001 (모임 도메인)

**Date**: 2026-06-13  
**Branch**: feature/SPEC-MOBILE-004  
**Commit (run)**: cc37924  
**Synced by**: manager-docs

---

## 상태 전이

| 항목 | 이전 | 이후 |
|------|------|------|
| spec.md status | `draft` | `completed` |
| spec.md version | `0.1.1` | `0.2.0` |
| spec.md updated | `2026-06-11` | `2026-06-13` |

---

## 동기화된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-MOIM-001/spec.md` | frontmatter status/version/updated 갱신, HISTORY v0.2.0 항목 추가, "Implementation Notes (as-implemented)" 섹션 신규 추가 |
| `.moai/specs/SPEC-MOIM-001/acceptance.md` | 라인 60 C-2 교정: `api-client:build` → `api-client:generate` + `api-client:typecheck` |
| `CHANGELOG.md` | [Unreleased] > Added 첫 항목으로 MOIM-001 항목 추가 |
| `.moai/project/structure.md` | `apps/backend/src/moim/` 모듈 항목 추가, prisma/ 설명 업데이트 |
| `.moai/project/tech.md` | 도입부 MOIM-001 완료 선언 추가, 구현됨/계획됨 표에 MOIM-001 행 추가, 주요 설정 파일 표에 moim/ + migration 항목 추가 |
| `.moai/project/db/schema.md` | frontmatter 갱신, profile/moim/moim_member 3개 테이블 전체 문서화 |
| `.moai/project/db/erd.mmd` | PROFILE + MOIM + MOIM_MEMBER 엔티티 + 관계 다이어그램 추가 |
| `.moai/project/db/migrations.md` | 2개 마이그레이션(init_profile + add_moim) 항목 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-001.md` | 본 문서 (신규) |

---

## Acceptance C-2 교정 확인

- **수정 전**: `nx run api-client:build` 통과
- **수정 후**: `nx run api-client:generate` + `nx run api-client:typecheck` 통과 (api-client:build 타겟 부재 — C-2 교정)
- **위치**: `.moai/specs/SPEC-MOIM-001/acceptance.md` 품질 게이트 기준 마지막 항목

---

## DB 문서 수동 갱신 내역

db.yaml auto-sync는 현재 `enabled: false` 상태로 옵트아웃되어 있다. 본 sync에서 SPEC-MOIM-001 커밋 상태를 기준으로 수동 갱신했으며, 이로써 코드와 문서 간 drift가 해소되었다.

### 추가된 테이블/엔티티

| 파일 | 추가 내용 |
|------|-----------|
| `schema.md` | `moim` 테이블 (id, name, created_by, created_at), `moim_member` 테이블 (moim_id+user_id 복합 PK, nickname, role, joined_at), `profile` 테이블 (기존 stub 대체), Relationships/Indexes/Constraints 섹션 구체화 |
| `erd.mmd` | `PROFILE`, `MOIM`, `MOIM_MEMBER` 엔티티 + `MOIM ||--o{ MOIM_MEMBER : "has members (Cascade)"` 관계 |
| `migrations.md` | `20260602095934_init_profile` + `20260613155202_add_moim` 항목 추가 |

---

## MX 태그 상태

run 단계에서 구현 코드에 설정된 MX 태그 현황 (sync 시점 확인):

| 태그 | 위치 | 설명 |
|------|------|------|
| `@MX:ANCHOR` | `moim.service.ts` — `assertMember` | 멤버십 인가 단일 출처 — 하위 SPEC(CHAT-001/MOIM-002) 재사용 계약 |
| `@MX:ANCHOR` | `moim.service.ts` — `assertOwner` | owner 인가 단일 출처 — 하위 SPEC 재사용 계약 |
| `@MX:ANCHOR` | `moim.service.ts` — `createMoim` | 원자 트랜잭션 진입점 계약 |
| `@MX:NOTE` × 3 | `moim.service.ts`, `moim.controller.ts` 등 | 도메인 컨텍스트 전달 |

---

## Evaluator LOW findings — 수용 처리

| Severity | 설명 | 처리 |
|----------|------|------|
| LOW | `getMoim` double-read — DB 쿼리 3회 (성능 비효율, 기능 결함 아님) | 수용 — 후속 최적화 작업으로 연기. spec.md Implementation Notes에 기록. |
| LOW | `leave()` 404 단일 응답 — "모임 없음"과 "멤버십 없음"을 구분하지 않음 | 수용 — SPEC 엣지 시나리오 정확히 충족, 비멤버에게 모임 존재 여부를 숨기는 보안 이점 있음. spec.md Implementation Notes에 기록. |

---

## 품질 게이트 최종 확인

| 게이트 | 결과 |
|--------|------|
| jest 105/105 | PASS |
| coverage 96.79% (모임 100%) | PASS (임계값 85% 초과) |
| nx run backend:typecheck | PASS (0 errors) |
| nx run api-client:generate + typecheck | PASS |
| evaluator-active | PASS (Functionality 95 / Security 95 / Craft 88 / Consistency 95) |
| TRUST 5 | PASS |

---

Version: 1.0.0 | SPEC-MOIM-001 | Phase 3 (sync)
