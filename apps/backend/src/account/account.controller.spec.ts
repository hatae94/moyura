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
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';

// DELETE /me/account 통합 테스트(SPEC-ACCOUNT-001 T-07 / REQ-ACCOUNT-001 · EC-9).
// notification/me.controller.spec 패턴: 실제 Nest app + 실제 SupabaseAuthGuard 배선을 사용하고,
// TokenVerifierService 는 로컬-JWKS(결정적 ES256)로, PrismaService 는 부팅용 인메모리 fake 로 오버라이드한다
// (Prisma 7 WASM 컴파일러가 jest VM 에서 동작하지 않음). 삭제 오케스트레이션 자체(AccountService.deleteAccount)는
// T-04~T-06 스펙이 단위로 검증하므로, 이 스펙은 AccountService 를 mock 으로 대체해 **컨트롤러 표면만** 검증한다:
//   - 가드 실제 배선: 토큰 없는 DELETE /me/account → 401(SupabaseAuthGuard 적용점).
//   - 성공 응답: 유효 토큰 → 204(No Content) + deleteAccount(가드-검증 sub) 정확히 1회.
//   - mass-assignment 차단(R-8/EC-9): body 에 다른 userId 를 주입해도 삭제 대상은 가드-검증 sub 뿐.

// 검증 sub 와 다른, 공격자가 삭제하려 시도하는 임의 uuid(무시되어야 함).
const OTHER_USER = '99999999-9999-4999-8999-999999999999';

describe('DELETE /me/account (T-07 통합 — 가드 배선 + sub 단일 출처)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;

  // deleteAccount 호출 인자 캡처용 mock(실제 삭제 파이프라인 미실행 — 컨트롤러 표면만 검증).
  const deleteAccount = jest.fn<Promise<void>, [string]>(() =>
    Promise.resolve(),
  );

  beforeAll(async () => {
    keys = await generateEs256Keys();

    // 부팅용 최소 fake — AppModule 인스턴스화 시 PrismaService(global)만 필요하고, 각 서비스는 생성자에서
    // 쿼리하지 않으므로 라이프사이클 no-op 으로 충분하다(DELETE 경로는 AccountService mock 이 가로챈다).
    const fakePrisma = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      pingDatabase: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
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
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      // 삭제 오케스트레이션은 T-04~T-06 이 검증 — 여기선 호출 인자만 캡처한다.
      .overrideProvider(AccountService)
      .useValue({ deleteAccount })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    deleteAccount.mockClear();
  });

  // ── 가드 배선(401) ──────────────────────────────────────────────────────────
  it('토큰 없이 DELETE /me/account → 401 (가드 실제 배선)', async () => {
    await request(app.getHttpServer()).delete('/me/account').expect(401);
    // 인증 실패 시 삭제 오케스트레이션은 절대 착수되지 않는다.
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  // ── 성공 응답(204) + sub 위임 ────────────────────────────────────────────────
  it('유효 토큰 → 204 + deleteAccount(가드-검증 sub) 정확히 1회', async () => {
    const sub = '11111111-1111-4111-8111-111111111111';
    const token = await signEs256(keys.privateKey, { sub });

    await request(app.getHttpServer())
      .delete('/me/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledWith(sub);
  });

  // ── EC-9: body userId 무시(mass-assignment 차단) ────────────────────────────
  it('body 에 다른 userId 를 주입해도 삭제 대상은 가드-검증 sub 뿐(R-8/EC-9)', async () => {
    const sub = '22222222-2222-4222-8222-222222222222';
    const token = await signEs256(keys.privateKey, { sub });

    await request(app.getHttpServer())
      .delete('/me/account')
      .set('Authorization', `Bearer ${token}`)
      // 공격자가 남의 계정 삭제를 노려 body 에 다른 uuid 를 주입한다 — 컨트롤러는 이를 절대 사용하지 않아야 한다.
      .send({ userId: OTHER_USER })
      .expect(204);

    // 삭제 대상은 body 의 OTHER_USER 가 아니라 가드-검증 sub 뿐이다.
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledWith(sub);
    expect(deleteAccount).not.toHaveBeenCalledWith(OTHER_USER);
  });
});
