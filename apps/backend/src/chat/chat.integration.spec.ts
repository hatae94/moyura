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
import type { ChatMessage, Moim, MoimMember } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 채팅 통합 테스트(SPEC-CHAT-001 T-006). 실제 Nest app + 실제 가드 배선 + 실제 ChatService/ChatController.
// moim.integration.spec.ts 패턴을 확장한다: fakePrisma에 chatMessage(create/findMany) + moim/moimMember,
// TokenVerifierService를 로컬-JWKS로 오버라이드한다.
//   - 전 라우트 가드(401) + 멤버/비멤버/없는 모임(403) + content 400 + BigInt→string 직렬화 + keyset desc.
//   - 비멤버 전송은 insert도 emit도 없어야 한다(상태로 단언).
// Prisma 7 WASM이 jest VM에서 동작하지 않으므로 DB는 인메모리 fake로 대체한다(BigInt 직렬화 동작은 실제 코드로 검증).

interface Tables {
  moim: Map<string, Moim>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
  message: ChatMessage[];
}

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

describe('/moims/:id/messages (통합 — 채팅 전송/히스토리/인가/직렬화)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;
  let tables: Tables;
  let idSeq: bigint;

  function resetStore(): void {
    tables = { moim: new Map(), member: new Map(), message: [] };
    idSeq = 0n;
  }

  function seedMoimWithMembers(moimId: string, memberSubs: string[]): void {
    tables.moim.set(moimId, {
      id: moimId,
      name: `모임 ${moimId}`,
      // SPEC-MOIM-004: Moim 에 추가된 nullable 이벤트 필드(채팅 테스트와 무관 — null).
      startsAt: null,
      location: null,
      maxMembers: 15,
      createdBy: memberSubs[0] ?? 'owner',
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
      budget: null,
    });
    memberSubs.forEach((sub, idx) => {
      tables.member.set(memberKey(moimId, sub), {
        moimId,
        userId: sub,
        nickname: `멤버${idx}`,
        role: idx === 0 ? 'owner' : 'member',
        joinedAt: new Date('2026-06-14T00:00:00.000Z'),
      });
    });
  }

  function seedMessage(
    moimId: string,
    senderId: string,
    content: string,
  ): ChatMessage {
    idSeq += 1n;
    const msg: ChatMessage = {
      id: idSeq,
      moimId,
      senderId,
      content,
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
    };
    tables.message.push(msg);
    return msg;
  }

  beforeAll(async () => {
    keys = await generateEs256Keys();
    resetStore();

    const findMember = (where: {
      moimId_userId: { moimId: string; userId: string };
    }): MoimMember | null =>
      tables.member.get(
        memberKey(where.moimId_userId.moimId, where.moimId_userId.userId),
      ) ?? null;

    const fakePrisma = {
      moim: {
        findUnique: jest.fn((arg: { where: { id: string } }) =>
          Promise.resolve(tables.moim.get(arg.where.id) ?? null),
        ),
      },
      moimMember: {
        findUnique: jest.fn(
          (arg: {
            where: { moimId_userId: { moimId: string; userId: string } };
          }) => Promise.resolve(findMember(arg.where)),
        ),
      },
      chatMessage: {
        create: jest.fn(
          (arg: {
            data: { moimId: string; senderId: string; content: string };
          }) => {
            idSeq += 1n;
            const created: ChatMessage = {
              id: idSeq,
              moimId: arg.data.moimId,
              senderId: arg.data.senderId,
              content: arg.data.content,
              createdAt: new Date('2026-06-14T00:00:00.000Z'),
            };
            tables.message.push(created);
            return Promise.resolve(created);
          },
        ),
        findMany: jest.fn(
          (arg: {
            where: {
              moimId: string;
              id?: { lt: bigint };
              senderId?: { notIn: string[] };
            };
            orderBy: { id: 'desc' };
            take: number;
          }) => {
            const cursorLt = arg.where.id?.lt;
            // SPEC-SAFETY-001 T-005: getHistory 가 senderId notIn(뷰어 숨김 목록)을 붙인다. 통합 테스트는 숨김 0.
            const notIn = arg.where.senderId?.notIn ?? [];
            const rows = tables.message
              .filter(
                (m) =>
                  m.moimId === arg.where.moimId &&
                  (cursorLt === undefined || m.id < cursorLt) &&
                  !notIn.includes(m.senderId),
              )
              .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
              .slice(0, arg.take);
            return Promise.resolve(rows);
          },
        ),
      },
      // SPEC-SAFETY-001 T-005: ChatModule 이 SafetyModule 을 import 하므로 getHistory 가 SafetyService.
      // getHiddenUserIds(block∪report)를 호출한다. 통합 테스트는 차단/신고 시드가 없으니 빈 목록을 반환한다.
      block: { findMany: jest.fn(() => Promise.resolve([])) },
      report: { findMany: jest.fn(() => Promise.resolve([])) },
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
    resetStore();
  });

  let subSeq = 0;
  function uniqueSub(): string {
    subSeq += 1;
    return `00000000-0000-4000-8000-${subSeq.toString(16).padStart(12, '0')}`;
  }
  async function tokenFor(sub: string): Promise<string> {
    return signEs256(keys.privateKey, { sub });
  }

  // ── AC-3 가드: 미인증 401 (전 라우트, 부작용 없음) ──
  describe('미인증 401 (REQ-CHAT-001/003)', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'post', path: '/moims/moim-x/messages' },
      { method: 'get', path: '/moims/moim-x/messages' },
    ];

    it.each(routes)('$method $path → 401', async ({ method, path }) => {
      seedMoimWithMembers('moim-x', [uniqueSub()]);
      const before = tables.message.length;

      await request(app.getHttpServer())[method](path).expect(401);

      expect(tables.message.length).toBe(before);
    });
  });

  // ── AC-1: 멤버 전송 201 + BigInt id가 문자열로 직렬화 ──
  it('AC-1: 멤버의 POST → 201 + 저장 + id가 문자열로 직렬화된다', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .post('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '안녕하세요' })
      .expect(201);

    const body = res.body as {
      id: string;
      moimId: string;
      senderId: string;
      content: string;
      createdAt: string;
    };
    // BigInt PK가 문자열로 직렬화되어야 한다(NestJS BigInt JSON 직렬화 불가 → toString 매핑 검증).
    expect(typeof body.id).toBe('string');
    expect(body.moimId).toBe('moim-A');
    expect(body.senderId).toBe(memberSub);
    expect(body.content).toBe('안녕하세요');
    expect(tables.message).toHaveLength(1);
  });

  // ── AC-3: 비멤버 전송 403 + 미저장 ──
  it('AC-3: 비멤버의 POST → 403 + 메시지 미저장', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithMembers('moim-A', [ownerSub]);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .post('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ content: '안녕' })
      .expect(403);

    expect(tables.message).toHaveLength(0);
  });

  // ── 엣지: 존재하지 않는 모임 전송 → 403(404→403 변환, 비노출) ──
  it('엣지: 없는 모임으로 POST → 403(404→403 변환) + 미저장', async () => {
    const token = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .post('/moims/missing/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '안녕' })
      .expect(403);

    expect(tables.message).toHaveLength(0);
  });

  // ── 엣지: 빈 content → 400 + 미저장 ──
  it('엣지: 빈 content → 400 + 미저장', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '   ' })
      .expect(400);

    expect(tables.message).toHaveLength(0);
  });

  // ── 엣지: 길이 초과 content → 400 + 미저장 ──
  it('엣지: 2000자 초과 content → 400 + 미저장', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'a'.repeat(2001) })
      .expect(400);

    expect(tables.message).toHaveLength(0);
  });

  // ── 엣지: content 타입 비문자열(숫자) → 400 + 미저장 ──
  it('엣지: content가 문자열이 아니면(숫자) → 400 + 미저장', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 123 })
      .expect(400);

    expect(tables.message).toHaveLength(0);
  });

  // ── 엣지: limit=0(비정상) → 기본값으로 정규화되어 200(클램프 검증) ──
  it('엣지: limit=0 → 기본값으로 정규화되어 200', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    seedMessage('moim-A', memberSub, 'only');
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/messages?limit=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { messages: { content: string }[] };
    // limit=0은 비정상 → 기본값(30)으로 정규화 → 메시지가 반환된다(빈 배열이 아님).
    expect(body.messages.map((m) => m.content)).toEqual(['only']);
  });

  // ── AC-2: keyset 히스토리 내림차순 + nextCursor ──
  it('AC-2: 멤버의 GET → 200 + 최신순 K개 + nextCursor', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    for (let i = 1; i <= 5; i += 1) {
      seedMessage('moim-A', memberSub, `msg-${i}`);
    }
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/messages?limit=3')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      messages: { id: string; content: string }[];
      nextCursor: string | null;
    };
    // 최신순(내림차순) 3개: 5,4,3. id는 문자열.
    expect(body.messages.map((m) => m.content)).toEqual([
      'msg-5',
      'msg-4',
      'msg-3',
    ]);
    expect(body.messages.every((m) => typeof m.id === 'string')).toBe(true);
    expect(body.nextCursor).toBe('3');
  });

  // ── AC-2: cursor 적용 — 더 오래된 페이지 ──
  it('AC-2: GET with cursor → 커서보다 오래된 메시지만 내림차순', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    for (let i = 1; i <= 5; i += 1) {
      seedMessage('moim-A', memberSub, `msg-${i}`);
    }
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/messages?cursor=3&limit=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      messages: { content: string }[];
      nextCursor: string | null;
    };
    expect(body.messages.map((m) => m.content)).toEqual(['msg-2', 'msg-1']);
    expect(body.nextCursor).toBeNull();
  });

  // ── 엣지: 잘못된 cursor → 400 ──
  it('엣지: 잘못된 cursor → 400', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .get('/moims/moim-A/messages?cursor=not-a-number&limit=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  // ── AC-3: 비멤버 히스토리 조회 403 ──
  it('AC-3: 비멤버의 GET → 403', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithMembers('moim-A', [ownerSub]);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .get('/moims/moim-A/messages')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });
});
