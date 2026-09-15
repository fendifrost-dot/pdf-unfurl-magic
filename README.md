# PDF Relief

A PDF workshop that runs on your own machine — split, extract, merge, click-to-edit
text, scan pages into a multi-page PDF, and **E-Sign** a PDF. There is no account, no
database, and nothing is uploaded: files stay on the computer. Ships in two shapes from
this one repo:

- **Browser** — the TanStack Start + Vite web app, including a phone-sized
  shell (bottom nav, large tap targets, camera scan, Save / Share).
- **Desktop** — an Electron wrapper with a native File → Open PDF and real Save dialogs.
- **PWA** — installable from a phone browser (Add to Home Screen / Install). Files still stay on the device.

## Run the desktop app

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/fendifrost-dot/pdf-unfurl-magic.git
cd pdf-unfurl-magic
npm install
npm run desktop
```

On a Mac you can also double-click **Open PDF Relief.command** inside the project folder;
on Windows, **Open PDF Relief.bat**.

## Scripts

| Script                | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `npm run dev`         | Web app in development                               |
| `npm run build`       | Production web build                                 |
| `npm run desktop`     | Build, then open the desktop app                     |
| `npm run desktop:dev` | Desktop app against the dev server (127.0.0.1:47321) |
| `npm run pack`        | Package installers with electron-builder (current platform) |
| `npm run pack:mac`    | Build unsigned Apple Silicon `.dmg` and `.zip` into `release/` |
| `npm run test:smoke`  | Load the synthetic PDFs in `fixtures/`, check page counts and export size |
| `npm run fixtures:generate` | Rebuild the committed files in `fixtures/` |

After a feature merge, rebuild the Dock app with `npm run pack:mac`. See
[docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md) for install, Gatekeeper, and Dock pin.

Shared QA: `docs/QA_MVP.md` (10-minute human pass after edit / scan / e-sign). Optional Playwright and Vitest paths are in `tests/e2e/README.md`.

The desktop app serves the UI on 127.0.0.1:47321, so it never competes with the web dev
server's port.

## Scan pages

Open `/scan` (or **File → Scan pages** in the desktop app). Capture from the camera or
import photos, drag the document corners if the auto outline misses, pick an enhance
preset, and export an ordered PDF. Optional OCR adds a hidden text layer only — the
JPEG page stays the picture. Processing is one page at a time.

## Scan-aware edit

Open `/edit` on a scanned or image-only PDF. If the page has no reliable text operators, the editor shows **This page looks scanned** instead of Helvetica Unsafe. Enhance the page (upscale + denoise/contrast, one page at a time) and run local OCR, then edit the OCR lines. Export writes a text layer on the page image — the original picture stays unless you choose **Replace with cleaned image**. Real text PDFs still use in-place rewrite.

## Phone / PWA

On iPhone or Android, open the web app and use the bottom bar: Home, Split, Merge,
Scan, Edit. Choose a PDF (drag-and-drop is optional). Export uses the browser
download or the OS share sheet. Electron still uses its Save dialog.

Install: Android Chrome may offer **Install**. iOS Safari → Share → Add to Home Screen.

## Built with

- TanStack Start, Vite, React, TypeScript, Tailwind CSS, shadcn/ui
- pdf-lib and PDF.js, both running locally
- Electron for the desktop build

## E-Sign

Open `/sign` (or **E-Sign** in the header). Drop a contract, place a signature and date,
draw or type a mark, and export. The signed PDF keeps the original page graphics and
adds an audit page (who, when, SHA-256). Single signer. This is not DocuSign and not a
PKI digital signature.

```bash
npm test   # integrity hash + certificate-page checks
```
