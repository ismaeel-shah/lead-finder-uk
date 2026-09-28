-- CreateEnum
CREATE TYPE "SearchKeyStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'INVALID');

-- CreateTable
CREATE TABLE "SearchApiKey" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'serper',
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ui',
    "keyCiphertext" TEXT,
    "keyHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "SearchKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusAt" TIMESTAMP(3),
    "lastError" TEXT,
    "balance" INTEGER,
    "balanceAt" TIMESTAMP(3),
    "requestsCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchApiKey_keyHash_key" ON "SearchApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "SearchApiKey_provider_enabled_priority_idx" ON "SearchApiKey"("provider", "enabled", "priority");

