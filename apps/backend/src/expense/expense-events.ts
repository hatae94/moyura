// @MX:ANCHOR: [AUTO] 경비/정산 도메인 이벤트 계약(SPEC-NOTIFICATIONS-001 M2). expense 모듈이 소유·export하며
// NotificationListener(인앱 알림)와 향후 PushListener(M6 FCM)가 이 계약에 단방향 의존한다(expense는 notification/
// push의 존재를 인식하지 않음 — 느슨한 결합 HARD).
// @MX:REASON: "경비 추가/정산 요청/정산 완료 성공 → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/페이로드 형태가
// 여기서만 정의되어 발행 측(ExpenseService)과 구독 측(NotificationListener)이 드리프트 없이 합의한다(생산자별 소유).
// 경비 추가는 분담 참가자에게만, 정산 요청은 채무자에게만, 정산 완료는 상대방(요청자)에게만 — 수신 대상 산정에
// 필요한 식별자(shareUserIds/debtorId/counterpartyId)를 페이로드가 명시적으로 운반한다(nickname/모임명 미포함).

// moim.expense.added 도메인 이벤트 이름(createExpense).
export const MOIM_EXPENSE_ADDED = 'moim.expense.added';

// moim.settlement.requested 도메인 이벤트 이름(requestSettlement — M2 신규 액션).
export const MOIM_SETTLEMENT_REQUESTED = 'moim.settlement.requested';

// moim.settlement.completed 도메인 이벤트 이름(createSettlement — 신규 마커 생성 시만).
export const MOIM_SETTLEMENT_COMPLETED = 'moim.settlement.completed';

// moim.expense.added 페이로드. 분담 참가자 수신 대상 산정을 위해 shareUserIds 를 명시적으로 운반한다.
export interface MoimExpenseAddedPayload {
  // 경비가 추가된 모임 id.
  moimId: string;
  // 경비를 기록한 사용자 sub(= 유발자, 분담 참가자 목록에서 제외된다).
  actorId: string;
  // 생성된 경비 id(딥링크 타깃 — data.expenseId).
  expenseId: string;
  // 경비 금액(카피 미리보기 — data.amount).
  amount: number;
  // 카테고리 프리셋(카피 미리보기 — data.category).
  category: string;
  // 이 경비의 분담 행 참가자 sub 목록. 수신 대상 = shareUserIds − actor(분담 참가자에게만 알림).
  shareUserIds: string[];
}

// moim.settlement.requested 페이로드(채권자 → 채무자 지불 요청). 수신 대상 = 채무자만.
export interface MoimSettlementRequestedPayload {
  moimId: string;
  // 요청자 sub(= 채권자, 유발자).
  actorId: string;
  // 채무자 sub(= 유일한 수신 대상 — 정산 요청을 받는 당사자).
  debtorId: string;
  // 요청 금액(카피 미리보기 — data.amount).
  amount: number;
}

// moim.settlement.completed 페이로드(정산 완료 마킹). 수신 대상 = 상대방(요청자) 1명.
export interface MoimSettlementCompletedPayload {
  moimId: string;
  // 완료를 마킹한 사용자 sub(= 유발자).
  actorId: string;
  // 정산의 상대방 sub(actor 가 아닌 쪽 — 통상 채권자=요청자. 유일한 수신 대상).
  counterpartyId: string;
  // 정산 금액(카피 미리보기 — data.amount).
  amount: number;
}
