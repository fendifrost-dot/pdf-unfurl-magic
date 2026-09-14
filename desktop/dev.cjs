const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const electronBinary = require("electron");
const port = process.env.PDF_RELIEF_PORT || "47321";
const origin = `http://127.0.0.1:${port}`;

function waitForDevServer() {
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(`${origin}/edit`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

const vite = spawn(
  "npx",
  ["vite", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  }
);

waitForDevServer().then(() => {
  const child = spawn(electronBinary, [root, "--dev"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PDF_RELIEF_PORT: port },
  });
  const stop = (code) => {
    if (!vite.killed) vite.kill();
    process.exit(code ?? 0);
  };
  child.on("exit", stop);
  vite.on("exit", (code) => {
    if (!child.killed) child.kill();
    process.exit(code ?? 0);
  });
});
