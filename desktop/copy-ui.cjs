/**
 * Stage a packable SPA into dist/. Plain `npm run build` is TanStack Start /
 * Nitro SSR: `.output/public` has JS/CSS/fonts and no index.html. Desktop
 * builds prerender a shell; this copies that tree to dist/ for electron-builder
 * and for production load (never npx, never asar cwd).
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { resolveShellFile, resolveUiBuildOutput, startStaticUiServer } = require("./static-ui.cjs");

const root = path.join(__dirname, "..");
const dest = path.join(root, "dist");

function copyDir(src, target) {
  fs.cpSync(src, target, { recursive: true, force: true });
}

function ensureIndexHtml(dir) {
  const index = path.join(dir, "index.html");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  const shell = resolveShellFile(dir);
  if (!shell) return null;
  fs.copyFileSync(shell, index);
  return index;
}

function fetchPath(origin, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`${origin}${pathname}`, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      })
      .on("error", reject);
  });
}

async function smokeDist() {
  const indexHtml = path.join(dest, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      "dist/index.html is missing. A plain npm run build is SSR-only (.output/public has assets but no HTML). Run build:desktop so the SPA shell lands in dist/.",
    );
  }
  const { server, origin } = await startStaticUiServer(dest);
  try {
    const page = await fetchPath(origin, "/edit");
    if (page.status !== 200 || !page.body.includes("<html") || !/script/i.test(page.body)) {
      throw new Error(
        `Packed UI smoke failed for /edit (${page.status}). dist/index.html must be a static SPA shell — not Nitro SSR and not vite preview.`,
      );
    }
    const worker = await fetchPath(origin, "/pdf.worker.boot.mjs");
    if (worker.status !== 200) {
      throw new Error(`Packed UI smoke failed for /pdf.worker.boot.mjs (${worker.status}).`);
    }
    console.log("[pdf-relief] Packed UI smoke: dist/index.html served /edit without npx.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const source = resolveUiBuildOutput(root);
  if (!source) {
    throw new Error(
      "Desktop UI is missing index.html. PDF_RELIEF_DESKTOP=1 vite build must prerender a shell into .output/public — a regular npm run build is SSR-only and will not.",
    );
  }

  const destResolved = path.resolve(dest);
  const sourceResolved = path.resolve(source);

  if (sourceResolved !== destResolved) {
    const staging = path.join(root, ".desktop-ui-staging");
    fs.rmSync(staging, { recursive: true, force: true });
    copyDir(source, staging);
    if (sourceResolved.startsWith(destResolved + path.sep)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.rmSync(dest, { recursive: true, force: true });
    copyDir(staging, dest);
    fs.rmSync(staging, { recursive: true, force: true });
    console.log(`[pdf-relief] Staged SPA ${path.relative(root, source)} -> dist/`);
  } else {
    console.log("[pdf-relief] SPA shell is already in dist/");
  }

  if (!ensureIndexHtml(dest)) {
    throw new Error("Failed to stage dist/index.html for the packed app.");
  }

  for (const extra of ["server", "_headers", "nitro.json"]) {
    fs.rmSync(path.join(dest, extra), { recursive: true, force: true });
  }

  await smokeDist();
}

main().catch((error) => {
  console.error("[pdf-relief]", error instanceof Error ? error.message : error);
  process.exit(1);
});
