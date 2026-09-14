# PDF Relief

A PDF workshop that runs on your own machine — split, extract, merge, and click-to-edit
text in a PDF. There is no account, no database, and nothing is uploaded: files stay on
the computer. Ships in two shapes from this one repo:

- **Browser** — the TanStack Start + Vite web app.
- **Desktop** — an Electron wrapper with a native File → Open PDF and real Save dialogs.

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

| Script | What it does |
| --- | --- |
| `npm run dev` | Web app in development |
| `npm run build` | Production web build |
| `npm run desktop` | Build, then open the desktop app |
| `npm run desktop:dev` | Desktop app against the dev server (127.0.0.1:47321) |
| `npm run pack` | Package installers with electron-builder |

The desktop app serves the UI on 127.0.0.1:47321, so it never competes with the web dev
server's port.

## Built with

- TanStack Start, Vite, React, TypeScript, Tailwind CSS, shadcn/ui
- pdf-lib and PDF.js, both running locally
- Electron for the desktop build
