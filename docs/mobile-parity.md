# Mobile parity vs desktop

Phone browsers (and an installed PWA) should complete the same core jobs as the
Electron app. Edit-fidelity fonts and e-sign crypto are other lanes.

| Capability         | Desktop (Electron / wide browser)     | Phone / PWA                                                                  |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| Open a PDF         | File → Open, drop zone, native dialog | Choose PDF (file picker). Drop still works if the OS allows it.              |
| Edit text          | `/edit`, click line, side panel       | `/edit`, tap highlighted boxes, bottom drawer                                |
| One page in memory | Yes                                   | Yes — canvas width follows the screen; DPR capped at 1.5 on narrow viewports |
| Split / extract    | Home bench + File menu                | `/split` + bottom nav + home shortcut                                        |
| Merge / reorder    | Home bench + Merge tab page strip     | `/merge` + Reorder tab; drag, arrows, select to delete/extract; Save As only |
| Scan               | File menu → Scan (same route)         | `/scan` camera + photo library. Auto-crop / OCR TODO for scan lane           |
| Save               | Native Save dialog                    | Download                                                                     |
| Share              | Not used (desktop save)               | OS share sheet when `canShare({ files })`                                    |
| Install            | Packaged Electron app                 | PWA manifest + service worker + install hint                                 |
| Primary actions    | Pointer / hover                       | No hover-only primary actions; min 44px targets                              |
| Hover text boxes   | Hover to preview, click to edit       | Boxes always visible on coarse pointers                                      |

## Routes

- `/` home + tool shortcuts + existing bench
- `/edit` editor
- `/split` split / extract
- `/merge` merge + page reorder strip
- `/scan` camera session (`src/lib/scan-runtime.ts`)

## Device-emulation notes

Verify at 390×844 (iPhone) and 360×800 (Android) in DevTools with touch, plus a
wide desktop viewport so Electron chrome is unchanged. Confirm File → Split /
Merge / Scan in the desktop menu still load the new routes.
