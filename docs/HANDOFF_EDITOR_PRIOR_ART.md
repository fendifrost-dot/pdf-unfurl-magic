# Handoff — PDF editor: is there anything out there worth taking?

**For:** GrokBot / Cursor
**From:** product + QA lead
**Date:** 2026-09-15
**Repo:** `pdf-unfurl-magic` · main @ `cba2a14`

---

## 0. The short answer

**No. Nobody has a permissively-licensed in-browser PDF body-text editor worth adopting.** This was already researched today and the result is in `docs/PRIOR_ART.md` — a full reuse map with SPDX licenses, maintenance dates, and a copyleft policy. **Read that file before proposing any library.** Do not commission a second survey.

Its verdict, compressed to the three reasons that matter:

1. **Every engine that genuinely rivals Acrobat is AGPL.** MuPDF.js, PyMuPDF, iText — all AGPL-3.0. Linking any of them makes PDF Relief AGPL. That is not a licensing nuance to argue about; it is the end of the product as a thing you can sell or ship closed.
2. **Stirling-PDF is open-core, not MIT.** 92k stars, and its GitHub SPDX is `NOASSERTION` — `app/proprietary`, `engine/`, and the desktop/SaaS frontend dirs are commercial. Treat it as a black box and a feature checklist, not a source of code.
3. **Every MIT browser "PDF editor" does the thing this repo exists to refuse.** ShizukuIchi/pdf-editor, pdf-master, PDF-Verse — they whiteout the original glyphs and stamp Helvetica on top. That is Acrobat TouchUp's bug. This repo already rewrites `Tj`/`TJ` in place, which is strictly better than anything on that list.

**PDF Relief's in-place text edit is, as of today, ahead of every permissively-licensed browser alternative.** There is nothing to copy. Keep building.

---

## 1. What changed since `PRIOR_ART.md` was written

That doc is hours old and already slightly behind. Three updates:

- **#25 landed permanent redaction** (`src/lib/pdf-redact.ts`, 485 lines). `PRIOR_ART.md` §5 still reads as if redaction is an open honesty gap. It is not — `erase` strips glyphs and punches images; `redact` is a Cover box and is named that way. The doc's own "port algorithms" recommendation was executed.
- **#24 is drafted, not hypothetical** — `cursor/acroform-fill-flatten-1d9e`, 1093 lines across 14 files.
- **A P0 is in flight on the Edit surface** — Apply leaves no completed on-page state, and Enhance has no exit. Regression window is almost certainly #20 / #21. Nothing in this handoff should be started before that lands.

---

## 2. The real gap in `PRIOR_ART.md`: forms

`PRIOR_ART.md` covers text edit, fonts, scan, OCR, e-sign, annotations, image replace, and Electron comparables. **It contains one passing mention of form filling** — a single bullet in the pdf-lib row. There is no AcroForm section, no discussion of appearance streams, no XFA analysis, no PDFium comparison.

That matters because **AcroForm fill + flatten is the Acrobat cancellation gate.** It is the one capability standing between the user and dropping a paid subscription. It deserved a section and did not get one.

The good news: #24 went and built it anyway, and built it well.

---

## 3. Evaluation brief — PR #24 (`cursor/acroform-fill-flatten-1d9e`)

**Recommendation: evaluate and merge, after the Edit Apply P0.** This is the highest-value unmerged work in the repo.

### What it already does right

- Uses pdf-lib's own `PDFForm` API rather than hand-rolling field dictionaries.
- **Detects XFA and refuses to pretend.** `catalogHasXfa()` plus an explicit warning: *"PDF Relief fills AcroForm widgets only — LiveCycle XFA is not supported and is discarded on export."* There is a dedicated test — *"warns on XFA-only forms and refuses to pretend they were filled."* This is the same honesty discipline as #22 and #25, applied unprompted. It is the single best signal in the PR.
- States its limits in a header comment: no XFA, no field JavaScript, no rich-text `RV`, no signature fields.
- Routes through `applyWorkshopPatches`, so Edit export shares one path instead of forking a second export pipeline.
- Ships 8 tests, including fill-without-flatten and leave-untouched-when-no-form.

### Review questions — answer these before merging

1. **Appearance streams on the non-flattened path.** There is a test for *"can fill without flattening so widgets stay interactive."* A grep of `pdf-acroform.ts` finds no `NeedAppearances` and no `updateFieldAppearances`. pdf-lib's `form.flatten()` regenerates appearances internally, so the flatten path is probably fine — but a **filled, non-flattened** form can open with visibly blank fields in Preview and Chrome, because those viewers render the widget's appearance stream, not its `/V`. **Fill a field, save without flattening, open in Preview and in Chrome.** If the value is invisible, the fix is `form.updateFieldAppearances()` before save, or setting `NeedAppearances` true. This is the classic pdf-lib form trap and it is the most likely defect in the PR.
2. **Is there a form fixture?** The tests reference "the sample form," and `fixtures/` contains no `*form*.pdf`. If the fixture is generated inline, the flatten path is not being tested against a file produced by a real form authoring tool. **`docs/fixture-staging/acroform-blank.pdf` already exists** — a real `/AcroForm` dict with five typed fields (`applicant_name`, `contact_phone`, `agree_terms`, `delivery_method`, `preferred_language`), built for exactly this. Wire it in. See §5 on adoption timing.
3. **Flatten correctness.** After flatten, confirm the widget annotations are gone from `/Annots`, `/AcroForm` is removed or emptied, the page text is selectable, and the values render at the right position and size. A flatten that leaves orphaned widget dicts behind is a corrupt file that opens fine and fails on print.
4. **Read-only and required fields.** `describeField` reads `isReadOnly()`. Confirm the UI actually prevents editing those rather than silently discarding the change on export.
5. **Field JavaScript is out of scope — is that acceptable?** Declared honestly in the header, which is correct practice. But the target user does **mortgage, lending, and credit work**, and those forms routinely carry calculated fields, format masks, and validation scripts. Filling one of those in PDF Relief produces a form whose totals do not update. That is a product decision, not a bug — but the UI should warn when `dictHasActions` finds field JavaScript, the same way it warns on XFA. Currently it appears to detect actions but the warning path should be confirmed.

### Do not ask this PR to do

Multi-page form flow, field creation, XFA support, signature fields, or calculated-field evaluation. It fills and flattens existing AcroForms. That is the cancellation gate. Ship that.

---

## 4. The two places outside work could still help

Everything else in `PRIOR_ART.md` is settled. These two are genuinely open.

### A. Editor interaction model — the actual current pain

`PRIOR_ART.md` is entirely about **engines**. It says nothing about **editor interaction**, which is where the live P0 is: Apply does not complete on-page, Enhance traps the user.

No library fixes this and none should be added for it. But the reference implementations are worth reading for their commit/exit loop specifically — **read the UX, take zero code**:

- **Mozilla's `AnnotationEditorLayer`** (Apache-2.0, already a dependency at `pdfjs-dist@4.10.38`) — how `AnnotationEditorUIManager` handles mode entry, commit, and exit. This is the closest thing to a correct model that is already in the tree.
- **Xournal++** (GPL-2.0 — *ideas only, never source*) — mature tool-mode switching with an always-available escape.

The rule for whoever fixes the P0: **every mode must have a visible exit, and every commit must produce visible on-page state.** That is a design invariant, not a library choice.

### B. `pdf-lib` maintenance risk

`PRIOR_ART.md` flags this correctly — last push 2024-07-17, official stance is that a text-replace API will never arrive — and lists escape hatches in order: fork pdf-lib (MIT), Muhammara in Electron, qpdf-wasm.

It does not name the existing maintained forks. Before ever forking from scratch, check whether a community fork has already absorbed the upstream fixes this repo needs. A fork that someone else maintains is cheaper than one you own. **Low priority** — pdf-lib being quiet is not the same as pdf-lib being broken, and nothing in the current build is blocked on it.

---

## 5. Fixture staging — do not adopt yet

`docs/fixture-staging/` holds six Tier 1 fixtures (`rotated-pages`, `mixed-page-sizes`, `acroform-blank`, `no-embedded-fonts`, `scanned-skew`, `password-open`) plus `CURSOR_TICKET.md` describing adoption.

**Hold.** `cursor/scan-aware-edit-b144` is actively rewriting `fixtures/generate.mjs` and `fixtures/manifest.json`. Adopting now guarantees a conflict in the generator.

**Exception:** `acroform-blank.pdf` can be lifted individually into #24 right now without touching the generator — copy the file, add its manifest row by hand. It is the fixture that PR is missing.

Notes carried from the build: `password-open.pdf` is genuinely AES-256 encrypted via `qpdf` (pdf-lib has no encryption support — this was documented rather than faked); `scanned-skew.pdf` needs `jpeg-js` as a devDependency, currently isolated in a staging `package.json` so the repo's own is untouched.

---

## 6. Do not re-propose these

`PRIOR_ART.md` already rejected all of the following on license grounds. Anyone suggesting them has not read it.

| Rejected | License | Why |
| --- | --- | --- |
| MuPDF.js, PyMuPDF, iText | AGPL-3.0 | Would AGPL the product |
| scribe.js, Upscayl, dangerzone | AGPL-3.0 | Same |
| OpenSign, Documenso, DocuSeal | AGPL-3.0 | Same, plus server-shaped |
| Stirling-PDF | Open-core, `NOASSERTION` | Proprietary carve-outs; treat as competitor |
| NAPS2, ScanTailor, Xournal++, pdfarranger | GPL-2/3 | Ideas only, never source |
| OpenCV.js / jscanify | MIT lib, ~30MB dep | Blows the PWA budget; port the ideas |
| PdfZero, pdf-master, PDF-Verse | No SPDX | Unlicensed is not permissive |
| Cloud Vision, Textract, Mistral OCR | Proprietary + upload | Breaks "files stay here" |

MPL-2.0 (OCRmyPDF, pikepdf) is acceptable **only** as a file-isolated Electron sidecar, never in the web bundle.

---

## 7. Recommended order

1. **Edit Apply + Enhance-exit P0** — blocks the Dock rebuild. Nothing else starts first.
2. **Lift `acroform-blank.pdf` into #24**, then work the five review questions in §3.
3. **Merge #24.** That is the Acrobat cancellation gate.
4. **Adopt Tier 1 fixtures** once `scan-aware-edit` lands and the generator stops moving.
5. **Standalone `npm run format` commit** — lint is red on main with 9 pre-existing prettier errors in `desktop/main.cjs`, unrelated to any feature branch. It masks real failures.

Nothing on this list requires a new dependency.
