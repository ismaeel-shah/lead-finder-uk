import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { getCompaniesHouseClient } from "@/lib/companiesHouse";
import { prisma } from "@/lib/db";
import { getJobSummary, jobIdSchema, runFetchStep } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Continues fetching companies for a job. The position is stored on the job
 * (day + start_index), so no body is needed; call until `fetch.done`.
 */
export const POST = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const fetch = await runFetchStep(prisma, getCompaniesHouseClient(), id);
  return NextResponse.json({ job: await getJobSummary(prisma, id), fetch });
});
