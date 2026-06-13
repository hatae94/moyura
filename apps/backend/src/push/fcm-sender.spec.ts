import type { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FcmSender, type PushNotification } from './fcm-sender';

// firebase-admin을 완전히 mock 한다(외부 네트워크/자격증명 의존 제거 — 결정적 단위 테스트).
jest.mock('firebase-admin');

const mockedAdmin = admin as jest.Mocked<typeof admin>;

// FcmSender 단위 테스트(REQ-PUSH-001 / AC-1, 엣지). graceful no-op(자격증명 부재) + 발송(존재) +
// 0-토큰 미발송 + best-effort(실패 무시)를 검증한다. 자격증명 부재 시 부팅/통합 테스트가 통과해야 한다.

const NOTIFICATION: PushNotification = { title: '호스트', body: '안녕하세요' };

// ConfigService.get(FIREBASE_CREDENTIALS) 결과를 주입하는 스텁.
function makeConfig(firebaseCredentials: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'FIREBASE_CREDENTIALS' ? firebaseCredentials : undefined,
    ),
  } as unknown as ConfigService;
}

// 유효 형태의 서비스 계정 키 JSON(파싱만 — mock이라 실제 인증 없음). 실제 키 값은 placeholder.
const CREDS_JSON = JSON.stringify({
  project_id: 'demo',
  client_email: 'sa@demo.iam.gserviceaccount.com',
  private_key: 'FAKE_KEY_FOR_TEST_ONLY',
});

describe('FcmSender', () => {
  let sendEachForMulticast: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sendEachForMulticast = jest
      .fn()
      .mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] });
    // admin.messaging() → { sendEachForMulticast }. firebase-admin auto-mock이 namespace getter를
    // jest.fn으로 만들지 않을 수 있으므로 명시적으로 jest.fn을 할당한다(타입 만족용 Object.assign 우회).
    Object.assign(mockedAdmin, {
      messaging: jest.fn().mockReturnValue({ sendEachForMulticast }),
      credential: { cert: jest.fn().mockReturnValue({ type: 'cert' }) },
      initializeApp: jest.fn().mockReturnValue({}),
    });
    // 초기화 가드용 apps 배열(빈 상태 = 미초기화).
    Object.defineProperty(mockedAdmin, 'apps', { value: [], configurable: true });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('자격증명 부재 — graceful no-op (push 비활성)', () => {
    it('init 하지 않고 경고를 1회 로깅한다', () => {
      const sender = new FcmSender(makeConfig(undefined));
      sender.onModuleInit();

      expect(mockedAdmin.initializeApp).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('send()는 no-op이다 — messaging을 호출하지 않는다', async () => {
      const sender = new FcmSender(makeConfig(undefined));
      sender.onModuleInit();

      await sender.send(['tok-1', 'tok-2'], NOTIFICATION);

      expect(sendEachForMulticast).not.toHaveBeenCalled();
    });
  });

  describe('자격증명 존재 — 발송 활성', () => {
    it('onModuleInit에서 파싱한 credential로 initializeApp을 1회 호출한다', () => {
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      expect(mockedAdmin.credential.cert).toHaveBeenCalledTimes(1);
      expect(mockedAdmin.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('기본 firebase app이 이미 초기화돼 있으면 재초기화하지 않고 messaging만 잡는다 (admin.apps.length > 0 branch)', async () => {
      // 다른 모듈/테스트가 이미 initializeApp 한 상태(apps 비어있지 않음) — 재호출은 throw 하므로 건너뛴다.
      Object.defineProperty(mockedAdmin, 'apps', {
        value: [{ name: '[DEFAULT]' }],
        configurable: true,
      });
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      // 이미 초기화돼 있으므로 initializeApp 은 건너뛴다(중복 초기화 throw 방지). messaging 은 그대로 잡힌다.
      expect(mockedAdmin.initializeApp).not.toHaveBeenCalled();
      await sender.send(['tok-1'], NOTIFICATION);
      expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    });

    it('send()는 토큰 목록과 notification으로 sendEachForMulticast를 호출한다 (AC-1)', async () => {
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      await sender.send(['tok-1', 'tok-2'], NOTIFICATION, { moimId: 'moim-A' });

      expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
      const arg = sendEachForMulticast.mock.calls[0][0];
      expect(arg.tokens).toEqual(['tok-1', 'tok-2']);
      expect(arg.notification).toEqual({ title: '호스트', body: '안녕하세요' });
      expect(arg.data).toEqual({ moimId: 'moim-A' });
    });

    it('토큰이 0개면 발송하지 않는다 (엣지 — 등록 디바이스 없는 모임)', async () => {
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      await sender.send([], NOTIFICATION);

      expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('best-effort: 발송이 reject 되어도 throw 하지 않는다 (재시도/큐 비범위, R)', async () => {
      sendEachForMulticast.mockRejectedValueOnce(new Error('FCM down'));
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      await expect(
        sender.send(['tok-1'], NOTIFICATION),
      ).resolves.toBeUndefined();
    });

    it('best-effort: non-Error 값으로 reject 돼도 unknown error 로 흡수한다 (ternary fallback branch)', async () => {
      // Error 가 아닌 값(문자열)으로 reject — err instanceof Error 의 false 분기(unknown error)를 커버.
      sendEachForMulticast.mockRejectedValueOnce('string failure');
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      await expect(
        sender.send(['tok-1'], NOTIFICATION),
      ).resolves.toBeUndefined();
    });

    it('send()는 data 없이도 호출한다 (선택적 data 미포함 branch)', async () => {
      const sender = new FcmSender(makeConfig(CREDS_JSON));
      sender.onModuleInit();

      await sender.send(['tok-1'], NOTIFICATION);

      const arg = sendEachForMulticast.mock.calls[0][0];
      // data 미지정 — 페이로드에 data 키가 들어가지 않는다(...(data ? {data} : {}) 의 빈 분기).
      expect(arg.data).toBeUndefined();
    });
  });

  describe('자격증명 파싱/초기화 실패 — graceful 비활성', () => {
    it('FIREBASE_CREDENTIALS가 유효 JSON이 아니면 init 실패를 흡수하고 send는 no-op이 된다', async () => {
      const sender = new FcmSender(makeConfig("not-a-json"));
      sender.onModuleInit();

      // JSON.parse 실패(SyntaxError) → catch → 비활성. messaging 미설정 → send no-op.
      await sender.send(['tok-1'], NOTIFICATION);
      expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('initializeApp이 non-Error 로 throw 해도 unknown error 로 흡수한다 (init catch ternary fallback)', () => {
      (mockedAdmin.initializeApp as unknown as jest.Mock).mockImplementationOnce(
        () => {
          throw 'init blew up'; // non-Error throw — err instanceof Error 의 false 분기 커버.
        },
      );
      const sender = new FcmSender(makeConfig(CREDS_JSON));

      expect(() => sender.onModuleInit()).not.toThrow();
    });
  });
});
