const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DEV_PORT = Number(process.env.PDF_RELIEF_PORT || 47321);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
const isDev = process.argv.includes("--dev");

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let previewChild = null;
/** @type {{ name: string, data: Buffer } | null} */
let pendingPdf = null;

function iconPath() {
  const png = path.join(__dirname, "icon.png");
  return fs.existsSync(png) ? png : undefined;
}

function isPdfPath(filePath) {
  return typeof filePath === "string" && filePath.toLowerCase().endsWith(".pdf") && fs.existsSync(filePath);
}

function readPdfFile(filePath) {
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

function startPreviewServer() {
  const root = path.join(__dirname, "..");
  previewChild = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  return waitForUrl(DEV_URL);
}

async function resolveStartUrl() {
  if (isDev) {
    await waitForUrl(`${DEV_URL}/`);
    return `${DEV_URL}/`;
  }
  await startPreviewServer();
  return `${DEV_URL}/`;
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
  if (multi) return result.filePaths.filter(isPdfPath).map(readPdfFile);
  return readPdfFile(result.filePaths[0]);
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
          click: () => mainWindow?.loadURL(joinAppPath("/#bench")),
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
ipcMain.handle("desktop:save-file", async (_event, payload) => {
  const name = typeof payload?.name === "string" ? payload.name : "document.pdf";
  const ext = path.extname(name).replace(".", "") || "pdf";
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "Save file",
    defaultPath: path.join(app.getPath("documents"), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return null;
  const raw = payload?.data;
  const buffer = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : Array.isArray(raw)
        ? Buffer.from(raw)
        : raw?.data
          ? Buffer.from(raw.data)
          : null;
  if (!buffer) {
    throw new Error("Nothing to save.");
  }
  fs.writeFileSync(result.filePath, buffer);
  return result.filePath;
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
  if (previewChild && !previewChild.killed) previewChild.kill();
  previewChild = null;
  if (process.platform !== "darwin") app.quit();
});
