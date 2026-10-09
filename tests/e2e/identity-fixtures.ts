import type { Page } from "@playwright/test";

import type { ModelOption, Provider } from "@/domain";

const claudeId = "10000000-0000-4000-8000-000000000001";
const chatgptId = "10000000-0000-4000-8000-000000000002";
const cursorId = "10000000-0000-4000-8000-000000000008";
const savedId = "20000000-0000-4000-8000-000000000001";
const draftId = "20000000-0000-4000-8000-000000000002";
const nextId = "20000000-0000-4000-8000-000000000003";
const adminProviders: Provider[] = [
  {
    active: true,
    id: claudeId,
    logo: "/logos/claude.svg",
    maker: "Anthropic",
    name: "Claude",
    slug: "claude",
    status: "https://status.claude.com",
    statusLabel: "Official status",
  },
  {
    active: true,
    id: chatgptId,
    logo: "/logos/chatgpt.svg",
    maker: "OpenAI",
    name: "ChatGPT",
    slug: "chatgpt",
    status: "https://status.openai.com",
    statusLabel: "Official status",
  },
];

async function selectedId(page: Page, selector: string, name: string) {
  const id = await page
    .getByRole("combobox", { exact: true, name: selector })
    .locator("option")
    .filter({ hasText: name })
    .getAttribute("value");
  if (!id) {
    throw new Error(`Missing model ${name}`);
  }
  return id;
}

function models(names: string[], provider = claudeId): ModelOption[] {
  return names.map((name, index) => ({
    active: true,
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name,
    provider,
  }));
}

const fixtures = {
  adminProviders,
  chatgptId,
  claudeId,
  cursorId,
  draftId,
  models,
  nextId,
  savedId,
  selectedId,
};
export {
  claudeId,
  chatgptId,
  cursorId,
  savedId,
  draftId,
  nextId,
  adminProviders,
  selectedId,
  models,
};
export default fixtures;
