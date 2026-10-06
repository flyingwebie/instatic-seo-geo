import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import { validate } from "../src/config";
import { fakeHost, document } from "../tests/fixtures";
import { ProgressSchema, StatusSchema } from "../src/adminSchemas";

const hostDir = resolve(process.env.INSTATIC_DIR || "../../Instatic");
const { createPluginVm } = await import(
  pathToFileURL(join(hostDir, "server/plugins/quickjs/vm.ts")).href
);
const { parseApiCall } = await import(
  pathToFileURL(join(hostDir, "server/plugins/protocol/parser.ts")).href
);
const { parsePluginManifest } = await import(
  pathToFileURL(join(hostDir, "src/core/plugins/manifest.ts")).href
);
const manifest = parsePluginManifest(await Bun.file("dist/plugin.json").json());
const archive = Bun.spawnSync([
  "unzip",
  "-p",
  "artifacts/seo-geo.plugin.zip",
  "plugin.json",
]);
assert.equal(archive.exitCode, 0);
assert.deepEqual(
  parsePluginManifest(JSON.parse(archive.stdout.toString())),
  manifest,
);
assert.match(manifest.name, /Unofficial Alpha/);
const source = await Bun.file("dist/server/index.js").text();
const host = fakeHost([
  document("/"),
  document(
    "/posts/alpha",
    "<main><h1>Alpha article</h1><p>Published article body.</p></main>",
    { kind: "entry", tableSlug: "posts" },
  ),
]);
const registrations: string[] = [];
let sequence = 0;
let filterId = "";
const refreshedHtml: string[] = [];
const env = {
  pluginId: manifest.id,
  manifestVersion: manifest.version,
  grantedPermissions: manifest.permissions,
  assetBasePath: "/uploads/plugins/" + manifest.id + "/" + manifest.version,
  settings: host.values,
  async hostCall(target: string, args: unknown[]) {
    const call = parseApiCall({
      kind: "api-call",
      pluginId: manifest.id,
      correlationId: "verify-" + sequence++,
      target,
      args,
    });
    switch (call.target) {
      case "cms.routes.register":
        registrations.push(call.args[0].routeKey);
        return null;
      case "cms.hooks.filter":
        filterId = call.args[0].filterId;
        return null;
      case "cms.hooks.on":
      case "cms.schedule.register":
        return null;
      case "cms.publication.list":
        return host.api.cms.publication.list(call.args[0]);
      case "cms.publication.render":
        return host.api.cms.publication.render(call.args[0]);
      case "cms.publication.refresh": {
        const result = await host.api.cms.publication.refresh(call.args[0]);
        for (const path of call.args[0].paths) {
          const rendered = await host.api.cms.publication.render({
            path,
            origin: call.args[0].origin,
            revision: call.args[0].revision,
          });
          assert.ok(rendered);
          const html = await vm.runHookFilter(filterId, rendered.html, {
            urlPath: path,
            pageId: rendered.route.id,
            contentId: rendered.route.id,
            ...(rendered.route.kind === "entry"
              ? { tableSlug: rendered.route.tableSlug }
              : {}),
            publishedAt: rendered.route.publishedAt,
            firstPublishedAt: rendered.route.firstPublishedAt,
          });
          assert.equal(typeof html, "string");
          refreshedHtml.push(String(html));
        }
        return result;
      }
      case "cms.storage.list":
        return host.api.cms.storage.collection(call.args[0]).list(call.args[1]);
      case "cms.storage.create":
        return host.api.cms.storage
          .collection(call.args[0])
          .create(call.args[1]);
      case "cms.storage.update":
        return host.api.cms.storage
          .collection(call.args[0])
          .update(call.args[1], call.args[2]);
      case "cms.storage.delete":
        return host.api.cms.storage
          .collection(call.args[0])
          .delete(call.args[1]);
      case "crypto.digest": {
        const input = validate(
          Type.Object({ algorithm: Type.String(), data: Type.String() }),
          call.args[0],
        );
        return Buffer.from(
          await crypto.subtle.digest(
            input.algorithm,
            Buffer.from(input.data, "base64"),
          ),
        ).toString("base64");
      }
      default:
        throw new Error("Unexpected sandbox call: " + target);
    }
  },
  log: (args: unknown[]) => {
    throw new Error(
      "Sandbox logged an operation failure: " + JSON.stringify(args),
    );
  },
};
const vm = await createPluginVm({ pluginSource: source, env });
const context = (path: string, method = "GET", body = "") => ({
  request: {
    url: "https://example.com" + path,
    method,
    headers: { "content-type": "application/json" },
    body,
    bodyEncoding: "utf8",
  },
  body: {},
  user: {
    id: "disposable",
    email: "test@example.invalid",
    capabilities: ["plugins.read", "plugins.configure"],
  },
});
try {
  await vm.runLifecycle("activate");
  assert.ok(registrations.includes("SITE:GET:/*"));
  const before = validate(
    StatusSchema,
    await vm.runRoute("GET:/status", context("/status")),
  );
  assert.equal(before.generated, 0);
  let progress = validate(
    ProgressSchema,
    await vm.runRoute("POST:/generate", context("/generate", "POST", "{}")),
  );
  for (let i = 0; !progress.done && i < 20; i++)
    progress = validate(
      ProgressSchema,
      await vm.runRoute("POST:/generate", context("/generate", "POST", "{}")),
    );
  assert.equal(progress.done, true);
  assert.equal(refreshedHtml.length, 2);
  assert.ok(
    refreshedHtml.every(
      (html) =>
        html.includes('rel="canonical"') &&
        html.includes("application/ld+json") &&
        html.includes('type="text/markdown"'),
    ),
  );
  assert.ok(refreshedHtml.some((html) => html.includes('"@type":"Article"')));
  assert.equal(
    validate(StatusSchema, await vm.runRoute("GET:/status", context("/status")))
      .generated,
    2,
  );
  const raw = Type.Object({
    __response: Type.Boolean(),
    status: Type.Number(),
    headers: Type.Record(Type.String(), Type.String()),
    body: Type.String(),
    bodyEncoding: Type.String(),
  });
  const sitemap = validate(
    raw,
    await vm.runRoute("SITE:GET:/*", context("/sitemap.xml")),
  );
  assert.equal(sitemap.status, 200);
  assert.ok(sitemap.body.includes("https://example.com/posts/alpha"));
  const markdown = validate(
    raw,
    await vm.runRoute("SITE:GET:/*", context("/markdown/posts/alpha/index.md")),
  );
  assert.equal(markdown.status, 200);
  assert.ok(markdown.body.includes("Published article body."));
  const zip = validate(
    raw,
    await vm.runRoute("GET:/download", context("/download")),
  );
  assert.equal(zip.bodyEncoding, "base64");
  assert.equal(Buffer.from(zip.body, "base64").subarray(0, 2).toString(), "PK");
  host.setDocuments([document("/")]);
  assert.equal(
    validate(
      raw,
      await vm.runRoute(
        "SITE:GET:/*",
        context("/markdown/posts/alpha/index.md"),
      ),
    ).status,
    404,
  );
} finally {
  vm.dispose();
}
const denied = await createPluginVm({
  pluginSource: source,
  env: { ...env, grantedPermissions: [] },
});
try {
  await assert.rejects(() => denied.runLifecycle("activate"), /permission/i);
} finally {
  denied.dispose();
}
console.info(
  "QuickJS verified: real ZIP/manifest, activation, permission rejection, staged generation, sitemap, Markdown, binary ZIP, and immediate retraction.",
);
