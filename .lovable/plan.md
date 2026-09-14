# Cream-paper restyle

## Goal
Match the approved home and editor screenshots across desktop and mobile without changing any PDF behavior.

## Changes
- Apply the supplied warm cream, sienna, border, typography, and radius tokens globally; load Fraunces and Geist-compatible web fonts.
- Replace the current logo and header with the pencil mark, full navigation, sienna action, and mobile menu.
- Recompose the home page to match the approved hierarchy: two-column headline and RAM card, frozen-app rose panel, existing explanatory content, and the working PDF workshop.
- Restyle `/edit` with the approved headline, supporting copy, dashed PDF picker, workshop-notes action, and official-record warning while preserving page editing and export.
- Restyle shared cards, controls, footer, loading, loaded, and error states to remain consistent.

## Verification
- Check home and `/edit` at desktop and mobile sizes against the supplied screenshots.
- Re-run the sample editor and dropped-file PDF workflows to confirm the restyle did not change functionality.
- Confirm route metadata remains complete and synchronize the completed changes with the repository-managed main branch.

## Technical details
- Keep TanStack Start, Vite, shadcn/ui, PDF.js, pdf-lib, and Electron integration unchanged.
- Use semantic Tailwind v4 tokens in `src/styles.css`; no uploads, authentication, database, or new document-altering features.
