/**
 * In-process static UI for the packed desktop app.
 * Production must never spawn npx/vite — asar is not a valid child_process cwd.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const SHELL_NAMES = ["index.html", "_shell.html"];

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Runtime (packaged asar): dist/ is the SPA copied by build:desktop.
 * Build output: Nitro may prerender index.html into .output/public first.
 */
const PACKED_UI_SEGMENTS = ["dist"];

function uiRootCandidates(appRoot) {
  return [
    path.join(appRoot, ...PACKED_UI_SEGMENTS),
    path.join(appRoot, "dist", "client"),
    path.join(appRoot, ".output", "public"),
  ];
}

function uiBuildOutputCandidates(appRoot) {
  return [
    path.join(appRoot, ".output", "public"),
    path.join(appRoot, "dist", "client"),
    path.join(appRoot, ...PACKED_UI_SEGMENTS),
  ];
}

function hasHtmlShell(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return SHELL_NAMES.some((name) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) && fs.statSync(file).isFile();
  });
}

function resolveUiRoot(appRoot) {
  return uiRootCandidates(appRoot).find(hasHtmlShell) ?? null;
}

function resolveUiBuildOutput(appRoot) {
  return uiBuildOutputCandidates(appRoot).find(hasHtmlShell) ?? null;
}

function resolveShellFile(root) {
  for (const name of SHELL_NAMES) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || "/").split("?")[0].split("#")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, rel);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (abs !== rootResolved && !abs.startsWith(prefix)) return null;
  return abs;
}

function existingFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.isFile()) return filePath;
  if (stat.isDirectory()) {
    const index = path.join(filePath, "index.html");
    if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  }
  return null;
}

function fileForRequest(root, urlPath) {
  const target = safeJoin(root, urlPath);
  if (!target) return null;
  const direct = existingFile(target);
  if (direct) return direct;
  const html = existingFile(`${target}.html`);
  if (html) return html;
  return null;
}

function isNavigationRequest(req, urlPath) {
  const pathname = String(urlPath || "/").split("?")[0];
  if (!path.extname(pathname)) return true;
  const accept = String(req.headers?.accept || "");
  return accept.includes("text/html");
}

function serveStatic(root, req, res) {
  const urlPath = req.url || "/";
  let file = fileForRequest(root, urlPath);
  if (!file && isNavigationRequest(req, urlPath)) {
    file = resolveShellFile(root);
  }
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const cache =
    ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  fs.createReadStream(file)
    .on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end();
    })
    .pipe(res);
}

function startStaticUiServer(root, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        serveStatic(root, req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        }
        res.end(error instanceof Error ? error.message : String(error));
      }
    });
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Static UI server did not bind a TCP port."));
        return;
      }
      resolve({ server, origin: `http://${host}:${address.port}` });
    });
  });
}

module.exports = {
  PACKED_UI_SEGMENTS,
  fileForRequest,
  hasHtmlShell,
  resolveShellFile,
  resolveUiBuildOutput,
  resolveUiRoot,
  serveStatic,
  startStaticUiServer,
  uiRootCandidates,
};
