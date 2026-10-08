import type { Provider } from "@/domain";

function ProviderLogo({ provider }: { provider: Provider }) {
  return provider.id === "cursor" ? (
    <span className="provider-initial" aria-hidden="true">
      C
    </span>
  ) : (
    <img
      className="provider-logo"
      src={`/logos/${provider.id}.svg`}
      alt=""
      width="40"
      height="40"
    />
  );
}
export { ProviderLogo };
