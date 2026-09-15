# Prior art / open-source reuse map

**PDF Relief** (`pdf-unfurl-magic`) already ships a local-first workshop: in-place `Tj`/`TJ` rewrite, Standard-14 font matching, camera scan + homography, Tesseract.js OCR, e-sign overlays, annotation burns, and in-PDF image studio. This document is the reuse map so the next two weeks pick **libraries**, not rebuild OCR/edit pipelines.

Researched **2026-09-15** from GitHub API, npm registry, and project READMEs/licenses. Stars and push dates go stale; licenses should be re-checked before vendoring.

## Top 5 reuse wins for the next 2 weeks

Ordered by impact on headaches we still have, not by GitHub stars.

| # | Win | Action | Where it lands | Effort | Why now |
| --- | --- | --- | --- | --- | --- |
| 1 | **`@pdf-lib/fontkit` + SIL OFL Liberation/Noto** | **depend** fontkit; **vendor** OFL `.ttf` (subset at embed time) | `src/lib/pdf-font-match.ts`, `src/lib/pdf-text-edit.ts` | **1–2 days** | WinAnsi Standard 14 cannot encode most of the world. Today we block or redraw Helvetica. Embedding a metric-compatible face (Liberation Sans ≈ Arial/Helvetica) is the only permissive, browser-safe way to stop `?` glyphs without Creative Cloud. |
| 2 | **Invisible OCR layer = text rendering mode 3** (port Tesseract/OCRmyPDF, keep `tesseract.js`) | **port algorithms**; keep existing **depend** | `src/lib/scan/pdf.ts`, `src/lib/scan/ocr.ts` | **4–8 hours** | We already run Tesseract.js and stamp words with `opacity: 0`. Acrobat, Tesseract’s PDF renderer, and OCRmyPDF use `/Tr 3` (neither fill nor stroke). Opacity-0 glyphs fail PDF/A and can reappear when flattened. Highest OCR quality-per-hour change. |
| 3 | **`signature_pad` (MIT)** | **depend** (landed) | `src/components/signature-capture.tsx` | **2–4 hours** | Homegrown pointer drawing is fine for MVP; `signature_pad` is the maintained 12k-star pad (velocity strokes, SVG/PNG, high-DPI). Drop-in for e-sign feel without DocuSign. |
| 4 | **In-place image XObject replace** (port pdf-lib #175 / pdfcpu `images update`) | **port algorithms** on existing pdf-lib | `src/lib/pdf-images.ts`, `src/lib/pdf-tools.ts` | **1–2 days** | Image Studio currently paints a **white rectangle + new image** on top of the original XObject (same class of corruption as TouchUp whiteout). Reassigning the existing `/ImN` stream keeps text, rules, and file size honest. |
| 5 | **pdf.js `AnnotationEditorLayer` we already ship** (`pdfjs-dist@4.10.38`) | **depend** (already); **port** save path | `src/lib/pdf-marks.ts`, `src/routes/edit.tsx` | **2–3 days** | Mozilla’s editor writes real `Highlight` / `Ink` / `FreeText` / `Stamp` annotations via `PDFDocumentProxy.saveDocument()`. Our marks are burned pdf-lib rectangles. Using the engine we already load avoids `pdfAnnotate` (stale) and AGPL e-sign suites. |

**Do not do in the next two weeks:** OpenCV.js / jscanify as a dependency (~30 MB unpacked), scribe.js (AGPL), MuPDF.js (AGPL), Stirling as a vendored app, OCRmyPDF inside the browser, or any DocuSign-clone (OpenSign / Documenso / DocuSeal — all AGPL).

**Shipped:** #1 is in tree (`src/lib/pdf-unicode-fonts.ts`, `public/fonts/`, `@pdf-lib/fontkit`). Text export embeds a subsetted Liberation/Noto face when Standard 14 cannot encode the run.

---

## How to use this map

| Recommendation | Meaning |
| --- | --- |
| **depend** | Add the npm package. Permissive license. Fits browser or Electron. |
| **vendor** | Copy a small, clearly licensed artifact (font file, algorithm snippet) into the repo with attribution. |
| **port algorithms** | Read their approach; reimplement against our pdf-lib / PDF.js / canvas stack. Do not copy GPL/AGPL source. |
| **skip** | Wrong license, wrong runtime, unmaintained, or solves a problem we already solved. |

**Copyleft policy for this repo:** PDF Relief is a local product, not AGPL. Do **not** `npm install` AGPL/GPL libraries into the web bundle. MPL-2.0 (file-level copyleft) is acceptable for an **optional Electron sidecar** if we keep those files separate. Dual-license “open core” trees (Stirling, OpenSign) must be treated as **not MIT** until a lawyer reads the carve-outs.

False leads from the brief: **Hopscotch** is LinkedIn’s old product-tour JS, not a PDF tool. **KafkaJS** is a Kafka client. **PaperMerge** is an archived document-management system, not an editor.

---

## What this repo already owns (do not replace)

| Piece | Path | Stack today |
| --- | --- | --- |
| In-place text rewrite (no whiteout) | `src/lib/pdf-content-stream.ts`, `src/lib/pdf-text-edit.ts` | pdf-lib low-level streams |
| Font family / WinAnsi / “?” block | `src/lib/pdf-font-match.ts` | Standard 14 only |
| Scan detect + warp + enhance | `src/lib/scan/detect.ts`, `warp.ts`, `enhance.ts`, `geometry.ts` | Canvas, Otsu, homography |
| OCR worker | `src/lib/scan/ocr.ts` | `tesseract.js` ^6 |
| Searchable scan PDF | `src/lib/scan/pdf.ts` | JPEG page + `opacity: 0` Helvetica |
| E-sign + SHA-256 audit page | `src/lib/esign.ts`, `src/components/signature-capture.tsx` | pdf-lib overlay |
| Highlight / note / **visual** redact | `src/lib/pdf-marks.ts` | Burned rectangles (text still extractable) |
| Image studio (detect / decode / overlay replace) | `src/lib/pdf-images.ts`, `src/lib/pdf-tools.ts` `applyWorkshopPatches` | PDF.js ops + pdf-lib draw |
| Desktop shell | `desktop/main.cjs` | Electron + vite preview on 127.0.0.1 |
| Render / parse | `package.json` | `pdf-lib` MIT, `pdfjs-dist` 4.10.38 Apache-2.0 |

---

## 1) In-place PDF text edit (no Acrobat TouchUp whiteout / `?` glyphs)

**Problem:** Acrobat TouchUp (and naive pdf-lib tutorials) hide old glyphs under a white `re` and draw Helvetica on top. Selectable duplicate text, shifted baselines, eaten rules. This repo already **rewrites the matching `Tj`/`TJ`**. Remaining gaps: Type0/CID / ToUnicode, Form XObjects, and fonts that cannot encode the new characters.

### `pdf-lib` — already depended

| | |
| --- | --- |
| **Repo** | https://github.com/Hopding/pdf-lib |
| **License** | **MIT** |
| **Maintenance** | ~8.6k stars; last push **2024-07-17** (quiet, still the JS modify standard) |
| **Does well** | Load/save, page copy, form fill, draw, Standard 14, embed JPEG/PNG, low-level `PDFRawStream` / `context.assign` (exactly how `writeStream` works). |
| **Does poorly** | **No high-level text replace.** Official stance: overlay or form fields only ([issue #564](https://github.com/Hopding/pdf-lib/issues/564), [discussion #1770](https://github.com/Hopding/pdf-lib/discussions/1770)). Naive `string.replace` on inflated streams breaks encodings. Quiet upstream. |
| **Action** | **depend** (keep). Do not expect a text-edit API to appear. |
| **Integration** | Already `src/lib/pdf-text-edit.ts`. |
| **Effort** | 0 (in tree). |

### Mozilla PDF.js — already depended

| | |
| --- | --- |
| **Repo** | https://github.com/mozilla/pdf.js |
| **License** | **Apache-2.0** |
| **Maintenance** | ~54k stars; pushed daily |
| **Does well** | Render, text layer hit-testing, font / ToUnicode extraction, operator list (we use this for images), **annotation editor + `saveDocument()`**. |
| **Does poorly** | Not a content-stream rewriter. Cannot do in-place `Tj` replace. Editor annotations are overlays, not body-text edits. |
| **Action** | **depend** (keep) for hit-testing and later annotation save. |
| **Integration** | `src/lib/pdf-runtime.ts`, `src/routes/edit.tsx`. |
| **Effort** | 0 for text edit; see §5 for annotations. |

### Apache PDFBox (algorithm reference)

| | |
| --- | --- |
| **Repo** | https://github.com/apache/pdfbox |
| **License** | **Apache-2.0** |
| **Maintenance** | ~3.1k stars; active |
| **Does well** | Content-stream parse/write, CMap/ToUnicode, fontbox, image XObjects. Battle-tested Type0 handling. |
| **Does poorly** | Java. Not a browser library. Huge. |
| **Action** | **port algorithms** when CID/`TJ` arrays or Form XObjects break our tokenizer. **skip** as a runtime depend. |
| **Integration** | Read `PDFStreamParser` / `ContentStreamWriter` patterns into `src/lib/pdf-content-stream.ts`. |
| **Effort** | **2–4 days** for CID/ToUnicode (only when fixtures fail). |

### qpdf / pikepdf (not in the web bundle)

| | qpdf | pikepdf |
| --- | --- | --- |
| **Repo** | https://github.com/qpdf/qpdf | https://github.com/pikepdf/pikepdf |
| **License** | **Apache-2.0** | **MPL-2.0** (file-level copyleft — OK as sidecar, not mixed into MIT files casually) |
| **Maintenance** | ~5.4k / ~2.8k stars; active | same |
| **Does well** | Object-preserving rewrite, QDF mode for inspecting streams, decrypt, linearize. pikepdf is the Pythonic qpdf for image/XObject surgery. |
| **Does poorly** | Native C++ / Python. Not our TanStack/Vite path. |
| **Action** | **skip** in browser. Optional **depend** only if we add a desktop “repair this broken PDF” tool. WASM ports exist (`jsscheller/qpdf-wasm`, Apache-2.0, tiny stars) — too early. |
| **Integration** | `desktop/` sidecar, never `src/lib`. |
| **Effort** | **3–5 days** if we ever need a repair CLI; **skip** for 2 weeks. |

### MuhammaraJS / HummusJS

| | |
| --- | --- |
| **Repo** | https://github.com/julianhille/MuhammaraJS (Hummus successor) |
| **License** | **Apache-2.0** |
| **Maintenance** | ~300 stars; native C++ bindings; active |
| **Does well** | Low-level page content edits in **Node/Electron**. |
| **Does poorly** | Not browser. Native addons + electron-builder pain. Web app would fork. |
| **Action** | **skip** while the product is one TypeScript codebase for web + desktop. Revisit only if in-place edit hits a wall pdf-lib cannot cross. |
| **Effort** | **1 week+** of packaging if ever. |

### MuPDF.js / PyMuPDF / iText

| Project | License | Action |
| --- | --- | --- |
| [ArtifexSoftware/mupdf.js](https://github.com/ArtifexSoftware/mupdf.js) (~608★) | **AGPL-3.0 — copyleft risk** | **skip** (would AGPL the product if linked) |
| [pymupdf/PyMuPDF](https://github.com/pymupdf/PyMuPDF) (~10k★) | **AGPL-3.0** | **skip** |
| [itext/itext-java](https://github.com/itext/itext-java) | **AGPL-3.0** (commercial dual-license) | **skip** |
| [LibrePDF/OpenPDF](https://github.com/LibrePDF/OpenPDF) | **MPL-2.0 OR LGPL-2.1+** | **skip** as runtime (Java); **port algorithms** only if PDFBox is not enough |

### Overlay-only “PDF editors” (do not copy their text-edit)

These are popular and **wrong** for our text engine: they whiteout or stamp Helvetica.

| Repo | License | Notes | Action |
| --- | --- | --- | --- |
| [ShizukuIchi/pdf-editor](https://github.com/ShizukuIchi/pdf-editor) (~1.9k★) | MIT | Browser overlay of images/signatures/text. Last real push 2024-02. | **skip** (we already refuse this for body text) |
| [topul/pdf-master](https://github.com/topul/pdf-master) | unlicensed / unclear | Electron + pdf-lib; README admits overlay. Uses qpdf-wasm for compress. | **skip** code; **port** qpdf-wasm idea later |
| [bevinkatti/PdfZero](https://github.com/bevinkatti/PdfZero) | no SPDX | Local-first marketing; tiny/unclear license | **skip** |
| [awesome-yasin/PDF-Verse](https://github.com/awesome-yasin/PDF-Verse) | no SPDX; stale 2024 | Kitchen-sink web editor | **skip** |

**2-week verdict for text edit:** keep our tokenizer. Next code is **font embedding** (§2), not a new PDF engine.

---

## 2) Font matching from embedded + system fonts / metric substitution

**Problem:** Replacement text must (a) encode without `.notdef`/`?`, (b) keep approximate widths so neighbours do not collide. We map names → Standard 14 and refuse characters outside WinAnsi. We never download Adobe fonts.

### `@pdf-lib/fontkit` + `fontkit`

| | |
| --- | --- |
| **Repos** | https://github.com/Hopding/fontkit (npm `@pdf-lib/fontkit` **MIT**, v1.1.1) · upstream https://github.com/foliojs/fontkit (**MIT**, ~1.7k★, last push 2024-08) |
| **Does well** | TTF/OTF/WOFF parse, glyph ids, `widthOfGlyph`, subset for `pdfDoc.embedFont(bytes, { subset: true })`. The documented way off Standard 14. |
| **Does poorly** | Subsetting is buggy on some CJK fonts ([pdf-lib #494](https://github.com/Hopding/pdf-lib/issues/494)). `@pdf-lib/fontkit` last npm publish **2022**. ~466 KB unpacked — acceptable. |
| **Action** | **depend** `@pdf-lib/fontkit`. Call `pdfDoc.registerFontkit(fontkit)` only on the redraw-embedded path. |
| **Integration** | `src/lib/pdf-font-match.ts` (coverage + metrics), `src/lib/pdf-text-edit.ts` (when `canReuseEmbeddedFont` is false **and** glyphs are missing from WinAnsi, embed Liberation/Noto subset instead of blocking or Helvetica). |
| **Effort** | **1–2 days** including fixtures for `€`, `Łódź`, a CJK skip. |

### Metric-compatible faces (vendor the files, not the foundries’ names as Adobe)

| Face | License | Substitutes | Action |
| --- | --- | --- | --- |
| [Liberation Fonts](https://github.com/liberationfonts/liberation-fonts) | **SIL OFL 1.1** | Arial ≈ Helvetica, Times New Roman, Courier New | **vendor** Regular/Bold/Italic (~few hundred KB; subset per export) |
| [Google Noto](https://github.com/notofonts/latin-greek-cyrillic) | **SIL OFL 1.1** | Broad Unicode when Liberation lacks a glyph | **vendor** Noto Sans as second fallback |
| Adobe Source Sans | **SIL OFL 1.1** | Nice UI; **not** metric-matched to Helvetica | **skip** for body rewrite; OK for e-sign typed names |
| URW++ / Nimbus (Ghostscript) | historically **GPL/AGPL** variants | Helvetica metrics | **skip** — copyleft fonts in the app is a trap |

**System fonts:** `queryLocalFonts()` (Chromium) can list installed faces for **preview** only. Embedding a user’s Arial into an exported PDF has **license risk**. Do not embed system fonts unless we detect an OFL/Apache file the user picked.

### `opentype.js` / `harfbuzzjs` / Typr.js

| Repo | License | Action |
| --- | --- | --- |
| [opentypejs/opentype.js](https://github.com/opentypejs/opentype.js) (~5k★, MIT, active) | MIT | **skip** if fontkit is in; **depend** only if we need path drawing without pdf-lib embed |
| [harfbuzz/harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) (MIT) | MIT | **skip** for 2 weeks (shaping Arabic/Indic). Revisit when we edit RTL PDFs. |
| [photopea/Typr.js](https://github.com/photopea/Typr.js) (MIT) | MIT | **skip** (weaker than fontkit; Photopea-oriented) |

### PDF.js font objects

PDF.js already resolves embedded fonts for rendering. We can read **widths / ToUnicode** from the same page we click, then decide “reuse CID font” vs “embed Liberation”.

| **Action** | **port algorithms** from `src/core/fonts.js` (do not copy GPL — this file is Apache). |
| **Integration** | `src/lib/pdf-font-match.ts` plus a small helper next to `getPdfJs()`. |
| **Effort** | **1–2 days** after fontkit lands, if subsetted Type0 still blocks edits. |

**2-week verdict:** depend fontkit, vendor Liberation (+ Noto Sans), keep Standard 14 when the page already uses it.

---

## 3) Scan detection, upscale/denoise, perspective (Genius Scan–like)

**Problem:** Phone photo → document quad → warp → enhance. We already have Otsu + hull + homography + unsharp/auto-levels in `src/lib/scan/`. Remaining gaps: glare, weak detection on dark desks, denoise, true super-resolution.

### jscanify

| | |
| --- | --- |
| **Repo** | https://github.com/puffinsoft/jscanify |
| **License** | **MIT** (npm `jscanify` 1.4.3) |
| **Maintenance** | ~1.8k stars; pushed 2026-07; ~21k weekly npm |
| **Does well** | Paper contour, corner points, `extractPaper` warp, v1.3+ glare suppression and multi-color paper. Same problem we solve. |
| **Does poorly** | **Depends on OpenCV.js** (`opencv.js` npm ≈ **30 MB unpacked**). That blows the PWA/Electron download we care about. Detection quality still needs a desk contrast. |
| **Action** | **skip** as depend. **port algorithms** for glare / contour scoring into `src/lib/scan/detect.ts` and `enhance.ts` (MIT lets us read and reimplement; do not vendor the OpenCV build). |
| **Effort** | **1–2 days** to steal the *ideas* (adaptive threshold + largest quad + glare inpaint), not the WASM. |

### OpenCV / OpenCV.js

| | |
| --- | --- |
| **Repo** | https://github.com/opencv/opencv — **Apache-2.0** |
| **npm** | `opencv.js` **BSD-3-Clause**, ~30 MB |
| **Does well** | Canny, findContours, `getPerspectiveTransform`, CLAHE, bilateral, inpaint — the Genius Scan textbook pipeline. |
| **Does poorly** | Payload size; WASM init time on phones; we already implemented the 80% path. |
| **Action** | **skip** depend. **port algorithms** (we mostly have). Optional **lazy-load** OpenCV later behind a “precision detect” toggle in Electron only. |
| **Integration** | `src/lib/scan/detect.ts`, `warp.ts`. |
| **Effort** | 0 now; **3+ days** if we add optional WASM. |

### wasm-vips + pica (enhance / resize, not detect)

| | wasm-vips | pica |
| --- | --- | --- |
| **Repo** | https://github.com/kleisauke/wasm-vips | https://github.com/nodeca/pica |
| **License** | **MIT** | **MIT** |
| **Size** | ~4.3 MB unpacked | tiny |
| **Does well** | libvips in WASM: sharpen, greyscale, CLAHE-like, JPEG encode. pica is the best JS high-quality downscale (Lanczos). |
| **Does poorly** | vips still a fat lazy chunk. pica does **not** super-resolve; it prevents aliasing when we shrink. |
| **Action** | **depend** `pica` for scan export resize (**hours**). **defer** wasm-vips unless enhance presets stay weak. |
| **Integration** | `src/lib/scan/process.ts`, `image.ts`. |

### AI upscale (Real-ESRGAN / Upscayl / transformers.js)

| Project | License | Action |
| --- | --- | --- |
| [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | **BSD-3-Clause** (check model weights separately) | **port** later via ONNX; **skip** 2 weeks (GPU, 10s+/page) |
| [upscayl/upscayl](https://github.com/upscayl/upscayl) (~49k★) | **AGPL-3.0 — copyleft** | **skip** |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | **Apache-2.0** | **skip** for now; possible desktop “denoise” experiment |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | **MIT** | **depend** only with a tiny document-enhance model + user opt-in download |

### NAPS2 / ScanTailor / unpaper / Dynamsoft

| Project | License | Action |
| --- | --- | --- |
| [cyanfish/naps2](https://github.com/cyanfish/naps2) (~4.5k★) | **GPL-2.0-or-later — copyleft** | **skip** vendoring. **port algorithms** (deskew, blank-page) by reading docs, not source dump |
| [4lex4/scantailor-advanced](https://github.com/4lex4/scantailor-advanced) | **GPL-3.0** | **skip** |
| [unpaper/unpaper](https://github.com/unpaper/unpaper) | typically **GPL-2** (no GitHub SPDX) | **skip** |
| [Dynamsoft/document-scanner-javascript](https://github.com/Dynamsoft/document-scanner-javascript) | **proprietary** | **skip** |

**2-week verdict:** keep our detector. Port jscanify glare/contour **ideas**. Add `pica` if JPEG export looks crunchy.

---

## 4) OCR → searchable / editable layer

**Problem:** Scan JPEG stays the picture; words become selectable. We have Tesseract.js + invisible Helvetica. Gaps: rendering mode, encodings beyond WinAnsi, deskew-before-OCR, PDF/A, existing-text-layer skip.

### tesseract.js — already depended

| | |
| --- | --- |
| **Repo** | https://github.com/naptha/tesseract.js |
| **License** | **Apache-2.0** (core: [tesseract.js-core](https://github.com/naptha/tesseract.js-core) Apache-2.0) |
| **Maintenance** | ~39k stars; npm current **7.0.0** (we are on ^6 — fine). Pushed 2026-05. |
| **Does well** | WASM LSTM in a worker; 100+ languages; word boxes; no upload. Official stance: **images only**, not PDF-in. |
| **Does poorly** | ~35 MB with eng data if not lazy; handwriting; tables. Default CDN fetch of `traineddata` — we should **self-host** `eng.traineddata` under `public/` for true offline (privacy promise). |
| **Action** | **depend** (keep). Upgrade path to v7 when we want built-in rotate preprocess. **vendor** English traineddata. |
| **Integration** | `src/lib/scan/ocr.ts`, `desktop/copy-worker.cjs` (copy wasm + traineddata like the pdf.js worker). |
| **Effort** | **half day** to self-host models; **hours** for `/Tr 3`. |

Tesseract’s own searchable-PDF recipe (and OCRmyPDF) place glyphs with **text rendering mode 3**. Port that into `buildScanPdf` instead of `opacity: 0`. Use fontkit/Noto if a word is not WinAnsi (same as §2).

### OCRmyPDF

| | |
| --- | --- |
| **Repo** | https://github.com/ocrmypdf/OCRmyPDF |
| **License** | **MPL-2.0** (not GPL; sidecar-friendly) |
| **Maintenance** | ~35k stars; pushed today |
| **Does well** | Gold standard: deskew, rotate, unpaper-clean, PDF/A, lossless text layer under original images, skip-text, redo-ocr, parallel pages. |
| **Does poorly** | Python + Tesseract + Ghostscript native. **Not WASM.** Wrong for the browser workshop. |
| **Action** | **skip** in web. Optional Electron **sidecar** (`ocrmypdf` on PATH) for “make this 200-page archive searchable” — **depend** as documented external binary, do not vendor the tree. **port algorithms**: `/Tr 3`, “skip if text exists”, deskew-before-OCR. |
| **Integration** | Algorithm: `src/lib/scan/pdf.ts`. Sidecar (later): `desktop/main.cjs` spawn. |
| **Effort** | **hours** to port layer semantics; **2–3 days** for optional desktop binary. |

### scribe.js / Scribe OCR

| | |
| --- | --- |
| **Repo** | https://github.com/scribeocr/scribe.js · GUI https://github.com/scribeocr/scribeocr |
| **License** | **AGPL-3.0 — copyleft risk** (npm `scribe.js-ocr`). Proprietary license sold separately. |
| **Does well** | Better accuracy than stock Tesseract; native PDF text extract + OCR + searchable layer. Tesseract.js README even points here. |
| **Does poorly** | AGPL on the **front-end** would force us open or buy a license. |
| **Action** | **skip** as depend. **port algorithms** only from their public docs (layout, font size from bbox). Do not copy source. |
| **Effort** | 0 this sprint. |

### Other OCR

| Project | License | Action |
| --- | --- | --- |
| [sebastianheide/pdf-ocr-ts](https://github.com/sebastianheide/pdf-ocr-ts) | check before use | Thin pdf.js + tesseract.js + pdf-lib merge of Tesseract’s per-page PDFs. **port** merge idea; **skip** extra wrapper. |
| [ben-gy/textlift](https://github.com/ben-gy/textlift) | **AGPL-3.0** | Nice local-first UX notes; **skip** code |
| PaddleOCR / RapidOCR / EasyOCR | Apache (engines) but Python/ONNX heavy | **skip** in browser; possible later desktop |
| Cloud Vision / Textract / Mistral OCR | proprietary, **upload** | **skip** (violates “files stay here”) |

**2-week verdict:** keep tesseract.js; self-host `eng`; write mode-3 text; embed Noto for non-Latin OCR words.

---

## 5) E-sign / annotation / redact

**Problem:** Local marks, not PKI/PAdES. We overlay PNG signatures + date + certificate page. Annotations are burned shapes. “Redact” is a black rectangle — **underlying text still copies**. That is the remaining honesty gap.

### signature_pad

| | |
| --- | --- |
| **Repo** | https://github.com/szimek/signature_pad |
| **License** | **MIT** · npm `signature_pad` 5.x |
| **Maintenance** | ~12k stars; pushed 2026-09-13 |
| **Does well** | Velocity-weighted ink, SVG or PNG, retina, undo. The default pad every commercial tutorial wraps. |
| **Does poorly** | Not PDF-aware; we still embed PNG via pdf-lib (good). |
| **Action** | **depend** — landed in `src/components/signature-capture.tsx`. Type-to-sign and `src/lib/esign.ts` export/audit are unchanged. |
| **Integration** | `src/components/signature-capture.tsx` (replace custom `stroke()`). Keep `src/lib/esign.ts` for placement/hash. |
| **Effort** | **2–4 hours**. |

### perfect-freehand

| | |
| --- | --- |
| **Repo** | https://github.com/steveruizok/perfect-freehand |
| **License** | **MIT** (~5.7k★) |
| **Action** | **skip** if signature_pad is enough; **depend** only for highlighter ink that should look like GoodNotes. |
| **Integration** | `src/lib/pdf-marks.ts` / edit canvas. |
| **Effort** | **half day**. |

### pdf.js AnnotationEditorLayer (preferred annotator)

| | |
| --- | --- |
| **Repo** | bundled in https://github.com/mozilla/pdf.js (Apache-2.0) |
| **Does well** | FreeText, Ink, Stamp, Highlight as **real PDF annotations**. `saveDocument()` writes them. Other viewers see them. We already load pdfjs-dist **4.10.38** (Highlight exists in 4.x). |
| **Does poorly** | Wiring a custom React viewer to `EventBus` / `AnnotationEditorUIManager` is fiddly. Round-trip edit-after-save has been historically incomplete for ink (improving upstream). Not a redaction tool. |
| **Action** | **depend** (already). **port** a thin adapter instead of highkite/pdfAnnotate. |
| **Integration** | New `src/lib/pdf-annotate-js.ts` used by `src/routes/edit.tsx`; keep `pdf-marks.ts` for **burn-in export** when the user wants flattened print. |
| **Effort** | **2–3 days**. |

### pdfAnnotate / pdf-annotate.js / react-pdf-highlighter

| Repo | License | Maintenance | Action |
| --- | --- | --- | --- |
| [highkite/pdfAnnotate](https://github.com/highkite/pdfAnnotate) | MIT | ~638★, last push **2023-03** | **skip** (stale; pdf.js editor superseded it) |
| [Submitty/pdf-annotate.js](https://github.com/Submitty/pdf-annotate.js) (Instructure lineage) | MIT | ~295★, 2026-02 | **skip** unless pdf.js editor cannot highlight text selections we need |
| [agentcooper/react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter) | MIT | ~1.4k★, last push 2024-11 | **skip** for now; Hypothesis-style research UX, not workshop export |

### node-signpdf (PKI — not e-sign MVP)

| | |
| --- | --- |
| **Repo** | https://github.com/vbuch/node-signpdf |
| **License** | **MIT** |
| **Does well** | PKCS#7 `/ByteRange` digital signatures in Node. |
| **Does poorly** | Needs a cert; not browser-first; **not** what our SHA-256 audit page is. Roadmap already defers PKI. |
| **Action** | **skip** until “Deferred: PKI certificates”. Then **depend** in Electron only. |
| **Integration** | `src/lib/esign.ts` / `esign-remote-stub.ts`. |
| **Effort** | **3–5 days** when we mean it. |

### OpenSign / Documenso / DocuSeal (DocuSign clones)

| Repo | License | Action |
| --- | --- | --- |
| [OpenSignLabs/OpenSign](https://github.com/OpenSignLabs/OpenSign) (~7k★) | **AGPL-3.0** (open-core carve-outs) | **skip** — server, Mongo, AGPL |
| [documenso/documenso](https://github.com/documenso/documenso) (~15k★) | **AGPL-3.0** | **skip** |
| [docusealco/docuseal](https://github.com/docusealco/docuseal) (~18k★) | **AGPL-3.0** | **skip** |

**port** only UX ideas (field kinds, certificate page — we already have one). Do not vendor.

### True redaction

Visual black boxes are **not** redaction. Underlying operators remain.

| Project | License | Action |
| --- | --- | --- |
| [freedomofpress/dangerzone](https://github.com/freedomofpress/dangerzone) | **AGPL-3.0** | **skip** as code; **port the idea**: rasterize page → crop → new PDF (we can do this with pdf.js render + pdf-lib, no AGPL) |
| [firstlookmedia/pdf-redact-tools](https://github.com/firstlookmedia/pdf-redact-tools) | archived | **skip** |
| Stirling redaction (MIT parts) | mixed open-core | **port algorithms** from MIT files only after reading `LICENSE` carve-outs |

Honest redact for this app: render page to canvas, fill black in **pixel space**, embed JPEG, **drop original content stream**. Label the UI “flatten + burn” until content-stream erasure exists.

| **Action** | **port algorithms** (raster flatten). |
| **Integration** | `src/lib/pdf-marks.ts` `kind === "redact"` export path. |
| **Effort** | **1–2 days** for flatten-on-export; **days–week** for true operator erasure. |

**2-week verdict:** signature_pad + pdf.js editor for live marks; flatten-on-export for redact; no AGPL e-sign suite.

---

## 6) Electron / local-first PDF workstations (privacy, no upload)

**Problem:** We already wrap Vite in Electron (`desktop/main.cjs`), bind 127.0.0.1, never upload. Other apps are useful as **product comparables**, not drop-in code.

| Project | License | Local? | Action |
| --- | --- | --- | --- |
| **This repo** | product | Yes | Keep. |
| [Stirling-Tools/Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) (~92k★) | **Open-core**: MIT **except** `app/proprietary`, `engine/`, `frontend/src/{proprietary,desktop,saas}` (commercial). GitHub SPDX `NOASSERTION`. | Self-host **server** (Java). Desktop bits may be proprietary. | **skip** vendoring the app. **port algorithms** from MIT modules (merge/split/ocr wrappers) only with a file-by-file license check. Do **not** copy proprietary dirs. |
| [cyanfish/naps2](https://github.com/cyanfish/naps2) | **GPL-2.0+** | Yes, excellent scanner | **skip** code. UX reference for scan lane. |
| [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | **GPL-3.0** | Server DMS | **skip** (archive product, not editor) |
| [ciur/papermerge](https://github.com/ciur/papermerge) | Apache-2.0 | **archived** DMS | **skip** |
| [xournalpp/xournalpp](https://github.com/xournalpp/xournalpp) | **GPL-2.0** | Native annotator | **skip** |
| [pdfarranger/pdfarranger](https://github.com/pdfarranger/pdfarranger) | **GPL-3.0** | GTK rearrange | **skip** (we have split/merge) |
| [gotenberg/gotenberg](https://github.com/gotenberg/gotenberg) | MIT | Server (LibreOffice/Chromium) | **skip** (upload-shaped, not local-first) |
| [ShizukuIchi/pdf-editor](https://github.com/ShizukuIchi/pdf-editor) | MIT | Yes, overlay editor | **skip** engine; UX reference for stamps |
| [topul/pdf-master](https://github.com/topul/pdf-master) | unclear | Electron + qpdf-wasm | **skip** until they SPDX; idea: wasm compress |
| [pdfme/pdfme](https://github.com/pdfme/pdfme) | MIT | Template designer | **skip** (generate, don’t edit existing body text) |
| [hyzyla/pdfium](https://github.com/hyzyla/pdfium) (`@hyzyla/pdfium` MIT) | MIT wrapper; PDFium is BSD-style | WASM render/extract | **skip** while PDF.js works; ~11 MB. Revisit if pdf.js font extract is not enough. |
| [ArtifexSoftware/mupdf.js](https://github.com/ArtifexSoftware/mupdf.js) | **AGPL-3.0** | Excellent native-class editor | **skip** |

**2-week verdict:** do not absorb another workstation. Steal **scan UX** from NAPS2 (ideas only) and **annotation save** from pdf.js. Stirling is a competitor with a mixed license — treat as black box.

---

## 7) In-PDF image replace / edit

**Problem:** Image Studio finds XObjects via PDF.js `getOperatorList`, decodes pixels, lets the user crop/adjust, then **`applyWorkshopPatches` draws a white rect + new image**. Original JPEG is still in the file. Same family of bug as TouchUp.

### Keep: PDF.js operator list (already)

Best permissive image **locator** in JS ([pdf-lib #83](https://github.com/Hopding/pdf-lib/issues/83) even points at `PDFImage`). **depend** (keep). Integration: `src/lib/pdf-images.ts`.

### Port: in-place XObject replace

pdf-lib has **no** high-level replace API ([issue #175](https://github.com/Hopding/pdf-lib/issues/175)). The working pattern:

1. Find the page resource name (`/Im0`) matching the clicked region.
2. `embedJpg` / `embedPng` **or** build a `PDFRawStream` with `/Width` `/Height` `/Length` `/Filter /DCTDecode`.
3. `page.node.Resources().lookup(PDFName.of("XObject")).set(PDFName.of(name), newRef)` **or** `context.assign(oldRef, newStream)` so every `/Im0 Do` updates.
4. Delete stale `/SMask` if the replacement has no alpha.

pdfcpu’s CLI (`pdfcpu images update`, Apache-2.0, https://github.com/pdfcpu/pdfcpu) is the same idea in Go — **skip** as binary; **port algorithms**.

| **Action** | **port algorithms** |
| **Integration** | Replace the whiteout block in `src/lib/pdf-tools.ts` `applyWorkshopPatches`; keep canvas edits in `src/lib/image-process.ts`. |
| **Effort** | **1–2 days** + fixtures `fixtures/image-and-text.pdf`. |

### pica / browser-image-compression

| Package | License | Action |
| --- | --- | --- |
| [nodeca/pica](https://github.com/nodeca/pica) | MIT | **depend** for downscale before JPEG encode (studio quality slider) |
| [Donaldcwl/browser-image-compression](https://github.com/Donaldcwl/browser-image-compression) | MIT, last push 2024-03 | **skip** (pica + canvas `toBlob` is enough) |

### Stirling / pikepdf image pipelines

Useful as tests of “does the page still text-select after replace?”. **skip** as code for 2 weeks.

**2-week verdict:** stop overlay-replacing images. Assign the XObject. That is the image analogue of the text-edit manifesto in `pdf-text-edit.ts`.

---

## License cheat sheet (copyleft in bold)

| SPDX | Examples here | Safe to npm into this app? |
| --- | --- | --- |
| MIT / Apache-2.0 / BSD-3 / SIL OFL | pdf-lib, pdf.js, tesseract.js, signature_pad, fontkit, jscanify (lib only), pica, wasm-vips, Liberation, Noto, node-signpdf, pdfcpu, qpdf, OpenCV (upstream) | **Yes** |
| MPL-2.0 | OCRmyPDF, pikepdf, OpenPDF (dual) | **Sidecar / file-isolated** only |
| **GPL-2/3** | NAPS2, paperless-ngx, ScanTailor, Xournal++, pdfarranger | **No** (product would become GPL if combined) |
| **AGPL-3.0** | scribe.js, OpenSign, Documenso, DocuSeal, MuPDF.js, PyMuPDF, iText, Upscayl, dangerzone | **No** (network + local linking risk; we will not AGPL the workshop) |
| Open-core / Other | Stirling-PDF, OpenSign carve-outs | **Treat as proprietary until a file is proven MIT** |
| None / missing | PdfZero, pdf-master, PDF-Verse | **skip** |

---

## Suggested 2-week sequence (tickets)

1. **Fonts (days 1–2):** `npm i @pdf-lib/fontkit`; vendor Liberation Sans/Serif/Mono + Noto Sans under `public/fonts/` with OFL `LICENSE`; extend `pdf-font-match.ts` + tests in `src/lib/pdf-font-match.test.ts` / `pdf-text-edit.test.ts` so `Ł` does not become `?`.
2. **OCR layer (day 2–3):** `/Tr 3` in `scan/pdf.ts`; self-host `eng.traineddata`; skip OCR when PDF.js already reports a text layer (edit/scan of born-digital files).
3. **Signatures (day 3):** `signature_pad` in `signature-capture.tsx`. **Landed.**
4. **Image XObject (days 4–5):** in-place replace in `pdf-tools.ts`; smoke `fixtures/image-and-text.pdf`.
5. **Annotate (days 6–10):** pdf.js editor save **or** flatten-redact export — pick one; do not do both if fonts slip.

If only **two** libraries get added: **`@pdf-lib/fontkit`** and **`signature_pad`**. Everything else in the top 5 is algorithm work on code we already own.

---

## Research notes / what we did not treat as a library

- **Hopscotch** — product tours, not PDFs.
- **KafkaJS** — message bus.
- **pdfmake / jsPDF / pdfkit / pdfme** — generate new PDFs; they do not edit existing content streams.
- **Commercial:** Nutrient/PSPDFKit, PDF.js Express, Dynamsoft, Scanbot, ABBYY — skip (cost + often upload or proprietary WASM).
- **Stirling “#1 PDF app”** — operations catalog is a **checklist** of features we might grow (compress, decrypt, PDF/A). It is not a library we can MIT-import wholesale.
- **pdf-lib maintenance risk:** if Hopding stays quiet, the escape hatches are (in order) keep forking pdf-lib MIT, Muhammara in Electron, qpdf-wasm. Not MuPDF.
)
