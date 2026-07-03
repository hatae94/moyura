import { Controller, Delete, HttpCode, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { AccountService } from './account.service';

// @MX:NOTE: [AUTO] 회원 탈퇴 HTTP 표면(SPEC-ACCOUNT-001 T-07 / REQ-ACCOUNT-001). 클래스 레벨
// @UseGuards(SupabaseAuthGuard)로 토큰 없는/위조 요청을 401 로 선처리하고, 삭제 대상은 오직 가드-검증
// user.sub 만 사용한다 — body/query 를 절대 읽지 않아(파라미터 미선언) 임의 userId 주입(mass-assignment)이
// 구조적으로 불가능하다(R-8, notification.controller 선례). 성공은 본문 없는 204(No Content).
@ApiTags('account')
@ApiBearerAuth()
@Controller('me/account')
@UseGuards(SupabaseAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  // DELETE /me/account: 인증 사용자 본인 계정 삭제(REQ-ACCOUNT-001). 성공 시 204.
  // 삭제 키는 가드-검증 sub 만 사용한다(body 미신뢰 — 남의 계정 삭제 불가).
  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: '계정 삭제 완료 — 본문 없음(204)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async deleteAccount(@CurrentUser() user: VerifiedUser): Promise<void> {
    await this.account.deleteAccount(user.sub);
  }
}
