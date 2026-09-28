/**
 * Search API key rotation and management against a real Postgres database.
 * Skipped unless TEST_DATABASE_URL is set (see jobs.integration.test.ts).
 * The Serper account endpoint is mocked; no real request is made.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, processBatch, resumeJob, type ProcessDepsFactory } from "@/lib/jobs";
import { PrismaKeyPool, REVIVE_CHECK_MS } from "@/lib/search/keys";
import { OUT_OF_CREDITS_MESSAGE, SearchError } from "@/lib/search/types";
import { addKey, checkKey, deleteKey, listKeys, updateKey } from "@/lib/searchKeys";
import { encryptSecret, hashSecret } from "@/lib/secrets";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

/** Mocks https://google.serper.dev/account: balance per key, 403 for unknown keys. */
function mockAccount(balances: Record<string, number>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)["X-API-KEY"]!;
    return key in balances
      ? new Response(JSON.stringify({ balance: balances[key], rateLimit: 5 }), { status: 200 })
      : new Response('{"message":"Unauthorized."}', { status: 403 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function uiKey(key: string, priority: number, extra: Record<string, unknown> = {}) {
  return prisma.searchApiKey.create({
    data: { label: `k${priority}`, keyCiphertext: encryptSecret(key), keyHash: hashSecret(key), last4: key.slice(-4), priority, ...extra },
  });
}

describe.skipIf(!url)("search API keys (Postgres)", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_SECRET", "integration-test-secret-value");
    vi.stubEnv("SERPER_API_KEY", "");
    await prisma.searchApiKey.deleteMany();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await prisma?.searchApiKey.deleteMany();
    await prisma?.$disconnect();
  });

  describe("PrismaKeyPool", () => {
    it("uses keys in priority order, records exhaustion and moves on", async () => {
      const b = await uiKey("key-bbbb", 2);
      const a = await uiKey("key-aaaa", 1);
      await uiKey("key-off", 0, { enabled: false });

      const pool = new PrismaKeyPool(prisma);
      expect((await pool.acquire())?.key).toBe("key-aaaa");
      await pool.reportSuccess(a.id);
      await pool.reportExhausted(a.id, "Out of credits");
      expect((await pool.acquire())?.key).toBe("key-bbbb");

      const saved = await prisma.searchApiKey.findUniqueOrThrow({ where: { id: a.id } });
      expect(saved).toMatchObject({ status: "EXHAUSTED", requestsCount: 1, balance: 0 });
      // A new batch skips the exhausted key straight away.
      expect((await new PrismaKeyPool(prisma).acquire())?.id).toBe(b.id);
    });

    it("revives an exhausted key once its balance is topped up (free check)", async () => {
      const old = new Date(Date.now() - REVIVE_CHECK_MS - 1000);
      const k = await uiKey("key-topup", 1, { status: "EXHAUSTED", balanceAt: old });
      const fetchMock = mockAccount({ "key-topup": 2500 });
      const pool = new PrismaKeyPool(prisma, { fetchImpl: fetchMock as unknown as typeof fetch });
      expect((await pool.acquire())?.id).toBe(k.id);
      expect(await prisma.searchApiKey.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ status: "ACTIVE", balance: 2500 });
    });

    it("returns null when nothing is usable, and uses the .env key without storing it", async () => {
      await uiKey("key-empty", 1, { status: "EXHAUSTED", balanceAt: new Date() });
      expect(await new PrismaKeyPool(prisma).acquire()).toBeNull();

      const pool = new PrismaKeyPool(prisma, { envKey: "env-key-1234" });
      expect((await pool.acquire())?.key).toBe("env-key-1234");
      const env = await prisma.searchApiKey.findUniqueOrThrow({ where: { keyHash: hashSecret("env-key-1234") } });
      expect(env).toMatchObject({ source: "env", keyCiphertext: null, last4: "1234" });
    });
  });

  describe("Settings", () => {
    it("adds a key after a free check, encrypted, and rejects duplicates and invalid keys", async () => {
      mockAccount({ "serper-live-key-1": 2500, "serper-empty-key": 0 });
      const added = await addKey(prisma, { label: "Account 2", key: "serper-live-key-1" });
      expect(added).toMatchObject({ label: "Account 2", last4: "ey-1", status: "ACTIVE", balance: 2500, source: "ui" });
      const row = await prisma.searchApiKey.findUniqueOrThrow({ where: { id: added.id } });
      expect(row.keyCiphertext).not.toContain("serper-live-key-1");
      expect(JSON.stringify(await listKeys(prisma))).not.toContain("serper-live-key-1");

      await expect(addKey(prisma, { label: "", key: "serper-live-key-1" })).rejects.toThrow("already been added");
      await expect(addKey(prisma, { label: "", key: "serper-bad-key-x" })).rejects.toThrow("rejected");
      expect((await addKey(prisma, { label: "", key: "serper-empty-key" })).status).toBe("EXHAUSTED");
    });

    it("refuses to save keys without APP_SECRET", async () => {
      vi.stubEnv("APP_SECRET", "");
      await expect(addKey(prisma, { label: "", key: "serper-live-key-1" })).rejects.toThrow("APP_SECRET");
    });

    it("reorders, turns off, checks and deletes keys", async () => {
      const a = await uiKey("key-aaaa", 0);
      const b = await uiKey("key-bbbb", 1);
      await updateKey(prisma, b.id, { move: "up" });
      expect((await listKeys(prisma)).keys.map((k) => k.id)).toEqual([b.id, a.id]);

      await updateKey(prisma, b.id, { enabled: false });
      expect((await listKeys(prisma)).summary).toMatchObject({ total: 2, usable: 1 });

      mockAccount({ "key-aaaa": 0 });
      expect((await checkKey(prisma, a.id)).status).toBe("EXHAUSTED");

      await deleteKey(prisma, a.id);
      expect((await listKeys(prisma)).keys.map((k) => k.id)).toEqual([b.id]);
    });

    it("won't delete the key that is still in .env", async () => {
      vi.stubEnv("SERPER_API_KEY", "env-key-5678");
      const { keys } = await listKeys(prisma);
      expect(keys[0]).toMatchObject({ source: "env", last4: "5678" });
      await expect(deleteKey(prisma, keys[0]!.id)).rejects.toThrow(".env");
    });
  });

  it("pauses the run without claiming anything when no key can be used", async () => {
    const job = await createJob(prisma, { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01", companyType: "ltd", companyStatus: "active" });
    await prisma.companyResult.create({
      data: { jobId: job.id, companyNumber: "K0000001", companyName: "KEY TEST LTD", incorporationDate: new Date("2026-09-01"), sicCodes: [] },
    });
    await prisma.job.update({ where: { id: job.id }, data: { status: "READY", totalCompanies: 1 } });
    await resumeJob(prisma, job.id);
    const noKeys: ProcessDepsFactory = async () => {
      throw new SearchError(OUT_OF_CREDITS_MESSAGE, 402);
    };
    const result = await processBatch(prisma, job.id, noKeys, 10);
    expect(result).toMatchObject({ processed: 0, remaining: 1, status: "PAUSED" });
    expect(await prisma.companyResult.count({ where: { jobId: job.id, status: "PENDING" } })).toBe(1);
    await prisma.job.delete({ where: { id: job.id } });
  });
});
