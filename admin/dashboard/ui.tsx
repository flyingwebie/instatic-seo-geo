import { useEffect, useState, type ReactNode } from "react";
import { Card, Delta, Heading, Stack, Text } from "@instatic/host-ui";

/** Responsive card grid: as many columns of `min` px as fit. */
export function Grid({
  min = 200,
  gap = 12,
  children,
}: {
  min?: number;
  gap?: number;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
        gap,
        alignItems: "stretch",
      }}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <Stack gap={12}>
        <Stack direction="row" justify="between" align="center" wrap gap={8}>
          <Heading level={3}>{title}</Heading>
          {action}
        </Stack>
        {description && <Text variant="muted">{description}</Text>}
        {children}
      </Stack>
    </Card>
  );
}

/** Headline number with optional change vs the previous period. */
export function Tile({
  label,
  value,
  sub,
  delta,
  tone = "auto",
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: string;
  tone?: "auto" | "up" | "down" | "flat";
  children?: ReactNode;
}) {
  return (
    <Card>
      <Stack gap={6}>
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-subtle)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
        <Stack direction="row" align="end" gap={8} wrap>
          <span
            style={{
              fontSize: "var(--text-3xl)",
              lineHeight: 1.1,
              color: "var(--text-bright)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </span>
          {delta && <Delta tone={tone}>{delta}</Delta>}
        </Stack>
        {sub && (
          <span style={{ fontSize: "var(--text-s)", color: "var(--text-muted)" }}>
            {sub}
          </span>
        )}
        {children}
      </Stack>
    </Card>
  );
}

export const formatNumber = (value: number) =>
  value >= 10000
    ? new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : new Intl.NumberFormat().format(Math.round(value));
export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const formatDate = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** "+12%" style change label; null when there is nothing to compare. */
export function change(current: number, previous: number | undefined) {
  if (previous === undefined || !Number.isFinite(previous)) return undefined;
  if (previous === 0) return current === 0 ? "0%" : undefined;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;
}

function useWidth() {
  // A callback ref re-attaches when the measured element changes.
  const [node, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [ref, width] as const;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value) ?? 10;
  return step * power;
}

/**
 * Single-series line chart with a crosshair tooltip and a data-table view.
 * One measure per chart keeps one honest axis.
 */
export function TrendChart({
  points,
  label,
  format = formatNumber,
  tint = "var(--accent-3)",
  height = 200,
  invert = false,
}: {
  points: ReadonlyArray<{ date: string; value: number }>;
  label: string;
  format?: (value: number) => string;
  tint?: string;
  height?: number;
  /** Lower is better (e.g. average position): draw the best value on top. */
  invert?: boolean;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2)
    return (
      <Text variant="muted">
        {points.length
          ? "Only one data point so far. The trend appears after the next day of data."
          : "No data for this period yet."}
      </Text>
    );
  const pad = { top: 12, right: 12, bottom: 26, left: 48 };
  const w = width - pad.left - pad.right,
    h = height - pad.top - pad.bottom;
  const values = points.map((p) => p.value);
  const min = invert ? Math.max(0, Math.floor(Math.min(...values))) : 0;
  const max = invert ? Math.ceil(Math.max(...values)) : niceMax(Math.max(...values));
  const range = Math.max(max - min, invert ? 1 : 0.0001);
  const x = (i: number) => pad.left + (i / (points.length - 1)) * w;
  const y = (v: number) =>
    pad.top + (invert ? (v - min) / range : 1 - (v - min) / range) * h;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const baseline = invert ? pad.top : pad.top + h;
  const area = `${x(0)},${baseline} ${line} ${x(points.length - 1)},${baseline}`;
  const ticks = [0, 0.5, 1].map((t) => min + t * range);
  const labelIndexes = [
    ...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  ];
  const active = hover === null ? null : points[hover];
  return (
    <Stack gap={8}>
      <div ref={ref} style={{ position: "relative", width: "100%" }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: ${points.length} days, latest ${format(values.at(-1)!)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const rel = (event.clientX - box.left - pad.left) / w;
            setHover(
              Math.min(points.length - 1, Math.max(0, Math.round(rel * (points.length - 1)))),
            );
          }}
          style={{ display: "block", overflow: "visible" }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border-subtle)"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--text-subtle)"
                fontSize={11}
              >
                {format(tick)}
              </text>
            </g>
          ))}
          {labelIndexes.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fill="var(--text-subtle)"
              fontSize={11}
            >
              {formatDate(points[i]!.date)}
            </text>
          ))}
          <polygon points={area} fill={tint} opacity={0.12} />
          <polyline
            points={line}
            fill="none"
            stroke={tint}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {active && hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.top}
                y2={pad.top + h}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(active.value)}
                r={5}
                fill={tint}
                stroke="var(--bg-surface)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
        {active && hover !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: Math.min(Math.max(x(hover) - 70, 0), width - 140),
              width: 140,
              pointerEvents: "none",
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 8px",
              fontSize: "var(--text-xs)",
              color: "var(--text)",
              boxShadow: "0 4px 16px rgb(0 0 0 / 0.25)",
            }}
          >
            <div style={{ color: "var(--text-subtle)" }}>
              {formatDate(active.date)}
            </div>
            <div style={{ color: "var(--text-bright)", fontWeight: 600 }}>
              {format(active.value)} {label.toLowerCase()}
            </div>
          </div>
        )}
      </div>
      <details>
        <summary
          style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}
        >
          Show data table
        </summary>
        <table style={{ width: "100%", fontSize: "var(--text-xs)", marginTop: 8 }}>
          <thead>
            <tr style={{ color: "var(--text-subtle)", textAlign: "left" }}>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <td>{point.date}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {format(point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Stack>
  );
}

/** Ranked horizontal bars: label, proportional bar, value. */
export function BarList({
  items,
  format = formatNumber,
  tint = "var(--accent-3)",
  empty = "No data yet.",
}: {
  items: ReadonlyArray<{ label: string; value: number; detail?: string }>;
  format?: (value: number) => string;
  tint?: string;
  empty?: string;
}) {
  if (!items.length) return <Text variant="muted">{empty}</Text>;
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((item, i) => (
        <div
          key={item.label + i}
          title={item.detail ? `${item.label} — ${item.detail}` : item.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 8,
            alignItems: "center",
            position: "relative",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: `${(item.value / max) * 100}%`,
              background: tint,
              opacity: 0.16,
              borderRadius: "var(--radius-sm)",
            }}
          />
          <span
            style={{
              position: "relative",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--text-s)",
              color: "var(--text)",
            }}
          >
            {item.label}
            {item.detail && (
              <span style={{ color: "var(--text-subtle)" }}> · {item.detail}</span>
            )}
          </span>
          <span
            style={{
              position: "relative",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-s)",
              color: "var(--text-bright)",
            }}
          >
            {format(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Small status pill: icon + label, never colour alone. */
export function Badge({
  tone,
  children,
}: {
  tone: "good" | "warning" | "danger" | "neutral";
  children: ReactNode;
}) {
  const colors = {
    good: ["var(--success-10)", "var(--success-text)", "✓"],
    warning: ["var(--warning-10)", "var(--warning-text)", "!"],
    danger: ["var(--danger-10)", "var(--danger-text)", "✕"],
    neutral: ["var(--bg-surface-3)", "var(--text-muted)", "•"],
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: "var(--radius-pill)",
        background: colors[0],
        color: colors[1],
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>{colors[2]}</span>
      {children}
    </span>
  );
}
