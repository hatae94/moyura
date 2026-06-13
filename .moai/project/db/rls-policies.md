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
| `realtime.messages` | `members can receive moim broadcasts` | SELECT (authenticated) | `EXISTS (SELECT 1 FROM moim_member m WHERE 'moim:'\|\|m.moim_id = realtime.topic() AND m.user_id = auth.uid())` | SPEC-CHAT-001 AC-4 — private 채널 구독 인가(비멤버 구독 거부). 마이그레이션 `20260613175232_add_chat` 수동 SQL |
| `chat_message` | (정책 없음 — default deny) | ALL | RLS enable + 정책 부재 = 모두 거부 | SPEC-CHAT-001 — anon/authenticated PostgREST 직접 접근 차단. Prisma(postgres 롤)는 영향 없음(쓰기 인가 = NestJS 서비스 레이어) |

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
