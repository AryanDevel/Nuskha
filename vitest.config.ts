import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Resolve a workspace package to its source, so tests never need a build first. */
const src = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nuskha/core": src("core"),
      "@nuskha/ig": src("ig"),
      "@nuskha/validate": src("validate"),
      "@nuskha/compose": src("compose"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    coverage: {
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts"],
    },
  },
});
