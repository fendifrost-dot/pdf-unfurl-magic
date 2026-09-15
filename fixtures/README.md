# Synthetic PDF fixtures

Tiny, committed PDFs for PDF Relief QA. They are not real contracts, scans, or invoices.

Regenerate (overwrites the `.pdf` files and `manifest.json`):

```bash
npm run fixtures:generate
```

| File | Pages | What it is for |
| --- | --- | --- |
| `simple-text.pdf` | 1 | Load / click-to-edit / e-sign drop. Helvetica only. Contains `REPLACE_ME`. |
| `multi-font.pdf` | 1 | Font-matching after the edit-fidelity PR. Helvetica, Bold, Times, Courier. |
| `lines-and-text.pdf` | 1 | Table rules + a signature line. Neighbouring vectors must survive a one-box edit. |
| `image-and-text.pdf` | 1 | Embedded PNG + caption. The image object must not flatten when text is edited. |
| `comma-amounts.pdf` | 1 | Amounts with commas (`2,500.00`) plus a multi-run POS line. Text-extract / font-mimic QA. |
| `multi-page.pdf` | 3 | Split / extract / merge, page-count badge, untouched-page regression. Markers `PAGE_MARKER_1`…`3`. |
| `scan-image-only.pdf` | 1 | Full-page bitmap, no text operators. Scan-aware Enhance / OCR. |

AcroForm fill/flatten tests generate their own sample via `buildSampleAcroFormPdf()` in `src/lib/pdf-acroform.ts` (text, checkbox, radio, dropdown). Run `fixtures:generate` after adding a committed `acroform-simple.pdf` builder if you want that file on disk for manual QA.

Sizes are capped in `manifest.json` (`maxBytes`). The smoke harness fails if a fixture grows past that cap.

Feature tests can import the loader without touching product code:

```js
import { loadFixture, readManifest } from "../tests/helpers/load-fixture.mjs";
```
