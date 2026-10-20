import { useState } from "react";
import {
  Alert,
  Button,
  Input,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@instatic/host-ui";
import {
  analyticsActive,
  detectProviders,
  snippetHosts,
  type AnalyticsOptions,
} from "../../src/analyticsConfig";
import { Badge, Grid, Section } from "./ui";

const EXAMPLES: Array<{ name: string; code: string }> = [
  {
    name: "Plausible",
    code: '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>',
  },
  {
    name: "Fathom",
    code: '<script src="https://cdn.usefathom.com/script.js" data-site="ABCDEFG" defer></script>',
  },
  {
    name: "Umami",
    code: '<script defer src="https://cloud.umami.is/script.js" data-website-id="your-website-id"></script>',
  },
  {
    name: "Microsoft Clarity",
    code: '<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","your-project-id");</script>',
  },
];

export function AnalyticsTags(props: {
  value: AnalyticsOptions;
  onChange: (next: AnalyticsOptions) => void;
  error: string;
  disabled: boolean;
  dirty: boolean;
  actions: React.ReactNode;
}) {
  const { value } = props;
  const [hostsText, setHostsText] = useState((value.allowedHosts ?? []).join("\n"));
  const set = (patch: Partial<AnalyticsOptions>) => {
    const next: AnalyticsOptions = { ...value, ...patch };
    // Drop empty fields so the stored JSON stays tidy.
    for (const key of Object.keys(next) as Array<keyof AnalyticsOptions>) {
      const field = next[key];
      if (field === "" || (Array.isArray(field) && !field.length)) delete next[key];
    }
    props.onChange(next);
  };
  const providers = detectProviders(value);
  const active = analyticsActive(value);
  const detected = snippetHosts((value.headCode ?? "") + "\n" + (value.bodyCode ?? ""));
  return (
    <Stack gap={16}>
      <Section
        title="Analytics & tracking tags"
        description="Paste the tracking code from Google Analytics, Google Tag Manager or any other analytics tool. It is added to every published page and allowed through your site's security policy automatically."
      >
        <Stack direction="row" gap={8} wrap align="center">
          {active ? (
            providers.map((name) => (
              <Badge key={name} tone="good">
                {name}
              </Badge>
            ))
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )}
          {props.dirty && <Badge tone="warning">Unsaved changes</Badge>}
        </Stack>
        <Switch
          label="Add tracking tags to published pages"
          description="Turn off to pause every tag below without deleting it."
          checked={value.enabled !== false}
          disabled={props.disabled}
          onChange={(enabled) => set({ enabled: enabled ? undefined : false })}
        />
        <Alert tone="info" title="Privacy and consent">
          In the EU, UK and many other regions, analytics that use cookies usually need visitor
          consent first. Use a consent banner, or a cookieless tool such as Plausible, Fathom or
          Umami. You are responsible for the tags you add.
        </Alert>
      </Section>

      <Grid min={340}>
        <Section
          title="Google quick setup"
          description="Only the ID is needed. The official Google snippet is added for you."
        >
          <Input
            label="Google Analytics 4 measurement ID"
            placeholder="G-ABC123XYZ"
            description="GA4 → Admin → Data streams → your web stream."
            value={value.ga4Id ?? ""}
            disabled={props.disabled}
            onChange={(ga4Id) => set({ ga4Id: ga4Id.trim().toUpperCase() })}
          />
          <Input
            label="Google Tag Manager container ID"
            placeholder="GTM-AB12CD3"
            description="Tag Manager → Workspace, top bar. Use GA4 or Tag Manager, not both for the same property."
            value={value.gtmId ?? ""}
            disabled={props.disabled}
            onChange={(gtmId) => set({ gtmId: gtmId.trim().toUpperCase() })}
          />
          <Switch
            label="Start with consent denied (Google Consent Mode v2)"
            description="Google tags wait for your consent banner to grant analytics storage. Turn on only if your banner updates Google consent."
            checked={value.consentDefaultDenied === true}
            disabled={props.disabled || !(value.ga4Id || value.gtmId)}
            onChange={(consentDefaultDenied) =>
              set({ consentDefaultDenied: consentDefaultDenied || undefined })
            }
          />
        </Section>

        <Section
          title="Any other tool"
          description="Paste the complete snippet exactly as your analytics tool gives it, including the <script> tags."
        >
          <Textarea
            label="Code for the <head>"
            description="Most tools ask for this placement."
            rows={7}
            placeholder={'<script defer src="https://plausible.io/js/script.js" data-domain="example.com"></script>'}
            value={value.headCode ?? ""}
            disabled={props.disabled}
            onChange={(headCode) => set({ headCode })}
          />
          <Textarea
            label="Code before </body>"
            description="For tools that ask to load at the end of the page."
            rows={4}
            value={value.bodyCode ?? ""}
            disabled={props.disabled}
            onChange={(bodyCode) => set({ bodyCode })}
          />
          <Stack direction="row" gap={8} wrap align="center">
            <Text variant="muted">Insert an example:</Text>
            {EXAMPLES.map((example) => (
              <Button
                key={example.name}
                variant="ghost"
                size="sm"
                disabled={props.disabled}
                onClick={() =>
                  set({
                    headCode: [value.headCode?.trim(), example.code].filter(Boolean).join("\n"),
                  })
                }
              >
                {example.name}
              </Button>
            ))}
          </Stack>
        </Section>
      </Grid>

      <Section
        title="Allowed domains"
        description="Domains in your snippets are allowed automatically. Add any extra domain a tool sends data to (check the browser console for blocked requests), one per line."
      >
        {!!detected.length && (
          <Stack direction="row" gap={6} wrap>
            {detected.map((host) => (
              <Badge key={host} tone="neutral">
                {host.replace("https://", "")}
              </Badge>
            ))}
          </Stack>
        )}
        <Textarea
          label="Extra allowed domains"
          rows={3}
          placeholder={"stats.example.com\n*.example-analytics.com"}
          value={hostsText}
          disabled={props.disabled}
          onChange={(raw) => {
            setHostsText(raw);
            set({
              allowedHosts: raw
                .split("\n")
                .map((line) => line.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase())
                .filter(Boolean),
            });
          }}
        />
        <Text variant="muted">
          Tag Manager "Custom HTML" tags and tools that run code from strings may still be blocked
          by the site's security policy. Prefer each tool's standard tag.
        </Text>
      </Section>

      {props.error && (
        <Alert tone="danger" title="Check the analytics settings">
          {props.error}
        </Alert>
      )}
      <Section
        title="Publish your tags"
        description="Save & generate adds the tags to every published page. Then open your site and confirm the tool shows a live visitor."
      >
        {props.actions}
      </Section>
    </Stack>
  );
}
