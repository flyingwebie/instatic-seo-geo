import { useState } from "react";
import { Textarea } from "@instatic/host-ui";
import { lines } from "./model";

/** Keep in-progress blank lines while the saved model contains a clean string array. */
export function LinesField(props: {
  label: string;
  description?: string;
  placeholder: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  const [raw, setRaw] = useState(props.value?.join("\n") ?? "");
  return (
    <Textarea
      label={props.label}
      description={props.description}
      placeholder={props.placeholder}
      value={raw}
      rows={3}
      disabled={props.disabled}
      onChange={(next) => {
        setRaw(next);
        props.onChange(lines(next));
      }}
    />
  );
}
