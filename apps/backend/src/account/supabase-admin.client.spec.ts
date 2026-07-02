import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseAdminClientImpl } from './supabase-admin.client';

// @supabase/supabase-js 를 완전히 mock 한다(외부 네트워크/service-role 자격증명 의존 제거 — 결정적 단위 테스트).
// fcm-sender.spec 의 firebase-admin mock 패턴과 동일: createClient 를 jest.fn 으로 대체하고 admin.deleteUser 결과를 주입한다.
jest.mock('@supabase/supabase-js');

const mockedCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

// SupabaseAdminClient 단위 테스트(SPEC-ACCOUNT-001 T-03 / REQ-ACCOUNT-001 · AC 엣지 EC-5).
//   - service-role 키 부재 → fail-closed(자격증명 없이 삭제 불가): isConfigured=false + deleteUser 시 500.
//   - 키 존재 → auth.admin.deleteUser(sub) 위임 + persistSession:false 클라이언트 구성.
//   - supabase 가 error 를 반환하면 삭제 실패 → 500(부분 삭제 유발 방지, 재실행 복구 대상).

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'service-role-key-for-test-only';
const SUB = '11111111-1111-1111-1111-111111111111';

// ConfigService.get(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 결과를 주입하는 스텁(fcm-sender.spec makeConfig 패턴).
function makeConfig(serviceRoleKey: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'SUPABASE_URL') return SUPABASE_URL;
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return serviceRoleKey;
      return undefined;
    }),
  } as unknown as ConfigService;
}

// createClient().auth.admin.deleteUser 가 반환할 UserResponse({data,error}) 를 주입하는 mock 클라이언트를 만든다.
// deleteUser 는 jest.fn + Promise.resolve/reject 만 사용한다(async 키워드 금지 — 계약 jest fake 규칙).
function stubSupabaseClient(deleteUser: jest.Mock) {
  mockedCreateClient.mockReturnValue({
    auth: { admin: { deleteUser } },
  } as unknown as ReturnType<typeof createClient>);
}

describe('SupabaseAdminClientImpl (T-03 / REQ-ACCOUNT-001)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isConfigured — fail-closed 사전 판정(EC-5 삭제 트랜잭션 미실행 seam)', () => {
    it('SUPABASE_SERVICE_ROLE_KEY 가 있으면 true 를 반환한다', () => {
      const client = new SupabaseAdminClientImpl(makeConfig(SERVICE_ROLE_KEY));
      expect(client.isConfigured()).toBe(true);
    });

    it('SUPABASE_SERVICE_ROLE_KEY 가 없으면 false 를 반환한다(부분 삭제 방지 seam)', () => {
      const client = new SupabaseAdminClientImpl(makeConfig(undefined));
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('deleteUser — service-role 키 부재 시 fail-closed 500(EC-5)', () => {
    it('키가 없으면 InternalServerErrorException(500)을 던지고 createClient 를 호출하지 않는다', async () => {
      const client = new SupabaseAdminClientImpl(makeConfig(undefined));

      await expect(client.deleteUser(SUB)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      // 자격증명 없이는 어떤 auth 호출도 시도하지 않는다(부분 삭제 유발 방지).
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser — 키 존재 시 auth.admin.deleteUser 위임(AC-1-1 auth 경로)', () => {
    it('persistSession:false service-role 클라이언트로 deleteUser(sub)를 1회 위임한다', async () => {
      const deleteUser = jest
        .fn()
        .mockReturnValue(
          Promise.resolve({ data: { user: null }, error: null }),
        );
      stubSupabaseClient(deleteUser);
      const client = new SupabaseAdminClientImpl(makeConfig(SERVICE_ROLE_KEY));

      await expect(client.deleteUser(SUB)).resolves.toBeUndefined();

      expect(mockedCreateClient).toHaveBeenCalledTimes(1);
      const [url, key, options] = mockedCreateClient.mock.calls[0];
      expect(url).toBe(SUPABASE_URL);
      expect(key).toBe(SERVICE_ROLE_KEY);
      expect(options?.auth?.persistSession).toBe(false);
      // 삭제 대상은 전달받은 sub 뿐(임의 필드 주입 없음).
      expect(deleteUser).toHaveBeenCalledTimes(1);
      expect(deleteUser).toHaveBeenCalledWith(SUB);
    });

    it('supabase 가 error 를 반환하면 500 으로 승격한다(삭제 실패 → 재실행 복구 대상)', async () => {
      const deleteUser = jest.fn().mockReturnValue(
        Promise.resolve({
          data: { user: null },
          error: { message: 'user not found', status: 404 },
        }),
      );
      stubSupabaseClient(deleteUser);
      const client = new SupabaseAdminClientImpl(makeConfig(SERVICE_ROLE_KEY));

      await expect(client.deleteUser(SUB)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});
