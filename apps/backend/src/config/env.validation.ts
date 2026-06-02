import { z } from 'zod';

// @MX:ANCHOR: [AUTO] 환경변수 검증의 단일 진입점 — 부팅 시 모든 설정의 진실 공급원(source of truth).
// @MX:REASON: ConfigModule.validate, main.ts(포트/CORS), 향후 모든 설정 소비자가 이 스키마/타입에
// 의존한다(fan_in >= 3). 스키마 변경은 부팅 가능 여부 전체에 영향을 미치므로 계약으로 고정한다.

// CORS_ORIGINS는 콤마 구분 문자열을 입력받아 string[]로 파싱한다(R-F2: 하드코딩 금지, config 주입).
const corsOriginsSchema = z
  .string()
  .min(1, 'CORS_ORIGINS must contain at least one origin')
  .transform((raw) =>
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .refine((origins) => origins.length > 0, {
    message: 'CORS_ORIGINS must resolve to at least one non-empty origin',
  });

// 부팅 시 검증되는 환경변수 스키마 (R-B1).
// 필수: DATABASE_URL, DIRECT_URL, PORT, NODE_ENV, CORS_ORIGINS.
// seam placeholder(R-H2): SUPABASE_* 는 optional — 정의만 하고 런타임에서 사용하지 않는다.
export const envSchema = z.object({
  // 런타임 풀드 연결(prod 6543) / 로컬은 direct 54322 (R-B3/B4).
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // 마이그레이션 전용 direct 연결(5432/54322) (R-B5).
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),
  // 문자열 env를 number로 강제 변환 (R-B6).
  PORT: z.coerce.number().int().positive().max(65535),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  // 콤마 구분 origin 허용 목록 → string[] (R-F1/F2).
  CORS_ORIGINS: corsOriginsSchema,

  // --- Auth seam placeholder (R-H2): optional, 런타임 미사용 ---
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
});

// 검증된 설정의 타입. CORS_ORIGINS는 transform 이후 string[]로 추론된다.
export type Env = z.infer<typeof envSchema>;

// @nestjs/config ConfigModule의 validate 콜백.
// raw env 객체를 받아 검증된 객체를 반환한다.
// 검증 실패 시 설명 메시지와 함께 throw → 부팅 fail-fast, 부분 기동 없음 (R-B2).
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    // Zod v4 prettifyError로 사람이 읽을 수 있는 위반 목록을 만든다.
    const details = z.prettifyError(result.error);
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

// @MX:NOTE: [AUTO] CORS origin 허용 판정 술어(predicate). enableCors의 origin 콜백과
// 단위 테스트가 공유하는 순수 함수 — 허용 목록에 없는 origin은 ACAO로 반영되지 않는다(R-F3).
export function isOriginAllowed(
  origin: string | undefined,
  allowlist: readonly string[],
): boolean {
  // origin이 없는 요청(same-origin, 서버-서버, 헬스체크 등)은 CORS 제약 대상이 아니므로 허용한다.
  if (!origin) {
    return true;
  }
  return allowlist.includes(origin);
}
