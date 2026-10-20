import type { Static } from "@sinclair/typebox";
import { Button, Stack, StackedBar, Text } from "@instatic/host-ui";
import type { HistoryPoint, StatusSchema } from "../../src/adminSchemas";
import type { VisibilityReport } from "../../src/integrations";
import { totals } from "../../src/integrations";
import {
  Badge,
  Grid,
  Section,
  Tile,
  TrendChart,
  change,
  formatNumber,
  formatPercent,
} from "./ui";

export type TabId = "overview" | "performance" | "analytics" | "social" | "setup" | "checks";
type Status = Static<typeof StatusSchema>;

/** The history point closest to `days` ago, for "vs last month" deltas. */
function pointBefore(history: HistoryPoint[], days: number) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return [...history].reverse().find((point) => point.date <= cutoff) ?? history[0];
}

export function Overview(props: {
  status: Status | undefined;
  history: HistoryPoint[];
  report: VisibilityReport | null;
  siteConfigured: boolean;
  analyticsProviders: string[];
  analyticsActive: boolean;
  socialImagesOn: boolean;
  busy: boolean;
  progress: string;
  onNavigate: (tab: TabId) => void;
  onGenerate: () => void;
}) {
  const { status, history, report } = props;
  const findings = status?.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const notices = findings.length - errors - warnings;
  const aio = status?.pages.filter((page) => page.aio) ?? [];
  const aioReady = aio.filter((page) =>
    page.aio!.checks.every((check) => check.status === "pass"),
  ).length;
  const before = history.length > 1 ? pointBefore(history.slice(0, -1), 30) : undefined;
  // Daily totals cover every query; page/query rows are capped at 1,000.
  const search = report
    ? totals(report.daily?.length ? report.daily : report.rows)
    : undefined;
  const generated = (status?.generated ?? 0) > 0;
  const steps: Array<{ done: boolean; label: string; tab: TabId; action: string }> = [
    { done: props.siteConfigured, label: "Add your public website address", tab: "setup", action: "Open setup" },
    { done: generated, label: "Generate sitemap, metadata and checks", tab: "setup", action: "Open setup" },
    { done: generated && errors === 0, label: "Fix pages that need action", tab: "checks", action: "View checks" },
    { done: props.socialImagesOn, label: "Design your social sharing image", tab: "social", action: "Design" },
    { done: props.analyticsActive, label: "Connect an analytics tool", tab: "analytics", action: "Add tags" },
    { done: !!report, label: "Fetch Search Console or Bing data", tab: "performance", action: "Open performance" },
  ];
  const done = steps.filter((step) => step.done).length;
  const ordered = [...findings].sort(
    (a, b) =>
      ["error", "warning", "info"].indexOf(a.severity) -
      ["error", "warning", "info"].indexOf(b.severity),
  );
  return (
    <Stack gap={16}>
      <Grid min={190}>
        <Tile
          label="Pages generated"
          value={formatNumber(status?.generated ?? 0)}
          sub={`of ${formatNumber(status?.total ?? 0)} published routes`}
        />
        <Tile
          label="Indexable pages"
          value={formatNumber(status?.indexable ?? 0)}
          delta={change(status?.indexable ?? 0, before?.indexable)}
          sub={before ? `vs ${before.date}` : "Can appear in search results"}
        />
        <Tile
          label="Issues to fix"
          value={formatNumber(errors + warnings)}
          delta={change(errors + warnings, before ? before.errors + before.warnings : undefined)}
          // Fewer issues is good, so a drop reads as an improvement.
          tone={
            before && errors + warnings < before.errors + before.warnings
              ? "up"
              : before && errors + warnings > before.errors + before.warnings
                ? "down"
                : "flat"
          }
          sub={`${errors} need action · ${warnings} to review`}
        />
        <Tile
          label="AIO-ready pages"
          value={aio.length ? formatPercent(aioReady / aio.length) : "—"}
          sub={aio.length ? `${aioReady} of ${aio.length} pass every check` : "Enable AIO checks in setup"}
        />
        <Tile
          label="Search clicks"
          value={search ? formatNumber(search.clicks) : "—"}
          delta={search ? change(search.clicks, report?.previous?.clicks) : undefined}
          sub={
            report
              ? `${report.provider === "google" ? "Google" : "Bing"} · ${report.startDate} → ${report.endDate}`
              : "Connect Search Console in Performance"
          }
        />
      </Grid>

      <Grid min={340}>
        <Section
          title="Getting the basics right"
          description={`${done} of ${steps.length} complete. Work top to bottom; each step makes the next one more useful.`}
        >
          <Stack gap={8}>
            {steps.map((step) => (
              <Stack key={step.label} direction="row" justify="between" align="center" gap={8} wrap>
                <Stack direction="row" gap={8} align="center">
                  <Badge tone={step.done ? "good" : "neutral"}>{step.done ? "Done" : "To do"}</Badge>
                  <Text>{step.label}</Text>
                </Stack>
                {!step.done && (
                  <Button variant="ghost" size="sm" onClick={() => props.onNavigate(step.tab)}>
                    {step.action}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
          <Stack direction="row" gap={8} align="center" wrap>
            <Button
              variant="primary"
              disabled={props.busy || !props.siteConfigured}
              onClick={props.onGenerate}
            >
              Generate now
            </Button>
            <Text variant="muted">
              {props.progress ||
                (status?.completedAt
                  ? `Last generated ${new Date(status.completedAt).toLocaleString()}`
                  : "Not generated yet")}
            </Text>
          </Stack>
        </Section>

        <Section
          title="What to fix next"
          description="The most important findings first. They explain concrete issues, not a ranking score."
          action={
            findings.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => props.onNavigate("checks")}>
                See all {findings.length}
              </Button>
            )
          }
        >
          {findings.length ? (
            <>
              <StackedBar
                total={findings.length}
                formatValue={(value) => String(value)}
                segments={[
                  { label: "Action needed", value: errors, color: "var(--danger)" },
                  { label: "Review", value: warnings, color: "var(--warning)" },
                  { label: "Tips", value: notices, color: "var(--accent-3)" },
                ].filter((segment) => segment.value > 0)}
              />
              <Stack gap={8}>
                {ordered.slice(0, 5).map((finding, i) => (
                  <Stack key={finding.path + finding.code + i} gap={2}>
                    <Stack direction="row" gap={8} align="center" wrap>
                      <Badge
                        tone={
                          finding.severity === "error"
                            ? "danger"
                            : finding.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {finding.severity === "error" ? "Action" : finding.severity === "warning" ? "Review" : "Tip"}
                      </Badge>
                      <Text variant="mono">{finding.path}</Text>
                    </Stack>
                    <Text>{finding.message}</Text>
                  </Stack>
                ))}
              </Stack>
            </>
          ) : (
            <Text variant="muted">
              {generated
                ? "No findings. Keep publishing and check back after each update."
                : "Generate your site to run the checks."}
            </Text>
          )}
        </Section>
      </Grid>

      <Grid min={340}>
        <Section
          title="Indexable pages over time"
          description="Recorded once a day and after each manual generation."
        >
          <TrendChart
            label="Indexable pages"
            points={history.map((point) => ({ date: point.date, value: point.indexable }))}
            tint="var(--accent-1)"
            height={180}
          />
        </Section>
        <Section
          title="Open issues over time"
          description="Pages needing action plus pages to review. Lower is better."
        >
          <TrendChart
            label="Issues"
            points={history.map((point) => ({
              date: point.date,
              value: point.errors + point.warnings,
            }))}
            tint="var(--accent-4)"
            height={180}
          />
        </Section>
      </Grid>

      {report?.daily && report.daily.length > 1 && (
        <Section
          title="Search clicks"
          description={`Daily clicks from ${report.provider === "google" ? "Google Search Console" : "Bing Webmaster"}, last fetched ${new Date(report.fetchedAt).toLocaleString()}.`}
          action={
            <Button variant="ghost" size="sm" onClick={() => props.onNavigate("performance")}>
              Open performance
            </Button>
          }
        >
          <TrendChart
            label="Clicks"
            points={report.daily.map((row) => ({ date: row.date, value: row.clicks }))}
            height={160}
          />
        </Section>
      )}

      <Section
        title="Analytics"
        action={
          <Button variant="ghost" size="sm" onClick={() => props.onNavigate("analytics")}>
            Manage tags
          </Button>
        }
      >
        {props.analyticsActive ? (
          <Stack direction="row" gap={8} wrap>
            {props.analyticsProviders.map((name) => (
              <Badge key={name} tone="good">
                {name}
              </Badge>
            ))}
          </Stack>
        ) : (
          <Text variant="muted">
            No analytics tool is connected yet. Add Google Analytics, Tag Manager or any other
            tracking snippet in Analytics &amp; tags.
          </Text>
        )}
      </Section>
    </Stack>
  );
}
