import type { PrismaClient, SearchApiKey } from "@prisma/client";
import { fetchWithRetry } from "@/lib/http";
import { decryptSecret, hashSecret, lastFour } from "@/lib/secrets";

/**
 * Search API key rotation. Keys are tried in priority order; when the
 * provider says a key is out of credits (or rejects it) the next one takes
 * over, and the state is saved so later batches skip it straight away.
 */

export interface KeyHandle {
  id: string;
  label: string;
  key: string;
}

export interface KeyPool {
  /** The first usable key in priority order, or null when none is left. */
  acquire(): Promise<KeyHandle | null>;
  reportSuccess(id: string): Promise<void>;
  reportExhausted(id: string, message: string): Promise<void>;
  reportInvalid(id: string, message: string): Promise<void>;
}

/** In-memory pool, for tests and for scripts run without a database. */
export class StaticKeyPool implements KeyPool {
  private keys: KeyHandle[];
  constructor(keys: (string | KeyHandle)[]) {
    this.keys = keys.map((k, i) => (typeof k === "string" ? { id: `static-${i}`, label: `Key ${i + 1}`, key: k } : k));
  }
  async acquire() {
    return this.keys[0] ?? null;
  }
  async reportSuccess() {}
  async reportExhausted(id: string) {
    this.keys = this.keys.filter((k) => k.id !== id);
  }
  async reportInvalid(id: string) {
    this.keys = this.keys.filter((k) => k.id !== id);
  }
}

// ---------------------------------------------------------------------------
// Serper account (free: does not use a credit)
// ---------------------------------------------------------------------------

export type AccountCheck =
  | { ok: true; balance: number; rateLimit: number | null }
  | { ok: false; invalid: boolean; message: string };

export async function checkSerperAccount(apiKey: string, fetchImpl?: typeof fetch): Promise<AccountCheck> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      "https://google.serper.dev/account",
      { method: "GET", headers: { "X-API-KEY": apiKey } },
      { label: "serper-account", maxRetries: 2, timeoutMs: 15_000, fetchImpl },
    );
  } catch (err) {
    return { ok: false, invalid: false, message: `Could not reach Serper: ${(err as Error).message}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, invalid: true, message: "Serper rejected this key (invalid or revoked)." };
  }
  if (!response.ok) return { ok: false, invalid: false, message: `Serper returned ${response.status}` };
  const body = (await response.json().catch(() => null)) as { balance?: unknown; rateLimit?: unknown } | null;
  const balance = typeof body?.balance === "number" ? body.balance : Number(body?.balance);
  if (!Number.isFinite(balance)) return { ok: false, invalid: false, message: "Serper did not report a balance" };
  return { ok: true, balance, rateLimit: typeof body?.rateLimit === "number" ? body.rateLimit : null };
}

// ---------------------------------------------------------------------------
// Database-backed pool
// ---------------------------------------------------------------------------

/** How often an exhausted key's balance may be re-checked, to spot a top-up. */
export const REVIVE_CHECK_MS = 5 * 60 * 1000;

export const ENV_KEY_LABEL = "From .env (SERPER_API_KEY)";

/** Makes sure the .env key has a row (without storing the key) so it can be ordered and tracked. */
export async function syncEnvKey(prisma: PrismaClient, envKey: string | undefined): Promise<void> {
  const key = envKey?.trim();
  if (!key) return;
  await prisma.searchApiKey.upsert({
    where: { keyHash: hashSecret(key) },
    create: { provider: "serper", label: ENV_KEY_LABEL, source: "env", keyHash: hashSecret(key), last4: lastFour(key), priority: -1 },
    update: {},
  });
}

/** The plaintext key for a row, or null if it can't be used (e.g. the .env key was removed). */
export function resolveKey(row: SearchApiKey, envKey: string | undefined): string | null {
  if (row.source === "env") {
    const key = envKey?.trim();
    return key && hashSecret(key) === row.keyHash ? key : null;
  }
  return row.keyCiphertext ? decryptSecret(row.keyCiphertext) : null;
}

export interface PrismaKeyPoolOptions {
  envKey?: string;
  fetchImpl?: typeof fetch;
}

export class PrismaKeyPool implements KeyPool {
  private rows: SearchApiKey[] | null = null;
  private dead = new Set<string>();
  private revived = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaKeyPoolOptions = {},
  ) {}

  private async load(): Promise<SearchApiKey[]> {
    if (!this.rows) {
      await syncEnvKey(this.prisma, this.options.envKey);
      this.rows = await this.prisma.searchApiKey.findMany({
        where: { provider: "serper", enabled: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });
    }
    return this.rows;
  }

  /** True when at least one enabled key is configured (usable or not). */
  async hasKeys(): Promise<boolean> {
    return (await this.load()).length > 0;
  }

  private handle(row: SearchApiKey): KeyHandle | null {
    try {
      const key = resolveKey(row, this.options.envKey);
      return key ? { id: row.id, label: row.label, key } : null;
    } catch {
      return null; // undecryptable: skipped; Settings shows the problem
    }
  }

  async acquire(): Promise<KeyHandle | null> {
    const rows = await this.load();
    for (const row of rows) {
      if (row.status !== "ACTIVE" || this.dead.has(row.id)) continue;
      const h = this.handle(row);
      if (h) return h;
    }
    // Nothing active: see (for free) whether an exhausted key has been topped up.
    if (!this.revived) {
      this.revived = true;
      for (const row of rows) {
        if (row.status !== "EXHAUSTED" || this.dead.has(row.id)) continue;
        if (row.balanceAt && Date.now() - row.balanceAt.getTime() < REVIVE_CHECK_MS) continue;
        const h = this.handle(row);
        if (!h) continue;
        const check = await checkSerperAccount(h.key, this.options.fetchImpl);
        if (check.ok) {
          const alive = check.balance > 0;
          await this.prisma.searchApiKey.update({
            where: { id: row.id },
            data: {
              balance: check.balance,
              balanceAt: new Date(),
              ...(alive ? { status: "ACTIVE", statusAt: new Date(), lastError: null } : {}),
            },
          });
          if (alive) {
            row.status = "ACTIVE";
            return h;
          }
        }
      }
    }
    return null;
  }

  async reportSuccess(id: string): Promise<void> {
    await this.prisma.searchApiKey
      // Balance counts down as credits are spent (it stays null until first read).
      .update({ where: { id }, data: { requestsCount: { increment: 1 }, balance: { decrement: 1 }, lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  async reportExhausted(id: string, message: string): Promise<void> {
    this.dead.add(id);
    await this.prisma.searchApiKey
      .update({ where: { id }, data: { status: "EXHAUSTED", statusAt: new Date(), balance: 0, balanceAt: new Date(), lastError: message } })
      .catch(() => undefined);
    console.warn(`[search-keys] key ${id} is out of credits; switching to the next key`);
  }

  async reportInvalid(id: string, message: string): Promise<void> {
    this.dead.add(id);
    await this.prisma.searchApiKey
      .update({ where: { id }, data: { status: "INVALID", statusAt: new Date(), lastError: message } })
      .catch(() => undefined);
    console.warn(`[search-keys] key ${id} was rejected; switching to the next key`);
  }
}
