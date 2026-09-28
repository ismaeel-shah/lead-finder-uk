import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { checkKey } from "@/lib/searchKeys";

export const dynamic = "force-dynamic";

/** Refreshes a key's balance and status (free: uses no search credit). */
export const POST = handler<{ id: string }>(async (_req, { params }) => {
  const id = z.string().trim().min(1).max(64).parse((await params).id);
  return NextResponse.json({ key: await checkKey(prisma, id) });
});
