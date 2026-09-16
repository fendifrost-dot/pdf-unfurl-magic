import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const promiseWithResolversPolyfill = fileURLToPath(
  new URL("./scripts/polyfill-promise-with-resolvers.cjs", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/lib/esign.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Forks + --require so pdfjs sees Promise.withResolvers before it evaluates.
    pool: "forks",
    execArgv: ["--require", promiseWithResolversPolyfill],
    poolOptions: {
      forks: {
        execArgv: ["--require", promiseWithResolversPolyfill],
      },
    },
  },
});
