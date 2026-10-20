# Changelog

All notable changes to this plugin. Versions follow [Semantic Versioning](https://semver.org/); changing `version` in `package.json` on `main` publishes a GitHub release automatically (see the README's [release section](README.md#automated-builds-and-releases)).

This plugin is **unofficial** and independently maintained.

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

[1.0.0-beta.1]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.1
[1.0.0-beta.0]: https://github.com/flyingwebie/instatic-seo-geo/releases/tag/v1.0.0-beta.0
[0.3.0-alpha.0]: https://github.com/flyingwebie/instatic-seo-geo/releases
