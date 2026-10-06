import type {
  PluginRecord,
  PublishedDocument,
  PublishedRoute,
} from "#instatic-sdk";
import { PublicationService } from "../src/service";
export const origin = "https://example.com";
export const route = (
  path = "/",
  overrides: Partial<PublishedRoute> = {},
): PublishedRoute => ({
  path,
  id: path,
  kind: "page",
  tableSlug: "pages",
  title: "Published title",
  publishedAt: "2026-01-10T12:00:00Z",
  firstPublishedAt: "2025-12-01T12:00:00Z",
  revision: "r1",
  ...overrides,
});
export const document = (
  path = "/",
  html = "<main><h1>Published title</h1><p>Useful public content.</p></main>",
  overrides: Partial<PublishedRoute> = {},
): PublishedDocument => ({
  route: route(path, overrides),
  html:
    '<!doctype html><html lang="en"><head><title>Published title</title></head><body>' +
    html +
    "</body></html>",
  siteName: "Example",
  siteId: "site",
  language: "en",
  revision: "site1",
  version: 1,
});
export function fakeHost(initial = [document()]) {
  let documents = initial,
    revision = "site1",
    failPath = "",
    failRefresh = false;
  const values: Record<string, string | number | boolean> = {
    siteUrl: origin,
    options: "{}",
    llmsEnabled: false,
  };
  const records: PluginRecord[] = [];
  const refreshes: string[][] = [];
  const api: PublicationService["api"] = {
    cms: {
      settings: {
        get<T extends string | number | boolean = string>(key: string) {
          return values[key] as T | undefined;
        },
        getAll: () => ({ ...values }),
        replace: async (next) => {
          for (const [key, value] of Object.entries(next))
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            )
              values[key] = value;
        },
      },
      publication: {
        list: async (options = {}) => {
          if (options.revision && options.revision !== revision)
            throw new Error("Revision changed");
          return {
            routes: documents
              .slice(
                options.offset ?? 0,
                (options.offset ?? 0) + (options.limit ?? 100),
              )
              .map((document) => document.route),
            version: 1,
            revision,
            totalCount: documents.length,
          };
        },
        render: async (options) => {
          if (failPath === options.path)
            throw new Error("Injected render failure");
          if (options.revision && options.revision !== revision)
            throw new Error("Revision changed");
          return (
            documents.find(
              (document) => document.route.path === options.path,
            ) ?? null
          );
        },
        refresh: async ({
          paths,
          origin: refreshOrigin,
          revision: expectedRevision,
        }) => {
          if (
            refreshOrigin !== origin ||
            (expectedRevision && expectedRevision !== revision)
          )
            throw new Error("Invalid refresh context");
          if (failRefresh) throw new Error("Injected refresh failure");
          refreshes.push(paths);
          return { count: paths.length, version: 2 };
        },
      },
      storage: {
        collection: (resourceId) => ({
          list: async (options = {}) => {
            const matches = records.filter(
              (record) =>
                record.resourceId === resourceId &&
                Object.entries(options.filter ?? {}).every(([key, value]) =>
                  typeof value === "object" && value && "ne" in value
                    ? record.data[key] !== value.ne
                    : record.data[key] === value,
                ),
            );
            return {
              records: matches.slice(
                options.offset ?? 0,
                (options.offset ?? 0) + (options.limit ?? 100),
              ),
              totalCount: matches.length,
            };
          },
          create: async (data) => {
            const record = {
              id: crypto.randomUUID(),
              resourceId,
              pluginId: "instatic.seo-geo",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              data,
            };
            records.push(record);
            return record;
          },
          update: async (id, data) => {
            const record = records.find((record) => record.id === id);
            if (!record) return null;
            record.data = data;
            return record;
          },
          delete: async (id) => {
            const index = records.findIndex((record) => record.id === id);
            if (index < 0) return false;
            records.splice(index, 1);
            return true;
          },
        }),
      },
    },
  };
  return {
    api,
    values,
    records,
    refreshes,
    service: new PublicationService(api),
    setDocuments: (next: PublishedDocument[]) => {
      documents = next;
      revision = crypto.randomUUID();
    },
    failRender: (path: string) => {
      failPath = path;
    },
    failRefresh: (value: boolean) => {
      failRefresh = value;
    },
  };
}
export async function complete(service: PublicationService) {
  let result = await service.rebuild();
  for (let i = 0; !result.done && i < 100; i++)
    result = await service.rebuild();
  if (!result.done) throw new Error("Generation did not complete");
  return result;
}
