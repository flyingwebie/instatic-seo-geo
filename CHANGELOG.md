# Changelog

All notable changes to this plugin. Versions follow [Semantic Versioning](https://semver.org/); changing `version` in `package.json` on `main` publishes a GitHub release automatically (see the README's [release section](README.md#automated-builds-and-releases)).

This plugin is **unofficial** and independently maintained.

## [1.0.0-beta.7] - 2026-11-26

### Fixed

- **The sitemap, `llms.txt`, Markdown files and redirects never go blank.** Publishing a page, or saving a setting, used to empty the sitemap (or answer 503) until the next generation finished. If background updates were not running, that could last for hours. The last finished generation now keeps answering until the new one is ready, for every page still published at the same address. A deleted or moved page drops out at once. Only a site that has never been generated answers 503.

### Changed

- **Checks no longer lists pages you hid on purpose.** The page after a form is sent, later pages of a listing, and pages set to "do not index" in Setup → Pages used to appear as "excluded" notes. Only exclusions that may be mistakes are reported now: a robots tag in the page, a canonical pointing elsewhere, or an excluded path.
- **A publish only regenerates the pages that changed.** Pages published unchanged since the last generation, under the same settings, are copied instead of read and rendered again, and only the changed pages get their published HTML refreshed. On a 63-page site, publishing one page now means one render and one refresh instead of 63 of each. Saving settings or changing the website address still regenerates every page.

## [1.0.0-beta.6] - 2026-11-26

### Fixed

- Checks no longer lists every redirect as "Redirect target is missing or excluded" after the site is published again. The redirects kept working (1.0.0-beta.5), but Checks still used the stricter rule for exports and showed one error per redirect until the next generation. Checks now uses the same rule as the live redirects: the destination must still be published at the same address.

## [1.0.0-beta.5] - 2026-11-26

### Fixed

- Redirects no longer stop when their destination page is edited and published again. Until the next generation ran, every redirect to a republished page returned the 404 page, because the destination no longer matched the generated revision. A redirect now only needs its destination to still be published at the same address. Markdown, the sitemap and `llms.txt` still wait for the next generation, as before.

## [1.0.0-beta.4] - 2026-11-26

### Fixed

- Redirects now also answer the old address with a trailing slash. A redirect saved for `/about-us` used to work only for `/about-us`, while `/about-us/` (the form most old sites used and search engines still hold) fell through to the 404 page.

## [1.0.0-beta.3] - 2026-11-19

### Fixed

- Errors on the plugin page now say what went wrong. Every failure used to read "Plugin route failed with 400"; a missing Search Console or Bing connection now explains where to add it, next to the Fetch button instead of in an error toast.
- Pages without their own description no longer get a label such as "About" or "Contact" as their search description. The first real paragraph is used instead, cut cleanly near 155 characters. Regenerating refreshes these descriptions, so affected pages show a new modified date once.
- The overview counts pages against the routes a generation actually covers, and says how many published entries sit in collections that are not selected in Setup, instead of showing a total that could never be reached.

### Added

- **Published files** on the overview and in Setup: links to your live `/sitemap.xml`, `/robots.txt` and `/llms.txt`, each marked live or not yet.
- Later pages of a listing, from `/blog/page/2` on, are kept out of search results and the sitemap automatically (`noindex, follow`). Turn indexing on for a page in Setup → Pages to index it anyway.
- The page shown after a form is sent (`/thank-you`, `/thanks`) is kept out of search results and the sitemap automatically, in the same way.
- Checks now flags descriptions that are too short to be useful and notes very long ones.
- Setup lists the collections that have published entries next to the collection fields, so a mistyped table name is easy to spot.
- **Article collections** in Setup → Website: name the collections that are really articles, so project pages and team profiles stop being checked for bylines and sources and no longer carry Article structured data. Once it is set, the AI Overviews review also stops asking non-article pages for a byline, a date and sources.

### Upgrade note

- Settings saved with **Article collections** filled in are not readable by 1.0.0-beta.2 or earlier. Clear that field before installing an older version.

## [1.0.0-beta.2] - 2026-11-18

### Fixed

- Saving analytics tags or changing the social image design no longer takes `/sitemap.xml`, `/llms.txt` and the Markdown exports offline. Those two settings only change published HTML now; the last good exports keep serving while the affected pages are refreshed underneath them. Saving the website address, pages/redirects/languages/crawler options, or `llms.txt` still starts a fresh generation, as it should.
- A social image that takes too long to render on a busy server no longer stalls the whole generation. The plugin switches to a faster encoding automatically, and if that still isn't enough it leaves the remaining images to the next scheduled run instead of blocking the rest of the site.
- A broken analytics snippet no longer costs every published page its canonical URL, structured data and Markdown link. Page metadata and analytics tags are now applied independently, so a problem with one never removes the other.
- A generation batch interrupted by the server no longer leaves the site stuck: an abandoned batch now gives up its lock after 90 seconds instead of blocking every later attempt indefinitely.
- Server error logs now include a readable message instead of an unlabeled stack trace, making production issues diagnosable from the logs alone.

### Changed

- A status banner above the tabs (and in `/status` as `lifecycle`) always shows the current state in plain language — what's being served right now, what failed and how many times, and exactly what to do next, including when and where to resume a background schedule that Instatic has paused.
- **Save & generate** now follows a batch that's already running elsewhere (another open tab, or the automatic background run) instead of failing when it can't get the generation lock.
- A page or social image that keeps failing the same step is skipped after three tries and reported under Checks, rather than blocking every other page from generating.

## [1.0.0-beta.1] - 2026-10-20

### Fixed

- Settings, analytics tags and the social image design can be saved before the public website address is set. **Save & generate** still needs the address, and a note under the buttons now explains why a button is disabled.

### Changed

- Releases are published by the single "Validate and release" workflow: a new `package.json` version on `main` becomes the repository's Latest release. Other pushes to `main` no longer publish snapshot releases.

## [1.0.0-beta.0] - 2026-10-20

First beta. The plugin is feature-complete for the compatible Instatic host build.

### Added

- **Admin dashboard with tabs:** Overview, Performance, Analytics & tags, Social images, Setup and Checks.
- **Overview:** headline numbers with month-on-month changes, a setup checklist, prioritised fixes, and daily health snapshots charted over time (indexable pages, open issues).
- **Performance:** Google Search Console and Bing Webmaster reports with daily charts, comparison with the previous period, top queries and pages, and a "Quick wins" list. The latest report is saved for each provider.
- **Analytics & tags:** Google Analytics 4 and Tag Manager by ID (with optional Consent Mode v2 defaults), or any pasted tracking snippet. Tags are injected into published pages and allowed through the page Content Security Policy with exact script hashes and the snippet's domains.
- **Social images:** a 1200×630 PNG generated for every page from one of 20 templates (10 layouts, 10 patterns), with a live preview that matches the server output, a logo chosen from the media library or uploaded, and content-hashed file names served from `/og/<hash>.png`.
- **Checks:** filterable publication findings, the AIO publication review, internal link suggestions and a searchable page inventory.
- Release automation: `release-on-version.yml` publishes a release whenever the package version changes on `main`.

### Changed

- Release builds support alpha, beta, release-candidate and stable versions. Snapshot builds from `main` are named after the current channel, for example `1.0.0-beta.57.gabcdef0`.
- The media library opens inline under the logo controls instead of in a floating dialog, so admin layouts cannot hide it.
- Product name and status now read "Unofficial Beta".

## [0.3.0-alpha.0]

### Added

- Guided configuration for pages, business and author profiles, redirects, languages and crawler preferences.
- AIO publication checks for search and snippet access, readable answers, source links, visible authors and accurate dates.
- Markdown publishing, XML sitemaps, `robots.txt`, optional `llms.txt`, Schema.org structured data, content ZIP export, IndexNow, and Search Console/Bing visibility reports.

[1.0.0-beta.7]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.1
[1.0.0-beta.0]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.0
[0.3.0-alpha.0]: https://github.com/flyingwebie/instatic-seo-geo/releases
