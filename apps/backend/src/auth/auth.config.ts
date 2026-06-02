import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

// @MX:NOTE: [AUTO] 인증 검증의 정규(normative) 설정 도출점(OD-2/OD-6).
// SUPABASE_URL 단일 진실 공급원에서 JWKS URL과 expected issuer를 파생한다.
// 별도 env(SUPABASE_JWKS_URL)를 추가하지 않는다 — env 표면 최소화(OD-2 선택지 A).

// JWT 검증에 필요한, 부팅 시 1회 결정되는 불변 설정.
export interface AuthConfig {
  // JWKS 발견 엔드포인트(canonical: .well-known/jwks.json). ES256 비대칭 검증 경로.
  readonly jwksUrl: string;
  // expected `iss` — 정확 일치(exact match) 단언 대상(R-A7).
  readonly issuer: string;
  // expected `aud` — `authenticated` 고정(R-A7/OD-6).
  readonly audience: string;
  // 레거시 HS256 폴백 시크릿(R-A4). 미설정이면 HS256 경로 비활성(undefined).
  readonly jwtSecret: string | undefined;
}

// `authenticated`는 GoTrue user 토큰의 고정 audience(OD-6, M0 스파이크로 라이브 확인).
export const SUPABASE_AUDIENCE = 'authenticated';

// SUPABASE_URL의 끝 슬래시를 제거해 일관된 base를 만든다(예: ".../auth/v1//..." 방지).
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

// SUPABASE_URL에서 JWKS URL을 파생한다(R-I2/OD-2): `<base>/auth/v1/.well-known/jwks.json`.
export function deriveJwksUrl(supabaseUrl: string): string {
  return `${normalizeBaseUrl(supabaseUrl)}/auth/v1/.well-known/jwks.json`;
}

// SUPABASE_URL에서 expected issuer를 파생한다(R-A7/OD-6): `<base>/auth/v1`.
// 로컬 GoTrue의 jwt_issuer가 비어 있어 기본 issuer가 이 형태임을 M0 스파이크에서 라이브 확인했다.
export function deriveIssuer(supabaseUrl: string): string {
  return `${normalizeBaseUrl(supabaseUrl)}/auth/v1`;
}

// 검증된 ConfigService에서 AuthConfig를 조립한다.
// SUPABASE_URL/ANON_KEY는 required로 승격되었으므로(R-I1) get은 string을 반환한다.
export function buildAuthConfig(config: ConfigService<Env, true>): AuthConfig {
  const supabaseUrl = config.get<string>('SUPABASE_URL');
  const jwtSecret = config.get<string | undefined>('SUPABASE_JWT_SECRET');
  return {
    jwksUrl: deriveJwksUrl(supabaseUrl),
    issuer: deriveIssuer(supabaseUrl),
    audience: SUPABASE_AUDIENCE,
    jwtSecret,
  };
}
