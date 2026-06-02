import {
  type JWK,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { JWKSTimeout } from 'jose/errors';
import type { createRemoteJWKSet } from 'jose';

// jose 6.x는 KeyLike export를 제거하고 WebCrypto CryptoKey를 사용한다.
type SigningKey = CryptoKey;

// 결정적 보안 테스트를 위한 토큰 위조 유틸. 라이브 스택 의존 없이 거부 경로를 검증한다.
// 로컬에서 ES256 키쌍을 생성하고, 그 공개 JWK를 mock JWKS로 노출해 합법/위조 토큰을 모두 만든다.

export const TEST_ISSUER = 'http://127.0.0.1:54321/auth/v1';
export const TEST_AUDIENCE = 'authenticated';
export const TEST_KID = 'test-es256-kid';
export const TEST_SUB = '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8';
export const TEST_HS256_SECRET =
  'super-secret-jwt-token-with-at-least-32-characters-long';

export interface TestKeys {
  privateKey: SigningKey;
  publicKey: SigningKey;
  publicJwk: JWK;
}

// ES256 키쌍 생성 + 공개 JWK(kid 부여) 추출.
export async function generateEs256Keys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: TEST_KID,
    alg: 'ES256',
  };
  return { privateKey, publicKey, publicJwk };
}

// 테스트용 정적 JWKS resolver(local key set). createRemoteJWKSet과 시그니처 호환.
export function makeLocalJwks(
  publicJwk: JWK,
): ReturnType<typeof createRemoteJWKSet> {
  return createLocalJWKSet({
    keys: [publicJwk],
  }) as unknown as ReturnType<typeof createRemoteJWKSet>;
}

// JWKS fetch 실패를 시뮬레이션하는 resolver — 항상 JWKSTimeout으로 reject한다(R-A3/M-3 fail-closed 테스트용).
export function makeFailingJwks(): ReturnType<typeof createRemoteJWKSet> {
  const failing = (): Promise<never> => Promise.reject(new JWKSTimeout());
  return failing as unknown as ReturnType<typeof createRemoteJWKSet>;
}

interface ClaimOverrides {
  iss?: string;
  aud?: string;
  sub?: string;
  expSecondsFromNow?: number;
  nbfSecondsFromNow?: number;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

// 합법 ES256 토큰 서명(기본: 유효 iss/aud/sub, exp=+1h).
export async function signEs256(
  privateKey: SigningKey,
  overrides: ClaimOverrides = {},
): Promise<string> {
  const iat = nowSec();
  const builder = new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: TEST_KID, typ: 'JWT' })
    .setIssuer(overrides.iss ?? TEST_ISSUER)
    .setAudience(overrides.aud ?? TEST_AUDIENCE)
    .setSubject(overrides.sub ?? TEST_SUB)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (overrides.expSecondsFromNow ?? 3600));
  if (overrides.nbfSecondsFromNow !== undefined) {
    builder.setNotBefore(iat + overrides.nbfSecondsFromNow);
  }
  return builder.sign(privateKey);
}

// alg-confusion 위조 토큰(R-A8/B-1): ES256 공개키 JWK를 HMAC 시크릿으로 사용해 HS256으로 서명.
// 공격자가 JWKS 공개키를 알고 있다고 가정. 가드는 이를 ES256 경로로만 라우팅하므로 검증 불가해야 한다.
export async function signAlgConfusion(publicJwk: JWK): Promise<string> {
  // 공개키 JWK를 raw 바이트로 직렬화해 HMAC 키처럼 사용(전형적 alg-confusion 공격 형태).
  const fakeSecret = new TextEncoder().encode(JSON.stringify(publicJwk));
  const iat = nowSec();
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', kid: TEST_KID, typ: 'JWT' })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setSubject(TEST_SUB)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(fakeSecret);
}

// alg:none 토큰(R-A8): 서명 없는 unsecured JWT를 수동 조립(jose는 SignJWT로 none을 거부하므로 직접 base64).
export function makeAlgNoneToken(): string {
  const header = { alg: 'none', typ: 'JWT' };
  const iat = nowSec();
  const payload = {
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    sub: TEST_SUB,
    iat,
    exp: iat + 3600,
  };
  const b64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  // 서명 부분은 빈 문자열(unsecured JWT 형태).
  return `${b64(header)}.${b64(payload)}.`;
}

// 실제 HS256 서명 토큰(R-A4 폴백 경로 테스트용). SUPABASE_JWT_SECRET로 서명.
export async function signHs256(
  secret: string,
  overrides: ClaimOverrides = {},
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const iat = nowSec();
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(overrides.iss ?? TEST_ISSUER)
    .setAudience(overrides.aud ?? TEST_AUDIENCE)
    .setSubject(overrides.sub ?? TEST_SUB)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (overrides.expSecondsFromNow ?? 3600))
    .sign(key);
}
