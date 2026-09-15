import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const desktopDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../desktop");
const require = createRequire(import.meta.url);
const { fileForRequest, resolveUiRoot, startStaticUiServer } = require(
  path.join(desktopDir, "static-ui.cjs"),
);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"] || "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      })
      .on("error", reject);
  });
}

test("packed main process must not spawn npx or vite preview", () => {
  const source = fs.readFileSync(path.join(desktopDir, "main.cjs"), "utf8");
  assert.doesNotMatch(source, /spawn\s*\(/);
  assert.doesNotMatch(source, /["']npx["']/);
  assert.doesNotMatch(source, /vite preview/);
  assert.match(source, /startStaticUiServer/);
  assert.match(source, /loadURL/);
});

test("in-process static UI serves the SPA shell for /edit without npx", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-relief-ui-"));
  const dist = path.join(tmp, "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dist, "index.html"),
    `<!doctype html><html><head><title>PDF Relief</title></head><body><div id="app">shell</div><script type="module" src="/assets/app.js"></script></body></html>`,
  );
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "window.__pdfRelief = true;\n");
  fs.writeFileSync(path.join(dist, "pdf.worker.boot.mjs"), "export {};\n");

  assert.equal(resolveUiRoot(tmp), dist);
  assert.ok(fileForRequest(dist, "/assets/app.js")?.endsWith(`${path.sep}app.js`));

  const { server, origin } = await startStaticUiServer(dist);
  try {
    const edit = await fetchText(`${origin}/edit`);
    assert.equal(edit.status, 200);
    assert.match(edit.type, /text\/html/);
    assert.match(edit.body, /PDF Relief/);
    assert.match(edit.body, /\/assets\/app\.js/);

    const asset = await fetchText(`${origin}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.body, /pdfRelief/);

    const worker = await fetchText(`${origin}/pdf.worker.boot.mjs`);
    assert.equal(worker.status, 200);

    const missing = await fetchText(`${origin}/assets/does-not-exist.js`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("path traversal does not escape the UI root", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-relief-ui-"));
  const dist = path.join(tmp, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(tmp, "secret.txt"), "nope");
  assert.equal(fileForRequest(dist, "/../secret.txt"), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});
