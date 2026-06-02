// @moyura/api-client — 백엔드 OpenAPI 스펙에서 생성한 타입(./schema) 위에 올린
// 얇은 fetch 래퍼다(SPEC-ENV-SETUP-001 D2: openapi-typescript + thin wrapper 권장).
// schema.d.ts 는 `nx run api-client:generate` 로 재생성되며 gitignore 처리된다(R-D4).
import type { paths, components } from './schema';

// 백엔드가 노출하는 헬스 응답 DTO(HealthResponseDto)의 타입 별칭.
export type HealthResponse = components['schemas']['HealthResponseDto'];

/** 클라이언트 생성 옵션. baseUrl 은 프론트 env(NEXT_PUBLIC/EXPO_PUBLIC)에서 주입한다. */
export interface ApiClientOptions {
  /** API 베이스 URL (예: http://localhost:3000). 뒤쪽 슬래시는 자동 제거된다. */
  baseUrl: string;
  /** 선택적 커스텀 fetch 구현(테스트/RN 폴리필 주입용). 기본값은 전역 fetch. */
  fetch?: typeof fetch;
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
 * 범위(인프라 배선)에 맞춰 최소한의 표면만 노출한다:
 * - getHealth(): /health 편의 메서드
 * - request(): 임의 경로를 타입 안전하게 호출하는 제네릭 진입점
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    if (!options.baseUrl) {
      throw new Error('@moyura/api-client: baseUrl 이 필요합니다.');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * 제네릭 타입드 fetch. path 는 OpenAPI paths 키, method 는 해당 경로의 HTTP 메서드.
   * 응답 본문을 JSON 으로 파싱하여 반환하며, 2xx 가 아니면 ApiError 를 던진다.
   */
  async request<P extends keyof paths, M extends keyof paths[P]>(
    path: P,
    method: M,
    init?: RequestInit,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${String(path)}`, {
      method: String(method).toUpperCase(),
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      ...init,
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

  /** GET /health — 헬스 상태 + DB 연결성 확인 결과를 반환한다(R-G1). */
  async getHealth(): Promise<HealthResponse> {
    return (await this.request('/health', 'get')) as HealthResponse;
  }
}

/** 편의 팩토리. `createApiClient({ baseUrl })` 로 인스턴스를 만든다. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
