# Synthetic PDF fixtures

Tiny, committed PDFs for PDF Relief QA. They are not real contracts, scans, or invoices.

Regenerate (overwrites the `.pdf` files and `manifest.json`):

```bash
npm run fixtures:generate
```

| File                  | Pages | What it is for                                                                                                                                  |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `simple-text.pdf`     | 1     | Load / click-to-edit / e-sign drop. Helvetica only. Contains `REPLACE_ME`.                                                                      |
| `multi-font.pdf`      | 1     | Font-matching after the edit-fidelity PR. Helvetica, Bold, Times, Courier.                                                                      |
| `lines-and-text.pdf`  | 1     | Table rules + a signature line. Neighbouring vectors must survive a one-box edit.                                                               |
| `image-and-text.pdf`  | 1     | Embedded PNG + caption. The image object must not flatten when text is edited.                                                                  |
| `comma-amounts.pdf`   | 1     | Amounts with commas (`2,500.00`) plus a multi-run POS line. Text-extract / font-mimic QA.                                                       |
| `multi-page.pdf`      | 3     | Split / extract / merge / **reorder 3-1-2** / **delete page 2** / **extract page 2**, page-count badge, untouched-page regression. Markers `PAGE_MARKER_1`…`3`. |
| `scan-image-only.pdf` | 1     | Full-page bitmap, no text operators. Scan-aware Enhance / OCR.                                                                                  |
| `redact-secret.pdf`   | 1     | `KEEP` / `SECRET` / `VISIBLE` plus a magenta-cyan PNG. Permanent redact QA.                                                                     |
| `acroform-blank.pdf`  | 1     | Five AcroForm widgets (name, email, city, size, agree). Email has format/calculate JS so Form UI must warn.                                     |
| `password-open.pdf`   | 1     | User-password encrypted page. Prompt on open; **user password `pdfrelief`**. View-only after unlock (pdf-lib cannot rewrite encrypted streams). |

AcroForm fill/flatten tests also generate a sample via `buildSampleAcroFormPdf()` in `src/lib/pdf-acroform.ts`. The committed `acroform-blank.pdf` is the same builder with `includeFieldJs: true`.

`password-open.pdf` is Standard security (RC4-128) from `src/lib/pdf-password-fixture.ts`. Do not put real client passwords or encrypted client files in this folder.

Sizes are capped in `manifest.json` (`maxBytes`). The smoke harness fails if a fixture grows past that cap.

Feature tests can import the loader without touching product code:

```js
import { loadFixture, readManifest } from "../tests/helpers/load-fixture.mjs";
```
