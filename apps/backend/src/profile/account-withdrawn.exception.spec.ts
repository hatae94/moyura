import { GoneException, HttpStatus } from '@nestjs/common';
import { AccountWithdrawnException } from './account-withdrawn.exception';

// AccountWithdrawnException 단위 테스트(SPEC-ACCOUNT-001 T-02 / REQ-ACCOUNT-003 · AC-3-1).
// upsertBySub 가 툼스톤을 발견하면 던지는 계정 소멸 도메인 신호가 410 Gone 으로 직렬화되는지
// 직접 검증한다 — profile.service.spec 의 통합 경로와 별개로 예외 자체의 HTTP 계약(410 + 메시지)을
// 고정해, 런 스코프와 무관하게 이 도메인 신호의 상태 코드가 회귀하지 않도록 보증한다.
describe('AccountWithdrawnException (T-02 / REQ-ACCOUNT-003)', () => {
  it('GoneException 을 상속해 410 Gone 으로 직렬화된다(계정 소멸 = 410)', () => {
    const exception = new AccountWithdrawnException();

    // NestJS 가 GoneException 을 410 응답으로 자동 직렬화하도록 상속 관계를 고정한다.
    expect(exception).toBeInstanceOf(GoneException);
    expect(exception.getStatus()).toBe(HttpStatus.GONE);
    expect(exception.getStatus()).toBe(410);
  });

  it('탈퇴 계정임을 알리는 메시지를 담는다(자격증명·PII 비노출)', () => {
    const exception = new AccountWithdrawnException();

    // 응답 본문 메시지는 계정 소멸 사실만 알리고 내부 상세(sub/토큰 등)를 노출하지 않는다.
    const response = exception.getResponse() as { message: string };
    expect(response.message).toBe('탈퇴한 계정입니다');
  });
});
