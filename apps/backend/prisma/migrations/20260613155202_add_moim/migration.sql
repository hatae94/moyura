-- CreateTable
CREATE TABLE "moim" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moim_member" (
    "moim_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moim_member_pkey" PRIMARY KEY ("moim_id","user_id")
);

-- AddForeignKey
ALTER TABLE "moim_member" ADD CONSTRAINT "moim_member_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
