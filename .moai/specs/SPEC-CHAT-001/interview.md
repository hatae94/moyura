# Interview: 모임 채팅 + FCM 백그라운드 푸시

> SPEC 체인: SPEC-MOIM-001 → SPEC-CHAT-001 → SPEC-CHAT-002
> 작성일: 2026-06-11 | 사전 논의: Supabase Broadcast 기반 채팅 아키텍처 제안 (동일 세션)

## 배경 (사전 논의 요약)

Supabase + PostgreSQL 환경에서 모임별 채팅을 개발/비용 리스크 없이 구현하는 방안으로
**Supabase Realtime Broadcast(DB 트리거 방식)** 채택이 합의됨:

- 쓰기: 웹/WebView → NestJS API → Prisma insert (`chat_message`)
- 전파: Postgres 트리거 → `realtime.broadcast_changes()` → private channel `moim:{id}`
- 수신: supabase-js private channel 구독 (웹, 이미 설치된 @supabase/supabase-js 2.106.2)
- 조회: NestJS REST keyset pagination
- 거부된 대안: Postgres Changes 구독(비용/확장성), 채팅 SaaS(MAU 과금), 자체 WebSocket 서버(운영 부담)

사용자 추가 요구사항:
1. 백그라운드 상태에서 FCM 방식으로 이벤트(새 메시지) 수신 필요
2. 모든 기능은 모듈화되어 느슨한 결합이 가능해야 함

## Round 1: SPEC 분할 전략

Question: 채팅 코어와 FCM 푸시를 어떻게 SPEC으로 분할할까요?
Answer: **2개 SPEC 분리** — SPEC-CHAT-001(모임 채팅 코어: 스키마 + NestJS API + Supabase
Broadcast 실시간), SPEC-CHAT-002(FCM 백그라운드 푸시). 채팅은 푸시 없이도 완결적으로
동작하고, 푸시는 채팅의 도메인 이벤트를 구독하는 별도 모듈로 추가 — 느슨한 결합을
구조적으로 보장.

## Round 2: 모임(moim) 도메인 부재 처리

Question: 채팅의 전제인 모임 도메인이 아직 없습니다(backend Prisma에 profile만 존재).
Answer: **모임 도메인 SPEC 별도 선행** — SPEC-MOIM-001을 먼저 작성해 모임 CRUD와
멤버십을 완성한 뒤 채팅 SPEC이 이를 의존. 도메인 경계 가장 깔끔.

→ 결과적으로 SPEC 체인은 3개: MOIM-001 → CHAT-001 → CHAT-002

## Round 3: FCM 네이티브 통합 방식 (Expo 56)

Question: Expo 56 환경에서 FCM 네이티브 통합 방식은?
Answer: **expo-notifications + FCM** — Expo 공식 모듈로 FCM(Android)/APNs(iOS) 수신.
EAS 빌드 호환성 최우선, config plugin 설정 단순. Expo Go에서는 원격 푸시 테스트
불가하므로 dev build 필요(알려진 제약으로 SPEC에 명시).

## Round 4: 푸시 발송 주체 (서버 측)

Question: 푸시 발송 주체(서버 측)는 어디로?
Answer: **NestJS + firebase-admin** — 채팅 쓰기가 이미 NestJS 경유. 메시지 저장 시
도메인 이벤트(EventEmitter2) 발행 → 푸시 모듈이 구독해 firebase-admin으로 발송.
채팅 모듈은 푸시의 존재를 모르는 느슨한 결합. 디바이스 토큰 관리도 동일 백엔드에서 일관 처리.

## Round 5: 게이트 검토 — 가입 모델 (플랜 검토 중 신규 요구사항)

Question: SPEC-MOIM-001의 모임 가입 모델은?
Answer: **주최자(host)는 회원가입 필수, 초대받는 사용자는 가입 없이도 참여 가능해야 함.**
주최자가 공유하는 초대 링크로 초대받은 유저는 무조건 모임에 참여 가능. 구현 전 추가
논의 요청 → Round 6에서 4개 결정으로 구체화.

Question: 웹 채팅 UI 위치는?
Answer: **`/moims/[id]/chat` 신규 라우트** — 푸시 탭 시 WebView 대상 URL 지정과 자연스럽게 연결.

확정된 기본값(오케스트레이터 판단): Firebase 셋업은 런 단계에서 진행(SPEC에는 전제로만 명시),
keyset 커서는 최신순 내림차순.

## Round 6: 초대 링크 + 게스트 참여 모델 구체화

Question: 게스트(비회원) 신원 방식은?
Answer: **Supabase Anonymous Sign-in** — 게스트도 익명 Supabase 사용자(sub)가 되어
기존 가드/RLS/실시간 구독 인가가 그대로 동작. 추후 이메일/OAuth 연결로 정회원 전환 시
메시지·멤버십 자동 승계. 알려진 제약: 쿠키 유실/다른 기기에서 동일 게스트 복귀 불가,
익명 가입 남용 방지(rate limit) 필요.

Question: 초대 링크 정책은?
Answer: **다중 발급 + 만료(기본 7일, 조절 가능) + 회수(revoke)** — `moim_invite` 테이블
(token, moim_id, created_by, expires_at, max_uses, revoked_at).

Question: 채팅 표시 이름은? (현재 profile에 이름 필드 없음 — 회원도 동일 문제)
Answer: **moim_member.nickname (모임별)** — 초대 수락/모임 생성 시점에 닉네임 입력.
게스트/회원 동일 경로, 채팅 sender 표시는 moim_member 조인으로 해결.

Question: 초대/게스트 SPEC 작성 시점은?
Answer: **지금 함께 작성** — SPEC-MOIM-002(초대 링크 + 게스트 참여)를 4번째 SPEC으로 추가.

## 최종 SPEC 체인 (4개)

```
SPEC-MOIM-001 (모임 도메인: CRUD + 멤버십 데이터 + nickname, 가입 경로 제외)
   ├─▶ SPEC-MOIM-002 (초대 링크 + 게스트 anonymous 참여 — 유일한 가입 경로)
   └─▶ SPEC-CHAT-001 (채팅 코어 — moim_member 데이터에만 의존, MOIM-002와 병렬 가능)
            └─▶ SPEC-CHAT-002 (FCM 백그라운드 푸시 — 게스트 푸시는 비범위)
```

## Clarity Score

Initial: 6/10 (사전 논의 컨텍스트 풍부하나 분할/도메인 전제/네이티브 방식 미정)
Final: 10/10
Rounds completed: 6 (AskUserQuestion 3회 라운드로 수행)
