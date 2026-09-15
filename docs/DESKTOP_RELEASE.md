# Desktop release (macOS)

After feature work lands on `main`, rebuild the Dock app with one command.

## Build Apple Silicon installers

On an Apple Silicon Mac, from the repo root:

```bash
npm install
npm run pack:mac
```

That writes unsigned `PDF Relief` `.dmg` and `.zip` files to `release/`.

`npm run pack` is the same electron-builder pass for the current platform. On a Mac it also produces the arm64 dmg/zip.

These builds skip Apple code signing (`identity` is unset). You do not need a Developer ID or notarization secrets.

## Packed app must not spawn npx

Opening **PDF Relief.app** loads the Vite/Nitro client from `.output/public` with an in-process static file server. After `npm run build` there is **no** `dist/` folder — assets land in `.output/public`. The packed app must **not** call `npx`, `vite preview`, or any other child process to start the UI. `vite` / `npx` are only for `npm run desktop:dev` (and the web `dev`/`preview` scripts) on a developer machine.

`npm run pack:mac` runs `build:desktop`, which sets `PDF_RELIEF_DESKTOP=1` so Vite prerenders `index.html` into `.output/public` (a plain `vite build` emits JS/CSS there with no HTML shell). electron-builder `files` copies `.output/public` into the asar together with `desktop/main.cjs` — not `dist/**/*` and not the web `node_modules` tree.

## Install to /Applications

1. Open the `.dmg` (or unzip the `.zip`).
2. Drag **PDF Relief** into `/Applications`.
3. Eject the disk image if you used the dmg.

## Gatekeeper (unsigned build)

macOS will warn that the app is from an unidentified developer. That is expected until the build is signed and notarized.

First launch:

1. In Finder, open `/Applications`.
2. Control-click **PDF Relief** and choose **Open**.
3. Confirm **Open** in the dialog.

If the dialog already dismissed: **System Settings → Privacy & Security → Open Anyway**.

## Pin to the Dock

1. Open PDF Relief from `/Applications`.
2. Control-click the Dock icon → **Options → Keep in Dock**.

## Tag a GitHub build

Push a version tag to build the same arm64 artifacts on a `macos-14` runner:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow at `.github/workflows/desktop-mac-release.yml` uploads the dmg/zip and attaches them to the GitHub Release. It uses the default `GITHUB_TOKEN` only — no Apple signing secrets.
