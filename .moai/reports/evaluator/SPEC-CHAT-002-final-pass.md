# Evaluation Report — SPEC-CHAT-002 (FCM Background Push)

**SPEC**: SPEC-CHAT-002
**Harness**: standard / final-pass
**Branch**: feature/SPEC-MOBILE-004
**Evaluated**: 2026-06-14
**Evaluator**: evaluator-active (Sonnet 4.6)

---

## Overall Verdict: FAIL

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 88/100 | PASS | AC-1/2/3/4 단위 테스트 25/25 통과. 197/197 전체. AC-5 device-gated UNVERIFIED (expected). |
| Security (25%) | 72/100 | PASS | Medium IDOR 1건(unregister 소유권 미검증). Critical/High 없음. |
| Craft (20%) | 58/100 | FAIL | Branch coverage 76.27% < 85% 요건; orphan token 위험 경로. |
| Consistency (15%) | 90/100 | PASS | SupabaseAuthGuard/upsert/best-effort/MX tag 프로젝트 패턴 준수. |

---

## Test Run Evidence

### Backend: 197/197 PASS

```
Test Suites: 21 passed, 21 total
Tests:       197 passed, 197 total
```

Push 모듈 커버리지 (`--testPathPattern=push --coverage`):

```
src/push                    | 87.23 | 76.27 | 100 | 87.95
  device-token.controller.ts| 100   | 78.94 | 100 | 100   | 34-57
  device-token.service.ts   | 92.85 | 87.5  | 100 | 91.66 | 46
  fcm-sender.ts             | 95.65 | 73.33 | 100 | 95.23 | 47
  push.listener.ts          | 96.55 | 70.58 | 100 | 96.15 | 69
  push.module.ts            | 0     | 100   | 100 | 0     |
src/push/dto                | 100   | 100   | 100 | 100
```

### Mobile: 147/147 PASS

```
Test Files  17 passed (17)
Tests       147 passed (147)
```

### Typecheck

- `nx run backend:typecheck`: 0 errors (PASS)
- `apps/mobile tsc --noEmit`: 0 errors (PASS)
- `nx run api-client:typecheck`: 0 errors (PASS)

---

## Findings

### [HIGH-CRAFT] Branch Coverage 76.27% < 85% Requirement

- **파일**: `apps/backend/src/push/` (aggregate branch)
- **수치**: Statement 87.23% (PASS), Branch 76.27% (FAIL), Lines 87.95% (PASS)
- **상세 미달**:
  - `push.listener.ts:69` — `if (userIds.length === 0) return []` 분기 미커버. 수신자가 0명인 케이스(모임에 sender 혼자)에서 `resolveDeviceTokens`가 조기 반환하는 분기가 테스트되지 않음.
  - `fcm-sender.ts:47` — `if (admin.apps.length === 0)` else 분기 미커버. firebase-admin이 이미 초기화된 상태에서 재초기화 시도를 막는 가드의 false 경로 미테스트.
  - `device-token.controller.ts:34-57` — `@ApiXxx` 데코레이터 분기 미커버(이는 프레임워크 내부이므로 실질적 위험은 낮음).
- **재현 가능 케이스**: `push.listener.spec.ts`에 모임에 sender만 있고 다른 멤버가 없는 시나리오 추가 시 line 69 분기 커버 가능.
- **SPEC 요건**: acceptance.md "백엔드 테스트: jest, 커버리지 85%+ (이벤트→발송 mock, 등록/해제, sender/게스트 제외 로직)"

### [MEDIUM-SECURITY] DELETE /devices/:token — 소유권 미검증 (IDOR)

- **파일**: `apps/backend/src/push/device-token.controller.ts:57-58`
- **코드**:
  ```typescript
  async unregister(@Param('token') token: string): Promise<void> {
    await this.deviceTokens.unregister(token);
  }
  ```
- **문제**: `register`는 `@CurrentUser() user: VerifiedUser`로 JWT sub를 가져와 소유권을 binding하지만, `unregister`는 경로 파라미터 token만으로 즉시 삭제. 인증된 모든 사용자가 타인의 FCM 토큰을 DELETE 가능.
- **공격 시나리오**: 공격자가 피해자 A의 FCM 토큰 값 `tok-A`를 알고 있으면 `DELETE /devices/tok-A` 호출 → A는 이후 채팅 알림 미수신.
- **실용적 제약**: FCM 토큰은 API 응답으로 노출되지 않으므로 공격자가 사전에 토큰 값을 확보해야 함. 디바이스 공유/다른 취약점 연계 시 공격 가능. 영향: 데이터 유출 아님, Denial of Notification (서비스 방해).
- **분류**: OWASP A01:2021 Broken Access Control, IDOR. Severity: Medium.
- **대응**: `@CurrentUser() user: VerifiedUser` 추가 후 `this.deviceTokens.unregisterByOwner(user.sub, token)` 형태로 소유권 확인 후 삭제.

### [MEDIUM-CRAFT] unregisterDevice() 호출 시 orphan token 위험

- **파일**: `apps/mobile/hooks/useAuthBridge.ts:240`
- **코드**:
  ```typescript
  void unregisterDevice(); // 인자 없음
  ```
- **문제**: `registerDevice()`가 등록한 토큰 값을 반환하지만, 호출부(`AuthContext.tsx:129`)는 이 값을 저장하지 않음. 로그아웃 시 `unregisterDevice()`가 인자 없이 호출되면 내부에서 `acquireDeviceToken()`을 재호출해 현재 토큰을 재획득 시도. 로그아웃 시점에 권한이 취소되거나 Expo 토큰 획득이 실패하면 `null` 반환 → 삭제 생략 → orphan token 발생.
- **영향**: REQ-PUSH-003 "orphan token 방지(로그아웃 후 푸시 수신 차단)" 요건이 일부 에지 케이스에서 보장되지 않음. 실기기에서 재현 빈도는 낮으나, 권한 취소 후 로그아웃 시나리오에서 발생 가능.
- **SPEC 엣지 케이스**: acceptance.md "로그아웃 시 토큰 미해제 → orphan token으로 푸시 수신(REQ-PUSH-003로 방지 — 로그아웃에 DELETE 연동 확인)"

### [INFO] 마이그레이션 파일명 비표준

- **경로**: `apps/backend/prisma/migrations/20260614_add_device_token/`
- **관찰**: 다른 마이그레이션들은 `YYYYMMDDHHMMSS_name` 형식(`20260613175232_add_chat`)인데, 이 마이그레이션은 `20260614_add_device_token` (시간 부분 없음).
- **영향**: Prisma가 디렉토리 이름 기준으로 정렬하므로 실행 순서 자체는 정상(`20260614 > 20260613`). SQL 내용은 올바름(PK, index 모두 정상). DB 없이 `migrate status` 실행 불가로 UNVERIFIED.
- **권고**: `prisma migrate dev --name add_device_token`으로 생성된 표준 이름으로 교체 권장.

### [INFO-AC5] AC-5 device-gated — UNVERIFIED (expected)

- **근거**: acceptance.md "NOTE: 이 시나리오는 device-gated — 자동 게이트만으로 completed 처리 금지."
- **자동 검증 전제조건**: `tsc --noEmit` PASS, `register-device-core.test.ts` / `notification-core.test.ts` PASS, `registerDevice()` / `unregisterDevice()` 래퍼 구현 확인 — 모두 충족.
- **수동 검증 필요**: 실기기 + dev build + Firebase 프로젝트 셋업 상태에서 백그라운드 수신 + 탭 네비게이션.

---

## AC-by-AC Verification

### AC-1 (REQ-PUSH-001): sender 제외, 멤버2 토큰으로만 1회 발송, nickname 서버 조회

- `push.listener.spec.ts:83-103` — **PASS**
- `deviceFindMany` mock이 `where.userId.in` 필터를 실제 Prisma처럼 적용 (sender 토큰 유출 방지 검증됨)
- `notification.title`이 `memberFindUnique`로 조회한 nickname `'발신자호스트'`임을 단언
- `send` 1회 호출, `tokens: ['tok-2']` (sender 미포함) 확인

### AC-2 (REQ-PUSH-002, REQ-PUSH-003): 등록 upsert, 해제 delete

- `device-token.service.spec.ts` — **PASS** (5개 테스트)
- upsert: `where: { token }`, `create/update: {token, userId: sub, platform}` — 추가 필드 없음
- delete: P2025 흡수 (멱등 해제) 검증됨
- 컨트롤러 테스트: sub-only (mass-assignment 차단) 검증됨

### AC-3 (REQ-PUSH-004): chat → push import 없음, push → chat-events만

- `loose-coupling.spec.ts` — **PASS**
- 독립 grep 확인: `chat/**` 에서 `push` import 0건 (단, `store.push()` 배열 메서드는 해당 없음)
- push 파일에서 `from '../chat/chat-events'` 외 chat 모듈 import 없음

### AC-4 (REQ-PUSH-006): 게스트(미등록) 제외, 등록 멤버에게만 발송

- `push.listener.spec.ts:105-120` — **PASS**
- deviceFindMany mock이 게스트 userId를 필터로 제외. `tokens: ['tok-2']`만 전달됨

### AC-5 (REQ-PUSH-005, REQ-PUSH-007): 실기기 수신 + 탭

- **UNVERIFIED** (expected, device-gated)
- 자동 전제조건(tsc, 순수 로직 테스트): PASS

---

## Security Probe Summary

| 항목 | 결과 |
|------|------|
| 의존 방향(chat→push compile): 없음 | PASS |
| mass-assignment (POST /devices): body userId 신뢰 않음, sub-only | PASS |
| FcmSender FIREBASE_CREDENTIALS 부재: no-op + 경고 (부팅 비차단) | PASS |
| FcmSender 발송 실패: throw 없음, best-effort 격리 | PASS |
| 비멤버 토큰 수신 여부: moim_member 기준 조회, 비멤버 배제 | PASS |
| self-push (sender 본인): sender 제외 로직 검증됨 | PASS |
| orphan token (로그아웃 시 해제): 해제 경로 있으나 acquireDeviceToken 재획득 실패 시 누락 위험 | MEDIUM |
| DELETE /devices/:token 소유권: 검증 없음 — IDOR | MEDIUM |
| 이벤트 리스너 예외 → ChatService.emit 전파: try/catch 격리, resolves.toBeUndefined 테스트 확인 | PASS |
| 401 미인증 요청: @UseGuards(SupabaseAuthGuard) 클래스 레벨 적용 | PASS |

---

## Recommendations

1. **[CRITICAL-CRAFT] Branch coverage 개선 (85% 충족)**:
   - `push.listener.spec.ts`에 sender만 있는 모임(수신자 0명) 시나리오 추가 → line 69 `if (userIds.length === 0)` 커버
   - `fcm-sender.spec.ts`에 `admin.apps.length > 0` 케이스(이미 초기화된 앱) 추가 → line 47 else 분기 커버
   - 목표: branch coverage ≥ 85%

2. **[MEDIUM-SECURITY] DELETE /devices/:token 소유권 검증 추가**:
   ```typescript
   async unregister(
     @CurrentUser() user: VerifiedUser,
     @Param('token') token: string,
   ): Promise<void> {
     await this.deviceTokens.unregisterByOwner(user.sub, token);
   }
   ```
   서비스에서 `where: { token, userId: sub }` 로 소유자 확인 후 삭제. 비소유 토큰은 404 반환.

3. **[MEDIUM-CRAFT] unregisterDevice() 토큰 명시적 전달**:
   - `AuthContext.tsx`에서 `registerDevice()` 반환 토큰을 `registeredTokenRef`로 보관
   - `unregisterDevice(registeredTokenRef.current)` 호출로 orphan token 위험 제거
   - 현재 코드에서 `registerDevice()`가 이미 등록 토큰을 반환하므로 보관 로직만 추가하면 됨

4. **[INFO] 마이그레이션 파일명 표준화**:
   - `20260614_add_device_token` → `prisma migrate dev --name add_device_token` 으로 표준 타임스탬프 이름 재생성 권장

5. **[INFO] AC-5 디바이스 게이트**:
   - Firebase 프로젝트 + dev build 셋업 후 실기기 백그라운드 수신 수동 검증 완료 시 status → completed 전환 가능
