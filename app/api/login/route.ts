import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, jsonError, parseBody } from "@/lib/api";
import { appPassword, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().max(1000) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST = handler(async (req) => {
  const password = appPassword();
  if (!password) return NextResponse.json({ ok: true });

  const body = await parseBody(req, bodySchema);
  // Compare HMACs so the comparison is constant-time and length-independent.
  const ok = safeEqual(await sessionToken(body.password), await sessionToken(password));
  if (!ok) {
    await sleep(750); // slow down guessing
    return jsonError("Incorrect password", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
});
