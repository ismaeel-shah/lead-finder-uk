import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deleteKey, updateKey, updateKeySchema } from "@/lib/searchKeys";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(64);

/** Rename, turn on/off, or move up/down in the order. */
export const PATCH = handler<{ id: string }>(async (req, { params }) => {
  const id = idSchema.parse((await params).id);
  const input = await parseBody(req, updateKeySchema);
  return NextResponse.json({ key: await updateKey(prisma, id, input) });
});

export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  const id = idSchema.parse((await params).id);
  await deleteKey(prisma, id);
  return NextResponse.json({ deleted: true });
});
