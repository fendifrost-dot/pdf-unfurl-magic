import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertTriangle,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  FileText,
  Loader2,
  Scissors,
  Undo2,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PdfDropZone } from "@/components/pdf-drop-zone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  downloadBytes,
  extractLines,
  openDocument,
  renderPage,
  type TextLine,
} from "@/lib/pdf-runtime";
import { applyTextPatches, buildSamplePdf, type TextPatch } from "@/lib/pdf-tools";
import { toDesktopBytes } from "@/lib/desktop";
import {
  checkNumbers,
  cleanCopy,
  estimateWidth,
  fitFontSize,
  shortenToFit,
  type NumberFinding,
} from "@/lib/text-helpers";

export const Route = createFileRoute("/edit")({
  head: () => ({
    meta: [
      { title: "PDF editor that runs in your browser — PDF Relief" },
      {
        name: "description",
        content:
          "Open a PDF, click a line of text, and rewrite it. Only the box you touched is redrawn, type shrinks to fit, and the file never leaves your browser.",
      },
      { property: "og:title", content: "Edit a PDF line without Acrobat — PDF Relief" },
      {
        property: "og:description",
        content:
          "One page at a time, click-to-edit text, local checks for doubled words and totals that do not add up.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Editor,
});

type Doc = {
  name: string;
  base: string;
  bytes: ArrayBuffer;
  proxy: PDFDocumentProxy;
  pageCount: number;
};

type Edit = { line: TextLine; text: string };

const CANVAS_WIDTH = 720;

function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [lines, setLines] = useState<TextLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [scale, setScale] = useState(1);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<NumberFinding[] | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);

  const selected = selectedId ? lines.find((l) => l.id === selectedId) : undefined;
  const editedIds = Object.keys(edits);

  const loadBytes = useCallback(async (name: string, bytes: ArrayBuffer) => {
    setError(null);
    setFindings(null);
    setStatus("Opening the file in this tab");
    try {
      const proxy = await openDocument(bytes);
      setDoc({ name, base: name.replace(/\.pdf$/i, ""), bytes, proxy, pageCount: proxy.numPages });
      setEdits({});
      setSelectedId(null);
      setPage(1);
    } catch {
      setDoc(null);
      setError(
        "This PDF could not be opened here. Password-protected files and badly damaged files are the usual reasons.",
      );
    } finally {
      setStatus(null);
    }
  }, []);

  // Desktop app: pick up a file opened from File → Open PDF or the Finder.
  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
    if (!api) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const pending = await api.takePendingPdf();
        if (!pending || cancelled) return;
        const bytes = toDesktopBytes(pending.data);
        await loadBytes(pending.name, bytes.slice(0).buffer as ArrayBuffer);
      } catch {
        if (!cancelled) setError("That file could not be opened from the desktop app.");
      }
    };
    void pull();
    const unsubscribe = api.onPdfReady(() => void pull());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadBytes]);

  // Render the current page and collect its text lines.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setStatus("Rendering page " + page);
    (async () => {
      try {
        const [{ canvas, viewport }, pageLines] = await Promise.all([
          renderPage(doc.proxy, page, CANVAS_WIDTH),
          extractLines(doc.proxy, page),
        ]);
        if (cancelled) return;
        const holder = holderRef.current;
        if (holder) {
          holder.replaceChildren(canvas);
          canvas.className = "block w-full h-auto rounded-sm";
        }
        setScale(viewport.scale);
        setViewSize({ width: viewport.width, height: viewport.height });
        setLines(pageLines);
      } catch (e) {
        console.error("render failed", e);
        if (!cancelled) setError("That page could not be rendered.");
      } finally {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  const boxWidth = selected ? selected.width : 0;
  const draftFits = selected ? estimateWidth(draft, selected.fontSize) <= boxWidth : true;
  const exportSize = selected ? fitFontSize(draft, selected.fontSize, boxWidth) : 0;

  const openSample = async () => {
    setStatus("Building the sample quote");
    const bytes = await buildSamplePdf();
    // slice() to hand the editor its own copy of the buffer
    await loadBytes("northgate-quote-sample.pdf", bytes.slice(0).buffer as ArrayBuffer);
  };

  const select = (line: TextLine) => {
    setSelectedId(line.id);
    setDraft(edits[line.id]?.text ?? line.text);
  };

  const commit = () => {
    if (!selected) return;
    const text = draft.trim();
    setEdits((prev) => {
      const next = { ...prev };
      if (!text || text === selected.text) delete next[selected.id];
      else next[selected.id] = { line: selected, text };
      return next;
    });
  };

  const runCheck = async () => {
    if (!doc) return;
    setStatus("Checking the numbers on every page");
    try {
      const all: string[] = [];
      for (let p = 1; p <= doc.pageCount; p++) {
        const pageLines = await extractLines(doc.proxy, p);
        for (const l of pageLines) all.push(edits[l.id]?.text ?? l.text);
      }
      setFindings(checkNumbers(all));
    } finally {
      setStatus(null);
    }
  };

  const exportPdf = async () => {
    if (!doc) return;
    setStatus("Writing the edited boxes");
    try {
      const patches: TextPatch[] = Object.values(edits).map(({ line, text }) => ({
        page: line.page,
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        fontSize: line.fontSize,
        text,
      }));
      const bytes = await applyTextPatches(doc.bytes, patches);
      downloadBytes(bytes, `${doc.base}-edited.pdf`);
    } catch {
      setError("The export failed. Nothing was changed on your original file.");
    } finally {
      setStatus(null);
    }
  };

  const overlay = useMemo(
    () =>
      lines.map((line) => {
        const left = line.x * scale;
        const top = viewSize.height - (line.y + line.height) * scale;
        const isEdited = !!edits[line.id];
        return (
          <button
            key={line.id}
            type="button"
            onClick={() => select(line)}
            title={line.text}
            style={{
              left: `${(left / viewSize.width) * 100}%`,
              top: `${(top / viewSize.height) * 100}%`,
              width: `${(Math.max(line.width * scale, 8) / viewSize.width) * 100}%`,
              height: `${(Math.max(line.height * scale, 8) / viewSize.height) * 100}%`,
            }}
            className={[
              "absolute cursor-text rounded-[2px] border transition-colors",
              selectedId === line.id
                ? "border-primary bg-primary/25"
                : isEdited
                  ? "border-success/70 bg-success/20"
                  : "border-transparent bg-transparent hover:border-primary/60 hover:bg-primary/15",
            ].join(" ")}
          >
            <span className="sr-only">Edit: {line.text}</span>
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, scale, viewSize, selectedId, edits],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Local editor · No Adobe license</p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
              Edit the words. Leave the rest of the page alone.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
              Original pages stay as PDF objects — fonts, rules, and images you do not touch are not rasterized. Click a line, change it, and export. Assistants here only clean copy, fit a sentence to its box, or check whether the numbers on the page add up.
            </p>
          </div>
          {doc && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-gauge">
                {editedIds.length} edited line(s)
              </Badge>
              <Button size="sm" variant="secondary" onClick={runCheck} disabled={!!status}>
                <Calculator className="mr-1.5 size-3.5" /> Check numbers
              </Button>
              <Button size="sm" onClick={exportPdf} disabled={!!status || editedIds.length === 0}>
                <Download className="mr-1.5 size-3.5" /> Export
              </Button>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertTriangle className="size-4" />
            <AlertTitle>That did not work</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!doc ? (
          <div className="mt-8">
            {status ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {status}…
                </div>
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-72 w-full" />
              </div>
            ) : (
              <>
                <PdfDropZone
                  onFiles={async (files) => {
                    const file = files[0];
                    if (file) await loadBytes(file.name, await file.arrayBuffer());
                  }}
                  title="Drop a PDF to edit"
                  hint="Stays in this browser. One page at a time, so it will not pin 32 GB."
                >
                  <Button variant="outline" onClick={openSample}><FileText /> Load workshop notes</Button>
                </PdfDropZone>
                <div className="bench-panel mt-5 p-4 text-sm text-muted-foreground">No document yet. Use a contract, handout, quote, or the workshop notes sample. This editor is for documents you own — it will not help fake bank statements or other official records.</div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Page */}
            <div className="bench-panel p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={page <= 1 || !!status}
                    onClick={() => {
                      setSelectedId(null);
                      setPage((p) => Math.max(1, p - 1));
                    }}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-gauge px-2 text-sm">
                    {page} / {doc.pageCount}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={page >= doc.pageCount || !!status}
                    onClick={() => {
                      setSelectedId(null);
                      setPage((p) => Math.min(doc.pageCount, p + 1));
                    }}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 rounded-md bg-paper p-2 sm:p-3">
                <div className="relative mx-auto w-full">
                  <div ref={holderRef} className="w-full" />
                  {status ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-paper/70 text-sm text-paper-foreground">
                      <Loader2 className="mr-2 size-4 animate-spin" /> {status}…
                    </div>
                  ) : (
                    <div className="absolute inset-0">{overlay}</div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {lines.length} text lines found on this page. Hover to see the boxes; click one to
                edit it.
              </p>
            </div>

            {/* Side panel */}
            <aside className="bench-panel flex flex-col p-4 sm:p-5">
              {!selected ? (
                <div className="py-8 text-center">
                  <p className="font-display text-base font-semibold">Nothing selected</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Click any line on the page to open it here.
                  </p>
                </div>
              ) : (
                <>
                  <p className="eyebrow">Editing one line</p>
                  <p className="text-gauge mt-2 text-xs text-muted-foreground">
                    page {selected.page} · {selected.fontSize.toFixed(1)}pt ·{" "}
                    {selected.width.toFixed(0)}pt wide
                  </p>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    className="mt-3"
                    placeholder="Replacement text"
                  />
                  <p
                    className={
                      draftFits
                        ? "mt-2 text-xs text-muted-foreground"
                        : "mt-2 text-xs text-warning"
                    }
                  >
                    {draftFits
                      ? "Fits the original box at full size."
                      : `Too wide — export will shrink type to about ${exportSize.toFixed(1)}pt to stay inside the box.`}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setDraft(cleanCopy(draft))}>
                      <Eraser className="mr-1.5 size-3.5" /> Clean copy
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDraft(shortenToFit(draft, selected.fontSize, boxWidth))}
                    >
                      <Scissors className="mr-1.5 size-3.5" /> Shorten to fit
                    </Button>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="flex-1" onClick={commit}>
                      Keep this change
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft(selected.text)}
                      aria-label="Reset to original text"
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Original: “{selected.text}”
                  </p>
                </>
              )}

              <Separator className="my-5" />

              <p className="eyebrow">Number check</p>
              {findings === null ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Run <strong className="text-foreground">Check numbers</strong> to test inline sums
                  and any total against the amounts above it.
                </p>
              ) : findings.length === 0 ? (
                <p className="mt-2 text-sm text-success">
                  Every sum on every page adds up. Nothing to flag.
                </p>
              ) : (
                <div className="mt-2 max-h-64 w-full overflow-y-auto pr-2">
                  <ul className="w-full space-y-3">
                    {findings.map((f) => (
                      <li
                        key={f.id}
                        className={[
                          "w-full min-w-0 rounded-md border p-3",
                          f.severity === "error"
                            ? "border-destructive/50 bg-destructive/10"
                            : "border-warning/50 bg-warning/10",
                        ].join(" ")}
                      >
                        <p className="text-gauge truncate text-xs text-muted-foreground">{f.line}</p>
                        <p className="mt-1 break-words text-sm">{f.message}</p>
                        {f.suggestion && (
                          <p className="text-gauge mt-1 text-xs text-muted-foreground">
                            Suggested figure: {f.suggestion}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {editedIds.length > 0 && (
                <>
                  <Separator className="my-5" />
                  <p className="eyebrow">Pending edits</p>
                  <ul className="mt-2 space-y-2">
                    {Object.values(edits).map(({ line, text }) => (
                      <li key={line.id} className="text-xs">
                        <span className="text-gauge text-muted-foreground">p{line.page}</span>{" "}
                        <span className="text-success">{text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>
        )}

      </main>

      <SiteFooter />
    </div>
  );
}
