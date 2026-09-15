# PDF Relief — 10-minute MVP checklist

Run this after **edit**, **scan**, and **e-sign** have merged. The goal is “did we break load / page count / export?”, not a full design review.

Automated first (about 30 seconds):

```bash
npm install
npm run test:smoke
```

That loads every file in `fixtures/`, asserts page counts, and checks split / extract / merge / a one-line patch stay in a sane size band. It does not open a browser.

Optional app / helper paths (only if that feature PR added the runner):

| Path | Command | What it covers |
| --- | --- | --- |
| Vitest helpers | see `tests/e2e/README.md` | `getPageCount` / extract / merge / `applyTextPatches` against the same fixtures |
| Playwright | see `tests/e2e/README.md` | Drop a fixture on `/` and `/edit`, assert the page badge, check export bytes |

Then spend the rest of the ten minutes in the running app:

```bash
npm run dev
```

Use the committed files in `fixtures/` — not a real client PDF.

## Home bench (`/` → Split a file)

- [ ] Drop `fixtures/multi-page.pdf`. Badge reads **3 pages**.
- [ ] Split with **1** page per file → three downloads, each a small PDF (not empty, not megabytes).
- [ ] Extract pages `2-3` → one 2-page file, smaller than the source.
- [ ] Merge `simple-text.pdf` after the loaded multi-page file → **4** pages.
- [ ] Original files on disk are unchanged.

## Editor (`/edit`)

- [ ] Drop `simple-text.pdf`. Badge **1 / 1**. Toolbar shows **Text / Image studio / Marks / Enhance**. Side panel has collapsed **Enhance & OCR this page** (optional copy; OCR does not start by itself). Click `REPLACE_ME`, change the words, **Keep this change**, **Export**. Re-open the export: new text is there; file is still a few KB.
- [ ] Drop `multi-font.pdf`. Click the Times amount and the Courier SKU. Neighbouring fonts must still look like themselves after export (no whole-page Helvetica flatten).
- [ ] Drop `lines-and-text.pdf`. Edit one amount. Table rules and the signature line stay put.
- [ ] Drop `image-and-text.pdf`. Edit the caption. The blue image is still an image, not a smeared bitmap of the whole page.
- [ ] Drop `multi-page.pdf`. Step **1 / 3 → 3 / 3**. Edit page 1 only, export, re-open: pages 2 and 3 still show `PAGE_MARKER_2` and `PAGE_MARKER_3`.
- [ ] Drop `comma-amounts.pdf`. Click `2,500.00`, change it, export. The comma and neighbouring text stay intact. Font picker lists the embedded font as Safe.

- [ ] Drop `scan-image-only.pdf`. Banner reads **This page looks scanned** (not Helvetica Unsafe). Enhance panel is expanded. **Enhance page & OCR**. Click an OCR line in the side list (the synthetic 5×7 bitmap may OCR as fragments; a real statement scan yields amounts/labels), edit it, **Keep this change**, **Export**. Re-open: the new text is in the file as a text layer; the page picture remains unless **Replace with cleaned image** is on. Leave that toggle off once, then on once. Confirm `simple-text.pdf` still has **Safe in-place rewrite**, native text picking, and a collapsed Enhance entry (no scan banner).

## Scan (`/scan`) — skip if that PR is not merged

- [ ] Header has **Scan**. Open `/scan`.
- [ ] **Load samples** (or import three photos). Add three pages. Reorder once.
- [ ] Export. Page count is **3**. File is image-first and stays small (low hundreds of KB, not tens of MB).
- [ ] Open that export in `/edit`. Page badge matches. Optional OCR still leaves the JPEG as the page picture.

## E-Sign (`/sign`) — skip if that PR is not merged

- [ ] Header has **E-Sign**. Open `/sign`.
- [ ] Drop `simple-text.pdf` or load the sample agreement.
- [ ] Place one signature (or type-to-sign) and a date. Export.
- [ ] Signed PDF page count = original pages **+ 1** certificate page.
- [ ] Sidecar JSON is present. Hashing the downloaded PDF matches `signedFileSha256` when that field exists.
- [ ] Original file on disk is unchanged.

## Fail the merge if any of these happen

- Page count on screen does not match `fixtures/manifest.json` (or the scan/sign extras above).
- Export is empty, not a `%PDF-`, or wildly larger than the source (for these fixtures: tens of KB is sane; many MB is not).
- An edit on one line wipes rules, images, or other pages.
- The app uploads the file or asks for an account.
- The file you dropped was modified on disk.

## Fixture map

| File | Pages | First thing to try |
| --- | --- | --- |
| `fixtures/simple-text.pdf` | 1 | Edit `REPLACE_ME` / e-sign drop |
| `fixtures/multi-font.pdf` | 1 | Font-matching after a one-line edit |
| `fixtures/lines-and-text.pdf` | 1 | Rules survive a box edit |
| `fixtures/image-and-text.pdf` | 1 | Image object survives a caption edit |
| `fixtures/comma-amounts.pdf` | 1 | Comma amounts + multi-run POS line |
| `fixtures/multi-page.pdf` | 3 | Split, extract, merge, untouched pages |
| `fixtures/scan-image-only.pdf` | 1 | Scan-aware Enhance / OCR (no text operators) |

Regenerate fixtures with `npm run fixtures:generate` only if you change `fixtures/generate.mjs`.
