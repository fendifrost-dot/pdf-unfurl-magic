import { useState } from "react";
import { AlertTriangle, Download, Loader2, Scissors, Layers, FileStack } from "lucide-react";
import { PdfDropZone } from "@/components/pdf-drop-zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { downloadBytes, formatBytes, parsePageRanges } from "@/lib/pdf-runtime";
import {
  extractPages,
  getPageCount,
  mergeFiles,
  splitIntoChunks,
  type SplitOutput,
} from "@/lib/pdf-tools";

type Loaded = { name: string; base: string; size: number; bytes: ArrayBuffer; pages: number };

export function PdfWorkbench() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [extra, setExtra] = useState<Array<{ name: string; bytes: ArrayBuffer }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SplitOutput[]>([]);
  const [chunk, setChunk] = useState("25");
  const [ranges, setRanges] = useState("1-3");

  const reset = () => {
    setResults([]);
    setError(null);
  };

  const openFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    reset();
    setBusy("Reading the file in this tab");
    try {
      const bytes = await file.arrayBuffer();
      const pages = await getPageCount(bytes);
      setLoaded({
        name: file.name,
        base: file.name.replace(/\.pdf$/i, ""),
        size: file.size,
        bytes,
        pages,
      });
    } catch {
      setLoaded(null);
      setError(
        "That file could not be opened. It may be password-protected, or the PDF structure is damaged. Try re-exporting it from the app that made it.",
      );
    } finally {
      setBusy(null);
    }
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

  return (
    <div className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">PDF tools</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Drop a PDF here</h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Everything runs on a copy held in this tab. Your original file is never modified and
            never leaves the machine.
          </p>
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
                onClick={() => {
                  setLoaded(null);
                  setExtra([]);
                  reset();
                }}
              >
                Use a different file
              </Button>
            </div>

            <Tabs defaultValue="split" className="mt-5">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="split" className="flex-1 sm:flex-none">
                  <Scissors className="mr-1.5 size-3.5" /> Split
                </TabsTrigger>
                <TabsTrigger value="extract" className="flex-1 sm:flex-none">
                  <Layers className="mr-1.5 size-3.5" /> Extract
                </TabsTrigger>
                <TabsTrigger value="merge" className="flex-1 sm:flex-none">
                  <FileStack className="mr-1.5 size-3.5" /> Merge
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
                      className="mt-1.5"
                      inputMode="numeric"
                      value={chunk}
                      onChange={(e) => setChunk(e.target.value)}
                    />
                  </div>
                  <Button
                    disabled={!!busy}
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
                    Split into {Math.max(1, Math.ceil(loaded.pages / Math.max(1, Number(chunk) || 1)))}{" "}
                    files
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
                      className="mt-1.5"
                      placeholder="1-3, 7, 12"
                      value={ranges}
                      onChange={(e) => setRanges(e.target.value)}
                    />
                  </div>
                  <Button
                    disabled={!!busy}
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
                  The loaded file goes first, then anything you add below, in order.
                </p>
                <PdfDropZone
                  multiple
                  className="p-6"
                  onFiles={async (files) => {
                    reset();
                    const added = await Promise.all(
                      files.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })),
                    );
                    setExtra((prev) => [...prev, ...added]);
                  }}
                  title="Add more PDFs"
                  hint="Drop or choose the files to append."
                />
                {extra.length > 0 && (
                  <ol className="space-y-2 text-sm">
                    <li className="text-gauge text-muted-foreground">1. {loaded.name}</li>
                    {extra.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="text-gauge text-muted-foreground">
                        {i + 2}. {f.name}
                      </li>
                    ))}
                  </ol>
                )}
                <Button
                  disabled={!!busy || extra.length === 0}
                  onClick={() =>
                    run("Merging the copies", async () => [
                      await mergeFiles([
                        { name: loaded.name, bytes: loaded.bytes },
                        ...extra,
                      ]),
                    ])
                  }
                >
                  Merge {extra.length + 1} files
                </Button>
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
                  <Button size="sm" variant="secondary" onClick={() => downloadBytes(r.bytes, r.name)}>
                    <Download className="mr-1.5 size-3.5" /> Save
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
