import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { jobIdSchema, processBatch } from "@/lib/jobs";
import { batchSize, makeProcessDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Processes one batch; the dashboard calls this repeatedly while the job is running. */
export const POST = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const result = await processBatch(prisma, id, makeProcessDeps, batchSize());
  return NextResponse.json(result);
});
