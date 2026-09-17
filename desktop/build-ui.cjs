/**
 * Production desktop UI: prerender a SPA shell, then copy it to dist/.
 * Do not pack `.output/public` from a plain `npm run build` — that tree has
 * assets and no index.html (TanStack Start / Nitro SSR).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const env = { ...process.env, PDF_RELIEF_DESKTOP: "1" };

// Stamp the commit before bundling so the packed app can name what it was built
// from. Never fatal — a build without git metadata still ships, with nulls.
require("./gen-build-info.cjs").write();

const vite = spawnSync("npx", ["vite", "build"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (vite.status) process.exit(vite.status ?? 1);

const copy = spawnSync(process.execPath, [path.join(__dirname, "copy-ui.cjs")], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(copy.status ?? 1);
