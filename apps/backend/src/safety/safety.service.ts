import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Block, Report } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReportDto } from './dto/create-report.dto';

// 신고 가능한 콘텐츠 타입 화이트리스트(단일 PK 4종만). 복합 PK 콘텐츠(poll_vote/expense_share/schedule_slot)는
// 단일 id 로 참조 불가라 400 으로 거부한다(REQ-RPT-004). content_type CHECK 제약(마이그레이션 SQL)과 동일 집합.
const REPORTABLE_CONTENT_TYPES = [
  'chat_message',
  'poll',
  'expense',
  'settlement_request',
] as const;

// 복합 PK 유일성 위반 코드 — createBlock 은 이 코드를 멱등 성공으로 흡수한다(invite.service 선례).
const PRISMA_UNIQUE_VIOLATION = 'P2002';

// @MX:ANCHOR: [AUTO] 뷰어 측 읽기 경로 필터의 단일 출처(SPEC-SAFETY-001 M2). chat/poll/expense/schedule/
// notification 다섯 목록 서비스가 이 메서드로 "이 뷰어에게 숨겨야 할 userId 집합"을 주입받는다(fan_in ≥5).
// 불변식: block(blockerId=sub → blockedUserId) 과 report(reporterId=sub → targetUserId) 를 union 하고
// 중복을 제거한 string[] 을 반환한다. 두 소스는 독립 — report 항은 block 유무와 무관하게 유지된다.
// @MX:REASON: block 과 report 를 하나의 union 으로 흡수해야 "신고했지만 차단은 원치 않음" 케이스도 같은
// 필터 인프라로 커버되고, 차단 해제(block 삭제)가 신고 기반 숨김(report 항)을 되살리지 않는다는 불변식이
// 이 union 구조 자체로 보장된다(두 소스를 각각 blockerId=sub / reporterId=sub 로만 조회 — 교차 노출 불가).
@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  // 뷰어(sub) 에게 숨겨야 할 userId 집합. block(정방향) ∪ report 를 요청당 각 1회 조회한 뒤 중복 제거한다.
  // 소비 도메인은 이 반환값을 WHERE 의 notIn 등에 그대로 적용한다(차단/신고 구분 없이 동일 취급).
  async getHiddenUserIds(sub: string): Promise<string[]> {
    const [blocks, reports] = await Promise.all([
      this.prisma.block.findMany({ where: { blockerId: sub } }),
      this.prisma.report.findMany({ where: { reporterId: sub } }),
    ]);
    return [
      ...new Set([
        ...blocks.map((b) => b.blockedUserId),
        ...reports.map((r) => r.targetUserId),
      ]),
    ];
  }

  // @MX:ANCHOR: [AUTO] 발신(push) 경로 역방향 필터의 단일 출처(SPEC-SAFETY-001 REQ-FLT-006). push.listener 가
  // 채팅 발신자를 차단한 수신자를 발송 대상에서 차감할 때 이 메서드로 blocker 집합을 얻는다.
  // 불변식: block(blockedUserId in userIds) 만 조회하며 report 는 포함하지 않는다.
  // @MX:REASON: 신고(report) 는 잠금화면 push 억제를 기대하지 않으므로 발신 필터에서 제외한다 — 오직 명시적
  // block 만 push 를 억제한다. 읽기 경로의 getHiddenUserIds(block∪report) 와 의도적으로 다른 소스를 쓴다.
  async getBlockersOf(userIds: string[]): Promise<Set<string>> {
    // 빈 목록이면 DB 왕복 없이 빈 집합(빈 in 절 회피).
    if (userIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.block.findMany({
      where: { blockedUserId: { in: userIds } },
    });
    return new Set(rows.map((r) => r.blockerId));
  }

  // 신고를 저장한다(REQ-RPT-001). reporterId 는 가드-검증 sub 로 강제하며 DTO 의 어떤 필드도 신고자 결정에
  // 쓰지 않는다(WHERE 내장 인가 — mass-assignment 차단, REQ-CPL-003). content_type 화이트리스트 위반(복합 PK
  // 콘텐츠 포함)·빈 사유는 400 으로 거른다(ValidationPipe 부재 보완). **report 행만 생성하며 block 은 만들지 않는다**
  // (신고 ≠ 차단, REQ-RPT-002 — 실제 차단은 REQ-RPT-003 prompt 수락 시 createBlock 별도 호출).
  async createReport(sub: string, dto: CreateReportDto): Promise<Report> {
    if (!isReportableContentType(dto.contentType)) {
      throw new BadRequestException(
        'content_type 은 chat_message|poll|expense|settlement_request 중 하나여야 합니다',
      );
    }
    if (dto.reason.trim().length === 0) {
      throw new BadRequestException('reason 은 비어 있을 수 없습니다');
    }
    return this.prisma.report.create({
      data: {
        reporterId: sub,
        targetUserId: dto.targetUserId,
        moimId: dto.moimId,
        reason: dto.reason,
        contentType: dto.contentType,
        contentId: dto.contentId,
      },
    });
  }

  // 차단 행을 생성한다(REQ-BLK-001). blockerId 는 가드-검증 sub 로 강제한다(body 불신). 자기 차단(자기 자신을
  // blockedUserId 로 지정)은 400. 이미 차단돼 있으면 복합 PK 유일성 위반(P2002)을 멱등 성공으로 흡수하고 기존
  // 행을 반환한다 — 재차단이 중복 행을 만들지 않는다(AC-BLK-1).
  async createBlock(sub: string, blockedUserId: string): Promise<Block> {
    if (sub === blockedUserId) {
      throw new BadRequestException('자기 자신은 차단할 수 없습니다');
    }
    try {
      return await this.prisma.block.create({
        data: { blockerId: sub, blockedUserId },
      });
    } catch (err) {
      // 이미 존재하는 차단(P2002) 은 멱등 성공으로 흡수하고 기존 행을 되돌려준다. 그 외 에러는 전파한다.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_UNIQUE_VIOLATION
      ) {
        return this.prisma.block.findUniqueOrThrow({
          where: { blockerId_blockedUserId: { blockerId: sub, blockedUserId } },
        });
      }
      throw err;
    }
  }

  // 차단을 해제한다(REQ-BLK-002). deleteMany 로 없는 행도 멱등 처리한다(delete 의 P2025 회피). WHERE 에
  // blockerId=sub 가 내장되어 남의 차단은 구조적으로 지울 수 없다. **block 행만 삭제하며 report 는 건드리지 않는다**
  // — 차단 해제 ≠ 신고 취소이므로 report 기반 숨김은 getHiddenUserIds 에서 그대로 유지된다(AC-BLK-2).
  async unblock(sub: string, blockedUserId: string): Promise<void> {
    await this.prisma.block.deleteMany({
      where: { blockerId: sub, blockedUserId },
    });
  }

  // 내(sub)가 차단한 목록을 반환한다(REQ-BLK-004). block 행만 조회한다 — 신고(report) 기반 숨김은 이 목록에
  // 나타나지 않는다(프로필 "차단한 멤버" 섹션은 명시적 차단만 노출·해제 대상). blockerId=sub 로만 필터해 격리.
  async listBlocks(sub: string): Promise<Block[]> {
    return this.prisma.block.findMany({ where: { blockerId: sub } });
  }
}

// content_type 이 신고 가능한 단일 PK 4종 화이트리스트에 속하는지 검사한다(복합 PK/미지 값은 false → 400).
function isReportableContentType(contentType: string): boolean {
  return (REPORTABLE_CONTENT_TYPES as readonly string[]).includes(contentType);
}
