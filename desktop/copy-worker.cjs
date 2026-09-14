/**
 * Puts the PDF.js worker in public/ so the desktop build can load it from disk.
 * Runs on postinstall and must never fail the install.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const candidates = [
  path.join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
];

try {
  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) {
    console.warn("[pdf-relief] PDF.js worker not found yet; skipping the copy into public/.");
    process.exit(0);
  }
  const target = path.join(root, "public/pdf.worker.min.mjs");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[pdf-relief] Copied ${path.relative(root, source)} -> public/pdf.worker.min.mjs`);
} catch (error) {
  console.warn("[pdf-relief] Could not copy the PDF.js worker:", error && error.message);
}
process.exit(0);
