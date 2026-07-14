import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Moim, MoimMember } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOIM_MEMBER_KICKED,
  MOIM_OWNER_TRANSFERRED,
  type MoimMemberKickedPayload,
  type MoimOwnerTransferredPayload,
} from './moim-events';

// owner 멤버십 role 상수(REQ-MOIM-004). owner는 탈퇴 불가(REQ-MOIM-008)·삭제 전용(REQ-MOIM-003).
const ROLE_OWNER = 'owner';

@Injectable()
export class MoimService {
  constructor(
    private readonly prisma: PrismaService,
    // SPEC-NOTIFICATIONS-001 M2: 도메인 이벤트 발행기(전역 EventEmitterModule.forRoot()). transferOwner/kickMember
    // 성공(트랜잭션/삭제 완료) 후에만 moim.owner.transferred/moim.member.kicked 를 발행한다 — NotificationListener
    // 가 구독(느슨한 결합, moim→알림 인식 0).
    private readonly events: EventEmitter2,
  ) {}

  // @MX:ANCHOR: [AUTO] 모임 + 생성자 owner 멤버십을 하나의 트랜잭션으로 원자 생성하는 진입점(REQ-MOIM-004).
  // @MX:REASON: moim과 owner moim_member는 항상 함께 존재해야 한다는 불변식의 단일 출처. owner row가
  // moim.id에 의존하므로 인터랙티브 $transaction(tx) 콜백을 쓴다(배열 형태 불가). createdBy/userId는
  // 가드-검증된 sub만 받는다(mass-assignment 차단 — profile 패턴 동일).
  // SPEC-MOIM-004 REQ-MOIM4-002: optional startsAt(Date)/location 을 additive 로 받아 영속한다.
  // SPEC-MOIM-012 REQ-MOIM12-001: optional maxMembers(기본 15). 컨트롤러가 validate 후 전달한다.
  async createMoim(
    sub: string,
    name: string,
    nickname: string,
    startsAt?: Date,
    location?: string,
    maxMembers?: number,
  ): Promise<Moim> {
    return this.prisma.$transaction(async (tx) => {
      // 1) 모임 생성 — id는 DB가 발급(@default(uuid)). startsAt/location 은 additive(미전달 시 null).
      //    maxMembers 미전달 시 Prisma @default(15)가 적용된다.
      const moim = await tx.moim.create({
        data: { name, createdBy: sub, startsAt, location, maxMembers },
      });
      // 2) 생성자 owner 멤버십 — moim.id에 의존하므로 같은 트랜잭션 내 순차 생성.
      await tx.moimMember.create({
        data: {
          moimId: moim.id,
          userId: sub,
          nickname,
          role: ROLE_OWNER,
        },
      });
      return moim;
    });
  }

  // @MX:NOTE: [AUTO] SPEC-MOIM-012 REQ-MOIM12-001: owner 전용 모임 정원 수정(레거시 단일 인자 버전 — 하위 호환 유지).
  // assertOwner가 "모임 없음 → 404, 비-owner → 403"을 판정한다. maxMembers 검증은 컨트롤러가 담당.
  // 현재 멤버 수 미만으로 낮춰도 소급 퇴장 없음 — 신규 가입(InviteService.accept)만 차단된다.
  async updateMaxMembers(
    sub: string,
    moimId: string,
    maxMembers: number,
  ): Promise<Moim> {
    return this.updateMoimSettings(sub, moimId, maxMembers, undefined);
  }

  // @MX:NOTE: [AUTO] SPEC-MOIM-EXPENSE-001 REQ-EXP-010: maxMembers/budget 부분 갱신 메서드(owner 전용).
  // 두 필드 모두 optional — 전달된 필드만 update data 에 포함한다(undefined 제외). budget=null 은 예산 해제.
  // assertOwner 단일 출처 유지(전용 setBudget 메서드 미신설 — SPEC §5 예산 노트 확정).
  async updateMoimSettings(
    sub: string,
    moimId: string,
    maxMembers: number | undefined,
    budget: number | null | undefined,
  ): Promise<Moim> {
    await this.assertOwner(sub, moimId);
    const data: { maxMembers?: number; budget?: number | null } = {};
    if (maxMembers !== undefined) data.maxMembers = maxMembers;
    if (budget !== undefined) data.budget = budget;
    return this.prisma.moim.update({
      where: { id: moimId },
      data,
    });
  }

  // @MX:ANCHOR: [AUTO] 멤버십 인가의 단일 출처(REQ-MOIM-002). 멤버 한정 조회(getMoim/listMembers)와
  // 하위 SPEC(CHAT-001/CHAT-002/MOIM-002)이 이 계약을 재사용한다(fan_in ≥ 3 예상).
  // @MX:REASON: "모임 없음 → 404, 비멤버 → 403" 판정의 유일한 진입점. 각 도메인이 멤버십 검사를 따로
  // 구현하면 드리프트가 생기므로 여기서만 검사한다. 미인증(401)은 라우트 가드가 선처리한다.
  async assertMember(sub: string, moimId: string): Promise<void> {
    // 판정 자체는 assertMemberReturningMoim 이 단일 출처다 — void 계약만 유지하기 위해 반환 moim 을 버린다.
    await this.assertMemberReturningMoim(sub, moimId);
  }

  // @MX:NOTE: [AUTO] 멤버십 인가 + moim 반환의 내부 헬퍼(assertMember/getMoim 공유). "모임 조회 → 멤버십 판정"을
  // 정확히 1회씩만 수행한다(SPEC-MOIM-DETAIL 성능 최적화). getMoim 이 예전엔 assertMember(requireMoim=moim read)
  // 후 requireMoim 을 또 호출해 moim 을 두 번 읽었다(cross-region DB 왕복 2배). requireMoim 이 이미 moim 을
  // 반환하므로 그 결과를 그대로 흘려보내면 판정과 반환이 한 번의 read 로 합쳐진다. "없는 모임 404 → 비멤버 403"
  // 판정 순서/의미는 불변(공개 계약은 assertMember/getMoim ANCHOR 가 유지).
  private async assertMemberReturningMoim(
    sub: string,
    moimId: string,
  ): Promise<Moim> {
    // 존재하지 않는 모임은 멤버십 판정 이전에 404로 거른다(엣지 케이스). requireMoim 이 moim 을 반환한다.
    const moim = await this.requireMoim(moimId);
    const membership = await this.findMembership(sub, moimId);
    if (!membership) {
      // 인증되었으나 멤버가 아님 → 403(401 아님 — 가드가 인증을 이미 통과시켰다).
      throw new ForbiddenException();
    }
    return moim;
  }

  // @MX:ANCHOR: [AUTO] owner 인가의 단일 출처(REQ-MOIM-003). 모임 삭제 및 향후 owner 전용 작업(MOIM-002
  // 초대 발급/폐기)이 이 계약을 재사용한다.
  // @MX:REASON: "모임 없음 → 404, owner 아님 → 403" 판정의 유일한 진입점. 비멤버·비owner 모두 403으로
  // 동일 처리해 모임 존재 여부 외 멤버 구성을 노출하지 않는다. 미인증(401)은 라우트 가드가 선처리한다.
  async assertOwner(sub: string, moimId: string): Promise<void> {
    await this.requireMoim(moimId);
    const membership = await this.findMembership(sub, moimId);
    if (!membership || membership.role !== ROLE_OWNER) {
      // 비멤버이거나 멤버이지만 owner가 아님 → 403.
      throw new ForbiddenException();
    }
  }

  // 단건 모임 조회(REQ-MOIM-005 / AC-6). 멤버 한정 — 비멤버 403, 없는 모임 404는 assertMember가 판정한다.
  // 인가 판정 시 조회한 moim 을 그대로 반환한다(중복 moim read 제거 — 판정+반환 1회 read).
  async getMoim(sub: string, moimId: string): Promise<Moim> {
    return this.assertMemberReturningMoim(sub, moimId);
  }

  // 자신이 속한 모임 목록(REQ-MOIM-005 / AC-6). 멤버십에서 moimId를 모아 해당 모임만 반환한다.
  async listMyMoims(sub: string): Promise<Moim[]> {
    const memberships = await this.prisma.moimMember.findMany({
      where: { userId: sub },
    });
    if (memberships.length === 0) {
      return [];
    }
    const moimIds = memberships.map((m) => m.moimId);
    return this.prisma.moim.findMany({ where: { id: { in: moimIds } } });
  }

  // 멤버 목록 조회(REQ-MOIM-006 / AC-5). 멤버 한정 — 각 멤버의 nickname 포함. 비멤버 403/없는 모임 404.
  async listMembers(sub: string, moimId: string): Promise<MoimMember[]> {
    await this.assertMember(sub, moimId);
    return this.listMembersUnchecked(moimId);
  }

  // @MX:NOTE: [AUTO] SPEC-MOIM-DETAIL 성능 최적화: 인가를 건너뛴 멤버 목록 조회(getDetail 전용).
  // getDetail 이 상단에서 assertMember 를 이미 1회 통과한 뒤 members/polls/schedule 을 Promise.all 로 병렬 조회할 때
  // 각 후속 조회가 assertMember 를 반복하면 cross-region DB 왕복이 배가된다. 이 unchecked 변형은 게이트를 생략해
  // 중복 판정을 없앤다 — 반드시 assertMember 통과 이후에만 호출해야 한다(공개 listMembers 는 게이트 유지). 형태 불변.
  listMembersUnchecked(moimId: string): Promise<MoimMember[]> {
    return this.prisma.moimMember.findMany({ where: { moimId } });
  }

  // @MX:NOTE: [AUTO] 멤버 탈퇴(REQ-MOIM-007/008). owner 탈퇴를 차단(403)하는 것은 고아 모임 방지 의도다 —
  // owner가 빠지면 모임이 주인 없이 남으므로, owner의 퇴장 경로는 모임 삭제(Cascade)뿐이다(소유권 이양 비범위).
  // 멤버십 부재(가입한 적 없음)는 403이 아니라 404다 — 삭제할 대상이 없으므로(엣지 케이스, 부작용 없음).
  async leave(sub: string, moimId: string): Promise<void> {
    const membership = await this.findMembership(sub, moimId);
    if (!membership) {
      // 가입한 적 없는 사용자의 탈퇴 → 404(멤버십 부재). 모임 존재 여부와 무관.
      throw new NotFoundException();
    }
    if (membership.role === ROLE_OWNER) {
      // owner 탈퇴 금지(REQ-MOIM-008) — 멤버십을 삭제하지 않고 403.
      throw new ForbiddenException();
    }
    await this.prisma.moimMember.delete({
      where: { moimId_userId: { moimId, userId: sub } },
    });
  }

  // @MX:ANCHOR: [AUTO] Moim.startsAt 쓰기의 단일 출처(SPEC-MOIM-008 REQ-MOIM8-003).
  // @MX:REASON: createMoim 외의 유일한 startsAt 쓰기 경로 — finalize 가 직접 prisma.moim.update 하지 않고
  // 이 메서드를 호출한다(assertMember 단일 출처 패턴 미러). 인가는 closePoll 이 이미 통과시킨 상태이므로
  // 여기서는 순수하게 startsAt 만 갱신한다. moim 존재는 poll.moimId 가 보장(close 가 poll-moim 일관성 검증).
  async setStartsAt(moimId: string, startsAt: Date): Promise<void> {
    await this.prisma.moim.update({
      where: { id: moimId },
      data: { startsAt },
    });
  }

  // @MX:NOTE: [AUTO] SPEC-MOIM-010 — createMoim 외의 유일한 location 쓰기 경로(setStartsAt 미러).
  // 장소 투표 finalize 가 직접 prisma.moim.update 하지 않고 이 메서드를 호출한다(쓰기 단일 출처).
  // 인가는 closePoll 이 이미 통과시킨 상태이므로 여기서는 순수하게 location 만 갱신한다.
  async setLocation(moimId: string, location: string): Promise<void> {
    await this.prisma.moim.update({
      where: { id: moimId },
      data: { location },
    });
  }

  // 멤버 강제 퇴장(owner 전용). 대상 멤버십 삭제만 수행 — 투표/채팅 데이터 불변.
  // 비-owner 403, 대상 없음 404, 대상이 owner이면 403(스스로 포함).
  async kickMember(
    sub: string,
    moimId: string,
    targetUserId: string,
  ): Promise<void> {
    // 호출자 owner 인가 — 모임 없음(404), 비-owner(403)을 assertOwner가 일괄 판정한다.
    await this.assertOwner(sub, moimId);
    const target = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId: targetUserId } },
    });
    if (!target) {
      // 대상이 이 모임의 멤버가 아님 → 404.
      throw new NotFoundException();
    }
    if (target.role === ROLE_OWNER) {
      // owner는 강제 퇴장 불가 — 소유권 이양 또는 모임 삭제를 써야 한다.
      throw new ForbiddenException();
    }
    await this.prisma.moimMember.delete({
      where: { moimId_userId: { moimId, userId: targetUserId } },
    });

    // SPEC-NOTIFICATIONS-001 M2: 삭제 성공 이후에만 발행한다(no-op/authz-fail 경로는 위에서 이미 throw).
    // best-effort 격리 — 리스너 예외가 이미 성립한 퇴장을 무효화하지 않는다(actorId=owner, targetId=퇴장 당사자).
    const kickedPayload: MoimMemberKickedPayload = {
      moimId,
      actorId: sub,
      targetId: targetUserId,
    };
    try {
      this.events.emit(MOIM_MEMBER_KICKED, kickedPayload);
    } catch (err) {
      console.error(
        `[MoimService] ${MOIM_MEMBER_KICKED} 발행 실패(moimId=${moimId}):`,
        err,
      );
    }
  }

  // 소유권 이양(owner 전용). 단일 트랜잭션: 현 owner → member, 대상 → owner. createdBy 불변.
  // 비-owner 403, self-transfer 400, 빈 userId 400, 대상 없음 404, 모임 없음 404.
  async transferOwner(
    sub: string,
    moimId: string,
    targetUserId: string,
  ): Promise<void> {
    // 호출자 owner 인가 — 모임 없음(404), 비-owner(403)을 assertOwner가 일괄 판정한다.
    await this.assertOwner(sub, moimId);
    // targetUserId 비어 있음 검사(ValidationPipe 부재 보완, C-1 패턴).
    if (typeof targetUserId !== 'string' || targetUserId.trim().length === 0) {
      throw new BadRequestException('userId은(는) 비어 있을 수 없습니다');
    }
    if (targetUserId === sub) {
      // 자기 자신에게 이양은 무의미 → 400.
      throw new BadRequestException('이미 owner입니다');
    }
    const target = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId: targetUserId } },
    });
    if (!target) {
      // 대상이 이 모임의 멤버가 아님 → 404.
      throw new NotFoundException();
    }
    // 단일 트랜잭션: 현 owner role → 'member', 대상 role → 'owner'. createdBy 불변.
    await this.prisma.$transaction([
      this.prisma.moimMember.update({
        where: { moimId_userId: { moimId, userId: sub } },
        data: { role: 'member' },
      }),
      this.prisma.moimMember.update({
        where: { moimId_userId: { moimId, userId: targetUserId } },
        data: { role: ROLE_OWNER },
      }),
    ]);

    // SPEC-NOTIFICATIONS-001 M2: 트랜잭션 커밋 이후에만 발행한다(self-transfer 400/비-owner 403/대상 부재 404
    // 경로는 위에서 이미 throw). best-effort 격리 — 리스너 예외가 이미 성립한 이양을 무효화하지 않는다.
    // 수신 대상 = 모임 전체 − actor(신 방장 강조는 data.newOwnerId 로 전달).
    const transferredPayload: MoimOwnerTransferredPayload = {
      moimId,
      actorId: sub,
      newOwnerId: targetUserId,
    };
    try {
      this.events.emit(MOIM_OWNER_TRANSFERRED, transferredPayload);
    } catch (err) {
      console.error(
        `[MoimService] ${MOIM_OWNER_TRANSFERRED} 발행 실패(moimId=${moimId}):`,
        err,
      );
    }
  }

  // 모임 삭제(REQ-MOIM-003 / AC-7). owner 전용 — 비-owner 403/없는 모임 404는 assertOwner가 판정한다.
  // 종속 멤버십은 FK onDelete: Cascade로 함께 제거된다(R-5).
  async deleteMoim(sub: string, moimId: string): Promise<void> {
    await this.assertOwner(sub, moimId);
    await this.prisma.moim.delete({ where: { id: moimId } });
  }

  // 모임 존재를 보장한다(없으면 404). assert* 진입 시 일관된 순서로 호출된다.
  private async requireMoim(moimId: string): Promise<Moim> {
    const moim = await this.prisma.moim.findUnique({ where: { id: moimId } });
    if (!moim) {
      throw new NotFoundException();
    }
    return moim;
  }

  // (moimId, userId) 복합 PK로 멤버십을 조회한다(없으면 null).
  private findMembership(
    sub: string,
    moimId: string,
  ): Promise<MoimMember | null> {
    return this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId: sub } },
    });
  }
}
