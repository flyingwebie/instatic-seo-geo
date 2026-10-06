import { useState } from "react";
import {
  Button,
  Card,
  Heading,
  Input,
  Select,
  Stack,
  Switch,
  Text,
} from "@instatic/host-ui";
import { LinesField } from "./Fields";
import { patchValues, type FormProps } from "./model";

export function Crawlers({ value, onChange, disabled }: FormProps) {
  return (
    <Stack gap={12}>
      <Heading level={3}>Crawler access</Heading>
      <Text>
        Search access, AI training and user-requested retrieval are separate
        choices. Robots rules are requests to compliant crawlers; they do not
        secure private content.
      </Text>
      <Switch
        label="Allow search crawlers"
        description="Allow the search crawler groups managed by this plugin. Disable to request that they stop crawling the website."
        checked={value.searchAllowed !== false}
        onChange={(searchAllowed) => onChange({ ...value, searchAllowed })}
        disabled={disabled}
      />
      <Switch
        label="Allow AI training crawlers"
        description="Disabled by default. Enable to allow the training crawler groups listed in the generated robots.txt."
        checked={value.trainingAllowed === true}
        onChange={(trainingAllowed) => onChange({ ...value, trainingAllowed })}
        disabled={disabled}
      />
      <Switch
        label="Allow user-requested AI retrieval"
        description="Allow the user-retrieval crawler groups managed by this plugin. Some providers’ user-triggered fetches may ignore robots.txt."
        checked={value.userRetrievalAllowed !== false}
        onChange={(userRetrievalAllowed) =>
          onChange({ ...value, userRetrievalAllowed })
        }
        disabled={disabled}
      />
      <LinesField
        label="Exclude paths and their descendants"
        description="One path per line. Removes matching pages from discovery exports while leaving HTML crawlable. For search removal, set noindex on the page; this exclusion is not access control."
        placeholder={"/private\n/members"}
        value={value.excludedPaths}
        onChange={(excludedPaths) => onChange({ ...value, excludedPaths })}
        disabled={disabled}
      />
    </Stack>
  );
}
export function Redirects({ value, onChange, disabled }: FormProps) {
  const [enabled, setEnabled] = useState(!!value.redirects?.length);
  const entries = value.redirects ?? [];
  return (
    <Stack gap={12}>
      <Heading level={3}>Permanent redirects</Heading>
      <Switch
        label="Configure redirects"
        description="Move an old public URL to its published replacement. Avoid redirect loops and chains."
        checked={enabled}
        disabled={disabled}
        onChange={(next) => {
          setEnabled(next);
          if (!next) onChange(patchValues(value, { redirects: undefined }));
        }}
      />
      {enabled && (
        <>
          {entries.map((entry, index) => {
            const update = (patch: Partial<typeof entry>) =>
              onChange({
                ...value,
                redirects: entries.map((item, i) =>
                  i === index ? { ...item, ...patch } : item,
                ),
              });
            return (
              <Card key={index}>
                <Stack gap={12}>
                  <Input
                    label="Old path"
                    placeholder="/old-service"
                    value={entry.from}
                    onChange={(from) => update({ from })}
                    required
                    disabled={disabled}
                  />
                  <Input
                    label="New published path"
                    placeholder="/services/web-design"
                    value={entry.to}
                    onChange={(to) => update({ to })}
                    required
                    disabled={disabled}
                  />
                  <Select
                    label="Redirect response"
                    value={String(entry.status ?? 301)}
                    options={[
                      { value: "301", label: "301 — permanent move" },
                      {
                        value: "308",
                        label: "308 — permanent, preserve request method",
                      },
                    ]}
                    onChange={(status) =>
                      update({ status: status === "308" ? 308 : 301 })
                    }
                    disabled={disabled}
                  />
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...value,
                        redirects: entries.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove redirect
                  </Button>
                </Stack>
              </Card>
            );
          })}
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                redirects: [...entries, { from: "", to: "", status: 301 }],
              })
            }
          >
            Add redirect
          </Button>
        </>
      )}
    </Stack>
  );
}
export function Languages({ value, onChange, disabled }: FormProps) {
  const [enabled, setEnabled] = useState(!!value.translations?.length);
  const groups = value.translations ?? [];
  return (
    <Stack gap={12}>
      <Heading level={3}>Language versions</Heading>
      <Switch
        label="Connect translated pages"
        description="Group published pages with the same content in different languages. The plugin generates reciprocal hreflang links."
        checked={enabled}
        disabled={disabled}
        onChange={(next) => {
          setEnabled(next);
          if (!next) onChange(patchValues(value, { translations: undefined }));
        }}
      />
      {enabled && (
        <>
          {groups.map((group, index) => {
            const update = (next: typeof group) =>
              onChange({
                ...value,
                translations: groups.map((item, i) =>
                  i === index ? next : item,
                ),
              });
            return (
              <Card key={index}>
                <Stack gap={12}>
                  <Heading level={4}>Translation group {index + 1}</Heading>
                  {group.map((entry, row) => (
                    <Stack key={row} gap={8}>
                      <Input
                        label="Published page path"
                        placeholder={row ? "/fr/services" : "/services"}
                        value={entry.path}
                        required
                        disabled={disabled}
                        onChange={(path) =>
                          update(
                            group.map((item, i) =>
                              i === row ? { ...item, path } : item,
                            ),
                          )
                        }
                      />
                      <Input
                        label="Language code"
                        description="Examples: en-IE, fr, de-DE. Use x-default once for a language chooser or default page."
                        placeholder={row ? "fr" : "en-IE"}
                        value={entry.language}
                        required
                        disabled={disabled}
                        onChange={(language) =>
                          update(
                            group.map((item, i) =>
                              i === row ? { ...item, language } : item,
                            ),
                          )
                        }
                      />
                      <Button
                        variant="secondary"
                        disabled={disabled}
                        onClick={() =>
                          update(group.filter((_, i) => i !== row))
                        }
                      >
                        Remove language version
                      </Button>
                    </Stack>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      update([...group, { path: "", language: "" }])
                    }
                  >
                    Add language version
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...value,
                        translations: groups.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove translation group
                  </Button>
                </Stack>
              </Card>
            );
          })}
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                translations: [
                  ...groups,
                  [
                    { path: "", language: "" },
                    { path: "", language: "" },
                  ],
                ],
              })
            }
          >
            Add translation group
          </Button>
        </>
      )}
    </Stack>
  );
}
