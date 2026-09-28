import { describe, expect, it, vi } from "vitest";
import { MemorySearchCache } from "@/lib/search/cache";
import { createGoogleCseProvider } from "@/lib/search/googleCse";
import { StaticKeyPool } from "@/lib/search/keys";
import { createSerperProvider, isGoogleMapsLink } from "@/lib/search/serper";
import { OUT_OF_CREDITS_MESSAGE } from "@/lib/search/types";

const noSleep = async () => undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function serper(fetchImpl: FetchMock, cache = new MemorySearchCache()) {
  const usage = { credits: 0 };
  const provider = createSerperProvider({
    apiKey: "serper-key",
    cache,
    usage,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: noSleep,
  });
  return { provider, usage, cache };
}

const body = (fetchImpl: FetchMock, call = 0) => JSON.parse(String(fetchImpl.mock.calls[call]![1]!.body)) as Record<string, unknown>;

describe("Serper provider", () => {
  it("searches Facebook with the suffix-free name in quotes", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      jsonResponse({
        organic: [
          { title: "Acme Plumbing | Facebook", link: "https://www.facebook.com/acmeplumbing", snippet: "Plumbers in Leeds" },
          { title: "No link" },
        ],
      }),
    );
    const { provider, usage } = serper(fetchImpl);
    const results = await provider.searchFacebook("ACME PLUMBING LTD");

    expect(fetchImpl.mock.calls[0]![0]).toBe("https://google.serper.dev/search");
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("serper-key");
    expect(body(fetchImpl)).toEqual({ q: 'site:facebook.com "Acme Plumbing"', gl: "uk", location: "United Kingdom", num: 10 });
    expect(results).toEqual([
      { title: "Acme Plumbing | Facebook", link: "https://www.facebook.com/acmeplumbing", snippet: "Plumbers in Leeds" },
    ]);
    expect(usage.credits).toBe(1);
  });

  it("serves repeat searches from the cache without spending credits", async () => {
    const fetchImpl: FetchMock = vi.fn(async () => jsonResponse({ organic: [] }));
    const { provider, usage } = serper(fetchImpl);
    await provider.searchFacebook("Acme Plumbing Ltd");
    await provider.searchFacebook("ACME PLUMBING LIMITED"); // same query after suffix removal
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(usage.credits).toBe(1);
  });

  it("shares the cache across provider instances (e.g. separate batches)", async () => {
    const cache = new MemorySearchCache();
    const fetchImpl: FetchMock = vi.fn(async () => jsonResponse({ organic: [] }));
    await serper(fetchImpl, cache).provider.searchFacebook("Acme Plumbing");
    const second = serper(fetchImpl, cache);
    await second.provider.searchFacebook("Acme Plumbing");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.usage.credits).toBe(0);
  });

  it("trusts cached empty results for a day only, non-empty ones for 30 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-01T09:00:00Z"));
      const cache = new MemorySearchCache();
      const fetchImpl: FetchMock = vi.fn(async (url: string) =>
        url.endsWith("/places") ? jsonResponse({ places: [] }) : jsonResponse({ organic: [{ title: "Acme | Facebook", link: "https://www.facebook.com/acme" }] }),
      );
      const { provider, usage } = serper(fetchImpl, cache);
      await provider.searchFacebook("Acme"); // 1 credit, non-empty
      await provider.searchBusinessProfile("Acme"); // places + organic fallback, both empty: 2 credits
      expect(usage.credits).toBe(3);

      vi.setSystemTime(new Date("2026-09-01T20:00:00Z")); // same day: everything cached
      await provider.searchFacebook("Acme");
      await provider.searchBusinessProfile("Acme");
      expect(usage.credits).toBe(3);

      vi.setSystemTime(new Date("2026-09-03T09:00:00Z")); // two days later: empties refetched
      await provider.searchFacebook("Acme");
      await provider.searchBusinessProfile("Acme");
      expect(usage.credits).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches when a cached entry is malformed", async () => {
    const cache = new MemorySearchCache();
    await cache.set("serper", "facebook", 'site:facebook.com "Acme" @United Kingdom', { not: "an array" });
    const fetchImpl: FetchMock = vi.fn(async () => jsonResponse({ organic: [] }));
    const { provider, usage } = serper(fetchImpl, cache);
    expect(await provider.searchFacebook("Acme")).toEqual([]);
    expect(usage.credits).toBe(1);
  });

  it("maps places and builds the Maps URL from cid", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      jsonResponse({
        places: [
          {
            title: "Acme Plumbing",
            address: "1 High St, Leeds LS1 1AA",
            cid: "1234567890",
            website: "https://acme.example",
            phoneNumber: "0113 000 0000",
            rating: 4.8,
          },
          { title: "No cid" },
        ],
      }),
    );
    const { provider, usage } = serper(fetchImpl);
    const places = await provider.searchBusinessProfile("Acme Plumbing Ltd");

    expect(fetchImpl.mock.calls[0]![0]).toBe("https://google.serper.dev/places");
    expect(body(fetchImpl)).toEqual({ q: "Acme Plumbing", gl: "uk", location: "United Kingdom" });
    expect(places[0]).toEqual({
      title: "Acme Plumbing",
      address: "1 High St, Leeds LS1 1AA",
      cid: "1234567890",
      mapsUrl: "https://www.google.com/maps?cid=1234567890",
      website: "https://acme.example",
      phoneNumber: "0113 000 0000",
      rating: 4.8,
    });
    expect(places[1]?.mapsUrl).toBeNull();
    expect(usage.credits).toBe(1);
  });

  it("falls back to one organic search when places is empty", async () => {
    const fetchImpl: FetchMock = vi.fn(async (url: string) =>
      url.endsWith("/places")
        ? jsonResponse({ places: [] })
        : jsonResponse({
            knowledgeGraph: { title: "Acme Plumbing", attributes: { Address: "1 High St, Leeds", Phone: "0113 000 0000" } },
            organic: [
              { title: "Acme Plumbing - Google Maps", link: "https://www.google.com/maps/place/Acme+Plumbing/@53.8,-1.5", snippet: "Leeds" },
              { title: "Acme Plumbing", link: "https://acme.example" },
            ],
          }),
    );
    const { provider, usage } = serper(fetchImpl);
    const places = await provider.searchBusinessProfile("Acme Plumbing Ltd");

    expect(body(fetchImpl, 1)).toEqual({ q: '"Acme Plumbing" UK', gl: "uk", location: "United Kingdom", num: 10 });
    expect(places.map((p) => p.title)).toEqual(["Acme Plumbing", "Acme Plumbing"]);
    expect(places[0]).toMatchObject({ address: "1 High St, Leeds", phoneNumber: "0113 000 0000" });
    expect(places[0]?.mapsUrl).toContain("https://www.google.com/maps/search/");
    expect(places[1]?.mapsUrl).toBe("https://www.google.com/maps/place/Acme+Plumbing/@53.8,-1.5");
    expect(usage.credits).toBe(2);

    // Both steps are cached.
    await provider.searchBusinessProfile("Acme Plumbing Ltd");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("drops places outside the UK and falls back to organic search", async () => {
    const fetchImpl: FetchMock = vi.fn(async (url: string) =>
      url.endsWith("/places")
        ? jsonResponse({ places: [{ title: "Precision Plumbing", address: "5 Glen Riddle Rd, Media, PA 19063", cid: "1" }] })
        : jsonResponse({ organic: [] }),
    );
    const { provider, usage } = serper(fetchImpl);
    expect(await provider.searchBusinessProfile("Precision Plumbing SW Ltd")).toEqual([]);
    expect(usage.credits).toBe(2);
  });

  it("ignores a knowledge graph that is not a local business", async () => {
    const fetchImpl: FetchMock = vi.fn(async (url: string) =>
      url.endsWith("/places") ? jsonResponse({}) : jsonResponse({ knowledgeGraph: { title: "Acme", type: "Fictional company" } }),
    );
    expect(await serper(fetchImpl).provider.searchBusinessProfile("Acme")).toEqual([]);
  });

  it("retries 429 / 5xx up to 3 times", async () => {
    let calls = 0;
    const fetchImpl: FetchMock = vi.fn(async () => {
      calls++;
      return calls < 3 ? new Response("", { status: calls === 1 ? 429 : 503 }) : jsonResponse({ organic: [] });
    });
    await serper(fetchImpl).provider.searchFacebook("Acme");
    expect(calls).toBe(3);

    const failing: FetchMock = vi.fn(async () => new Response("", { status: 500 }));
    await expect(serper(failing).provider.searchFacebook("Acme")).rejects.toThrow(/500/);
    expect(failing).toHaveBeenCalledTimes(4);
  });

  it("does not cache or count failed requests", async () => {
    const failing: FetchMock = vi.fn(async () => new Response("", { status: 500 }));
    const { provider, usage, cache } = serper(failing);
    await expect(provider.searchFacebook("Acme")).rejects.toThrow();
    expect(usage.credits).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("recognises an empty Serper account", async () => {
    const fetchImpl: FetchMock = vi.fn(async () => new Response('{"message":"Not enough credits","statusCode":400}', { status: 400 }));
    await expect(serper(fetchImpl).provider.searchFacebook("Acme")).rejects.toThrow(OUT_OF_CREDITS_MESSAGE);
  });

  it("pauses (no usable key) when the only key is rejected", async () => {
    const fetchImpl: FetchMock = vi.fn(async () => new Response("Unauthorized", { status: 403 }));
    await expect(serper(fetchImpl).provider.searchFacebook("Acme")).rejects.toThrow(OUT_OF_CREDITS_MESSAGE);
    expect(OUT_OF_CREDITS_MESSAGE).toMatch(/rejected/);
  });
});

describe("Serper LinkedIn searches", () => {
  it("searches company pages and profiles with the UK location, cached", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      jsonResponse({ organic: [{ title: "Acme Plumbing | LinkedIn", link: "https://uk.linkedin.com/company/acme", snippet: "Leeds" }] }),
    );
    const { provider, usage } = serper(fetchImpl);
    const companies = await provider.searchLinkedInCompany("ACME PLUMBING LTD");
    await provider.searchLinkedInPeople("John Smith", "ACME PLUMBING LTD");

    expect(body(fetchImpl, 0)).toEqual({ q: 'site:linkedin.com/company "Acme Plumbing"', gl: "uk", location: "United Kingdom", num: 10 });
    expect(body(fetchImpl, 1)).toEqual({ q: 'site:linkedin.com/in "John Smith" Acme Plumbing', gl: "uk", location: "United Kingdom", num: 10 });
    expect(companies[0]?.link).toBe("https://uk.linkedin.com/company/acme");
    expect(usage.credits).toBe(2);

    await provider.searchLinkedInCompany("Acme Plumbing Limited");
    expect(usage.credits).toBe(2); // cached
  });
});

describe("Serper key rotation", () => {
  const noCredits = () => new Response('{"message":"Not enough credits","statusCode":400}', { status: 400 });
  const organicOk = () => jsonResponse({ organic: [{ title: "Acme | Facebook", link: "https://www.facebook.com/acme", snippet: "Acme" }] });

  function rotating(fetchImpl: FetchMock, keys: string[]) {
    const pool = new StaticKeyPool(keys);
    const exhausted = vi.spyOn(pool, "reportExhausted");
    const invalid = vi.spyOn(pool, "reportInvalid");
    const usage = { credits: 0 };
    const provider = createSerperProvider({ keys: pool, cache: new MemorySearchCache(), usage, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });
    return { provider, usage, exhausted, invalid };
  }
  const keyOf = (fetchImpl: FetchMock, call: number) => (fetchImpl.mock.calls[call]![1]!.headers as Record<string, string>)["X-API-KEY"];

  it("switches to the next key when one runs out of credits, and keeps using it", async () => {
    const fetchImpl: FetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      (init!.headers as Record<string, string>)["X-API-KEY"] === "key-a" ? noCredits() : organicOk(),
    );
    const { provider, usage, exhausted } = rotating(fetchImpl, ["key-a", "key-b"]);
    expect(await provider.searchFacebook("Acme Ltd")).toHaveLength(1);
    await provider.searchFacebook("Other Ltd");
    expect([0, 1, 2].map((i) => keyOf(fetchImpl, i))).toEqual(["key-a", "key-b", "key-b"]);
    expect(exhausted).toHaveBeenCalledTimes(1);
    expect(usage.credits).toBe(2);
  });

  it("skips a rejected key", async () => {
    const fetchImpl: FetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      (init!.headers as Record<string, string>)["X-API-KEY"] === "bad" ? new Response('{"message":"Unauthorized."}', { status: 403 }) : organicOk(),
    );
    const { provider, invalid } = rotating(fetchImpl, ["bad", "good"]);
    expect(await provider.searchFacebook("Acme Ltd")).toHaveLength(1);
    expect(invalid).toHaveBeenCalledWith("static-0", expect.any(String));
  });

  it("gives up with the pause message only when every key is empty", async () => {
    const fetchImpl: FetchMock = vi.fn(async () => noCredits());
    const { provider, usage } = rotating(fetchImpl, ["key-a", "key-b"]);
    await expect(provider.searchFacebook("Acme Ltd")).rejects.toThrow(OUT_OF_CREDITS_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(usage.credits).toBe(0);
  });
});

describe("isGoogleMapsLink", () => {
  it.each([
    ["https://www.google.com/maps/place/Acme", true],
    ["https://www.google.co.uk/maps?cid=1", true],
    ["https://maps.google.com/?cid=1", true],
    ["https://maps.app.goo.gl/abc", true],
    ["https://www.google.com/search?q=acme", false],
    ["https://acme.example/maps", false],
    ["nonsense", false],
  ])("%s -> %s", (link, expected) => {
    expect(isGoogleMapsLink(link)).toBe(expected);
  });
});

describe("Google Custom Search provider", () => {
  it("searches Facebook via the Custom Search API", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      jsonResponse({ items: [{ title: "Acme Plumbing | Facebook", link: "https://www.facebook.com/acmeplumbing" }] }),
    );
    const usage = { credits: 0 };
    const provider = createGoogleCseProvider({
      apiKey: "k",
      cx: "cx1",
      cache: new MemorySearchCache(),
      usage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    const results = await provider.searchFacebook("Acme Plumbing Ltd");

    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/customsearch/v1");
    expect(url.searchParams.get("q")).toBe('site:facebook.com "Acme Plumbing"');
    expect(url.searchParams.get("cx")).toBe("cx1");
    expect(results).toEqual([{ title: "Acme Plumbing | Facebook", link: "https://www.facebook.com/acmeplumbing", snippet: null }]);
    expect(usage.credits).toBe(1);
  });

  it("returns no Google Business results without calling the API", async () => {
    const fetchImpl: FetchMock = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = createGoogleCseProvider({
      apiKey: "k",
      cx: "cx",
      cache: null,
      usage: { credits: 0 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.searchBusinessProfile("Acme")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
