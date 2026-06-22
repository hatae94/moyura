// SPEC-MOIM-010 장소 투표 자동 확정 라이브 종단 증명. **수동/라이브 — CI 게이트 아님.**
//
// 실제 Supabase 스택(:54321 API, :54322 DB) + 실제 가드/DB로 장소 투표 finalize 를 증명한다
// (poll-finalize.live.mts 의 날짜 버전 미러):
//   - 단독 최다 득표 장소 → Moim.location 확정(+ 덮어쓰기) + close 응답 finalizedLocation.
//   - 동점 → 스킵(location 불변) + finalizeSkippedReason "tie". 무표 → "no_votes".
//   - 일반/날짜 투표 close → finalizedLocation null. 비생성자 close → 403. 무효 kind → 400.
//
// 실행: apps/backend 에서 nx run backend:build 후
//   node --experimental-strip-types test/poll-place-finalize.live.mts
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
  const email = `moim010+${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'moim010-live-password-123';
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
  if (cond) { pass++; console.log(`[live] PASS  ${name} ${detail}`); }
  else { fail++; console.log(`[live] FAIL  ${name} ${detail}`); }
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
    const moimRes = await request(http).post('/moims').set(auth(owner.token)).send({ name: '장소 확정 라이브', nickname: '호스트' });
    const moimId = moimRes.body.id as string;
    check('모임 생성(201, location 미설정)', moimRes.status === 201 && !moimRes.body.location, `loc=${moimRes.body.location}`);
    await admin.from('moim_member').insert({ moim_id: moimId, user_id: voter2.sub, nickname: '게스트', role: 'member' });

    // ── A: 단독 최다 득표 → location 확정 ──────────────────────────────
    const pollA = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '어디서?', kind: 'place', options: ['강남역 2번 출구', '홍대입구역 9번 출구'] });
    check('장소 투표 생성(201) + kind=place', pollA.status === 201 && pollA.body.kind === 'place');
    check('장소 옵션 optionDate=null', pollA.body.options.every((o: { optionDate: string | null }) => o.optionDate === null));
    const aOpt0 = pollA.body.options[0];
    await request(http).post(`/moims/${moimId}/polls/${pollA.body.id}/vote`).set(auth(owner.token)).send({ optionId: aOpt0.id });
    const closeA = await request(http).post(`/moims/${moimId}/polls/${pollA.body.id}/close`).set(auth(owner.token)).send();
    check('단독승자 close(200)', closeA.status === 200);
    check('finalizedLocation = 승자 장소', closeA.body.finalizedLocation === aOpt0.label, `got=${closeA.body.finalizedLocation}`);
    check('finalizedStartsAt null(장소 투표)', closeA.body.finalizedStartsAt === null);
    const moimAfterA = await request(http).get(`/moims/${moimId}`).set(auth(owner.token));
    check('모임 location 확정됨', moimAfterA.body.location === aOpt0.label, `location=${moimAfterA.body.location}`);

    // ── B: 동점 → 스킵 + location 불변 ────────────────────────────────
    const pollB = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '어디서2?', kind: 'place', options: ['강남', '홍대'] });
    await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/vote`).set(auth(owner.token)).send({ optionId: pollB.body.options[0].id });
    await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/vote`).set(auth(voter2.token)).send({ optionId: pollB.body.options[1].id });
    const closeB = await request(http).post(`/moims/${moimId}/polls/${pollB.body.id}/close`).set(auth(owner.token)).send();
    check('동점 close → reason=tie', closeB.body.finalizeSkippedReason === 'tie', `reason=${closeB.body.finalizeSkippedReason}`);
    const moimAfterB = await request(http).get(`/moims/${moimId}`).set(auth(owner.token));
    check('동점 — location 불변(A값 유지)', moimAfterB.body.location === aOpt0.label, `location=${moimAfterB.body.location}`);

    // ── C: 무표 → no_votes ───────────────────────────────────────────
    const pollC = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '어디서3?', kind: 'place', options: ['강남', '홍대'] });
    const closeC = await request(http).post(`/moims/${moimId}/polls/${pollC.body.id}/close`).set(auth(owner.token)).send();
    check('무표 close → reason=no_votes', closeC.body.finalizeSkippedReason === 'no_votes', `reason=${closeC.body.finalizeSkippedReason}`);

    // ── D: 일반 투표 close → finalizedLocation null ───────────────────
    const pollD = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '점심?', options: ['김밥', '라면'] });
    await request(http).post(`/moims/${moimId}/polls/${pollD.body.id}/vote`).set(auth(owner.token)).send({ optionId: pollD.body.options[0].id });
    const closeD = await request(http).post(`/moims/${moimId}/polls/${pollD.body.id}/close`).set(auth(owner.token)).send();
    check('일반 투표 close → finalizedLocation null', closeD.body.finalizedLocation === null && closeD.body.finalizeSkippedReason === null);

    // ── E: 비생성자 close → 403 ───────────────────────────────────────
    const pollE = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '어디서4?', kind: 'place', options: ['강남', '홍대'] });
    await request(http).post(`/moims/${moimId}/polls/${pollE.body.id}/vote`).set(auth(voter2.token)).send({ optionId: pollE.body.options[0].id });
    const closeE = await request(http).post(`/moims/${moimId}/polls/${pollE.body.id}/close`).set(auth(voter2.token)).send();
    check('비생성자 close → 403', closeE.status === 403, `status=${closeE.status}`);

    // ── F: 무효 kind → 400 ────────────────────────────────────────────
    const pollF = await request(http).post(`/moims/${moimId}/polls`).set(auth(owner.token))
      .send({ question: '?', kind: 'bogus', options: ['A', 'B'] });
    check('무효 kind → 400', pollF.status === 400, `status=${pollF.status}`);

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
