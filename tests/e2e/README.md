# Playwright / Vitest path (app or helpers)

The default smoke (`npm run test:smoke`) unit-tests fixture load, page count, and export size with pdf-lib. It does **not** start Vite.

Use one of the paths below when a feature PR needs the running app or the TypeScript helpers.

## Vitest — unit-test `src/lib` helpers

```bash
npm i -D vitest
npx vitest run tests/e2e/pdf-helpers.smoke.ts
```

`tests/e2e/pdf-helpers.smoke.ts` imports `getPageCount`, `extractPages`, `mergeFiles`, and `applyTextPatches` from `@/lib/pdf-tools` and the same fixtures. Copy `tests/e2e/vitest.config.ts` or merge its `resolve.alias` into a root `vitest.config.ts` if you already have one.

Suggested `package.json` addition (do not replace `test:smoke`):

```json
"test:helpers": "vitest run tests/e2e/pdf-helpers.smoke.ts"
```

## Playwright — open the app and drop a fixture

```bash
npm i -D @playwright/test
npx playwright install chromium
npm run dev
npx playwright test tests/e2e/smoke.spec.ts
```

`tests/e2e/smoke.spec.ts` is a documented spec: home bench load + page-count badge, `/edit` load of `multi-page.pdf`, native-text Enhance entry (collapsed until the Enhance chip is clicked), and a download-size sanity check. Wire `PLAYWRIGHT_BASE_URL` (default `http://localhost:5173`) when the dev server uses another host.

These optional runners are not installed on `main` so feature PRs can adopt them without a lockfile fight.
