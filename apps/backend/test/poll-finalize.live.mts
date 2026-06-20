// SPEC-MOIM-008 일정 투표 자동 확정 라이브 종단 증명 스크립트. **수동/라이브 — CI 게이트 아님.**
//
// 실제 Supabase 스택(:54321 API, :54322 DB) + 실제 가드/DB로 날짜 투표 finalize를 증명한다:
//   - 단독 최다 득표 날짜 → Moim.startsAt 확정(+ 기존 startsAt 덮어쓰기) + close 응답 finalizedStartsAt.
//   - 동점 → finalize 스킵(startsAt 불변) + finalizeSkippedReason "tie".
//   - 무표 → 스킵 + "no_votes".
//   - 일반 투표 close → finalize 없음(두 필드 null).
//
// 실행: apps/backend 에서 nx run backend:build 후
//   node --experimental-strip-types test/poll-finalize.live.mts
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
  const email = `moim008+${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'moim008-live-password-123';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
  await admin.from('profile').upsert({ id: created.data.user!.id });
  const sb = createClient(SUPABASE_URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${label}): ${error.message}`);
  return { token: data.session!.access_token, sub: data.user!.id };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`[live] PASS  ${name} ${detail}`);
  } else {
    fail++;
    console.log(`[live] FAIL  ${name} ${detail}`);
  }
}

async function main(): Promise<void> {
  const owner = await makeUser('owner');
  const voter2 = await makeUser('voter2');

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  const http = app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  try {
    // 모임 생성(owner 멤버십). startsAt 미설정.
    const moimRes = await request(http)
      .post('/moims')
      .set(auth(owner.token))
      .send({ name: '일정 확정 라이브', nickname: '호스트' });
    const moimId = moimRes.body.id as string;
    check('모임 생성(201)', moimRes.status === 201, `moimId=${moimId}`);

    // voter2 를 멤버로 추가(동점 테스트용).
    await admin.from('moim_member').insert({
      moim_id: moimId,
      user_id: voter2.sub,
      nickname: '게스트',
      role: 'member',
    });

    const d1 = '2026-07-04T10:00:00.000Z';
    const d2 = '2026-07-05T10:00:00.000Z';

    // ── Test A: 단독 최다 득표 → startsAt 확정 ──────────────────────────
    const pollA = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '날짜?', kind: 'date', options: [d1, d2] });
    check('날짜 투표 생성(201) + kind=date', pollA.status === 201 && pollA.body.kind === 'date');
    const aOpts = pollA.body.options as { id: string; optionDate: string }[];
    check('옵션 optionDate 노출', aOpts.every((o) => o.optionDate !== null), JSON.stringify(aOpts.map((o) => o.optionDate)));
    const aOpt1 = aOpts[0];
    // owner 가 옵션0에 투표.
    await request(http).post(`/moims/${moimId}/polls/${pollA.body.id}/vote`).set(auth(owner.token)).send({ optionId: aOpt1.id });
    const closeA = await request(http).post(`/moims/${moimId}/polls/${pollA.body.id}/close`).set(auth(owner.token)).send();
    check('단독승자 close(200)', closeA.status === 200);
    check('finalizedStartsAt = 승자 날짜', closeA.body.finalizedStartsAt === aOpt1.optionDate, `got=${closeA.body.finalizedStartsAt}`);
    check('finalizeSkippedReason null', closeA.body.finalizeSkippedReason === null);
    const moimAfterA = await request(http).get(`/moims/${moimId}`).set(auth(owner.token));
    check('모임 startsAt 확정됨', moimAfterA.body.startsAt === aOpt1.optionDate, `startsAt=${moimAfterA.body.startsAt}`);

    // ── Test B: 동점(2인 각각 다른 옵션) → 스킵 + startsAt 불변 ──────────
    const pollB = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '날짜2?', kind: 'date', options: [d1, d2] });
    const bOpts = pollB.body.options as { id: string; optionDate: string }[];
    await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/vote`).set(auth(owner.token)).send({ optionId: bOpts[0].id });
    await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/vote`).set(auth(voter2.token)).send({ optionId: bOpts[1].id });
    const closeB = await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/close`).set(auth(owner.token)).send();
    check('동점 close(200) + reason=tie', closeB.status === 200 && closeB.body.finalizeSkippedReason === 'tie', `reason=${closeB.body.finalizeSkippedReason}`);
    check('동점이라 finalizedStartsAt null', closeB.body.finalizedStartsAt === null);
    const moimAfterB = await request(http).get(`/moims/${moimId}`).set(auth(owner.token));
    check('동점 — startsAt 불변(A의 값 유지)', moimAfterB.body.startsAt === aOpt1.optionDate, `startsAt=${moimAfterB.body.startsAt}`);

    // ── Test C: 무표 날짜 투표 close → no_votes ────────────────────────
    const pollC = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '날짜3?', kind: 'date', options: [d1, d2] });
    const closeC = await request(http).post(`/moims/${moimId}/polls/${pollC.body.id}/close`).set(auth(owner.token)).send();
    check('무표 close → reason=no_votes', closeC.body.finalizeSkippedReason === 'no_votes', `reason=${closeC.body.finalizeSkippedReason}`);

    // ── Test D: 일반 투표 close → finalize 없음 ────────────────────────
    const pollD = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '점심?', options: ['김밥', '라면'] });
    check('일반 투표 kind=general', pollD.body.kind === 'general');
    await request(http).post(`/moims/${moimId}/polls/${pollD.body.id}/vote`).set(auth(owner.token)).send({ optionId: pollD.body.options[0].id });
    const closeD = await request(http).post(`/moims/${moimId}/polls/${pollD.body.id}/close`).set(auth(owner.token)).send();
    check('일반 투표 close → finalize 두 필드 null', closeD.body.finalizedStartsAt === null && closeD.body.finalizeSkippedReason === null);

    // ── Test E: 비생성자 close → 403(finalize 미실행) ───────────────────
    const pollE = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '날짜4?', kind: 'date', options: [d1, d2] });
    await request(http).post(`/moims/${moimId}/polls/${pollE.body.id}/vote`).set(auth(voter2.token)).send({ optionId: pollE.body.options[0].id });
    const closeE = await request(http).post(`/moims/${moimId}/polls/${pollE.body.id}/close`).set(auth(voter2.token)).send();
    check('비생성자 close → 403', closeE.status === 403, `status=${closeE.status}`);

    // ── Test F: 무효 날짜 옵션 → 400 ───────────────────────────────────
    const pollF = await request(http)
      .post(`/moims/${moimId}/polls`)
      .set(auth(owner.token))
      .send({ question: '날짜5?', kind: 'date', options: ['notadate', d2] });
    check('무효 날짜 옵션 → 400', pollF.status === 400, `status=${pollF.status}`);

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
