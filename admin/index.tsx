import { useEffect, useRef, useState } from "react";
import { Type, type Static } from "@sinclair/typebox";
import { definePluginAdminApp } from "#instatic-sdk";
import { usePluginRoutes, usePluginSettings } from "@instatic/host-hooks";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Select,
  Stack,
  Text,
  pushToast,
} from "@instatic/host-ui";
import {
  StatusSchema,
  PageChoicesSchema,
  ProgressSchema,
  IndexNowResultSchema,
} from "../src/adminSchemas";
import { Configuration } from "./configuration/Configuration";
import { AioReview } from "./AioReview";
import { parseOptions, siteOrigin } from "../src/config";
import { VisibilityReportSchema } from "../src/integrations";

export default definePluginAdminApp(function SeoGeo() {
  const routes = usePluginRoutes(),
    settings = usePluginSettings();
  const [siteUrl, setSiteUrl] = useState(String(settings.siteUrl ?? ""));
  const [options, setOptions] = useState(String(settings.options ?? "{}"));
  const [llms, setLlms] = useState(settings.llmsEnabled === true);
  const [pageChoices, setPageChoices] = useState<
    Static<typeof PageChoicesSchema>
  >([]);
  const [pendingJson, setPendingJson] = useState(false);
  const pause = useRef(false);
  const [generating, setGenerating] = useState(false);
  let validConfiguration = !pendingJson;
  try {
    parseOptions(options);
    siteOrigin(siteUrl);
  } catch {
    validConfiguration = false;
  }
  const [status, setStatus] = useState<Static<typeof StatusSchema>>();
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [provider, setProvider] = useState<"google" | "bing">("google");
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(
    new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
  );
  const [report, setReport] = useState<Static<typeof VisibilityReportSchema>>();
  const errorToast = (error: unknown) =>
    pushToast({
      kind: "error",
      title: "SEO & GEO operation failed",
      body: error instanceof Error ? error.message : "Unknown error.",
    });
  useEffect(() => {
    let active = true;
    Promise.all([
      routes.json("/status", StatusSchema),
      routes.json("/pages", PageChoicesSchema),
    ])
      .then(([value, pages]) => {
        if (active) {
          setStatus(value);
          setPageChoices(pages);
        }
      })
      .catch((error: unknown) => {
        if (active) errorToast(error);
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
      setStatus(await routes.json("/status", StatusSchema));
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
      setGenerating(false);
    }
  };
  const save = () => {
    siteOrigin(siteUrl);
    const normalized = JSON.stringify(parseOptions(options));
    if (pendingJson)
      throw new Error(
        "Apply or discard the advanced JSON draft before saving.",
      );
    return routes.json("/configure", Type.Object({ ok: Type.Boolean() }), {
      method: "POST",
      body: JSON.stringify({ siteUrl, options: normalized, llmsEnabled: llms }),
    });
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
        const checkpoint = `${result.phase}:${result.offset}:${result.refreshed ?? 0}`;
        if (checkpoint === previousCheckpoint)
          throw new Error(
            "Generation did not advance. Check the Instatic core version and retry after resolving the host error.",
          );
        previousCheckpoint = checkpoint;
        setProgress(
          result.phase === "html"
            ? `Refreshing public HTML: ${result.refreshed ?? 0} of ${result.total} pages.`
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
        throw new Error(
          "Content download failed. Generate the current website and retry.",
        );
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
  return (
    <Stack gap={20}>
      <Heading level={1}>SEO, GEO &amp; AIO</Heading>
      <Alert tone="warning" title="Unofficial · Alpha testing">
        This independently maintained plugin improves technical discoverability.
        Search providers decide indexing, rankings, and citations.
      </Alert>
      <Card>
        <Stack gap={12}>
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
          <Stack direction="row" gap={8} wrap>
            <Button
              variant="primary"
              disabled={busy || !validConfiguration}
              onClick={generate}
            >
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
                    body: "Generate to update discovery exports and published metadata.",
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
            <Button
              variant="secondary"
              disabled={busy || !status?.generated}
              onClick={download}
            >
              Download content ZIP
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await routes.json("/status", StatusSchema);
                })
              }
            >
              Refresh status
            </Button>
          </Stack>
          <Text>
            {progress ||
              `${status?.generated ?? 0} of ${status?.total ?? 0} published routes generated · ${status?.indexable ?? 0} indexable`}
          </Text>
          {status?.completedAt && (
            <Text variant="muted">Last completed: {status.completedAt}</Text>
          )}
          <Text variant="mono">
            /sitemap.xml · /robots.txt · /markdown/&lt;route&gt;/index.md
          </Text>
        </Stack>
      </Card>
      <AioReview status={status} />
      <Card>
        <Stack gap={12}>
          <Heading level={2}>Publication checks</Heading>
          <Text>
            These findings explain concrete issues and editorial heuristics.
            They are not a ranking score.
          </Text>
          {status?.findings.length ? (
            status.findings.map((finding, i) => (
              <Alert
                key={finding.path + finding.code + i}
                tone={
                  finding.severity === "error"
                    ? "danger"
                    : finding.severity === "warning"
                      ? "warning"
                      : "info"
                }
                title={`${finding.path} · ${finding.severity === "error" ? "Action needed" : "Review suggested"}`}
              >
                <Text>{finding.message}</Text>
                <Text>{finding.fix}</Text>
              </Alert>
            ))
          ) : (
            <Text>
              No current findings. Generate your site to run the checks.
            </Text>
          )}
          {!!status?.suggestions.length && (
            <Heading level={3}>Internal link suggestions</Heading>
          )}
          {status?.suggestions.map((suggestion) => (
            <Text key={suggestion.from + suggestion.to}>
              {suggestion.from} → {suggestion.to}: {suggestion.reason}
            </Text>
          ))}
        </Stack>
      </Card>
      <Card>
        <Stack gap={12}>
          <Heading level={2}>Canonical page inventory</Heading>
          {status?.pages.map((page) => (
            <Stack key={page.path} gap={2}>
              <Text variant="strong">
                {page.title || page.path} ·{" "}
                {page.indexable ? "Indexable" : "Excluded"}
              </Text>
              <Text variant="mono">{page.canonical}</Text>
              <Text variant="muted">
                {page.lastModified || "No modification date"}
              </Text>
            </Stack>
          ))}
        </Stack>
      </Card>
      <Card>
        <Stack gap={12}>
          <Heading level={2}>Search visibility</Heading>
          <Text>
            Configure encrypted provider credentials and IndexNow in the
            plugin’s Settings panel. Reports use your own verified webmaster
            property. AI citations must be observed separately; these metrics do
            not measure them.
          </Text>
          <Select
            label="Provider"
            value={provider}
            onChange={setProvider}
            options={[
              { label: "Google Search Console", value: "google" },
              { label: "Bing Webmaster", value: "bing" },
            ]}
          />
          <Stack direction="row" gap={12}>
            <Input
              label="Start date"
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChange={setStartDate}
            />
            <Input
              label="End date"
              placeholder="YYYY-MM-DD"
              value={endDate}
              onChange={setEndDate}
            />
          </Stack>
          <Stack direction="row" gap={8}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  setReport(
                    await routes.json("/report", VisibilityReportSchema, {
                      method: "POST",
                      body: JSON.stringify({ provider, startDate, endDate }),
                    }),
                  );
                })
              }
            >
              Fetch report
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  const result = await routes.json(
                    "/indexnow",
                    IndexNowResultSchema,
                    { method: "POST", body: "{}" },
                  );
                  pushToast({
                    kind: "info",
                    title: result.enabled
                      ? `IndexNow: ${result.submitted} submitted, ${result.remaining} queued`
                      : "Enable IndexNow in plugin settings first",
                  });
                })
              }
            >
              Submit queued URLs
            </Button>
          </Stack>
          {report && (
            <>
              <Text>{report.limitation}</Text>
              <Text variant="muted">Fetched: {report.fetchedAt}</Text>
              {report.rows.map((row, i) => (
                <Text key={row.label + i}>
                  {row.label}: {row.clicks} clicks · {row.impressions}{" "}
                  impressions · {(row.ctr * 100).toFixed(1)}% CTR · position{" "}
                  {row.position.toFixed(1)}
                </Text>
              ))}
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
});
