# Implementation roadmap

Build an installable Instatic plugin that improves technical search readiness and derives Markdown, discovery files, and structured data from published content.

## First milestone

Publish one ordinary page and one templated article. Generate matching Markdown, canonical URLs, sitemap entries, and Article JSON-LD. Confirm unpublished page/component/layout edits stay private and unpublishing retracts generated public content.

## Host foundation

Implement these through feature branches and draft PRs in the Instatic repository:

1. Permissioned public artifact serving for root discovery files and Markdown, with route-collision handling.
2. Paginated inventory of actual published routes, including concrete collection entries and homepage mapping.
3. Read-only access to route-resolved published content using published layouts, Visual Components, slots, and deterministic bindings. Avoid recursively applying the plugin's own filters.
4. Full public-path and revision identity in render/filter context.
5. Publication notifications covering full, row, and scheduled publication, deletion, unpublishing, and route changes. Existing `publish.after` is a render hook, not a successful site-publication notification.

Source of truth in the host checkout: `src/core/plugin-sdk/`, `server/plugins/host/`, `server/publish/publishedHtmlPipeline.ts`, `server/publish/publishSite.ts`, and `server/publish/publishRow.ts`.

## Plugin delivery

1. **Published-content generation:** normalized content per route, deterministic Markdown conversion, canonical HTML sitemap entries, meaningful `lastmod`, generation staging, and authenticated content ZIP download.
2. **Metadata and schema:** authored title/description precedence, canonical and robots controls, social metadata, coherent JSON-LD graph for WebSite/WebPage/publisher, articles, visible FAQs, and breadcrumbs. Validate real facts and reconcile existing markup rather than duplicating it.
3. **Publication checks:** indexability preflight, HTML/Markdown/schema consistency, explicit author/publisher profiles, and redirect support for renamed routes. Redirect execution requires host-router support.
4. **Maintenance:** orphan-page detection and internal-link suggestions, authorship/source/freshness checks, performance/media diagnostics, and crawler preferences separating search from model training.
5. **Optional extensions:** llms.txt, IndexNow, multilingual/hreflang validation, specialized business/product/event/video schema, and visibility reports from supported webmaster tools.

Add each permission when a real feature consumes it. Content access remains explicitly allowlisted by table and mode. Use the host SDK without granting arbitrary filesystem access or bypassing it through unstable internals.

## Output contract

- `artifacts/seo-geo.plugin.zip` installs the functionality.
- An authenticated content ZIP separately contains per-route Markdown, sitemap files, and a manifest mapping files to canonical HTML URLs.
- Public HTML remains authoritative. Proposed public outputs are `/sitemap.xml`, `/robots.txt`, and `/markdown/<route>/index.md`; llms.txt is optional.
- Public exports never fall back to draft reads or include preview branches, private fields, component/layout definitions, or personalized fragments.
- Route eligibility is enforced against current publication state, even if an export rebuild fails. Retain the last valid generation without continuing to expose retracted content.
- Respect QuickJS memory/deadline limits; partition sitemaps and batch large exports.
- Diagnose important article content deferred to client-side fragments; Markdown is not a substitute for complete public HTML.

## Verification

For each implemented behavior, add meaningful fixture and integration tests. Cover nested/Unicode routes, templates/slots, unpublished edits, publication/retraction, route renames, concurrent rendering, generation failures, and plugin upgrades.

Run project TypeScript checks, ESLint and SDK lint, build the real ZIP, and verify sandbox activation. Host changes also pass the host's `bun test`, `bun run build`, and `bun run lint` gates. Use local disposable data for authorized browser smoke tests.

## Search expectations

Measure crawling, indexing, organic traffic, conversions, and available AI citation activity separately. Do not promise rankings or universal engine inclusion. Google ignores llms.txt for rankings; FAQPage remains semantic vocabulary but Google's FAQ rich-result feature is retired. See [research.md](research.md) for dated primary sources.
