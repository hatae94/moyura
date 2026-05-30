# 독립 감사 보고서 — SPEC-ENV-SETUP-001

감사자: plan-auditor (적대적/회의적 스탠스)
감사일: 2026-05-31
대상: spec.md / acceptance.md / plan.md (fresh read) + 실제 리포 검증(read-only)
M1 Context Isolation: 오케스트레이터의 스티어링 컨텍스트는 무시했다. 본 감사는 세 문서와 실제 리포 사실만으로 판단한다.

---

## Verdict

**CONDITIONAL PASS** — 범위 규율(결정 9~11)과 EARS 형식, 추적성은 견고하다. 그러나 (1) 핵심 R-E4(프론트 env 미설정 시 fail) 요구사항이 Next/Expo의 `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` 빌드타임 인라이닝 메커니즘과 기술적으로 충돌하여 작성된 그대로는 검증 불가능하고, (2) Supabase pooler의 session vs transaction 모드와 로컬 스택의 6543 포트 존재 여부에 대한 과신 주장이 있으며, (3) 전체 R-* ↔ AC 매핑에 누락/불일치가 존재한다. BLOCKER 0건, MAJOR 5건 — 구현 진입 전 MAJOR 항목 수정 권장.

---

## What's Good (보정용 — 긍정 평가)

- **범위 규율 우수**: Non-Goals(L63-81) + Exclusions(L83-90)가 결정 9~11을 충실히 반영한다. "도메인 Prisma 모델 0개"(R-B7), "검증 로직 금지"(R-H3), "배포 잡 없음"(R-I2)이 요구사항과 AC 양쪽에 명시되어 scope creep을 능동적으로 차단한다. 투기적 추상화 금지(L81)를 D2에서 실제로 적용(`openapi-typescript` 권장)한 점이 일관적이다.
- **EARS 형식 준수율 높음**: 대부분의 요구사항이 다섯 EARS 패턴 중 하나에 정확히 매핑되며 키워드가 영어로 유지된다. Unwanted/If-then(R-B2, R-E4, R-F3, R-G3)이 적절히 사용됐다.
- **사실 검증 양호**: 듀얼 URL(6543 pooled / 5432 direct), `?pgbouncer=true`, prepared statement 비활성, `DIRECT_URL` 마이그레이션 — 모두 Supabase/Prisma 공식 문서로 출처가 명시(L216-221)됐다. 검증 불가 항목(PG 마이너 버전)을 "구현 시 검증"으로 정직하게 표기한 점이 모범적이다.
- **리포 사실 정합성 확인됨**: R-B6의 "하드코딩 3000" 주장은 `apps/backend/src/main.ts:6`(`await app.listen(3000)`)로 실측 일치. `.gitignore`의 `.env`/`.env.*`/`!.env.example`(L125-127) 주장도 실측 일치. `node-linker=hoisted`(.npmrc), `@moyura/*` 네이밍, `nx.json targetDefaults`도 실측 일치.
- **Open Decision 처리 성숙**: D1(Prisma 7 vs 6.x)을 닫지 않고 스파이크 + 폴백 경로(L189)로 남긴 것은 bleeding-edge 리스크에 대한 적절한 겸손이다.

---

## Findings by Severity

### BLOCKER
없음.

---

### MAJOR

#### M-1 — R-E4가 Next/Expo의 env 인라이닝 메커니즘과 충돌 (작성된 그대로 검증 불가)
- **Dimension**: 6 기술 건전성 / 2 AC 품질
- **위치**: spec.md R-E4 (L134), acceptance.md AC-E4 (L72-73)
- **문제**: `NEXT_PUBLIC_*`와 `EXPO_PUBLIC_*`는 **빌드/번들 타임에 정적 치환(inlining)**되는 값이다. 미설정 시 런타임에서 값은 그냥 `undefined`(또는 빈 문자열)로 인라이닝되며, 프레임워크가 자동으로 "명시적 설정 에러"를 던지지 않는다. 따라서 "silent fallback 금지 + 명시적 에러 노출"은 프레임워크 기본 동작이 아니라 **앱 코드에서 명시적 가드(부팅 시 assert/throw)를 직접 구현**해야만 충족된다. 현재 R-E4와 AC-E4는 이 구현 책임을 명시하지 않아, 마치 env 파일 설정만으로 달성되는 것처럼 읽힌다. 또한 mobile은 빌드 타임 인라이닝 특성상 "환경별 미설정"을 런타임에 감지하기가 web보다 더 까다롭다.
- **수정 제안**: R-E4를 "the respective app shall include an explicit startup assertion that throws a descriptive configuration error when the base URL env is unset, since `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` are inlined at build time and do not fail automatically"로 구체화. AC-E4에 "앱 코드 내 명시적 가드(assert/throw) 존재" 체크 불릿 추가. plan.md M7은 이미 "미설정 시 명시적 에러"를 언급하나 spec 요구사항 텍스트가 메커니즘을 반영하도록 동기화.

#### M-2 — 로컬 Supabase 스택의 pooled(6543) 포트 가용성에 대한 암묵 가정
- **Dimension**: 6 기술 건전성 / 7 리스크 완전성
- **위치**: spec.md 환경변수 매트릭스 `DATABASE_URL` local 행 (L167: "pooled if available else direct"), R-C2 (L118), R-B4 (L110)
- **문제**: prod는 Supavisor 풀러(6543)가 항상 존재하지만, **Supabase CLI 로컬 스택은 버전/구성에 따라 Supavisor pooler(6543)를 노출하지 않을 수 있다**(로컬은 통상 직접 PG 포트 위주). 매트릭스가 "pooled if available else direct"로 hedge한 것은 정직하나, 이는 곧 **local과 prod에서 `DATABASE_URL`의 연결 모드(transaction pooler vs direct)가 달라질 수 있음**을 의미한다. R-B4("prepared statements 비활성")는 pooled 연결을 전제하는데, local이 direct로 떨어지면 prepared statement 비활성 설정이 불필요/무해한지, 아니면 동작 차이를 유발하는지 명시가 없다. 즉 "prod 패리티"(R-C4) 주장과 실제 연결 모드 차이가 잠재 모순이다.
- **수정 제안**: R-C2/매트릭스에 "local에서 6543 pooler 미노출 시 direct(5432)로 운용하며, 이 경우 prepared-statement 비활성 설정은 무해하게 유지된다(또는 local에서는 비적용)"를 명시. 구현 첫 스파이크(M3)에서 `supabase start` 출력의 포트 구성을 실측 검증하도록 plan.md에 task 추가. Risks 표에 K8(로컬 스택 pooler 부재로 인한 연결 모드 불일치) 신규 추가.

#### M-3 — Supabase pooler의 session vs transaction 모드 미구분 (과신 위험)
- **Dimension**: 6 기술 건전성
- **위치**: spec.md R-B4 (L110), R-B5 (L111), Risks K4 (L207), Sources (L217)
- **문제**: 6543은 Supavisor의 **transaction 모드** 풀러다. Prisma 런타임은 transaction 모드 + `?pgbouncer=true` + prepared statement 비활성 조합을 요구한다 — 여기까지는 맞다. 그러나 SPEC은 transaction/session 모드를 명시적으로 구분하지 않고 "pooled(6543)"로만 뭉뚱그린다. 일부 워크로드(예: 향후 advisory lock, LISTEN/NOTIFY, 일부 마이그레이션류 작업)는 transaction 모드에서 동작하지 않으며 session 모드(별도 포트/설정)가 필요하다. 현재 범위(`SELECT 1` 헬스 프로브)에서는 문제가 없으나, R-B4의 단정적 서술이 "6543이면 항상 안전"이라는 과신을 후속 SPEC에 전파할 수 있다.
- **수정 제안**: R-B4 또는 Sources 주석에 "6543 = Supavisor transaction-mode pooler. 마이그레이션·session-bound 작업은 DIRECT_URL(5432) 사용(R-B5). transaction 모드 제약(prepared statements, session 상태)은 의도적 트레이드오프"임을 한 줄 명시. 범위 밖이지만 후속 오용 방지용 hedge로 충분.

#### M-4 — R-* ↔ AC 추적성 누락/불일치 (R-A4, R-G4, R-H2 매핑 결함)
- **Dimension**: 2 AC 커버리지 / 4 내부 일관성
- **위치**: acceptance.md 전반
- **문제**: 적대적 end-to-end 매핑 결과 다음 불일치 발견:
  1. **R-A4(새 스크립트 추가 시 project.json targets 등록)** — AC-A1 헤더가 `(R-A1, R-A4)`로 표기됐으나(L16), AC-A1 본문은 "타겟이 project.json에 등록"이라는 **정적 상태**만 검증한다. R-A4의 **이벤트 트리거("When a new infrastructure script is added")** 측면은 검증 항목이 없다. 사실상 R-A4는 R-A1과 중복 흡수되어 독립 검증이 불가하다.
  2. **R-G4(end-to-end 증명 artifact)** — AC-G에서 `[ ] /health가 local/prod 양쪽에서 ... 사용된다`(L87)로만 표기. "prod에서 실제 e2e 증명"은 prod 배포가 없는 이 SPEC 범위에서 **검증 불가능한(unfalsifiable) 선언**이다. local 측은 Quality Gate(L114)에서 검증되나 prod 측 e2e는 구두 선언에 그친다.
  3. **R-H2(SUPABASE_* optional placeholder)** — AC-H2(L93)에서 커버되나, 환경변수 매트릭스(L174-176)는 `SUPABASE_*`를 "backend (seam)"로 분류하면서 local 값 소스를 "`supabase start` 출력"으로 명시한다. 그런데 R-H2/AC-H2는 "검증 로직 없음 + optional"이라 **실제로 로드/사용되지 않는 변수**다. 매트릭스가 마치 이 값들이 주입·사용되는 것처럼 읽혀 seam-only 의도와 미세 충돌한다.
- **수정 제안**:
  - AC-A1을 분할: AC-A1a(R-A1, 정적 등록) / AC-A1b(R-A4)에 "신규 인프라 타겟이 `package.json` scripts가 아닌 `project.json` targets에 추가되었는지(예: openapi/generate/prisma 타겟)" 구체 검증 추가.
  - R-G4를 "prod e2e 증명"이 아니라 "the `/health` endpoint is the **designated** artifact for proving wiring; local proof is verified in this SPEC, prod proof is deferred to deployment follow-up"로 falsifiable하게 재서술. AC-G의 prod 불릿은 "Render health check path = `/health` 설정 존재" 같은 **구성 검증**으로 한정.
  - 매트릭스 `SUPABASE_*` 행에 "(seam placeholder — 정의만 하고 런타임 미사용)" 주석을 달아 AC-H2와 정합.

#### M-5 — Open Decision D1(Prisma 7 + NestJS CJS)의 잔여 리스크가 AC로 게이팅되지 않음
- **Dimension**: 7 리스크 완전성 / 8 편향 점검
- **위치**: spec.md D1 (L184-189), Risks K3 (L206), acceptance.md Quality Gate (L118)
- **문제**: D1은 Prisma 7 + `moduleFormat="cjs"`를 권장하면서 "스파이크로 검증, 막히면 6.x 폴백"으로 hedge한다. 이는 좋은 처리다. 그러나 **Prisma 7 자체가 매우 신버전**이며 driver-adapter 강제, `prisma.config.ts` 마이그레이션 설정 등 NestJS CJS 빌드(`nest build`, SWC/ts-loader)와의 통합 리스크는 "권장"이라는 단정형으로 제시되어 편향이 있다. 실측: backend는 `@swc/core`/`ts-loader` 기반 CJS 빌드이고 `typescript: ^5.7.3`이다. Prisma 7 ESM 기본값과의 충돌 가능성은 K3로 식별됐으나, **이 리스크를 닫는 게이트가 AC가 아니라 Quality Gate의 "D1/D2가 구현 시점에 확정·기록됨"(L118)이라는 약한 문장**뿐이다. 즉 권장안이 실패해도 SPEC은 PASS로 보일 수 있다.
- **수정 제안**: D1 권장 문구를 "권장(권장이지 확정 아님; 스파이크 결과에 종속)"로 톤다운하고, AC-A3에 명시적 게이트 추가: "Given Prisma 7 선택 시, When `prisma generate` → `nest build`가 실패하면, Then Prisma 6.x로 폴백하고 결정을 spec HISTORY에 기록한다." 이로써 폴백이 검증 가능한 분기가 된다. 또한 D1을 "settled"가 아닌 "open"으로 유지함이 정직하다(현재도 Open이라 표기는 됨 — 단, 권장 단정 톤만 완화).

---

### MINOR

#### m-1 — YAML frontmatter: `labels` / `status enum` 미존재, `created` vs `created_at` 키 명명
- **Dimension**: 4 일관성 (frontmatter)
- **위치**: spec.md L1-10
- **문제**: frontmatter에 `id/version/status/created/updated/author/priority/issue_number`가 있으나 `labels` 필드가 없고, 날짜 키가 `created`(표준 `created_at` 아님)다. MoAI 표준 감사 기준(MP-3)은 `created_at` + `labels`를 요구한다. 본 SPEC은 단일 프로젝트 인프라 scope라 치명적이지 않으나 일관성 차원에서 플래그.
- **수정 제안**: `labels: [infra, env, monorepo]` 추가, `created`→`created_at` 정규화(또는 프로젝트 frontmatter 표준을 명문화).

#### m-2 — R-A3 "project-local source path" 서술이 구현 디테일에 근접
- **Dimension**: 1 EARS / 3 범위
- **위치**: spec.md R-A3 (L102)
- **문제**: "(generated client emitted into a project-local source path, not relying on a symlinked `node_modules/.prisma`)"는 WHAT보다 HOW(Prisma 7 output 메커니즘)에 가깝다. 요구사항은 "hoisted 레이아웃과 호환"이라는 outcome으로 충분하고, output 경로 전략은 D1/plan 영역이다.
- **수정 제안**: 괄호 안 메커니즘 서술을 D1 또는 plan.md로 이동하고 R-A3은 "shall keep the generated Prisma client resolvable under the hoisted layout"까지만.

#### m-3 — AC-G1의 응답 형태 `{ status: "ok", db: "up" }`가 R-D4 idempotent 생성과 결합되지 않음
- **Dimension**: 2 AC 품질 / 4 일관성
- **위치**: acceptance.md AC-G1 (L85), R-G1 (L144)
- **문제**: 헬스 응답 스키마를 구체화한 것은 좋으나(테스트 가능), 이 스키마가 OpenAPI(R-D1) 문서에 반영되어 생성 클라이언트(R-D3)와 일치하는지에 대한 교차 AC가 없다. 유일 엔드포인트가 `/health`이므로 이 일치가 e2e 배선 증명의 핵심이다.
- **수정 제안**: AC-D 또는 AC-G에 "생성된 `@moyura/api-client`의 `/health` 응답 타입이 백엔드 실제 응답 스키마와 일치(타입 import 후 컴파일 성공)" 불릿 추가.

#### m-4 — Render 무료/저티어 cold start 외 추가 리스크(빌드 시 monorepo 클라이언트 패키지 해석) 미식별
- **Dimension**: 7 리스크 완전성
- **위치**: spec.md Risks (L202-210), 결정 4 (L53)
- **문제**: Render 빌드는 `pnpm nx build backend`인데, hoisted pnpm 워크스페이스에서 `@moyura/api-client` 같은 워크스페이스 패키지가 **프로덕션 빌드 시점에 빌드 순서/해석되는지**(api-client가 backend의 빌드 의존인지, Render가 monorepo 루트에서 install하는지)는 K5(cold start)와 별개의 실재 리스크다. backend는 api-client에 직접 의존하지 않으므로(클라이언트는 web/mobile 소비) 영향이 작을 수 있으나, Render의 monorepo 빌드 컨텍스트(루트 install vs 서브디렉토리)는 명시가 없다.
- **수정 제안**: Risks에 "Render monorepo 빌드 컨텍스트(루트 `pnpm install` + `nx build backend`, hoisted 해석)" 한 줄 추가. 영향은 낮으므로 MINOR.

#### m-5 — mobile `typescript: ~6.0.3` (TS 6) 환경이 어떤 요구사항에도 반영 안 됨
- **Dimension**: 6 사실 건전성
- **위치**: 실측 apps/mobile/package.json(typescript ~6.0.3) vs spec.md Background (L24)
- **문제**: Background는 mobile을 RN 0.85.3/react 19.2.3로 기술하나 **TypeScript 6**(매우 신버전)을 사용 중인 사실은 누락. 생성 클라이언트(R-D3)를 mobile이 소비할 때 TS 6 + 생성 타입 호환성은 잠재 변수다. env 배선 범위에는 영향이 작아 MINOR.
- **수정 제안**: Background에 "mobile은 TS 6.x 사용 — 생성 클라이언트 타입 호환은 구현 시 검증" 한 줄 추가.

---

### NIT

- **n-1**: HISTORY(L16) 오타 "Supabase **CLL**" → "CLI". (spec.md L16)
- **n-2**: 환경변수 매트릭스 `PORT` local 예시 `3000`(L169)과 web `NEXT_PUBLIC_API_BASE_URL` local `http://localhost:3000`(L172)가 같은 3000을 가리킨다. web dev 서버(Next 기본 3000)와 백엔드 포트가 충돌할 수 있어 예시 값 조정 권장(백엔드 예: 3001). 일관성 NIT.
- **n-3**: AC 문서가 `[ ]` 체크박스와 Given-When-Then을 혼용 — 의도적이고 허용되나, 자동 검증 도구가 GWT를 파싱할 경우 형식 통일이 유리.
- **n-4**: R-C4 "canonical local DB (superseding any plain docker-compose Postgres)"는 현재 리포에 docker-compose가 없으므로(실측) 가상의 대상을 supersede하는 서술. 무해하나 결정 8 맥락 외엔 불필요.

---

## Dimension Scores (rubric-anchored, 0.0-1.0)

| Dimension | Score | 근거 |
|-----------|-------|------|
| 1. EARS 준수 | 0.85 | 패턴 정확. R-A3 메커니즘 혼입(m-2)로 만점 미달 |
| 2. AC 커버리지/품질 | 0.65 | R-A4/R-G4 검증 결함(M-4), R-E4 검증불가(M-1) |
| 3. 범위 규율 | 0.95 | 결정 9~11 충실, scope creep 없음, 누락 in-scope 없음 |
| 4. 내부 일관성 | 0.75 | 매트릭스↔seam, 매핑 ID 불일치(M-4) |
| 5. 그라운드트루스 부합 | 0.90 | 결정 1~12 충실 반영. local pooler 가정(M-2)이 패리티 주장과 미세 충돌 |
| 6. 사실/기술 건전성 | 0.70 | 출처 우수하나 R-E4 메커니즘 오해(M-1), pooler 모드 과신(M-2/M-3) |
| 7. 리스크 완전성 | 0.75 | K1~K7 양호, local pooler·Render monorepo·D1 게이팅 누락 |
| 8. 편향 점검 | 0.80 | D1/D2를 open으로 유지(좋음). 단 D1 권장이 단정 톤(M-5) |

---

## Prioritized Fix List (우선순위)

1. **(M-1)** R-E4/AC-E4를 "앱 코드 내 명시적 startup assertion 필요"로 구체화 — `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` 인라이닝 특성 반영. (검증 가능성 회복)
2. **(M-4)** 추적성 복구: AC-A1 분할(R-A4 독립 검증), R-G4 falsifiable 재서술(prod e2e → 구성 검증), 매트릭스 `SUPABASE_*` seam-only 주석.
3. **(M-2)** 로컬 Supabase 6543 pooler 가용성 가정 명시 + 연결 모드 불일치 리스크(K8) 추가, M3 스파이크에 포트 실측 task.
4. **(M-5)** D1 권장 톤다운 + AC-A3에 Prisma7→6.x 폴백 게이트(검증 가능 분기) 추가.
5. **(M-3)** R-B4/Sources에 Supavisor transaction-mode 명시(후속 오용 방지 hedge).
6. **(m-1~m-5, n-1~n-4)** frontmatter labels/created_at, R-A3 메커니즘 이동, health↔client 타입 일치 AC, Render monorepo 빌드 리스크, TS6 메모, "CLL" 오타, 포트 충돌 예시.

---

## Chain-of-Verification Pass (2차 자기비판)

1차 후 재검토 결과:
- **전체 R-* 재열거 검증**: R-A1~A4, B1~B7, C1~C4, D1~D4, E1~E4, F1~F3, G1~G4, H1~H3, I1~I3 = 총 35개 요구사항을 acceptance.md와 일대일 대조. 누락 AC는 없으나 R-A4/R-G4의 **검증 깊이 부족**(M-4)을 2차에서 확정. R-A1(번호 연속성)·중복 없음 확인.
- **Exclusions 구체성 재검증**: L83-90 6개 항목 모두 구체적(vague 아님). 통과.
- **요구사항 간 모순 탐색**: R-C4(local=prod 패리티) vs 매트릭스 "pooled if available else direct"(L167) = 잠재 모순 발견 → M-2로 반영. R-B4(pooled 전제) vs local direct 가능성 = 동일 축. 그 외 직접 모순 없음.
- **1차에서 놓친 것**: m-3(health 스키마↔생성 클라이언트 타입 일치 AC 부재)은 2차에서 추가 발견. 유일 엔드포인트가 `/health`라 e2e 증명의 핵심임에도 타입 일치 검증 AC가 없었다.
- **실측 재대조**: main.ts 3000(L6) / .gitignore 125-127 / project.json 타겟 부재(openapi·prisma 없음, 정상) / packages/config=@moyura/config — 모두 SPEC 서술과 일치 재확인.

2차 결론: BLOCKER 승격 사유 없음. MAJOR 5건 + m-3 신규 1건 확정. Verdict CONDITIONAL PASS 유지.
