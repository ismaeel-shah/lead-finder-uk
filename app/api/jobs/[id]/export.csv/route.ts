import { handler } from "@/lib/api";
import { BOM, CSV_HEADER, csvFilename, csvLine, resultToCsvLine } from "@/lib/csv";
import { formatDate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getJobOrThrow, jobIdSchema } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHUNK = 2000;

/**
 * Streams every result as CSV, reading the rows in chunks so a large job
 * (tens of thousands of rows) never has to be held in memory at once.
 */
export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const id = jobIdSchema.parse((await params).id);
  const job = await getJobOrThrow(prisma, id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(BOM + csvLine(CSV_HEADER)));
        let cursor: string | undefined;
        for (;;) {
          // Keyset pagination on id: stable and fast however far in we are.
          const rows = await prisma.companyResult.findMany({
            where: { jobId: id },
            orderBy: { id: "asc" },
            take: CHUNK,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          if (rows.length === 0) break;
          controller.enqueue(encoder.encode(rows.map(resultToCsvLine).join("")));
          cursor = rows[rows.length - 1]!.id;
          if (rows.length < CHUNK) break;
        }
        controller.close();
      } catch (err) {
        console.error("[export] failed", err);
        controller.error(err);
      }
    },
  });

  const filename = csvFilename(formatDate(job.incorporatedFrom), formatDate(job.incorporatedTo));
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
