import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

// Supabase Admin(service-role) 경계 추상화(SPEC-ACCOUNT-001 T-03 / REQ-ACCOUNT-001).
//
// auth.users 는 Supabase 관리 영역이라 Prisma 트랜잭션에 포함할 수 없다(research.md:142). 탈퇴
// 오케스트레이션(AccountService.deleteAccount — T-04)은 앱 데이터 정리(멱등 트랜잭션) 뒤에 이 경계로
// auth 계정을 삭제한다. jest mock 이 가능하도록 인터페이스(추상 클래스 = DI 토큰)로 추상화한다.
//
// service-role 키가 없으면 삭제를 시도할 수 없다(fail-closed). deleteAccount 는 트랜잭션 착수 전에
// isConfigured() 로 이를 확인해 부분 삭제(앱 데이터만 지워지고 auth 는 남음)를 방지한다.
export abstract class SupabaseAdminClient {
  // service-role 키(+ URL)가 주입돼 삭제가 가능한 상태인지 반환한다. deleteAccount 가 트랜잭션 착수
  // 전에 호출해 fail-closed(키 부재 시 삭제 미착수)를 강제하는 seam이다(EC-5 — 삭제 트랜잭션 미실행).
  abstract isConfigured(): boolean;

  // Supabase auth 계정을 삭제한다. 자격증명 부재 시 500(fail-closed), supabase 가 error 를 반환하면
  // 500 으로 승격한다(삭제 실패 → 툼스톤은 이미 계정을 무력화하므로 재호출로 복구 가능 — T-04).
  abstract deleteUser(sub: string): Promise<void>;
}

// @MX:WARN: [AUTO] service-role 키로 임의 auth 계정을 삭제할 수 있는 최상위 권한 경계다.
// @MX:REASON: SUPABASE_SERVICE_ROLE_KEY 가 유출되면 전 계정 삭제가 가능하다(RLS 우회). 키는 env/secret
// 로만 주입하고(커밋 금지), 이 클라이언트는 account 모듈 내부에서만 사용하며, 삭제 대상 sub 는 가드-검증
// user.sub 로만 전달한다(임의 uuid 주입 불가 — T-07 컨트롤러). 키 부재 시 삭제를 시도하지 않고 500 으로
// fail-closed 해(부분 삭제 방지) 자격증명 없이 계정이 어중간하게 지워지는 상태를 막는다.
@Injectable()
export class SupabaseAdminClientImpl extends SupabaseAdminClient {
  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    // URL 은 env.validation 에서 required 이나 방어적으로 함께 확인한다. 키만 optional(부재 시 fail-closed).
    return (
      !!this.config.get<string>('SUPABASE_URL') &&
      !!this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')
    );
  }

  async deleteUser(sub: string): Promise<void> {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) {
      // 자격증명 없이는 삭제 불가 — 부분 삭제를 유발하지 않도록 명시적 500 으로 fail-closed 한다.
      throw new InternalServerErrorException(
        'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않아 계정 삭제를 수행할 수 없습니다.',
      );
    }

    // service-role 클라이언트는 세션을 영속하지 않는다(단발 admin 호출 — chat.live.mts admin 패턴).
    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.admin.deleteUser(sub);
    if (error) {
      // 삭제 실패 — 오케스트레이션이 재호출로 복구할 수 있도록 500 으로 승격한다(상세 메시지 비노출).
      throw new InternalServerErrorException('auth 계정 삭제에 실패했습니다.');
    }
  }
}
