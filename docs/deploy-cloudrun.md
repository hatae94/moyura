# Cloud Run 배포 런북 (asia-northeast3)

moyura NestJS 백엔드를 Railway(싱가포르)에서 Google Cloud Run(서울, asia-northeast3)으로 이전하는 단계별 실행 가이드다.

> **중요**: 이 런북은 실행 전 승인을 위한 설계 문서다. GCP 리소스 생성, DNS 전환 등 각 단계는 의도적으로 수동 실행을 전제로 작성되었다.

---

## 목차

1. [리전 선택 근거](#1-리전-선택-근거)
2. [GCP 원타임 설정](#2-gcp-원타임-설정)
3. [api.htyong.com 커스텀 도메인 연결](#3-apihtyongcom-커스텀-도메인-연결)
4. [스케일-투-제로 vs 최소-인스턴스 트레이드오프](#4-스케일-투-제로-vs-최소-인스턴스-트레이드오프)
5. [마이그레이션 워크플로우 (migrate-prod.yml) 재사용](#5-마이그레이션-워크플로우-migrate-prodyml-재사용)
6. [월별 예상 비용](#6-월별-예상-비용)
7. [컷오버 체크리스트](#7-컷오버-체크리스트)
8. [롤백](#8-롤백)

---

## 1. 리전 선택 근거

| 항목 | 현재 (Railway) | 목표 (Cloud Run) |
|------|--------------|----------------|
| 리전 | 싱가포르 (ap-southeast-1) | 서울 (asia-northeast3) |
| Supabase DB | AWS ap-northeast-2 (서울) | AWS ap-northeast-2 (서울) |
| 왕복 레이턴시 (백엔드↔DB) | ~0.3–0.5초 (싱가포르↔서울 해저케이블) | ~1–5ms (서울 메트로 내 교차 클라우드) |

Supabase Postgres가 AWS 서울(ap-northeast-2) 리전에 있으므로, GCP 서울(asia-northeast3)에 백엔드를 배치하면 쿼리당 왕복 레이턴시가 0.3초에서 1–5ms 수준으로 개선된다. 이는 N+1 쿼리나 다중 DB 왕복이 발생하는 API에서 체감 가능한 차이다.

---

## 2. GCP 원타임 설정

아래 단계는 최초 1회만 실행한다. 이후 배포는 GitHub Actions `deploy-cloudrun.yml`이 처리한다.

### 2-1. 프로젝트 선택 및 API 활성화

```bash
# 프로젝트 설정 (기존 프로젝트 사용 또는 신규 생성)
gcloud config set project <GCP_PROJECT_ID>

# 필수 API 활성화
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com
```

### 2-2. Artifact Registry 저장소 생성

```bash
gcloud artifacts repositories create moyura-backend \
  --repository-format=docker \
  --location=asia-northeast3 \
  --description="moyura backend Docker 이미지"
```

### 2-3. 배포 서비스 계정 생성

```bash
# 서비스 계정 생성
gcloud iam service-accounts create cloudrun-deployer \
  --display-name="Cloud Run Deployer (moyura)"

SA_EMAIL="cloudrun-deployer@<GCP_PROJECT_ID>.iam.gserviceaccount.com"

# 필요 권한 부여
gcloud projects add-iam-policy-binding <GCP_PROJECT_ID> \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding <GCP_PROJECT_ID> \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding <GCP_PROJECT_ID> \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud Run 런타임 서비스 계정에도 Secret Manager 접근 부여
# (Cloud Run의 기본 컴퓨팅 SA 또는 별도 런타임 SA 사용 시)
PROJECT_NUMBER=$(gcloud projects describe <GCP_PROJECT_ID> --format="value(projectNumber)")
gcloud projects add-iam-policy-binding <GCP_PROJECT_ID> \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2-4. Workload Identity Federation 설정 (키리스 인증, 권장)

```bash
# WIF 풀 생성
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool"

# WIF 공급자 생성 (GitHub OIDC)
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='hatae94/moyura'"

# WIF 풀 리소스 이름 확인 (GitHub Secret 'GCP_WORKLOAD_IDENTITY_PROVIDER' 에 입력)
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --format="value(name)"

# 서비스 계정에 GitHub 저장소 바인딩
POOL_ID=$(gcloud iam workload-identity-pools describe github-pool \
  --location=global \
  --format="value(name)")
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/hatae94/moyura"
```

> **대안 — SA JSON Key 방식**: WIF 설정이 어려운 경우 `gcloud iam service-accounts keys create key.json --iam-account=${SA_EMAIL}` 로 키를 생성하고 base64로 인코딩하여 `GCP_SA_KEY` 시크릿에 저장한다. `deploy-cloudrun.yml` 에 주석으로 대체 방법이 안내되어 있다.

### 2-5. Secret Manager에 시크릿 생성

아래 명령에서 `<VALUE>` 부분을 실제 값으로 교체한다. 시크릿 이름은 워크플로우의 `--set-secrets` 와 일치해야 한다.

```bash
# DATABASE_URL: Supabase 연결 풀러 (pgbouncer, 포트 6543)
echo -n "postgresql://postgres.xxx:PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true" | \
  gcloud secrets create MOYURA_DATABASE_URL --data-file=-

# DIRECT_URL: Supabase 직접 연결 (마이그레이션/generate용, 포트 5432)
echo -n "postgresql://postgres.xxx:PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" | \
  gcloud secrets create MOYURA_DIRECT_URL --data-file=-

# SUPABASE_URL
echo -n "https://xxx.supabase.co" | \
  gcloud secrets create MOYURA_SUPABASE_URL --data-file=-

# SUPABASE_ANON_KEY
echo -n "eyJhbGci..." | \
  gcloud secrets create MOYURA_SUPABASE_ANON_KEY --data-file=-

# SUPABASE_SERVICE_ROLE_KEY (필수 — 없으면 회원탈퇴 API 500 fail-closed)
echo -n "eyJhbGci..." | \
  gcloud secrets create MOYURA_SUPABASE_SERVICE_ROLE_KEY --data-file=-

# SUPABASE_JWT_SECRET (옵션 — JWT 검증 강화용)
echo -n "your-jwt-secret" | \
  gcloud secrets create MOYURA_SUPABASE_JWT_SECRET --data-file=-

# FIREBASE_CREDENTIALS (옵션 — FCM 푸시 알림용, JSON 문자열)
echo -n '{"type":"service_account",...}' | \
  gcloud secrets create MOYURA_FIREBASE_CREDENTIALS --data-file=-
```

### 2-6. GitHub Secrets / Variables 등록

**GitHub → Settings → Secrets and variables → Actions** 에서 다음을 등록한다.

| 종류 | 이름 | 값 |
|------|------|-----|
| Secret | `GCP_PROJECT_ID` | GCP 프로젝트 ID |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF 공급자 리소스 이름 (2-4 참조) |
| Secret | `GCP_SERVICE_ACCOUNT` | `cloudrun-deployer@<PROJECT>.iam.gserviceaccount.com` |
| Variable | `GCP_REGION` | `asia-northeast3` |
| Variable | `AR_REPO` | `moyura-backend` |
| Variable | `CLOUDRUN_SERVICE` | `moyura-backend` |

---

## 3. api.htyong.com 커스텀 도메인 연결

### Cloud Run 도메인 매핑의 현황

Google Cloud Run의 내장 **도메인 매핑(Domain Mapping)** 기능은 asia-northeast3(서울) 리전에서 지원되지 않는다. 또한 현재 Preview 단계로 프로덕션 사용이 권장되지 않는다. 따라서 대안이 필요하다.

### 옵션 비교

| 옵션 | 비용 | 복잡도 | 비고 |
|------|------|--------|------|
| (A) Global HTTPS Load Balancer + Serverless NEG | ~$18/월 (전달 규칙 고정비) | 높음 | Google Managed SSL, 프로덕션급 |
| **(B) Cloudflare Proxy (권장)** | **$0** | 낮음 | 무료 TLS, Orange Cloud 프록시 |
| (C) Firebase Hosting Rewrite | 불확실 | 중간 | asia-northeast3 지원 미확인 |

### 권장: Cloudflare Proxy 방식

현재 `htyong.com`의 DNS는 Vercel NS 위임으로 관리된다(`prod-domain-htyong-migration` 참조). Cloudflare Free 플랜으로 전환하면 `api.htyong.com`을 Cloud Run URL로 Orange Cloud(프록시) 모드로 연결할 수 있다.

**비용**: Cloudflare Free = $0. web(Vercel)·mobile 배포 영향 없음 — Vercel은 NS에 의존하지 않고 CNAME/A 레코드로 연결되므로 NS 변경 후에도 그대로 동작한다.

#### 3-1. NS를 Cloudflare로 이전

1. Cloudflare 계정에서 `htyong.com` 도메인 추가
2. Cloudflare가 기존 DNS 레코드를 자동 스캔하여 임포트함
3. 도메인 등록 기관에서 NS를 Cloudflare NS로 변경
4. NS 전파 완료 확인 (보통 1–24시간)

> 기존 Vercel DNS 레코드 (`web CNAME → cname.vercel-dns.com`, `www CNAME` 등)를 Cloudflare에 동일하게 유지하면 web 서비스 중단 없이 이전 가능하다.

#### 3-2. api.htyong.com CNAME 레코드 추가

Cloud Run 서비스 배포 후 서비스 URL을 확인한다:

```bash
gcloud run services describe moyura-backend \
  --region=asia-northeast3 \
  --format="value(status.url)"
# 출력 예: https://moyura-backend-xxxxxxxxxx-du.a.run.app
```

Cloudflare DNS에서:
- **Type**: CNAME
- **Name**: `api`
- **Target**: `moyura-backend-xxxxxxxxxx-du.a.run.app` (스킴 제외, 호스트명만)
- **Proxy status**: Orange Cloud (프록시 ON)

Cloudflare가 TLS 종단을 처리하므로 별도 인증서 발급이 불필요하다. Cloud Run `*.run.app` 엔드포인트는 Cloudflare가 오리진으로 접근한다.

#### 3-3. 클라이언트 재빌드 불필요

`api.htyong.com`은 변경되지 않는다. web(`NEXT_PUBLIC_API_BASE_URL=https://api.htyong.com`)과 mobile(`EXPO_PUBLIC_API_BASE_URL`)은 이미 이 도메인을 사용하므로 **재빌드 불필요, DNS 컷오버만으로 완료**된다.

---

## 4. 스케일-투-제로 vs 최소-인스턴스 트레이드오프

| 설정 | `--min-instances=0` | `--min-instances=1` |
|------|-------------------|-------------------|
| 비용 | 요청 없으면 $0 | 상시 ~$5–10/월 추가 |
| Cold start | 있음 (~2–5초) | 없음 |
| 적합한 상황 | 초기/트래픽 간헐적 | 실사용자 유입 후 |

NestJS는 DI 컨테이너 초기화로 인해 cold start가 2–5초 수준이다. 현재 워크플로우에서는 `--min-instances=0`으로 시작하고, 실사용자 유입 이후 `--min-instances=1`로 올리길 권장한다. 값 변경은 아래 명령으로 즉시 적용 가능하다:

```bash
gcloud run services update moyura-backend \
  --region=asia-northeast3 \
  --min-instances=1
```

---

## 5. 마이그레이션 워크플로우 (migrate-prod.yml) 재사용

`.github/workflows/migrate-prod.yml`은 플랫폼 독립적으로 작성되어 있어 **변경 없이 그대로 재사용**된다.

- Supabase DIRECT_URL(포트 5432)에 직접 연결하여 `prisma migrate deploy`를 실행
- Cloud Run 배포와 완전히 분리된 독립 워크플로우
- `apps/backend/prisma/migrations/**` 변경 시 자동 트리거, 또는 `workflow_dispatch` 수동 실행

배포 순서 권장:
1. `migrate-prod.yml` 수동 실행 → DB 스키마 반영 확인
2. `deploy-cloudrun.yml` 수동 실행 → 새 컨테이너 배포

---

## 6. 월별 예상 비용

저트래픽 (초기 단계, 하루 수백~수천 요청 기준):

| 항목 | 예상 비용 |
|------|---------|
| Cloud Run 컴퓨팅 (scale-to-zero, 512Mi/1CPU) | $0–3/월 |
| Cloud Run 컴퓨팅 (min-instances=1) | +$5–10/월 |
| Artifact Registry 스토리지 (~1–2GB 이미지) | ~$0.10–0.20/월 |
| Secret Manager 접근 (월 10,000회 이하) | $0 (무료 한도 내) |
| Cloudflare Proxy (커스텀 도메인 TLS) | $0 (Free 플랜) |
| **합계 (scale-to-zero)** | **$0–5/월** |
| **합계 (min-instances=1)** | **$5–15/월** |

비교: Railway 현재 비용 약 $5–20/월 수준이므로 Cloud Run으로 전환 시 동급이거나 소폭 절감된다. 주요 이점은 비용보다 **서울 리전 코로케이션에 따른 레이턴시 개선**이다.

---

## 7. 컷오버 체크리스트

### 사전 준비 (DNS 전환 전)

- [ ] GCP 원타임 설정 완료 (섹션 2 전체)
- [ ] GitHub Secrets/Variables 등록 완료
- [ ] `deploy-cloudrun.yml` 수동 실행 → Cloud Run 서비스 정상 배포 확인
- [ ] Cloud Run 서비스 URL로 헬스체크 확인: `curl https://[run-url]/health` → `{"status":"ok","db":"up"}`
- [ ] Cloudflare 계정 준비 및 NS 이전 완료 (web 서비스 영향 없음 확인)
- [ ] Railway 서비스 계속 실행 중 (롤백 대비)

### DNS 컷오버

- [ ] Cloudflare DNS에서 `api.htyong.com` CNAME → Cloud Run URL (Orange Cloud ON)
- [ ] DNS 전파 확인: `dig api.htyong.com` → Cloudflare IP 반환
- [ ] `https://api.htyong.com/health` → `{"status":"ok","db":"up"}` 확인
- [ ] web 앱에서 모임 생성/조회 등 핵심 기능 동작 확인
- [ ] mobile 앱에서 로그인 및 API 호출 확인

### 컷오버 후 (Railway 정리)

- [ ] 48–72시간 모니터링 후 이상 없으면 Railway 서비스 일시 중지 (삭제 아님)
- [ ] 1주일 후 이상 없으면 Railway 서비스 삭제 및 구독 해지
- [ ] `railway.json` 은 히스토리 보존을 위해 삭제하지 않아도 무방

---

## 8. 롤백

### Cloud Run 리비전 롤백 (배포 직후 문제 발생 시)

Cloud Run은 모든 배포를 리비전으로 유지한다. 이전 리비전으로 즉시 롤백 가능하다:

```bash
# 현재 리비전 목록 확인
gcloud run revisions list \
  --service=moyura-backend \
  --region=asia-northeast3

# 이전 리비전으로 100% 트래픽 전환 (즉시 적용)
gcloud run services update-traffic moyura-backend \
  --region=asia-northeast3 \
  --to-revisions=moyura-backend-00001-xxx=100
```

### Railway로 롤백 (DNS 컷오버 후 문제 발생 시)

Railway 서비스를 컷오버 후 최소 1주일은 유지한다. 심각한 문제 발생 시:

1. Cloudflare DNS에서 `api.htyong.com` CNAME을 Railway URL(`9pxdz4lv.up.railway.app`)로 복원
2. DNS 전파 대기 (Cloudflare TTL 기본 5분)
3. `https://api.htyong.com/health` 재확인

### CORS 관련 주의

`CORS_ORIGINS`는 `deploy-cloudrun.yml`의 `--set-env-vars`에 하드코딩되어 있다. 추가 origin이 필요하면 워크플로우 파일을 수정하여 재배포한다. 와일드카드(`*`)는 허용되지 않는다 (보안 정책 R-F3).

---

## 참고

- [Cloud Run 지원 리전](https://docs.cloud.google.com/run/docs/locations)
- [Cloud Run 커스텀 도메인 매핑](https://docs.cloud.google.com/run/docs/mapping-custom-domains)
- [Workload Identity Federation 설정](https://github.com/google-github-actions/auth#setup)
- [Artifact Registry 가격](https://cloud.google.com/artifact-registry/pricing)
- [Cloud Run 가격](https://cloud.google.com/run/pricing)
