import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { getCompaniesHouseClient } from "@/lib/companiesHouse";
import { prisma } from "@/lib/db";
import { createJob, createJobSchema, getJobSummary, listJobs, runFetchStep } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Creates a job and fetches its first companies; continue with POST /api/jobs/{id}/fetch. */
export const POST = handler(async (req) => {
  const input = await parseBody(req, createJobSchema);
  const ch = getCompaniesHouseClient(); // fail before creating a job if the key is missing
  const job = await createJob(prisma, input);
  const fetch = await runFetchStep(prisma, ch, job.id);
  return NextResponse.json({ job: await getJobSummary(prisma, job.id), fetch }, { status: 201 });
});

export const GET = handler(async () => {
  return NextResponse.json({ jobs: await listJobs(prisma) });
});
