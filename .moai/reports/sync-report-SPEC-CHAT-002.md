# Sync Report — SPEC-CHAT-002 (FCM 백그라운드 푸시)

**Date**: 2026-06-14
**Branch**: feature/SPEC-MOBILE-004
**Commit (run)**: 48a3110
**Synced by**: manager-docs

---

## 상태 전이

| 항목 | 이전 | 이후 |
|------|------|------|
| spec.md status | `draft` | `in-progress` |
| spec.md version | `0.1.1` | `0.2.0` |
| spec.md updated | `2026-06-11` | `2026-06-13` |

> `completed`가 아닌 `in-progress` 유지 근거: AC-5(실기기 FCM 백그라운드 수신 + 알림 탭)는 Firebase 프로젝트 셋업 + dev build + 실기기 수동 검증이 필요하다. 자동 게이트(jest 206/206, vitest 151/151, tsc 0, loose-coupling.spec) 통과만으로 completed 처리하지 않는다 — §8 명시, mobile-spec-device-gated 관례 동일 적용.

---

## 동기화된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-CHAT-002/spec.md` | frontmatter status(`draft`→`in-progress`) / version(`0.1.1`→`0.2.0`) / updated(`2026-06-11`→`2026-06-13`) 갱신. HISTORY v0.2.0 항목 추가(run 완료 요약: DeviceToken+PushListener+FcmSender+mobile 배선, 검증 지표, IDOR 수정, status→in-progress 근거). "## Implementation Notes (as-implemented)" 신규 섹션 추가(구현된 파일 목록, 계획 대비 수정 사항 6건, 브랜치 커버리지 현실, 마이그레이션 체크섬 드리프트 대응, device-gated AC-5 보류 설명). |
| `.moai/specs/SPEC-CHAT-002/acceptance.md` | 변경 없음 — `api-client:build` 오류 참조 없음(line 48: `typecheck 통과`로 이미 올바름). |
| `CHANGELOG.md` | [Unreleased] > Added 최상단에 CHAT-002 항목 추가(CHAT-001 위) — 자동 게이트 지표, DeviceToken 모델+마이그레이션+등록/해제 API(IDOR 차단), PushListener(단방향/sender·게스트 제외/서버 측 nickname), FcmSender(graceful no-op), 느슨한 결합(chat↛push), mobile expo-notifications(등록/수신/탭+로그아웃 해제) 커버. |
| `.moai/project/structure.md` | `apps/backend/src/push/` 모듈 항목 추가(PushModule/PushListener/@OnEvent 단방향/FcmSender/DeviceTokenService·Controller/dto/loose-coupling.spec). prisma/ migrations에 `20260614_add_device_token` 추가. schema.prisma 모델 목록에 DeviceToken 추가. `apps/mobile/hooks/useAuthBridge.ts` 설명에 FCM 해제 연동 명시. `apps/mobile/lib/` 설명에 AuthContext FCM 배선 + push/ 디렉터리 명시. |
| `.moai/project/tech.md` | 도입부 CHAT-002 완료 선언 추가. 구현됨/계획됨 표 상단에 CHAT-002 행 추가(in-progress, device-gated). mobile 프레임워크 표에 `expo-notifications@~56.0.17` 추가. config 검증 항목에 `FIREBASE_CREDENTIALS` optional 언급. FCM 푸시 인프라 항목 신규 추가(firebase-admin@^13.10.0, FIREBASE_CREDENTIALS env, no-op 정책). |
| `.moai/project/db/schema.md` | Tables 표에 `device_token` 행 추가. `device_token` 테이블 섹션 신규 추가(5컬럼 명세, 인덱스, IDOR 차단 설명, PostgREST 미노출 명시). Relationships 주석에 device_token.user_id 포함 + 독립 레지스트리 언급. Indexes 표에 device_token 2행 추가(PK, @@index userId). Constraints 표에 device_token PK 추가. |
| `.moai/project/db/erd.mmd` | 최종 갱신 날짜 코멘트 업데이트. `DEVICE_TOKEN` 엔티티 추가(token PK, user_id, platform, created_at, updated_at). 관계선 없음 — device_token은 moim과 FK 없는 독립 레지스트리(user_id = profile.id 논리적 연결). |
| `.moai/project/db/migrations.md` | Applied Migrations 표에 `20260614_add_device_token` 행 추가(device_token 테이블, @@index userId, 마이그레이션 파일명 시간 부분 미포함 주의, db execute + migrate resolve 적용 방식 명시). Pending Migrations 표에 `20260614_add_device_token` prod 배포 행 추가. Rollback Notes 표에 `20260614_add_device_token` 행 추가(DROP TABLE). |
| `.moai/reports/sync-report-SPEC-CHAT-002.md` | 본 리포트 신규 생성. |

---

## 자동 게이트 결과 요약

| 게이트 | 결과 | 근거 |
|--------|------|------|
| backend jest | 206/206 PASS | push 모듈 25건 + 기존 181건 |
| mobile vitest | 151/151 PASS | register-device-core / notification-core 순수 로직 포함 |
| backend tsc | 0 errors | `nx run backend:typecheck` |
| mobile tsc | 0 errors | `apps/mobile tsc --noEmit` |
| api-client typecheck | 0 errors | `nx run api-client:typecheck` |
| prisma migrate status | clean | `20260614_add_device_token` 포함 드리프트 없음 |
| 느슨한 결합(chat↛push) | PASS | grep 0건 + `loose-coupling.spec.ts` |
| evaluator Security | PASS | IDOR fix(unregisterByOwner) 적용 후 |
| TRUST 5 | PASS | Tested/Readable/Unified/Secured/Trackable |

**device-gated (AC-5)**: 자동 전제조건(tsc, register-device-core/notification-core 테스트) PASS. 실기기 수동 검증 보류.

---

## 배치 완료 메모 — MOIM-002 → CHAT-001 → CHAT-002 자율 배치

본 SPEC은 `feature/SPEC-MOBILE-004` 브랜치에서 진행된 자율 배치(autonomous batch)의 마지막 SPEC이다.

| SPEC | 최종 status | 보류 게이트 |
|------|-------------|-------------|
| SPEC-MOIM-002 | completed | 없음 — 백엔드+웹, 디바이스 게이트 없음 |
| SPEC-CHAT-001 | in-progress | realtime 종단·RLS 구독·브라우저 런타임 검증 (런타임·브라우저 게이트) |
| SPEC-CHAT-002 | in-progress | 실기기 FCM 수신·탭 검증 (device-gated) |

CHAT-001과 CHAT-002는 각각 다른 게이트를 보류 중이다:
- CHAT-001: Supabase Realtime 종단 + RLS 구독 — 로컬 Supabase 스택 + 브라우저 런타임 필요
- CHAT-002: Firebase 프로젝트 + dev build + 실기기 FCM 수신/탭 — 플랫폼 빌드 환경 필요

두 SPEC 모두 자동 단위/통합 게이트는 전부 통과한 상태로 배치가 종료된다.
