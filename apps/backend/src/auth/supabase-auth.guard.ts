import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  TokenVerifierService,
  type VerifiedUser,
} from './token-verifier.service';

// 가드가 검증 성공 시 request에 부착하는 user 컨텍스트의 키. downstream(@CurrentUser)이 동일 키로 읽는다.
export const REQUEST_USER_KEY = 'user';

// request에 부착된 인증 컨텍스트를 읽기 위한 타입 확장(R-A6).
export interface AuthenticatedRequest extends Request {
  [REQUEST_USER_KEY]?: VerifiedUser;
}

// @MX:ANCHOR: [AUTO] no-op pass-through seam을 대체하는 실제 인증 가드(R-A1). 보호 라우트(/me)에
// per-route @UseGuards로 적용되어 토큰 없는/위조 요청을 401로 실제 차단한다(R-A10/OD-7, AC-A10/C2).
// @MX:REASON: 인증면의 enforcement 지점. Bearer 헤더 추출(R-A9) → TokenVerifierService 검증 →
// request.user 부착(R-A6)의 계약을 보호 라우트들이 의존한다. /health·GET / 는 이 가드를 달지 않아
// 구조적으로 public을 유지한다(R-C3/M-1, fail-safe).

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly verifier: TokenVerifierService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // R-A9/M-2: 토큰은 Authorization Bearer 헤더에서만 읽는다(URL/query 절대 사용 금지).
    const token = this.extractBearerToken(request);
    if (!token) {
      // 토큰 부재 → 401, user 컨텍스트 미부착(R-A5).
      throw new UnauthorizedException();
    }

    const user = await this.verifier.verify(token);
    if (!user) {
      // 서명/claim/alg 검증 실패 → 401, user 컨텍스트 미부착(R-A5/A8).
      // 토큰 내용을 응답/예외 메시지에 echo하지 않는다(R-A9 — 기본 401 메시지만).
      throw new UnauthorizedException();
    }

    // R-A6: 검증된 user 컨텍스트(최소 sub)를 request에 부착해 downstream이 신뢰할 수 있게 한다.
    request[REQUEST_USER_KEY] = user;
    return true;
  }

  // Authorization: Bearer <token> 에서 토큰만 추출. 형식이 다르면 null(R-A9).
  private extractBearerToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      return null;
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : null;
  }
}
