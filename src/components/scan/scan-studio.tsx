import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Download, FileImage, Images, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isDesktopApp, pickDesktopImages } from "@/lib/desktop";
import { downloadBytes } from "@/lib/pdf-runtime";
import {
  buildSampleScanPhotos,
  buildScanPdf,
  defaultScanFilename,
  detectOrFallback,
  disposeOcr,
  pageFromProcessed,
  recognizePage,
  releasePage,
  type EnhancePreset,
  type ScanPage,
} from "@/lib/scan";
import { blobToBytes, imageDataFromFile } from "@/lib/scan/image";
import type { Quad } from "@/lib/scan";
import { ScanCamera } from "./scan-camera";
import { ScanPageStrip } from "./scan-page-strip";
import { ScanReview } from "./scan-review";

type Mode = "home" | "camera" | "review";

type Draft = {
  original: ImageData;
  quad: Quad;
  name: string;
};

export function ScanStudio() {
  const [mode, setMode] = useState<Mode>("home");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [ocr, setOcr] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      pages.forEach(releasePage);
      void disposeOcr();
    };
    // Release only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDraft = useCallback((original: ImageData, name: string) => {
    setError(null);
    setDraft({ original, quad: detectOrFallback(original), name });
    setMode("review");
  }, []);

  const importFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter(
        (file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name),
      );
      if (images.length === 0) {
        setError("Choose photo files (JPEG, PNG, or WebP).");
        return;
      }
      setStatus("Reading the first photo");
      try {
        const [first, ...rest] = images;
        if (!first) return;
        setQueue(rest);
        const data = await imageDataFromFile(first);
        openDraft(data, first.name);
      } catch {
        setError("That photo could not be opened in this browser.");
      } finally {
        setStatus(null);
      }
    },
    [openDraft],
  );

  const choosePhotos = async () => {
    if (isDesktopApp()) {
      const picked = await pickDesktopImages();
      if (picked?.length) await importFiles(picked);
      return;
    }
    importRef.current?.click();
  };

  const afterConfirm = async () => {
    if (queue.length === 0) {
      setDraft(null);
      setMode("home");
      return;
    }
    const [next, ...rest] = queue;
    setQueue(rest);
    if (!next) {
      setDraft(null);
      setMode("home");
      return;
    }
    setStatus("Opening the next photo");
    try {
      const data = await imageDataFromFile(next);
      openDraft(data, next.name);
    } catch {
      setError("The next photo could not be opened.");
      setDraft(null);
      setMode("home");
    } finally {
      setStatus(null);
    }
  };

  const addPage = async (processed: ImageData, preset: EnhancePreset) => {
    if (!draft) return;
    setStatus("Saving this page as JPEG");
    try {
      const page = await pageFromProcessed(processed, draft.name, preset);
      setPages((prev) => [...prev, page]);
      setSelectedId(page.id);
      await afterConfirm();
    } catch {
      setError("That page could not be saved. Try a smaller photo.");
    } finally {
      setStatus(null);
    }
  };

  const movePage = (id: string, dir: -1 | 1) => {
    setPages((prev) => {
      const index = prev.findIndex((page) => page.id === id);
      const nextIndex = index + dir;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(index, 1);
      if (!item) return prev;
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const removePage = (id: string) => {
    setPages((prev) => {
      const page = prev.find((item) => item.id === id);
      if (page) releasePage(page);
      return prev.filter((item) => item.id !== id);
    });
    setSelectedId((current) => (current === id ? null : current));
  };

  const loadSamples = async () => {
    setStatus("Building three sample workshop photos");
    setError(null);
    try {
      const files = await buildSampleScanPhotos();
      await importFiles(files);
    } catch {
      setError("The sample photos could not be built in this browser.");
    } finally {
      setStatus(null);
    }
  };

  const exportPdf = async () => {
    if (pages.length === 0) return;
    setError(null);
    try {
      const built: Array<{
        jpeg: Uint8Array;
        width: number;
        height: number;
        words?: Awaited<ReturnType<typeof recognizePage>>;
      }> = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        setStatus(
          ocr
            ? `Page ${i + 1} of ${pages.length} — reading text`
            : `Page ${i + 1} of ${pages.length} — writing`,
        );
        const jpeg = await blobToBytes(page.jpeg);
        const words = ocr ? await recognizePage(page.jpeg) : undefined;
        built.push({ jpeg, width: page.width, height: page.height, ...(words ? { words } : {}) });
      }
      setStatus("Assembling the PDF");
      const bytes = await buildScanPdf(built);
      downloadBytes(bytes, defaultScanFilename(pages.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PDF could not be written.");
    } finally {
      setStatus(null);
      if (ocr) void disposeOcr();
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {status && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {status}…
        </div>
      )}

      <input
        ref={importRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => {
          const list = event.target.files;
          if (list) void importFiles(Array.from(list));
          event.target.value = "";
        }}
      />

      {mode === "camera" && (
        <ScanCamera
          onCapture={(data, name) => {
            setMode("home");
            openDraft(data, name);
          }}
          onCancel={() => setMode("home")}
        />
      )}

      {mode === "review" && draft && (
        <ScanReview
          original={draft.original}
          sourceName={draft.name}
          initialQuad={draft.quad}
          onCancel={() => void afterConfirm()}
          onConfirm={(processed, preset) => void addPage(processed, preset)}
        />
      )}

      {mode === "home" && (
        <div className="grid gap-3 md:grid-cols-3">
          <StartCard
            icon={Camera}
            title="Camera"
            body="Use this computer’s camera. The same capture view can later sit on a phone."
            action="Open camera"
            onClick={() => {
              setError(null);
              setMode("camera");
            }}
          />
          <StartCard
            icon={Images}
            title="Import photos"
            body="Drop shots from a phone or a folder. Each page is corrected one at a time."
            action="Choose photos"
            onClick={() => void choosePhotos()}
          />
          <StartCard
            icon={FileImage}
            title="Sample pages"
            body="Three angled workshop photos: docket, whiteboard, receipt. No camera needed."
            action="Load samples"
            onClick={() => void loadSamples()}
          />
        </div>
      )}

      <ScanPageStrip
        pages={pages}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={movePage}
        onRemove={removePage}
      />

      {pages.length > 0 && (
        <div className="bench-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Switch
              id="scan-ocr"
              checked={ocr}
              onCheckedChange={(value) => setOcr(value === true)}
            />
            <div>
              <Label htmlFor="scan-ocr" className="text-sm font-semibold">
                Searchable text layer
              </Label>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Optional OCR stays on this machine. The JPEG page is kept as the picture; words are
                drawn invisible on top so you can search without replacing the scan. The language
                pack may download once.
              </p>
            </div>
          </div>
          <Button type="button" size="lg" onClick={() => void exportPdf()} disabled={!!status}>
            <Download /> Export {pages.length}-page PDF
          </Button>
        </div>
      )}
    </div>
  );
}

function StartCard({
  icon: Icon,
  title,
  body,
  action,
  onClick,
}: {
  icon: typeof Camera;
  title: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="bench-panel flex flex-col p-5">
      <Icon className="size-5 text-primary" />
      <h2 className="mt-4 font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button type="button" className="mt-5" variant="secondary" onClick={onClick}>
        {action}
      </Button>
    </div>
  );
}
