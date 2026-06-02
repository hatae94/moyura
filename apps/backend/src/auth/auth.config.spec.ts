import { SUPABASE_AUDIENCE, deriveIssuer, deriveJwksUrl } from './auth.config';

// JWKS URL + expected issuer 파생 검증(OD-2/OD-6, AC-I2). M0 스파이크 라이브 관찰값과 일치해야 한다.
describe('auth.config 파생 (AC-I2 / AC-A7)', () => {
  const LOCAL_URL = 'http://127.0.0.1:54321';

  it('SUPABASE_URL에서 canonical JWKS URL을 파생한다 (R-I2/OD-2)', () => {
    expect(deriveJwksUrl(LOCAL_URL)).toBe(
      'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    );
  });

  it('SUPABASE_URL에서 expected issuer를 파생한다 (R-A7/OD-6)', () => {
    // M0 스파이크 라이브 관찰값: iss = http://127.0.0.1:54321/auth/v1
    expect(deriveIssuer(LOCAL_URL)).toBe('http://127.0.0.1:54321/auth/v1');
  });

  it('끝 슬래시를 정규화해 이중 슬래시를 만들지 않는다', () => {
    expect(deriveJwksUrl('http://127.0.0.1:54321/')).toBe(
      'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    );
    expect(deriveIssuer('http://127.0.0.1:54321/')).toBe(
      'http://127.0.0.1:54321/auth/v1',
    );
  });

  it('expected audience는 authenticated 상수다 (R-A7/OD-6)', () => {
    expect(SUPABASE_AUDIENCE).toBe('authenticated');
  });
});
