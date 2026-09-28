import type { PrismaClient, SearchApiKey } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { getConfigStatus } from "@/lib/env";
import { checkSerperAccount, ENV_KEY_LABEL, resolveKey, syncEnvKey } from "@/lib/search/keys";
import { APP_SECRET_MISSING, encryptionReady, encryptSecret, hashSecret, lastFour } from "@/lib/secrets";

/** Settings -> Search API keys. The key itself never leaves the server. */

export const addKeySchema = z.object({
  label: z.string().trim().max(60).optional().default(""),
  key: z.string().trim().min(10, "That doesn't look like an API key").max(200),
});

export const updateKeySchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    enabled: z.boolean().optional(),
    move: z.enum(["up", "down"]).optional(),
  })
  .refine((v) => v.label !== undefined || v.enabled !== undefined || v.move !== undefined, "Nothing to update");

export interface PublicKey {
  id: string;
  label: string;
  source: "ui" | "env";
  last4: string;
  enabled: boolean;
  status: SearchApiKey["status"];
  statusAt: string | null;
  lastError: string | null;
  balance: number | null;
  balanceAt: string | null;
  requestsCount: number;
  lastUsedAt: string | null;
  /** The key can't be used at all (e.g. the .env key was removed or can't be decrypted). */
  unavailable: string | null;
}

const envKey = () => getConfigStatus().config?.SERPER_API_KEY;

function unavailableReason(row: SearchApiKey): string | null {
  try {
    if (resolveKey(row, envKey())) return null;
    return row.source === "env" ? "No longer in .env. Delete it here, or add it back to .env." : "Key missing";
  } catch (err) {
    return (err as Error).message;
  }
}

function toPublic(row: SearchApiKey): PublicKey {
  return {
    id: row.id,
    label: row.label,
    source: row.source === "env" ? "env" : "ui",
    last4: row.last4,
    enabled: row.enabled,
    status: row.status,
    statusAt: row.statusAt?.toISOString() ?? null,
    lastError: row.lastError,
    balance: row.balance,
    balanceAt: row.balanceAt?.toISOString() ?? null,
    requestsCount: row.requestsCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    unavailable: unavailableReason(row),
  };
}

async function ordered(prisma: PrismaClient): Promise<SearchApiKey[]> {
  return prisma.searchApiKey.findMany({ where: { provider: "serper" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
}

/** Balances older than this are re-read (free) when the panel asks for fresh data. */
export const BALANCE_STALE_MS = 2 * 60 * 1000;

export async function listKeys(prisma: PrismaClient, options: { refresh?: boolean } = {}) {
  await syncEnvKey(prisma, envKey());
  if (options.refresh) {
    const stale = (await ordered(prisma)).filter(
      (r) => r.enabled && r.status !== "INVALID" && (!r.balanceAt || Date.now() - r.balanceAt.getTime() > BALANCE_STALE_MS),
    );
    await Promise.all(stale.map((r) => checkKey(prisma, r.id).catch(() => undefined)));
  }
  const rows = await ordered(prisma);
  const keys = rows.map(toPublic);
  const usable = keys.filter((k) => k.enabled && k.status === "ACTIVE" && !k.unavailable);
  return {
    keys,
    encryptionReady: encryptionReady(),
    summary: {
      total: keys.length,
      usable: usable.length,
      /** Sum of last-reported balances of usable keys (null if none reported). */
      credits: usable.some((k) => k.balance !== null) ? usable.reduce((n, k) => n + Math.max(0, k.balance ?? 0), 0) : null,
    },
  };
}

export async function addKey(prisma: PrismaClient, input: z.infer<typeof addKeySchema>): Promise<PublicKey> {
  if (!encryptionReady()) throw new ApiError(400, APP_SECRET_MISSING);
  const keyHash = hashSecret(input.key);
  if (await prisma.searchApiKey.findUnique({ where: { keyHash } })) throw new ApiError(409, "This key has already been added.");

  // Free check: proves the key works and reads its balance.
  const check = await checkSerperAccount(input.key);
  if (!check.ok) throw new ApiError(check.invalid ? 400 : 502, check.message);

  const last = await prisma.searchApiKey.findFirst({ where: { provider: "serper" }, orderBy: { priority: "desc" } });
  const count = await prisma.searchApiKey.count({ where: { provider: "serper" } });
  const row = await prisma.searchApiKey.create({
    data: {
      provider: "serper",
      label: input.label || `Serper key ${count + 1}`,
      source: "ui",
      keyCiphertext: encryptSecret(input.key),
      keyHash,
      last4: lastFour(input.key),
      priority: (last?.priority ?? 0) + 1,
      status: check.balance > 0 ? "ACTIVE" : "EXHAUSTED",
      statusAt: new Date(),
      balance: check.balance,
      balanceAt: new Date(),
    },
  });
  return toPublic(row);
}

async function getKeyOrThrow(prisma: PrismaClient, id: string): Promise<SearchApiKey> {
  const row = await prisma.searchApiKey.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Key not found");
  return row;
}

export async function updateKey(prisma: PrismaClient, id: string, input: z.infer<typeof updateKeySchema>): Promise<PublicKey> {
  await getKeyOrThrow(prisma, id);
  if (input.move) {
    // Renumber 0..n in the current order, then swap with the neighbour.
    const rows = await ordered(prisma);
    const i = rows.findIndex((r) => r.id === id);
    const j = input.move === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    await prisma.$transaction(rows.map((r, n) => prisma.searchApiKey.update({ where: { id: r.id }, data: { priority: n } })));
  }
  const updated = await prisma.searchApiKey.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  return toPublic(updated);
}

export async function deleteKey(prisma: PrismaClient, id: string): Promise<void> {
  const row = await getKeyOrThrow(prisma, id);
  const key = envKey();
  if (row.source === "env" && key && hashSecret(key) === row.keyHash) {
    throw new ApiError(400, "This key comes from SERPER_API_KEY in .env. Remove it there, or turn it off here.");
  }
  await prisma.searchApiKey.delete({ where: { id } });
}

/** Re-reads the balance (free) and sets the status from it. */
export async function checkKey(prisma: PrismaClient, id: string): Promise<PublicKey> {
  const row = await getKeyOrThrow(prisma, id);
  let key: string | null;
  try {
    key = resolveKey(row, envKey());
  } catch (err) {
    throw new ApiError(400, (err as Error).message);
  }
  if (!key) throw new ApiError(400, unavailableReason(row) ?? "Key unavailable");

  const check = await checkSerperAccount(key);
  const now = new Date();
  const data = check.ok
    ? { balance: check.balance, balanceAt: now, status: check.balance > 0 ? ("ACTIVE" as const) : ("EXHAUSTED" as const), statusAt: now, lastError: check.balance > 0 ? null : "Out of credits" }
    : check.invalid
      ? { status: "INVALID" as const, statusAt: now, lastError: check.message }
      : { lastError: check.message };
  return toPublic(await prisma.searchApiKey.update({ where: { id }, data }));
}

export { ENV_KEY_LABEL };
