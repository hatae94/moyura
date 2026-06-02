import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { type Env, isOriginAllowed } from './config/env.validation';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 검증된 설정만 신뢰한다(ConfigModule이 validateEnv로 이미 fail-fast 검증함).
  // WasValidated=true 이므로 get<T>(key)는 T를 그대로 반환한다(undefined 없음).
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get<number>('PORT');
  const corsOrigins = config.get<string[]>('CORS_ORIGINS');

  // CORS: 허용 목록(R-F1/F2) 기반. 목록에 없는 origin은 ACAO로 반영되지 않는다(R-F3, no wildcard).
  // CustomOrigin으로 명시 타입을 부여한다(origin: string|undefined, callback 시그니처 고정).
  const corsOrigin: CustomOrigin = (origin, callback) => {
    // 허용 origin → true(반영), 비허용 → false(ACAO 헤더 미설정).
    callback(null, isOriginAllowed(origin, corsOrigins));
  };
  app.enableCors({ origin: corsOrigin });

  // OpenAPI 문서를 /api 에 노출 (R-D1).
  setupSwagger(app);

  // 하드코딩 3000 제거 — 검증된 PORT 사용 (R-B6).
  await app.listen(port);
}
void bootstrap();
