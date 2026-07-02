import { GoneException } from '@nestjs/common';

// @MX:NOTE: [AUTO] SPEC-ACCOUNT-001 REQ-ACCOUNT-003: 계정 소멸 도메인 신호.
// GoneException(410)을 확장하므로 NestJS가 자동으로 410 Gone 응답으로 직렬화한다 —
// me.controller는 별도 try/catch 변환 없이 이 예외를 그대로 전파한다(계정 소멸 = 410).
// 잔존 토큰의 upsertBySub가 툼스톤을 발견하면 profile을 재생성하지 않고 이 신호를 던진다(부활 차단).
export class AccountWithdrawnException extends GoneException {
  constructor() {
    super('탈퇴한 계정입니다');
  }
}
