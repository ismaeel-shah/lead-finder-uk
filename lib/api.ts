import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { CompaniesHouseError } from "@/lib/companiesHouse";
import { ConfigError } from "@/lib/env";
import { SearchError } from "@/lib/search/types";

/** An error with an HTTP status and a message that is safe to show users. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Maps any thrown error to `{ error }` JSON with a sensible status code. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) return jsonError(err.message, err.status);
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return jsonError(`${where}${issue?.message ?? "Invalid request"}`, 400);
  }
  if (err instanceof ConfigError) return jsonError(err.message, 500);
  // Upstream API failures (including a rejected key) are a bad gateway, not a client error.
  if (err instanceof CompaniesHouseError || err instanceof SearchError) return jsonError(err.message, 502);
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return jsonError("Database is not reachable. Check DATABASE_URL and that Postgres is running.", 503);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
    return jsonError("Database tables are missing or out of date. Run `npx prisma migrate deploy`.", 503);
  }
  console.error("[api] unexpected error", err);
  return jsonError("Unexpected server error", 500);
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a route handler so every thrown error becomes a JSON error response. */
export function handler<P = Record<string, never>>(
  fn: (req: Request, ctx: RouteContext<P>) => Promise<Response>,
): (req: Request, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Parses a JSON body (an empty body counts as `{}`) against a schema. */
export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const text = await req.text();
  let json: unknown = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(400, "Request body must be valid JSON");
    }
  }
  return schema.parse(json);
}

export function parseQuery<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}
