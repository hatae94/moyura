// jest 부팅 시 apps/backend/.env를 process.env로 로드한다.
// 런타임은 외부에서 env가 주입되지만(Render/쉘), 테스트는 .env를 명시 로드해
// PrismaService(DATABASE_URL)와 ConfigModule 검증이 동작하도록 한다.
// NODE_ENV는 test로 강제해 envSchema(enum)와 정합을 맞춘다.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env') });
process.env.NODE_ENV = 'test';
