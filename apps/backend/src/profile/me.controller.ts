import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { ProfileResponseDto } from './profile-response.dto';
import { ProfileService } from './profile.service';

// @MX:ANCHOR: [AUTO] 가드 + profile upsert가 함께 동작함을 증명하는 종단 산출물(R-C4).
// per-route @UseGuards(SupabaseAuthGuard)로 보호되어 토큰 없는 /me 호출은 실제 401이 된다(R-A10/C2).
// @MX:REASON: SPEC-AUTH-001의 end-to-end proof artifact. 가드 적용점이자 최초 인증 시 UPSERT
// 트리거 지점 — 인증면 회귀 시 가장 먼저 깨지는 계약이므로 경계를 명시한다.
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly profileService: ProfileService) {}

  // GET /me: 인증 사용자의 profile 반환(최초면 UPSERT 생성 후 반환) (R-C1).
  // 가드를 통과한 요청만 도달하므로 user는 항상 정의되어 있다(R-A6).
  @Get()
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: '인증 사용자의 profile(최초 요청 시 자동 생성)',
    type: ProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async getMe(@CurrentUser() user: VerifiedUser): Promise<ProfileResponseDto> {
    // UPSERT 키는 가드-검증된 sub만 사용한다(body/query/header 미사용 — R-B3/M-5).
    const profile = await this.profileService.upsertBySub(user.sub);
    return {
      id: profile.id,
      createdAt: profile.createdAt.toISOString(),
    };
  }
}
