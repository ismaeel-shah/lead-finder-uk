import { describe, expect, it } from "vitest";
import { isValidSession, safeEqual, safeNextPath, sessionToken } from "@/lib/auth";

describe("auth", () => {
  it("derives a stable token that changes with the password", async () => {
    const a = await sessionToken("secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionToken("secret")).toBe(a);
    expect(await sessionToken("other")).not.toBe(a);
    expect(a).not.toContain("secret");
  });

  it("validates session cookies", async () => {
    expect(await isValidSession(await sessionToken("secret"), "secret")).toBe(true);
    expect(await isValidSession(await sessionToken("old"), "secret")).toBe(false);
    expect(await isValidSession(undefined, "secret")).toBe(false);
    expect(await isValidSession("", "secret")).toBe(false);
  });

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("only redirects to local paths", () => {
    expect(safeNextPath("/?job=1")).toBe("/?job=1");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
