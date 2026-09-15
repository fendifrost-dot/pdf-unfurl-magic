/**
 * Optional Playwright path — opens the running app and drops a fixture.
 * See tests/e2e/README.md. Not run by `npm run test:smoke`.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:5173 npx playwright test tests/e2e/smoke.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:5173";

async function dropPdf(page: Page, selector: string, filename: string) {
  const input = page.locator(`${selector} input[type="file"]`).first();
  await input.setInputFiles(join(fixtures, filename));
}

test.describe("PDF Relief fixture smoke", () => {
  test("home bench: load multi-page, page count 3", async ({ page }) => {
    await page.goto(`${baseURL}/`);
    await dropPdf(page, "#bench", "multi-page.pdf");
    await expect(page.getByText(/3 pages/i)).toBeVisible({ timeout: 15_000 });
  });

  test("editor: load multi-page, page badge 1 / 3", async ({ page }) => {
    await page.goto(`${baseURL}/edit`);
    await dropPdf(page, "main", "multi-page.pdf");
    await expect(page.getByText(/1\s*\/\s*3/)).toBeVisible({ timeout: 15_000 });
  });

  test("editor export of an edited simple-text stays a small PDF", async ({ page }) => {
    await page.goto(`${baseURL}/edit`);
    await dropPdf(page, "main", "simple-text.pdf");
    await expect(page.getByText(/1\s*\/\s*1/)).toBeVisible({ timeout: 15_000 });

    const line = page.getByRole("button", { name: /REPLACE_ME/i }).first();
    await line.click();
    const box = page.locator("textarea").first();
    await box.fill("Playwright patched docket");
    await page.getByRole("button", { name: /Keep this change/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Export$/i }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(200);
    expect(bytes.byteLength).toBeLessThan(20_000);
  });
});
