import { useEffect, useRef, useState } from "react";
import { Type, type Static } from "@sinclair/typebox";
import { definePluginAdminApp } from "#instatic-sdk";
import { usePluginRoutes, usePluginSettings } from "@instatic/host-hooks";
import {
  Button,
  Card,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  pushToast,
} from "@instatic/host-ui";
import {
  HistorySchema,
  IndexNowResultSchema,
  PageChoicesSchema,
  ProgressSchema,
  StatusSchema,
  type HistoryPoint,
} from "../src/adminSchemas";
import { Configuration } from "./configuration/Configuration";
import { parseOptions, siteOrigin } from "../src/config";
import {
  VisibilityReportSchema,
  type VisibilityReport,
} from "../src/integrations";
import {
  analyticsActive,
  detectProviders,
  parseAnalytics,
  type AnalyticsOptions,
} from "../src/analyticsConfig";
import { Overview, type TabId } from "./dashboard/Overview";
import { Performance, type Provider } from "./dashboard/Performance";
import { AnalyticsTags } from "./dashboard/AnalyticsTags";
import { Checks } from "./dashboard/Checks";
import { SocialImages } from "./dashboard/SocialImages";
import { parseOgTemplate, resolveTemplate, type OgTemplate } from "../src/og/template";
import { Section } from "./dashboard/ui";

const CachedReportSchema = Type.Object({
  report: Type.Union([VisibilityReportSchema, Type.Null()]),
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error.";

function initialAnalytics(raw: unknown): { value: AnalyticsOptions; error: string } {
  try {
    return { value: parseAnalytics(String(raw ?? "")), error: "" };
  } catch (error) {
    return { value: {}, error: message(error) };
  }
}

export default definePluginAdminApp(function SeoGeo() {
  const routes = usePluginRoutes(),
    settings = usePluginSettings();
  const [tab, setTab] = useState<TabId>("overview");
  const [siteUrl, setSiteUrl] = useState(String(settings.siteUrl ?? ""));
  const [options, setOptions] = useState(String(settings.options ?? "{}"));
  const [llms, setLlms] = useState(settings.llmsEnabled === true);
  const [initial] = useState(() => initialAnalytics(settings.analytics));
  const [analytics, setAnalytics] = useState<AnalyticsOptions>(initial.value);
  const [savedAnalytics, setSavedAnalytics] = useState(JSON.stringify(initial.value));
  const [initialOg] = useState(() => {
    try {
      return { value: parseOgTemplate(String(settings.ogTemplate ?? "")), error: "" };
    } catch (error) {
      return { value: {} as OgTemplate, error: message(error) };
    }
  });
  const [ogTemplate, setOgTemplate] = useState<OgTemplate>(initialOg.value);
  const [savedOg, setSavedOg] = useState(JSON.stringify(initialOg.value));
  const [pageChoices, setPageChoices] = useState<Static<typeof PageChoicesSchema>>([]);
  const [pendingJson, setPendingJson] = useState(false);
  const pause = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<Static<typeof StatusSchema>>();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [provider, setProvider] = useState<Provider>("google");
  const [reports, setReports] = useState<Record<Provider, VisibilityReport | null>>({
    google: null,
    bing: null,
  });

  const analyticsDirty = JSON.stringify(analytics) !== savedAnalytics;
  // Unreadable stored tags block saving until the user replaces them, so
  // they are never silently discarded.
  let analyticsError =
    initial.error && !analyticsDirty
      ? `Stored analytics tags could not be read (${initial.error}). Edit or clear the fields in Analytics & tags to replace them.`
      : "";
  try {
    parseAnalytics(JSON.stringify(analytics));
  } catch (error) {
    analyticsError = message(error);
  }
  const ogDirty = JSON.stringify(ogTemplate) !== savedOg;
  let ogError =
    initialOg.error && !ogDirty
      ? `The stored social image design could not be read (${initialOg.error}). Change any setting in Social images to replace it.`
      : "";
  try {
    parseOgTemplate(JSON.stringify(ogTemplate));
  } catch (error) {
    ogError = message(error);
  }
  let validConfiguration = !pendingJson && !analyticsError && !ogError;
  try {
    parseOptions(options);
    siteOrigin(siteUrl);
  } catch {
    validConfiguration = false;
  }

  const errorToast = (error: unknown) =>
    pushToast({ kind: "error", title: "SEO & GEO operation failed", body: message(error) });
  const refresh = async () => {
    const [nextStatus, nextHistory] = await Promise.all([
      routes.json("/status", StatusSchema),
      routes.json("/history", HistorySchema),
    ]);
    setStatus(nextStatus);
    setHistory(nextHistory);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      routes.json("/status", StatusSchema),
      routes.json("/pages", PageChoicesSchema),
      routes.json("/history", HistorySchema),
    ])
      .then(([value, pages, points]) => {
        if (!active) return;
        setStatus(value);
        setPageChoices(pages);
        setHistory(points);
      })
      .catch((error: unknown) => {
        if (active) errorToast(error);
      });
    // Saved reports are optional; a missing one is not an error.
    Promise.all(
      (["google", "bing"] as const).map((name) =>
        routes
          .json(`/report?provider=${name}`, CachedReportSchema)
          .then((result) => [name, result.report] as const)
          .catch(() => [name, null] as const),
      ),
    ).then((entries) => {
      if (!active) return;
      setReports(Object.fromEntries(entries) as Record<Provider, VisibilityReport | null>);
      const google = entries.find(([name]) => name === "google")?.[1];
      const bing = entries.find(([name]) => name === "bing")?.[1];
      if (!google && bing) setProvider("bing");
    });
    return () => {
      active = false;
      pause.current = true;
    };
    // The host owns the stable route facade for this mounted plugin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await refresh();
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
      setGenerating(false);
    }
  };
  const save = async () => {
    siteOrigin(siteUrl);
    const normalized = JSON.stringify(parseOptions(options));
    if (pendingJson)
      throw new Error("Apply or discard the advanced JSON draft before saving.");
    if (analyticsError) throw new Error(analyticsError);
    if (ogError) throw new Error(ogError);
    const analyticsJson = JSON.stringify(analytics);
    const ogJson = JSON.stringify(ogTemplate);
    await routes.json("/configure", Type.Object({ ok: Type.Boolean() }), {
      method: "POST",
      body: JSON.stringify({
        siteUrl,
        options: normalized,
        llmsEnabled: llms,
        analytics: analyticsJson,
        ogTemplate: ogJson,
      }),
    });
    setSavedAnalytics(analyticsJson);
    setSavedOg(ogJson);
  };
  const generate = () => {
    setGenerating(true);
    return perform(async () => {
      pause.current = false;
      await save();
      let previousCheckpoint = "";
      let result = await routes.json("/generate", ProgressSchema, {
        method: "POST",
        body: "{}",
      });
      while (!result.done) {
        const checkpoint = `${result.phase}:${result.offset}:${result.refreshed ?? 0}:${result.images ?? 0}`;
        if (checkpoint === previousCheckpoint)
          throw new Error(
            "Generation did not advance. Check the Instatic core version and retry after resolving the host error.",
          );
        previousCheckpoint = checkpoint;
        setProgress(
          result.phase === "html"
            ? `Refreshing public pages: ${result.refreshed ?? 0} of ${result.total}.`
            : result.phase === "images"
              ? `Creating social images: ${result.images ?? 0} of ${result.imageTotal ?? 0}.`
              : `Generating discovery content: ${result.offset} of ${result.total} pages.`,
        );
        if (pause.current) {
          setProgress(
            "Foreground generation paused. Saved progress can resume; automatic background generation may continue.",
          );
          return;
        }
        result = await routes.json("/generate", ProgressSchema, {
          method: "POST",
          body: "{}",
        });
      }
      setProgress(`Generation completed: ${result.total} published routes.`);
      pushToast({ kind: "success", title: "Published content generated" });
    });
  };
  const download = () =>
    perform(async () => {
      const response = await routes.fetch("/download");
      if (!response.ok)
        throw new Error("Content download failed. Generate the current website and retry.");
      if (!response.headers.get("Content-Type")?.startsWith("application/zip"))
        throw new Error("Unexpected download format.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "seo-geo-content.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

  const actions = (
    <Stack gap={8}>
      <Stack direction="row" gap={8} wrap>
        <Button variant="primary" disabled={busy || !validConfiguration} onClick={generate}>
          Save &amp; generate
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !validConfiguration}
          onClick={() =>
            perform(async () => {
              await save();
              pushToast({
                kind: "success",
                title: "Settings saved",
                body: "Generate to update discovery exports and published pages.",
              });
            })
          }
        >
          Save settings
        </Button>
        {generating && busy && (
          <Button
            variant="secondary"
            onClick={() => {
              pause.current = true;
            }}
          >
            Pause foreground generation
          </Button>
        )}
        <Button variant="secondary" disabled={busy || !status?.generated} onClick={download}>
          Download content ZIP
        </Button>
      </Stack>
      <Text variant="muted">
        {progress ||
          `${status?.generated ?? 0} of ${status?.total ?? 0} published routes generated · ${status?.indexable ?? 0} indexable`}
      </Text>
    </Stack>
  );
  const findingCount =
    status?.findings.filter((f) => f.severity !== "info").length ?? 0;
  const report = reports[provider] ?? reports.google ?? reports.bing;

  return (
    <Stack gap={16}>
      <Text variant="muted">
        Unofficial alpha · Improves technical discoverability. Search providers decide indexing,
        rankings and citations.
      </Text>
      <Tabs value={tab} onChange={setTab}>
        <TabList ariaLabel="SEO, GEO & AIO sections">
          <Tab value="overview">Overview</Tab>
          <Tab value="performance">Performance</Tab>
          <Tab value="analytics">Analytics &amp; tags{analyticsDirty ? " •" : ""}</Tab>
          <Tab value="social">Social images{ogDirty ? " •" : ""}</Tab>
          <Tab value="setup">Setup</Tab>
          <Tab value="checks">Checks{findingCount ? ` (${findingCount})` : ""}</Tab>
        </TabList>
        <div style={{ height: 16 }} />
        <TabPanel value="overview">
          <Overview
            status={status}
            history={history}
            report={report}
            siteConfigured={!!status?.configured}
            analyticsProviders={detectProviders(JSON.parse(savedAnalytics) as AnalyticsOptions)}
            analyticsActive={analyticsActive(JSON.parse(savedAnalytics) as AnalyticsOptions)}
            socialImagesOn={resolveTemplate(JSON.parse(savedOg) as OgTemplate).enabled}
            busy={busy || !validConfiguration}
            progress={progress}
            onNavigate={setTab}
            onGenerate={generate}
          />
        </TabPanel>
        <TabPanel value="performance">
          <Performance
            provider={provider}
            onProvider={setProvider}
            report={reports[provider]}
            busy={busy}
            onFetch={(request) =>
              perform(async () => {
                const next = await routes.json("/report", VisibilityReportSchema, {
                  method: "POST",
                  body: JSON.stringify(request),
                });
                setReports((current) => ({ ...current, [request.provider]: next }));
              })
            }
            onIndexNow={() =>
              perform(async () => {
                const result = await routes.json("/indexnow", IndexNowResultSchema, {
                  method: "POST",
                  body: "{}",
                });
                pushToast({
                  kind: "info",
                  title: result.enabled
                    ? `IndexNow: ${result.submitted} submitted, ${result.remaining} queued`
                    : "Enable IndexNow in plugin settings first",
                });
              })
            }
          />
        </TabPanel>
        <TabPanel value="analytics" keepMounted>
          <AnalyticsTags
            value={analytics}
            onChange={setAnalytics}
            error={analyticsError}
            disabled={busy}
            dirty={analyticsDirty}
            actions={actions}
          />
        </TabPanel>
        <TabPanel value="social" keepMounted>
          <SocialImages
            value={ogTemplate}
            onChange={setOgTemplate}
            status={status}
            error={ogError}
            disabled={busy}
            dirty={ogDirty}
            actions={actions}
          />
        </TabPanel>
        <TabPanel value="setup" keepMounted>
          <Stack gap={16}>
            <Card>
              <Configuration
                raw={options}
                onChange={setOptions}
                onPendingChange={setPendingJson}
                siteUrl={siteUrl}
                onSiteUrlChange={setSiteUrl}
                llms={llms}
                onLlmsChange={setLlms}
                pages={pageChoices}
                disabled={busy}
              />
            </Card>
            <Section title="Save and publish">
              {actions}
              <Text variant="mono">
                /sitemap.xml · /robots.txt · /markdown/&lt;route&gt;/index.md
              </Text>
            </Section>
          </Stack>
        </TabPanel>
        <TabPanel value="checks">
          <Checks status={status} />
        </TabPanel>
      </Tabs>
    </Stack>
  );
});
