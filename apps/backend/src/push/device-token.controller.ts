import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { DeviceTokenService } from './device-token.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

// @MX:NOTE: [AUTO] 디바이스 토큰 HTTP 표면(REQ-PUSH-002/003 / AC-2). 두 라우트 모두 per-route
// @UseGuards(SupabaseAuthGuard)로 보호되어 토큰 없는 요청은 401이 된다(moim/me 패턴 동일). 등록은
// 가드 sub만으로 사용자에 연결하고 body의 userId류는 절대 받지 않는다(mass-assignment 차단). 이
// 프로젝트에는 ValidationPipe가 없으므로(C-1) token/platform 비어 있음 검사는 여기서 명시적으로
// BadRequestException(400)을 던진다(CreateMoimDto requireNonEmpty 패턴 동일).
@ApiTags('devices')
@ApiBearerAuth('bearer')
@Controller('devices')
@UseGuards(SupabaseAuthGuard)
export class DeviceTokenController {
  constructor(private readonly deviceTokens: DeviceTokenService) {}

  // POST /devices — 디바이스 토큰 등록(REQ-PUSH-002 / AC-2). 201. token PK 기준 upsert(중복 없음).
  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ description: '디바이스 토큰 등록(upsert, 중복 없음)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async register(
    @CurrentUser() user: VerifiedUser,
    @Body() body: RegisterDeviceDto,
  ): Promise<void> {
    // C-1: ValidationPipe 부재 → token/platform 비어 있음을 명시적으로 검사(400).
    // @Body()는 항상 객체를 반환하므로 옵셔널 체이닝 없이 직접 접근한다(도달 불가 null-arm 분기 제거).
    const token = requireNonEmpty(body.token, 'token');
    const platform = requireNonEmpty(body.platform, 'platform');
    // userId는 가드-검증 sub만 사용한다(body의 어떤 userId도 신뢰하지 않음 — mass-assignment 차단).
    await this.deviceTokens.register(user.sub, token, platform);
  }

  // DELETE /devices/:token — 디바이스 토큰 해제(REQ-PUSH-003 / AC-2, 로그아웃 연동). 204. orphan token 방지.
  // [보안 — IDOR 차단, OWASP A01] 가드 sub 와 path token 을 함께 넘겨 owner-scoped로 삭제한다 — 인증된
  // 사용자라도 자신이 소유한 토큰만 해제할 수 있다(타인 토큰 문자열을 알아도 매칭 0건 → no-op 204).
  @Delete(':token')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '디바이스 토큰 해제(소유자 한정, orphan token 방지)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async unregister(
    @CurrentUser() user: VerifiedUser,
    @Param('token') token: string,
  ): Promise<void> {
    await this.deviceTokens.unregisterByOwner(user.sub, token);
  }
}

// C-1: 문자열 필드가 trim 후 비어 있으면 400을 던진다(ValidationPipe 부재 보완 — moim 패턴 동일).
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}
