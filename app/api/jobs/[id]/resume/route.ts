import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getJobSummary, jobIdSchema, resumeJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Starts (READY) or resumes (PAUSED) processing. */
export const POST = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  await resumeJob(prisma, id);
  return NextResponse.json({ job: await getJobSummary(prisma, id) });
});
