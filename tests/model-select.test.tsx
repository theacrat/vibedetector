import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { ModelOption } from "@/domain";
import { ModelSelect } from "@/ui/model-select";

const options: ModelOption[] = [
  { active: true, name: "Database-only model", provider: "claude" },
  { active: false, name: "Historical model", provider: "claude" },
];
const ordered: ModelOption[] = [
  ...options,
  { active: true, name: "Another active model", provider: "claude" },
];
function change(value: string) {
  expect(typeof value).toBe("string");
}

test("report model selector displays a saved archived model but disables new selection", () => {
  const html = renderToStaticMarkup(
    <ModelSelect options={options} value="Historical model" onChange={change} disabled={false} />,
  );
  expect(html).toContain('<option value="Database-only model">Database-only model</option>');
  expect(html).toContain(
    '<option value="Historical model" disabled="" selected="">Historical model (archived)</option>',
  );
  expect(html).not.toContain("Claude Opus");
});

test("chart filters omit archived entries and preserve active catalogue order", () => {
  const html = renderToStaticMarkup(
    <ModelSelect
      options={ordered}
      value="Historical model"
      onChange={change}
      disabled={false}
      filter
    />,
  );
  expect(html).not.toContain("Historical model");
  expect(html).toContain(
    '<option value="Database-only model">Database-only model</option><option value="Another active model">Another active model</option>',
  );
  expect(html).toContain("All models");
  expect(html).toContain("Unspecified");
});
