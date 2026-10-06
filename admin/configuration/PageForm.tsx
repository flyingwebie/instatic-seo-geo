import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Heading,
  Input,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@instatic/host-ui";
import type { PageOptions, SiteOptions } from "../../src/config";
import { optionalText, patchValues } from "./model";
import { Schemas } from "./Schemas";

export function PageForm({
  value,
  options,
  onChange,
  disabled,
}: {
  value: PageOptions;
  options: SiteOptions;
  onChange: (value: PageOptions) => void;
  disabled: boolean;
}) {
  const [metadata, setMetadata] = useState(
    [
      value.title,
      value.description,
      value.canonical,
      value.image,
      value.language,
    ].some((item) => item !== undefined),
  );
  const [faqsEnabled, setFaqsEnabled] = useState(!!value.faqs?.length);
  const [crumbsEnabled, setCrumbsEnabled] = useState(
    value.breadcrumbs !== undefined,
  );
  const [snippetLimit, setSnippetLimit] = useState(
    value.maxSnippet === undefined ? "" : String(value.maxSnippet),
  );
  const update = (patch: Partial<PageOptions>) =>
    onChange(patchValues(value, patch));
  const faqs = value.faqs ?? [],
    crumbs = value.breadcrumbs ?? [];
  return (
    <Stack gap={16}>
      <Switch
        label="Custom page metadata"
        description="Enable to override individual fields. Blank fields use the published page’s metadata and automatic defaults."
        checked={metadata}
        disabled={disabled}
        onChange={(next) => {
          setMetadata(next);
          if (!next)
            update({
              title: undefined,
              description: undefined,
              canonical: undefined,
              image: undefined,
              language: undefined,
            });
        }}
      />
      {metadata && (
        <Stack gap={12}>
          <Input
            label="Search title"
            placeholder="Web design in Dublin | Example Studio"
            value={value.title ?? ""}
            onChange={(title) => update({ title: optionalText(title) })}
            disabled={disabled}
          />
          <Textarea
            label="Search description"
            placeholder="Describe what visitors will find and why this page is useful."
            description="Write a clear, accurate summary. Search engines may choose a different snippet."
            value={value.description ?? ""}
            onChange={(description) =>
              update({ description: optionalText(description) })
            }
            rows={3}
            disabled={disabled}
          />
          <Input
            label="Canonical URL"
            description="Usually leave blank. Set only when another full URL is the preferred version."
            placeholder="https://example.com/services/web-design"
            value={value.canonical ?? ""}
            onChange={(canonical) =>
              update({ canonical: optionalText(canonical) })
            }
            disabled={disabled}
          />
          <Input
            label="Social sharing image URL"
            placeholder="https://example.com/uploads/web-design.jpg"
            value={value.image ?? ""}
            onChange={(image) => update({ image: optionalText(image) })}
            disabled={disabled}
          />
          <Input
            label="Page language"
            placeholder="en-IE"
            value={value.language ?? ""}
            onChange={(language) =>
              update({ language: optionalText(language) })
            }
            disabled={disabled}
          />
        </Stack>
      )}
      <Heading level={4}>Indexing & snippets</Heading>
      <Select
        label="Search indexing"
        value={
          value.index === undefined
            ? "inherit"
            : value.index
              ? "allow"
              : "block"
        }
        disabled={disabled}
        options={[
          { value: "inherit", label: "Use published page settings" },
          { value: "allow", label: "Allow indexing (index)" },
          { value: "block", label: "Request no indexing (noindex)" },
        ]}
        onChange={(next) =>
          update({ index: next === "inherit" ? undefined : next === "allow" })
        }
      />
      <Select
        label="Following page links"
        value={
          value.follow === undefined
            ? "inherit"
            : value.follow
              ? "allow"
              : "block"
        }
        disabled={disabled}
        options={[
          { value: "inherit", label: "Use published page settings" },
          { value: "allow", label: "Allow following links (follow)" },
          { value: "block", label: "Request no following links (nofollow)" },
        ]}
        onChange={(next) =>
          update({ follow: next === "inherit" ? undefined : next === "allow" })
        }
      />
      <Select
        label="Search and AI Overview snippets"
        description="Google AI supporting links require snippet eligibility. Existing crawler-specific and data-nosnippet restrictions still apply."
        value={
          value.snippetAllowed === undefined
            ? "inherit"
            : value.snippetAllowed
              ? "allow"
              : "block"
        }
        disabled={disabled}
        options={[
          { value: "inherit", label: "Preserve published snippet controls" },
          {
            value: "allow",
            label: "Allow snippets in generic robots metadata",
          },
          { value: "block", label: "Disable snippets (nosnippet)" },
        ]}
        onChange={(next) =>
          update({
            snippetAllowed: next === "inherit" ? undefined : next === "allow",
          })
        }
      />
      <Input
        label="Maximum snippet characters (optional)"
        description="Blank preserves the published limit. -1 means no limit; 0 disables text snippets. Use a whole number."
        placeholder="-1"
        value={snippetLimit}
        disabled={disabled}
        onChange={(raw) => {
          setSnippetLimit(raw);
          update({ maxSnippet: raw.trim() === "" ? undefined : Number(raw) });
        }}
      />
      <Heading level={4}>Article & authors</Heading>
      <Select
        label="Article structured data"
        description="Automatic enables Article for public collection entries. Use None for pages that are not articles."
        value={value.articleType ?? "auto"}
        disabled={disabled}
        options={[
          { value: "auto", label: "Automatic from page type" },
          { value: "none", label: "None" },
          { value: "Article", label: "Article" },
          { value: "BlogPosting", label: "Blog post" },
          { value: "NewsArticle", label: "News article" },
        ]}
        onChange={(next) =>
          update({ articleType: next === "auto" ? undefined : next })
        }
      />
      <Text>
        Select the authors whose bylines appear on this page. Add profiles in
        Business & authors first.
      </Text>
      {(options.profiles ?? []).map((profile) => (
        <Checkbox
          key={profile.id}
          label={profile.name || "Unnamed profile"}
          checked={value.authors?.includes(profile.id) ?? false}
          disabled={disabled}
          onChange={(checked) =>
            update({
              authors: checked
                ? [...new Set([...(value.authors ?? []), profile.id])]
                : value.authors?.filter((id) => id !== profile.id),
            })
          }
        />
      ))}
      <Input
        label="Original publication date (optional)"
        description="Blank uses the actual publication date. Never invent a more recent date."
        placeholder="2026-10-06T09:00:00Z"
        value={value.datePublished ?? ""}
        disabled={disabled}
        onChange={(datePublished) =>
          update({ datePublished: optionalText(datePublished) })
        }
      />
      <Input
        label="Actual modification date (optional)"
        placeholder="2026-10-06T11:30:00Z"
        value={value.dateModified ?? ""}
        disabled={disabled}
        onChange={(dateModified) =>
          update({ dateModified: optionalText(dateModified) })
        }
      />
      <Switch
        label="FAQ structured data"
        description="Copy questions and answers already visible on this page. The plugin omits entries absent from published content; FAQ schema describes your content; Google retired FAQ rich results in May 2026."
        checked={faqsEnabled}
        disabled={disabled}
        onChange={(next) => {
          setFaqsEnabled(next);
          if (!next) update({ faqs: undefined });
        }}
      />
      {faqsEnabled && (
        <>
          {faqs.map((faq, index) => (
            <Card key={index}>
              <Stack gap={8}>
                <Input
                  label={`Question ${index + 1}`}
                  placeholder="How long does a website project take?"
                  value={faq.question}
                  required
                  disabled={disabled}
                  onChange={(question) =>
                    update({
                      faqs: faqs.map((item, i) =>
                        i === index ? { ...item, question } : item,
                      ),
                    })
                  }
                />
                <Textarea
                  label="Published answer"
                  placeholder="Most projects take four to six weeks, depending on the agreed scope."
                  value={faq.answer}
                  required
                  disabled={disabled}
                  rows={3}
                  onChange={(answer) =>
                    update({
                      faqs: faqs.map((item, i) =>
                        i === index ? { ...item, answer } : item,
                      ),
                    })
                  }
                />
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() =>
                    update({ faqs: faqs.filter((_, i) => i !== index) })
                  }
                >
                  Remove FAQ
                </Button>
              </Stack>
            </Card>
          ))}
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              update({ faqs: [...faqs, { question: "", answer: "" }] })
            }
          >
            Add FAQ
          </Button>
        </>
      )}
      <Switch
        label="Custom breadcrumbs"
        description="Automatic Home → page breadcrumbs are generated by default. Enable to supply your real navigation hierarchy."
        checked={crumbsEnabled}
        disabled={disabled}
        onChange={(next) => {
          setCrumbsEnabled(next);
          if (!next) update({ breadcrumbs: undefined });
        }}
      />
      {crumbsEnabled && (
        <>
          {crumbs.map((crumb, index) => (
            <Stack key={index} gap={8}>
              <Input
                label="Breadcrumb label"
                placeholder="Services"
                value={crumb.name}
                required
                disabled={disabled}
                onChange={(name) =>
                  update({
                    breadcrumbs: crumbs.map((item, i) =>
                      i === index ? { ...item, name } : item,
                    ),
                  })
                }
              />
              <Input
                label="Breadcrumb path"
                placeholder="/services"
                value={crumb.path}
                required
                disabled={disabled}
                onChange={(path) =>
                  update({
                    breadcrumbs: crumbs.map((item, i) =>
                      i === index ? { ...item, path } : item,
                    ),
                  })
                }
              />
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() =>
                  update({ breadcrumbs: crumbs.filter((_, i) => i !== index) })
                }
              >
                Remove breadcrumb
              </Button>
            </Stack>
          ))}
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              update({ breadcrumbs: [...crumbs, { name: "", path: "" }] })
            }
          >
            Add breadcrumb
          </Button>
        </>
      )}
      <Schemas
        value={value.schemas}
        onChange={(schemas) => update({ schemas })}
        disabled={disabled}
      />
      <Heading level={4}>AIO editorial brief</Heading>
      <Text>
        These optional checks compare your brief with published content. They do
        not add text, change answers or create an AI-specific schema.
      </Text>
      <Input
        label="Primary question or topic"
        placeholder="How long does a website project take?"
        value={value.aioQuestion ?? ""}
        onChange={(aioQuestion) =>
          update({ aioQuestion: optionalText(aioQuestion) })
        }
        disabled={disabled}
      />
      <Textarea
        label="Preferred published answer"
        placeholder="Copy a clear, concise paragraph that already answers the question on this page."
        value={value.aioAnswer ?? ""}
        onChange={(aioAnswer) => update({ aioAnswer: optionalText(aioAnswer) })}
        rows={3}
        disabled={disabled}
      />
    </Stack>
  );
}
