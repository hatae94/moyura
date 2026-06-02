import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  type JWTPayload,
  jwtVerify,
} from 'jose';
import { JWKSNoMatchingKey, JWKSTimeout } from 'jose/errors';
import { type AuthConfig, buildAuthConfig } from './auth.config';
import type { Env } from '../config/env.validation';

// @MX:ANCHOR: [AUTO] JWT 서명/클레임 검증의 단일 보안 경계(security boundary). SupabaseAuthGuard가
// 전적으로 이 서비스의 verify 결과에 의존하며, 보호 라우트의 인증 판정이 여기서 결정된다.
// @MX:REASON: alg pinning(R-A2/A8) · iss/aud/exp normative 검증(R-A7) · JWKS fail-closed(R-A3/M-3) ·
// HS256 폴백 격리(R-A4)가 모두 이 한 곳에 모인다. 우회/완화 시 전체 인증면이 무너진다(fan_in 보안 경계).

// 검증 성공 시 downstream으로 전달되는 인증 컨텍스트(R-A6). 최소 sub + role.
export interface VerifiedUser {
  // Supabase user uuid(`sub`). profile UPSERT 키의 유일한 출처(R-B3/M-5).
  readonly sub: string;
  // GoTrue role 클레임(예: 'authenticated'). 인가가 아니라 참고용으로만 부착.
  readonly role?: string;
}

// 허용 알고리즘 화이트리스트(R-A2/A4/A8). 토큰 헤더의 alg를 신뢰하지 않고 검증기에 고정한다.
const ES256 = 'ES256';
const HS256 = 'HS256';

// clock skew 허용치(R-A7). nbf/iat가 미세하게 미래여도, exp가 미세하게 과거여도 흡수(<=60s 권장).
const CLOCK_TOLERANCE_SECONDS = 60;

// JWKS fetch bounded timeout(R-A3). 무한 대기를 막아 fail-closed 시점을 결정한다.
const JWKS_TIMEOUT_MS = 2000;
// JWKS 재fetch cooldown(R-A3). kid miss(키 회전) 시에도 thundering-herd를 막는다.
const JWKS_COOLDOWN_MS = 30_000;

@Injectable()
export class TokenVerifierService implements OnModuleInit {
  // 토큰/Authorization 헤더 내용은 절대 로깅하지 않는다(R-A9/M-2). 실패 사유 분류만 남긴다.
  private readonly logger = new Logger(TokenVerifierService.name);
  private authConfig!: AuthConfig;

  // createRemoteJWKSet가 반환하는 key resolver. 캐시 + kid-miss 회전 + cooldown을 내부 위임(R-A3/K7).
  // per-request 라운드트립 없음(R-A2/A7) — 캐시 적중 시 네트워크 호출 0회.
  private jwks!: ReturnType<typeof createRemoteJWKSet>;

  // configureForTest로 이미 구성되었으면 onModuleInit가 env 도출을 건너뛴다(테스트 seam 보호).
  private configured = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  // 부팅 시 1회 설정을 도출하고 JWKS resolver를 생성한다(per-request 생성 금지 — 캐시 공유 목적).
  onModuleInit(): void {
    if (this.configured) {
      return;
    }
    this.authConfig = buildAuthConfig(this.config);
    this.jwks = createRemoteJWKSet(new URL(this.authConfig.jwksUrl), {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
    });
    this.configured = true;
  }

  // 테스트에서 외부 JWKS resolver/설정을 주입하기 위한 seam(라이브 스택 의존 없이 결정적 테스트).
  // 프로덕션 경로는 onModuleInit가 호출하며, 테스트는 명시적으로 이 메서드로 대체한다.
  configureForTest(
    authConfig: AuthConfig,
    jwks: ReturnType<typeof createRemoteJWKSet>,
  ): void {
    this.authConfig = authConfig;
    this.jwks = jwks;
    this.configured = true;
  }

  // @MX:NOTE: [AUTO] 검증 실패는 예외 사유를 호출자(가드)에 노출하지 않는다 — null 반환만 한다.
  // 가드가 401을 던지며, 토큰 내용은 어떤 경로로도 로그/응답에 echo되지 않는다(R-A9/M-2).
  //
  // 검증 흐름(순서가 보안상 중요):
  //   1) protected header 디코드 → alg 추출. alg가 화이트리스트(ES256/HS256) 밖이거나
  //      'none'이면 서명 검증 단계 이전에 즉시 거부(R-A8/B-1).
  //   2) ES256 → JWKS 경로(algorithms:['ES256'] 고정). JWKS fetch 실패는 fail-closed(R-A3/M-3),
  //      HS256으로 다운그레이드하지 않는다.
  //   3) HS256 → 레거시 시크릿 경로(algorithms:['HS256'] 고정). 시크릿 미설정이면 거부.
  //   ES256 토큰은 절대 HS256 경로로 라우팅되지 않으므로 alg-confusion(공개키-as-HMAC) 위조 불가(R-A4).
  async verify(token: string): Promise<VerifiedUser | null> {
    let alg: string | undefined;
    try {
      // 서명 검증 전 alg만 읽는다(이 단계는 서명을 신뢰하지 않음 — 라우팅/화이트리스트 판정용).
      alg = decodeProtectedHeader(token).alg;
    } catch {
      // 변형(malformed)된 토큰은 헤더 디코드 자체가 실패한다 → 거부(R-A5).
      return null;
    }

    // R-A8/B-1: 화이트리스트 밖 alg(또는 'none')는 서명 검증 이전에 거부한다.
    if (alg !== ES256 && alg !== HS256) {
      this.logger.warn(`Rejected token: disallowed alg`);
      return null;
    }

    const payload =
      alg === ES256
        ? await this.verifyEs256(token)
        : await this.verifyHs256(token);

    if (!payload) {
      return null;
    }

    // sub는 반드시 존재해야 한다(R-A6/R-B1 — profile 키). 누락 시 거부.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }

    return {
      sub: payload.sub,
      role: typeof payload.role === 'string' ? payload.role : undefined,
    };
  }

  // ES256/JWKS 경로(R-A2/A3/A7). algorithms:['ES256'] 고정 + iss/aud/exp normative 검증.
  private async verifyEs256(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: [ES256],
        issuer: this.authConfig.issuer,
        audience: this.authConfig.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      return payload;
    } catch (error) {
      // R-A3/M-3: JWKS fetch 실패(timeout/no-matching-key after refresh)는 FAIL CLOSED.
      // HS256 폴백으로 다운그레이드하지 않는다 — 공개키-as-HMAC 위조면을 열지 않기 위함.
      if (error instanceof JWKSTimeout || error instanceof JWKSNoMatchingKey) {
        this.logger.error(
          'JWKS verification failed — failing closed (no HS256 downgrade)',
        );
      }
      // 만료/서명불일치/claim불일치 모두 동일하게 거부한다(사유는 토큰 내용 노출 없이 일반화).
      return null;
    }
  }

  // 레거시 HS256 경로(R-A4). 실제로 alg:HS256인 토큰 + SUPABASE_JWT_SECRET 설정 시에만 동작.
  private async verifyHs256(token: string): Promise<JWTPayload | null> {
    if (!this.authConfig.jwtSecret) {
      // 시크릿 미설정 → HS256 경로 비활성. 거부(R-A4).
      return null;
    }
    try {
      const secret = new TextEncoder().encode(this.authConfig.jwtSecret);
      const { payload } = await jwtVerify(token, secret, {
        algorithms: [HS256],
        issuer: this.authConfig.issuer,
        audience: this.authConfig.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      return payload;
    } catch {
      return null;
    }
  }
}
