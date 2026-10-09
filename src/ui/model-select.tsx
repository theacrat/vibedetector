import { useCallback } from "react";
import type { ChangeEvent } from "react";

import { providerModels } from "@/domain";
import type { ProviderId } from "@/domain";

import "./model-select.css";

function ModelSelect({
  id,
  value,
  onChange,
  disabled,
  filter = false,
}: {
  id: ProviderId;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  filter?: boolean;
}) {
  const change = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onChange(event.currentTarget.value);
    },
    [onChange],
  );
  return (
    <select
      className={`model-select${filter ? " model-filter" : ""}`}
      aria-label={filter ? "Filter reports by model" : "Report model"}
      value={value}
      onChange={change}
      disabled={disabled}
    >
      <option value="">{filter ? "All models" : "AI"}</option>
      {filter && <option value="unspecified">Unspecified</option>}
      {providerModels[id].map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export { ModelSelect };
