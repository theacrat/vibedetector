import type { Provider } from "@/domain";

function ProviderLogo({ provider }: { provider: Provider }) {
  return provider.logo ? (
    <img className="provider-logo" src={provider.logo} alt="" width="40" height="40" />
  ) : (
    <span className="provider-initial" aria-hidden="true">
      {provider.name.slice(0, 1)}
    </span>
  );
}
export { ProviderLogo };
