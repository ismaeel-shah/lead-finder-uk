-- LinkedIn company page and director profile links.
ALTER TABLE "CompanyResult" ADD COLUMN "linkedinCompanyUrl" TEXT,
ADD COLUMN "linkedinCompanyScore" DOUBLE PRECISION,
ADD COLUMN "linkedinDirectorUrl" TEXT,
ADD COLUMN "linkedinDirectorScore" DOUBLE PRECISION;
