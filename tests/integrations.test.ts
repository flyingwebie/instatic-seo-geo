import { afterEach, expect, spyOn, test } from "bun:test";
import { complete, document, fakeHost, origin } from "./fixtures";
import { submitIndexNow, visibilityReport } from "../src/integrations";
let fetchSpy: ReturnType<typeof spyOn> | undefined;
function mockFetch(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(handler, { preconnect: () => {} }),
  );
}
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

test("IndexNow publishes a key file, queues additions/removals, and respects retry delays", async () => {
  const host = fakeHost([document("/old")]);
  host.values.indexNowEnabled = true;
  host.values.indexNowKey = "test-key-12345678";
  await complete(host.service);
  expect((await host.service.publicFile("/test-key-12345678.txt")).body).toBe(
    "test-key-12345678",
  );
  const requests: string[] = [];
  fetchSpy = mockFetch(async (_input, init) => {
    requests.push(String(init?.body));
    return new Response("", { status: 429, headers: { "Retry-After": "120" } });
  });
  await expect(submitIndexNow(host.api, host.service)).rejects.toThrow(
    "HTTP 429",
  );
  expect((await host.service.indexNowQueue()).urls).toContain(origin + "/old");
  expect((await submitIndexNow(host.api, host.service)).submitted).toBe(0);
  expect(requests).toHaveLength(1);
  fetchSpy.mockRestore();
  fetchSpy = mockFetch(async () => new Response("", { status: 202 }));
  expect((await submitIndexNow(host.api, host.service, true)).submitted).toBe(
    1,
  );
  host.setDocuments([document("/new")]);
  await complete(host.service);
  expect((await host.service.indexNowQueue()).urls.toSorted()).toEqual([
    origin + "/new",
    origin + "/old",
  ]);
});
test("Google reports validate real-shaped rows and never expose credentials", async () => {
  const host = fakeHost();
  host.values.googleAccessToken = "FAKE_SECRET_TOKEN";
  fetchSpy = mockFetch(async () =>
    Response.json({
      rows: [
        {
          keys: [origin + "/", "example query"],
          clicks: 5,
          impressions: 100,
          ctr: 0.05,
          position: 3,
        },
      ],
    }),
  );
  const report = await visibilityReport(host.api, {
    provider: "google",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  expect(report.rows[0]?.clicks).toBe(5);
  expect(report.rows[0]?.query).toBe("example query");
  expect(report.limitation).toContain("not AI citation counts");
  expect(JSON.stringify(report)).not.toContain("FAKE_SECRET_TOKEN");
  fetchSpy.mockRestore();
  fetchSpy = mockFetch(
    async () => new Response("FAKE_SECRET_TOKEN", { status: 403 }),
  );
  await expect(
    visibilityReport(host.api, {
      provider: "google",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    }),
  ).rejects.toThrow("HTTP 403");
});
test("Bing parses dated query rows and filters the requested date range", async () => {
  const host = fakeHost();
  host.values.bingApiKey = "FAKE_BING_KEY";
  fetchSpy = mockFetch(async () =>
    Response.json({
      d: [
        {
          Query: "example",
          Clicks: 2,
          Impressions: 20,
          AvgImpressionPosition: 4,
          Date: "/Date(" + Date.parse("2026-09-15") + ")/",
        },
        {
          Query: "old",
          Clicks: 9,
          Impressions: 90,
          AvgImpressionPosition: 4,
          Date: "/Date(" + Date.parse("2025-01-01") + ")/",
        },
      ],
    }),
  );
  const report = await visibilityReport(host.api, {
    provider: "bing",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]?.ctr).toBe(0.1);
  expect(report.rows[0]?.date).toBe("2026-09-15");
  expect(JSON.stringify(report)).not.toContain("FAKE_BING_KEY");
});
test("provider failures never echo credential-bearing URLs or malformed responses", async () => {
  const host = fakeHost();
  host.values.bingApiKey = "FAKE_BING_KEY";
  fetchSpy = mockFetch(async () => {
    throw new Error("https://provider.invalid?apikey=FAKE_BING_KEY");
  });
  await expect(
    visibilityReport(host.api, {
      provider: "bing",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    }),
  ).rejects.toThrow("no request details");
  fetchSpy.mockRestore();
  fetchSpy = mockFetch(async () => Response.json({ d: [{ bad: "data" }] }));
  await expect(
    visibilityReport(host.api, {
      provider: "bing",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    }),
  ).rejects.toThrow();
});

test("IndexNow acknowledgement preserves changes generated during an in-flight submission", async () => {
  const host = fakeHost([document("/old")]);
  host.values.indexNowEnabled = true;
  host.values.indexNowKey = "test-key-12345678";
  await complete(host.service);
  let release: () => void = () => {};
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchSpy = mockFetch(async () => {
    started();
    await gate;
    return new Response("", { status: 202 });
  });
  const submission = submitIndexNow(host.api, host.service);
  await ready;
  host.setDocuments([document("/new")]);
  const generation = complete(host.service);
  release();
  await Promise.all([submission, generation]);
  expect((await host.service.indexNowQueue()).urls.toSorted()).toEqual([
    origin + "/new",
    origin + "/old",
  ]);
});
test("report dates reject impossible calendar dates before requesting providers", async () => {
  const host = fakeHost();
  fetchSpy = mockFetch(async () => {
    throw new Error("Unexpected provider call");
  });
  await expect(
    visibilityReport(host.api, {
      provider: "google",
      startDate: "2026-02-30",
      endDate: "2026-03-10",
    }),
  ).rejects.toThrow("valid start date");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("Google reports include a daily series and the previous period totals", async () => {
  const host = fakeHost();
  host.values.googleAccessToken = "FAKE_SECRET_TOKEN";
  const bodies: string[] = [];
  fetchSpy = mockFetch(async (_input, init) => {
    bodies.push(String(init?.body));
    const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
    if (body.dimensions[0] === "date")
      return Response.json({
        rows: [
          { keys: ["2026-08-31"], clicks: 4, impressions: 40, ctr: 0.1, position: 6 },
          { keys: ["2026-09-01"], clicks: 2, impressions: 20, ctr: 0.1, position: 4 },
          { keys: ["2026-09-02"], clicks: 6, impressions: 60, ctr: 0.1, position: 2 },
        ],
      });
    return Response.json({ rows: [] });
  });
  const report = await visibilityReport(host.api, {
    provider: "google",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
  });
  expect(JSON.parse(bodies[1]!).startDate).toBe("2026-08-30");
  expect(report.daily?.map((row) => row.date)).toEqual(["2026-09-01", "2026-09-02"]);
  expect(report.previous?.clicks).toBe(4);
});
