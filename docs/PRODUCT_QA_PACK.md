# PDF Relief — Product & QA Pack

Owner: product/QA lead. Repo: `pdf-unfurl-magic`. Code and PRs belong to Cursor agents — nothing in this doc is a patch.

Drop at `Documents/pdf-relief/docs/PRODUCT_QA_PACK.md`.

---

## 0. Reality check before you read section 2

The brief said e-sign, mobile/PWA, image studio and the fixtures harness were "still coming." They are not. As of the current `main`, all seven PRs are merged:

| PR | Feature | State |
| --- | --- | --- |
| #1 | Scan lane | merged |
| #2 | E-Sign MVP | merged |
| #3 | Phone / PWA shell | merged |
| #4 | In-PDF Image Studio | merged |
| #5 | In-place text edit | merged |
| #6 | Mac desktop packaging | merged |
| #7 | Fixtures + smoke harness | merged |

So section 2 is not a spec to hand Cursor. It is an **accept/reject gate against code that already shipped.** Run it this week. Anything that fails is a bug ticket, not a feature request.

`docs/QA_MVP.md` already covers the dev-server pass. This doc covers the **packed macOS app** — the thing a real user actually launches. Different surface, different failures (file dialogs, Gatekeeper, worker paths, sandboxed fs). Run both; they are not redundant.

---

## 1. Fifteen-minute manual QA — Scan + Edit, macOS packed app

**Surface under test:** `PDF Relief.app` in `/Applications`, launched from the Dock. Not `npm run dev`.

**Prep (do this before the clock starts):**

```bash
cd ~/Documents/pdf-relief
npm run pack:mac
```

Install the `.dmg` to `/Applications`, first-launch via Control-click → Open (unsigned build), pin to Dock. Copy `fixtures/` to `~/Desktop/pdf-relief-qa/` so you are never one misclick from editing the repo copy. Have three photos of a printed page in Photos or on disk for the scan block.

**Rule:** any FAIL below stops the release. Note the failure, do not debug in-line, keep going — you want the full 15 minutes of signal, not one deep hole.

### Block A — Launch & open (0:00 → 2:00)

| # | Action | Expect | P/F |
| --- | --- | --- | --- |
| A1 | Click the Dock icon, cold | Window up in under 4s, title **PDF Relief**, no white flash longer than a beat, no devtools, no error dialog | ☐ |
| A2 | Look at the window | Cream-paper home, RAM meter renders, footer reads files stay on the computer | ☐ |
| A3 | Menu bar → **File** | Six items: Open PDF…, Editor, Scan pages, E-Sign, Split a file, Merge PDFs | ☐ |
| A4 | **File → Open PDF…** → pick `multi-page.pdf` | Native macOS open dialog (not a browser picker). File loads. Badge reads **3 pages** | ☐ |
| A5 | **Help → How this works** | Returns to home without a blank screen or a 404 | ☐ |

### Block B — Edit, the money feature (2:00 → 7:00)

| # | Action | Expect | P/F |
| --- | --- | --- | --- |
| B1 | **File → Editor**, open `simple-text.pdf` | Page renders, badge **1 / 1**, text boxes highlight on hover | ☐ |
| B2 | Click `REPLACE_ME`, type a longer string, **Apply to page** | Side panel accepts it; on-page overlay shows the new text (green/edited); Export CTA appears; no full-page re-render flash | ☐ |
| B3 | **Export** | **Native Save dialog** with a sane default filename. Not a silent `~/Downloads` drop | ☐ |
| B4 | Open the export in Preview | New text present, correct position, file still a few KB | ☐ |
| B5 | `ls -l` the source `simple-text.pdf` | Byte size and mtime unchanged. **Any change here is a P0** | ☐ |
| B6 | Open `multi-font.pdf`, edit the Times amount and the Courier SKU, export | Times still looks like Times, Courier still monospaced. No whole-page Helvetica flatten | ☐ |
| B7 | Open `lines-and-text.pdf`, edit one amount, export | Table rules and signature line intact, same x/y | ☐ |
| B8 | Open `image-and-text.pdf`, edit the caption, export | Image still a crisp image object, not a re-rasterized page | ☐ |
| B9 | Open `multi-page.pdf`, step 1/3 → 3/3, edit page 1, export | Pages 2 and 3 still show `PAGE_MARKER_2` / `PAGE_MARKER_3`, untouched | ☐ |

### Block C — Scan (7:00 → 11:00)

| # | Action | Expect | P/F |
| --- | --- | --- | --- |
| C1 | **File → Scan pages** | Scan lane loads. If it asks for camera, macOS shows the **system** camera prompt, once | ☐ |
| C2 | Import three photos (or capture three) | Three pages in the strip, each with a detected outline | ☐ |
| C3 | Drag one corner handle | Outline follows the drag, preview re-warps, no lag spiral | ☐ |
| C4 | Switch enhance presets on one page | Visible difference, applies to that page only | ☐ |
| C5 | Reorder page 3 → position 1 | Strip order updates and holds | ☐ |
| C6 | Delete a page, add it back | Count stays correct, no ghost page | ☐ |
| C7 | Export | Native Save dialog. **3 pages.** File in the low hundreds of KB, not tens of MB | ☐ |
| C8 | Toggle OCR on, export again | Text is selectable in Preview, the page picture is unchanged, export still finishes | ☐ |
| C9 | Open the scan export in **Editor** | Loads, badge matches, does not hang the app | ☐ |

### Block D — Split / merge / save plumbing (11:00 → 13:30)

| # | Action | Expect | P/F |
| --- | --- | --- | --- |
| D1 | **File → Split a file**, `multi-page.pdf`, 1 page per file | Three saves, each a real PDF, each non-empty | ☐ |
| D2 | Extract `2-3` | One 2-page file, smaller than source | ☐ |
| D3 | **File → Merge PDFs**, multi-page + simple-text | **4 pages**, order preserved | ☐ |
| D4 | Cancel a Save dialog mid-export | App returns to a usable state. No stuck spinner, no orphan file | ☐ |
| D5 | Save into a folder that already has that filename | macOS overwrite confirm, and it honors your answer | ☐ |
| D6 | Home/Merge bench, `multi-page.pdf`, reorder 3-1-2, Save As | Re-open shows `PAGE_MARKER_3` then `1` then `2`. Source fixture mtime unchanged | ☐ |

### Block E — Kill switches (13:30 → 15:00)

| # | Action | Expect | P/F |
| --- | --- | --- | --- |
| E1 | Little Snitch / `nettop` during an edit + export | **Zero outbound connections.** Any call home is a P0 and a positioning failure | ☐ |
| E2 | Anywhere in the app | No sign-in, no account, no email capture | ☐ |
| E3 | Cmd-Q, relaunch from Dock | Clean start, no crash report, no "app quit unexpectedly" | ☐ |
| E4 | Quit with an unexported edit in progress | Either a warning or a clean quit — **not** a silent write to the source file | ☐ |
| E5 | `ls -l ~/Desktop/pdf-relief-qa/` | Every source fixture byte-identical to the start of the run | ☐ |

**Release gate:** every item in B, C7, D1–D3, and all of E must pass. A single FAIL in E blocks the build outright.

---

## 2. Acceptance criteria — E-Sign / Mobile / Image Studio

Ruthless read: each of these has **one job**. If the one job works on a real document and nothing else regresses, accept it and move on. Everything else is v2.

### E-Sign (`/sign`)

**One job:** get a signature onto a contract and produce a file the other side will accept, without a subscription.

Accept when:

1. A dropped PDF renders; signature can be **drawn** and **typed**; both export identically legible.
2. Signature and date can be placed on **any page**, and land within a few points of where they were dropped — verify on the last page of a multi-page file, not page 1.
3. Exported PDF = original pages **+ 1** certificate page. Original page graphics, text and fonts unchanged.
4. Certificate page states signer name, timestamp with timezone, and the SHA-256. Re-hashing the exported file reproduces `signedFileSha256` where that field exists.
5. Sidecar JSON is written alongside, and is valid JSON.
6. Source file on disk unmodified.
7. Signed PDF opens without warnings in **Preview** and in **Chrome's** viewer. Those two, not "a PDF reader."

Explicitly out of scope — do not accept scope creep here: multi-signer routing, email invites, DocuSign API, PKI/AATL certificates, tamper-evident locking, audit trail server.

Ship blocker: anything that makes the signature removable as a separate annotation layer. Marks must be burned into page content.

### Mobile / PWA

**One job:** the same file jobs on a phone, offline, without an app store.

Accept when:

1. `/`, `/split`, `/merge`, `/scan`, `/edit` all load and complete their job at **390×844** and **360×800**, real device, not just DevTools.
2. Bottom nav reachable one-handed; every primary target ≥ 44px; no hover-only action anywhere.
3. Text boxes in `/edit` are **always visible** on a coarse pointer — no hover-to-discover.
4. Scan uses the rear camera and the photo library, and the capture does not blow out memory on a 3-page session.
5. Export uses the OS share sheet when `canShare({ files })` is available; falls back to download when not.
6. iOS Safari → Add to Home Screen installs; the installed shell **opens and works with the network off**.
7. A 10MB PDF opens without the tab being killed by iOS memory pressure. This is the one that will actually fail — test it first.

Out of scope: background processing, iCloud/Drive pickers, push, Android install prompt polish.

Ship blocker: any route that silently does nothing on tap. A phone user does not retry.

### In-PDF Image Studio (panel inside `/edit`)

**One job:** fix or swap a photo already inside a PDF without nuking the page.

Accept when:

1. Clicking an embedded image selects **that image**, with a visible handle set — not the whole page, not a text box.
2. Replace, crop, rotate, exposure, contrast, compress each produce a visible change and each survives export.
3. After export: page **text is still selectable**, vector rules still vectors, and **unselected images are byte-untouched**.
4. Redact/rect burn is destructive — the covered pixels are gone from the exported file. Verify by extracting images from the export, not by looking at it.
5. Compress measurably shrinks the file and states the before/after.
6. An image used on multiple pages (shared XObject) either edits everywhere consistently or is cleanly forked — never half-applied.
7. Undo returns to the pre-edit state without reloading the document.

Out of scope, and the roadmap already says so: brushes, generative fill, CMYK.

Ship blocker: #3 and #4. A redaction that is visually covered but recoverable is worse than no redaction feature, and for your credit-advisory work it is an actual liability.

---

## 3. "Quit these memberships" matrix

Read this as: *what must be true in PDF Relief before you cancel.* Pull the real monthly numbers off your own card statement — the total is the point, not any single line.

| Subscription | What you actually use it for | PDF Relief today | Must-have to cancel | Later / never |
| --- | --- | --- | --- | --- |
| **Acrobat Pro** | Split, merge, edit text, fill forms, combine client packets | Split, extract, merge, **reorder pages** (thumbnail strip + Save As), **page rotate** (`/Rotate` on Save As), in-place text edit, image studio, **AcroForm fill + flatten** — shipped (no XFA / field JS) | Password-protected open | Preflight, PDF/A, Bates numbering, compare, redaction search, portfolios, XFA / LiveCycle |
| **Genius Scan** | Phone capture of statements, receipts, IDs → clean multi-page PDF | Scan lane with edge detect, perspective, presets, OCR, reorder — shipped, desktop-verified | Scan lane proven **on the actual phone**, camera + share sheet, 5+ pages without a memory kill. That is Mobile AC #4 and #7 | Cloud sync, folders/tags, auto-upload to Drive, business-card mode, batch OCR search across a library |
| **DocuSign** | Getting a document signed and having it hold up | E-Sign MVP: single signer, drawn/typed mark, date, SHA-256 audit page — shipped | Two things only: the audit page **verifies** (hash reproduces), and a signed file opens clean in Preview + Chrome | Multi-signer routing, email invites, reminders, templates, PKI/AATL, legal audit trail hosting. If a counterparty *requires* DocuSign, you are not cancelling it — you are downgrading to per-envelope |
| **Photoshop** | Fixing a photo that is going into a PDF | Image studio: replace, crop, rotate, exposure, contrast, compress, redact | Redact proven destructive (Image Studio AC #4). Rotate + straighten a crooked scan | Layers, masks, brushes, generative fill, CMYK, RAW. Do not chase this one — if you need real Photoshop work, you need Photoshop |

**Honest read:** Acrobat and Genius Scan are genuinely cancellable once the two must-have rows clear — form fill and a real phone pass. DocuSign is cancellable for *your* outbound documents and not for anything a counterparty controls. Photoshop is the weakest case; the image studio is a PDF repair tool, not an image editor, and pretending otherwise will cost you a build cycle for nothing.

**Cancel order, in sequence:** Genius Scan → Acrobat → DocuSign → (keep Photoshop, or drop to the Photography plan). Cancel one, live a full month, then the next. Do not cancel two at once — you will not know which gap hurt.

---

## 4. Sanitized fixture PDFs to create

Current fixtures cover the happy path only: five clean, synthetic, generator-made files. They are good. They also cannot fail. Everything below is generated by `fixtures/generate.mjs` or a sibling script — **no real client PDFs, no scanned IDs, no statements, nothing from the credit-advisory side of the house ever enters this repo.** Placeholder names are fictional: Acme Holdings, Jordan Vega, 555 addresses, 4-digit account stubs like `0000`.

Tier 1 — build these next, they are where the app will actually break:

| Fixture | What it is | Breaks what |
| --- | --- | --- |
| `rotated-pages.pdf` | 3 pages with `/Rotate` 0 / 90 / 270 | Editor coordinates, scan export, signature placement |
| `mixed-page-sizes.pdf` | Letter + A4 + Legal in one file | Merge, split, signature placement, canvas scaling |
| `acroform-blank.pdf` | Fillable form: text fields, checkbox, radio, dropdown (**generated** in `fixtures/`) | Form fill (the Acrobat must-have). Also: does edit destroy the form dict? Email field has dummy format/calculate JS — Form UI must warn that totals will not recalculate. |
| `no-embedded-fonts.pdf` | Text referencing a non-embedded font | Font matching on edit — most likely silent-corruption path |
| `scanned-skew.pdf` | Page-as-JPEG, 3° skew, JPEG artifacts, no text layer | Edit with nothing to click, OCR, image studio selection |
| `password-open.pdf` | User password `pdfrelief` | Open path — must fail *gracefully* with a prompt, not a white screen |

Tier 2 — after Tier 1 is green:

| Fixture | What it is | Breaks what |
| --- | --- | --- |
| `shared-image.pdf` | One XObject reused on 3 pages | Image Studio AC #6 |
| `large-photo.pdf` | Single 8MP photo page, ~6MB | Memory, compress, phone (Mobile AC #7) |
| `cjk-text.pdf` | Japanese + Chinese, CID font | Text extraction and edit on non-Latin |
| `broken-xref.pdf` | Deliberately damaged xref, recoverable | Error handling — informative message, no crash |
| `annotated.pdf` | Existing highlights, a sticky note, a link | Do annotations survive an edit and an e-sign? |
| `already-signed.pdf` | Has a prior signature widget | E-Sign on a counter-signed doc |
| `stress-200p.pdf` | 200 minimal pages | Split/merge perf, page-strip render, the RAM meter's honesty |

Each gets a `manifest.json` row with `pages`, `kind`, `summary`, `bytes`, `maxBytes`, and a new `expect` field — `"opens" | "opens-with-prompt" | "rejects-cleanly"` — so the smoke harness can assert graceful failure, not just success. That manifest change is the only structural ask; hand it to Cursor as a fixtures ticket.

---

## 5. First-run onboarding copy

Shown once, on first launch after install. One card, centered, dismissible with a single button. No carousel, no tour, no email field.

> ### PDF Relief is open.
>
> Your files never leave this Mac. No account, no cloud, no upload.
>
> **Start with File → Open PDF**, or drop a PDF anywhere on this window.
>
> - **Editor** — click a line, change the words, export
> - **Scan pages** — camera or photos into one clean PDF
> - **E-Sign** — sign a contract, keep the audit page
> - **Split · Merge** — take documents apart, put them back together
>
> Nothing you do here touches the original file until you save a copy.
>
> [ Get started ]

Dock-icon tooltip: **PDF Relief — your PDFs, on your machine.**

Empty-state line on home, after the card is dismissed: *Drop a PDF here, or File → Open PDF.*

Gatekeeper note, shown only if the build is unsigned and this is the first run: *macOS will ask once whether to open an app from an unidentified developer. Control-click the app → Open. This build is not signed yet.*

Rules for whoever implements it: never show twice, no "Next" chain, no progress dots, no confetti. If it takes more than four seconds to read, it is too long.

---

## Do this week

1. Run section 1 against a fresh `npm run pack:mac` build. Log pass/fail here in this file.
2. Run section 2 as an accept/reject on the four merged features. Anything failing becomes a Cursor bug ticket with the fixture that reproduces it.
3. Hand Cursor a single fixtures ticket: Tier 1 files + the `expect` manifest field.
4. Hand Cursor a single onboarding ticket: section 5 copy, one card, once.
5. Form fill is the highest-leverage unbuilt feature. It is the one thing standing between you and cancelling Acrobat.

Everything else waits.
