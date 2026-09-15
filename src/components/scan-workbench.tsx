import { useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  Loader2,
  ScanLine,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FileActions } from "@/components/file-actions";
import {
  buildPdfFromScanPages,
  disposeScanPages,
  moveScanPage,
  pagesFromImageFiles,
  type ScanPage,
} from "@/lib/scan-runtime";

export function ScanWorkbench() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string } | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setResult(null);
    setBusy("Preparing pages");
    try {
      const next = await pagesFromImageFiles(Array.from(list));
      setPages((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Those photos could not be added.");
    } finally {
      setBusy(null);
    }
  };

  const removePage = (id: string) => {
    setPages((prev) => {
      const doomed = prev.filter((page) => page.id === id);
      disposeScanPages(doomed);
      return prev.filter((page) => page.id !== id);
    });
    setResult(null);
  };

  const makePdf = async () => {
    setError(null);
    setBusy("Writing the PDF");
    try {
      const bytes = await buildPdfFromScanPages(pages);
      setResult({ bytes, name: `scan-${pages.length}p.pdf` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PDF could not be written.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Phone camera · Local pages</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Scan into a PDF</h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Take a photo of each page, then make a PDF here. Nothing is uploaded.
          </p>
        </div>
        {pages.length > 0 && (
          <Badge variant="secondary" className="text-gauge">
            {pages.length} page{pages.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <div className="mt-5 rounded-md border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        Auto crop, deskew, and OCR are not in this shell yet — the scan lane will fill those in.
        Photos are saved as letter-sized pages so you can still finish the job on a phone.
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          size="lg"
          className="min-h-14 touch-manipulation"
          disabled={!!busy}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera /> Take a photo
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-14 touch-manipulation"
          disabled={!!busy}
          onClick={() => libraryRef.current?.click()}
        >
          <ImagePlus /> Choose photos
        </Button>
      </div>

      {busy && (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {busy}…
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertTriangle className="size-4" />
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pages.length > 0 && (
        <ol className="mt-6 space-y-3">
          {pages.map((page, index) => (
            <li
              key={page.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <img
                src={page.previewUrl}
                alt={`Page ${index + 1}`}
                className="size-16 shrink-0 rounded-sm object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Page {index + 1}</p>
                <p className="text-gauge truncate text-xs text-muted-foreground">
                  {page.width}×{page.height}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="min-h-11 min-w-11 touch-manipulation"
                  disabled={index === 0}
                  aria-label="Move page up"
                  onClick={() => setPages((prev) => moveScanPage(prev, page.id, -1))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="min-h-11 min-w-11 touch-manipulation"
                  disabled={index === pages.length - 1}
                  aria-label="Move page down"
                  onClick={() => setPages((prev) => moveScanPage(prev, page.id, 1))}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="min-h-11 min-w-11 touch-manipulation"
                  aria-label="Remove page"
                  onClick={() => removePage(page.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          className="min-h-12 touch-manipulation"
          disabled={!!busy || pages.length === 0}
          onClick={() => void makePdf()}
        >
          <ScanLine /> Make PDF
        </Button>
        {pages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 touch-manipulation"
            onClick={() => {
              disposeScanPages(pages);
              setPages([]);
              setResult(null);
            }}
          >
            Clear pages
          </Button>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-md border border-border bg-background/40 p-4">
          <p className="eyebrow">Ready to save</p>
          <p className="mt-2 text-sm font-medium">{result.name}</p>
          <div className="mt-3">
            <FileActions bytes={result.bytes} filename={result.name} />
          </div>
        </div>
      )}
    </div>
  );
}
