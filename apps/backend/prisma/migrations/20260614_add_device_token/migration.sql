-- SPEC-CHAT-002 T-001: device_token 레지스트리(REQ-PUSH-002/003).
-- token PK 기준 등록 upsert / 해제 delete. user_id 인덱스로 수신 대상(userId in [...]) 조회를 커버한다.

-- CreateTable
CREATE TABLE "device_token" (
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_token_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "device_token_user_id_idx" ON "device_token"("user_id");
