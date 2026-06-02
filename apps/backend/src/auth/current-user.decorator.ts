import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  type AuthenticatedRequest,
  REQUEST_USER_KEY,
} from './supabase-auth.guard';
import type { VerifiedUser } from './token-verifier.service';

// @MX:NOTE: [AUTO] 핸들러가 가드-부착 인증 user(R-A6)를 읽는 유일한 통로.
// SupabaseAuthGuard가 통과시킨 요청에서만 채워지므로, 보호 라우트 핸들러에서 항상 정의되어 있다.
// body/query가 아닌 검증된 sub만 노출 → mass-assignment 차단(R-B3/M-5)의 출발점.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request[REQUEST_USER_KEY];
  },
);
