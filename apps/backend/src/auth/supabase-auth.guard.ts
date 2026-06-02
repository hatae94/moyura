import { type CanActivate, Injectable } from '@nestjs/common';

// @MX:NOTE: [AUTO] Auth seam(R-H1/H3): 미래 Supabase Auth JWT 검증을 위한 배선점.
// 현재는 pass-through(항상 true)로, 어떤 라우트도 차단하지 않으며 토큰 검증/로그인/유저 영속화
// 로직을 포함하지 않는다(R-H3). 실제 JWT guard는 이 클래스를 교체/확장하여 drop-in 한다.
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
