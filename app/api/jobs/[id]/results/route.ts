import { NextResponse } from "next/server";
import { handler, parseQuery } from "@/lib/api";
import { prisma } from "@/lib/db";
import { jobIdSchema, listResults, resultsQuerySchema } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** GET /api/jobs/{id}/results?status=all|found|via_owner|no_match|error|pending&search=&page=&pageSize= */
export const GET = handler<{ id: string }>(async (req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const query = parseQuery(req, resultsQuerySchema);
  return NextResponse.json(await listResults(prisma, id, query));
});
