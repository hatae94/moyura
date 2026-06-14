import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { UpdateNameDto } from './dto/update-name.dto';
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
      // SPEC-MOBILE-004 T-001: name(nullable)을 함께 노출 — 웹 온보딩 가드의 권위 있는 출처.
      name: profile.name,
      createdAt: profile.createdAt.toISOString(),
    };
  }

  // @MX:NOTE: [AUTO] SPEC-MOBILE-004 REQ-MOB4-003/004: 이름 영속 엔드포인트(PATCH /me).
  // 이메일 회원가입·이름 온보딩(향후 소셜)이 공유하는 provider 비종속 단일 영속 경로의 HTTP 표면이다.
  // 가드를 통과한 요청만 도달하므로 user는 항상 정의되어 있고, 키는 가드-검증 sub만 쓴다(mass-assignment 차단).
  // ValidationPipe 부재(C-1) → name 비어 있음(trim 후 빈 문자열)은 여기서 명시적으로 400을 던진다.
  @Patch()
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: '이름 갱신 후 갱신된 profile 반환',
    type: ProfileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'name이 비어 있음(trim 후) — 400' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async updateName(
    @CurrentUser() user: VerifiedUser,
    @Body() body: UpdateNameDto,
  ): Promise<ProfileResponseDto> {
    // C-1: ValidationPipe 부재 → name 비어 있음을 명시적으로 검사(400) (RegisterDeviceDto 패턴 동일).
    const name = requireNonEmpty(body.name, 'name');
    // 갱신 키는 가드-검증된 sub만 사용한다(body의 id/sub는 절대 신뢰하지 않음 — mass-assignment 차단).
    const profile = await this.profileService.updateName(user.sub, name);
    return {
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt.toISOString(),
    };
  }
}

// C-1: 문자열 필드가 trim 후 비어 있으면 400을 던진다(ValidationPipe 부재 보완 — device/moim 패턴 동일).
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}
