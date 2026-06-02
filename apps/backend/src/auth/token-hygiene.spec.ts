import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 토큰 위생 정적 검증(AC-A9/M-2). 인증 소스가 토큰을 URL/query에서 읽거나 로깅하지 않음을 grep으로 확인한다.
describe('토큰 위생 (AC-A9 / M-2)', () => {
  const authDir = __dirname;

  function read(file: string): string {
    return readFileSync(join(authDir, file), 'utf-8');
  }

  it('가드는 토큰을 query/URL이 아닌 Authorization 헤더에서만 읽는다', () => {
    const guard = read('supabase-auth.guard.ts');
    // query/params에서 토큰을 읽는 패턴이 없어야 한다.
    expect(guard).not.toMatch(/request\.query/);
    expect(guard).not.toMatch(/request\.params/);
    expect(guard).not.toMatch(/req\.query/);
    // 토큰 출처는 authorization 헤더여야 한다.
    expect(guard).toMatch(/headers\.authorization/);
  });

  it('가드/검증기는 Authorization 헤더나 토큰 payload를 로깅하지 않는다', () => {
    const sources = [
      read('supabase-auth.guard.ts'),
      read('token-verifier.service.ts'),
    ].join('\n');

    // logger 호출에 authorization 헤더/토큰 변수를 보간하지 않아야 한다.
    expect(sources).not.toMatch(/log[a-zA-Z]*\([^)]*authorization/i);
    expect(sources).not.toMatch(/log[a-zA-Z]*\([^)]*\btoken\b/);
    // console.log로 토큰을 흘리지 않아야 한다.
    expect(sources).not.toMatch(/console\.log/);
  });

  it('검증 실패 시 토큰 내용을 예외 메시지에 echo하지 않는다 (기본 401)', () => {
    const guard = read('supabase-auth.guard.ts');
    // UnauthorizedException은 토큰을 인자로 받지 않는 기본 형태여야 한다.
    expect(guard).toMatch(/new UnauthorizedException\(\)/);
    // 토큰을 예외 메시지에 끼워 넣는 패턴 부재.
    expect(guard).not.toMatch(/UnauthorizedException\([^)]*token/);
  });
});
