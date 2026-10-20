import { useState } from "react";
import {
  Alert,
  Button,
  Input,
  RangeTabs,
  Select,
  Stack,
  Text,
} from "@instatic/host-ui";
import {
  totals,
  type Metrics,
  type VisibilityReport,
} from "../../src/integrations";
import {
  BarList,
  Grid,
  Section,
  Tile,
  TrendChart,
  change,
  formatNumber,
  formatPercent,
} from "./ui";

export type Provider = "google" | "bing";
type Range = "7" | "28" | "90" | "custom";
type Metric = "clicks" | "impressions" | "ctr" | "position";

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
// Search Console data usually lags by two to three days.
const LAG = 3;

function group(
  rows: VisibilityReport["rows"],
  key: "query" | "page",
): Array<Metrics & { label: string }> {
  const groups = new Map<string, Metrics[]>();
  for (const row of rows) {
    const label = row[key];
    if (label) groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return [...groups.entries()].map(([label, items]) => ({
    label,
    ...totals(items),
  }));
}

const shortPage = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

export function Performance(props: {
  provider: Provider;
  onProvider: (provider: Provider) => void;
  report: VisibilityReport | null;
  busy: boolean;
  onFetch: (request: { provider: Provider; startDate: string; endDate: string }) => void;
  onIndexNow: () => void;
}) {
  const [range, setRange] = useState<Range>("28");
  const [startDate, setStartDate] = useState(isoDaysAgo(28 + LAG - 1));
  const [endDate, setEndDate] = useState(isoDaysAgo(LAG));
  const [metric, setMetric] = useState<Metric>("clicks");
  const { report } = props;
  const pickRange = (next: Range) => {
    setRange(next);
    if (next !== "custom") {
      setStartDate(isoDaysAgo(Number(next) + LAG - 1));
      setEndDate(isoDaysAgo(LAG));
    }
  };
  const current = report
    ? totals(report.daily?.length ? report.daily : report.rows)
    : undefined;
  const previous = report?.previous;
  const queries = report ? group(report.rows, "query") : [];
  const pages = report ? group(report.rows, "page") : [];
  // Quick wins: seen often, ranking on page 1–2 but rarely clicked.
  const medianCtr = (() => {
    const sorted = queries.map((q) => q.ctr).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  })();
  const opportunities = queries
    .filter((q) => q.impressions >= 20 && q.position >= 4 && q.position <= 20 && q.ctr <= medianCtr)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  const metricConfig: Record<
    Metric,
    { label: string; format: (v: number) => string; invert?: boolean; tint: string }
  > = {
    clicks: { label: "Clicks", format: formatNumber, tint: "var(--accent-3)" },
    impressions: { label: "Impressions", format: formatNumber, tint: "var(--accent-2)" },
    ctr: { label: "CTR", format: formatPercent, tint: "var(--accent-1)" },
    position: {
      label: "Average position",
      format: (v) => v.toFixed(1),
      invert: true,
      tint: "var(--accent-4)",
    },
  };
  const chosen = metricConfig[metric];
  return (
    <Stack gap={16}>
      <Section
        title="Search performance"
        description="Clicks and impressions from your own verified Search Console or Bing Webmaster property. Add credentials in the plugin's Settings panel. AI citations are not included in these numbers."
      >
        <Grid min={220}>
          <Select
            label="Provider"
            value={props.provider}
            onChange={props.onProvider}
            options={[
              { label: "Google Search Console", value: "google" },
              { label: "Bing Webmaster", value: "bing" },
            ]}
          />
          <Stack gap={6}>
            <span style={{ fontSize: "var(--text-s)", color: "var(--text-muted)" }}>Period</span>
            <RangeTabs
              ariaLabel="Report period"
              value={range}
              onChange={pickRange}
              options={[
                { value: "7", label: "7 days" },
                { value: "28", label: "28 days" },
                { value: "90", label: "3 months" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </Stack>
        </Grid>
        {range === "custom" && (
          <Stack direction="row" gap={12} wrap>
            <Input label="Start date" placeholder="YYYY-MM-DD" value={startDate} onChange={setStartDate} />
            <Input label="End date" placeholder="YYYY-MM-DD" value={endDate} onChange={setEndDate} />
          </Stack>
        )}
        <Stack direction="row" gap={8} wrap align="center">
          <Button
            variant="primary"
            disabled={props.busy}
            onClick={() => props.onFetch({ provider: props.provider, startDate, endDate })}
          >
            {report ? "Refresh report" : "Fetch report"}
          </Button>
          <Button variant="secondary" disabled={props.busy} onClick={props.onIndexNow}>
            Submit queued URLs to IndexNow
          </Button>
          {report && (
            <Text variant="muted">
              Showing {report.startDate} → {report.endDate} · fetched{" "}
              {new Date(report.fetchedAt).toLocaleString()}
            </Text>
          )}
        </Stack>
      </Section>

      {!report ? (
        <Alert tone="info" title="No report yet">
          Choose a provider and period, then fetch the report. The latest report is saved so
          this page and the overview show it next time.
        </Alert>
      ) : (
        <>
          <Grid min={190}>
            <Tile
              label="Clicks"
              value={formatNumber(current!.clicks)}
              delta={change(current!.clicks, previous?.clicks)}
              sub={previous ? `vs ${formatNumber(previous.clicks)} the period before` : undefined}
            />
            <Tile
              label="Impressions"
              value={formatNumber(current!.impressions)}
              delta={change(current!.impressions, previous?.impressions)}
              sub={previous ? `vs ${formatNumber(previous.impressions)}` : undefined}
            />
            <Tile
              label="Click-through rate"
              value={formatPercent(current!.ctr)}
              delta={change(current!.ctr, previous?.ctr)}
              sub={previous ? `vs ${formatPercent(previous.ctr)}` : undefined}
            />
            <Tile
              label="Average position"
              value={current!.position ? current!.position.toFixed(1) : "—"}
              delta={
                previous?.position && current!.position
                  ? `${current!.position <= previous.position ? "+" : "−"}${Math.abs(previous.position - current!.position).toFixed(1)}`
                  : undefined
              }
              // A smaller position number is a better ranking.
              tone={
                previous?.position && current!.position
                  ? current!.position < previous.position
                    ? "up"
                    : current!.position > previous.position
                      ? "down"
                      : "flat"
                  : "flat"
              }
              sub={previous?.position ? `vs ${previous.position.toFixed(1)} · lower is better` : "Lower is better"}
            />
          </Grid>

          <Section
            title={`${chosen.label} per day`}
            action={
              <RangeTabs
                ariaLabel="Chart metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "clicks", label: "Clicks" },
                  { value: "impressions", label: "Impressions" },
                  { value: "ctr", label: "CTR" },
                  { value: "position", label: "Position" },
                ]}
              />
            }
          >
            <TrendChart
              label={chosen.label}
              format={chosen.format}
              invert={chosen.invert}
              tint={chosen.tint}
              points={(report.daily ?? []).map((row) => ({ date: row.date, value: row[metric] }))}
            />
          </Section>

          <Grid min={340}>
            <Section title="Top search queries" description="By clicks in this period.">
              <BarList
                items={[...queries]
                  .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
                  .slice(0, 10)
                  .map((q) => ({
                    label: q.label,
                    value: q.clicks,
                    detail: `${formatNumber(q.impressions)} impr. · pos ${q.position.toFixed(1)}`,
                  }))}
                empty="No query data for this period."
              />
            </Section>
            <Section title="Top pages" description="By clicks in this period.">
              <BarList
                tint="var(--accent-1)"
                items={[...pages]
                  .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
                  .slice(0, 10)
                  .map((p) => ({
                    label: shortPage(p.label),
                    value: p.clicks,
                    detail: `${formatPercent(p.ctr)} CTR`,
                  }))}
                empty={
                  props.provider === "bing"
                    ? "Bing reports queries only, not pages."
                    : "No page data for this period."
                }
              />
            </Section>
          </Grid>

          <Section
            title="Quick wins"
            description="Queries people see often where you rank on page one or two but few click. Improve the matching page's title, description and opening answer, then compare next month."
          >
            <BarList
              tint="var(--accent-4)"
              items={opportunities.map((q) => ({
                label: q.label,
                value: q.impressions,
                detail: `pos ${q.position.toFixed(1)} · ${formatPercent(q.ctr)} CTR`,
              }))}
              empty="No clear opportunities in this period. Try a longer period."
            />
          </Section>
          <Text variant="muted">{report.limitation}</Text>
        </>
      )}
    </Stack>
  );
}
