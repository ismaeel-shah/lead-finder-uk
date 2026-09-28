import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { addKey, addKeySchema, listKeys } from "@/lib/searchKeys";

export const dynamic = "force-dynamic";

/** `?refresh=1` re-reads stale balances from the provider first (free). */
export const GET = handler(async (req) => {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await listKeys(prisma, { refresh }));
});

/** Adds a key after a free balance check with the provider. */
export const POST = handler(async (req) => {
  const input = await parseBody(req, addKeySchema);
  return NextResponse.json({ key: await addKey(prisma, input) }, { status: 201 });
});
