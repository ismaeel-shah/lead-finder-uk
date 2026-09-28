import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deleteJob, getJobSummary, jobIdSchema } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  return NextResponse.json({ job: await getJobSummary(prisma, id) });
});

/** Deletes the run and its results; the search cache is kept. */
export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  return NextResponse.json({ deleted: true, ...(await deleteJob(prisma, id)) });
});
