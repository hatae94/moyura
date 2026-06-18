// @moyura/api-client — 백엔드 OpenAPI 스펙에서 생성한 타입(./schema) 위에 올린
// 얇은 fetch 래퍼다(SPEC-ENV-SETUP-001 D2: openapi-typescript + thin wrapper 권장).
// schema.d.ts 는 `nx run api-client:generate` 로 재생성되며 gitignore 처리된다(R-D4).
import type { paths, components } from './schema';

// 백엔드가 노출하는 헬스 응답 DTO(HealthResponseDto)의 타입 별칭.
export type HealthResponse = components['schemas']['HealthResponseDto'];

// 보호 라우트 /me 가 반환하는 profile DTO(ProfileResponseDto)의 타입 별칭(SPEC-AUTH-001 R-C1).
// SPEC-MOBILE-004 T-001: name(string | null) 필드를 포함한다 — 웹 온보딩 가드의 권위 있는 출처.
export type ProfileResponse = components['schemas']['ProfileResponseDto'];

// PATCH /me 요청 바디(UpdateNameDto) 타입 별칭(SPEC-MOBILE-004 T-002/T-003).
export type UpdateNameRequest = components['schemas']['UpdateNameDto'];

// GET /moims 가 반환하는 모임 DTO(MoimResponseDto)의 타입 별칭(SPEC-MOIM-003 REQ-MOIM3-006).
// 현재 모델은 { id, name, createdBy, createdAt } — date/time/location/status 등 확장 필드는 없다(Exclusions).
export type MoimResponse = components['schemas']['MoimResponseDto'];

/**
 * 인증 토큰 공급자(SPEC-AUTH-001 R-D4 / OD-3).
 *
 * 호출 시점에 Supabase 세션 access_token 을 동기/비동기로 돌려준다.
 * 세션이 없으면 `null`/`undefined`/빈 문자열을 반환할 수 있으며, 그 경우
 * Authorization 헤더를 붙이지 않는다(헬스 등 public 호출 back-compat 보존).
 *
 * 주의: 토큰은 절대 URL/query 가 아니라 Authorization Bearer 헤더로만 전달된다(R-A9).
 */
export type TokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

/** 클라이언트 생성 옵션. baseUrl 은 프론트 env(NEXT_PUBLIC/EXPO_PUBLIC)에서 주입한다. */
export interface ApiClientOptions {
  /** API 베이스 URL (예: http://localhost:3000). 뒤쪽 슬래시는 자동 제거된다. */
  baseUrl: string;
  /** 선택적 커스텀 fetch 구현(테스트/RN 폴리필 주입용). 기본값은 전역 fetch. */
  fetch?: typeof fetch;
  /**
   * 선택적 인증 토큰 공급자(R-D4). 지정 시 매 요청에서 호출해 Bearer 헤더를 주입한다.
   * 미지정이거나 토큰이 없으면 Authorization 헤더 없이 호출한다(getHealth 등 public 경로 back-compat).
   */
  getToken?: TokenProvider;
}

/** API 호출 실패 시 던지는 에러. 응답 status/본문을 함께 보존한다. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * OpenAPI 스펙 기반 타입드 API 클라이언트.
 *
 * 범위(인프라 배선 + 인증)에 맞춰 최소한의 표면만 노출한다:
 * - getHealth(): /health 편의 메서드 (토큰 불필요 — public)
 * - getMe(): /me 편의 메서드 (Bearer 토큰 필요 — 보호 라우트, R-C1/R-D4)
 * - listMoims(): /moims 편의 메서드 (Bearer 토큰 필요 — 모임 목록, REQ-MOIM3-006)
 * - request(): 임의 경로를 타입 안전하게 호출하는 제네릭 진입점
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getToken?: TokenProvider;

  constructor(options: ApiClientOptions) {
    if (!options.baseUrl) {
      throw new Error('@moyura/api-client: baseUrl 이 필요합니다.');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // 기본 fetch 는 globalThis 에 바인딩한다. 브라우저(WHATWG fetch)는 this===window 를 요구하므로
    // detached 참조(`globalThis.fetch`)를 그대로 호출하면 "Illegal invocation" TypeError 가 난다
    // (Node 의 fetch 는 관대해 서버 컴포넌트에서는 드러나지 않았다 — 채팅이 첫 브라우저 호출에서 노출).
    // 커스텀 fetch(options.fetch)는 호출부가 바인딩 책임을 가지므로 그대로 사용한다.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getToken = options.getToken;
  }

  /**
   * 제네릭 타입드 fetch. path 는 OpenAPI paths 키, method 는 해당 경로의 HTTP 메서드.
   * 응답 본문을 JSON 으로 파싱하여 반환하며, 2xx 가 아니면 ApiError 를 던진다.
   *
   * getToken 이 설정되어 있고 호출자가 Authorization 헤더를 직접 지정하지 않았다면,
   * Supabase 세션 access_token 을 Bearer 로 주입한다(R-D4). 토큰을 URL/query 에는
   * 절대 싣지 않는다(R-A9).
   */
  async request<P extends keyof paths, M extends keyof paths[P]>(
    path: P,
    method: M,
    init?: RequestInit,
  ): Promise<unknown> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('Accept', 'application/json');

    // R-D4/OD-3: 호출자가 Authorization 을 직접 주지 않은 경우에만 토큰 공급자로 Bearer 주입.
    if (this.getToken && !headers.has('Authorization')) {
      const token = await this.getToken();
      const trimmed = token?.trim();
      if (trimmed) {
        headers.set('Authorization', `Bearer ${trimmed}`);
      }
    }

    const response = await this.fetchImpl(`${this.baseUrl}${String(path)}`, {
      ...init,
      method: String(method).toUpperCase(),
      headers,
    });

    const text = await response.text();
    const body: unknown = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new ApiError(
        `요청 실패: ${String(method).toUpperCase()} ${String(path)} → ${response.status}`,
        response.status,
        body,
      );
    }
    return body;
  }

  /** GET /health — 헬스 상태 + DB 연결성 확인 결과를 반환한다(R-G1). 토큰 불필요. */
  async getHealth(): Promise<HealthResponse> {
    return (await this.request('/health', 'get')) as HealthResponse;
  }

  /**
   * GET /me — 인증 사용자의 profile 을 반환한다(SPEC-AUTH-001 R-C1).
   * Bearer 토큰은 getToken 공급자(또는 init.headers 의 Authorization)로 전달된다(R-D4).
   * 토큰이 없으면 백엔드 가드가 401 을 반환하고 ApiError(status=401)로 전파된다.
   */
  async getMe(): Promise<ProfileResponse> {
    return (await this.request('/me', 'get')) as ProfileResponse;
  }

  /**
   * PATCH /me — 인증 사용자의 표시 이름을 영속한다(SPEC-MOBILE-004 REQ-MOB4-003/004).
   * 이메일 회원가입·이름 온보딩(향후 소셜)이 공유하는 provider 비종속 단일 영속 경로의 클라이언트 표면이다.
   * Bearer 토큰은 getToken 공급자로 주입된다(R-D4). name 이 비어 있으면 백엔드가 400 → ApiError 로 전파한다.
   * 갱신 키(sub)는 백엔드 가드-검증 토큰에서만 도출되며 body 에는 name 만 싣는다(mass-assignment 차단).
   */
  async patchMe(name: string): Promise<ProfileResponse> {
    const requestBody: UpdateNameRequest = { name };
    return (await this.request('/me', 'patch', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })) as ProfileResponse;
  }

  /**
   * GET /moims — 인증 사용자가 속한 모임 목록을 반환한다(SPEC-MOIM-003 REQ-MOIM3-006).
   * 백엔드가 멤버 스코핑을 강제하므로(자신이 속한 모임만) 클라이언트 필터링은 불필요하다.
   * Bearer 토큰은 getToken 공급자로 주입된다(R-D4 — 토큰은 URL/query 가 아닌 Authorization 헤더로만, R-A9).
   * 경로 키 `/moims` 는 리터럴이라 generic request 로 타입 안전하다(path 파라미터 조립 불필요 — 상세/멤버
   * 조회는 템플릿 미치환 때문에 web 의 lib/moim/api.ts 가 구체 경로를 조립한다).
   */
  async listMoims(): Promise<MoimResponse[]> {
    return (await this.request('/moims', 'get')) as MoimResponse[];
  }
}

/** 편의 팩토리. `createApiClient({ baseUrl, getToken? })` 로 인스턴스를 만든다. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
