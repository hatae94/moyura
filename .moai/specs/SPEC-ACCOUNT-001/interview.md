# Interview: 스토어 정책 대응 — 회원 탈퇴 (SPEC-ACCOUNT-001)

## 배경

스토어 출시 정책 요건 대응:
- Apple App Review Guideline 5.1.1(v) (계정 생성이 가능한 앱은 앱 내에서 계정 삭제 제공 필수)
- Google Play 계정 삭제 요건 (앱 내 + 웹 경로 계정 삭제 제공)
- 신고/차단 요건은 별도 SPEC(SPEC-SAFETY-001)에서 다룸

## Round 1: 범위 및 구성 (4문항 단일 라운드)

Question: 세 기능(신고, 차단, 회원 탈퇴)을 SPEC 문서로 어떻게 구성할까요?
Answer: 2개로 분리 — 신고+차단은 SPEC-SAFETY-001, 회원 탈퇴는 독립 SPEC-ACCOUNT-001

Question: 회원 탈퇴 시 데이터는 어떻게 처리할까요?
Answer: 즉시 삭제 + UGC 익명화 — Supabase 계정과 개인정보(프로필, 이메일, FCM 토큰)는 즉시 삭제하고, 모임 내 채팅/일정/정산 기록은 '탈퇴한 사용자'로 익명화하여 보존. 다른 멤버의 모임 기록 무결성 유지.

(신고/차단 관련 문항은 SPEC-SAFETY-001/interview.md 참조)

## Clarity Score

Initial: 6/10
Final: 9/10
Rounds completed: 1
