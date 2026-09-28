import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getJobSummary, jobIdSchema, retryErrors } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const POST = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const { retried } = await retryErrors(prisma, id);
  return NextResponse.json({ job: await getJobSummary(prisma, id), retried });
});
