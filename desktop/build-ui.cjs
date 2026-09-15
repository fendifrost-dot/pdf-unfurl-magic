/**
 * Production desktop UI build. Sets PDF_RELIEF_DESKTOP so Vite emits a static
 * SPA shell, then stages it into dist/ for electron-builder.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const env = { ...process.env, PDF_RELIEF_DESKTOP: "1" };

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
