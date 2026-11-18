import { Type } from "@sinclair/typebox";
import type {
  ServerPluginModule,
  ServerPluginRouteHandler,
} from "#instatic-sdk";
import {
  ConfigurationError,
  parseOptions,
  siteOrigin,
  validate,
} from "../src/config";
import { AnalyticsError } from "../src/analyticsConfig";
import { describeError } from "../src/lifecycle";
import { ContentLimitError, PublicationService } from "../src/service";
import {
  ReportRequestSchema,
  submitIndexNow,
  visibilityReport,
} from "../src/integrations";
import { injectAnalytics, validateAnalytics } from "../src/analytics";
import { parseOgTemplate } from "../src/og/template";
import { LogoUploadSchema } from "../src/og/logo";

const plugin: ServerPluginModule = {
  activate(api) {
    const service = new PublicationService(api);
    // The sandbox console prints only an Error's stack, which has no message.
    const log = (what: string, error: unknown) =>
      console.error(`[plugin:instatic.seo-geo] ${what}: ${describeError(error)}`);
    const guarded =
      (handler: ServerPluginRouteHandler): ServerPluginRouteHandler =>
      async (context) => {
        try {
          return await handler(context);
        } catch (error) {
          log("Request failed", error);
          return {
            __response: true,
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
            body: JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "SEO operation failed.",
              // Stable for scripts and agents; the message is for people.
              code:
                error instanceof ConfigurationError ||
                error instanceof AnalyticsError
                  ? "invalid-settings"
                  : error instanceof ContentLimitError
                    ? "content-limit"
                    : "operation-failed",
            }),
          };
        }
      };
    api.cms.routes.get(
      "/pages",
      "plugins.read",
      guarded(async () =>
        (await service.inventory()).routes.map((route) => ({
          path: route.path,
          title: route.title ?? route.path,
          kind: route.kind,
          tableSlug: route.tableSlug ?? "",
        })),
      ),
    );
    api.cms.routes.get(
      "/status",
      "plugins.read",
      guarded(async () => ({
        pluginId: api.plugin.id,
        version: api.plugin.version,
        official: false,
        channel: "beta",
        features: {
          markdown: true,
          sitemap: true,
          structuredData: true,
          contentZip: true,
          diagnostics: true,
          redirects: true,
          crawlerPolicies: true,
          hreflang: true,
          specializedSchema: true,
          indexNow: true,
          visibilityReports: true,
          aio: true,
          guidedConfiguration: true,
        },
        ...(await service.status()),
      })),
    );
    api.cms.routes.post(
      "/configure",
      "plugins.configure",
      guarded(async ({ req }) => {
        const input = validate(
          Type.Object(
            {
              siteUrl: Type.String(),
              options: Type.String(),
              llmsEnabled: Type.Boolean(),
              analytics: Type.Optional(Type.String()),
              ogTemplate: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
          await req.json(),
        );
        // A blank address is allowed: settings can be saved before setup.
        input.siteUrl = input.siteUrl.trim();
        if (input.siteUrl) siteOrigin(input.siteUrl);
        parseOptions(input.options);
        if (input.analytics !== undefined)
          input.analytics = JSON.stringify(validateAnalytics(input.analytics));
        if (input.ogTemplate !== undefined)
          input.ogTemplate = JSON.stringify(parseOgTemplate(input.ogTemplate));
        await api.cms.settings.replace({
          ...api.cms.settings.getAll(),
          ...input,
        });
        return { ok: true };
      }),
    );
    api.cms.routes.post(
      "/generate",
      "plugins.configure",
      guarded(async ({ req }) => {
        const input = validate(
          Type.Object(
            {
              force: Type.Optional(Type.Boolean()),
              /** Sent by admin pages that understand `busy` and `deferred` results. */
              client: Type.Optional(Type.Integer()),
            },
            { additionalProperties: false },
          ),
          await req.json(),
        );
        const result = await service.rebuild(input.force);
        // A tab opened before an upgrade runs the old loop, which reads a
        // waiting result as a stalled generation. Give it the error it knows.
        if ((result.busy || result.deferred) && !input.client)
          throw new Error(
            result.busy
              ? "A generation batch is already running; retry shortly."
              : "Social images are being created in the background. Reload this page to follow the progress.",
          );
        if (result.done) await service.recordSnapshot(true);
        return result;
      }),
    );
    api.cms.routes.post(
      "/og-logo",
      "plugins.configure",
      guarded(async ({ req }) =>
        service.saveLogo(validate(LogoUploadSchema, await req.json())),
      ),
    );
    api.cms.routes.get(
      "/og-logo",
      "plugins.read",
      guarded(async ({ req }) => ({
        logo: await service.logo(new URL(req.url).searchParams.get("hash") ?? ""),
      })),
    );
    api.cms.routes.get(
      "/history",
      "plugins.read",
      guarded(() => service.history()),
    );
    api.cms.routes.get(
      "/download",
      "plugins.read",
      guarded(() => service.download()),
    );
    api.cms.routes.post(
      "/indexnow",
      "plugins.configure",
      guarded(() => submitIndexNow(api, service, true)),
    );
    api.cms.routes.post(
      "/report",
      "plugins.read",
      guarded(async ({ req }) => {
        const report = await visibilityReport(
          api,
          validate(ReportRequestSchema, await req.json()),
        );
        await service.saveReport(report);
        return report;
      }),
    );
    api.cms.routes.get(
      "/report",
      "plugins.read",
      guarded(async ({ req }) => {
        const provider = new URL(req.url).searchParams.get("provider");
        if (provider !== "google" && provider !== "bing")
          throw new Error("Choose Google Search Console or Bing Webmaster.");
        return { report: await service.lastReport(provider) };
      }),
    );
    api.cms.routes.site.get(
      "/*",
      guarded(({ req }) => service.publicFile(new URL(req.url).pathname)),
    );
    api.cms.hooks.on("publication.changed", () => service.invalidate());
    api.cms.hooks.on("settings.changed", () => service.invalidate());
    api.cms.hooks.filter("publish.html", async (html, context) => {
      // The host drops everything this filter did when it throws, so each
      // part fails on its own: a broken tag must not cost a page its metadata.
      let enriched = html;
      try {
        enriched = await service.enrich(html, context);
      } catch (error) {
        log(`Page metadata for ${context.urlPath}`, error);
      }
      try {
        return await injectAnalytics(
          enriched,
          validateAnalytics(api.cms.settings.get("analytics")),
        );
      } catch (error) {
        log(`Analytics tags for ${context.urlPath}`, error);
        return enriched;
      }
    });
    api.cms.schedule.register({
      id: "publication-sync",
      cadence: { interval: "every", minutes: 1 },
      overlap: "skip",
      maxDurationMs: 300000,
      handler: async () => {
        // Each part is independent: the host pauses a schedule whose handler
        // fails five times, and one broken part must not stop the others.
        const part = async (what: string, run: () => Promise<unknown>) => {
          try {
            await run();
          } catch (error) {
            log(`Scheduled ${what}`, error);
          }
        };
        await part("heartbeat", () => service.heartbeat("schedule"));
        if (!api.cms.settings.get("siteUrl")) return;
        let done = false;
        await part("generation", async () => {
          // Stop well before the next run so the admin page can take a turn.
          const deadline = Date.now() + 45000;
          let result = await service.rebuild(false, "schedule");
          while (!result.done && !result.busy && Date.now() < deadline)
            result = await service.rebuild(false, "schedule");
          done = result.done;
        });
        if (!done) return;
        await part("health snapshot", () => service.recordSnapshot());
        await part("IndexNow submission", () => submitIndexNow(api, service));
        await part("cleanup", () => service.cleanup());
      },
    });
  },
};
export default plugin;
