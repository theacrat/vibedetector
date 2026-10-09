import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { ModelOption } from "@/domain";
import { ModelSelect } from "@/ui/model-select";

import { provider, modelIds } from "./ui-fixtures";

const options: ModelOption[] = [
  { active: true, id: modelIds[0], name: "Database-only model", provider: provider.id },
  { active: false, id: modelIds[1], name: "Historical model", provider: provider.id },
];
const ordered: ModelOption[] = [
  ...options,
  { active: true, id: modelIds[2], name: "Another active model", provider: provider.id },
];
function change(value: string) {
  expect(typeof value).toBe("string");
}

test("report model selector displays a saved archived model but disables new selection", () => {
  const html = renderToStaticMarkup(
    <ModelSelect options={options} value={modelIds[1]} onChange={change} disabled={false} />,
  );
  expect(html).toContain(`<option value="${modelIds[0]}">Database-only model</option>`);
  expect(html).toContain(
    `<option value="${modelIds[1]}" disabled="" selected="">Historical model (archived)</option>`,
  );
  expect(html).not.toContain("Claude Opus");
});

test("chart filters omit archived entries and preserve active catalogue order", () => {
  const html = renderToStaticMarkup(
    <ModelSelect options={ordered} value={modelIds[1]} onChange={change} disabled={false} filter />,
  );
  expect(html).not.toContain("Historical model");
  expect(html).toContain(
    `<option value="${modelIds[0]}">Database-only model</option><option value="${modelIds[2]}">Another active model</option>`,
  );
  expect(html).toContain("All models");
  expect(html).toContain("Unspecified");
});
