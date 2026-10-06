import { useState } from "react";
import type { Static } from "@sinclair/typebox";
import {
  Alert,
  Button,
  Heading,
  Input,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@instatic/host-ui";
import type { PageChoicesSchema } from "../../src/adminSchemas";
import { parseOptions, type SiteOptions } from "../../src/config";
import {
  addPage,
  initialConfiguration,
  patchValues,
  serializeOptions,
} from "./model";
import { Profiles } from "./Profiles";
import { Crawlers, Languages, Redirects } from "./GlobalForms";
import { PageForm } from "./PageForm";
import { LinesField } from "./Fields";

type Section =
  | "Website"
  | "Pages"
  | "Business & authors"
  | "Redirects"
  | "Languages"
  | "Crawlers"
  | "AIO";
const sections: Section[] = [
  "Website",
  "Pages",
  "Business & authors",
  "Redirects",
  "Languages",
  "Crawlers",
  "AIO",
];
export function Configuration(props: {
  raw: string;
  onChange: (raw: string) => void;
  onPendingChange: (pending: boolean) => void;
  siteUrl: string;
  onSiteUrlChange: (value: string) => void;
  llms: boolean;
  onLlmsChange: (value: boolean) => void;
  pages: Static<typeof PageChoicesSchema>;
  disabled: boolean;
}) {
  const [initial] = useState(() => initialConfiguration(props.raw));
  const [value, setValue] = useState<SiteOptions>(initial.value);
  const [blocked, setBlocked] = useState(!!initial.error);
  const [section, setSection] = useState<Section>("Website");
  const [selected, setSelected] = useState("");
  const [newPath, setNewPath] = useState("");
  const [advanced, setAdvanced] = useState(!!initial.error);
  const [draft, setDraft] = useState(props.raw);
  const [advancedError, setAdvancedError] = useState(initial.error);
  const [pathError, setPathError] = useState("");
  const [revision, setRevision] = useState(0);
  const dirty = advanced && draft !== props.raw;
  const disabled = props.disabled || blocked || dirty;
  const change = (next: SiteOptions) => {
    const raw = JSON.stringify(next);
    setValue(next);
    setDraft(raw);
    props.onChange(raw);
  };
  let validation = "";
  try {
    parseOptions(props.raw);
  } catch (error) {
    validation =
      error instanceof Error
        ? error.message
        : "Check the configuration fields.";
  }
  const choices = [
    ...new Set([
      ...props.pages.map((page) => page.path),
      ...Object.keys(value.pages ?? {}),
    ]),
  ];
  const path = selected || choices[0] || "";
  const formProps = { value, onChange: change, disabled };
  return (
    <Stack gap={16}>
      <Heading level={2}>Set up SEO, GEO & AIO</Heading>
      <Text>
        Start with Website, then choose the features you need. Published titles,
        descriptions and automatic breadcrumbs work without custom overrides.
        Use Save & generate to update discovery files and published metadata.
      </Text>
      <Stack direction="row" gap={8} wrap>
        {sections.map((item) => (
          <Button
            key={item}
            variant={section === item ? "primary" : "secondary"}
            disabled={props.disabled}
            onClick={() => setSection(item)}
          >
            {item}
          </Button>
        ))}
      </Stack>
      <Stack key={revision} gap={16}>
        {section === "Website" && (
          <>
            <Input
              label="Public website origin"
              description="The domain that serves your public pages. Use only the scheme and domain, without /admin or another path."
              placeholder="https://www.example.com"
              value={props.siteUrl}
              onChange={props.onSiteUrlChange}
              disabled={props.disabled}
              required
            />
            <Text>
              Sitemap location:{" "}
              {props.siteUrl
                ? `${props.siteUrl.replace(/\/$/, "")}/sitemap.xml`
                : "https://www.example.com/sitemap.xml"}
              . Enter your public domain even if the admin panel uses a
              different subdomain.
            </Text>
            <Switch
              label="Publish optional llms.txt"
              description="A readable content index for tools that use it. Google AI Overviews do not require this file."
              checked={props.llms}
              onChange={props.onLlmsChange}
              disabled={props.disabled}
            />
            <LinesField
              label="Public collection tables"
              description="One table slug per line. Blank uses posts. Enable only tables whose entries should appear in public discovery exports; drafts remain excluded."
              placeholder={"posts\nguides"}
              value={value.collectionTables}
              disabled={disabled}
              onChange={(tables) =>
                change(
                  patchValues(value, {
                    collectionTables: tables.length ? tables : undefined,
                  }),
                )
              }
            />
          </>
        )}
        {section === "Pages" && (
          <>
            <Text>
              Select a published page. A manual path can be prepared before
              publication; publish the page in the CMS before it can appear in
              exports.
            </Text>
            {!!choices.length && (
              <Select
                label="Page to configure"
                value={path}
                disabled={disabled}
                options={choices.map((route) => ({
                  value: route,
                  label: `${props.pages.find((page) => page.path === route)?.title || route} — ${route}`,
                }))}
                onChange={setSelected}
              />
            )}
            <Stack gap={8}>
              <Input
                label="Add a page path"
                placeholder="/services/web-design"
                value={newPath}
                onChange={setNewPath}
                disabled={disabled}
              />
              {pathError && (
                <Alert tone="danger" title="Check the page path">
                  {pathError}
                </Alert>
              )}
              <Button
                variant="secondary"
                disabled={disabled || !newPath}
                onClick={() => {
                  try {
                    const added = addPage(value, newPath);
                    change(added.options);
                    setSelected(added.path);
                    setNewPath("");
                    setPathError("");
                  } catch (error) {
                    setPathError(
                      error instanceof Error
                        ? error.message
                        : "Use a path starting with /.",
                    );
                  }
                }}
              >
                Add page
              </Button>
            </Stack>
            {path ? (
              <>
                <Heading level={3}>Page: {path}</Heading>
                <PageForm
                  key={path}
                  value={value.pages?.[path] ?? {}}
                  options={value}
                  disabled={disabled}
                  onChange={(page) =>
                    change({
                      ...value,
                      pages: { ...value.pages, [path]: page },
                    })
                  }
                />
                <Button
                  variant="secondary"
                  disabled={disabled || !value.pages?.[path]}
                  onClick={() => {
                    const pages = { ...value.pages };
                    delete pages[path];
                    change({ ...value, pages });
                    setRevision(revision + 1);
                  }}
                >
                  Reset this page to automatic defaults
                </Button>
              </>
            ) : (
              <Text>
                No published pages found yet. Publish your first page or add its
                path above.
              </Text>
            )}
          </>
        )}
        {section === "Business & authors" && <Profiles {...formProps} />}
        {section === "Redirects" && <Redirects {...formProps} />}
        {section === "Languages" && <Languages {...formProps} />}
        {section === "Crawlers" && <Crawlers {...formProps} />}
        {section === "AIO" && (
          <>
            <Heading level={3}>AI Overview optimisation</Heading>
            <Switch
              label="Enable AIO publication checks"
              description="Review search and snippet access, readable answers, source links, visible authors and accurate dates."
              checked={value.aioEnabled !== false}
              disabled={disabled}
              onChange={(aioEnabled) => change({ ...value, aioEnabled })}
            />
            <Text>
              Google AI Overviews and AI Mode use normal SEO foundations. No
              special AI schema, AI keyword field or extra machine-readable file
              is required. These local checks cannot confirm indexing or promise
              a citation.
            </Text>
            <Text>
              In Pages, add an optional primary question and preferred published
              answer. Edit the real content in the CMS first, then generate to
              see the AIO review below.
            </Text>
            <Text>
              Publish useful original information, first-hand experience and
              concrete examples that answer your visitors’ questions. Search and
              snippet access is a technical check. Answer length, headings and
              attribution are editorial prompts that need your judgement.
            </Text>
          </>
        )}
      </Stack>
      {validation && !blocked && (
        <Alert
          tone="danger"
          title="Complete or correct these settings before saving"
        >
          <Text>{validation}</Text>
          <Text>
            Required fields are marked in the form. URLs need https://; paths
            start with /; dates use the examples shown.
          </Text>
        </Alert>
      )}
      {blocked && (
        <Alert tone="danger" title="Existing configuration needs attention">
          Your stored JSON could not be read. It has been preserved in Advanced
          configuration below. Correct and apply it before using the guided
          controls.
        </Alert>
      )}
      <Switch
        label="Show advanced configuration JSON"
        description="Optional for developers or importing settings. Everyday setup uses the controls above."
        checked={advanced}
        disabled={props.disabled || dirty || blocked}
        onChange={(next) => {
          setAdvanced(next);
          setDraft(props.raw);
          setAdvancedError("");
        }}
      />
      {advanced && (
        <Stack gap={12}>
          <Textarea
            label="Advanced configuration JSON"
            description="Apply changes before saving. Guided fields are paused while this draft differs from the active configuration."
            value={draft}
            onChange={(next) => {
              setDraft(next);
              props.onPendingChange(next !== props.raw);
            }}
            rows={12}
            disabled={props.disabled}
            placeholder={'{\n  "aioEnabled": true\n}'}
          />
          {advancedError && (
            <Alert tone="danger" title="Check the advanced configuration">
              {advancedError}
            </Alert>
          )}
          <Stack direction="row" gap={8} wrap>
            <Button
              variant="secondary"
              disabled={props.disabled}
              onClick={() => {
                try {
                  const next = parseOptions(draft);
                  setValue(next);
                  const raw = serializeOptions(next);
                  props.onChange(raw);
                  setDraft(raw);
                  setBlocked(false);
                  setAdvancedError("");
                  setRevision(revision + 1);
                  props.onPendingChange(false);
                } catch (error) {
                  setAdvancedError(
                    error instanceof Error
                      ? error.message
                      : "Invalid configuration",
                  );
                }
              }}
            >
              Apply JSON changes
            </Button>
            <Button
              variant="secondary"
              disabled={props.disabled || !dirty}
              onClick={() => {
                setDraft(props.raw);
                setAdvancedError("");
                props.onPendingChange(false);
              }}
            >
              Discard JSON draft
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
