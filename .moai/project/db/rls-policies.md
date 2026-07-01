# Row-Level Security Policies

_TBD — Define RLS policies after running `/moai db init`. Uncomment and customize the examples
below for your database engine._

---

## Supabase RLS Policies

<!--
Enable RLS on a table and define policies using Supabase's PostgreSQL-compatible syntax.

-- Enable RLS on the users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own row
CREATE POLICY "users_select_own"
  ON users
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can only update their own row
CREATE POLICY "users_update_own"
  ON users
  FOR UPDATE
  USING (auth.uid() = id);

-- Policy: Service role bypasses RLS (for admin operations)
-- Note: service_role key automatically bypasses RLS in Supabase
-->

| Table | Policy Name | Operation | Condition | Notes |
|-------|------------|-----------|-----------|-------|
| `realtime.messages` | `members can receive moim broadcasts` | SELECT (authenticated) | `EXISTS (SELECT 1 FROM moim_member m WHERE 'moim:'\|\|m.moim_id = realtime.topic() AND m.user_id = auth.uid())` | SPEC-CHAT-001 AC-4 — private 채널 구독 인가(비멤버 구독 거부). 마이그레이션 `20260613175232_add_chat` 수동 SQL. poll/member/expense/schedule broadcast 가 이 정책을 재사용(신규 정책 없음) |
| `realtime.messages` | `users can receive own notifications` | SELECT (authenticated) | `realtime.topic() = 'user:'\|\|(SELECT auth.uid())::text` | SPEC-NOTIFICATIONS-001 M4a — per-user 알림 배지 채널 구독 인가(조인 불필요, 자기 `user:` 토픽만). `moim:` 정책과 공존(둘 다 SELECT → OR 결합). 마이그레이션 `20260702000000_add_notification_realtime_broadcast` 수동 SQL(`to_regnamespace` 가드) |
| `chat_message` | (정책 없음 — default deny) | ALL | RLS enable + 정책 부재 = 모두 거부 | SPEC-CHAT-001 — anon/authenticated PostgREST 직접 접근 차단. Prisma(postgres 롤)는 영향 없음(쓰기 인가 = NestJS 서비스 레이어) |
| `notification` | (정책 없음 — default deny) | ALL | RLS enable + 정책 부재 = 모두 거부 | SPEC-NOTIFICATIONS-001 M1 — 웹은 백엔드 API 로만 알림 열람. anon/authenticated 직독 차단(RLS enable 은 `20260701200000_add_notification`, 실시간 배지 방송·구독은 위 `realtime.messages` user: 정책 M4a) |
| `settlement_request` | (정책 없음 — default deny) | ALL | RLS enable + 정책 부재 = 모두 거부 | SPEC-NOTIFICATIONS-001 M2 — anon/authenticated 직독 차단. 마이그레이션 `20260701210000_add_settlement_request`. notification 과 동일 default-deny |

---

## PostgreSQL Policies

<!--
Standard PostgreSQL RLS policy syntax for non-Supabase deployments.

-- Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant isolation (multi-tenant schema)
CREATE POLICY "tenant_isolation"
  ON orders
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Policy: Admin role sees all rows
CREATE POLICY "admin_all_access"
  ON orders
  TO admin_role
  USING (true);
-->

| Table | Policy Name | Role | Operation | Condition |
|-------|------------|------|-----------|-----------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

---

## Access Control Matrix

<!-- Map roles to permitted operations per table -->

| Table | anonymous | authenticated | service_role | admin |
|-------|-----------|---------------|--------------|-------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

<!--
Example:
| users  | NONE     | SELECT (own row only) | ALL  | ALL   |
| posts  | SELECT   | SELECT + INSERT + UPDATE (own) | ALL | ALL |
| orders | NONE     | SELECT (own tenant)  | ALL  | ALL   |
-->
