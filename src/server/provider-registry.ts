import { catalogueScope } from "@/catalogue-scope";
import type { Provider } from "@/domain";
import { initialProviders } from "@/server/registered-providers";

type ModelProtocol = "list" | "anthropic" | "gemini" | "cursor";
type ModelSecret =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY"
  | "XAI_API_KEY"
  | "MISTRAL_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "CURSOR_API_KEY"
  | "MOONSHOT_API_KEY";
interface ModelAdapter {
  endpoint: string;
  secret: ModelSecret;
  protocol: ModelProtocol;
}
interface RegisteredProvider {
  provider: Provider;
  adapter: ModelAdapter | undefined;
  scope: string;
}

const adapters: Record<string, ModelAdapter> = {
  chatgpt: {
    endpoint: "https://api.openai.com/v1/models",
    protocol: "list",
    secret: "OPENAI_API_KEY",
  },
  claude: {
    endpoint: "https://api.anthropic.com/v1/models",
    protocol: "anthropic",
    secret: "ANTHROPIC_API_KEY",
  },
  cursor: {
    endpoint: "https://api.cursor.com/v1/models",
    protocol: "cursor",
    secret: "CURSOR_API_KEY",
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/models",
    protocol: "list",
    secret: "DEEPSEEK_API_KEY",
  },
  gemini: {
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    protocol: "gemini",
    secret: "GEMINI_API_KEY",
  },
  grok: { endpoint: "https://api.x.ai/v1/models", protocol: "list", secret: "XAI_API_KEY" },
  kimi: {
    endpoint: "https://api.moonshot.ai/v1/models",
    protocol: "list",
    secret: "MOONSHOT_API_KEY",
  },
  mistral: {
    endpoint: "https://api.mistral.ai/v1/models",
    protocol: "list",
    secret: "MISTRAL_API_KEY",
  },
};

const providerRegistry: RegisteredProvider[] = initialProviders
  .filter((provider) => provider.slug !== "copilot")
  .map((provider) => ({
    adapter: adapters[provider.slug],
    provider,
    scope: catalogueScope(provider.id),
  }));

export { providerRegistry };
export type { ModelAdapter, ModelSecret, RegisteredProvider };
