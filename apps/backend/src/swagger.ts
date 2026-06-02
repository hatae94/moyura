import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

// @MX:ANCHOR: [AUTO] OpenAPI 문서 빌더 — main.ts(서빙)와 openapi.ts(emit)가 공유하는 단일 정의.
// @MX:REASON: API 계약(R-D1/D2)의 원천. 서빙 경로와 emit 산출물이 동일 문서를 사용해야
// packages/api-client 생성이 서버와 일치한다(드리프트 방지).
export const SWAGGER_PATH = 'api';

function buildDocumentConfig() {
  return new DocumentBuilder()
    .setTitle('moyura API')
    .setDescription('moyura 모노레포 백엔드 API (인프라 배선 단계)')
    .setVersion('1.0.0')
    .build();
}

// app context에서 OpenAPI 문서 객체를 생성한다(HTTP listen 불필요 — R-D2 emit에서 사용).
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildDocumentConfig());
}

// Swagger UI를 /api 에 마운트한다(R-D1: OpenAPI 문서 노출).
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
  return document;
}
