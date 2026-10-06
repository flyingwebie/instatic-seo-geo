# Alpha delivery checklist

Every feature area originally listed in the README has an implementation. This remains **unofficial alpha testing**. Host compatibility, configuration, provider access, and the documented processing budgets matter; implementation is not a claim of rankings or universal indexing.

| Completed area              | Implementation                                                                                                                                | Acceptance evidence                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Guided setup & AIO          | Labelled forms, placeholders, published-page picker, optional advanced JSON; local snippet/answer/source/attribution review                   | `tests/aio.test.ts`; local browser form and save/generate smoke checks; packaged QuickJS verification    |
| Distribution                | GitHub Actions, pinned host/Bun, release identity, ZIP/checksums/build info                                                                   | Release tests; real package build; archive and QuickJS checks in CI                                      |
| Host publication foundation | Typed published-route inventory/raw HTML/revisions, root site routes, refreshes, publication notifications                                    | Host real SQLite publication/privacy/Unicode/retraction test; IPC/security gates; cache-epoch regression |
| Markdown                    | Structured conversion from raw published HTML, code/lists/tables/images/absolute source links, hidden/hole exclusion                          | `tests/content.test.ts`                                                                                  |
| Sitemaps and discovery      | Canonical HTML URLs, meaningful dates, count/UTF-8 byte partitioning, robots, optional llms.txt                                               | Content tests; ZIP canonical mapping; sandbox route checks                                               |
| Metadata and primary schema | Authored precedence, canonical/robots/social tags, WebSite/WebPage/Article family, publisher/visible authors, visible FAQs, breadcrumbs       | Metadata, reconciliation, injection, meaningful-date tests                                               |
| Content ZIP                 | Authenticated deterministic export with Markdown, sitemap XML, and manifest                                                                   | ZIP round-trip test; QuickJS binary response verification                                                |
| Publication safety          | Serialized resumable batches, private stage, commit pointer, HTML refresh, current eligibility, failure recovery, upgrade/restart persistence | `tests/generation.test.ts`; direct QuickJS generation/retraction                                         |
| Preflight/consistency       | Indexability, duplicate metadata, schema/HTML differences, authors/sources/freshness, headings/media/performance                              | Content/audit tests and admin findings UI                                                                |
| Redirects and linking       | 301/308 configuration, stable-ID renames, safe chains/cycle rejection, orphan/unresolved links, related-link suggestions                      | Redirect and lifecycle tests                                                                             |
| Crawler preferences         | Separate search/training/user-retrieval robots groups                                                                                         | Independent policy test; configuration guide with provider limitations                                   |
| Multilingual                | Typed groups, normalized paths, distinct tags, reciprocal/self links, eligibility/language validation                                         | Reciprocal valid-group and noindex-group tests                                                           |
| Specialized Schema.org      | Typed Product/Event/LocalBusiness/VideoObject with visible-entity checks and actual video embedding                                           | Specialized-schema/invalid-date tests                                                                    |
| IndexNow                    | Key file, host-bound changed/deleted URL queue, batches, receipt statuses, retry delay/backoff                                                | Integration tests with synthetic 429/202 responses                                                       |
| Visibility reports          | Google Search Console with access/refresh credentials; Bing query/date metrics; validated responses and provenance                            | Integration tests for provider shapes, date filtering, malformed data, and credential-safe failures      |
| Operator app                | Website setup, generation progress, download, findings, page inventory, linking suggestions, reports, IndexNow control                        | TypeScript/SDK build and host UI runtime parity; compose host primitives/toasts                          |

The first page-and-templated-article milestone is exercised by the built QuickJS package. Host visitor-renderer template/Visual Component/slot tests remain the underlying composition coverage; the plugin does not implement a separate renderer or read drafts.

## Reproducible verification

```sh
bun run setup
bun run test
bun run lint
bun run build
bun run verify:sandbox
```

The compatible host also runs `bun test`, `bun run lint`, and `bun run build`. Tests use isolated SQLite databases and synthetic provider responses. No production content or real provider credentials are included. The admin app has not been certified by a real-browser installation audit in this delivery.

## Operational scope

See [configuration.md](configuration.md) for every supported option, integration setup, outputs, and alpha budgets. Larger-site processing above the limits and actual provider authorization are deployment-specific validation, not advertised completed certifications. Robots preferences are voluntary; AI citation activity needs separately observed evidence. Google/Bing reports do not measure a universal AI ranking or citation metric.

All repository changes go through feature branches and draft PRs. The companion [Instatic host foundation PR #8](https://github.com/flyingwebie/Instatic/pull/8) must be available before installing this plugin build. Public `main` and previously downloaded scaffold ZIPs do not acquire new features until the PRs are merged and a new package is built.
