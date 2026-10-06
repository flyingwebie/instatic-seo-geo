import { useState } from "react";
import type { Static } from "@sinclair/typebox";
import { Alert, Card, Heading, Select, Stack, Text } from "@instatic/host-ui";
import type { StatusSchema } from "../src/adminSchemas";

export function AioReview({
  status,
}: {
  status: Static<typeof StatusSchema> | undefined;
}) {
  const pages = status?.pages.filter((page) => page.aio) ?? [];
  const [selected, setSelected] = useState("");
  const current = pages.find((page) => page.path === selected) ?? pages[0];
  const restricted = pages.filter((page) =>
    page.aio?.checks.some((check) => check.status === "blocked"),
  ).length;
  return (
    <Card>
      <Stack gap={12}>
        <Heading level={2}>AIO publication review</Heading>
        <Text>
          Local technical and editorial checks for published content. A pass is
          not proof of search indexing, AI Overview inclusion or a ranking
          improvement. Google Search Console includes AI feature traffic in its
          Web totals.
        </Text>
        {!pages.length && (
          <Text>
            Enable AIO checks and generate the website to review your pages.
          </Text>
        )}
        {!!pages.length && (
          <>
            <Text>
              {pages.length} pages reviewed · {restricted} with local search or
              snippet restrictions
            </Text>
            <Select
              label="Page to review for AIO"
              value={current?.path ?? ""}
              options={pages.map((page) => ({
                value: page.path,
                label: `${page.title || page.path} — ${page.path}`,
              }))}
              onChange={setSelected}
            />
          </>
        )}
        {(current ? [current] : []).map((page) => (
          <Card key={page.path}>
            <Stack gap={12}>
              <Heading level={3}>{page.title || page.path}</Heading>
              <Text variant="mono">{page.path}</Text>
              {page.aio?.checks.map((check) => (
                <Alert
                  key={check.id}
                  tone={
                    check.status === "blocked"
                      ? "danger"
                      : check.status === "review"
                        ? "warning"
                        : "info"
                  }
                  title={`${check.label} · ${check.status === "pass" ? "Passed local check" : check.status === "blocked" ? "Restricted" : "Review suggested"}`}
                >
                  <Text>{check.detail}</Text>
                  {check.status !== "pass" && <Text>{check.action}</Text>}
                </Alert>
              ))}
              {page.aio?.answer && (
                <>
                  <Text variant="strong">Published answer passage</Text>
                  <Text>{page.aio.answer}</Text>
                </>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
