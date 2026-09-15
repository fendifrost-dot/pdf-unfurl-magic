# PDF Relief roadmap

Browser-only PDF workshop (pdf-lib + PDF.js). No server, no auth, no DB.

- [x] Install pdf-lib + pdfjs-dist (4.10.38), shadcn/ui components
- [x] Design system in src/styles.css (workshop bench aesthetic)
- [x] Home `/`: hero, RAM meter, "Mac is drowning" guide, $60-stack list, split/extract/merge bench with empty/loading/error states
- [x] Editor `/edit`: single-page render, click line -> side panel edit, targeted export with auto-shrink
- [x] Local helpers: Clean copy, Shorten to fit, Check numbers
- [x] Sample PDF with wrong total (1,987.00 vs 2,257.00) and "3 x 12 = 35"
- [x] Footer: "Files stay in the browser. Not affiliated with Adobe."
- [x] Head metadata per route
- [x] Verified end to end in browser: sample -> edit -> check numbers -> export; split on home
- [x] Restyle home and editor to the approved cream-paper screenshots without changing PDF or Electron behavior
- [x] Scan lane `/scan`: camera + import, edge detect, perspective, enhance presets, multi-page session, optional local OCR text layer
- [x] E-Sign MVP (`/sign`): single signer, draw/type signature, place on page, date stamp, export signed PDF + SHA-256 audit page
- [ ] Deferred: multi-signer routing, email invites, DocuSign API, PKI certificates
