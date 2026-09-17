const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { resolveUiRoot, startStaticUiServer } = require("./static-ui.cjs");
const buildInfo = require("./gen-build-info.cjs");
const { avoidOverwritePath, sameFsPath } = require("./save-path.cjs");

const DEV_PORT = Number(process.env.PDF_RELIEF_PORT || 47321);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:http').Server | null} */
let staticServer = null;
/** @type {string | null} */
let staticOrigin = null;
/** @type {{ name: string, data: Buffer } | null} */
let pendingPdf = null;
/** Absolute path of the PDF this window opened from disk, if any. */
let openedSourcePath = null;

function isDevMode() {
  if (app.isPackaged) return false;
  return process.argv.includes("--dev");
}

function iconPath() {
  const png = path.join(__dirname, "icon.png");
  return fs.existsSync(png) ? png : undefined;
}

function isPdfPath(filePath) {
  return typeof filePath === "string" && filePath.toLowerCase().endsWith(".pdf") && fs.existsSync(filePath);
}

function readPdfFile(filePath, trackSource = true) {
  const resolved = path.resolve(filePath);
  if (trackSource) openedSourcePath = resolved;
  return { name: path.basename(filePath), data: fs.readFileSync(filePath) };
}

function pdfFromArgv(argv = process.argv) {
  return argv.find((arg) => isPdfPath(arg));
}

function waitForUrl(url, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Desktop UI did not start at ${url}`));
          return;
        }
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

async function startPackagedUi() {
  if (staticOrigin) return staticOrigin;
  const appRoot = path.join(__dirname, "..");
  const uiRoot = resolveUiRoot(appRoot);
  const indexHtml = uiRoot ? path.join(uiRoot, "index.html") : "";
  if (!uiRoot || !fs.existsSync(indexHtml)) {
    throw new Error(
      "PDF Relief UI files were not found (no dist/index.html). A plain npm run build is TanStack Start/Nitro SSR: .output/public has assets but no HTML. Run npm run desktop or npm run pack (build:desktop). Packaged apps must not spawn npx or vite, and must not use app.asar as cwd.",
    );
  }
  // file:// loadFile(index.html) cannot open /edit (no per-route HTML) or
  // /assets and /pdf.worker.boot.mjs (absolute URLs). Serve dist/ in-process
  // on loopback — no child_process, no asar cwd.
  const started = await startStaticUiServer(uiRoot);
  staticServer = started.server;
  staticOrigin = started.origin;
  return staticOrigin;
}

async function resolveStartUrl() {
  if (isDevMode()) {
    await waitForUrl(`${DEV_URL}/`);
    return `${DEV_URL}/`;
  }
  return startPackagedUi();
}

let appOrigin = DEV_URL;

function joinAppPath(pathname) {
  const base = appOrigin.endsWith("/") ? appOrigin.slice(0, -1) : appOrigin;
  return `${base}${pathname}`;
}

function onEditorPage() {
  const url = mainWindow?.webContents.getURL() ?? "";
  return url.includes("/edit");
}

function onSignPage() {
  const url = mainWindow?.webContents.getURL() ?? "";
  return url.includes("/sign");
}

async function showEditor() {
  if (!mainWindow) return;
  if (!onEditorPage()) {
    await mainWindow.loadURL(joinAppPath("/edit"));
  }
}

async function showSign() {
  if (!mainWindow) return;
  if (!onSignPage()) {
    await mainWindow.loadURL(joinAppPath("/sign"));
  }
}

function notifyPdfReady() {
  mainWindow?.webContents.send("desktop:pdf-ready");
}

async function openPdfPath(filePath) {
  if (!isPdfPath(filePath)) return;
  pendingPdf = readPdfFile(filePath);
  if (onSignPage()) {
    notifyPdfReady();
    return;
  }
  await showEditor();
  notifyPdfReady();
}

function isImagePath(filePath) {
  return (
    typeof filePath === "string" &&
    /\.(png|jpe?g|webp)$/i.test(filePath) &&
    fs.existsSync(filePath)
  );
}

function readImageFile(filePath) {
  return { name: path.basename(filePath), data: fs.readFileSync(filePath) };
}

async function pickPdfDialog(multi = false) {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: multi ? "Open PDFs" : "Open PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: multi ? ["openFile", "multiSelections"] : ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  if (multi) {
    return result.filePaths.filter(isPdfPath).map((filePath) => readPdfFile(filePath, false));
  }
  return readPdfFile(result.filePaths[0], true);
}

function sendEditorCommand(command) {
  if (!mainWindow) return;
  const fire = () => mainWindow?.webContents.send("desktop:editor-command", command);
  if (!onEditorPage() && command === "save-as") {
    void showEditor().then(fire);
    return;
  }
  fire();
}

async function pickImageDialog() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "Import scan photos",
    filters: [{ name: "Photos", extensions: ["png", "jpg", "jpeg", "webp"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths.filter(isImagePath).map(readImageFile);
}

async function openPdfFromMenu() {
  const picked = await pickPdfDialog(false);
  if (!picked) return;
  pendingPdf = picked;
  if (!onSignPage()) {
    await showEditor();
  }
  notifyPdfReady();
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open PDF…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            void openPdfFromMenu();
          },
        },
        {
          label: "Close document",
          click: () => sendEditorCommand("close-document"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+S",
          click: () => sendEditorCommand("save-as"),
        },
        {
          label: "Export",
          click: () => sendEditorCommand("save-as"),
        },
        { type: "separator" },
        {
          label: "Editor",
          click: () => {
            void showEditor();
          },
        },
        {
          label: "Scan pages",
          click: () => mainWindow?.loadURL(joinAppPath("/scan")),
        },
        {
          label: "E-Sign",
          click: () => {
            void showSign();
          },
        },
        {
          label: "Split a file",
          click: () => mainWindow?.loadURL(joinAppPath("/split")),
        },
        {
          label: "Merge PDFs",
          click: () => mainWindow?.loadURL(joinAppPath("/merge")),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "How this works",
          click: () => mainWindow?.loadURL(joinAppPath("/")),
        },
        { type: "separator" },
        {
          label: "About PDF Relief",
          click: () => {
            const info = buildInfo.read();
            dialog.showMessageBox(mainWindow ?? undefined, {
              type: "info",
              title: "About PDF Relief",
              message: `PDF Relief ${app.getVersion()}`,
              detail: `${buildInfo.describe(info)}\n\nYour PDFs stay on this Mac.`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  appOrigin = await resolveStartUrl();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    title: "PDF Relief",
    backgroundColor: "#0f1419",
    autoHideMenuBar: process.platform === "win32",
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  buildMenu();
  await mainWindow.loadURL(joinAppPath("/edit"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const fromArgv = pdfFromArgv();
  if (fromArgv) {
    pendingPdf = readPdfFile(fromArgv);
    notifyPdfReady();
  }
}

ipcMain.handle("desktop:pick-pdf", async () => pickPdfDialog(false));
ipcMain.handle("desktop:pick-pdfs", async () => pickPdfDialog(true));
ipcMain.handle("desktop:pick-images", async () => pickImageDialog());
ipcMain.handle("desktop:take-pending-pdf", async () => {
  const next = pendingPdf;
  pendingPdf = null;
  if (!next) return null;
  return { name: next.name, data: next.data };
});

function toSaveBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.from(raw);
  if (raw && Array.isArray(raw.data)) return Buffer.from(raw.data);
  if (raw?.data) return Buffer.from(raw.data);
  return null;
}

/**
 * Paths this window actually wrote through the Save dialog. A sidecar may only
 * land beside one of these, so the renderer can never name an arbitrary target.
 * @type {Set<string>}
 */
const savedFilePaths = new Set();

/** Sidecar extensions the renderer may write without its own Save dialog. */
const SIDECAR_EXTENSIONS = new Set([".esign.json"]);

ipcMain.handle("desktop:save-file", async (_event, payload) => {
  const name = typeof payload?.name === "string" ? payload.name : "document.pdf";
  const ext = path.extname(name).replace(".", "") || "pdf";
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "Save As",
    defaultPath: path.join(app.getPath("documents"), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return null;
  const buffer = toSaveBuffer(payload?.data);
  if (!buffer) {
    throw new Error("Nothing to save.");
  }
  const dest = avoidOverwritePath(result.filePath, openedSourcePath);
  fs.writeFileSync(dest, buffer);
  savedFilePaths.add(dest);
  if (openedSourcePath && !sameFsPath(dest, result.filePath)) {
    dialog.showMessageBox(mainWindow ?? undefined, {
      type: "info",
      message: "The original file was not overwritten.",
      detail: `Saved as ${path.basename(dest)} instead.`,
    });
  }
  return dest;
});

ipcMain.handle("desktop:document-closed", async () => {
  openedSourcePath = null;
});

/**
 * Write a small sidecar beside a file the user just saved, with no second
 * dialog. Only exact paths returned by desktop:save-file are accepted, and only
 * the allow-listed sidecar extensions.
 */
ipcMain.handle("desktop:save-sidecar", async (_event, payload) => {
  const forPath = typeof payload?.forPath === "string" ? payload.forPath : "";
  const extension = typeof payload?.extension === "string" ? payload.extension : "";
  if (!savedFilePaths.has(forPath)) {
    throw new Error("That file was not saved by this window.");
  }
  if (!SIDECAR_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported sidecar type: ${extension}`);
  }
  const buffer = toSaveBuffer(payload?.data);
  if (!buffer) {
    throw new Error("Nothing to save.");
  }
  const target = path.join(
    path.dirname(forPath),
    `${path.basename(forPath, path.extname(forPath))}${extension}`,
  );
  fs.writeFileSync(target, buffer);
  return target;
});

app.setName("PDF Relief");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const extra = pdfFromArgv(argv);
    if (extra) void openPdfPath(extra);
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) {
      void openPdfPath(filePath);
      return;
    }
    pendingPdf = isPdfPath(filePath) ? readPdfFile(filePath) : pendingPdf;
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || permission === "camera" || permission === "mediaKeySystem");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media" || permission === "camera";
    });
    void createWindow().catch((error) => {
      dialog.showErrorBox("PDF Relief", error instanceof Error ? error.message : String(error));
      app.quit();
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
    staticOrigin = null;
  }
});
