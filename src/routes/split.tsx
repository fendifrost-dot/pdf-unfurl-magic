import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PdfWorkbench } from "@/components/pdf-workbench";

export const Route = createFileRoute("/split")({
  head: () => ({
    meta: [
      { title: "Split or extract a PDF — PDF Relief" },
      {
        name: "description",
        content:
          "Cut a large PDF into smaller files or extract pages. Everything stays on this device.",
      },
      { property: "og:title", content: "Split a PDF on your phone — PDF Relief" },
      {
        property: "og:description",
        content:
          "No upload. Split and extract pages in the browser, then save or share the pieces.",
      },
    ],
  }),
  component: SplitPage,
});

function SplitPage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="eyebrow">Split · Extract</p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">
          Make a huge file small enough to open.
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Choose a PDF, cut it into chunks, pull just the pages you need, or organize pages
          (reorder, delete, extract) before Save As. The original file is never changed.
        </p>
        <div className="mt-8">
          <PdfWorkbench initialTab="split" />
        </div>
      </main>
    </AppShell>
  );
}
