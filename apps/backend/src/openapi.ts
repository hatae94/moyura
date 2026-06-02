import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './swagger';

// OpenAPI emit 스크립트 (R-D2): 서버를 listen하지 않고 app context만 생성하여
// OpenAPI 문서를 apps/backend/openapi.json 에 기록한 뒤 exit 0.
// Nx 타겟 배선은 후속 devops 단계에서 수행한다(여기서는 동작하는 스크립트 + npm script만 제공).
async function emit(): Promise<void> {
  // preview 모드: providers/controllers를 인스턴스화하지 않으므로 PrismaService.$connect(DB 연결)가
  // 실행되지 않는다 → DB 없이 OpenAPI emit 가능(R-D2). createDocument는 INestApplication을 요구하므로
  // createApplicationContext가 아닌 create를 쓰되, listen하지 않아 서버를 띄우지 않는다(R-D2).
  const app = await NestFactory.create(AppModule, {
    logger: false,
    preview: true,
  });

  try {
    const document = createOpenApiDocument(app);
    // process.cwd() 기준으로 결정론적 경로에 기록한다. npm/Nx 타겟은 cwd=apps/backend 에서 실행되므로
    // 산출물은 항상 apps/backend/openapi.json 이 된다(R-D2). dist 중첩 구조에 의존하지 않는다.
    const outputPath = resolve(process.cwd(), 'openapi.json');
    writeFileSync(
      outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf-8',
    );
    console.log(`OpenAPI document written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

void emit()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Failed to emit OpenAPI document:', error);
    process.exit(1);
  });
