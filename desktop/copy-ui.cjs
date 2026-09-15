/**
 * Stage the Vite/Nitro client output into dist/ so electron-builder's files
 * glob matches a real index.html + assets tree (TanStack Start often emits
 * into .output/public or dist/client instead of dist/).
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { resolveShellFile, resolveUiRoot, startStaticUiServer } = require("./static-ui.cjs");

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
  const { server, origin } = await startStaticUiServer(dest);
  try {
    const page = await fetchPath(origin, "/edit");
    if (page.status !== 200 || !page.body.includes("<html") || !/script/i.test(page.body)) {
      throw new Error(
        `Packed UI smoke failed for /edit (${page.status}). dist/index.html must be a static shell, not a vite preview spawn.`,
      );
    }
    const worker = await fetchPath(origin, "/pdf.worker.boot.mjs");
    if (worker.status !== 200) {
      throw new Error(`Packed UI smoke failed for /pdf.worker.boot.mjs (${worker.status}).`);
    }
    console.log("[pdf-relief] Packed UI smoke: /edit and /pdf.worker.boot.mjs served without npx.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const source = resolveUiRoot(root);
  if (!source) {
    throw new Error(
      "Desktop UI is missing index.html. Build with PDF_RELIEF_DESKTOP=1 so Vite emits a static shell under dist/, dist/client/, or .output/public/.",
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
    copyDir(staging, dest);
    fs.rmSync(staging, { recursive: true, force: true });
    console.log(`[pdf-relief] Staged desktop UI ${path.relative(root, source)} -> dist/`);
  } else {
    console.log("[pdf-relief] Desktop UI is already in dist/");
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
