# AGENTS.md

An unofficial [Instatic](https://github.com/flyingwebie/Instatic) plugin that turns published pages into SEO/GEO/AIO outputs — metadata, Schema.org, Markdown, sitemaps, `llms.txt`, analytics tags and social-share images. Server code (`server/`, `src/`) runs inside the host's QuickJS sandbox; `admin/` is an ordinary React app running in the browser.

## Commands

| Command | Proves |
| --- | --- |
| `bun run setup` | Generates `#instatic-sdk` and the TypeScript config from a local host checkout. Run it after cloning or changing `INSTATIC_DIR`. |
| `bun run typecheck` | The project compiles under strict TypeScript. |
| `bun run lint` | ESLint rules pass, including `no-restricted-globals` for sandbox-missing names (see below), plus the host's manifest/source/bundle validation. |
| `bun run test` | `bun test` — content conversion, the generation lifecycle, discovery files, integrations and analytics, all against a fake host. Fast, but never runs inside the real sandbox. |
| `bun run build` | Typechecks, bundles through the host SDK, and produces `artifacts/seo-geo.plugin.zip`. |
| `bun run verify:sandbox` | Runs the **built ZIP** inside the real QuickJS VM: activation, permission rejection, a full staged generation with analytics tags and a social image, the public routes, and retraction. This is the only check that exercises real sandbox constraints (no `btoa`, the 5-second step limit) end to end. |

All of the above need a local Instatic checkout. `INSTATIC_DIR` (default `../../Instatic`, relative to this project) selects it; `scripts/plugin.ts` fails fast with a clear message if the checkout is missing the files it expects. `verify:sandbox` additionally reads `dist/` and `artifacts/`, so run `bun run build` first.

## Sandbox rules that have bitten before

Server code (`server/**`, `src/**`) runs in QuickJS, not Node or a browser. It has `URL`, `TextEncoder`/`TextDecoder`, `crypto.subtle.digest`, `fetch`, timers and `console` — nothing else.

- **No `btoa`/`atob`/`Buffer`/`Intl`/`structuredClone`/`performance`**, nor `window`, `document`, `localStorage`, etc. ESLint's `no-restricted-globals` (`eslint.config.js`) rejects these names in `server/**` and `src/**` at lint time; `bun run verify:sandbox` is the second, independent check, because `bun test` runs in Bun and would never notice. Need base64? Use `src/og/base64.ts` (`toBase64`/`fromBase64`), not a browser or Node global. Code that genuinely needs a browser API belongs in `admin/`.
- **One synchronous stretch of plugin code may not exceed 5 seconds.** A step that does is killed with `InternalError: interrupted`, with no message attached. This is why image encoding has a fast/slow/deferred fallback (`docs/state-machines.md` §2) and why HTML refresh and document reads work in small batches rather than all at once. If you add a step that can be slow (more pages, bigger payloads, a slower codec), budget it against this limit or make it resumable, not just "usually fast enough."
- **`console.error` must be given a string built with `describeError`** (`src/lifecycle.ts`). The sandbox console prints only `error.stack` for an `Error`, and QuickJS stacks carry no message — `console.error(error)` on a plain `Error` produces an unreadable line in production logs. `describeError` prepends `name: message` when the stack doesn't already include it.
- **The `publish.html` filter must never throw out to the host.** The host discards the entire filter result on a throw, so a broken enrichment step would cost every page its canonical/JSON-LD/Markdown-link metadata, not just itself. Any code added to that filter (`server/index.ts`) wraps its own `try`/`catch` and logs rather than propagates — see `docs/state-machines.md` §4 for the exact two-stage contract already in place.

## How to read state

`GET <plugin route>/status` (mounted under `/admin/api/cms/plugins/instatic.seo-geo/runtime/` in a real host) returns `lifecycle`:

```
lifecycle.state, lifecycle.serving, lifecycle.phase, lifecycle.progress,
lifecycle.lastError, lifecycle.attention, lifecycle.skipped, lifecycle.automation,
lifecycle.nextAction
```

| `nextAction.code` | Means |
| --- | --- |
| `configure` | No website address saved yet. Set `siteUrl`. |
| `generate` | Configured, but nothing has run yet or content/settings changed since the last run. |
| `wait` | A batch is in progress; it continues on its own (another tab, or the schedule). |
| `resume-schedule` | No scheduled run seen in 15 minutes. Generate once by hand, then resume the paused schedule (below). |
| `fix-error` | The same step has failed 3+ times in a row. Read `lifecycle.lastError.message` and fix the reported problem. |
| `none` | Everything matches; nothing to do. |

A failed admin route answers HTTP 400 with `{ error, code }`. The admin reads it through `callRoute` in `admin/routes.ts`; do not call the host's `routes.json`, which throws "Plugin route failed with 400" and drops the `error` text. `error` is for people; `code` is stable: `invalid-settings` (fix the saved settings), `content-limit` (a page or the site is too large: change content, do not retry) or `operation-failed` (read `lifecycle.lastError`; usually retried on its own). `POST /generate` with `{"client":2}` returns `busy: true` or `deferred: true` instead of an error while another batch or the schedule is doing the work; poll again.

Full state/transition detail, including the two fingerprints and the batch pipeline, is in `docs/state-machines.md` — read it before changing anything in `src/lifecycle.ts` or `PublicationService`.

## Diagnosing a public 503 from outside

```sh
curl -i https://your-site.example.com/sitemap.xml
```

A 503 carries `Retry-After: 60` and `X-Seo-Geo-Reason`: `not-generated` (nothing has ever committed) or `settings-changed` (a generation exists but isn't servable under the settings saved now — see the two fingerprints in `docs/state-machines.md` §1). `/robots.txt` never 503s: it is built from settings alone and ignores generation state entirely, so it's a reliable way to tell "plugin is up, generation is pending" from "plugin itself is broken."

## Invariants that must not be broken

- Stored record shapes (`current`, `pending`, `automation`, `og-index`, `indexnow-queue`, and anything under the `state` or `documents` storage collections) only ever gain **optional** fields (`Type.Optional`). Never remove, rename, or make a previously-optional field required — a record written by an older plugin version must still validate.
- Exports (`/sitemap.xml`, `/llms.txt`, `/markdown/*`) are never served for a generation whose `exports` fingerprint doesn't match the live one. `servable()` is the only place that decides this; don't bypass it.
- The `current` pointer is committed **last**, after documents, images and HTML are all done and discovery files have been validated. A failed or interrupted batch must leave `current` exactly as it was.
- HTML refresh is never skipped, even after repeated failures — it retries one page at a time instead. Documents and images may be skipped after `MAX_ATTEMPTS` (3); commit is never skipped.
- Public URLs (`/sitemap.xml`, `/sitemaps/N.xml`, `/robots.txt`, `/markdown/<route>/index.md`, `/llms.txt`, `/og/<hash>.png`) and the response contracts in `src/adminSchemas.ts` are stable for existing integrations and admin clients; add fields, don't change what's already there.

## Where things live

```
server/index.ts          # QuickJS entrypoint: routes, publish.html filter, the schedule
src/lifecycle.ts          # deriveLifecycle: stored records -> one Lifecycle value
src/service.ts            # PublicationService: fingerprints, the generation batch, publicFile
src/integrations.ts       # IndexNow submission, Search Console / Bing reports
src/analytics.ts          # Tag injection and CSP relaxation for published pages
src/og/                   # Social image templates, renderer, PNG encoder, fonts, base64 codec
src/config.ts             # Typed site options, validation, findings
src/adminSchemas.ts       # Response contracts shared by the admin app and /status
admin/index.tsx           # Admin app: tabs, Save & generate loop, status polling
admin/dashboard/           # Overview, Performance, Analytics, Social images, Checks, Lifecycle banner
admin/configuration/       # Guided setup forms
scripts/plugin.ts          # setup / lint / typecheck / build / dev commands
scripts/verify-sandbox.ts  # Runs the built ZIP in a real QuickJS VM
tests/                     # bun test suite, against a fake host (tests/fixtures.ts)
docs/state-machines.md     # The state machines behind everything above
```

See `docs/state-machines.md` for how all of this fits together at runtime.
