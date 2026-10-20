import { Type } from "@sinclair/typebox";
import type {
  ServerPluginModule,
  ServerPluginRouteHandler,
} from "#instatic-sdk";
import { parseOptions, siteOrigin, validate } from "../src/config";
import { PublicationService } from "../src/service";
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
    const guarded =
      (handler: ServerPluginRouteHandler): ServerPluginRouteHandler =>
      async (context) => {
        try {
          return await handler(context);
        } catch (error) {
          console.error("[plugin:instatic.seo-geo]", error);
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
        channel: "alpha",
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
        siteOrigin(input.siteUrl);
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
            { force: Type.Optional(Type.Boolean()) },
            { additionalProperties: false },
          ),
          await req.json(),
        );
        const result = await service.rebuild(input.force);
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
      const enriched = await service.enrich(html, context);
      let analytics;
      try {
        analytics = validateAnalytics(api.cms.settings.get("analytics"));
      } catch (error) {
        // A broken tag must never break publishing; the admin shows the error.
        console.error("[plugin:instatic.seo-geo] Analytics tags:", error);
        return enriched;
      }
      return injectAnalytics(enriched, analytics);
    });
    api.cms.schedule.register({
      id: "publication-sync",
      cadence: { interval: "every", minutes: 1 },
      overlap: "skip",
      maxDurationMs: 300000,
      handler: async () => {
        if (!api.cms.settings.get("siteUrl")) return;
        try {
          const deadline = Date.now() + 210000;
          let result = await service.rebuild();
          while (!result.done && Date.now() < deadline)
            result = await service.rebuild();
          if (result.done) {
            await service.recordSnapshot();
            await submitIndexNow(api, service);
            await service.cleanup();
          }
        } catch (error) {
          console.error(
            "[plugin:instatic.seo-geo] Scheduled generation:",
            error,
          );
        }
      },
    });
  },
};
export default plugin;
