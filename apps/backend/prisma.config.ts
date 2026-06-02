// Prisma 7 config (SPEC-ENV-SETUP-001 D1 spike).
// Migrations/introspection use DIRECT_URL (port 5432 prod / 54322 local) per R-B5.
// Runtime PrismaClient uses pooled DATABASE_URL via the pg driver adapter.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});
