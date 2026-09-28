import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptionReady, encryptSecret, hashSecret, lastFour } from "@/lib/secrets";

afterEach(() => vi.unstubAllEnvs());

describe("secrets", () => {
  it("round-trips a key and never stores it in clear", () => {
    vi.stubEnv("APP_SECRET", "a-very-long-test-secret-value");
    const ct = encryptSecret("61343e3af06d12be");
    expect(ct).not.toContain("61343e3af06d12be");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(encryptSecret("61343e3af06d12be")).not.toBe(ct); // random IV
    expect(decryptSecret(ct)).toBe("61343e3af06d12be");
  });

  it("fails clearly when APP_SECRET changes or is missing", () => {
    vi.stubEnv("APP_SECRET", "a-very-long-test-secret-value");
    const ct = encryptSecret("key");
    vi.stubEnv("APP_SECRET", "a-different-long-secret-value");
    expect(() => decryptSecret(ct)).toThrow(/APP_SECRET/);
    vi.stubEnv("APP_SECRET", "short");
    expect(encryptionReady()).toBe(false);
    expect(() => encryptSecret("key")).toThrow(/APP_SECRET/);
  });

  it("fingerprints and masks keys", () => {
    expect(hashSecret(" abc ")).toBe(hashSecret("abc"));
    expect(hashSecret("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(lastFour("abcdef1234")).toBe("1234");
  });
});
