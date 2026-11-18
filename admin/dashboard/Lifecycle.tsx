import { Button, Card, Stack, Text } from "@instatic/host-ui";
import type { Lifecycle, LifecyclePhase, LifecycleState } from "../../src/lifecycle";
import { Badge } from "./ui";

const STATE: Record<
  LifecycleState,
  { label: string; tone: "good" | "warning" | "danger" | "neutral" }
> = {
  unconfigured: { label: "Not set up", tone: "neutral" },
  "never-generated": { label: "Not generated yet", tone: "warning" },
  generating: { label: "Generating", tone: "warning" },
  outdated: { label: "Update waiting", tone: "warning" },
  ready: { label: "Up to date", tone: "good" },
};

const PHASE: Record<LifecyclePhase, string> = {
  documents: "Step 1 of 4 · Reading published pages",
  images: "Step 2 of 4 · Creating social images",
  html: "Step 3 of 4 · Refreshing public pages",
  commit: "Step 4 of 4 · Publishing the sitemap and exports",
};

function progressLine(lifecycle: Lifecycle): string {
  const { phase, progress } = lifecycle;
  if (!phase) return "";
  if (!progress) return PHASE[phase];
  const done =
    phase === "documents"
      ? `${progress.documents} of ${progress.total} pages`
      : phase === "images"
        ? `${progress.images} created`
        : phase === "html"
          ? `${progress.html} of ${progress.total} pages`
          : "";
  return done ? `${PHASE[phase]} · ${done}` : PHASE[phase];
}

/**
 * One place that says what the plugin is doing, what visitors and crawlers
 * get right now, what went wrong and what to do next. Hidden when everything
 * is up to date, so it only takes space when there is something to know.
 */
export function LifecycleNotice(props: {
  lifecycle: Lifecycle | undefined;
  /** This page is driving a generation right now. */
  working: boolean;
  canGenerate: boolean;
  /** Why generating is not possible from this page right now, if it is not. */
  blocked: string;
  onGenerate: () => void;
  onOpenSetup: () => void;
  onOpenChecks: () => void;
}) {
  const { lifecycle } = props;
  if (!lifecycle) return null;
  if (lifecycle.state === "ready" && !lifecycle.attention) return null;
  const state = STATE[lifecycle.state];
  const failing = lifecycle.attention?.code === "generation-failing";
  const serving =
    lifecycle.state === "unconfigured"
      ? ""
      : lifecycle.serving === "exports"
        ? lifecycle.state === "ready"
          ? ""
          : "Your last sitemap and exports stay online while this finishes."
        : "The sitemap, llms.txt and Markdown exports answer “try again later” (503) until the first generation finishes.";
  const action = lifecycle.nextAction.code;
  return (
    <Card>
      {/* Announced politely: the state changes while the owner is elsewhere on the page. */}
      <div role="status" aria-live="polite">
      <Stack gap={8}>
        <Stack direction="row" gap={8} align="center" wrap>
          <Badge tone={failing ? "danger" : state.tone}>{state.label}</Badge>
          {lifecycle.phase && <Text>{progressLine(lifecycle)}</Text>}
        </Stack>
        {lifecycle.attention && <Text>{lifecycle.attention.message}</Text>}
        {lifecycle.lastError && !failing && (
          <Text variant="muted">
            Last attempt failed ({lifecycle.lastError.attempts}×):{" "}
            {lifecycle.lastError.message} It is retried automatically.
          </Text>
        )}
        {serving && <Text variant="muted">{serving}</Text>}
        <Stack direction="row" gap={8} align="center" wrap>
          <Text variant="muted">{lifecycle.nextAction.message}</Text>
          {action === "configure" && (
            <Button variant="secondary" size="sm" onClick={props.onOpenSetup}>
              Open setup
            </Button>
          )}
          {(action === "generate" || action === "resume-schedule" || action === "fix-error") && (
            <Button
              variant="primary"
              size="sm"
              disabled={props.working || !props.canGenerate}
              onClick={props.onGenerate}
            >
              Save &amp; generate
            </Button>
          )}
          {lifecycle.skipped.length > 0 && (
            <Button variant="ghost" size="sm" onClick={props.onOpenChecks}>
              View checks
            </Button>
          )}
        </Stack>
        {!props.canGenerate && !props.working && props.blocked && action !== "configure" && (
          <Text variant="muted">{props.blocked}</Text>
        )}
      </Stack>
      </div>
    </Card>
  );
}
