<h1 align="center">Instatic SEO, GEO &amp; AIO</h1>

<p align="center">
  Make your published content easier to find, understand, and reuse.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Instatic-UNOFFICIAL-64748b" alt="Unofficial Instatic plugin" />
  <img src="https://img.shields.io/badge/status-ALPHA_TEST-f59e0b" alt="Status: alpha testing" />
  <img src="https://img.shields.io/badge/Bun-1.4.x-14151a" alt="Bun 1.4.x" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="Strict TypeScript" />
  <img src="https://img.shields.io/badge/Instatic-plugin_API_1-6366f1" alt="Instatic plugin API 1" />
</p>

<p align="center">
  <a href="#quick-start">Install</a> ·
  <a href="#features-and-status">Features</a> ·
  <a href="docs/roadmap.md">Roadmap</a> ·
  <a href="docs/research.md">Research</a> ·
  <a href="https://github.com/flyingwebie/instatic-seo-geo/releases">Alpha releases</a> ·
  <a href="https://github.com/flyingwebie/instatic-seo-geo/actions">Builds</a> ·
  <a href="https://github.com/flyingwebie/instatic-seo-geo/issues">Issues</a>
</p>

---

An independently developed plugin for [Instatic](https://github.com/flyingwebie/Instatic), the self-hosted visual CMS. The project brings together **search engine optimization (SEO)**, **generative engine optimization (GEO)**, **AI Overview optimization (AIO)**, and **machine-readable content publishing** in one installable ZIP.

The intended workflow is straightforward: publish your website, then generate accurate metadata, structured data, Markdown, and discovery files from the same published content.

> [!IMPORTANT]
> **This plugin is NOT official and is still in alpha testing.** It is independently maintained and is not an official Instatic product or release.
>
> **The complete planned feature set is implemented for alpha testing on the compatible host build.** It includes Markdown, discovery files, metadata, Schema.org, audits, redirects, multilingual validation, and optional integrations. Alpha status still applies: review the [configuration and limits](docs/configuration.md) before using it with real content.

## Why this project exists

Search engines and AI retrieval systems need accessible content, useful links, clear authorship, and reliable descriptions of what a page contains. Maintaining HTML metadata, structured data, discovery files, and exports separately makes it easy for them to disagree.

This plugin is designed around one rule: **every generated representation should describe the same published page.**

- **Search-ready HTML:** authored metadata, canonical URLs, indexing controls, and appropriate JSON-LD.
- **Reusable content:** Markdown that preserves meaningful structure, links, images, tables, and sources.
- **Reliable discovery:** sitemaps and crawler policies synchronized with publication and removal.
- **Actionable maintenance:** concrete findings and suggested fixes, with observable search outcomes.

These are product goals. A plugin can improve technical readiness; it cannot guarantee rankings, indexing, or citations across search providers. The [research notes](docs/research.md) explain the evidence and limitations.

## Features and status

| Capability             | Scope                                                                                         | Status                 |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------- |
| Standalone project     | Bun tooling, strict TypeScript, ESLint, and local SDK setup                                   | ✅ Available           |
| ZIP packaging          | Host CLI produces a manifest and a self-contained server bundle                               | ✅ Available           |
| Sandbox entrypoint     | QuickJS activation and a `plugins.read`-gated status endpoint                                 | ✅ Available           |
| Release automation     | PR validation and ZIP artifacts; alpha prereleases after successful updates to `main`         | ✅ Configured          |
| Markdown publishing    | Published pages, articles, and explicitly allowlisted public collection entries               | ✅ Implemented · alpha |
| XML sitemaps           | Canonical HTML routes, meaningful modification dates, partitioning                            | ✅ Implemented · alpha |
| SEO metadata           | Titles, descriptions, canonical/robots controls, and social previews                          | ✅ Implemented · alpha |
| Schema.org             | Site/page identity, publishers, articles, visible FAQs, and breadcrumbs                       | ✅ Implemented · alpha |
| Content ZIP export     | Markdown, sitemap files, and a file-to-canonical-URL manifest                                 | ✅ Implemented · alpha |
| Publication checks     | Indexability preflight and HTML/Markdown/schema consistency                                   | ✅ Implemented · alpha |
| Redirects and links    | URL-change handling, orphan-page detection, and link suggestions                              | ✅ Implemented · alpha |
| GEO discovery          | Separate search/training preferences and optional `llms.txt`                                  | ✅ Implemented · alpha |
| Guided configuration   | Toggles, page selection, profiles, FAQs, schemas, redirects, languages and crawler forms      | ✅ Implemented · alpha |
| AIO publication review | Local search/snippet checks, visible answer passages, topic headings, sources and attribution | ✅ Implemented · alpha |
| Extended support       | IndexNow, multilingual validation, specialized schema, visibility reports                     | ✅ Implemented · alpha |

See the [implementation roadmap](docs/roadmap.md) for sequencing, host dependencies, and acceptance criteria.

## Quick start

The **0.3 alpha** adds guided configuration and AIO publication checks. Download the matching build from the PR artifacts while it is under review; after merge, GitHub Actions publishes a new alpha prerelease automatically.

**Download → upload → configure → generate.** Use an Instatic build containing the publication SDK and the PostgreSQL plugin JSON storage fix in [host PR #12](https://github.com/flyingwebie/Instatic/pull/12). The fix has merged into the host’s `main` and is prepared for **Instatic 0.0.23**. The latest published core tag, **0.0.22**, does not include it; use the tested commit below until a release containing the fix is published. This plugin's CI and source-build instructions pin the tested host commit. Plugin API `1` alone does not prove host compatibility.

1. Open [Alpha releases](https://github.com/flyingwebie/instatic-seo-geo/releases) and download **`seo-geo.plugin.zip`** from a prerelease.
2. In Instatic, open **Admin → Plugins** and upload that ZIP.
3. Review and approve the requested permissions, then confirm installation. Instatic validates, installs, and activates the plugin.
4. Open **SEO, GEO & AIO → Website** and enter the domain serving your public pages, such as `https://www.example.com`. It can differ from your admin domain.
5. Use **Pages**, **Business & authors**, **Redirects**, **Languages**, **Crawlers** and **AIO** to enable features and complete labelled fields with example placeholders. Published page choices load before the first generation. Custom metadata is optional.
6. Click **Save & generate**. Review publication findings and the per-page AIO checks. Optional provider credentials live in the plugin Settings panel.

No JSON is needed for everyday setup. **Show advanced configuration JSON** provides an optional import/edit view with explicit Apply and Discard actions. Existing settings are retained; invalid stored configuration is surfaced for correction.

The ZIP contains the plugin manifest and bundled code. Bun, Git, and the SDK checkout are development tools used to build the package from source. Keep the ZIP intact when uploading it.

**These packages are unofficial alpha builds.** The installable plugin ZIP is separate from the generated content ZIP. See the [configuration guide](docs/configuration.md) for page metadata, real author/publisher profiles, FAQs, redirects, translations, crawler policies, and integrations.

### Check the installation

While signed in with the `plugins.read` capability, open:

```text
/admin/api/cms/plugins/instatic.seo-geo/runtime/status
```

The response identifies the unofficial alpha version and reports configuration, generation progress, current eligible pages, and concrete findings. Public files appear after generation:

- `/sitemap.xml` and partitioned `/sitemaps/<number>.xml` when needed.
- `/robots.txt` with separate search, training, and user-retrieval preferences.
- `/markdown/index.md` for the homepage; `/markdown/<route>/index.md` for nested pages.
- Optional `/llms.txt` and the IndexNow ownership key file.

**Download content ZIP** exports Markdown, sitemap files, and a canonical URL manifest. Published HTML stays authoritative.

## AIO without ranking promises

[Google's AI search guidance](https://developers.google.com/search/docs/appearance/ai-features) says AI Overviews and AI Mode use the same SEO foundations, with no extra technical requirements, special AI schema or required AI text file. Supporting links need to be indexed and eligible to display a snippet. Local checks cannot establish actual search indexing or guarantee selection.

The plugin preserves authored snippet and preview directives. Guided page controls can override generic snippet preferences, while crawler-specific metadata and `data-nosnippet` remain in place. Optional question/answer fields compare your editorial brief against published headings and paragraphs; they never insert hidden answers. Source counts and answer-length checks are clearly labelled heuristics, rather than a ranking score. Search Console's Web reports include AI feature traffic without isolating every AI citation.

## Development

### Build requirements

- **Bun:** `>=1.4.0 <1.5.0`; development currently uses `1.4.2`.
- **Instatic:** a local source checkout with its dependencies installed.
- **Git** and the **`zip` command** on your development machine. The host packaging CLI uses `zip`.

The SDK is currently part of the Instatic source tree, rather than a published standalone npm package. A local host checkout is needed for development and builds; the generated ZIP does not depend on your checkout path.

### Build from source

The default directory layout is:

```text
your-workspace/
├── Instatic/                 # Host checkout
└── Instatic-plugins/
    └── seo-geo/              # This repository
```

From your workspace directory:

```sh
git clone https://github.com/flyingwebie/Instatic.git Instatic
cd Instatic
git checkout 9314b201268baffc74de35dd149688964d666f39
bun install --frozen-lockfile
cd ..

mkdir -p Instatic-plugins
git clone https://github.com/flyingwebie/instatic-seo-geo.git Instatic-plugins/seo-geo
cd Instatic-plugins/seo-geo
bun install --frozen-lockfile

bun run setup
bun run lint
bun run test
bun run build
```

If you already have the host checkout, reuse it and configure its location as described below. The host revision above matches CI's pinned SDK. Later host revisions may change the plugin API; update and validate the pin deliberately when adopting SDK changes.

The uploadable package is created at:

```text
artifacts/seo-geo.plugin.zip
```

Upload this file using the [installation steps](#quick-start) above. For local development, start your Instatic instance using the host's setup instructions.

### Commands

| Command                  | What it does                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `bun run setup`          | Generate the local SDK connection and TypeScript configuration                                     |
| `bun run typecheck`      | Check the project with TypeScript                                                                  |
| `bun run lint`           | Run ESLint and the host's plugin manifest/source/bundle validation                                 |
| `bun run test`           | Test content conversion, generation lifecycle, discovery files, integrations, and release identity |
| `bun run build`          | Typecheck, bundle through the host SDK, and produce the plugin ZIP                                 |
| `bun run verify:sandbox` | Execute the built ZIP contract inside the host QuickJS sandbox                                     |
| `bun run dev`            | Watch source files and sync builds to the local host's uploads directory                           |

SDK commands refresh the local connection. Run `setup` after cloning or changing host locations so your editor can resolve the generated TypeScript configuration. The release version tests run independently of the host checkout.

### Configuration

| Environment variable      | Default                                    | Purpose                                                                 |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `INSTATIC_DIR`            | `../../Instatic`, relative to this project | Select the local host checkout used by the SDK and build CLI            |
| `INSTATIC_UPLOADS_DIR`    | `<INSTATIC_DIR>/uploads`                   | Select the local upload directory used by `dev`                         |
| `INSTATIC_PLUGIN_VERSION` | Version from `package.json`                | Override the built manifest version; CI supplies a unique alpha version |

For a different checkout location:

```sh
INSTATIC_DIR=/path/to/Instatic bun run setup
INSTATIC_DIR=/path/to/Instatic bun run build
```

For development sync:

```sh
INSTATIC_DIR=/path/to/Instatic \
INSTATIC_UPLOADS_DIR=/path/to/local/uploads \
bun run dev
```

Set these variables in your shell or local Bun environment configuration. Environment files are ignored by Git.

`dev` writes generated files into the selected local host directory. First installation and permission approval still happen through Admin → Plugins; subsequent builds are picked up on the host's next activation cycle. Build and lint do not install the plugin.

### Automated builds and alpha releases

The [GitHub Actions workflow](.github/workflows/ci-release.yml) runs on pull requests (including stacked branches), every update to `main` (including documentation changes), and manual dispatch.

| Trigger                      | Result after validation passes                          |
| ---------------------------- | ------------------------------------------------------- |
| Pull request                 | Downloadable ZIP build artifact, retained for 14 days   |
| Update to `main`             | New GitHub **prerelease** with the validated plugin ZIP |
| Manual run on `main`         | New alpha prerelease for that commit                    |
| Manual run on another branch | Build artifact for testing                              |

Each run installs locked dependencies, uses Bun `1.4.2` and a pinned Instatic SDK revision, runs lint and behavioral/release-version tests, typechecks and builds the actual plugin ZIP, verifies its QuickJS activation and output contracts, and checks the archive. Failed validation prevents publication. Third-party Actions are pinned to commit SHAs.

Release versions use the package's base version, the workflow run number, and the commit's short SHA. For example:

```text
Plugin version: 0.3.0-alpha.42.gabcdef0
Git tag:        v0.3.0-alpha.42.gabcdef0
```

The tag and ZIP manifest identify the same version. Re-running a completed workflow preserves an existing release and its assets; a new workflow run gets a new version. Alpha releases are labeled **unofficial**, marked as prereleases, and never promoted to GitHub's latest stable release.

Every release contains:

- `seo-geo.plugin.zip` — uploadable plugin package.
- `SHA256SUMS` — checksums for the ZIP and build information.
- `build-info.json` — plugin version, source commit, SDK commit, Bun version, and unofficial alpha status.

Automation uses GitHub's built-in token; no custom release secret is required. Only the release job gets write access to repository contents. Update `INSTATIC_REF` in the workflow when deliberately adopting a new host SDK revision, and update the base version in `package.json` when advancing the plugin's release line.

### Troubleshooting

| Symptom                                                               | Check                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Missing host checkout or SDK                                          | Set `INSTATIC_DIR` to the host source checkout and install its dependencies with Bun             |
| Editor cannot resolve `#instatic-sdk` or the TypeScript configuration | Run `bun run setup` from this project                                                            |
| Packaging cannot start `zip`                                          | Make the `zip` command available on your development machine                                     |
| Development sync does not activate the plugin                         | Install the ZIP and approve permissions first, then restart the enabled plugin in the local host |
| Status endpoint returns an authorization error                        | Sign in with an account that has `plugins.read`; verify the plugin's `cms.routes` grant          |

### Project layout

```text
seo-geo/
├── .github/workflows/
│   └── ci-release.yml        # Validation, packaging, and alpha prereleases
├── instatic-plugin.config.ts  # Plugin identity and permission declarations
├── admin/
│   └── index.tsx             # Host UI operator app
├── src/                      # Content, discovery, schema, lifecycle, integrations
├── server/
│   └── index.ts              # QuickJS server entrypoint
├── scripts/
│   ├── plugin.ts             # SDK setup, validation, build, and dev commands
│   └── release-version.ts    # Unique alpha version from run number and commit
├── tests/
│   └── *.test.ts             # Content, lifecycle, integrations, release identity
├── docs/
│   ├── configuration.md      # Setup, typed options, integrations, alpha budgets
│   ├── roadmap.md            # Completed delivery checklist and acceptance evidence
│   └── research.md           # Dated primary-source search guidance
├── package.json
├── bun.lock
├── tsconfig.json
└── eslint.config.js
```

`.instatic/`, `node_modules/`, `dist/`, and `artifacts/` are generated and ignored. Plugin source imports the SDK through `#instatic-sdk`; the local bridge points to the host's canonical SDK entrypoint.

## Architecture and outputs

The host remains responsible for public route resolution, published snapshot composition, artifact serving, and publication notifications. The plugin owns SEO rules, schema mappings, content conversion, discovery files, and diagnostics.

The publishing flow is:

```text
Published Instatic routes + versioned content
                    │
         Normalized public-page content
                    │
         ┌──────────┼───────────┬─────────────┐
         ▼          ▼           ▼             ▼
     HTML +      Markdown    Sitemap XML   Content ZIP
     JSON-LD     alternatives              + manifest
```

**Two ZIPs serve different purposes:**

- **Plugin ZIP:** installs the executable plugin through Admin → Plugins.
- **Content ZIP:** an authenticated download of generated Markdown, sitemap files, and canonical URL mappings.

Public outputs include `/sitemap.xml`, `/robots.txt`, `/markdown/<route>/index.md`, and optional `/llms.txt`. Public HTML remains the canonical search-facing representation.

The companion host foundation supplies permissioned public-route inventory, raw published HTML, root site routes, revision checks, and published HTML refreshes. See [the delivery checklist](docs/roadmap.md).

## Permissions and content boundaries

The [manifest](instatic-plugin.config.ts) requests the grants consumed by the implemented features:

| Permissions                                          | Purpose                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `cms.publication.read`                               | Raw HTML and inventory of actual published routes                            |
| `cms.routes`, `cms.routes.public`, `cms.routes.site` | Authenticated operations and public root discovery files                     |
| `cms.hooks`, `cms.storage`, `cms.schedule`           | HTML enrichment, staged exports, and automatic synchronization               |
| `admin.navigation`, `editor.code`                    | The admin app with the host's UI primitives                                  |
| `network.outbound`                                   | Optional IndexNow, Google, and Bing calls, restricted to four declared hosts |

The plugin does not require CMS write/publish/delete permissions. It refreshes existing public HTML through the host; it never publishes a draft. Collection exports are explicitly allowlisted in configuration, defaulting to `posts`. Raw private cells and definition trees are not part of the publication interface.

- Public exports are checked against current publication and configuration on every request.
- Failed rebuilds retain the last valid generation while retracting ineligible routes immediately.
- Schema describes authored facts and visible content; diagnostics explain absent bylines, FAQs, and entity details.
- Google/Bing credentials are encrypted secret settings and stay server-side. Reports measure supported search metrics, not universal AI citations.

The alpha supports 1 MiB input HTML per page, 24 MiB staged document data, and 16 MiB uncompressed content per ZIP. Sitemaps partition at the protocol's 50,000-URL/50-MiB limits. Read [the operational details](docs/configuration.md#outputs-and-alpha-budgets).

Use disposable local data for development and smoke tests. Local accounts, databases, uploads, and generated screenshots are not included in this repository or distributed plugin packages.

## SEO and GEO expectations

The project follows provider guidance and records it in [research.md](docs/research.md), checked on **October 5–6, 2026**.

- Google AI search uses ordinary search eligibility; special AI files or special Schema.org markup are not required. [Google guidance](https://developers.google.com/search/docs/appearance/ai-features)
- Google ignores `llms.txt` for visibility and rankings. Its support here is an interoperability feature. [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- `FAQPage` remains Schema.org vocabulary, but Google retired FAQ rich results in May 2026. [Google updates](https://developers.google.com/search/updates)
- Structured data must reflect real content; authors, reviews, dates, and answers must not be invented. [Structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

Measure crawling, indexing, organic traffic, conversions, and observed AI citation activity separately. Technical eligibility does not guarantee any of those outcomes.

## Roadmap and contributing

The planned feature checklist is implemented and covered by alpha tests. See the [delivery checklist](docs/roadmap.md) for the source modules and acceptance evidence. The next work should be driven by reported bugs and measured behavior in compatible self-hosted installations.
Before contributing:

1. Read the [roadmap](docs/roadmap.md), [configuration](docs/configuration.md), and [research](docs/research.md).
2. Open an [issue](https://github.com/flyingwebie/instatic-seo-geo/issues) for a proposal or bug report. Keep example content public or synthetic.
3. Use a feature branch and a pull request with a clear problem statement and verification results.
4. Run `bun run lint`, `bun run test`, and `bun run build`. Add meaningful tests as functional behavior is implemented.
5. Keep host SDK changes in the Instatic repository and link the corresponding plugin work.

Behavioral tests cover content conversion, metadata/schema, eligibility, transactional generation, redirects, crawler policies, hreflang, specialized entities, provider parsing, retries, and credential-safe failures. `bun run verify:sandbox` executes the built package in the actual host QuickJS VM, including activation, permission rejection, generation, discovery files, binary ZIP, and retraction. Provider tests use synthetic responses; no live credentials or network submissions are required.

## License and relationship to Instatic

A project license has not been selected yet. **This plugin is NOT official and is still in alpha testing.** It is independently maintained and is not an official Instatic product or release.

---

Built for self-hosted publishing with **Bun · TypeScript · Instatic · QuickJS**.
