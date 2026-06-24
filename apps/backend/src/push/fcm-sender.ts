import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

// 푸시 알림 본문(서버 측에서 해석한 sender 표시 이름 = title, 메시지 미리보기 = body).
export interface PushNotification {
  title: string;
  body: string;
}

// FCM data 페이로드(문자열 맵). 탭 시 대상 모임으로 이동하기 위한 moimId 등을 운반한다(REQ-PUSH-007).
export type PushData = Record<string, string>;

// @MX:WARN: [AUTO] 외부 네트워크(firebase-admin)로 푸시를 발송하는 best-effort 경계 — 재시도/큐 없음.
// @MX:REASON: send()는 fire-and-forget(at-most-once)다. sendEachForMulticast 실패/만료 토큰은 무시하고
// (재시도·배달 보장은 비범위 — spec §5, AC 엣지), 예외가 호출자(PushListener→ChatService.emit)로 전파되면
// 이미 영속된 메시지가 HTTP 500이 될 수 있으므로 절대 throw하지 않는다(전 경로 try/catch 격리). 또한
// FIREBASE_CREDENTIALS 부재 시 firebase-admin을 초기화하지 않고 no-op으로 동작해(graceful degrade)
// 자격증명 없이도 부팅/통합 테스트가 통과한다 — 이 불변식이 깨지면 모든 AppModule 통합 테스트가 실패한다.
@Injectable()
export class FcmSender implements OnModuleInit {
  // firebase-admin Messaging 인스턴스. 자격증명 부재 시 null로 남아 send()가 no-op이 된다.
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private readonly config: ConfigService) {}

  // 부팅 시 1회 초기화. FIREBASE_CREDENTIALS가 있으면 firebase-admin을 초기화하고, 없으면 경고 1회 후
  // 비활성 상태로 둔다(graceful degrade — fail-fast 금지). JSON 파싱 실패도 비활성으로 흡수한다(부팅 비차단).
  onModuleInit(): void {
    const credentials = this.config.get<string>('FIREBASE_CREDENTIALS');
    if (!credentials) {
      // 자격증명 부재 — 푸시 비활성. 경고 1회만 로깅하고 send()는 no-op이 된다(부팅/통합 테스트 통과).
      console.warn(
        '[FcmSender] FIREBASE_CREDENTIALS 미설정 — FCM 푸시 비활성(no-op). dev build/실기기 발송에는 자격증명이 필요합니다.',
      );
      return;
    }
    try {
      const serviceAccount = JSON.parse(credentials) as admin.ServiceAccount;
      // 중복 초기화(initializeApp 재호출은 throw) 방지 — 기본 앱이 없을 때만 초기화한다.
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      this.messaging = admin.messaging();
    } catch (err) {
      // 자격증명 파싱/초기화 실패 — 비활성으로 흡수(부팅 비차단). 토큰 내용은 로깅하지 않는다.
      console.warn(
        '[FcmSender] FIREBASE_CREDENTIALS 초기화 실패 — FCM 푸시 비활성(no-op):',
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  // 토큰 목록으로 멀티캐스트 발송한다(REQ-PUSH-001 / AC-1). best-effort:
  //   - 비활성(자격증명 부재/실패) 또는 토큰 0개면 no-op으로 즉시 반환한다(엣지 — 발송 0건은 에러 아님).
  //   - 발송 실패(만료/무효 토큰, 네트워크)는 로깅만 하고 삼키지 않는다 — 재시도/큐 없음(비범위).
  async send(
    tokens: string[],
    notification: PushNotification,
    data?: PushData,
  ): Promise<void> {
    if (!this.messaging || tokens.length === 0) {
      // 비활성이거나 수신 대상 없음 — 발송 시도 없이 종료(no-op).
      return;
    }
    try {
      await this.messaging.sendEachForMulticast({
        tokens,
        notification,
        ...(data ? { data } : {}),
      });
    } catch (err) {
      // best-effort: 발송 실패는 로깅만(삼킴 아님). 예외를 전파하면 영속된 메시지가 500이 될 수 있다(격리).
      console.error(
        '[FcmSender] sendEachForMulticast 실패(best-effort, 재시도 없음):',
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }
}
