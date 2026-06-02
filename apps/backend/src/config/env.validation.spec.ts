import { isOriginAllowed, validateEnv } from './env.validation';

// 검증에 사용하는 최소 유효 env (필수 항목만).
const baseValidEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  PORT: '3000',
  NODE_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:8081',
};

// 특정 키를 제외한 env 사본을 만든다(unused destructure 바인딩 없이 누락 케이스 구성).
function omitKey(key: keyof typeof baseValidEnv): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...baseValidEnv };
  delete copy[key];
  return copy;
}

describe('validateEnv (AC-B1 / AC-B2)', () => {
  it('필수 env가 모두 유효하면 검증을 통과한다', () => {
    const env = validateEnv(baseValidEnv);
    expect(env.DATABASE_URL).toBe(baseValidEnv.DATABASE_URL);
    expect(env.DIRECT_URL).toBe(baseValidEnv.DIRECT_URL);
    expect(env.NODE_ENV).toBe('development');
  });

  it('PORT 문자열을 number로 강제 변환한다 (R-B6)', () => {
    const env = validateEnv(baseValidEnv);
    expect(typeof env.PORT).toBe('number');
    expect(env.PORT).toBe(3000);
  });

  it('CORS_ORIGINS 콤마 구분 문자열을 트림된 string[]로 파싱한다 (R-F2)', () => {
    const env = validateEnv({
      ...baseValidEnv,
      CORS_ORIGINS: 'http://a.com , http://b.com',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('SUPABASE_* seam placeholder는 optional이며 미설정이어도 통과한다 (R-H2)', () => {
    const env = validateEnv(baseValidEnv);
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.SUPABASE_ANON_KEY).toBeUndefined();
    expect(env.SUPABASE_JWT_SECRET).toBeUndefined();
  });

  it('DATABASE_URL 누락 시 설명 메시지와 함께 throw한다 (AC-B2 fail-fast)', () => {
    const withoutDbUrl = omitKey('DATABASE_URL');
    expect(() => validateEnv(withoutDbUrl)).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => validateEnv(withoutDbUrl)).toThrow(/DATABASE_URL/);
  });

  it('DIRECT_URL 누락 시 throw한다 (AC-B2)', () => {
    const withoutDirectUrl = omitKey('DIRECT_URL');
    expect(() => validateEnv(withoutDirectUrl)).toThrow(/DIRECT_URL/);
  });

  it('PORT가 숫자가 아니면 throw한다 (AC-B2 invalid)', () => {
    expect(() =>
      validateEnv({ ...baseValidEnv, PORT: 'not-a-number' }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('NODE_ENV가 enum 외 값이면 throw한다 (AC-B2 invalid)', () => {
    expect(() => validateEnv({ ...baseValidEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('CORS_ORIGINS가 빈 문자열이면 throw한다 (R-F2)', () => {
    expect(() => validateEnv({ ...baseValidEnv, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS/,
    );
  });
});

describe('isOriginAllowed (AC-F1 / AC-F3)', () => {
  const allowlist = ['http://localhost:3000', 'http://localhost:8081'];

  it('허용 목록에 있는 origin은 허용한다 (AC-F1)', () => {
    expect(isOriginAllowed('http://localhost:3000', allowlist)).toBe(true);
  });

  it('허용 목록에 없는 origin은 거부한다 (AC-F3)', () => {
    expect(isOriginAllowed('http://evil.example.com', allowlist)).toBe(false);
  });

  it('origin이 undefined인 요청(same-origin/서버-서버)은 허용한다', () => {
    expect(isOriginAllowed(undefined, allowlist)).toBe(true);
  });
});
