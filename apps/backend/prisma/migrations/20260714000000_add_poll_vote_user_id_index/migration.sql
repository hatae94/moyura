-- SPEC-MOIM-DETAIL 성능 최적화: poll_vote(user_id) 인덱스 추가(비파괴 additive — 데이터/스키마 무변경).
-- aggregatePolls 의 "내 표"(myVotes) 조회 WHERE poll_id IN (...) AND user_id = $sub 를 직접 시크로 만든다.
-- 복합 PK (poll_id, option_id, user_id) 로는 user_id 가 3번째라 poll_id 시크 후 옵션 전체를 훑어야 했다.
-- DeviceToken/ExpenseShare 의 user_id 인덱스 선례와 동일한 패턴.
CREATE INDEX "poll_vote_user_id_idx" ON "poll_vote"("user_id");
