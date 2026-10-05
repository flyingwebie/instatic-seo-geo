<h1 align="center">Instatic SEO &amp; GEO</h1>

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

An independently developed plugin for [Instatic](https://github.com/flyingwebie/Instatic), the self-hosted visual CMS. The project brings together **search engine optimization (SEO)**, **generative engine optimization (GEO)**, and **machine-readable content publishing** in one installable ZIP.

The intended workflow is straightforward: publish your website, then generate accurate metadata, structured data, Markdown, and discovery files from the same published content.

> [!IMPORTANT]
> **This plugin is NOT official and is still in alpha testing.** It is independently maintained and is not an official Instatic product or release.
>
> **The current implementation is a development scaffold.** You can build a plugin ZIP and activate its authenticated status endpoint. Markdown exports, sitemaps, SEO enrichment, and Schema.org generation are planned and are not implemented in the `0.1.0-alpha.*` builds. An automatically published alpha package does not mean those features are complete.

## Why this project exists

Search engines and AI retrieval systems need accessible content, useful links, clear authorship, and reliable descriptions of what a page contains. Maintaining HTML metadata, structured data, discovery files, and exports separately makes it easy for them to disagree.

This plugin is designed around one rule: **every generated representation should describe the same published page.**

- **Search-ready HTML:** authored metadata, canonical URLs, indexing controls, and appropriate JSON-LD.
- **Reusable content:** Markdown that preserves meaningful structure, links, images, tables, and sources.
- **Reliable discovery:** sitemaps and crawler policies synchronized with publication and removal.
- **Actionable maintenance:** concrete findings and suggested fixes, with observable search outcomes.

These are product goals. A plugin can improve technical readiness; it cannot guarantee rankings, indexing, or citations across search providers. The [research notes](docs/research.md) explain the evidence and limitations.

## Features and status

| Capability | Scope | Status |
| --- | --- | --- |
| Standalone project | Bun tooling, strict TypeScript, ESLint, and local SDK setup | ✅ Available |
| ZIP packaging | Host CLI produces a manifest and a self-contained server bundle | ✅ Available |
| Sandbox entrypoint | QuickJS activation and a `plugins.read`-gated status endpoint | ✅ Available |
| Release automation | PR validation and ZIP artifacts; alpha prereleases after successful updates to `main` | ✅ Configured |
| Markdown publishing | Published pages, articles, and explicitly permitted collection entries | 📋 Planned |
| XML sitemaps | Canonical HTML routes, meaningful modification dates, partitioning | 📋 Planned |
| SEO metadata | Titles, descriptions, canonical/robots controls, and social previews | 📋 Planned |
| Schema.org | Site/page identity, publishers, articles, visible FAQs, and breadcrumbs | 📋 Planned |
| Content ZIP export | Markdown, sitemap files, and a file-to-canonical-URL manifest | 📋 Planned |
| Publication checks | Indexability preflight and HTML/Markdown/schema consistency | 📋 Planned |
| Redirects and links | URL-change handling, orphan-page detection, and link suggestions | 📋 Planned |
| GEO discovery | Separate search/training preferences and optional `llms.txt` | 📋 Planned |
| Extended support | IndexNow, multilingual validation, specialized schema, visibility reports | 📋 Planned |

See the [implementation roadmap](docs/roadmap.md) for sequencing, host dependencies, and acceptance criteria.

## Quick start

**Download → upload → confirm.** Installation requires a compatible running Instatic instance and an account allowed to install plugins. The scaffold was verified against Instatic `0.0.21` and plugin API `1`.

1. Open [Alpha releases](https://github.com/flyingwebie/instatic-seo-geo/releases) and download **`seo-geo.plugin.zip`** from a prerelease.
2. In Instatic, open **Admin → Plugins** and upload that ZIP.
3. Review and approve the requested `cms.routes` permission, then confirm installation. Instatic validates, installs, and activates the plugin.

The ZIP contains the plugin manifest and bundled code. Bun, Git, and the SDK checkout are development tools used to build the package from source. Keep the ZIP intact when uploading it.

**These packages are unofficial alpha builds.** Consult the feature table above: the current scaffold provides a status endpoint; the SEO and content-generation features are still planned. Use a local test instance for alpha testing.

### Check the installation

While signed in with the `plugins.read` capability, open:

```text
/admin/api/cms/plugins/instatic.seo-geo/runtime/status
```

The current response explicitly identifies the scaffold:

```json
{
  "pluginId": "instatic.seo-geo",
  "version": "0.1.0-alpha.0",
  "official": false,
  "channel": "alpha",
  "stage": "scaffold",
  "features": {
    "markdown": false,
    "sitemap": false,
    "structuredData": false
  }
}
```

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
git checkout f4e692f70d012be82e47c3dce5cf23aec4d573bc
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

| Command | What it does |
| --- | --- |
| `bun run setup` | Generate the local SDK connection and TypeScript configuration |
| `bun run typecheck` | Check the project with TypeScript |
| `bun run lint` | Run ESLint and the host's plugin manifest/source/bundle validation |
| `bun run test` | Check release version identity and reject malformed build inputs |
| `bun run build` | Typecheck, bundle through the host SDK, and produce the plugin ZIP |
| `bun run dev` | Watch source files and sync builds to the local host's uploads directory |

SDK commands refresh the local connection. Run `setup` after cloning or changing host locations so your editor can resolve the generated TypeScript configuration. The release version tests run independently of the host checkout.

### Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `INSTATIC_DIR` | `../../Instatic`, relative to this project | Select the local host checkout used by the SDK and build CLI |
| `INSTATIC_UPLOADS_DIR` | `<INSTATIC_DIR>/uploads` | Select the local upload directory used by `dev` |
| `INSTATIC_PLUGIN_VERSION` | Version from `package.json` | Override the built manifest version; CI supplies a unique alpha version |

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

The [GitHub Actions workflow](.github/workflows/ci-release.yml) runs on pull requests targeting `main`, every update to `main` (including documentation changes), and manual dispatch.

| Trigger | Result after validation passes |
| --- | --- |
| Pull request | Downloadable ZIP build artifact, retained for 14 days |
| Update to `main` | New GitHub **prerelease** with the validated plugin ZIP |
| Manual run on `main` | New alpha prerelease for that commit |
| Manual run on another branch | Build artifact for testing |

Each run installs locked dependencies, uses Bun `1.4.2` and a pinned Instatic SDK revision, runs lint and release-version tests, typechecks and builds the actual plugin ZIP, and verifies the archive. Failed validation prevents publication. Third-party Actions are pinned to commit SHAs.

Release versions use the package's base version, the workflow run number, and the commit's short SHA. For example:

```text
Plugin version: 0.1.0-alpha.42.gabcdef0
Git tag:        v0.1.0-alpha.42.gabcdef0
```

The tag and ZIP manifest identify the same version. Re-running a completed workflow preserves an existing release and its assets; a new workflow run gets a new version. Alpha releases are labeled **unofficial**, marked as prereleases, and never promoted to GitHub's latest stable release.

Every release contains:

- `seo-geo.plugin.zip` — uploadable plugin package.
- `SHA256SUMS` — checksums for the ZIP and build information.
- `build-info.json` — plugin version, source commit, SDK commit, Bun version, and unofficial alpha status.

Automation uses GitHub's built-in token; no custom release secret is required. Only the release job gets write access to repository contents. Update `INSTATIC_REF` in the workflow when deliberately adopting a new host SDK revision, and update the base version in `package.json` when advancing the plugin's release line.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing host checkout or SDK | Set `INSTATIC_DIR` to the host source checkout and install its dependencies with Bun |
| Editor cannot resolve `#instatic-sdk` or the TypeScript configuration | Run `bun run setup` from this project |
| Packaging cannot start `zip` | Make the `zip` command available on your development machine |
| Development sync does not activate the plugin | Install the ZIP and approve permissions first, then activate it in the local host |
| Status endpoint returns an authorization error | Sign in with an account that has `plugins.read`; verify the plugin's `cms.routes` grant |

### Project layout

```text
seo-geo/
├── .github/workflows/
│   └── ci-release.yml        # Validation, packaging, and alpha prereleases
├── instatic-plugin.config.ts  # Plugin identity and permission declarations
├── server/
│   └── index.ts              # QuickJS server entrypoint
├── scripts/
│   ├── plugin.ts             # SDK setup, validation, build, and dev commands
│   └── release-version.ts    # Unique alpha version from run number and commit
├── tests/
│   └── release-version.test.ts
├── docs/
│   ├── roadmap.md            # Implementation sequence and acceptance criteria
│   └── research.md           # Dated primary-source search guidance
├── package.json
├── bun.lock
├── tsconfig.json
└── eslint.config.js
```

`.instatic/`, `node_modules/`, `dist/`, and `artifacts/` are generated and ignored. Plugin source imports the SDK through `#instatic-sdk`; the local bridge points to the host's canonical SDK entrypoint.

## Architecture and planned outputs

The host remains responsible for public route resolution, published snapshot composition, artifact serving, and publication notifications. The plugin owns SEO rules, schema mappings, content conversion, discovery files, and diagnostics.

The planned publishing flow is:

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
- **Content ZIP:** a planned authenticated download of generated Markdown, sitemap files, and canonical URL mappings.

Proposed public outputs include `/sitemap.xml`, `/robots.txt`, `/markdown/<route>/index.md`, and optional `/llms.txt`. Public HTML remains the canonical search-facing representation.

These outputs require host SDK extensions. Existing anonymous plugin endpoints are mounted under `/admin/api/cms/plugins/<id>/runtime/*`; that does not yet provide root discovery-file serving. See [host foundation](docs/roadmap.md#host-foundation).

## Permissions and content boundaries

The current [manifest configuration](instatic-plugin.config.ts) requests only **`cms.routes`**. The status route is authenticated and capability-gated. The scaffold reads no CMS content, changes no entries, publishes nothing, and requests no outbound network access.

As features are implemented, permissions will be added only when a real feature uses them. Table access will remain explicit and subject to the host's granted permissions.

The planned public-content contract is:

- Read the **published version**, including its published templates, layouts, and Visual Components.
- Keep drafts, preview branches, private fields, and personalized fragments out of public exports.
- Retract outputs when content is unpublished or removed.
- Keep metadata and schema consistent with visible page content.
- Preserve the last valid generation when rebuilding fails, while respecting current publication eligibility.

Use disposable local data for development and smoke tests. Local accounts, databases, uploads, and generated screenshots are not included in this repository or distributed plugin packages.

## SEO and GEO expectations

The project follows provider guidance and records it in [research.md](docs/research.md), checked on **October 5, 2026**.

- Google AI search uses ordinary search eligibility; special AI files or special Schema.org markup are not required. [Google guidance](https://developers.google.com/search/docs/appearance/ai-features)
- Google ignores `llms.txt` for visibility and rankings. Its planned support here is an interoperability feature. [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- `FAQPage` remains Schema.org vocabulary, but Google retired FAQ rich results in May 2026. [Google updates](https://developers.google.com/search/updates)
- Structured data must reflect real content; authors, reviews, dates, and answers must not be invented. [Structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

Measure crawling, indexing, organic traffic, conversions, and observed AI citation activity separately. Technical eligibility does not guarantee any of those outcomes.

## Roadmap and contributing

The next milestone is intentionally concrete: **one page and one templated article**, each producing matching Markdown, canonical metadata, sitemap entries, and Article JSON-LD. Unpublished edits must stay private, and unpublishing must remove generated public content.

After the host foundation and first content slice, the roadmap expands into publication checks, redirects, shared identity profiles, internal-link assistance, and optional integrations.

Before contributing:

1. Read the [roadmap](docs/roadmap.md) and [research](docs/research.md).
2. Open an [issue](https://github.com/flyingwebie/instatic-seo-geo/issues) for a proposal or bug report. Keep example content public or synthetic.
3. Use a feature branch and a pull request with a clear problem statement and verification results.
4. Run `bun run lint`, `bun run test`, and `bun run build`. Add meaningful tests as functional behavior is implemented.
5. Keep host SDK changes in the Instatic repository and link the corresponding plugin work.

The automated tests cover release identity and malformed build inputs. The scaffold has also been checked with TypeScript, ESLint, SDK validation, ZIP integrity checks, and direct activation/route checks in the host's QuickJS VM, including rejection without the required permission. Functional SEO tests will accompany implementation of the planned features.

## License and relationship to Instatic

A project license has not been selected yet. **This plugin is NOT official and is still in alpha testing.** It is independently maintained and is not an official Instatic product or release.

---

Built for self-hosted publishing with **Bun · TypeScript · Instatic · QuickJS**.
