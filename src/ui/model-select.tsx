import { useCallback } from "react";
import type { ChangeEvent } from "react";

import type { ModelOption } from "@/domain";

import "./model-select.css";

function ModelSelect({
  options,
  value,
  onChange,
  disabled,
  filter = false,
}: {
  options: ModelOption[];
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
      <option value="">{filter ? "All models" : "model"}</option>
      {filter && <option value="unspecified">Unspecified</option>}
      {options.map(({ name, active }) => (
        <option key={name} value={name} disabled={!filter && !active}>
          {name}
          {!active && " (archived)"}
        </option>
      ))}
    </select>
  );
}

export { ModelSelect };
