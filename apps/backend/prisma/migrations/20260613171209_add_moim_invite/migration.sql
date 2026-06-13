-- CreateTable
CREATE TABLE "moim_invite" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moim_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moim_invite_token_key" ON "moim_invite"("token");

-- AddForeignKey
ALTER TABLE "moim_invite" ADD CONSTRAINT "moim_invite_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
