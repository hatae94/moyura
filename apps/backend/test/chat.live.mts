// 채팅 라이브 종단 증명 스크립트(SPEC-CHAT-001 AC-1c / AC-4). **수동/라이브 실행 — CI 게이트 아님.**
//
// jest VM(Prisma 7 WASM 제약) 밖에서 실제 Supabase 스택(:54321 API, :54322 DB) + 실제 Realtime로
// 다음을 증명한다:
//   - AC-1c: 멤버가 POST /moims/:id/messages 하면 → private 채널 구독자가 broadcast INSERT를 실시간 수신.
//   - AC-4 : 비멤버 세션은 같은 채널 구독 시 RLS가 메시지 select를 거부(메시지 미수신).
//
// 실행(라이브 Supabase 스택 + 백엔드 빌드 산출물 필요):
//   apps/backend 에서:  pnpm exec nest build  (또는 nx run backend:build)
//   그 다음:            node --experimental-strip-types test/chat.live.mts
//
// 전제: SUPABASE_URL/ANON/SERVICE_ROLE env + DATABASE_URL(:54322). moim/moim_member/chat_message + 트리거/RLS
// 마이그레이션 적용 완료. 이 스크립트는 멤버 1명 + 비멤버 1명을 만들고, 멤버 채널 수신 / 비멤버 미수신을 관찰한다.
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
// 컴파일된 산출물 import(NestJS 데코레이터 메타데이터 필요 — me.live.mts 패턴 동일).
import { AppModule } from '../dist/src/app.module.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface LiveUser {
  token: string;
  sub: string;
  email: string;
}

async function makeUser(label: string): Promise<LiveUser> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `chat001+${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'chat001-live-password-123';
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
  const sb = createClient(SUPABASE_URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${label}): ${error.message}`);
  return { token: data.session!.access_token, sub: data.user!.id, email };
}

// 한 클라이언트가 moim:{id} private 채널에서 첫 broadcast INSERT를 받을 때까지 대기(timeoutMs 후 null).
function waitForBroadcast(
  token: string,
  moimId: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    const sb = createClient(SUPABASE_URL, ANON);
    sb.realtime.setAuth(token);
    const channel = sb
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on('broadcast', { event: 'INSERT' }, ({ payload }) => {
        cleanup();
        resolve(payload);
      })
      .subscribe();
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      void sb.removeChannel(channel);
    }
  });
}

async function main(): Promise<void> {
  const member = await makeUser('member');
  const stranger = await makeUser('stranger');

  // 직접 DB에 moim + member 멤버십을 시드한다(가입 경로와 무관 — 채팅은 멤버십 데이터에만 의존).
  const dbAdmin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const moimId = randomUUID();
  // profile + moim + moim_member 시드(REST가 RLS에 막히면 service_role로 우회 — 또는 psql 사용).
  await dbAdmin.from('profile').upsert({ id: member.sub });
  await dbAdmin.from('profile').upsert({ id: stranger.sub });
  await dbAdmin.from('moim').insert({ id: moimId, name: '라이브 채팅', created_by: member.sub });
  await dbAdmin.from('moim_member').insert({
    moim_id: moimId,
    user_id: member.sub,
    nickname: '멤버',
    role: 'owner',
  });

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();

  try {
    // 멤버/비멤버 둘 다 채널 구독을 시작하고 동시에 메시지를 전송한다.
    const memberRecv = waitForBroadcast(member.token, moimId, 5000);
    const strangerRecv = waitForBroadcast(stranger.token, moimId, 5000);

    // 구독 안정화 대기 후 멤버가 메시지 전송.
    await new Promise((r) => setTimeout(r, 1500));
    const send = await request(app.getHttpServer())
      .post(`/moims/${moimId}/messages`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ content: '실시간 테스트 메시지' });
    console.log(`[live] POST /messages → ${send.status} (expect 201)`);

    const [memberPayload, strangerPayload] = await Promise.all([
      memberRecv,
      strangerRecv,
    ]);

    const memberGotIt = memberPayload !== null; // AC-1c
    const strangerBlocked = strangerPayload === null; // AC-4 (RLS 거부 → 미수신)
    console.log(`[live] AC-1c 멤버 수신: ${memberGotIt ? 'PASS' : 'FAIL'}`);
    console.log(
      `[live] AC-4 비멤버 미수신(RLS): ${strangerBlocked ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `[live] member payload: ${JSON.stringify(memberPayload)?.slice(0, 200)}`,
    );

    const ok = send.status === 201 && memberGotIt && strangerBlocked;
    console.log(ok ? '[live] PASS' : '[live] FAIL');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error('[live] error:', err);
  process.exit(1);
});
