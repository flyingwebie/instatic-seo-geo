import { useState } from "react";
import type { Static } from "@sinclair/typebox";
import { Alert, RangeTabs, SearchBar, Stack, Text } from "@instatic/host-ui";
import type { StatusSchema } from "../../src/adminSchemas";
import { AioReview } from "../AioReview";
import { Badge, Section } from "./ui";

type Filter = "all" | "error" | "warning" | "info";

export function Checks({ status }: { status: Static<typeof StatusSchema> | undefined }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const findings = status?.findings ?? [];
  const count = (severity: Filter) =>
    severity === "all" ? findings.length : findings.filter((f) => f.severity === severity).length;
  const shown = findings.filter((f) => filter === "all" || f.severity === filter);
  const pages = (status?.pages ?? []).filter((page) =>
    `${page.title} ${page.path}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Stack gap={16}>
      <Section
        title="Publication checks"
        description="Concrete issues and editorial suggestions from the last generation. They are not a ranking score."
        action={
          findings.length > 0 && (
            <RangeTabs
              ariaLabel="Filter findings"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All ${count("all")}` },
                { value: "error", label: `Action ${count("error")}` },
                { value: "warning", label: `Review ${count("warning")}` },
                { value: "info", label: `Tips ${count("info")}` },
              ]}
            />
          )
        }
      >
        {shown.length ? (
          shown.map((finding, i) => (
            <Alert
              key={finding.path + finding.code + i}
              tone={
                finding.severity === "error"
                  ? "danger"
                  : finding.severity === "warning"
                    ? "warning"
                    : "info"
              }
              title={`${finding.path} · ${finding.severity === "error" ? "Action needed" : finding.severity === "warning" ? "Review suggested" : "Tip"}`}
            >
              <Text>{finding.message}</Text>
              <Text variant="muted">{finding.fix}</Text>
            </Alert>
          ))
        ) : (
          <Text variant="muted">
            {findings.length
              ? "Nothing in this category."
              : "No current findings. Generate your site to run the checks."}
          </Text>
        )}
      </Section>

      <AioReview status={status} />

      {!!status?.suggestions.length && (
        <Section
          title="Internal link suggestions"
          description="Linking related pages helps visitors and search engines find your best content."
        >
          {status.suggestions.map((suggestion) => (
            <Stack key={suggestion.from + suggestion.to} gap={2}>
              <Text variant="mono">
                {suggestion.from} → {suggestion.to}
              </Text>
              <Text variant="muted">{suggestion.reason}</Text>
            </Stack>
          ))}
        </Section>
      )}

      <Section
        title="Page inventory"
        description={`${status?.indexable ?? 0} of ${status?.pages.length ?? 0} generated pages can appear in search results.`}
      >
        {!!status?.pages.length && (
          <SearchBar value={query} onChange={setQuery} placeholder="Filter pages by title or path" />
        )}
        {pages.length ? (
          <div style={{ display: "grid", gap: 2 }}>
            {pages.map((page) => (
              <div
                key={page.path}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <Stack gap={2}>
                  <Text variant="strong">{page.title || page.path}</Text>
                  <Text variant="mono">{page.canonical}</Text>
                  <Text variant="muted">
                    {page.lastModified
                      ? `Modified ${new Date(page.lastModified).toLocaleDateString()}`
                      : "No modification date"}
                  </Text>
                </Stack>
                <Badge tone={page.indexable ? "good" : "neutral"}>
                  {page.indexable ? "Indexable" : "Excluded"}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <Text variant="muted">
            {status?.pages.length ? "No pages match the filter." : "Generate your site to list pages."}
          </Text>
        )}
      </Section>
    </Stack>
  );
}
