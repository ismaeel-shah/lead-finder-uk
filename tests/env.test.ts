import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfigStatus } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getConfigStatus", () => {
  it("reports missing required keys instead of throwing", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    vi.stubEnv("SERPER_API_KEY", "");
    vi.stubEnv("SEARCH_PROVIDER", "");
    const { problems } = getConfigStatus();
    expect(problems.some((p) => p.includes("DATABASE_URL"))).toBe(true);
    expect(problems.some((p) => p.includes("Companies House"))).toBe(true);
    // Serper keys can also come from the dashboard, so the page checks them, not getConfigStatus.
    expect(problems.some((p) => p.includes("Serper"))).toBe(false);
  });

  it("applies defaults when everything required is set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "ch");
    vi.stubEnv("SERPER_API_KEY", "sp");
    vi.stubEnv("SEARCH_PROVIDER", "");
    vi.stubEnv("MATCH_THRESHOLD", "");
    const { config, problems } = getConfigStatus();
    expect(problems).toEqual([]);
    expect(config?.SEARCH_PROVIDER).toBe("serper");
    expect(config?.MATCH_THRESHOLD).toBe(0.85);
    expect(config?.BATCH_SIZE).toBe(10);
  });
});
