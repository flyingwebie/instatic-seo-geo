import {
  Button,
  Card,
  Heading,
  Input,
  Select,
  Stack,
  Text,
} from "@instatic/host-ui";
import { LinesField } from "./Fields";
import {
  optionalText,
  patchValues,
  removeProfile,
  type FormProps,
} from "./model";

export function Profiles({ value, onChange, disabled }: FormProps) {
  const profiles = value.profiles ?? [];
  return (
    <Stack gap={16}>
      <Heading level={3}>Business & authors</Heading>
      <Text>
        Add real people or organisations. Author names must also appear in the
        published article. Profile IDs are managed for you.
      </Text>
      <Select
        label="Website publisher"
        description="Choose the organisation or person responsible for this website."
        value={value.publisher ?? ""}
        disabled={disabled}
        options={[
          { value: "", label: "No publisher selected" },
          ...profiles.map((profile) => ({
            value: profile.id,
            label: profile.name || "Unnamed profile",
          })),
        ]}
        onChange={(publisher) =>
          onChange(patchValues(value, { publisher: publisher || undefined }))
        }
      />
      {profiles.map((profile, index) => {
        const update = (patch: Partial<typeof profile>) =>
          onChange({
            ...value,
            profiles: profiles.map((item, i) =>
              i === index ? patchValues(item, patch) : item,
            ),
          });
        return (
          <Card key={profile.id}>
            <Stack gap={12}>
              <Heading level={4}>
                {profile.name || `Profile ${index + 1}`}
              </Heading>
              <Select
                label="Profile type"
                value={profile.type}
                options={[
                  { value: "Person", label: "Person / author" },
                  { value: "Organization", label: "Business / organisation" },
                ]}
                onChange={(type) => update({ type })}
                disabled={disabled}
              />
              <Input
                label="Name"
                placeholder="Jane Smith or Example Publishing"
                value={profile.name}
                onChange={(name) => update({ name })}
                required
                disabled={disabled}
              />
              <Input
                label="Profile or business URL"
                placeholder="https://example.com/about"
                value={profile.url ?? ""}
                onChange={(url) => update({ url: optionalText(url) })}
                disabled={disabled}
              />
              <Input
                label="Portrait or logo URL"
                placeholder="https://example.com/uploads/logo.png"
                value={profile.image ?? ""}
                onChange={(image) => update({ image: optionalText(image) })}
                disabled={disabled}
              />
              <LinesField
                label="Official social profiles"
                description="One full URL per line. Use only profiles belonging to this person or business."
                placeholder={
                  "https://www.linkedin.com/in/jane-smith\nhttps://www.youtube.com/@example"
                }
                value={profile.sameAs}
                onChange={(sameAs) => update({ sameAs })}
                disabled={disabled}
              />
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => onChange(removeProfile(value, profile.id))}
              >
                Remove profile
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
            profiles: [
              ...profiles,
              { id: crypto.randomUUID(), type: "Organization", name: "" },
            ],
          })
        }
      >
        Add business or author
      </Button>
    </Stack>
  );
}
