import { useState } from "react";
import type { Static } from "@sinclair/typebox";
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
import type { SpecializedSchema } from "../../src/config";
import { patchValues } from "./model";

type Entity = Static<typeof SpecializedSchema>;
type EntityType = Entity["type"];
const defaults: Record<EntityType, Entity> = {
  Product: { type: "Product", name: "" },
  Event: {
    type: "Event",
    name: "",
    startDate: "",
    locationName: "",
    address: "",
  },
  LocalBusiness: { type: "LocalBusiness", name: "", address: "" },
  VideoObject: {
    type: "VideoObject",
    name: "",
    description: "",
    thumbnailUrl: "",
    uploadDate: "",
  },
};
const fields: Record<
  EntityType,
  { key: string; label: string; placeholder: string; required?: boolean }[]
> = {
  Product: [
    {
      key: "name",
      label: "Product name",
      placeholder: "Handmade oak desk",
      required: true,
    },
    {
      key: "description",
      label: "Product description",
      placeholder: "A solid oak desk made in Dublin",
    },
    {
      key: "image",
      label: "Product image URL",
      placeholder: "https://example.com/uploads/desk.jpg",
    },
    { key: "sku", label: "Product code / SKU", placeholder: "DESK-001" },
    { key: "price", label: "Displayed price", placeholder: "249.00" },
    { key: "currency", label: "Currency code", placeholder: "EUR" },
  ],
  Event: [
    {
      key: "name",
      label: "Event name",
      placeholder: "Dublin design workshop",
      required: true,
    },
    {
      key: "startDate",
      label: "Start date and time",
      placeholder: "2026-11-12T10:00:00+00:00",
      required: true,
    },
    {
      key: "endDate",
      label: "End date and time",
      placeholder: "2026-11-12T16:00:00+00:00",
    },
    {
      key: "locationName",
      label: "Venue name",
      placeholder: "Example Conference Centre",
      required: true,
    },
    {
      key: "address",
      label: "Venue address",
      placeholder: "123 Example Street, Dublin, Ireland",
      required: true,
    },
    {
      key: "description",
      label: "Event description",
      placeholder: "A practical workshop for local designers",
    },
    {
      key: "image",
      label: "Event image URL",
      placeholder: "https://example.com/uploads/workshop.jpg",
    },
  ],
  LocalBusiness: [
    {
      key: "name",
      label: "Business name",
      placeholder: "Example Design Studio",
      required: true,
    },
    {
      key: "address",
      label: "Public business address",
      placeholder: "123 Example Street, Dublin, Ireland",
      required: true,
    },
    {
      key: "telephone",
      label: "Business telephone",
      placeholder: "+353 1 234 5678",
    },
    { key: "priceRange", label: "Displayed price range", placeholder: "€€" },
    {
      key: "image",
      label: "Business image URL",
      placeholder: "https://example.com/uploads/studio.jpg",
    },
  ],
  VideoObject: [
    {
      key: "name",
      label: "Video title",
      placeholder: "How to choose a website platform",
      required: true,
    },
    {
      key: "description",
      label: "Video description",
      placeholder: "A practical comparison of website platforms",
      required: true,
    },
    {
      key: "thumbnailUrl",
      label: "Thumbnail URL",
      placeholder: "https://example.com/uploads/video-cover.jpg",
      required: true,
    },
    {
      key: "uploadDate",
      label: "Actual upload date",
      placeholder: "2026-10-06T09:00:00Z",
      required: true,
    },
    {
      key: "contentUrl",
      label: "Video file URL",
      placeholder: "https://example.com/uploads/video.mp4",
    },
    {
      key: "embedUrl",
      label: "Video player URL",
      placeholder: "https://www.youtube.com/embed/VIDEO_ID",
    },
    {
      key: "duration",
      label: "Duration in ISO format",
      placeholder: "PT3M20S",
    },
  ],
};
export function Schemas({
  value,
  onChange,
  disabled,
}: {
  value: Entity[] | undefined;
  onChange: (value: Entity[] | undefined) => void;
  disabled: boolean;
}) {
  const [enabled, setEnabled] = useState(!!value?.length);
  const [type, setType] = useState<EntityType>("LocalBusiness");
  const entries = value ?? [];
  return (
    <Stack gap={12}>
      <Switch
        label="Add specialised structured data"
        description="Use Product, Event, LocalBusiness or VideoObject only where these entities are described in the visible page."
        checked={enabled}
        disabled={disabled}
        onChange={(next) => {
          setEnabled(next);
          if (!next) onChange(undefined);
        }}
      />
      {enabled && (
        <>
          <Text>
            WebPage and automatic breadcrumbs are already generated. Article and
            FAQ controls are above. Blank optional fields are omitted.
          </Text>
          {entries.map((entity, index) => {
            const update = (key: string, value: string | undefined) =>
              onChange(
                entries.map((item, i) =>
                  i === index ? patchValues(item, { [key]: value }) : item,
                ),
              );
            return (
              <Card key={`${index}-${entity.type}`}>
                <Stack gap={12}>
                  <Heading level={4}>
                    {entity.type} {index + 1}
                  </Heading>
                  {fields[entity.type].map((field) => (
                    <Input
                      key={field.key}
                      label={field.label}
                      placeholder={field.placeholder}
                      required={field.required}
                      disabled={disabled}
                      value={String(
                        Object.entries(entity).find(
                          ([key]) => key === field.key,
                        )?.[1] ?? "",
                      )}
                      onChange={(raw) =>
                        update(
                          field.key,
                          field.required ? raw : raw.trim() ? raw : undefined,
                        )
                      }
                    />
                  ))}
                  {entity.type === "Product" && (
                    <Select
                      label="Displayed availability"
                      value={entity.availability ?? ""}
                      disabled={disabled}
                      options={[
                        { value: "", label: "No availability override" },
                        { value: "InStock", label: "In stock" },
                        { value: "OutOfStock", label: "Out of stock" },
                        { value: "PreOrder", label: "Pre-order" },
                      ]}
                      onChange={(raw) =>
                        update("availability", raw || undefined)
                      }
                    />
                  )}
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      onChange(entries.filter((_, i) => i !== index))
                    }
                  >
                    Remove structured data
                  </Button>
                </Stack>
              </Card>
            );
          })}
          <Select
            label="Structured data to add"
            value={type}
            disabled={disabled}
            options={[
              { value: "LocalBusiness", label: "Local business" },
              { value: "Product", label: "Product" },
              { value: "Event", label: "Event" },
              { value: "VideoObject", label: "Video" },
            ]}
            onChange={setType}
          />
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onChange([...entries, { ...defaults[type] }])}
          >
            Add structured data
          </Button>
        </>
      )}
    </Stack>
  );
}
