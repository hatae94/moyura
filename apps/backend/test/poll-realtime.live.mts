// SPEC-MOIM-009 투표 실시간 갱신 라이브 종단 증명. **수동/라이브 — CI 게이트 아님.**
//
// 실제 Supabase 스택(:54321 API, :54322 DB) + 실제 Realtime로 증명한다(chat.live.mts 패턴):
//   - AC: 모임 멤버 2명이 private 채널 moim:{id} 를 구독한 상태에서 한 명이 투표를 생성/투표하면,
//         poll/poll_vote 트리거가 'poll_change' 를 방송해 두 멤버 모두 수신한다.
//   - AC: 비멤버는 같은 채널 구독 시 realtime.messages RLS(CHAT-001 재사용)가 거부해 수신하지 못한다.
//
// 실행: apps/backend 에서 nx run backend:build 후
//   node --experimental-strip-types test/poll-realtime.live.mts
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { AppModule } from '../dist/src/app.module.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function makeUser(label: string): Promise<{ token: string; sub: string }> {
  const email = `moim009+${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'moim009-live-password-123';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
  await admin.from('profile').upsert({ id: created.data.user!.id });
  const sb = createClient(SUPABASE_URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${label}): ${error.message}`);
  return { token: data.session!.access_token, sub: data.user!.id };
}

// moim:{id} private 채널에서 첫 'poll_change' broadcast 를 받을 때까지 대기(timeout 후 null).
function waitForPollChange(token: string, moimId: string, timeoutMs: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    const sb = createClient(SUPABASE_URL, ANON);
    sb.realtime.setAuth(token);
    let done = false;
    const channel = sb
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on('broadcast', { event: 'poll_change' }, ({ payload }) => {
        if (done) return;
        done = true;
        void sb.removeChannel(channel);
        resolve(payload);
      })
      .subscribe();
    setTimeout(() => {
      if (done) return;
      done = true;
      void sb.removeChannel(channel);
      resolve(null);
    }, timeoutMs);
  });
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`[live] PASS  ${name} ${detail}`); }
  else { fail++; console.log(`[live] FAIL  ${name} ${detail}`); }
}

async function main(): Promise<void> {
  const owner = await makeUser('owner');
  const member2 = await makeUser('member2');
  const stranger = await makeUser('stranger');

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  const http = app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  try {
    const moimRes = await request(http).post('/moims').set(auth(owner.token)).send({ name: '실시간 투표 라이브', nickname: '호스트' });
    const moimId = moimRes.body.id as string;
    check('모임 생성(201)', moimRes.status === 201, `moimId=${moimId}`);
    // member2 를 멤버로 추가, stranger 는 비멤버로 둔다.
    await admin.from('moim_member').insert({ moim_id: moimId, user_id: member2.sub, nickname: '게스트', role: 'member' });

    // ── Round 1: poll 생성 broadcast — 멤버 2명 수신 / 비멤버 차단 ──────────
    const ownerRecv = waitForPollChange(owner.token, moimId, 6000);
    const member2Recv = waitForPollChange(member2.token, moimId, 6000);
    const strangerRecv = waitForPollChange(stranger.token, moimId, 6000);
    await new Promise((r) => setTimeout(r, 3500)); // 구독 안정화 대기

    const pollRes = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token)).send({ question: '점심?', options: ['김밥', '라면'] });
    check('투표 생성(201)', pollRes.status === 201);
    const pollId = pollRes.body.id as string;

    const [ownerP, member2P, strangerP] = await Promise.all([ownerRecv, member2Recv, strangerRecv]);
    check('멤버(owner) poll_change 수신', ownerP !== null, JSON.stringify(ownerP));
    check('멤버(member2) poll_change 수신', member2P !== null, JSON.stringify(member2P));
    check('비멤버(stranger) 미수신(RLS 차단)', strangerP === null);
    check('신호 페이로드 경량({moimId,pollId})', !!ownerP && (ownerP as { moimId?: string }).moimId === moimId);

    // ── Round 2: 투표(poll_vote insert) broadcast — 멤버 수신 ───────────────
    const voteRecv = waitForPollChange(member2.token, moimId, 6000);
    await new Promise((r) => setTimeout(r, 3500));
    await request(http).post(`/moims/${moimId}/polls/${pollId}/vote`).set(auth(owner.token)).send({ optionId: pollRes.body.options[0].id });
    const voteP = await voteRecv;
    check('투표(poll_vote) 시 poll_change 수신', voteP !== null, JSON.stringify(voteP));

    console.log(`\n[live] === ${pass} PASS / ${fail} FAIL ===`);
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error('[live] error:', err);
  process.exit(1);
});
