import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpDown,
  Highlighter,
  Loader2,
  Scissors,
  Layers,
  FileStack,
} from "lucide-react";
import { PdfDropZone } from "@/components/pdf-drop-zone";
import { PdfPasswordDialog } from "@/components/pdf-password-dialog";
import { PageOrderStrip } from "@/components/page-order-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatBytes, parsePageRanges } from "@/lib/pdf-runtime";
import { PDF_OPEN_DAMAGED_MESSAGE } from "@/lib/pdf-open";
import { useOpenPdf } from "@/hooks/use-open-pdf";
import { FileActions } from "@/components/file-actions";
import { ensureNewPdfName } from "@/lib/file-session";
import { PdfEncryptedMutationError } from "@/lib/pdf-io";
import {
  copyPagesInOrder,
  extractPages,
  getPageCount,
  refsFromSlots,
  slotsFromPdf,
  slotsFromPdfs,
  slotsMatchFileOrder,
  splitIntoChunks,
  type PageSlot,
  type SplitOutput,
} from "@/lib/pdf-tools";

type Loaded = {
  name: string;
  base: string;
  size: number;
  bytes: ArrayBuffer;
  pages: number;
  canMutate: boolean;
  restrictionMessage: string | null;
};
type ExtraFile = { name: string; bytes: ArrayBuffer; pages: number };
type ToolTab = "split" | "extract" | "merge" | "reorder";

export function PdfWorkbench({ initialTab = "split" }: { initialTab?: ToolTab }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [extra, setExtra] = useState<ExtraFile[]>([]);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SplitOutput[]>([]);
  const [chunk, setChunk] = useState("25");
  const [ranges, setRanges] = useState("1-3");
  const { prompt: passwordPrompt, openPdf, cancelPrompt } = useOpenPdf();

  const reset = () => {
    setResults([]);
    setError(null);
  };

  const openBytes = async (name: string, bytes: ArrayBuffer, size: number, password?: string) => {
    reset();
    setBusy("Reading the file in this tab");
    try {
      const opened = await openPdf(name, bytes, password);
      if (!opened) return;
      const next: Loaded = {
        name,
        base: name.replace(/\.pdf$/i, ""),
        size,
        bytes: opened.bytes,
        pages: opened.pageCount,
        canMutate: opened.canMutate,
        restrictionMessage: opened.restrictionMessage,
      };
      setLoaded(next);
      setExtra([]);
      setSlots(slotsFromPdf(next));
    } catch {
      setLoaded(null);
      setExtra([]);
      setSlots([]);
      setError(PDF_OPEN_DAMAGED_MESSAGE);
    } finally {
      setBusy(null);
    }
  };

  const openFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    await openBytes(file.name, await file.arrayBuffer(), file.size);
  };

  const run = async (label: string, work: () => Promise<SplitOutput[]>) => {
    reset();
    setBusy(label);
    try {
      setResults(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while working on the copy.");
    } finally {
      setBusy(null);
    }
  };

  const sources = loaded ? [loaded, ...extra] : [];
  const orderChanged = loaded ? !slotsMatchFileOrder(slots, sources) : false;
  const canSaveOrder = !!loaded && loaded.canMutate && slots.length >= 2 && !busy;

  const saveCurrentOrder = () => {
    if (!loaded?.canMutate) return;
    const combined = extra.length > 0;
    const filename = combined
      ? ensureNewPdfName(loaded.name, "merged.pdf")
      : ensureNewPdfName(loaded.name, `${loaded.base}-reordered.pdf`);
    void run(combined ? "Merging the copies" : "Reordering pages", async () => [
      await copyPagesInOrder(refsFromSlots(slots), filename),
    ]);
  };

  const restoreFileOrder = () => {
    if (!loaded) return;
    setSlots(slotsFromPdfs([loaded, ...extra]));
  };

  return (
    <div className="p-0">
      <PdfPasswordDialog
        open={!!passwordPrompt}
        fileName={passwordPrompt?.name ?? ""}
        incorrect={passwordPrompt?.incorrect ?? false}
        busy={!!busy}
        onUnlock={(password) => {
          if (!passwordPrompt) return;
          void openBytes(
            passwordPrompt.name,
            passwordPrompt.bytes,
            passwordPrompt.bytes.byteLength,
            password,
          );
        }}
        onCancel={cancelPrompt}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">PDF tools</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Drop a PDF here</h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Everything runs on a copy held in this tab. Your original file is never modified and
            never leaves the machine. Highlight, notes, and cover boxes live in the page editor.
          </p>
          <div className="mt-3">
            <Button asChild size="sm" variant="outline" className="min-h-11 touch-manipulation">
              <Link to="/edit" hash="marks">
                <Highlighter className="size-3.5" /> Mark or cover
              </Link>
            </Button>
          </div>
        </div>
        {loaded && (
          <Badge variant="secondary" className="text-gauge">
            {loaded.pages} pages · {formatBytes(loaded.size)}
          </Badge>
        )}
      </div>

      <div className="mt-6">
        {!loaded && !busy && (
          <PdfDropZone
            onFiles={openFile}
            title="Drop a PDF here"
            hint="Nothing is uploaded. Big files are fine — they are read page by page."
          />
        )}

        {busy && !loaded && (
          <div className="rounded-lg border border-border bg-background/40 p-8">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {busy}…
            </div>
            <div className="mt-5 space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        )}

        {loaded && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-4 py-3">
              <p className="truncate text-sm font-medium">{loaded.name}</p>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 touch-manipulation"
                onClick={() => {
                  setLoaded(null);
                  setExtra([]);
                  setSlots([]);
                  reset();
                }}
              >
                Use a different file
              </Button>
            </div>

            {loaded.restrictionMessage && (
              <Alert className="mt-4" data-testid="pdf-view-only-banner">
                <AlertTriangle className="size-4" />
                <AlertTitle>View only</AlertTitle>
                <AlertDescription>{loaded.restrictionMessage}</AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue={initialTab} className="mt-5">
              <TabsList className="h-auto w-full flex-wrap sm:w-auto">
                <TabsTrigger
                  value="split"
                  className="min-h-11 flex-1 touch-manipulation sm:flex-none"
                >
                  <Scissors className="mr-1.5 size-3.5" /> Split
                </TabsTrigger>
                <TabsTrigger
                  value="extract"
                  className="min-h-11 flex-1 touch-manipulation sm:flex-none"
                >
                  <Layers className="mr-1.5 size-3.5" /> Extract
                </TabsTrigger>
                <TabsTrigger
                  value="merge"
                  className="min-h-11 flex-1 touch-manipulation sm:flex-none"
                >
                  <FileStack className="mr-1.5 size-3.5" /> Merge
                </TabsTrigger>
                <TabsTrigger
                  value="reorder"
                  data-testid="tab-reorder"
                  className="min-h-11 flex-1 touch-manipulation sm:flex-none"
                >
                  <ArrowUpDown className="mr-1.5 size-3.5" /> Reorder
                </TabsTrigger>
              </TabsList>

              <TabsContent value="split" className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  A 900-page scan is the file that kills Organize Pages. Cut it into pieces small
                  enough to open, review, and hand off.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40">
                    <Label htmlFor="chunk">Pages per file</Label>
                    <Input
                      id="chunk"
                      className="mt-1.5 min-h-11"
                      inputMode="numeric"
                      value={chunk}
                      onChange={(e) => setChunk(e.target.value)}
                    />
                  </div>
                  <Button
                    className="min-h-11 touch-manipulation"
                    disabled={!!busy || !loaded.canMutate}
                    onClick={() =>
                      run("Splitting the copy", async () => {
                        const size = Number(chunk);
                        if (!Number.isInteger(size) || size < 1) {
                          throw new Error("Pages per file must be a whole number, 1 or more.");
                        }
                        return splitIntoChunks(loaded.bytes, loaded.base, size);
                      })
                    }
                  >
                    Split into{" "}
                    {Math.max(1, Math.ceil(loaded.pages / Math.max(1, Number(chunk) || 1)))} files
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="extract" className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pull only the pages you need — signature page, one drawing, the appendix.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-56">
                    <Label htmlFor="ranges">Pages (1–{loaded.pages})</Label>
                    <Input
                      id="ranges"
                      className="mt-1.5 min-h-11"
                      placeholder="1-3, 7, 12"
                      value={ranges}
                      onChange={(e) => setRanges(e.target.value)}
                    />
                  </div>
                  <Button
                    className="min-h-11 touch-manipulation"
                    disabled={!!busy || !loaded.canMutate}
                    onClick={() =>
                      run("Extracting pages", async () => {
                        const pages = parsePageRanges(ranges, loaded.pages);
                        return [await extractPages(loaded.bytes, loaded.base, pages)];
                      })
                    }
                  >
                    Extract pages
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="merge" className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  The loaded file goes first, then anything you add below. Drag pages in the strip
                  to change order before you save. Originals on disk are never overwritten.
                </p>
                <PdfDropZone
                  multiple
                  className="p-6"
                  disabled={!loaded.canMutate}
                  onFiles={async (files) => {
                    reset();
                    try {
                      const added: ExtraFile[] = await Promise.all(
                        files.map(async (f) => {
                          const bytes = await f.arrayBuffer();
                          const pages = await getPageCount(bytes);
                          return { name: f.name, bytes, pages };
                        }),
                      );
                      setExtra((prev) => [...prev, ...added]);
                      setSlots((prev) => [...prev, ...slotsFromPdfs(added)]);
                    } catch (e) {
                      setError(
                        e instanceof PdfEncryptedMutationError
                          ? e.message
                          : "A file could not be opened. It may be password-protected, or the PDF structure is damaged.",
                      );
                    }
                  }}
                  title="Add more PDFs"
                  hint="Drop or choose the files to append."
                />
                {extra.length > 0 && (
                  <ol className="space-y-2 text-sm">
                    <li className="text-gauge text-muted-foreground">
                      1. {loaded.name} · {loaded.pages} pages
                    </li>
                    {extra.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="text-gauge text-muted-foreground">
                        {i + 2}. {f.name} · {f.pages} pages
                      </li>
                    ))}
                  </ol>
                )}
                <PageOrderStrip slots={slots} onReorder={setSlots} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="min-h-11 touch-manipulation"
                    disabled={!canSaveOrder}
                    onClick={saveCurrentOrder}
                    data-testid="save-page-order"
                  >
                    {extra.length > 0 ? `Merge ${extra.length + 1} files` : "Save this page order"}
                  </Button>
                  {orderChanged && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 touch-manipulation"
                      onClick={restoreFileOrder}
                    >
                      Restore file order
                    </Button>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="reorder" className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Same pages, new order. Use this on a multi-page file or after adding PDFs on
                  Merge. Save As writes a copy via page copy — nothing is uploaded and the source
                  file is not touched.
                </p>
                {slots.length < 2 && (
                  <p className="text-sm text-muted-foreground">
                    Need two or more pages. Open a multi-page PDF, or add files on the Merge tab.
                  </p>
                )}
                <PageOrderStrip slots={slots} onReorder={setSlots} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="min-h-11 touch-manipulation"
                    disabled={!canSaveOrder}
                    onClick={saveCurrentOrder}
                    data-testid="save-page-order-tab"
                  >
                    Save this page order
                  </Button>
                  {orderChanged && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 touch-manipulation"
                      onClick={restoreFileOrder}
                    >
                      Restore file order
                    </Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}

        {busy && loaded && (
          <div className="mt-5 flex items-center gap-3 rounded-md border border-border bg-background/40 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {busy}… large files can take a few seconds.
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-5">
            <AlertTriangle className="size-4" />
            <AlertTitle>That did not work</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {results.length > 0 && (
          <div className="mt-6">
            <p className="eyebrow">Ready to save · {results.length} file(s)</p>
            <ul className="mt-3 space-y-2">
              {results.map((r) => (
                <li
                  key={r.name}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-gauge text-xs text-muted-foreground">
                      {r.pages} pages · {formatBytes(r.bytes.byteLength)}
                    </p>
                  </div>
                  <FileActions bytes={r.bytes} filename={r.name} compact />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
