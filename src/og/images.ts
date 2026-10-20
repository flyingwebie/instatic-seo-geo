import { fingerprint, type GeneratedPage } from "../page";
import { encodePng } from "./png";
import { renderOg } from "./render";
import type { Bitmap } from "./raster";
import {
  OG_RENDERER_VERSION,
  ogData,
  resolveTemplate,
  type OgData,
  type OgTemplate,
  type ResolvedTemplate,
} from "./template";

export const OG_PATH = /^\/og\/([a-f0-9]{24})\.png$/;

/** Whether a page shows the generated image instead of its own. */
export function usesGenerated(template: ResolvedTemplate, page: Pick<GeneratedPage, "socialImage">) {
  if (!template.enabled) return false;
  const source = page.socialImage ?? "none";
  // A per-page image chosen in Pages always wins.
  if (source === "authored") return false;
  return template.mode === "always" || source === "content" || source === "none";
}

/**
 * Content-addressed file name: it changes whenever the design or the page's
 * text changes, so social networks never keep showing a stale card.
 */
export async function ogKey(template: ResolvedTemplate, data: OgData): Promise<string> {
  const { enabled: _enabled, mode: _mode, ...design } = template;
  return (await fingerprint({ v: OG_RENDERER_VERSION, design, data })).slice(0, 24);
}

export type OgJob = { key: string; data: OgData; path: string };

/** The images a generation needs, one per page that uses a generated card. */
export async function ogJobs(
  raw: OgTemplate,
  pages: readonly GeneratedPage[],
  siteName: string,
  sections: ReadonlyMap<string, string>,
): Promise<OgJob[]> {
  const template = resolveTemplate(raw);
  const jobs: OgJob[] = [];
  for (const page of pages) {
    if (!usesGenerated(template, page)) continue;
    const data = ogData(template, { ...page, tableSlug: sections.get(page.id) }, siteName);
    jobs.push({ key: await ogKey(template, data), data, path: page.path });
  }
  return jobs;
}

export function renderOgPng(raw: OgTemplate, data: OgData, logo?: Bitmap): Uint8Array {
  return encodePng(renderOg(resolveTemplate(raw), data, logo));
}

export { fromBase64, toBase64 } from "./base64";
