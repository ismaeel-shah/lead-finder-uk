import type { Prisma } from "@prisma/client";
import { PassThrough, Readable } from "node:stream";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getJobSummary, jobIdSchema } from "@/lib/jobs";
import { writeLeadsWorkbook, xlsxFilename, type ExportRow } from "@/lib/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHUNK = 2000;

/** Rows in display order (date, then name), read in chunks with a keyset cursor. */
async function* chunks(where: Prisma.CompanyResultWhereInput): AsyncIterable<ExportRow[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.companyResult.findMany({
      where,
      orderBy: [{ incorporationDate: "asc" }, { companyName: "asc" }, { id: "asc" }],
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < CHUNK) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

/** Formatted Excel workbook: Summary, Leads and All companies sheets. */
export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const job = await getJobSummary(prisma, id);

  const out = new PassThrough();
  writeLeadsWorkbook(out, job, {
    found: () => chunks({ jobId: id, status: "FOUND" }),
    all: () => chunks({ jobId: id }),
  }).catch((err: unknown) => {
    console.error("[export.xlsx] failed", err);
    out.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${xlsxFilename(job.incorporatedFrom, job.incorporatedTo)}"`,
      "Cache-Control": "no-store",
    },
  });
});
