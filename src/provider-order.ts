import type { Provider } from "./domain";

function compareProviders(left: Provider, right: Provider) {
  return left.name.localeCompare(right.name, "en") || left.id.localeCompare(right.id);
}

export { compareProviders };
