# Configuration guide

This is an **unofficial alpha-test plugin**. Install the ZIP on the tested compatible host, then open **SEO, GEO & AIO**. Everyday setup uses labelled fields, switches and example placeholders; no JSON is required.

## Guided setup

1. **Website:** enter the public website origin, for example `https://www.example.com`. Use the domain serving public pages, even if administration runs on another subdomain. Select optional `llms.txt` and add public collection table slugs one per line. Blank collections use `posts`.
2. **Pages:** select a published page or add a site-relative path such as `/services/web-design`. Enable **Custom page metadata** only to override published values. Blank optional fields preserve published metadata. Choose indexing, following and snippet preferences separately.
3. **Business & authors:** add real people or organisations with names, profile URLs, logos/portraits and official social links. Select the website publisher. Then select visible article authors in **Pages**; profile IDs are managed automatically.
4. **Pages → structured data:** choose Article/BlogPosting/NewsArticle as appropriate. Enable FAQs and copy their visible questions/answers. Automatic breadcrumbs work by default; custom breadcrumbs and Product/Event/LocalBusiness/VideoObject have guided fields. Required facts must appear on the page. [Google retired FAQ rich results in May 2026](https://developers.google.com/search/updates#may-2026); FAQ schema remains a semantic description of visible content.
5. **Redirects:** enable the section and add old/new paths with a permanent 301 or 308 response. The destination must be published and eligible.
6. **Languages:** group the published versions of the same content. Enter paths and language tags, such as `/services` + `en-IE`, and `/fr/services` + `fr`. Set matching page languages in **Pages**.
7. **Crawlers:** choose search, training and user-requested retrieval access independently. Training is disabled by default. Excluded paths remove discovery exports; they do not make HTML private or automatically add `noindex`. For search removal, set the page's indexing preference deliberately.
8. **AIO:** enable local publication checks. In **Pages**, optionally enter the primary question/topic and copy a preferred answer paragraph already published in the CMS.
9. Click **Save settings** to store configuration, or **Save & generate** to update discovery outputs and published HTML. The foreground pause button stops further browser batches after the current request. Automatic background processing may continue. Progress distinguishes document generation from HTML refresh, and unchanged configurations resume saved work.

Missing required values or malformed URLs/paths/dates are shown before saving. The advanced JSON view has explicit **Apply JSON changes** and **Discard JSON draft** buttons; an unapplied draft blocks saving. If existing JSON is invalid, it is preserved for correction instead of being replaced with defaults.

Provider credentials are optional and remain in the host's plugin Settings panel. Basic discovery generation needs none of them.

## AIO checks and snippet controls

AIO means AI Overview optimisation here. [Google's documentation](https://developers.google.com/search/docs/appearance/ai-features) states that existing SEO best practices apply to AI Overviews/AI Mode, with no special Schema.org type or extra AI text file required. Supporting links must be indexed and eligible for snippets; the plugin cannot verify actual indexing or guarantee an AI citation.

The per-page review checks local canonical/indexing/crawler/snippet controls, a readable answer paragraph, topic headings, external source links, and visible configured authors with publication dates. The default answer candidate length of 40–600 characters is an editorial heuristic, not a search engine requirement. External links do not prove source quality. Missing bylines or sources may be reasonable for some page types; review the advice in context.

`aioEnabled` defaults to enabled. Per-page `aioQuestion` and `aioAnswer` are editorial briefs only: they never add text or AI-specific schema. A preferred answer must occur in a snippet-accessible visible paragraph; hidden content, request-dependent holes and `data-nosnippet` passages are excluded from answer candidates.

Per-page `snippetAllowed` can explicitly set/remove generic `nosnippet`; allowing snippets also removes an inherited generic `max-snippet` limit unless you supply a new `maxSnippet`. `maxSnippet` accepts a whole number: `-1` means unlimited, `0` disables text snippets, and positive values cap length. Omit these fields to preserve authored controls. Existing crawler-specific metadata, `data-nosnippet`, preview, archive and expiration directives remain intact. Local checks inspect published HTML and this plugin’s crawler preferences; they do not verify deployment-level HTTP headers or actual crawler access. A blocked snippet check does not automatically remove an otherwise indexable canonical page from the sitemap.

After upgrading from a prior plugin generation format, generate again to refresh reports and exports. AIO reports appear only for the current completed generation. Search Console's Web totals include AI feature traffic; they do not provide a universal AI citation count.

## Advanced configuration reference

Published pages are included automatically. Collection entries default to the public `posts` table; explicitly opt other public tables into `collectionTables`. Templates, layout/component definitions, drafts, preview branches, hidden content, and visitor-specific holes are never content exports. Important content in dynamic fragments produces a diagnostic.

The optional advanced JSON editor supports this example (use your real names, URLs, content, and dates):

```json
{
  "aioEnabled": true,
  "collectionTables": ["posts", "guides"],
  "searchAllowed": true,
  "trainingAllowed": false,
  "userRetrievalAllowed": true,
  "excludedPaths": ["/thank-you"],
  "publisher": "publisher",
  "profiles": [
    {
      "id": "publisher",
      "type": "Organization",
      "name": "Example Publishing",
      "url": "https://example.com"
    },
    {
      "id": "author",
      "type": "Person",
      "name": "Jane Example",
      "url": "https://example.com/authors/jane"
    }
  ],
  "pages": {
    "/posts/example": {
      "title": "A useful article title",
      "aioQuestion": "What does this do?",
      "aioAnswer": "It describes the visible published content.",
      "snippetAllowed": true,
      "maxSnippet": -1,
      "description": "An accurate description of the published article.",
      "articleType": "BlogPosting",
      "authors": ["author"],
      "image": "https://example.com/uploads/article.jpg",
      "faqs": [
        {
          "question": "What does this do?",
          "answer": "It describes the visible published content."
        }
      ],
      "breadcrumbs": [
        { "name": "Home", "path": "/" },
        { "name": "Example article", "path": "/posts/example" }
      ]
    },
    "/fr/exemple": { "language": "fr" }
  },
  "translations": [
    [
      { "path": "/posts/example", "language": "en" },
      { "path": "/fr/exemple", "language": "fr" }
    ]
  ],
  "redirects": [
    { "from": "/old-article", "to": "/posts/example", "status": 301 }
  ]
}
```

Omit a page field to preserve the corresponding authored HTML metadata. Explicit plugin overrides win; existing title/description/canonical/robots follow; published title and visible-content descriptions supply the fallback. `index` and `follow` accept booleans. Excluded/noindex pages remain crawlable so search crawlers can read their noindex directive; CSS, JavaScript, and uploaded public media remain crawlable. Only self-canonical, indexable, allowed pages enter public Markdown, sitemaps, llms.txt, and ZIP exports. Cross-domain canonicals are retained as authored metadata and excluded from discovery.

Dates use actual ISO publication/modification dates. The host provides first/current publication times; unchanged normalized content retains its prior modification date. Do not set dates to the current time merely to suggest freshness. Author schema needs a real configured profile and visible byline. FAQ questions and answers must appear in visible content. Existing valid JSON-LD is reconciled with generated primary entities; authored facts win. Invalid authored JSON-LD stays in the HTML and produces an error finding.

Translation groups are shared by every member, so valid HTML/sitemap links are reciprocal and self-inclusive. Each path belongs to one group, language tags are distinct, and every member must be published, indexable, self-canonical, and have the matching page language. Invalid groups produce diagnostics and do not emit alternate links. `x-default` is supported.

Redirects accept site-relative paths and 301/308 status. Stable published IDs also generate redirects on route renames. Chains resolve to a currently eligible destination; cycles fail generation, external targets are rejected, and published source pages win over redirects. Retracted targets stop redirecting immediately. Existing published pages/assets always win over plugin discovery files; route collisions appear in diagnostics.

## Specialized Schema.org

Add `schemas` to a page's options. Supported typed objects:

| `type`          | Required real fields                                | Optional fields                                                                                                                      |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Product`       | `name`                                              | `description`, `image`, `sku`, `price` (decimal string), `currency` (ISO code), `availability` (`InStock`, `OutOfStock`, `PreOrder`) |
| `Event`         | `name`, `startDate`, `locationName`, `address`      | `endDate`, `description`, `image`                                                                                                    |
| `LocalBusiness` | `name`, `address`                                   | `telephone`, `image`, `priceRange`                                                                                                   |
| `VideoObject`   | `name`, `description`, `thumbnailUrl`, `uploadDate` | `contentUrl`, `embedUrl`, ISO `duration`                                                                                             |

Entity names, business/event locations, and offered prices must be visible on the page. Videos need a configured content/embed URL matching a real video/source/iframe in the published page. Date and URL fields are validated. The plugin never invents reviews, ratings, authors, event dates, business details, or prices. Supplying semantic Schema.org does not guarantee a provider's rich-result eligibility.

## IndexNow and webmaster reports

Configure integrations in the host's plugin **Settings** panel. They remain optional.

- **IndexNow:** enable submission and set an 8–128-character ownership key containing letters, digits, or hyphens. The plugin serves `/<key>.txt`. Completed generations queue added/changed/removed canonical URLs. A one-minute job submits batches of at most 10,000, retains rejected changes, and honors retry delays. The admin button retries explicitly. HTTP 200/202 means receipt/validation, not indexing.
- **Google Search Console:** use a `webmasters.readonly` access token, or a client ID/client secret/refresh token. Set the URL-origin property (`https://example.com/`) or matching `sc-domain:example.com`. Fetch reports for a date range in the admin app. The alpha report shows up to 1,000 top page/query rows.
- **Bing Webmaster:** provide your API key for the verified website origin. Reports show up to 1,000 available query/date rows within the requested range. Provider retention limits still apply.

Google access tokens, client secrets, refresh tokens, and Bing keys use Instatic's encrypted secret settings. They are read only by the server sandbox. Browser settings show masks, and report/error responses exclude credentials. The IndexNow ownership key is deliberately public. Outbound access is confined to `api.indexnow.org`, `www.googleapis.com`, `oauth2.googleapis.com`, and `ssl.bing.com`.

These reports measure ordinary search activity. AI citation activity requires separately observed evidence; the plugin does not fabricate a universal AI citation metric. Robots preferences are voluntary and do not replace authentication. Search, training, and user retrieval settings produce separate provider groups; some user-triggered agents may not honor robots restrictions. llms.txt is optional interoperability, with no promised search benefit.

## Outputs and alpha budgets

`/sitemap.xml` contains canonical HTML URLs; it becomes an index when URL sets exceed 50,000 entries or 50 MiB uncompressed UTF-8. Partitions live at `/sitemaps/1.xml`, etc. The homepage Markdown is `/markdown/index.md`; nested routes use `/markdown/<route>/index.md`. Eligible HTML advertises its generated Markdown through a `rel="alternate" type="text/markdown"` link. Markdown carries `noindex` and a canonical Link header. Discovery responses use `no-store` so retraction is checked on every request.

**Download content ZIP** creates `seo-geo-content.zip` with Markdown, sitemap XML, and `export-manifest.json` mapping each file to its canonical HTML URL and content hash. This differs from `seo-geo.plugin.zip`, which installs the executable plugin.

Generation is resumable in three-route batches and staged in plugin-owned storage. The current pointer is committed only after the complete stage is validated and published HTML refreshed. Failed rebuilds retain the previous generation; current route/configuration checks still retract ineligible content. Schedules resume automatically after restarts. Old stages are cleaned incrementally.

The alpha limits are **1 MiB input HTML per processed page**, **24 MiB serialized generated documents per stage**, and **16 MiB uncompressed content per ZIP**. They protect the host's 64 MiB QuickJS heap and five-second ordinary-call budget. Individual Markdown and partitioned sitemaps remain available when a content ZIP is too large. Limit collection allowlists for larger sites. Processing above these bounds, provider credential provisioning, and real-world ranking outcomes are not certified by this alpha.
