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
            },
            { additionalProperties: false },
          ),
          await req.json(),
        );
        siteOrigin(input.siteUrl);
        parseOptions(input.options);
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
        return await service.rebuild(input.force);
      }),
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
      guarded(async ({ req }) =>
        visibilityReport(api, validate(ReportRequestSchema, await req.json())),
      ),
    );
    api.cms.routes.site.get(
      "/*",
      guarded(({ req }) => service.publicFile(new URL(req.url).pathname)),
    );
    api.cms.hooks.on("publication.changed", () => service.invalidate());
    api.cms.hooks.on("settings.changed", () => service.invalidate());
    api.cms.hooks.filter("publish.html", (html, context) =>
      service.enrich(html, context),
    );
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
