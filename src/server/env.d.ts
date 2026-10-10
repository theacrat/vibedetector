declare global {
  namespace Cloudflare {
    interface Env {
      TURNSTILE_SECRET_KEY?: string;
      ADMIN_KEY?: string;
      ADMIN_RATE_LIMIT?: RateLimit;
      OPENAI_API_KEY?: string;
      ANTHROPIC_API_KEY?: string;
      GEMINI_API_KEY?: string;
      XAI_API_KEY?: string;
      MISTRAL_API_KEY?: string;
      DEEPSEEK_API_KEY?: string;
      CURSOR_API_KEY?: string;
      MOONSHOT_API_KEY?: string;
    }
  }
}
// The global augmentation must be a module even though it exports no values.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
