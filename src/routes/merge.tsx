import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PdfWorkbench } from "@/components/pdf-workbench";

export const Route = createFileRoute("/merge")({
  head: () => ({
    meta: [
      { title: "Merge PDFs — PDF Relief" },
      {
        name: "description",
        content: "Combine PDFs on this device. Nothing is uploaded.",
      },
      { property: "og:title", content: "Merge PDFs on your phone — PDF Relief" },
      {
        property: "og:description",
        content: "Stack files in order, then save or share the merged PDF.",
      },
    ],
  }),
  component: MergePage,
});

function MergePage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="eyebrow">Merge</p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">
          Stack the pieces back into one file.
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Open the first PDF, add the rest, drag or tick pages to reorder, delete, or extract, then
          save or share. Works in the phone browser and in the desktop app. The files you opened are
          never overwritten.
        </p>
        <div className="mt-8">
          <PdfWorkbench initialTab="merge" />
        </div>
      </main>
    </AppShell>
  );
}
