# 신고·차단 운영 절차 (Safety Operations Runbook)

SPEC: SPEC-SAFETY-001 (신고·차단 — UGC 모더레이션)
대상 요구사항: REQ-STO-001(신고 데이터 보존 — 운영자 수동 검토), REQ-STO-002(24시간 조치 — 운영 절차)
버전: 1.0 · 최종 갱신: 2026-07-02

> 이 문서는 **코드가 아니라 운영 절차**다. SPEC-SAFETY-001은 관리자 UI·자동 모더레이션
> 워크플로우를 구축하지 않는다(제외 범위). 신고 데이터는 DB에 보존되며, 검토·조치는
> 아래 수동 절차로 수행한다. 스토어 정책(Apple 1.2 UGC / Google Play)의 "신고 및 24시간 내
> 조치" 요건을 이 절차로 충족한다.

---

## 1. 데이터 소재 (Where the data lives)

신고는 `report` 테이블에, 차단은 `block` 테이블에 보존된다. 두 테이블 모두
RLS default-deny(정책 없음)이므로 anon/authenticated PostgREST 직독은 불가하며,
**`postgres` 롤(서비스 롤 / DB 콘솔)로만** 조회한다.

### `report` (신고 원장 — 운영자 검토 대상)

| 컬럼 | 의미 | 검토 활용 |
|------|------|-----------|
| `id` | 신고 uuid | 신고 식별 |
| `reporter_id` | 신고자 sub(`profile.id`) | 누가 신고했는가 |
| `target_user_id` | 피신고 콘텐츠 작성자 sub | 누구를 조치할 것인가 |
| `moim_id` | 신고 컨텍스트 모임 id (FK→`moim`, CASCADE) | 어느 모임에서 |
| `reason` | 신고 사유(자유 텍스트) | 신고 내용 |
| `content_type` | `chat_message`\|`poll`\|`expense`\|`settlement_request` (CHECK 제약) | 어떤 UGC 유형 |
| `content_id` | 신고 콘텐츠 id (TEXT) | 원본 콘텐츠 추적 |
| `created_at` | 신고 시각 | 24h 조치 기한 기준점 |

> `content_id`는 TEXT로 통일 저장된다. `content_type='chat_message'`인 경우 원본
> `chat_message.id`가 BigInt PK이므로 원본 조회 시 BigInt로 캐스팅한다(REQ-RPT-005).

### `block` (뷰어 측 차단 — 조치 참고용)

| 컬럼 | 의미 |
|------|------|
| `blocker_id` | 차단자 sub |
| `blocked_user_id` | 차단 대상 sub |
| `created_at` | 차단 시각 |

차단은 **1-way, per-viewer**다. 차단은 조치가 아니라 뷰어 측 숨김이며, 신고(`report`)와
독립이다(신고 ≠ 차단). 운영 조치 판단은 `report` 기준으로 한다.

---

## 2. 신고 검토 절차 (Manual review)

### 2.1 미검토 신고 조회 (최근순)

```sql
-- postgres 롤로 실행. 최근 신고부터 검토.
SELECT id, reporter_id, target_user_id, moim_id, content_type, content_id, reason, created_at
FROM report
ORDER BY created_at DESC
LIMIT 100;
```

### 2.2 특정 대상 유저의 신고 누적 조회 (반복 위반자 식별)

```sql
-- target_user_id 인덱스(@@index([target_user_id])) 활용.
SELECT content_type, COUNT(*) AS report_count, MIN(created_at) AS first_report, MAX(created_at) AS last_report
FROM report
WHERE target_user_id = :target_sub
GROUP BY content_type
ORDER BY report_count DESC;
```

### 2.3 원본 콘텐츠 확인 (content_type 별)

- `chat_message`: `SELECT * FROM chat_message WHERE id = CAST(:content_id AS BIGINT);`
- `poll`: `SELECT * FROM poll WHERE id = :content_id;`
- `expense`: `SELECT * FROM expense WHERE id = :content_id;`
- `settlement_request`: `SELECT * FROM settlement_request WHERE id = :content_id;`

> 조회 대상 테이블 PK 타입에 맞춰 캐스팅한다. `chat_message`만 BigInt다.

---

## 3. 24시간 조치 절차 (REQ-STO-002)

스토어 요건: **UGC 신고 접수 후 24시간 이내 조치**. 관리자 UI/자동 워크플로우는
미구축이므로 아래 수동 절차로 대응한다. 조치 기한 = `report.created_at + 24h`.

### 3.1 조치 판단 기준

| 판단 | 조치 |
|------|------|
| 명백한 정책 위반(혐오·스팸·불법·성적 콘텐츠) | 콘텐츠 제거 + 작성자 제재 |
| 경계선/맥락 필요 | 모임 owner 확인 후 판단 |
| 오신고/무효 | 조치 없음(신고 보관) |

### 3.2 콘텐츠 제거 (DB 직접, 서비스 레이어 부재)

SPEC-SAFETY-001은 **글로벌 콘텐츠 삭제 API를 제공하지 않는다**(뷰어 측 필터만
구축, 제외 범위). 즉시 제거가 필요하면 `postgres` 롤로 원본 행을 직접 삭제한다.

```sql
-- 예: 신고된 chat_message 제거
DELETE FROM chat_message WHERE id = CAST(:content_id AS BIGINT);
```

> 삭제는 되돌릴 수 없다. 삭제 전 §2.3으로 원본을 반드시 확인하고, 필요 시 별도
> 백업(캡처/export)을 남긴다.

### 3.3 작성자 제재

반복 위반자(§2.2)는 SPEC-ACCOUNT-001의 계정 삭제/정지 절차로 이관한다. 본 SPEC
범위 밖(관리자 제재 UI 미구축).

### 3.4 조치 기록

관리자 UI가 없으므로 조치 이력은 **운영 로그(외부 시트/이슈 트래커)**에 수동 기록한다.
`report.id` + 조치 유형 + 처리자 + 처리 시각을 남긴다. `report` 테이블에는 조치
상태 컬럼이 없다(원장 보존만 — SPEC 범위).

---

## 4. 한계 및 의도된 동작 (Known limits)

- **per-viewer 차단**(R-13): 차단해도 owner·다른 멤버는 콘텐츠를 계속 본다. DB 직접
  조회·API는 차단과 무관하다(의도된 동작).
- **관리자 UI/자동 모더레이션 없음**: 신고 저장 + 수동 DB 조회만. 대량 신고 처리·
  자동 조치·검토 대시보드는 후속 SPEC 대상.
- **조치 상태 미추적**: `report`는 원장(append-only 저장)이며 검토/조치 상태 필드가
  없다. 조치 이력은 외부 운영 로그로 관리한다(§3.4).
- **콘텐츠 제거 = DB 직접**: 글로벌 삭제 API 부재. §3.2 SQL로 수동 제거.

---

## 5. 고아 행 정리 — SPEC-ACCOUNT-001 위임 통지 (M5-7)

> 이 절은 **위임 통지**다. SPEC-SAFETY-001은 정리 로직을 구현하지 않으며(제외 범위),
> `block`/`report` 고아 행 정리 소유자는 **SPEC-ACCOUNT-001(`deleteAccount`)**이다.

### 상태 (2026-07-02)

- **SAFETY 테이블 병합 완료**: `block`·`report` 테이블은 마이그레이션
  `20260702100000_add_safety`로 배포됨. 정리 대상(테이블)이 존재한다.
- 따라서 SPEC-ACCOUNT-001의 `deleteAccount` 트랜잭션은 **no-op 가드를 해제하고 정리
  2줄을 활성화**해야 한다(테이블 부재 순서 리스크 R-17 해소 — SAFETY 선행 병합 확정).

### 정리 계약 (ACCOUNT-001 소유 — 참고용)

ACCOUNT `deleteAccount(sub)`의 (2)단계 멱등 `$transaction`에 아래를 포함한다.
**Prisma 직접 접근**(`prisma.block`/`prisma.report`)으로 정리하며 `SafetyModule`/
`SafetyService`를 import하지 **않는다**(account↔safety 순환 의존 R-15 회피).

```ts
// SPEC-ACCOUNT-001 deleteAccount 트랜잭션 내부 (본 SPEC 편집 범위 밖 — 통지만)
await tx.block.deleteMany({ where: { OR: [{ blockerId: sub }, { blockedUserId: sub }] } });
await tx.report.deleteMany({ where: { OR: [{ reporterId: sub }, { targetUserId: sub }] } });
```

- **report 행 삭제 확정**(감사 보존 이관 없음): 탈퇴 사용자 연관 `report`는 대상 계정이
  소멸돼 운영자 수동 검토(REQ-STO-001)가 조치 불능이므로 보존 가치가 없다 → 함께 삭제.
- **잔존 무해성**: 정리 전이라도 존재하지 않는 userId는 필터에서 자연 무시되나,
  `report.target_user_id`가 삭제된 sub를 지목해 운영자 조치가 불능이 되는 문제를 정리로
  차단한다.
- **양쪽 plan 정합 확인 완료**(2026-07-02): SAFETY plan(R-10/§9)과 ACCOUNT plan
  (§3.2/§9, R-15/R-16/R-17)이 '정리 소유자 = ACCOUNT-001, SAFETY 테이블 선행'으로
  동일 방향. 상호 위임 커버리지 홀 없음.

---

## 참고

- 스키마: `.moai/project/db/schema.md` (Block/Report)
- RLS: `.moai/project/db/rls-policies.md` (block/report default-deny)
- 마이그레이션: `20260702100000_add_safety`
- 형제 SPEC: `.moai/specs/SPEC-ACCOUNT-001/` (고아 행 정리 소유자)
