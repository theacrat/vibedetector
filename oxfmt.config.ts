import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["src/generated/**", "dist/**", ".wrangler/**", "bun.lock"],
  sortImports: true,
  sortPackageJson: {
    sortScripts: true,
  },
  sortTailwindcss: {
    functions: ["tv"],
  },
});
