import { Link } from "@tanstack/react-router";
import { FilePenLine, FileStack, Highlighter, ListChecks, ScanLine, Scissors } from "lucide-react";

const TOOLS = [
  {
    to: "/edit" as const,
    title: "Edit",
    body: "Open a PDF and tap a line.",
    icon: FilePenLine,
  },
  {
    to: "/edit" as const,
    hash: "form",
    title: "Form",
    body: "Fill fields, flatten export.",
    icon: ListChecks,
  },
  {
    to: "/edit" as const,
    hash: "marks",
    title: "Mark",
    body: "Highlight, note, or cover.",
    icon: Highlighter,
  },
  {
    to: "/split" as const,
    title: "Split",
    body: "Cut a large file into chunks.",
    icon: Scissors,
  },
  {
    to: "/merge" as const,
    title: "Merge",
    body: "Stack PDFs, then reorder pages.",
    icon: FileStack,
  },
  {
    to: "/scan" as const,
    title: "Scan",
    body: "Camera pages to a PDF.",
    icon: ScanLine,
  },
];

export function ToolShortcuts() {
  return (
    <section aria-label="PDF tools" className="mx-auto max-w-5xl px-4 pb-10 sm:px-8">
      <p className="eyebrow">On this phone or computer</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={`${tool.to}-${"hash" in tool ? tool.hash : "root"}`}
              to={tool.to}
              {...("hash" in tool && tool.hash ? { hash: tool.hash } : {})}
              className="bench-panel flex min-h-[7.5rem] flex-col justify-between p-4 touch-manipulation transition-colors active:bg-accent"
            >
              <Icon className="size-5 text-primary" aria-hidden />
              <div>
                <h2 className="font-display text-lg font-semibold">{tool.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tool.body}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
