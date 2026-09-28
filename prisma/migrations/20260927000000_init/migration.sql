-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('FETCHING', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PENDING', 'PROCESSING', 'FOUND', 'NO_MATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('BUSINESS', 'OWNER_OTHER_BUSINESS');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incorporatedFrom" TIMESTAMP(3) NOT NULL,
    "incorporatedTo" TIMESTAMP(3) NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'FETCHING',
    "totalCompanies" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "noMatchCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "searchCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "fetchCursor" JSONB,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "companyNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "incorporationDate" TIMESTAMP(3) NOT NULL,
    "companyType" TEXT,
    "registeredAddress" JSONB,
    "sicCodes" TEXT[],
    "status" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "facebookUrl" TEXT,
    "facebookScore" DOUBLE PRECISION,
    "googleBusinessUrl" TEXT,
    "googleBusinessName" TEXT,
    "googleBusinessAddress" TEXT,
    "googleBusinessPhone" TEXT,
    "googleBusinessWebsite" TEXT,
    "googleBusinessScore" DOUBLE PRECISION,
    "matchSource" "MatchSource",
    "matchedViaCompanyName" TEXT,
    "matchedViaCompanyNumber" TEXT,
    "officerName" TEXT,
    "officerId" TEXT,
    "directorNames" TEXT[],
    "note" TEXT,
    "errorMessage" TEXT,
    "claimedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyResult_jobId_status_idx" ON "CompanyResult"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyResult_jobId_companyNumber_key" ON "CompanyResult"("jobId", "companyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SearchCache_provider_type_query_key" ON "SearchCache"("provider", "type", "query");

-- AddForeignKey
ALTER TABLE "CompanyResult" ADD CONSTRAINT "CompanyResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

