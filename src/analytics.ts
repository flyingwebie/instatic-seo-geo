import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import { elements, isElement, type HtmlElement } from "./html";
import {
  AnalyticsError,
  analyticsActive,
  parseAnalytics,
  snippetHosts,
  type AnalyticsOptions,
} from "./analyticsConfig";

/** Tags that make sense in a pasted tracking snippet. Anything else is a mistake. */
const SNIPPET_TAGS = new Set([
  "script",
  "noscript",
  "img",
  "iframe",
  "link",
  "meta",
  "style",
]);
const GOOGLE_HOSTS = {
  script: ["https://www.googletagmanager.com"],
  connect: [
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://www.googletagmanager.com",
  ],
  img: [
    "https://*.google-analytics.com",
    "https://www.googletagmanager.com",
  ],
  frame: ["https://www.googletagmanager.com"],
};

function fragmentNodes(code: string): DefaultTreeAdapterMap["childNode"][] {
  return parseFragment(code).childNodes;
}

/** Full server-side validation, including the pasted snippet markup. */
export function validateAnalytics(raw: string | undefined): AnalyticsOptions {
  const options = parseAnalytics(raw);
  for (const [field, code] of [
    ["Head code", options.headCode],
    ["Body code", options.bodyCode],
  ] as const) {
    if (!code?.trim()) continue;
    for (const node of fragmentNodes(code)) {
      if (node.nodeName === "#comment") continue;
      if (node.nodeName === "#text") {
        if ("value" in node && node.value.trim())
          throw new AnalyticsError(
            field,
            "Paste the complete snippet, including its <script> tags",
          );
        continue;
      }
      if (isElement(node) && !SNIPPET_TAGS.has(node.tagName))
        throw new AnalyticsError(
          field,
          `<${node.tagName}> is not a tracking tag. Use <script>, <noscript>, <img>, <iframe>, <link>, <meta> or <style>`,
        );
    }
  }
  return options;
}

/** The markup each placement receives plus the CSP sources it needs. */
export function analyticsPlan(options: AnalyticsOptions) {
  const head: string[] = [],
    bodyStart: string[] = [],
    bodyEnd: string[] = [];
  const hosts = {
    script: new Set<string>(),
    connect: new Set<string>(),
    img: new Set<string>(),
    frame: new Set<string>(),
  };
  if (!analyticsActive(options)) return { head, bodyStart, bodyEnd, hosts };
  const google = () => {
    for (const [key, list] of Object.entries(GOOGLE_HOSTS))
      for (const host of list) hosts[key as keyof typeof hosts].add(host);
  };
  const consent = options.consentDefaultDenied
    ? "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});"
    : "";
  if (options.ga4Id) {
    google();
    head.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${options.ga4Id}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}${consent}gtag('js',new Date());gtag('config','${options.ga4Id}');</script>`,
    );
  }
  if (options.gtmId) {
    google();
    if (consent && !options.ga4Id)
      head.push(
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}${consent}</script>`,
      );
    head.push(
      `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${options.gtmId}');</script>`,
    );
    bodyStart.push(
      `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${options.gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
    );
  }
  for (const [code, target] of [
    [options.headCode, head],
    [options.bodyCode, bodyEnd],
  ] as const) {
    if (!code?.trim()) continue;
    target.push(code.trim());
    // Pasted tools load scripts and send beacons to the hosts they mention.
    for (const host of snippetHosts(code))
      for (const set of Object.values(hosts)) set.add(host);
  }
  for (const host of options.allowedHosts ?? [])
    for (const set of Object.values(hosts)) set.add("https://" + host);
  return { head, bodyStart, bodyEnd, hosts };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

function inlineBodies(markup: string[], tag: "script" | "style"): string[] {
  const bodies: string[] = [];
  for (const node of markup.flatMap(fragmentNodes))
    for (const element of elements(node, tag)) {
      if (tag === "script" && element.attrs.some((attr) => attr.name === "src"))
        continue;
      const type = element.attrs.find((attr) => attr.name === "type")?.value;
      // JSON / template payloads never execute, so they need no allowance.
      if (tag === "script" && type && !/javascript|module/i.test(type))
        continue;
      bodies.push(
        element.childNodes
          .map((child) => ("value" in child ? child.value : ""))
          .join(""),
      );
    }
  return bodies;
}

// parse5 always serializes attributes with double quotes.
const CSP_META =
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i;
const MARKER = '<meta name="seo-geo-analytics" content="on">';

function relaxCsp(
  policy: string,
  additions: Record<string, string[]>,
): string {
  const directives = new Map<string, Set<string>>();
  for (const chunk of policy.split(";")) {
    const [name, ...sources] = chunk.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), new Set(sources));
  }
  const fallback = directives.get("default-src");
  for (const [name, sources] of Object.entries(additions)) {
    if (!sources.length) continue;
    const set = directives.get(name) ?? new Set(fallback ?? ["'self'"]);
    const hasHashes = [...set].some((source) =>
      /^'(sha\d{3}|nonce)-/.test(source),
    );
    // Hashes switch off 'unsafe-inline'; keep a page that already allows
    // inline code working instead of narrowing it.
    const allowsInline = set.has("'unsafe-inline'") && !hasHashes;
    set.delete("'none'");
    for (const source of sources)
      if (!(allowsInline && source.startsWith("'sha256-"))) set.add(source);
    directives.set(name, set);
  }
  return [...directives.entries()]
    .filter(([, sources]) => sources.size)
    .map(([name, sources]) => `${name} ${[...sources].join(" ")}`)
    .join("; ")
    .concat(";");
}

function insert(parent: HtmlElement, markup: string[], atStart: boolean) {
  if (!markup.length) return;
  const nodes = fragmentNodes(markup.join("\n"));
  for (const node of nodes) node.parentNode = parent;
  parent.childNodes = atStart
    ? [...nodes, ...parent.childNodes]
    : [...parent.childNodes, ...nodes];
}

/**
 * Add the configured tags to a published page and allow them through the
 * page's Content-Security-Policy (hosts for external files, hashes for the
 * exact inline code), so analytics actually run without loosening the
 * policy for anything else.
 */
export async function injectAnalytics(
  html: string,
  options: AnalyticsOptions,
): Promise<string> {
  const plan = analyticsPlan(options);
  const all = [...plan.head, ...plan.bodyStart, ...plan.bodyEnd];
  if (!all.length) return html;
  if (html.includes(MARKER)) return html;
  const document = parse(html);
  const head = elements(document, "head")[0],
    body = elements(document, "body")[0];
  if (!head || !body) return html;
  insert(head, [MARKER, ...plan.head], false);
  insert(body, plan.bodyStart, true);
  insert(body, plan.bodyEnd, false);
  const scriptHashes = await Promise.all(
    inlineBodies(all, "script").map(sha256),
  );
  const styleHashes = await Promise.all(inlineBodies(all, "style").map(sha256));
  const result = serialize(document);
  return result.replace(CSP_META, (_full, policy: string) => {
    const relaxed = relaxCsp(policy, {
      "script-src": [...plan.hosts.script, ...scriptHashes],
      "connect-src": [...plan.hosts.connect],
      "img-src": [...plan.hosts.img],
      "frame-src": [...plan.hosts.frame],
      "style-src": styleHashes,
    });
    return `<meta http-equiv="Content-Security-Policy" content="${relaxed}">`;
  });
}
