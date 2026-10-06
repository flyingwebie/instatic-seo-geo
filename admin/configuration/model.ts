import {
  normalizePath,
  parseOptions,
  type PageOptions,
  type SiteOptions,
} from "../../src/config";

export function patchValues<T extends object>(value: T, patch: Partial<T>): T {
  const next = { ...value, ...patch };
  for (const key of Object.keys(next) as (keyof T)[])
    if (next[key] === undefined) delete next[key];
  return next;
}
export function updatePage(
  options: SiteOptions,
  path: string,
  patch: Partial<PageOptions>,
): SiteOptions {
  return {
    ...options,
    pages: {
      ...options.pages,
      [path]: patchValues(options.pages?.[path] ?? {}, patch),
    },
  };
}
export function addPage(
  options: SiteOptions,
  path: string,
): { options: SiteOptions; path: string } {
  const normalized = normalizePath(path.trim());
  return { path: normalized, options: updatePage(options, normalized, {}) };
}
export function removeProfile(options: SiteOptions, id: string): SiteOptions {
  return patchValues(options, {
    profiles: options.profiles?.filter((profile) => profile.id !== id),
    publisher: options.publisher === id ? undefined : options.publisher,
    pages: Object.fromEntries(
      Object.entries(options.pages ?? {}).map(([path, page]) => [
        path,
        page.authors
          ? { ...page, authors: page.authors.filter((author) => author !== id) }
          : page,
      ]),
    ),
  });
}
export const optionalText = (value: string): string | undefined =>
  value.trim() ? value : undefined;
export const lines = (value: string): string[] =>
  value
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
export const serializeOptions = (options: SiteOptions): string =>
  JSON.stringify(parseOptions(JSON.stringify(options)), null, 2);
export function initialConfiguration(raw: string): {
  value: SiteOptions;
  error: string;
} {
  try {
    return { value: parseOptions(raw), error: "" };
  } catch (error) {
    return {
      value: {},
      error: error instanceof Error ? error.message : "Invalid configuration",
    };
  }
}
export type FormProps = {
  value: SiteOptions;
  onChange: (value: SiteOptions) => void;
  disabled: boolean;
};
