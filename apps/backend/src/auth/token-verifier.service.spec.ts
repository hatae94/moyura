import type { ConfigService } from '@nestjs/config';
import type { AuthConfig } from './auth.config';
import {
  TEST_AUDIENCE,
  TEST_HS256_SECRET,
  TEST_ISSUER,
  TEST_SUB,
  type TestKeys,
  generateEs256Keys,
  makeAlgNoneToken,
  makeFailingJwks,
  makeLocalJwks,
  signAlgConfusion,
  signEs256,
  signHs256,
} from './test-tokens.helper';
import { TokenVerifierService } from './token-verifier.service';

// TokenVerifierService 보안 단위 테스트(AC-A2~A8). 로컬 ES256 키쌍 + mock JWKS로 결정적으로 검증한다.
describe('TokenVerifierService (보안 검증 경계)', () => {
  let keys: TestKeys;

  const baseConfig: AuthConfig = {
    jwksUrl: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    jwtSecret: TEST_HS256_SECRET,
  };

  // ConfigService는 onModuleInit에서만 쓰이고, 테스트는 configureForTest로 우회하므로 stub로 충분하다.
  const stubConfig = {} as ConfigService<never, true>;

  beforeAll(async () => {
    keys = await generateEs256Keys();
  });

  // 주어진 AuthConfig + JWKS resolver로 검증기를 구성한다.
  function makeVerifier(
    config: AuthConfig,
    jwks: ReturnType<typeof makeLocalJwks>,
  ): TokenVerifierService {
    const verifier = new TokenVerifierService(stubConfig);
    verifier.configureForTest(config, jwks);
    return verifier;
  }

  describe('ES256/JWKS 정상 경로 (AC-A2/A6)', () => {
    it('유효한 ES256 토큰을 통과시키고 sub/role을 추출한다', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signEs256(keys.privateKey);

      const user = await verifier.verify(token);

      expect(user).not.toBeNull();
      expect(user?.sub).toBe(TEST_SUB);
      expect(user?.role).toBe('authenticated');
    });
  });

  describe('iss/aud/exp normative 검증 (AC-A7)', () => {
    it('잘못된 iss(타 프로젝트)는 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signEs256(keys.privateKey, {
        iss: 'https://evil.supabase.co/auth/v1',
      });
      expect(await verifier.verify(token)).toBeNull();
    });

    it('잘못된 aud(≠ authenticated)는 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signEs256(keys.privateKey, { aud: 'anon' });
      expect(await verifier.verify(token)).toBeNull();
    });

    it('만료된 exp(과거)는 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      // clock skew(60s)보다 더 과거로 만료시켜 확실히 거부되게 한다.
      const token = await signEs256(keys.privateKey, {
        expSecondsFromNow: -120,
      });
      expect(await verifier.verify(token)).toBeNull();
    });

    it('nbf가 미래(skew 초과)면 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signEs256(keys.privateKey, {
        nbfSecondsFromNow: 120,
      });
      expect(await verifier.verify(token)).toBeNull();
    });
  });

  describe('alg-confusion / alg:none 거부 (AC-A8/B-1)', () => {
    it('JWKS 공개키를 HMAC 시크릿으로 쓴 HS256 위조(alg-confusion)는 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      // ES256 토큰을 가장하지만 실제 alg는 HS256 — HS256 경로로 라우팅되나 레거시 시크릿과 불일치해 거부.
      const forged = await signAlgConfusion(keys.publicJwk);
      expect(await verifier.verify(forged)).toBeNull();
    });

    it('alg:none 토큰은 서명 검증 이전에 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = makeAlgNoneToken();
      expect(await verifier.verify(token)).toBeNull();
    });

    it('허용 집합 밖 alg(RS256)는 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      // 헤더 alg를 RS256으로 위조(payload 무관 — 화이트리스트에서 먼저 차단).
      const b64 = (o: unknown): string =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const token = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: TEST_SUB })}.sig`;
      expect(await verifier.verify(token)).toBeNull();
    });
  });

  describe('JWKS fail-closed — HS256 다운그레이드 금지 (AC-A3/M-3)', () => {
    it('JWKS fetch 실패 시 ES256 토큰은 401로 거부되고 HS256으로 다운그레이드되지 않는다', async () => {
      // JWKS resolver가 항상 실패(timeout)하도록 구성. HS256 시크릿은 설정되어 있다(다운그레이드 유혹).
      const verifier = makeVerifier(baseConfig, makeFailingJwks());
      const es256Token = await signEs256(keys.privateKey);

      // ES256 토큰은 JWKS 경로 전용 → fetch 실패 시 fail-closed(null), HS256 경로로 흘러가지 않음.
      expect(await verifier.verify(es256Token)).toBeNull();
    });
  });

  describe('레거시 HS256 폴백 (AC-A4)', () => {
    it('실제 HS256 서명 토큰 + 시크릿 설정 시 통과한다', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signHs256(TEST_HS256_SECRET);
      const user = await verifier.verify(token);
      expect(user?.sub).toBe(TEST_SUB);
    });

    it('SUPABASE_JWT_SECRET 미설정 시 HS256 토큰을 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(
        { ...baseConfig, jwtSecret: undefined },
        makeLocalJwks(keys.publicJwk),
      );
      const token = await signHs256(TEST_HS256_SECRET);
      expect(await verifier.verify(token)).toBeNull();
    });

    it('HS256 토큰도 iss/aud를 검증한다 (잘못된 aud → 401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      const token = await signHs256(TEST_HS256_SECRET, { aud: 'anon' });
      expect(await verifier.verify(token)).toBeNull();
    });
  });

  describe('malformed / 누락 토큰 (AC-A5)', () => {
    it('변형된 토큰(헤더 디코드 불가)은 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      expect(await verifier.verify('not-a-jwt')).toBeNull();
      expect(await verifier.verify('a.b.c')).toBeNull();
    });

    it('sub 클레임이 없으면 거부한다 → null(401)', async () => {
      const verifier = makeVerifier(baseConfig, makeLocalJwks(keys.publicJwk));
      // sub를 빈 문자열로 위조.
      const token = await signEs256(keys.privateKey, { sub: '' });
      expect(await verifier.verify(token)).toBeNull();
    });
  });
});
