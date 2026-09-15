import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ScanStudio } from "@/components/scan/scan-studio";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scan pages to PDF — PDF Relief" },
      {
        name: "description",
        content:
          "Capture or import photos, correct the page, enhance, and export a multi-page searchable PDF. Everything stays on this device.",
      },
      { property: "og:title", content: "Scan pages to PDF — PDF Relief" },
      {
        property: "og:description",
        content:
          "Genius Scan–like document capture in the browser. No upload, one page in memory at a time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <p className="eyebrow">Local scanner · No upload</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Scan a few pages. Export one clean PDF.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
          Camera or import, find the paper edges, flatten the perspective, then enhance like a
          whiteboard, receipt, color document, or black-and-white copy. Pages stay as images —
          optional OCR only adds a hidden text layer. One page is processed at a time so a long
          session does not copy Acrobat’s memory spiral.
        </p>
        <div className="mt-8">
          <ScanStudio />
        </div>
      </main>
    </AppShell>
  );
}
