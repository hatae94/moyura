import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../generated/prisma/client';
import type { MoimInvite } from '../generated/prisma/client';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOIM_MEMBER_JOINED,
  type MoimMemberJoinedPayload,
} from './invite-events';

// 수락자에게 부여되는 멤버십 role(REQ-INV-005 — 항상 member, per-invite 역할은 비범위).
const ROLE_MEMBER = 'member';
// Prisma 고유 제약 위반 코드 — 동시 same-sub 수락 경합 시 두 번째 멤버십 create가 복합 PK 중복으로 던진다.
const PRISMA_UNIQUE_VIOLATION = 'P2002';
// 초대 토큰 엔트로피: 32바이트 = 256-bit(가정 ≥128-bit를 상회). base64url 인코딩.
const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
// 기본 만료(발급 시점 +7일) / 만료 상한(발급 시점 +30일, 무기한 금지 — 토큰 노출 창 제한, REQ-INV-001).
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

// create() 입력(컨트롤러가 가드-검증 sub와 함께 전달). expiresAt/maxUses는 선택적.
export interface CreateInviteInput {
  expiresAt?: string;
  maxUses?: number;
}

@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    // @MX:NOTE: [AUTO] owner 인가는 MOIM-001 MoimService.assertOwner 단일 출처를 재사용한다(재구현 금지).
    // "모임 없음 → 404, owner 아님 → 403" 판정이 한 곳에 모여 드리프트를 막는다. 발급/목록/폐기 3개 관리
    // 경로가 모두 이 계약에 의존한다. 목록(list)은 live 토큰을 응답에 담으므로 owner 전용이어야 한다(REQ-INV-004).
    private readonly moim: MoimService,
    // SPEC-NOTIFICATIONS-001 M1: 도메인 이벤트 발행기(전역 EventEmitterModule.forRoot()). accept 의 신규 멤버십
    // 성공 경로에서만 moim.member.joined 를 발행한다 — NotificationListener 가 구독(느슨한 결합, invite→알림 인식 0).
    private readonly events: EventEmitter2,
  ) {}

  // 초대 발급(REQ-INV-001 / AC-1). owner 전용 — assertOwner가 비-owner를 403으로 거른다.
  async create(
    sub: string,
    moimId: string,
    input: CreateInviteInput,
  ): Promise<MoimInvite> {
    // owner 인가 단일 출처 재사용(비-owner/없는 모임은 여기서 403/404).
    await this.moim.assertOwner(sub, moimId);

    const now = Date.now();
    const expiresAt = this.resolveExpiry(input.expiresAt, now);
    const maxUses = this.resolveMaxUses(input.maxUses);

    return this.prisma.moimInvite.create({
      data: {
        moimId,
        token: generateToken(),
        expiresAt,
        maxUses,
        usedCount: 0,
        revokedAt: null,
        createdBy: sub,
      },
    });
  }

  // 초대 목록 조회(REQ-INV-002 / AC-6). owner 전용 — 응답이 live 토큰을 담으므로 비-owner는 403(REQ-INV-004).
  async list(sub: string, moimId: string): Promise<MoimInvite[]> {
    await this.moim.assertOwner(sub, moimId);
    return this.prisma.moimInvite.findMany({ where: { moimId } });
  }

  // 초대 폐기(REQ-INV-003 / AC-4). owner 전용 — revokedAt를 설정한다. 이후 수락은 410(AC-3c).
  async revoke(
    sub: string,
    moimId: string,
    inviteId: string,
  ): Promise<MoimInvite> {
    // owner 인가(없는 모임 404 / 비-owner 403)를 먼저 판정한다.
    await this.moim.assertOwner(sub, moimId);
    // 초대가 해당 모임 소속인지 확인 — 없거나 다른 모임이면 404(모임-초대 불일치 노출 방지).
    const invite = await this.prisma.moimInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite || invite.moimId !== moimId) {
      throw new NotFoundException();
    }
    // 이미 폐기된 초대 재폐기도 멱등하게 허용(revokedAt 갱신).
    return this.prisma.moimInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  // @MX:ANCHOR: [AUTO] 게스트 가입의 단일 진입점(REQ-INV-005/006). 웹 랜딩(T-009)이 이 계약에 의존하며,
  // 토큰 검증·멱등·고정 실패 코드(404/410/409)·usedCount 원자 증가가 모두 여기서 결정된다(fan_in: 컨트롤러+웹).
  // @MX:REASON: "유효 토큰만 멤버십을 만들고 usedCount를 정확히 1 증가시킨다"는 불변식의 유일한 출처.
  // 멤버십 create와 usedCount 증가는 한 $transaction에 묶여 원자적이며, 조건부 updateMany(count==0 → 롤백)로
  // max_uses 경계 동시 수락을 초과 없이 거른다(409). 이미 멤버면 증가/생성 없이 200(멱등) — usedCount 불변.
  async accept(
    sub: string,
    token: string,
    nickname: string,
  ): Promise<MoimInvite> {
    // 입력 검증(ValidationPipe 부재 — MOIM-001 requireNonEmpty 패턴). nickname 비어 있으면 400, 부작용 없음.
    const trimmed = requireNonEmpty(nickname);

    const invite = await this.prisma.moimInvite.findUnique({
      where: { token },
    });
    // 미지 토큰 → 404(존재 여부만 노출, 모임 정보는 노출하지 않음).
    if (!invite) {
      throw new NotFoundException();
    }
    const now = Date.now();
    // 폐기/만료는 초대 자체가 죽은 상태 → 멤버 여부와 무관하게 410(REQ-INV-006).
    if (invite.revokedAt !== null) {
      throw new GoneException('폐기된 초대입니다');
    }
    if (invite.expiresAt.getTime() <= now) {
      throw new GoneException('만료된 초대입니다');
    }

    // 멱등 선검사: 이미 멤버면 중복 생성·usedCount 증가 없이 200 반환(AC-7).
    // usedCount 초과(409) 검사보다 먼저 둔다 — 한도 소진 초대로 기존 멤버가 재수락해도 409가 아니라 200.
    const existing = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId: invite.moimId, userId: sub } },
    });
    if (existing) {
      return invite;
    }

    // 신규 가입에 한해 usedCount 초과면 409 + 멤버십 미생성 + usedCount 불변(REQ-INV-006 / AC-3d).
    if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
      throw new ConflictException('초대 사용 횟수를 초과했습니다');
    }

    // SPEC-MOIM-012 REQ-MOIM12-001: 신규 가입에 한해 모임 정원 초과 여부를 선검사한다.
    // 기존 멤버 재수락은 위의 멱등 early return 이 먼저 처리하므로 여기까지 오지 않는다.
    const moim = await this.prisma.moim.findUnique({
      where: { id: invite.moimId },
    });
    if (moim !== null) {
      const currentCount = await this.prisma.moimMember.count({
        where: { moimId: invite.moimId },
      });
      if (currentCount >= moim.maxMembers) {
        throw new ConflictException('모임 정원이 가득 찼습니다');
      }
    }

    // 멤버십 create + usedCount 조건부 원자 증가를 한 트랜잭션으로 묶는다.
    // membershipCreated: "실제로 신규 멤버십이 생성되고 usedCount 증가까지 성공한" 경로에서만 true 로 세운다.
    // 멱등(이미 멤버, early return) / 경합 P2002(트랜잭션 내 return invite) / 한도 초과(throw) 는 모두 false 유지 →
    // 트랜잭션 커밋 이후 이 플래그로만 발행 여부를 판정한다(유령/중복 발행 방지 — plan §4).
    let membershipCreated = false;
    const result = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.moimMember.create({
          data: {
            moimId: invite.moimId,
            userId: sub,
            nickname: trimmed,
            role: ROLE_MEMBER,
          },
        });
      } catch (err) {
        // 동시 same-sub 수락 경합: 두 사용자가 멱등 선검사를 동시에 통과한 뒤 두 번째 create가
        // 복합 PK(moimId,userId) 유일성 위반(P2002)으로 던진다 → 멱등 성공으로 처리한다(AC-7 의도).
        // usedCount는 증가시키지 않고(중복은 슬롯 소비 아님) 원본 invite를 반환한다. membershipCreated=false 유지 →
        // 경합 재수락은 알림을 발행하지 않는다(중복 발행 금지).
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === PRISMA_UNIQUE_VIOLATION
        ) {
          return invite;
        }
        throw err;
      }
      // 조건부 증가: revokedAt null + (maxUses null OR usedCount < maxUses)일 때만 count=1.
      // 동시 수락이 먼저 한도를 채웠다면 count=0 → 트랜잭션을 롤백하고 409(초과)로 거른다.
      const limit = invite.maxUses;
      const updated = await tx.moimInvite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          OR:
            limit === null
              ? [{ maxUses: null }]
              : [{ maxUses: null }, { usedCount: { lt: limit } }],
        },
        data: { usedCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        // 동시 경합으로 한도 소진 → 멤버십 create 롤백 + 409(AC-3d 경계 동시성). membershipCreated 미설정 → 미발행.
        throw new ConflictException('초대 사용 횟수를 초과했습니다');
      }
      // 신규 멤버십 생성 + usedCount 원자 증가가 모두 성공한 유일한 경로.
      membershipCreated = true;
      return { ...invite, usedCount: invite.usedCount + 1 };
    });

    // @MX:NOTE: [AUTO] 트랜잭션 커밋 이후에만 moim.member.joined 를 발행한다(SPEC-NOTIFICATIONS-001 M1). "영속
    // 성공 → 발행" 순서를 지켜(chat.service 선례) 저장 없는 발행이 없도록 보장하며, best-effort 격리로 리스너
    // 예외가 이미 성립한 가입(accept)을 500 으로 만들지 않게 한다. 신규 멤버십 경로에서만 발행하고 멱등/경합/한도
    // 초과 경로는 발행하지 않는다(actorId = 가입한 사용자 sub).
    if (membershipCreated) {
      const payload: MoimMemberJoinedPayload = {
        moimId: invite.moimId,
        actorId: sub,
      };
      try {
        this.events.emit(MOIM_MEMBER_JOINED, payload);
      } catch (err) {
        // 발행 실패는 로깅만(삼킴 아님) — 전달은 느슨히 결합된 부가 작업이라 가입 성공을 무효화하지 않는다.
        console.error(
          `[InviteService] ${MOIM_MEMBER_JOINED} 발행 실패(moimId=${invite.moimId}):`,
          err,
        );
      }
    }
    return result;
  }

  // @MX:ANCHOR: [AUTO] 비인증 초대 유효성 단일 진입점(SPEC-MOIM-011). 웹/모바일 랜딩 페이지가
  // 로드 시점에 이 계약에 의존한다(fan_in: InvitePublicController + 향후 웹 랜딩).
  // @MX:REASON: 읽기 전용이며 부작용 없음을 보장한다 — usedCount·멤버십은 절대 변경하지 않는다.
  // maxUses 초과는 유효하다고 판정한다(한도 소진은 수락 시점에만 검사 — AC 설계 의도).
  // 응답에는 초대 미리보기용 모임 요약(name·memberCount·maxMembers)만 노출한다 — 토큰이 256-bit
  // 비밀이라 열거가 불가능하므로 링크 수신자에게만 보이는 의도된 공개 정보다. token·usedCount·maxUses·
  // expiresAt·createdBy 등 민감 필드는 절대 노출하지 않는다.
  async checkValidity(token: string): Promise<{
    moimId: string;
    name: string;
    memberCount: number;
    maxMembers: number;
  }> {
    const invite = await this.prisma.moimInvite.findUnique({
      where: { token },
    });
    // 미지 토큰 → 404(accept 동일 시맨틱).
    if (!invite) {
      throw new NotFoundException();
    }
    const now = Date.now();
    // 폐기 초대 → 410(accept 동일 메시지).
    if (invite.revokedAt !== null) {
      throw new GoneException('폐기된 초대입니다');
    }
    // 만료 초대 → 410(accept 동일 메시지).
    if (invite.expiresAt.getTime() <= now) {
      throw new GoneException('만료된 초대입니다');
    }
    // maxUses/usedCount는 검사하지 않는다 — 한도 소진 초대도 "유효"이며,
    // 기존 멤버가 링크를 재열면 200을 받아야 한다. 초과 거부는 accept() 전용.

    // 초대 미리보기용 모임 요약을 적재한다(요약 필드만 select — 민감 필드 미조회).
    const moim = await this.prisma.moim.findUnique({
      where: { id: invite.moimId },
      select: { name: true, maxMembers: true },
    });
    // 유효한 초대인데 모임이 없는 경우는 정상 흐름에서 발생하지 않지만(FK 보장),
    // 방어적으로 404 처리한다(고아 초대로 빈 응답을 내보내지 않는다).
    if (!moim) {
      throw new NotFoundException();
    }
    const memberCount = await this.prisma.moimMember.count({
      where: { moimId: invite.moimId },
    });
    return {
      moimId: invite.moimId,
      name: moim.name,
      memberCount,
      maxMembers: moim.maxMembers,
    };
  }

  // 만료 시각 해석: 미지정 시 now+7d, 지정 시 상한(now+30d) 검사(초과 400).
  private resolveExpiry(raw: string | undefined, now: number): Date {
    if (raw === undefined) {
      return new Date(now + DEFAULT_EXPIRY_DAYS * DAY_MS);
    }
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('expiresAt 형식이 올바르지 않습니다');
    }
    if (at.getTime() > now + MAX_EXPIRY_DAYS * DAY_MS) {
      // 무기한 금지 — 토큰 노출 창을 30일로 제한한다(REQ-INV-001 상한).
      throw new BadRequestException(
        'expiresAt 상한(30일)을 초과할 수 없습니다',
      );
    }
    return at;
  }

  // maxUses 해석: 미지정 시 null(무제한), 지정 시 양의 정수만 허용(아니면 400).
  private resolveMaxUses(raw: number | undefined): number | null {
    if (raw === undefined) {
      return null;
    }
    if (!Number.isInteger(raw) || raw < 1) {
      throw new BadRequestException('maxUses는 1 이상의 정수여야 합니다');
    }
    return raw;
  }
}

// @MX:WARN: [AUTO] 초대 토큰 생성 — 반드시 CSPRNG(crypto.randomBytes)만 사용한다.
// @MX:REASON: 토큰은 가입의 유일한 자격증명이므로 Math.random 등 약한 RNG로 교체하면 추측·열거가 가능해져
// 무단 가입으로 직결된다. 32바이트(256-bit) base64url로 ≥128-bit 엔트로피 가정(REQ-INV-001)을 보장한다.
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// nickname이 trim 후 비어 있으면 400(ValidationPipe 부재 보완 — MOIM-001 controller 패턴 동일).
function requireNonEmpty(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException('nickname은(는) 비어 있을 수 없습니다');
  }
  return value.trim();
}
