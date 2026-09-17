/**
 * Typecheck ratchet.
 *
 * CI runs vitest and node tests but has never run `tsc`, which is how 35 type
 * errors accumulated invisibly on main — including a real dead-prop bug and a
 * wrong Set key type, both found by audit rather than by CI.
 *
 * Turning `tsc` on outright would fail every build on pre-existing errors, so
 * this ratchets instead: the committed baseline is a ceiling that can only come
 * down. New type errors fail CI immediately; the existing backlog blocks nobody
 * and gets paid off whenever someone touches that code.
 *
 * Usage:
 *   node scripts/tsc-ratchet.mjs           check against the baseline
 *   node scripts/tsc-ratchet.mjs --update  lower the baseline to the current count
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(root, "tsc-baseline.json");

function runTsc() {
  try {
    execFileSync("npx", ["tsc", "--noEmit"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (err) {
    // tsc exits non-zero when it reports errors; that is the normal path here.
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

function countErrors(output) {
  const lines = output.split("\n").filter((l) => /error TS\d+:/.test(l));
  return { count: lines.length, lines };
}

function readBaseline() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    if (typeof parsed.maxErrors !== "number") throw new Error("maxErrors missing");
    return parsed.maxErrors;
  } catch {
    console.error(
      `Cannot read a numeric maxErrors from ${path.relative(root, BASELINE_PATH)}.`,
    );
    process.exit(2);
  }
}

const output = runTsc();
const { count, lines } = countErrors(output);
const baseline = readBaseline();

if (process.argv.includes("--update")) {
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ maxErrors: count, note: "Ceiling only. Lower it, never raise it." }, null, 2) + "\n",
  );
  console.log(`Baseline updated: ${baseline} -> ${count}`);
  process.exit(0);
}

if (count > baseline) {
  console.error(`\ntsc errors: ${count} (baseline ${baseline}) — ${count - baseline} new.\n`);
  console.error("This change introduces type errors. The full list:\n");
  console.error(lines.join("\n"));
  console.error(
    "\nFix them, or if you have genuinely removed errors elsewhere run:\n" +
      "  node scripts/tsc-ratchet.mjs --update\n",
  );
  process.exit(1);
}

if (count < baseline) {
  console.log(
    `tsc errors: ${count} (baseline ${baseline}) — ${baseline - count} fewer. ` +
      `Lower the baseline with: node scripts/tsc-ratchet.mjs --update`,
  );
  process.exit(0);
}

console.log(`tsc errors: ${count} (at baseline ${baseline}). No new type errors.`);
