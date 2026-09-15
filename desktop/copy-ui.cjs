/**
 * Confirm the real Vite/Nitro client output is packable. `npm run build` writes
 * `.output/public` (not dist/). Desktop builds also prerender index.html there.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
  PRIMARY_UI_SEGMENTS,
  resolveShellFile,
  resolveUiRoot,
  startStaticUiServer,
} = require("./static-ui.cjs");

const root = path.join(__dirname, "..");

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

function ensureIndexHtml(dir) {
  const index = path.join(dir, "index.html");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  const shell = resolveShellFile(dir);
  if (!shell) return null;
  fs.copyFileSync(shell, index);
  return index;
}

async function smokeUi(uiRoot) {
  const { server, origin } = await startStaticUiServer(uiRoot);
  try {
    const page = await fetchPath(origin, "/edit");
    if (page.status !== 200 || !page.body.includes("<html") || !/script/i.test(page.body)) {
      throw new Error(
        `Packed UI smoke failed for /edit (${page.status}). ${path.relative(root, uiRoot)}/index.html must be a static shell, not a vite preview spawn.`,
      );
    }
    const worker = await fetchPath(origin, "/pdf.worker.boot.mjs");
    if (worker.status !== 200) {
      throw new Error(`Packed UI smoke failed for /pdf.worker.boot.mjs (${worker.status}).`);
    }
    console.log(
      `[pdf-relief] Packed UI smoke: served ${path.relative(root, uiRoot)} /edit without npx.`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const uiRoot = resolveUiRoot(root);
  if (!uiRoot) {
    throw new Error(
      `Desktop UI is missing index.html under ${PRIMARY_UI_SEGMENTS.join("/")}/. Regular npm run build emits assets there with no HTML shell — use npm run build:desktop (PDF_RELIEF_DESKTOP=1) so Vite prerenders index.html.`,
    );
  }

  if (!ensureIndexHtml(uiRoot)) {
    throw new Error(`Failed to ensure ${path.relative(root, path.join(uiRoot, "index.html"))}.`);
  }

  for (const extra of ["server", "_headers", "nitro.json"]) {
    fs.rmSync(path.join(uiRoot, extra), { recursive: true, force: true });
  }

  await smokeUi(uiRoot);
}

main().catch((error) => {
  console.error("[pdf-relief]", error instanceof Error ? error.message : error);
  process.exit(1);
});
