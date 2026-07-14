import { Injectable } from '@nestjs/common';
import type { Profile } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountWithdrawnException } from './account-withdrawn.exception';

// @MX:ANCHOR: [AUTO] profile UPSERT의 단일 진입점(R-B3/B4/B5). /me 및 향후 보호 라우트가
// "최초 인증 시 자동 생성" 계약을 이 메서드에 의존한다.
// @MX:REASON: UPSERT 키(sub)는 가드-검증된 값만 받아야 하며(mass-assignment 차단, R-B3/M-5),
// 멱등성 + 동시성 안전(id PK 유일성 기반 원자적 upsert, R-B4/B5)이 이 계약의 핵심 불변식이다.
// SPEC-ACCOUNT-001 T-02 확장: upsert 이전에 withdrawn 툼스톤을 선조회해 탈퇴 계정의 PII
// 부활을 차단한다(REQ-ACCOUNT-003) — 툼스톤 존재 시 AccountWithdrawnException(410)을 던지며
// profile을 재생성하지 않는다(부활 차단이 upsert 불변식보다 우선).
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // 검증된 sub로 profile을 UPSERT한다(없으면 생성, 있으면 그대로 반환).
  //
  // [보안] sub 파라미터는 호출자(컨트롤러)가 가드-부착 VerifiedUser.sub에서만 전달해야 한다.
  // body/query/header에서 온 값을 절대 받지 않는다(R-B3/M-5). 이 메서드는 sub 외 어떤 클라이언트
  // 필드도 받지 않으므로 mass-assignment가 구조적으로 불가능하다.
  //
  // [동시성] Prisma upsert는 id(= sub) PK 유일성에 의존하는 원자적 연산이다. 동일 신규 sub의
  // 동시 요청에도 중복 row가 생기지 않으며 애플리케이션 락을 쓰지 않는다(R-B4/B5).
  async upsertBySub(sub: string): Promise<Profile> {
    // @MX:NOTE: [AUTO] 성능 최적화(핫패스): GET /me 는 requireNamedSession 이 인증 웹 페이지마다 호출하므로
    // 매 페이지 로드가 이 경로를 탄다. profile 이 이미 존재하면 그것을 그대로 반환하고 툼스톤 조회 + upsert 쓰기를
    // 모두 건너뛴다(cross-region DB 왕복: 예전 read+write 2회 → 읽기 히트 시 read 1회). 존재하는 profile 은 탈퇴
    // 툼스톤일 수 없다 — 탈퇴 처리(SPEC-ACCOUNT-001)가 profile 을 삭제하기 때문이다(부활 차단 불변식 보존).
    const existing = await this.prisma.profile.findUnique({
      where: { id: sub },
    });
    if (existing) {
      return existing;
    }

    // profile 미존재(최초 인증 또는 탈퇴 후). 여기서만 툼스톤을 확인하고 생성한다.
    // SPEC-ACCOUNT-001 T-02: 툼스톤 선조회(부활 차단, REQ-ACCOUNT-003). 탈퇴 처리된 sub는
    // profile을 재생성하지 않고 계정 소멸 신호(410)를 던진다 — 잔존 토큰의 GET /me가 유예 창
    // 내에서 PII를 부활시키는 것을 구조적으로 막는다. sub는 가드-검증된 값만 전달된다.
    const tombstone = await this.prisma.withdrawnAccount.findUnique({
      where: { sub },
    });
    if (tombstone) {
      throw new AccountWithdrawnException();
    }

    // upsert 유지(create 대신) — findUnique 와 create 사이의 동시성 경합에도 id PK 유일성 기반 멱등이다
    // (동일 신규 sub 동시 요청 시 중복 row 생성 방지, R-B4/B5). create/update 모두 id만 다룬다(mass-assignment 차단).
    return this.prisma.profile.upsert({
      where: { id: sub },
      create: { id: sub },
      update: {},
    });
  }

  // @MX:NOTE: [AUTO] SPEC-MOBILE-004 REQ-MOB4-003/004: 사용자 이름 영속의 단일 진입점(provider 비종속).
  // 이메일 회원가입(signUpAction)·이름 온보딩(향후 소셜)이 모두 이 경로로 Profile.name을 채운다.
  //
  // [보안] sub는 호출자(컨트롤러)가 가드-검증 VerifiedUser.sub에서만 전달한다 — body/query/header의
  // id/sub는 절대 키로 쓰지 않는다(mass-assignment 차단, R-B3/M-5). data도 name만 다루므로 다른
  // 클라이언트 필드가 끼어들 수 없다. profile은 GET /me 최초 호출 시 UPSERT로 항상 존재가 보장된다.
  async updateName(sub: string, name: string): Promise<Profile> {
    return this.prisma.profile.update({
      where: { id: sub },
      data: { name },
    });
  }
}
