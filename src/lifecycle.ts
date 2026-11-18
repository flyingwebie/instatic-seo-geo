import { Type, type Static } from "@sinclair/typebox";

/**
 * The generation lifecycle as one explicit state value.
 *
 * The stored records (`current`, `pending`, `automation`) are the source of
 * truth; `deriveLifecycle` is the only place that turns them into a state, a
 * phase and a recommended next action. The admin page, `/status` and any
 * agent read the same answer. See docs/state-machines.md for the diagram.
 */

/** How many times one step may fail before a skippable step is skipped. */
export const MAX_ATTEMPTS = 3;
/** The schedule runs every minute; this long without a run means it is not running. */
export const AUTOMATION_SILENT_MS = 15 * 60_000;

export const SkippedSchema = Type.Object({
  /** `documents` (page left out of exports) or `images` (page keeps its own image). */
  step: Type.String(),
  path: Type.String(),
  message: Type.String(),
});
export type Skipped = Static<typeof SkippedSchema>;

/** The step a batch is about to run, counted so a step that kills the batch is noticed. */
export const AttemptSchema = Type.Object({
  step: Type.String(),
  count: Type.Integer(),
  error: Type.Optional(Type.String()),
  at: Type.Optional(Type.String()),
});
export type Attempt = Static<typeof AttemptSchema>;

export const AutomationSchema = Type.Object({
  /** First time any generation batch ran with this plugin version (ms). */
  since: Type.Number(),
  /** Last time the host's scheduled job called the plugin (ms). */
  scheduledAt: Type.Optional(Type.Number()),
});
export type Automation = Static<typeof AutomationSchema>;

const literals = <T extends string>(...values: T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

export const LIFECYCLE_STATES = [
  "unconfigured",
  "never-generated",
  "generating",
  "outdated",
  "ready",
] as const;
export const LIFECYCLE_PHASES = ["documents", "images", "html", "commit"] as const;
export const NEXT_ACTIONS = [
  "configure",
  "generate",
  "wait",
  "resume-schedule",
  "fix-error",
  "none",
] as const;
export const ATTENTION_CODES = [
  "generation-failing",
  "automation-silent",
  "pages-skipped",
] as const;

export const LifecycleSchema = Type.Object({
  /**
   * - `unconfigured`: no website address saved.
   * - `never-generated`: configured, nothing generated or in progress.
   * - `generating`: a generation is in progress (see `phase`).
   * - `outdated`: content or settings changed since the last generation and no run has started yet.
   * - `ready`: the last generation matches the published content and the settings.
   */
  state: literals(...LIFECYCLE_STATES),
  /** Whether /sitemap.xml, /llms.txt and /markdown/* are answered right now. */
  serving: literals("exports", "nothing"),
  phase: Type.Optional(literals(...LIFECYCLE_PHASES)),
  progress: Type.Optional(
    Type.Object({
      documents: Type.Integer(),
      images: Type.Integer(),
      html: Type.Integer(),
      total: Type.Integer(),
    }),
  ),
  /** The most important problem a person or agent should look at, if any. */
  attention: Type.Optional(
    Type.Object({
      code: literals(...ATTENTION_CODES),
      message: Type.String(),
    }),
  ),
  /** The last failure of the step in progress. Cleared when the step succeeds. */
  lastError: Type.Optional(
    Type.Object({
      step: Type.String(),
      message: Type.String(),
      attempts: Type.Integer(),
      at: Type.String(),
    }),
  ),
  /** Pages left out of the run so one bad page cannot block the others. */
  skipped: Type.Array(SkippedSchema),
  automation: Type.Object({
    /** ISO time of the last scheduled run, or "" when none was seen yet. */
    lastRunAt: Type.String(),
    silent: Type.Boolean(),
  }),
  nextAction: Type.Object({
    code: literals(...NEXT_ACTIONS),
    message: Type.String(),
  }),
});
export type Lifecycle = Static<typeof LifecycleSchema>;
export type LifecycleState = Lifecycle["state"];
export type LifecyclePhase = NonNullable<Lifecycle["phase"]>;

export type LifecycleInput = {
  configured: boolean;
  /** The committed generation, if any. */
  current?: {
    /** Its exports may be served under the settings saved now. */
    servable: boolean;
    /** It matches both the published content and every saved setting. */
    fresh: boolean;
    skipped?: readonly Skipped[];
  };
  /** The generation in progress, if any. */
  pending?: {
    /** It was started for the content and settings saved now. */
    matches: boolean;
    offset: number;
    htmlOffset: number;
    imageOffset: number;
    total: number;
    attempt?: Attempt;
    skipped?: readonly Skipped[];
  };
  automation?: Automation;
  now: number;
};

const PHASE_OF_STEP: Record<string, LifecyclePhase> = {
  documents: "documents",
  images: "images",
  html: "html",
  commit: "commit",
};

/** The phase a pending generation is in, from its last started step and offsets. */
export function phaseOf(pending: NonNullable<LifecycleInput["pending"]>): LifecyclePhase {
  if (pending.offset < pending.total) return "documents";
  const started = PHASE_OF_STEP[pending.attempt?.step.split(":")[0] ?? ""];
  if (started && started !== "documents") return started;
  return pending.htmlOffset < pending.total ? "html" : "commit";
}

const STEP_LABEL: Record<LifecyclePhase, string> = {
  documents: "reading a page",
  images: "creating a social image",
  html: "refreshing the public pages",
  commit: "publishing the new sitemap and exports",
};

export function deriveLifecycle(input: LifecycleInput): Lifecycle {
  const { current, automation, now } = input;
  const pending = input.pending?.matches ? input.pending : undefined;
  const lastSeen = Math.max(automation?.scheduledAt ?? 0, automation?.since ?? 0);
  const silent = !!automation && now - lastSeen > AUTOMATION_SILENT_MS;
  const automationView = {
    lastRunAt: automation?.scheduledAt
      ? new Date(automation.scheduledAt).toISOString()
      : "",
    silent,
  };
  const serving = input.configured && current?.servable ? "exports" : "nothing";
  if (!input.configured)
    return {
      state: "unconfigured",
      serving: "nothing",
      skipped: [],
      automation: automationView,
      nextAction: {
        code: "configure",
        message: "Add your public website address in Setup → Website, then save and generate.",
      },
    };

  const state: LifecycleState = pending
    ? "generating"
    : current?.fresh
      ? "ready"
      : current || input.pending
        ? "outdated"
        : "never-generated";
  const phase = pending ? phaseOf(pending) : undefined;
  const skipped = [...(pending?.skipped ?? current?.skipped ?? [])];
  const attempt = pending?.attempt;
  const lastError =
    attempt?.error && phase
      ? {
          step: attempt.step,
          message: attempt.error,
          attempts: attempt.count,
          at: attempt.at ?? "",
        }
      : undefined;

  let attention: Lifecycle["attention"];
  let nextAction: Lifecycle["nextAction"];
  if (lastError && phase && lastError.attempts >= MAX_ATTEMPTS) {
    attention = {
      code: "generation-failing",
      message: `Generation keeps failing while ${STEP_LABEL[phase]}: ${lastError.message}`,
    };
    nextAction = {
      code: "fix-error",
      message:
        "Fix the reported problem, then choose Save & generate. The last good sitemap and exports stay online meanwhile.",
    };
  } else if (state !== "ready" && silent) {
    attention = {
      code: "automation-silent",
      message:
        "Automatic background updates are not running, so changes are only applied while this page generates them.",
    };
    nextAction = {
      code: "resume-schedule",
      message:
        "Choose Save & generate now. Then open Plugins → SEO, GEO & AIO → Schedules and resume “publication-sync”; Instatic pauses a schedule after five failed runs.",
    };
  } else if (state === "generating") {
    nextAction = {
      code: "wait",
      message: "Generation is in progress and continues automatically every minute.",
    };
  } else if (state === "ready") {
    nextAction = { code: "none", message: "Everything is up to date." };
  } else {
    nextAction = {
      code: "generate",
      message:
        state === "outdated"
          ? "Published content or settings changed. Choose Save & generate, or wait for the next automatic run."
          : "Choose Save & generate to create the sitemap, exports and page metadata.",
    };
  }
  if (skipped.length && attention?.code !== "generation-failing") {
    const pages = skipped.filter((item) => item.step === "documents").length;
    const images = skipped.filter((item) => item.step === "images").length;
    const parts = [
      pages && `${pages} ${pages === 1 ? "page was" : "pages were"} left out of the sitemap and exports`,
      images && `social images could not be created for some pages, which keep their own image`,
      skipped.length - pages - images && "automatic redirects were reset",
    ].filter(Boolean);
    const message = `In the last run ${parts.join("; ")}. See Checks for the reasons.`;
    // A paused schedule must not hide that a page is missing from the sitemap.
    attention = attention
      ? { code: attention.code, message: `${attention.message} ${message}` }
      : { code: "pages-skipped", message };
  }

  return {
    state,
    serving,
    ...(phase ? { phase } : {}),
    ...(pending
      ? {
          progress: {
            documents: pending.offset,
            images: pending.imageOffset,
            html: pending.htmlOffset,
            total: pending.total,
          },
        }
      : {}),
    ...(attention ? { attention } : {}),
    ...(lastError ? { lastError } : {}),
    skipped,
    automation: automationView,
    nextAction,
  };
}

/** Message plus stack: the sandbox console prints only the stack of an Error. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const head = `${error.name}: ${error.message}`;
  return error.stack && !error.stack.includes(error.message)
    ? `${head}\n${error.stack}`
    : (error.stack ?? head);
}
