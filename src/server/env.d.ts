declare global {
  namespace Cloudflare {
    interface Env {
      TURNSTILE_SECRET_KEY?: string;
    }
  }
}
// The global augmentation must be a module even though it exports no values.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
