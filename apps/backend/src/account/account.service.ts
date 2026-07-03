import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseAdminClient } from './supabase-admin.client';

// 탈퇴 시 moim_member 표시명 익명화 값(UGC 원장 무결성 보존 — 행은 삭제하지 않고 표시명만 익명화).
const WITHDRAWN_NICKNAME = '탈퇴한 사용자';

// @MX:ANCHOR: [AUTO] 회원 탈퇴 오케스트레이션의 단일 진입점(SPEC-ACCOUNT-001 REQ-ACCOUNT-001).
// 컨트롤러(T-07 DELETE /me/account)와 향후 관리자 삭제 경로가 이 메서드에 의존한다.
// @MX:REASON: 불변식 — (1) 앱 데이터 정리(단일 멱등 $transaction)가 auth 계정 삭제보다 **반드시 선행**하고
// (2) 삭제 대상은 가드-검증된 sub 하나뿐(임의 uuid 주입 불가 — T-07 컨트롤러가 user.sub 만 전달),
// (3) 정리는 전부 deleteMany/updateMany/upsert 라 재실행이 멱등(P2025 없음)해 auth 삭제 실패 시 재호출로 복구된다.
// 이 순서/멱등 계약이 깨지면 부분 삭제(앱 데이터만 지워지고 auth 잔존)나 PII 부활이 발생한다.
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdminClient,
    private readonly moim: MoimService,
  ) {}

  // 인증 사용자 sub 의 계정을 삭제한다(REQ-ACCOUNT-001).
  //
  // 순서: (2) 앱 데이터 정리(멱등 트랜잭션) → (3) auth 계정 삭제. auth.users 는 Supabase 관리 영역이라
  // Prisma 트랜잭션에 포함할 수 없어(research §142) 트랜잭션 밖에서 마지막에 호출한다. 앱 데이터 정리가
  // 먼저 완료되면 툼스톤이 이미 계정을 무력화하므로, auth 삭제 실패 시 재호출(멱등)로 복구된다(R-1).
  //
  // [fail-closed] service-role 키가 없으면 auth 를 삭제할 수 없다 → 앱 데이터 트랜잭션에 착수하기 전에
  // 500 으로 중단해 부분 삭제(앱 데이터만 지워지고 auth 잔존)를 구조적으로 막는다(EC-5).
  //
  // NOTE: safety 고아 행 정리(block/report — T-05)는 이 트랜잭션에 편입돼 있다(prisma 직접 접근, 비순환).
  // 소유 모임 처리(사전 검증 — step 1, T-06)는 익명화 트랜잭션 앞단에서 수행된다.
  async deleteAccount(sub: string): Promise<void> {
    // (1) 자격증명 사전 판정 — 키 부재 시 앱 데이터 정리조차 시작하지 않는다(부분 삭제 방지).
    if (!this.admin.isConfigured()) {
      throw new InternalServerErrorException(
        'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않아 계정 삭제를 수행할 수 없습니다.',
      );
    }

    // (step 1) 소유자 고아화 방지 — 익명화 트랜잭션보다 **반드시 선행**한다(REQ-ACCOUNT-002).
    // @MX:NOTE: [AUTO] 소유권 이양·존재 판정은 **모두 활성 멤버(withdrawnAt: null)만** 대상으로 한다 — 탈퇴 마킹된
    // 유령 멤버로 이양하면 접근 불가 owner 를 남겨 REQ-ACCOUNT-002b(유령 이양 금지, R-4b)를 위반한다. 그래서
    // 이양 대상 선정 쿼리에 withdrawnAt:null 을 필수로 걸고, 활성 대상이 0 이면 이양 대신 deleteMoim(Cascade)한다.
    // 이 처리가 익명화(step 2, role='member' 강등)보다 먼저 실행돼야 하는 이유: transferOwner/deleteMoim 내부
    // assertOwner 가 sub 의 owner role 을 요구하므로, 강등 후에 호출하면 403 이 된다(순서 역전 금지).
    await this.handleOwnedMoims(sub);

    // (2) 앱 데이터 정리 — 단일 트랜잭션. 전부 deleteMany/updateMany/upsert 라 재실행이 멱등하다(P2025 없음).
    await this.prisma.$transaction(async (tx) => {
      // moim_member: 행은 보존하고 표시명만 익명화 + 탈퇴 마킹 + role 강등('member').
      // withdrawnAt=now 로 유령 표식 → 정원 count(withdrawnAt:null)·이양 대상 선정에서 배제된다(R-4b/R-6).
      await tx.moimMember.updateMany({
        where: { userId: sub },
        data: {
          nickname: WITHDRAWN_NICKNAME,
          withdrawnAt: new Date(),
          role: 'member',
        },
      });
      // device_token: userId 벌크 삭제(클라 unregister 는 best-effort — 서버측 최종 보장, R-5).
      await tx.deviceToken.deleteMany({ where: { userId: sub } });
      // notification: 수신자(recipientId)=sub 인 알림 삭제.
      await tx.notification.deleteMany({ where: { recipientId: sub } });
      // moim_invite: 본인이 발행한 초대(createdBy) 삭제.
      await tx.moimInvite.deleteMany({ where: { createdBy: sub } });
      // withdrawn 툼스톤 기록 — 잔존 JWT 의 GET /me(upsertBySub) 부활을 차단한다(REQ-ACCOUNT-003).
      // upsert 라 재실행 멱등(이미 있으면 update:{} = no-op).
      await tx.withdrawnAccount.upsert({
        where: { sub },
        create: { sub },
        update: {},
      });
      // profile: id=sub 행 삭제(PII). deleteMany 라 재실행 시 count 0(P2025 없음 — 멱등).
      await tx.profile.deleteMany({ where: { id: sub } });
      // @MX:NOTE: [AUTO] safety 고아 행 정리는 prisma.block/report 를 직접 접근한다(SafetyModule/BlockService import 금지).
      // account → safety 로의 모듈 의존을 만들지 않아 순환(R-15)을 정적으로 차단한다 — block/report 컬럼은 FK 없는
      // soft-ref 라(schema.prisma:406/430) profile 삭제로 자동 정리되지 않으므로 여기서 명시적으로 지운다.
      // 매칭은 sub 가 관여한 양측(차단자/피차단자, 신고자/피신고자) — OR 조건. deleteMany 라 재실행 멱등(count 0).
      await tx.block.deleteMany({
        where: { OR: [{ blockerId: sub }, { blockedUserId: sub }] },
      });
      await tx.report.deleteMany({
        where: { OR: [{ reporterId: sub }, { targetUserId: sub }] },
      });
    });

    // (3) auth 계정 삭제 — 트랜잭션 밖. 실패해도 (2)의 툼스톤이 계정을 이미 무력화 → 재호출로 복구.
    await this.admin.deleteUser(sub);
  }

  // 탈퇴자가 owner 인 각 모임에 대해 소유권 이양 또는 모임 삭제를 강제한다(REQ-ACCOUNT-002·002b).
  //
  // 재실행 멱등: 재호출 시점엔 이미 익명화(role='member' 강등)돼 owner 조회가 [] 를 반환하므로 step 1 은 no-op 다.
  private async handleOwnedMoims(sub: string): Promise<void> {
    // 탈퇴자가 owner 인 모임 목록.
    const owned = await this.prisma.moimMember.findMany({
      where: { userId: sub, role: 'owner' },
    });

    for (const { moimId } of owned) {
      // 활성(withdrawnAt:null) 비-owner 중 가장 오래된 1명을 이양 대상으로 선정한다(유령 배제, R-4b).
      const target = await this.prisma.moimMember.findMany({
        where: { moimId, role: { not: 'owner' }, withdrawnAt: null },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      });

      if (target.length >= 1) {
        // 활성 대상 존재 → 소유권 이양(명시 target 전달, transferOwner 는 [EXISTING] 재사용).
        await this.moim.transferOwner(sub, moimId, target[0].userId);
      } else {
        // 활성 비-owner 0(잔여 없음 또는 전원 유령) → 모임 삭제(Cascade). 유령 이양은 하지 않는다.
        await this.moim.deleteMoim(sub, moimId);
      }
    }
  }
}
