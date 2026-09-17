/**
 * Writes desktop/build-info.json at pack time so a packed app can name the
 * commit it was built from. QA runs against /Applications/PDF Relief.app are
 * otherwise unattributable — a passing clickthrough cannot be tied to a SHA.
 *
 * Degrades gracefully: if git metadata is unavailable (tarball, CI without
 * history, no git installed), the fields are null and the app still builds.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

/**
 * Runs git and distinguishes "command failed" from "command succeeded with no
 * output". `git status --porcelain` prints nothing on a clean tree, so collapsing
 * empty output to null would report a clean build as "unknown".
 */
function gitRaw(args) {
  try {
    return {
      ok: true,
      out: execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    };
  } catch {
    return { ok: false, out: "" };
  }
}

function git(args) {
  const { ok, out } = gitRaw(args);
  return ok && out ? out : null;
}

function buildInfo() {
  const status = gitRaw(["status", "--porcelain"]);
  return {
    sha: git(["rev-parse", "--short", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: status.ok ? status.out.length > 0 : null,
    builtAt: new Date().toISOString(),
  };
}

const OUT_PATH = path.join(__dirname, "build-info.json");

function write() {
  const info = buildInfo();
  fs.writeFileSync(OUT_PATH, JSON.stringify(info, null, 2) + "\n");
  return { out: OUT_PATH, info };
}

/** Runtime read. Never throws — a missing or corrupt file yields nulls. */
function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    return {
      sha: parsed.sha ?? null,
      branch: parsed.branch ?? null,
      dirty: parsed.dirty ?? null,
      builtAt: parsed.builtAt ?? null,
    };
  } catch {
    return { sha: null, branch: null, dirty: null, builtAt: null };
  }
}

/** Human-readable one-liner for the About dialog. */
function describe(info) {
  if (!info || !info.sha) return "Build: unknown (no git metadata at pack time)";
  const dirty = info.dirty ? "-dirty" : "";
  const branch = info.branch && info.branch !== "HEAD" ? ` (${info.branch})` : "";
  const when = info.builtAt ? `\nBuilt: ${info.builtAt}` : "";
  return `Build: ${info.sha}${dirty}${branch}${when}`;
}

if (require.main === module) {
  const { out, info } = write();
  console.log(
    `build-info: ${info.sha ?? "unknown"}${info.dirty ? "-dirty" : ""} -> ${out}`,
  );
}

module.exports = { buildInfo, write, read, describe, OUT_PATH };
