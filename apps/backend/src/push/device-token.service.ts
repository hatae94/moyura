import { Injectable } from '@nestjs/common';
import type { DeviceToken } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// @MX:ANCHOR: [AUTO] 디바이스 토큰 등록/해제의 단일 진입점(REQ-PUSH-002/003 / AC-2). 모바일
// 등록(AuthContext signed-in 효과)·로그아웃 해제(useAuthBridge cleared)·DeviceTokenController가 이
// 계약에 의존한다(fan_in >= 3).
// @MX:REASON: register는 token PK 기준 upsert라 중복 row가 생기지 않고(REQ-PUSH-002), userId는 가드-검증
// sub만 받아 mass-assignment를 구조적으로 차단한다(profile/moim 패턴 동일). unregisterByOwner는 token AND
// userId(=sub)가 모두 일치하는 row만 삭제해 IDOR(OWASP A01 — 인증된 타인이 남의 디바이스 등록을 임의 삭제)를
// 구조적으로 차단하고, deleteMany를 써서 비소유/부재 토큰을 count 0(멱등 no-op, P2025 없음)으로 흡수한다.
// 이 불변식이 깨지면 잘못된 사용자에게 푸시가 가거나(보안) 인증된 공격자가 타인 토큰을 해제할 수 있다.
@Injectable()
export class DeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  // 검증된 sub로 디바이스 토큰을 등록한다(token PK 기준 upsert — 중복 없음, REQ-PUSH-002).
  //
  // [보안] sub는 컨트롤러가 가드-부착 VerifiedUser.sub에서만 전달한다. body/query/header 값을 받지 않는다.
  // create/update 모두 token/userId/platform 외 어떤 클라이언트 필드도 끼워 넣지 않는다(mass-assignment 차단).
  // 같은 디바이스 토큰이 다른 사용자로 재등록되면 userId/platform이 갱신된다(디바이스 핸드오프 — 이전 소유자 정리).
  async register(
    sub: string,
    token: string,
    platform: string,
  ): Promise<DeviceToken> {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { token, userId: sub, platform },
      update: { userId: sub, platform },
    });
  }

  // owner-scoped 디바이스 토큰 해제(로그아웃 연동 — orphan token 방지, REQ-PUSH-003 / AC-2).
  //
  // [보안 — IDOR 차단, OWASP A01] token 과 userId(=가드 검증 sub)가 모두 일치하는 row만 삭제한다.
  // 인증된 다른 사용자가 타인의 token 문자열을 알더라도 userId 불일치로 매칭 0건이 되어 삭제되지 않는다.
  // deleteMany를 쓰므로 비소유/부재 토큰은 count 0(멱등 no-op)이 되어 P2025 예외 처리가 필요 없다 —
  // 중복 로그아웃/네트워크 재시도에도 204 응답이 일관된다.
  async unregisterByOwner(sub: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({
      where: { token, userId: sub },
    });
  }
}
