import { Type, type Static } from "@sinclair/typebox";
import type { ServerPluginApi } from "#instatic-sdk";
import { siteOrigin, validate } from "./config";
import type { PublicationService } from "./service";
type SettingsApi = { cms: Pick<ServerPluginApi["cms"], "settings"> };

export const ReportRequestSchema = Type.Object(
  {
    provider: Type.Union([Type.Literal("google"), Type.Literal("bing")]),
    startDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    endDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  },
  { additionalProperties: false },
);
export type ReportRequest = Static<typeof ReportRequestSchema>;
export const VisibilityReportSchema = Type.Object({
  provider: Type.String(),
  fetchedAt: Type.String(),
  startDate: Type.String(),
  endDate: Type.String(),
  limitation: Type.String(),
  rows: Type.Array(
    Type.Object({
      label: Type.String(),
      clicks: Type.Number(),
      impressions: Type.Number(),
      ctr: Type.Number(),
      position: Type.Number(),
      date: Type.Optional(Type.String()),
    }),
  ),
});

async function providerFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      "Provider connection failed. Check outbound permission and credentials; no request details are exposed.",
    );
  }
}

/** Never echo provider error bodies or request URLs containing credentials. */
async function checked(response: Response, provider: string) {
  if (!response.ok)
    throw new Error(
      `${provider} request failed (HTTP ${response.status}). Check the credentials, property access, quota, and date range in plugin settings.`,
    );
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024)
    throw new Error(`${provider} response exceeds the alpha report budget.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${provider} returned invalid JSON.`);
  }
}

export function submitIndexNow(
  api: SettingsApi,
  service: PublicationService,
  manual = false,
) {
  return service.serializeIndexNow(() =>
    submitIndexNowUnlocked(api, service, manual),
  );
}

async function submitIndexNowUnlocked(
  api: SettingsApi,
  service: PublicationService,
  manual = false,
) {
  if (api.cms.settings.get<boolean>("indexNowEnabled") !== true)
    return { enabled: false, submitted: 0, remaining: 0, status: 0 };
  const origin = siteOrigin(api.cms.settings.get("siteUrl") ?? "");
  const key = api.cms.settings.get("indexNowKey") ?? "";
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key))
    throw new Error(
      "IndexNow key must contain 8–128 letters, digits, or hyphens.",
    );
  const queue = await service.indexNowQueue();
  const urls = queue.urls.filter((url) => new URL(url).origin === origin);
  if (!urls.length || (!manual && queue.nextAttempt > Date.now()))
    return { enabled: true, submitted: 0, remaining: urls.length, status: 0 };
  const batch = urls.slice(0, 10000);
  let response: Response;
  try {
    response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: new URL(origin).host,
        key,
        keyLocation: origin + "/" + key + ".txt",
        urlList: batch,
      }),
    });
  } catch {
    await service.saveIndexNowQueue({
      urls,
      attempts: queue.attempts + 1,
      nextAttempt:
        Date.now() +
        Math.min(86400000, 60000 * 2 ** Math.min(queue.attempts, 10)),
    });
    throw new Error(
      "IndexNow could not be reached. Changes remain queued for retry.",
    );
  }
  if (response.status === 200 || response.status === 202) {
    await service.saveIndexNowQueue({
      urls: urls.slice(batch.length),
      attempts: 0,
      nextAttempt: 0,
    });
    return {
      enabled: true,
      submitted: batch.length,
      remaining: urls.length - batch.length,
      status: response.status,
    };
  }
  const retry = response.headers.get("Retry-After");
  const delay =
    retry && /^\d+$/.test(retry)
      ? Number(retry) * 1000
      : retry && !Number.isNaN(Date.parse(retry))
        ? Math.max(60000, Date.parse(retry) - Date.now())
        : Math.min(86400000, 60000 * 2 ** Math.min(queue.attempts, 10));
  await service.saveIndexNowQueue({
    urls,
    attempts: queue.attempts + 1,
    nextAttempt: Date.now() + Math.min(86400000, Math.max(60000, delay)),
  });
  throw new Error(
    `IndexNow rejected the submission (HTTP ${response.status}). URLs remain queued; check key ownership or retry after rate limits.`,
  );
}

function validReportDate(value: string): boolean {
  const parsed = Date.parse(value);
  return (
    !Number.isNaN(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

export async function visibilityReport(
  api: SettingsApi,
  request: ReportRequest,
): Promise<Static<typeof VisibilityReportSchema>> {
  const { startDate, endDate, provider } = request;
  if (
    !validReportDate(startDate) ||
    !validReportDate(endDate) ||
    startDate > endDate
  )
    throw new Error("Use a valid start date on or before the end date.");
  const origin = siteOrigin(api.cms.settings.get("siteUrl") ?? "");
  let rows: Static<typeof VisibilityReportSchema>["rows"];
  if (provider === "google") {
    let token = api.cms.settings.get("googleAccessToken") ?? "";
    const refreshToken = api.cms.settings.get("googleRefreshToken") ?? "";
    if (refreshToken) {
      const clientId = api.cms.settings.get("googleClientId") ?? "",
        clientSecret = api.cms.settings.get("googleClientSecret") ?? "";
      if (!clientId || !clientSecret)
        throw new Error(
          "Google refresh credentials need both client ID and client secret.",
        );
      const result = validate(
        Type.Object({ access_token: Type.String() }),
        await checked(
          await providerFetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }).toString(),
          }),
          "Google OAuth",
        ),
      );
      token = result.access_token;
    }
    if (!token)
      throw new Error(
        "Configure a Google Search Console access token or OAuth refresh credentials in plugin settings.",
      );
    const property = api.cms.settings.get("googleProperty") || origin + "/";
    if (!(
      property === "sc-domain:" + new URL(origin).hostname ||
      property === origin + "/"
    ))
      throw new Error(
        "Search Console property must match this website origin or its sc-domain property.",
      );
    const response = await providerFetch(
      "https://www.googleapis.com/webmasters/v3/sites/" +
        encodeURIComponent(property) +
        "/searchAnalytics/query",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["page", "query"],
          rowLimit: 1000,
          type: "web",
        }),
      },
    );
    const result = validate(
      Type.Object({
        rows: Type.Optional(
          Type.Array(
            Type.Object({
              keys: Type.Array(Type.String()),
              clicks: Type.Number(),
              impressions: Type.Number(),
              ctr: Type.Number(),
              position: Type.Number(),
            }),
          ),
        ),
      }),
      await checked(response, "Search Console"),
    );
    rows = (result.rows ?? []).map((row) => ({
      label: row.keys.join(" · "),
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));
  } else {
    const key = api.cms.settings.get("bingApiKey") ?? "";
    if (!key)
      throw new Error("Configure a Bing Webmaster API key in plugin settings.");
    const url = new URL(
      "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats",
    );
    url.search = new URLSearchParams({
      siteUrl: origin + "/",
      apikey: key,
    }).toString();
    const result = validate(
      Type.Object({
        d: Type.Array(
          Type.Object({
            Query: Type.String(),
            Clicks: Type.Number(),
            Impressions: Type.Number(),
            AvgImpressionPosition: Type.Number(),
            Date: Type.String(),
          }),
        ),
      }),
      await checked(await providerFetch(url.href), "Bing Webmaster"),
    );
    rows = result.d
      .map((row) => {
        const ms = /^\/Date\((\d+)(?:[+-]\d+)?\)\/$/.exec(row.Date)?.[1];
        const date = new Date(ms ? Number(ms) : row.Date)
          .toISOString()
          .slice(0, 10);
        return {
          label: row.Query,
          clicks: row.Clicks,
          impressions: row.Impressions,
          ctr: row.Impressions ? row.Clicks / row.Impressions : 0,
          position: row.AvgImpressionPosition,
          date,
        };
      })
      .filter((row) => row.date! >= startDate && row.date! <= endDate)
      .slice(0, 1000);
  }
  return {
    provider,
    fetchedAt: new Date().toISOString(),
    startDate,
    endDate,
    rows,
    limitation:
      provider === "google"
        ? "Up to 1,000 top page/query rows. Search Console does not return every query. These are web-search metrics, not AI citation counts."
        : "Up to 1,000 available query/date rows within the requested range. Bing retention and property access limit coverage; missing data is not a measured zero.",
  };
}
