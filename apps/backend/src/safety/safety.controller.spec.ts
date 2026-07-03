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
import { Prisma } from '../generated/prisma/client';
import type { Block, Report } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BlockListResponseDto,
  BlockResponseDto,
  ReportResponseDto,
} from './dto/safety-response.dto';

// /reports·/blocks 통합 테스트(SPEC-SAFETY-001 M2 / T-004). 실제 Nest app + 실제 SupabaseAuthGuard 배선을 사용한다.
// TokenVerifierService 는 로컬-JWKS(결정적 ES256)로, PrismaService 는 인메모리 fake 로 오버라이드한다
// (Prisma 7 WASM 컴파일러가 jest VM 에서 동작하지 않음 — notification.controller.spec 선례).
// 이 스펙이 증명하는 것: 가드 실제 배선(401), WHERE 내장 인가 격리(reporterId/blockerId = 검증 sub — body/param
// 미신뢰), 라우트 배선(POST /reports, POST /blocks, DELETE /blocks/:blockedUserId, GET /blocks), 400/200 상태코드,
// DTO 직렬화(createdAt ISO). fake 는 async 대신 Promise.resolve 반환(require-await 회피).
const NOW = new Date('2026-07-02T00:00:00.000Z');

// ── fake Prisma 인자 형태(no-unsafe 회피용 명시 타입) ──────────────────────────
interface BlockCreateArg {
  data: { blockerId: string; blockedUserId: string };
}
interface BlockFindManyArg {
  where: { blockerId: string };
}
interface BlockFindUniqueArg {
  where: {
    blockerId_blockedUserId: { blockerId: string; blockedUserId: string };
  };
}
interface BlockDeleteManyArg {
  where: { blockerId: string; blockedUserId: string };
}
interface ReportCreateArg {
  data: {
    reporterId: string;
    targetUserId: string;
    moimId: string;
    reason: string;
    contentType: string;
    contentId: string;
  };
}

describe('/reports · /blocks (통합 — 가드 배선 + WHERE 내장 인가 격리)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;

  // 인메모리 fake 저장소(테스트별 reset). fake prisma 메서드가 호출 시점에 이 배열들을 읽는다.
  let blockRows: Block[] = [];
  let reportRows: Report[] = [];
  // 인가 격리 단언용: 마지막 create/deleteMany 인자 캡처.
  let lastReportCreateArg: ReportCreateArg | null = null;
  let lastBlockCreateArg: BlockCreateArg | null = null;
  let lastBlockDeleteArg: BlockDeleteManyArg | null = null;
  let lastBlockFindManyArg: BlockFindManyArg | null = null;

  beforeAll(async () => {
    keys = await generateEs256Keys();

    const fakePrisma = {
      block: {
        create: jest.fn((arg: BlockCreateArg) => {
          lastBlockCreateArg = arg;
          const exists = blockRows.some(
            (b) =>
              b.blockerId === arg.data.blockerId &&
              b.blockedUserId === arg.data.blockedUserId,
          );
          if (exists) {
            // 복합 PK 유일성 위반(멱등 검증) — createBlock 이 흡수해야 한다.
            return Promise.reject(
              new Prisma.PrismaClientKnownRequestError('unique', {
                code: 'P2002',
                clientVersion: 'test',
              }),
            );
          }
          const row: Block = {
            blockerId: arg.data.blockerId,
            blockedUserId: arg.data.blockedUserId,
            createdAt: NOW,
          };
          blockRows.push(row);
          return Promise.resolve(row);
        }),
        findUniqueOrThrow: jest.fn((arg: BlockFindUniqueArg) => {
          const { blockerId, blockedUserId } =
            arg.where.blockerId_blockedUserId;
          const found = blockRows.find(
            (b) =>
              b.blockerId === blockerId && b.blockedUserId === blockedUserId,
          );
          return found
            ? Promise.resolve(found)
            : Promise.reject(new Error('not found'));
        }),
        findMany: jest.fn((arg: BlockFindManyArg) => {
          lastBlockFindManyArg = arg;
          return Promise.resolve(
            blockRows.filter((b) => b.blockerId === arg.where.blockerId),
          );
        }),
        deleteMany: jest.fn((arg: BlockDeleteManyArg) => {
          lastBlockDeleteArg = arg;
          const before = blockRows.length;
          blockRows = blockRows.filter(
            (b) =>
              !(
                b.blockerId === arg.where.blockerId &&
                b.blockedUserId === arg.where.blockedUserId
              ),
          );
          return Promise.resolve({ count: before - blockRows.length });
        }),
      },
      report: {
        create: jest.fn((arg: ReportCreateArg) => {
          lastReportCreateArg = arg;
          const row: Report = {
            id: `report-${reportRows.length + 1}`,
            reporterId: arg.data.reporterId,
            targetUserId: arg.data.targetUserId,
            moimId: arg.data.moimId,
            reason: arg.data.reason,
            contentType: arg.data.contentType,
            contentId: arg.data.contentId,
            createdAt: NOW,
          };
          reportRows.push(row);
          return Promise.resolve(row);
        }),
      },
      // 헬스/라이프사이클은 no-op(실제 DB 연결 없음).
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
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    blockRows = [];
    reportRows = [];
    lastReportCreateArg = null;
    lastBlockCreateArg = null;
    lastBlockDeleteArg = null;
    lastBlockFindManyArg = null;
  });

  let subSeq = 0;
  function uniqueSub(): string {
    subSeq += 1;
    return `00000000-0000-4000-8000-${subSeq.toString(16).padStart(12, '0')}`;
  }
  function tokenFor(sub: string): Promise<string> {
    return signEs256(keys.privateKey, { sub });
  }

  const validReportBody = {
    targetUserId: 'user-b',
    moimId: 'moim-a',
    reason: '스팸',
    contentType: 'chat_message',
    contentId: '42',
  };

  // ── 가드 배선(401) ──────────────────────────────────────────────────────────

  it('토큰 없이 POST /reports → 401 (가드 실제 배선)', async () => {
    await request(app.getHttpServer())
      .post('/reports')
      .send(validReportBody)
      .expect(401);
  });

  it('토큰 없이 POST /blocks → 401', async () => {
    await request(app.getHttpServer())
      .post('/blocks')
      .send({ blockedUserId: 'user-b' })
      .expect(401);
  });

  it('토큰 없이 DELETE /blocks/:blockedUserId → 401', async () => {
    await request(app.getHttpServer()).delete('/blocks/user-b').expect(401);
  });

  it('토큰 없이 GET /blocks → 401', async () => {
    await request(app.getHttpServer()).get('/blocks').expect(401);
  });

  // ── POST /reports ────────────────────────────────────────────────────────────

  it('유효 토큰 POST /reports → 201, report 저장 + DTO 직렬화(createdAt ISO), reporterId=검증 sub, block 미생성', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send(validReportBody)
      .expect(201);

    const body = res.body as ReportResponseDto;
    expect(body.targetUserId).toBe('user-b');
    expect(body.contentType).toBe('chat_message');
    expect(typeof body.createdAt).toBe('string');
    // reporterId 는 body 가 아니라 가드-검증 sub 로 강제된다(mass-assignment 차단).
    expect(lastReportCreateArg?.data.reporterId).toBe(sub);
    // 신고 ≠ 차단: block 은 만들지 않는다.
    expect(blockRows).toEqual([]);
  });

  it('POST /reports 에 위조 reporterId 를 실어도 무시되고 검증 sub 로 저장된다(WHERE 내장 인가)', async () => {
    const sub = uniqueSub();
    const attacker = uniqueSub();
    const token = await tokenFor(sub);

    await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validReportBody, reporterId: attacker })
      .expect(201);

    expect(lastReportCreateArg?.data.reporterId).toBe(sub);
  });

  it('POST /reports 복합 PK contentType(poll_vote) → 400', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validReportBody, contentType: 'poll_vote' })
      .expect(400);
  });

  it('POST /reports 빈 reason → 400', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validReportBody, reason: '   ' })
      .expect(400);
  });

  it('POST /reports 필수 필드 누락(targetUserId 없음) → 400 (컨트롤러 바디 검증)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    // targetUserId 를 뺀 바디(나머지 필드는 유효) — 컨트롤러 바디 검증이 400 을 던진다.
    const noTarget = {
      moimId: validReportBody.moimId,
      reason: validReportBody.reason,
      contentType: validReportBody.contentType,
      contentId: validReportBody.contentId,
    };
    await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send(noTarget)
      .expect(400);
    // 검증 실패 시 report 는 저장되지 않는다.
    expect(reportRows).toEqual([]);
  });

  // ── POST /blocks ─────────────────────────────────────────────────────────────

  it('유효 토큰 POST /blocks → 201, block 저장 + blockerId=검증 sub', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blockedUserId: 'user-b' })
      .expect(201);

    const body = res.body as BlockResponseDto;
    expect(body.blockedUserId).toBe('user-b');
    expect(typeof body.createdAt).toBe('string');
    // blockerId 는 body 가 아니라 가드-검증 sub 로 강제된다.
    expect(lastBlockCreateArg?.data.blockerId).toBe(sub);
  });

  it('POST /blocks 위조 blockerId 무시 — 검증 sub 로 저장', async () => {
    const sub = uniqueSub();
    const attacker = uniqueSub();
    const token = await tokenFor(sub);

    await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blockedUserId: 'user-b', blockerId: attacker })
      .expect(201);

    expect(lastBlockCreateArg?.data.blockerId).toBe(sub);
  });

  it('POST /blocks 자기 차단(blockedUserId==sub) → 400', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blockedUserId: sub })
      .expect(400);
  });

  it('POST /blocks blockedUserId 누락 → 400 (컨트롤러 바디 검증)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(blockRows).toEqual([]);
  });

  it('POST /blocks 2회 연속(동일 대상) → 둘 다 성공(P2002 멱등 흡수)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);

    await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blockedUserId: 'user-b' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ blockedUserId: 'user-b' })
      .expect(201);

    // 중복 행이 생기지 않는다(멱등).
    expect(blockRows.filter((b) => b.blockerId === sub).length).toBe(1);
  });

  // ── DELETE /blocks/:blockedUserId ────────────────────────────────────────────

  it('DELETE /blocks/:blockedUserId → 204, block 행 삭제 + blockerId=검증 sub', async () => {
    const sub = uniqueSub();
    blockRows = [{ blockerId: sub, blockedUserId: 'user-b', createdAt: NOW }];
    const token = await tokenFor(sub);

    await request(app.getHttpServer())
      .delete('/blocks/user-b')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(blockRows).toEqual([]);
    // 삭제 키는 검증 sub — 남의 차단은 구조적으로 지울 수 없다.
    expect(lastBlockDeleteArg?.where).toEqual({
      blockerId: sub,
      blockedUserId: 'user-b',
    });
  });

  it('DELETE /blocks 인가 격리: attacker 차단 행은 verified sub 로는 지워지지 않는다', async () => {
    const verifiedSub = uniqueSub();
    const attackerSub = uniqueSub();
    blockRows = [
      { blockerId: attackerSub, blockedUserId: 'user-b', createdAt: NOW },
    ];
    const token = await tokenFor(verifiedSub);

    await request(app.getHttpServer())
      .delete('/blocks/user-b')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // attacker 의 차단은 그대로 유지된다(blockerId=verifiedSub 필터로 미매칭).
    expect(blockRows.length).toBe(1);
    expect(lastBlockDeleteArg?.where.blockerId).toBe(verifiedSub);
  });

  // ── GET /blocks ──────────────────────────────────────────────────────────────

  it('GET /blocks → 200, 내 차단 목록만(blockerId=검증 sub), DTO 직렬화', async () => {
    const sub = uniqueSub();
    const other = uniqueSub();
    blockRows = [
      { blockerId: sub, blockedUserId: 'user-b', createdAt: NOW },
      { blockerId: sub, blockedUserId: 'user-c', createdAt: NOW },
      // 남의 차단 — 노출되면 안 된다.
      { blockerId: other, blockedUserId: 'user-d', createdAt: NOW },
    ];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .get('/blocks')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as BlockListResponseDto;
    expect(body.items.map((b) => b.blockedUserId).sort()).toEqual([
      'user-b',
      'user-c',
    ]);
    expect(typeof body.items[0].createdAt).toBe('string');
    // 조회 키는 검증 sub 만.
    expect(lastBlockFindManyArg?.where.blockerId).toBe(sub);
  });
});
