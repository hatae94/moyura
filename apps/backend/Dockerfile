# ============================================================
# moyura backend — Cloud Run (asia-northeast3) 멀티스테이지 빌드
# 플랫폼: linux/amd64 (Cloud Run 런타임과 일치)
# Node: 22 (LTS, .nvmrc 기준)
# 패키지 매니저: pnpm + corepack (pnpm-workspace.yaml 모노레포)
#
# 이미지 최적화: pnpm deploy 로 backend production 의존성만 격리 추출한다.
# 전체 hoisted workspace node_modules(~648MB) 대신 backend 서브그래프만 포함하여
# 이미지 크기를 최소화한다. 이 최적화는 Docker 빌드 내부에만 격리되어 있어
# 루트 .npmrc / pnpm-workspace.yaml / mobile / web / ci.yml 에 전혀 영향을 주지 않는다.
# ============================================================

# -------------------------------------------------------
# 스테이지 1: base — corepack + pnpm 활성화 기반 이미지
# -------------------------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# corepack으로 package.json에 명시된 pnpm 버전을 정확히 활성화한다.
RUN corepack enable

# -------------------------------------------------------
# 스테이지 2: builder — 의존성 설치 + 빌드 + prod 의존성 격리
# -------------------------------------------------------
FROM base AS builder
WORKDIR /app

# .npmrc 를 먼저 복사한다.
# node-linker=hoisted 가 설정되어 있어 install 은 flat node_modules 를 생성한다
# (Metro/Expo 호환을 위해 프로젝트 전체에 적용된 설정). 이 값은 install 단계에서 사용된다.
COPY .npmrc ./

# 모노레포 루트의 워크스페이스 메타데이터를 복사한다.
# 이 레이어는 lockfile/package.json 이 바뀌지 않는 한 캐시된다.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/ ./packages/
# pnpm-workspace.yaml 의 patchedDependencies 가 참조하는 패치 파일
# (@react-native-cookies__cookies, expo-modules-jsi 등)이 install 시 필요하다.
COPY patches/ ./patches/

# --frozen-lockfile: lockfile 변경 없이 결정론적 설치를 보장한다.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# 나머지 소스 전체 복사 (node_modules 제외 — .dockerignore 참조)
COPY . .

# -------------------------------------------------------
# [IMPORTANT] DIRECT_URL 빌드 ARG — prisma generate 실행에 필요
#
# prisma.config.ts 는 datasource.url = env('DIRECT_URL') 를 선언한다.
# prisma generate 는 DB에 실제로 연결하지 않지만, prisma.config.ts 를
# 파싱할 때 env() 헬퍼가 환경변수 존재 여부를 검사하여 없으면
# PrismaConfigEnvError 를 던진다 (Prisma 7 동작, render.yaml 주석 참조).
#
# 해결책: 형식이 올바른 더미 PostgreSQL URL 을 빌드 ARG 로 전달한다.
#   - 실제 DB에 연결하지 않으므로 호스트/크레덴셜은 무관하다.
#   - 런타임 시크릿(실제 DIRECT_URL)은 Cloud Run Secret Manager 에서 주입한다.
#   - 이 ARG는 빌드 레이어에만 존재하며 최종 이미지에 포함되지 않는다.
# -------------------------------------------------------
ARG DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DIRECT_URL=${DIRECT_URL}

# nx build backend 를 실행한다.
# project.json 의 build 타겟이 prisma-generate 에 dependsOn 되어 있으므로
# nx가 자동으로 다음 순서를 처리한다:
#   1. prisma-generate: prisma generate → apps/backend/src/generated/prisma/*.ts 생성
#   2. build:          nest build → apps/backend/dist/ 로 컴파일
#
# generated prisma 클라이언트는 모두 .ts 파일이며 (Prisma 7 + pg adapter 아키텍처,
# 네이티브 바이너리 엔진 불필요), nest build 가 tsconfig.build.json 포함 대상으로
# 컴파일하여 dist/src/generated/prisma/ 에 .js 로 출력한다.
RUN pnpm exec nx build backend

# -------------------------------------------------------
# [IMAGE OPTIMIZATION] backend production 의존성만 격리 추출
#
# pnpm deploy 로 backend 서브그래프의 prod deps 만 /prod/backend 로 추출한다.
# 전략 (전역 설정 불변 — 컨테이너 빌드 내부에서만 조작):
#   1. patchedDependencies 섹션 제거:
#      root workspace 의 모바일 전용 패치(@react-native-cookies, expo-modules-jsi)는
#      backend deps 에 매칭되지 않아 deploy 시 ERR_PNPM_UNUSED_PATCH 를 유발한다.
#      → 컨테이너 내 pnpm-workspace.yaml 사본에서 해당 섹션만 제거한다.
#        (install 은 이미 원본 patches 로 완료됨 — 순서상 안전)
#   2. --legacy: inject-workspace-packages=true 없이 deploy 실행 (전역 .npmrc 불변)
#   3. --config.node-linker=isolated: 이 명령에만 isolated linker 적용.
#      hoisted 모드로 deploy 하면 여러 버전 충돌 시 잘못된 버전(jose@4, mobile 의존)이
#      선택되지만, isolated 는 backend lockfile 서브그래프의 정확한 버전(jose@6)을
#      .pnpm 격리 스토어 + symlink 로 배치한다. (전역 .npmrc 는 여전히 hoisted 유지)
# -------------------------------------------------------
RUN sed '/^patchedDependencies:/,$d' pnpm-workspace.yaml > /tmp/ws.yaml && \
    cp /tmp/ws.yaml pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @moyura/backend deploy --prod --legacy \
      --config.node-linker=isolated /prod/backend

# -------------------------------------------------------
# [IMAGE OPTIMIZATION] deploy 결과 후처리 — dev-transitive 잔재 제거
#
# 배경: @prisma/client 는 `prisma` CLI 를 optional peer 로 선언한다. backend 가
# `prisma` 를 devDependency 로 가지므로, install 시 이 optional peer 가 만족되어
# lockfile 에 @prisma/client@7.8.0(prisma@7.8.0(react-dom...)) 형태로 거대한 dev 그래프가
# peer 로 박힌다. pnpm deploy --prod 는 이 optional-peer 링크를 끊지 못해(pnpm 알려진 한계)
# prisma CLI / studio-core / react-dom / effect / pglite / typescript 등 런타임 불필요한
# 대용량 dev 패키지가 /prod/backend/node_modules/.pnpm 에 남는다.
#
# 아래 두 가지를 제거한다 (모두 부팅 + /health prisma 쿼리 컴파일러 로드로 검증됨):
#   1) 대용량 dev-transitive 패키지 (런타임 미사용)
#   2) @prisma/client/runtime 의 비-postgresql WASM query compiler (base64)
#      — moyura 는 postgresql 전용이므로 sqlserver/cockroachdb/mysql/sqlite WASM 불필요.
#        postgresql wasm-base64 와 각 dialect 의 작은 로더 스텁(.js/.mjs)은 유지한다.
# -------------------------------------------------------
RUN cd /prod/backend/node_modules/.pnpm && \
    rm -rf prisma@* '@prisma+studio-core'* '@prisma+dev'* '@prisma+query-plan-executor'* \
           '@electric-sql+pglite'* effect@* typescript@* react-dom@* react@19* \
           '@types+react'* '@types+react-dom'* chart.js@* fast-check@* '@microsoft+tsdoc'* 2>/dev/null; \
    PRISMA_RT=$(ls -d /prod/backend/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime 2>/dev/null | head -1); \
    if [ -n "$PRISMA_RT" ]; then \
      rm -f "$PRISMA_RT"/query_compiler_*bg.sqlserver.wasm-base64.* \
            "$PRISMA_RT"/query_compiler_*bg.cockroachdb.wasm-base64.* \
            "$PRISMA_RT"/query_compiler_*bg.mysql.wasm-base64.* \
            "$PRISMA_RT"/query_compiler_*bg.sqlite.wasm-base64.* 2>/dev/null; \
    fi; \
    echo "=== pruned /prod/backend/node_modules size ===" && du -sh /prod/backend/node_modules

# -------------------------------------------------------
# 스테이지 3: runner — 최소 런타임 이미지
#
# pnpm deploy 로 추출한 /prod/backend 는 isolated 구조(.pnpm 스토어 + 상대경로 symlink)로,
# Docker COPY 시 실제 파일과 상대 symlink 가 함께 복사되어 컨테이너 내에서 정상 해석된다.
# -------------------------------------------------------
FROM node:22-slim AS runner

# 보안: root 가 아닌 전용 사용자로 실행한다.
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home appuser

WORKDIR /app

# backend production 의존성만 (jose@6 등 정확한 버전 해석 완료).
# /prod/backend 는 { package.json, node_modules } 구조이므로 그 하위를 /app 에 매핑한다.
# 런타임 진입점 /app/apps/backend/dist/src/main.js 의 require() 는
# /app/apps/backend/node_modules → /app/node_modules 순으로 탐색하므로 /app/node_modules 로 배치한다.
COPY --from=builder --chown=appuser:nodejs /prod/backend/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /prod/backend/package.json ./package.json

# 컴파일된 애플리케이션 (generated prisma 포함)
# apps/backend/dist/src/generated/prisma/ 가 nest build 출력에 포함되어 있다.
COPY --from=builder --chown=appuser:nodejs /app/apps/backend/dist ./apps/backend/dist

# Cloud Run 은 PORT=8080 을 환경변수로 주입한다.
# main.ts 는 config.get<number>('PORT') 로 이 값을 읽어 listen 한다.
EXPOSE 8080

USER appuser

# 헬스체크: GET /health 는 DB ping 성공 시 200, 실패 시 503 을 반환한다.
# Cloud Run startup probe / liveness probe 경로로 사용된다.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "apps/backend/dist/src/main.js"]
