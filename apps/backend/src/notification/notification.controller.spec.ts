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
import type {
  Moim,
  MoimMember,
  Notification,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MarkReadResponseDto,
  NotificationDto,
  NotificationListResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';

// /notifications 통합 테스트(SPEC-NOTIFICATIONS-001 M3). 실제 Nest app + 실제 SupabaseAuthGuard 배선을 사용한다.
// TokenVerifierService 는 로컬-JWKS(결정적 ES256)로, PrismaService 는 인메모리 fake 로 오버라이드한다
// (Prisma 7 WASM 컴파일러가 jest VM 에서 동작하지 않음 — me.controller.spec 선례).
// 이 스펙이 증명하는 것: 가드 실제 배선(401), recipientId==sub 인가 격리(쿼리 키=검증 sub, 남의 알림 미노출/미갱신),
// cursor/limit/read 바디 명시 검증(400), DTO 직렬화(id/커서 문자열, 날짜 ISO, actor null/객체 처리).
const NOW = new Date('2026-07-02T00:00:00.000Z');

interface NotifFindManyArg {
  where: {
    recipientId: string;
    id?: { lt: bigint };
    // SPEC-SAFETY-001 T-005: 뷰어가 숨긴 actor 제외(actorId notIn). null actor 는 통과.
    actorId?: { notIn: string[] };
  };
  orderBy: { id: 'desc' };
  take: number;
}
interface NotifCountArg {
  where: { recipientId: string; readAt: null };
}
interface NotifUpdateManyArg {
  where: { recipientId: string; readAt: null; id?: { in: bigint[] } };
  data: { readAt: Date };
}
interface MoimFindManyArg {
  where: { id: { in: string[] } };
}
interface MemberFindManyArg {
  where: { moimId: { in: string[] }; userId: { in: string[] } };
}

function notif(
  overrides: Partial<Notification> & { id: bigint; recipientId: string },
): Notification {
  return {
    id: overrides.id,
    recipientId: overrides.recipientId,
    type: overrides.type ?? 'member.joined',
    moimId: overrides.moimId ?? 'moim-A',
    actorId: overrides.actorId ?? null,
    data: overrides.data ?? {},
    readAt: overrides.readAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
  };
}

function moim(id: string, name: string): Moim {
  return {
    id,
    name,
    startsAt: null,
    location: null,
    createdBy: 'sub-owner',
    maxMembers: 15,
    createdAt: NOW,
    budget: null,
  };
}

function member(moimId: string, userId: string, nickname: string): MoimMember {
  return {
    moimId,
    userId,
    nickname,
    role: 'member',
    joinedAt: NOW,
    withdrawnAt: null,
  };
}

function byIdDesc(a: Notification, b: Notification): number {
  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

describe('/notifications (통합 — 가드 배선 + recipientId==sub 인가 격리)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;

  // 인메모리 fake 저장소(테스트별 reset). fake prisma 메서드가 호출 시점에 이 배열들을 읽는다.
  let notifRows: Notification[] = [];
  let moimRows: Moim[] = [];
  let memberRows: MoimMember[] = [];
  // 인가 격리 단언용: 마지막 쿼리 인자 캡처.
  let lastFindManyArg: NotifFindManyArg | null = null;
  let lastCountArg: NotifCountArg | null = null;
  let lastUpdateManyArg: NotifUpdateManyArg | null = null;

  beforeAll(async () => {
    keys = await generateEs256Keys();

    const fakePrisma = {
      notification: {
        findMany: jest.fn((arg: NotifFindManyArg) => {
          lastFindManyArg = arg;
          let rows = notifRows.filter(
            (n) => n.recipientId === arg.where.recipientId,
          );
          const lt = arg.where.id?.lt;
          if (lt !== undefined) {
            rows = rows.filter((n) => n.id < lt);
          }
          // SPEC-SAFETY-001 T-005: actorId notIn 필터. nullable notIn 은 NULL(시스템/무행위자) 행을 통과시킨다.
          const notIn = arg.where.actorId?.notIn;
          if (notIn !== undefined) {
            rows = rows.filter(
              (n) => n.actorId === null || !notIn.includes(n.actorId),
            );
          }
          rows = [...rows].sort(byIdDesc);
          return Promise.resolve(rows.slice(0, arg.take));
        }),
        count: jest.fn((arg: NotifCountArg) => {
          lastCountArg = arg;
          return Promise.resolve(
            notifRows.filter(
              (n) =>
                n.recipientId === arg.where.recipientId && n.readAt === null,
            ).length,
          );
        }),
        updateMany: jest.fn((arg: NotifUpdateManyArg) => {
          lastUpdateManyArg = arg;
          const idsIn = arg.where.id?.in;
          const matched = notifRows.filter((n) => {
            if (n.recipientId !== arg.where.recipientId) return false;
            if (n.readAt !== null) return false;
            if (idsIn !== undefined && !idsIn.includes(n.id)) return false;
            return true;
          });
          for (const n of matched) {
            n.readAt = arg.data.readAt;
          }
          return Promise.resolve({ count: matched.length });
        }),
      },
      moim: {
        findMany: jest.fn((arg: MoimFindManyArg) =>
          Promise.resolve(
            moimRows.filter((m) => arg.where.id.in.includes(m.id)),
          ),
        ),
      },
      moimMember: {
        findMany: jest.fn((arg: MemberFindManyArg) =>
          Promise.resolve(
            memberRows.filter(
              (m) =>
                arg.where.moimId.in.includes(m.moimId) &&
                arg.where.userId.in.includes(m.userId),
            ),
          ),
        ),
      },
      // SPEC-SAFETY-001 T-005: NotificationModule 이 SafetyModule 을 import 하므로 listForRecipient 가 SafetyService.
      // getHiddenUserIds(block∪report)를 호출한다. 이 통합 테스트는 차단/신고 시드가 없으니 빈 목록을 반환한다.
      block: { findMany: jest.fn(() => Promise.resolve([])) },
      report: { findMany: jest.fn(() => Promise.resolve([])) },
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
    notifRows = [];
    moimRows = [];
    memberRows = [];
    lastFindManyArg = null;
    lastCountArg = null;
    lastUpdateManyArg = null;
  });

  let subSeq = 0;
  function uniqueSub(): string {
    subSeq += 1;
    return `00000000-0000-4000-8000-${subSeq.toString(16).padStart(12, '0')}`;
  }
  function tokenFor(sub: string): Promise<string> {
    return signEs256(keys.privateKey, { sub });
  }

  // ── 가드 배선(401) ──────────────────────────────────────────────────────────

  it('토큰 없이 GET /notifications → 401 (가드 실제 배선)', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
  });

  it('토큰 없이 GET /notifications/unread-count → 401', async () => {
    await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .expect(401);
  });

  it('토큰 없이 POST /notifications/read → 401', async () => {
    await request(app.getHttpServer())
      .post('/notifications/read')
      .send({ all: true })
      .expect(401);
  });

  // ── GET /notifications: DTO 직렬화 + 해석 ─────────────────────────────────────

  it('유효 토큰 GET /notifications → 200, DTO 직렬화(id/커서 문자열, 날짜 ISO, actor 객체, moimName)', async () => {
    const sub = uniqueSub();
    notifRows = [
      notif({
        id: 41n,
        recipientId: sub,
        moimId: 'moim-A',
        actorId: 'sub-actor',
        type: 'poll.created',
        data: { pollId: 'p1', question: '점심?' },
        createdAt: NOW,
      }),
      notif({ id: 42n, recipientId: sub, moimId: 'moim-A', actorId: null }),
    ];
    moimRows = [moim('moim-A', '금요일 모임')];
    memberRows = [member('moim-A', 'sub-actor', '길동')];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as NotificationListResponseDto;
    // 최신순(42,41). nextCursor 는 문자열(더 없으면 null — 여기선 2건 < limit 20 → null).
    expect(body.items.map((i: NotificationDto) => i.id)).toEqual(['42', '41']);
    expect(body.nextCursor).toBeNull();

    const first = body.items[0]; // id 42, actorId null
    expect(first.id).toBe('42');
    expect(first.actor).toBeNull();
    expect(first.moimName).toBe('금요일 모임');
    expect(typeof first.createdAt).toBe('string');
    expect(first.readAt).toBeNull();

    const second = body.items[1]; // id 41, actor 해석
    expect(second.actor).toEqual({ id: 'sub-actor', nickname: '길동' });
    expect(second.data).toEqual({ pollId: 'p1', question: '점심?' });

    // 조회 키는 검증된 sub만 — query/body 미신뢰.
    expect(lastFindManyArg?.where.recipientId).toBe(sub);
  });

  it('GET /notifications?cursor=bad → 400 (mirror chat parseCursor)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .get('/notifications')
      .query({ cursor: 'not-a-bigint' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /notifications?limit=999 → take 는 MAX_LIMIT(50)으로 캡된다', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .get('/notifications')
      .query({ limit: '999' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(lastFindManyArg?.take).toBe(50);
  });

  it('GET /notifications?limit=2 → nextCursor 는 마지막 행 id 문자열(가득 채움)', async () => {
    const sub = uniqueSub();
    notifRows = [
      notif({ id: 1n, recipientId: sub }),
      notif({ id: 2n, recipientId: sub }),
      notif({ id: 3n, recipientId: sub }),
    ];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .query({ limit: '2' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as NotificationListResponseDto;
    expect(body.items.map((i: NotificationDto) => i.id)).toEqual(['3', '2']);
    expect(body.nextCursor).toBe('2');
  });

  // ── GET /notifications/unread-count ──────────────────────────────────────────

  it('GET /notifications/unread-count → 200 { count }(미읽음만)', async () => {
    const sub = uniqueSub();
    notifRows = [
      notif({ id: 1n, recipientId: sub, readAt: null }),
      notif({ id: 2n, recipientId: sub, readAt: NOW }),
      notif({ id: 3n, recipientId: sub, readAt: null }),
    ];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((res.body as UnreadCountResponseDto).count).toBe(2);
    expect(lastCountArg?.where.recipientId).toBe(sub);
  });

  // ── POST /notifications/read: 바디 검증 ──────────────────────────────────────

  it('POST /notifications/read {} → 400 (ids/all 둘 다 없음)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('POST /notifications/read { ids: [] } → 400 (빈 배열)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [] })
      .expect(400);
  });

  it('POST /notifications/read { ids: ["nope"] } → 400 (BigInt 아님)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);
    await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['nope'] })
      .expect(400);
  });

  it('POST /notifications/read { ids } → 200 { updated }, 해당 행이 읽음 처리됨', async () => {
    const sub = uniqueSub();
    notifRows = [
      notif({ id: 10n, recipientId: sub, readAt: null }),
      notif({ id: 11n, recipientId: sub, readAt: null }),
    ];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['10'] })
      .expect(200);

    expect((res.body as MarkReadResponseDto).updated).toBe(1);
    expect(notifRows.find((n) => n.id === 10n)?.readAt).not.toBeNull();
    expect(notifRows.find((n) => n.id === 11n)?.readAt).toBeNull();
    // 갱신 키는 검증된 sub + BigInt in 절.
    expect(lastUpdateManyArg?.where).toEqual({
      recipientId: sub,
      readAt: null,
      id: { in: [10n] },
    });
  });

  it('POST /notifications/read { all: true } → 200, 수신자 전체 미읽음 처리', async () => {
    const sub = uniqueSub();
    notifRows = [
      notif({ id: 20n, recipientId: sub, readAt: null }),
      notif({ id: 21n, recipientId: sub, readAt: null }),
    ];
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ all: true })
      .expect(200);

    expect((res.body as MarkReadResponseDto).updated).toBe(2);
    expect(lastUpdateManyArg?.where).toEqual({
      recipientId: sub,
      readAt: null,
    });
  });

  // ── 인가 격리: 남의 알림 미노출/미갱신 ────────────────────────────────────────

  it('인가 격리: 토큰 sub 로만 조회 — 다른 사용자(attacker) 알림은 노출되지 않는다', async () => {
    const verifiedSub = uniqueSub();
    const attackerSub = uniqueSub();
    // 저장소엔 attacker 의 알림만 있다.
    notifRows = [notif({ id: 99n, recipientId: attackerSub })];
    const token = await tokenFor(verifiedSub);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      // query 로 attacker sub 주입 시도 — 무시되어야 한다.
      .query({ recipientId: attackerSub, sub: attackerSub })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as NotificationListResponseDto;
    // verified 의 알림은 0건 — attacker 의 99 는 절대 새어나오지 않는다.
    expect(body.items).toEqual([]);
    expect(lastFindManyArg?.where.recipientId).toBe(verifiedSub);
  });

  it('인가 격리: attacker 알림 id 를 read 로 지정해도 recipientId=검증 sub 필터로 갱신 0', async () => {
    const verifiedSub = uniqueSub();
    const attackerSub = uniqueSub();
    notifRows = [notif({ id: 77n, recipientId: attackerSub, readAt: null })];
    const token = await tokenFor(verifiedSub);

    const res = await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['77'] })
      .expect(200);

    expect((res.body as MarkReadResponseDto).updated).toBe(0);
    // attacker 의 알림은 여전히 미읽음.
    expect(notifRows.find((n) => n.id === 77n)?.readAt).toBeNull();
    expect(lastUpdateManyArg?.where.recipientId).toBe(verifiedSub);
  });
});
