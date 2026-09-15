import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default defineConfig({
  root,
  resolve: {
    alias: { "@": join(root, "src") },
  },
  test: {
    include: ["tests/e2e/pdf-helpers.smoke.ts"],
    environment: "node",
  },
});
