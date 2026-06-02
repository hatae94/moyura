import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import {
  type AuthenticatedRequest,
  REQUEST_USER_KEY,
  SupabaseAuthGuard,
} from './supabase-auth.guard';
import type {
  TokenVerifierService,
  VerifiedUser,
} from './token-verifier.service';

// SupabaseAuthGuard 단위 테스트(AC-A1/A5/A6/A9). Bearer 추출 + 401 + context 부착을 검증한다.
describe('SupabaseAuthGuard', () => {
  // verify 결과를 제어하는 verifier 스텁.
  function makeVerifier(result: VerifiedUser | null): TokenVerifierService {
    return {
      verify: jest.fn().mockResolvedValue(result),
    } as unknown as TokenVerifierService;
  }

  // Authorization 헤더를 갖는 ExecutionContext를 만든다.
  function makeContext(authHeader: string | undefined): {
    context: ExecutionContext;
    request: AuthenticatedRequest;
  } {
    const request = {
      headers: authHeader ? { authorization: authHeader } : {},
    } as AuthenticatedRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  const validUser: VerifiedUser = { sub: 'user-123', role: 'authenticated' };

  it('유효 Bearer 토큰 + 검증 성공 → 통과하고 request.user를 부착한다 (AC-A6)', async () => {
    const guard = new SupabaseAuthGuard(makeVerifier(validUser));
    const { context, request } = makeContext('Bearer valid.token.here');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[REQUEST_USER_KEY]).toEqual(validUser);
  });

  it('Authorization 헤더 부재 → 401, user context 미부착 (AC-A1/A5)', async () => {
    const guard = new SupabaseAuthGuard(makeVerifier(validUser));
    const { context, request } = makeContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(request[REQUEST_USER_KEY]).toBeUndefined();
  });

  it('검증 실패(verify=null) → 401, user context 미부착 (AC-A5)', async () => {
    const guard = new SupabaseAuthGuard(makeVerifier(null));
    const { context, request } = makeContext('Bearer bad.token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(request[REQUEST_USER_KEY]).toBeUndefined();
  });

  it('Bearer 접두사가 아닌 헤더(예: Basic)는 거부한다 → 401 (AC-A9 Bearer-only)', async () => {
    const guard = new SupabaseAuthGuard(makeVerifier(validUser));
    const { context } = makeContext('Basic dXNlcjpwYXNz');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('Bearer 뒤 토큰이 비어 있으면 거부한다 → 401', async () => {
    const guard = new SupabaseAuthGuard(makeVerifier(validUser));
    const { context } = makeContext('Bearer    ');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
