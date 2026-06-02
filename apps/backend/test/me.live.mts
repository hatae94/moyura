// 라이브 종단 증명 스크립트(AC-C4 / AC-G5 / AC-B3). jest VM 제약(Prisma 7 WASM) 밖에서
// 실제 Nest app + 실제 Prisma DB(:54322) + 실제 GoTrue ES256 토큰으로 /me를 검증한다.
//
// 실행: nvm Node + 라이브 Supabase 스택 가동 상태에서
//   NODE_OPTIONS='--import tsx' 없이도 동작하도록 .mts + tsx 미사용 — ts 소스를 직접 import하지 않고
//   런타임 의존만 사용한다. apps/backend 디렉터리에서:
//     node --experimental-strip-types test/me.live.mts
//
// 이 스크립트는 .env(local)를 로드해 Supabase/DB 설정을 얻고, 라이브 user로 로그인해 ES256 토큰을
// 획득한 뒤, Nest app을 실제 부팅해 supertest로 GET /me를 호출하고 DB row를 확인한다.
import 'dotenv/config';
import 'reflect-metadata';
import { createClient } from '@supabase/supabase-js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
// 컴파일된 산출물을 import한다(NestJS 데코레이터 메타데이터 필요 — raw TS strip-types로는 부족).
import { AppModule } from '../dist/src/app.module.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'auth001+live@example.com';
const PASSWORD = 'auth001-live-password-123';

function redact(token: string): string {
  return `${token.slice(0, 12)}...<redacted>`;
}

async function getLiveToken(): Promise<{ token: string; sub: string }> {
  // 멱등 user 생성(이미 있으면 무시).
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    throw new Error(`createUser: ${created.error.message}`);
  }
  const sb = createClient(SUPABASE_URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn: ${error.message}`);
  return { token: data.session!.access_token, sub: data.user!.id };
}

async function main(): Promise<void> {
  const { token, sub } = await getLiveToken();
  console.log(`[live] obtained ES256 token (${redact(token)}) for sub=${sub}`);

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();

  try {
    // 1) 토큰 없이 → 401
    const noTok = await request(app.getHttpServer()).get('/me');
    console.log(`[live] GET /me (no token) → ${noTok.status} (expect 401)`);

    // 2) 라이브 ES256 토큰 → 200 + profile
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    console.log(`[live] GET /me (live ES256) → ${res.status}`);
    console.log(`[live] body: ${JSON.stringify(res.body)}`);

    // 3) public 경계
    const root = await request(app.getHttpServer()).get('/');
    const health = await request(app.getHttpServer()).get('/health');
    console.log(`[live] GET / → ${root.status} "${root.text}"`);
    console.log(`[live] GET /health → ${health.status} ${JSON.stringify(health.body)}`);

    const ok =
      noTok.status === 401 &&
      res.status === 200 &&
      res.body.id === sub &&
      root.status === 200;
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
