import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import {
  TEST_AUDIENCE,
  TEST_HS256_SECRET,
  TEST_ISSUER,
  type TestKeys,
  generateEs256Keys,
  makeLocalJwks,
  signEs256,
} from '../auth/test-tokens.helper';
import { TokenVerifierService } from '../auth/token-verifier.service';
import type { Profile } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProfileResponseDto } from './profile-response.dto';

// /me 통합 테스트(AC-C1/C2/C3/B6). 실제 Nest app + 실제 가드 배선을 사용한다.
// TokenVerifierService는 로컬-JWKS로, PrismaService는 인메모리 fake로 오버라이드한다.
//   - 토큰 검증 경로는 라이브 GoTrue 의존 없이 결정적(forged ES256).
//   - DB는 Prisma 7 WASM 컴파일러가 jest VM에서 동작하지 않으므로 fake로 대체 — 실제 DB UPSERT
//     증거는 별도 live 스크립트(test/me.live.mts)로 라이브 스택 대상 검증한다(AC-C4/B3/B5).
// 이 스펙은 "가드 적용점 실제 배선(R-A10) + UPSERT 키=검증된 sub(R-B3/M-5) + public 경계(R-C3)"를 증명한다.
describe('/me (통합 — 가드 배선 + UPSERT 키 출처)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;

  // 인메모리 profile 저장소(id → Profile). upsert 호출 인자를 그대로 기록한다.
  const store = new Map<string, Profile>();
  // upsert에 전달된 create payload 키를 캡처(mass-assignment 차단 단언용).
  let lastUpsertArg: { where: { id: string }; create: { id: string } } | null =
    null;

  beforeAll(async () => {
    keys = await generateEs256Keys();

    const fakePrisma = {
      profile: {
        upsert: jest.fn(
          (arg: { where: { id: string }; create: { id: string } }) => {
            lastUpsertArg = arg;
            const existing = store.get(arg.where.id);
            if (existing) {
              return Promise.resolve(existing);
            }
            const created: Profile = {
              id: arg.create.id,
              createdAt: new Date('2026-06-02T09:59:34.000Z'),
            };
            store.set(created.id, created);
            return Promise.resolve(created);
          },
        ),
        count: jest.fn((arg: { where: { id: string } }) =>
          Promise.resolve(store.has(arg.where.id) ? 1 : 0),
        ),
      },
      // onModuleInit/onModuleDestroy는 no-op(실제 DB 연결 없음).
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      pingDatabase: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 토큰 검증을 로컬 JWKS로 재구성(결정적).
      .overrideProvider(TokenVerifierService)
      .useFactory({
        factory: () => {
          const verifier = new TokenVerifierService({} as never);
          verifier.configureForTest(
            {
              jwksUrl: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
              issuer: TEST_ISSUER,
              audience: TEST_AUDIENCE,
              jwtSecret: TEST_HS256_SECRET,
            },
            makeLocalJwks(keys.publicJwk),
          );
          return verifier;
        },
      })
      // Prisma 7 WASM 컴파일러를 회피하기 위해 인메모리 fake로 대체.
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  let subSeq = 0;
  function uniqueSub(): string {
    subSeq += 1;
    return `00000000-0000-4000-8000-${subSeq.toString(16).padStart(12, '0')}`;
  }

  it('AC-C2: 토큰 없이 GET /me → 401 (가드 실제 배선)', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('AC-C1/C4: 유효 ES256 토큰 → 200 + profile 반환(최초 시 UPSERT 생성)', async () => {
    const sub = uniqueSub();
    const token = await signEs256(keys.privateKey, { sub });

    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as ProfileResponseDto;
    expect(body.id).toBe(sub);
    expect(typeof body.createdAt).toBe('string');
  });

  it('AC-B6: body/query/header의 sub/id는 무시되고 검증된 sub만 UPSERT 키가 된다 (mass-assignment 차단)', async () => {
    const verifiedSub = uniqueSub();
    const attackerSub = uniqueSub();
    const token = await signEs256(keys.privateKey, { sub: verifiedSub });

    const res = await request(app.getHttpServer())
      .get('/me')
      .query({ sub: attackerSub, id: attackerSub })
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-sub', attackerSub)
      .send({ sub: attackerSub, id: attackerSub })
      .expect(200);

    // 응답·UPSERT 키 모두 검증된 sub만 반영, 공격자 sub는 무시된다.
    const body = res.body as ProfileResponseDto;
    expect(body.id).toBe(verifiedSub);
    expect(lastUpsertArg?.where.id).toBe(verifiedSub);
    expect(lastUpsertArg?.create).toEqual({ id: verifiedSub });
    // create payload에 클라이언트 필드가 mass-assign되지 않았다.
    expect(Object.keys(lastUpsertArg?.create ?? {})).toEqual(['id']);
  });

  it('AC-A8: alg:none 토큰으로 /me → 401', async () => {
    const b64 = (o: unknown): string =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      sub: uniqueSub(),
      iat,
      exp: iat + 3600,
    })}.`;

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${noneToken}`)
      .expect(401);
  });

  it('AC-C3: /health 와 GET / 는 토큰 없이 public 유지', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
    const health = await request(app.getHttpServer()).get('/health');
    expect([200, 503]).toContain(health.status);
  });
});
