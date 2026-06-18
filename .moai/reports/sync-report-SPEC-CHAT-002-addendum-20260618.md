# Sync Report Addendum — SPEC-CHAT-002 (FCM 백그라운드 푸시)

**Date**: 2026-06-18
**Branch**: feature/SPEC-MOBILE-004
**Type**: firebase-admin 라이브 검증 결과 기록
**원본 sync 리포트**: [sync-report-SPEC-CHAT-002.md](./sync-report-SPEC-CHAT-002.md) (2026-06-14)

---

## 요약

이번 세션에서 소스 코드·테스트는 변경하지 않았다. `apps/backend/.env`(gitignored)에 `FIREBASE_CREDENTIALS`를 배선한 후 firebase-admin 초기화 + 인증 + FCM 도달가능성을 라이브 검증했다.

---

## 검증 절차 및 결과

### 1. FIREBASE_CREDENTIALS 배선

- **서비스 계정 파일**: `credentials/GoogleServiceAccount.json` (Firebase Admin SDK 서비스 계정, `project_id=moyura-498500`, `client_email=firebase-adminsdk-...@moyura-498500.iam.gserviceaccount.com`)
- **배선 방식**: 파일 내용을 단일 행 JSON 문자열로 minify → `apps/backend/.env`의 `FIREBASE_CREDENTIALS=<json문자열>` 설정
- **FcmSender 초기화 경로**: `JSON.parse(process.env.FIREBASE_CREDENTIALS)` → `admin.credential.cert(parsed)` → `admin.initializeApp(...)`
- **gitignore**: `apps/backend/.env`는 이미 gitignore에 포함됨. 서비스 계정 키 미커밋.

### 2. 백엔드 재시작 결과

- **이전 상태**: 기동 시 "FIREBASE_CREDENTIALS 미설정 — FcmSender no-op 모드" 경고 출력, FCM 발송 비활성
- **배선 후 상태**: 해당 경고 소멸, init-failure 경고 없음 → firebase-admin 정상 초기화 확인

### 3. 발송 경로 라이브 검증 (standalone firebase-admin)

독립 스크립트로 서비스 계정 + `sendEachForMulticast` 실행:

```
결과: admin.initializeApp() 성공 (project moyura-498500)
      sendEachForMulticast(tokens: ["dummy-token-for-test"]) 실행
      응답: BatchResponse {
        successCount: 0,
        failureCount: 1,
        responses: [{
          success: false,
          error: {
            code: "messaging/mismatched-credential",
            message: "Firebase Cloud Messaging API has not been used in project moyura-498500 before or it is disabled."
          }
        }]
      }
```

**해석**: 이 오류는 자격증명 로딩 오류나 인증 실패가 아니다. Google OAuth2 인증이 성공적으로 통과되어 FCM 서버에 요청이 실제로 도달했고, FCM API 레이어에서 "API 비활성화"로 거부된 것이다. 서비스 계정 키 자체는 유효하며, 백엔드 발송 경로는 FCM 경계까지 정상 동작한다.

---

## 식별된 블로커 (잔여 게이트 3개)

### 게이트 1 — FCM API 활성화 [사용자 액션 필요]

- **문제**: `fcm.googleapis.com` (Firebase Cloud Messaging API)가 project `moyura-498500`에서 비활성화됨
- **증거**: `messaging/mismatched-credential: "Firebase Cloud Messaging API has not been used in project moyura-498500 before or it is disabled."`
- **필요 액션**: Google Cloud Console (console.cloud.google.com) → project `moyura-498500` 선택 → "API 및 서비스" → "라이브러리" → "Firebase Cloud Messaging API" 검색 → 활성화
- **해소 후 효과**: 유효한 FCM 등록 토큰에 대해 실 푸시 발송 가능

### 게이트 2 — Firebase 프로젝트 불일치 해소 [사용자 액션 필요]

- **문제**: 서버 서비스 계정과 모바일 클라이언트 config가 서로 다른 Firebase 프로젝트를 가리킴
  - 서버: `credentials/GoogleServiceAccount.json` → `project_id=moyura-498500`
  - 모바일: `credentials/GoogleService-Info.dev.plist` → `PROJECT_ID=moyura-6c430` (BUNDLE_ID=com.moyura.app)
- **영향**: FCM 토큰은 특정 Firebase 프로젝트에 묶여 발급됨. 모바일이 `moyura-6c430` 기준으로 발급한 토큰을 서버가 `moyura-498500` 서비스 계정으로 발송하면 "mismatched credential" 오류 발생 — 이것이 현재 오류의 구조적 원인 중 하나
- **현재 app.json 상태**: `ios.googleServicesFile` 키 없음 (FCM 배선 미설정) — 의도적으로 잘못된 프로젝트 plist를 추가하지 않음
- **필요 액션**:
  1. Firebase Console에서 `moyura-498500` 프로젝트의 iOS 앱용 `GoogleService-Info.plist` 다운로드
  2. `apps/mobile/credentials/GoogleService-Info.dev.plist` 교체 (또는 신규 경로 배치)
  3. `apps/mobile/app.json`에 `ios.googleServicesFile` + expo-notifications FCM config 배선
  4. Android의 경우 `google-services.json`도 `moyura-498500` 프로젝트 기준으로 교체
  5. iOS APNs 자격증명(EAS credentials)도 동일 프로젝트 기준 확인

### 게이트 3 — 실기기 백그라운드 수신·탭 검증 [실기기 필요]

- **문제**: iOS 시뮬레이터는 실 FCM/APNs 라운드트립 불가 (`xcrun simctl push`로 주입한 페이로드는 실제 FCM 경로와 다름)
- **필요 환경**: 물리적 iOS 기기 + EAS dev build 또는 `expo run:ios`(디바이스)
- **검증 절차**:
  1. 게이트 1·2 완료 후 dev build 빌드 + 실기기 설치
  2. 앱을 백그라운드 상태로 전환
  3. 다른 사용자로 채팅 메시지 전송 (`POST /moims/:id/messages`)
  4. 기기에서 FCM 알림 수신 확인 (REQ-PUSH-005)
  5. 알림 탭 → 앱 열림 + 대상 모임 WebView URL 렌더 확인 (REQ-PUSH-007)
- **게이트 통과 기준**: REQ-PUSH-005 + REQ-PUSH-007 수동 확인 → AC-5 충족 → `completed` 전환 가능

---

## 서버 절반 완료 상태 요약

| 컴포넌트 | 상태 | 검증 방법 |
|----------|------|-----------|
| `FIREBASE_CREDENTIALS` 배선 | 완료 | 백엔드 재시작 후 init 성공 확인 |
| firebase-admin 초기화 | 완료 | no-op 경고 소멸, init-failure 없음 |
| Google 인증 | 완료 | FCM API까지 요청 도달 (인증 단계 통과) |
| FCM API 도달가능성 | 완료 | `messaging/mismatched-credential` = API 레이어 도달 확인 |
| `PushListener` → `FcmSender` 통합 | 완료 (jest) | 기존 206/206 jest 검증 포함 |
| FCM API 활성화 (게이트 1) | 미완료 | 사용자 Google Cloud Console 액션 필요 |
| 프로젝트 일관성 (게이트 2) | 미완료 | `moyura-498500` plist + app.json 배선 필요 |
| 실기기 E2E (게이트 3) | 미완료 | 물리적 iOS 기기 + dev build 필요 |

---

## 상태 전이

| 항목 | 이전 | 이후 |
|------|------|------|
| spec.md status | `in-progress` | `in-progress` (유지) |
| spec.md version | `0.2.0` | `0.3.0` |
| spec.md updated | `2026-06-13` | `2026-06-18` |

`completed` 전환 조건: 게이트 1(FCM API 활성화) + 게이트 2(프로젝트 일관성) + 게이트 3(실기기 수신·탭) 모두 충족.

---

## 동기화된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-CHAT-002/spec.md` | frontmatter version(`0.2.0`→`0.3.0`) / updated(`2026-06-13`→`2026-06-18`) 갱신. HISTORY v0.3.0 항목 추가(FIREBASE_CREDENTIALS 배선, firebase-admin 초기화 성공, 라이브 발송 경로 검증, 잔여 게이트 3개). "보류" 섹션을 "잔여 게이트" 섹션으로 갱신(게이트 1·2·3 구체적 사용자 액션 포함). |
| `CHANGELOG.md` | SPEC-CHAT-002 항목에 firebase-admin 라이브 검증 결과 + 잔여 게이트 3개 추가. |
| `.moai/project/tech.md` | FCM 푸시 인프라 항목에 `FIREBASE_CREDENTIALS` 배선 방식(JSON 직렬화 단일 행, gitignored), 라이브 검증 결과(2026-06-18), 잔여 게이트 요약 추가. |
| `.moai/reports/sync-report-SPEC-CHAT-002-addendum-20260618.md` | 본 리포트 신규 생성. |
