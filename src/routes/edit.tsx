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
import { ImageStudioPanel } from "@/components/image-studio-panel";
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
import {
  applyWorkshopPatches,
  buildSamplePdf,
  inspectTextPatch,
  type TextPatch,
} from "@/lib/pdf-tools";
import { toDesktopBytes } from "@/lib/desktop";
import { FontMatchIndicator } from "@/components/font-match-indicator";
import { canCommitSafely, type TextEditInspection } from "@/lib/pdf-text-edit";
import { charsMissingFromWinAnsi } from "@/lib/pdf-font-match";
import {
  checkNumbers,
  cleanCopy,
  estimateWidth,
  fitFontSize,
  shortenToFit,
  type NumberFinding,
} from "@/lib/text-helpers";
import {
  canvasToJpeg,
  DEFAULT_ADJUSTMENTS,
  fileToWorkingCanvas,
  PREVIEW_EDGE,
  renderAdjustedCanvas,
  type ImageAdjustments,
} from "@/lib/image-process";
import {
  decodePageImage,
  extractImages,
  type ImageEdit,
  type PdfImageRegion,
} from "@/lib/pdf-images";

export const Route = createFileRoute("/edit")({
  head: () => ({
    meta: [
      { title: "PDF editor that runs in your browser — PDF Relief" },
      {
        name: "description",
        content:
          "Open a PDF, click a text run or an embedded photo, and amend it. Text is rewritten in fonts already in the file — no white-out layer. Files never leave your browser.",
      },
      { property: "og:title", content: "Edit a PDF line or photo without Acrobat — PDF Relief" },
      {
        property: "og:description",
        content:
          "One page at a time: click-to-edit text, in-PDF image studio, and local checks for totals that do not add up.",
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

function CommittedImageOverlay({
  edit,
  scale,
  viewSize,
}: {
  edit: ImageEdit;
  scale: number;
  viewSize: { width: number; height: number };
}) {
  const url = useMemo(() => {
    const blob = new Blob([edit.output.bytes.slice(0) as unknown as BlobPart], {
      type: "image/jpeg",
    });
    return URL.createObjectURL(blob);
  }, [edit.output.bytes]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <img
      src={url}
      alt=""
      className="pointer-events-none absolute object-contain"
      style={boxStyle(
        edit.region.x,
        edit.region.y,
        edit.region.width,
        edit.region.height,
        scale,
        viewSize,
      )}
    />
  );
}

function boxStyle(
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  view: { width: number; height: number },
) {
  const left = x * scale;
  const top = view.height - (y + height) * scale;
  return {
    left: `${(left / view.width) * 100}%`,
    top: `${(top / view.height) * 100}%`,
    width: `${(Math.max(width * scale, 8) / view.width) * 100}%`,
    height: `${(Math.max(height * scale, 8) / view.height) * 100}%`,
  };
}

function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [lines, setLines] = useState<TextLine[]>([]);
  const [images, setImages] = useState<PdfImageRegion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [imageEdits, setImageEdits] = useState<Record<string, ImageEdit>>({});
  const [imageDraft, setImageDraft] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [sourceLabel, setSourceLabel] = useState("Original embedded photo");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<NumberFinding[] | null>(null);
  const [inspection, setInspection] = useState<TextEditInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewTimer = useRef<number | null>(null);

  const selected = selectedId ? lines.find((l) => l.id === selectedId) : undefined;
  const selectedImage = selectedImageId
    ? images.find((img) => img.id === selectedImageId)
    : undefined;
  const editedIds = Object.keys(edits);
  const imageEditIds = Object.keys(imageEdits);
  const pendingCount = editedIds.length + imageEditIds.length;

  const clearPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  };

  const loadBytes = useCallback(async (name: string, bytes: ArrayBuffer) => {
    setError(null);
    setFindings(null);
    setStatus("Opening the file in this tab");
    try {
      const proxy = await openDocument(bytes);
      setDoc({ name, base: name.replace(/\.pdf$/i, ""), bytes, proxy, pageCount: proxy.numPages });
      setEdits({});
      setImageEdits({});
      setSelectedId(null);
      setSelectedImageId(null);
      setSourceCanvas(null);
      setInspection(null);
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

  // Render the current page and collect its text lines and embedded images.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setStatus("Rendering page " + page);
    setSelectedImageId(null);
    setSourceCanvas(null);
    clearPreview();
    (async () => {
      try {
        const [{ canvas, viewport }, pageLines, pageImages] = await Promise.all([
          renderPage(doc.proxy, page, CANVAS_WIDTH),
          extractLines(doc.proxy, page),
          extractImages(doc.proxy, page),
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
        setImages(pageImages);
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

  useEffect(() => {
    if (!doc || !selectedImage) {
      setSourceCanvas(null);
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    (async () => {
      try {
        const existing = imageEdits[selectedImage.id];
        if (existing?.replacementBytes) {
          const blob = new Blob([existing.replacementBytes.slice(0) as unknown as BlobPart], {
            type: "image/jpeg",
          });
          const bitmap = await createImageBitmap(blob);
          if (cancelled) {
            bitmap.close();
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          bitmap.close();
          setSourceCanvas(canvas);
          setSourceLabel(existing.replacementName ?? "Replacement photo");
          setImageDraft(existing.adjustments);
          return;
        }
        const canvas = await decodePageImage(doc.proxy, selectedImage.page, selectedImage.name);
        if (cancelled) return;
        setSourceCanvas(canvas);
        setSourceLabel("Original embedded photo");
        setImageDraft(existing?.adjustments ?? DEFAULT_ADJUSTMENTS);
      } catch (e) {
        console.error("decode image failed", e);
        if (!cancelled) setError("That photo could not be decoded. Try another image on the page.");
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-decode when the selected region changes, not when sliders move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, selectedImageId]);

  useEffect(() => {
    if (!sourceCanvas) {
      clearPreview();
      return;
    }
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      try {
        const preview = renderAdjustedCanvas(sourceCanvas, imageDraft);
        const scaled =
          Math.max(preview.width, preview.height) > PREVIEW_EDGE
            ? (() => {
                const canvas = document.createElement("canvas");
                const fit = PREVIEW_EDGE / Math.max(preview.width, preview.height);
                canvas.width = Math.max(1, Math.round(preview.width * fit));
                canvas.height = Math.max(1, Math.round(preview.height * fit));
                canvas.getContext("2d")?.drawImage(preview, 0, 0, canvas.width, canvas.height);
                return canvas;
              })()
            : preview;
        scaled.toBlob(
          (blob) => {
            if (!blob) return;
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            const url = URL.createObjectURL(blob);
            previewUrlRef.current = url;
            setPreviewUrl(url);
          },
          "image/jpeg",
          imageDraft.quality,
        );
      } catch (e) {
        console.error("preview failed", e);
      }
    }, 70);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [sourceCanvas, imageDraft]);

  useEffect(() => () => clearPreview(), []);

  const boxWidth = selected ? selected.width : 0;
  const draftFits = selected ? estimateWidth(draft, selected.fontSize) <= boxWidth : true;
  const exportSize = selected ? fitFontSize(draft, selected.fontSize, boxWidth) : 0;
  const missingGlyphs = useMemo(() => charsMissingFromWinAnsi(draft), [draft]);

  useEffect(() => {
    if (!doc || !selected) {
      setInspection(null);
      return;
    }
    let cancelled = false;
    setInspecting(true);
    const probe: TextPatch = {
      page: selected.page,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      fontSize: selected.fontSize,
      text: selected.text,
      originalText: selected.text,
      fontName: selected.fontName,
      fontFamily: selected.fontFamily,
    };
    void inspectTextPatch(doc.bytes, probe)
      .then((result) => {
        if (!cancelled) setInspection(result);
      })
      .catch(() => {
        if (!cancelled) setInspection(null);
      })
      .finally(() => {
        if (!cancelled) setInspecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, selected]);

  const openSample = async () => {
    setStatus("Building the sample quote");
    const bytes = await buildSamplePdf();
    await loadBytes("northgate-quote-sample.pdf", bytes.slice(0).buffer as ArrayBuffer);
  };

  const select = (line: TextLine) => {
    setSelectedImageId(null);
    setSelectedId(line.id);
    setDraft(edits[line.id]?.text ?? line.text);
  };

  const selectImage = (image: PdfImageRegion) => {
    setSelectedId(null);
    setSelectedImageId(image.id);
  };

  const commit = () => {
    if (!selected) return;
    const text = draft.trim();
    if (text && text !== selected.text && !canCommitSafely(inspection, text, selected.text)) return;
    setEdits((prev) => {
      const next = { ...prev };
      if (!text || text === selected.text) delete next[selected.id];
      else next[selected.id] = { line: selected, text };
      return next;
    });
  };

  const commitImage = async () => {
    if (!selectedImage || !sourceCanvas) return;
    setStatus("Compressing the selected photo");
    try {
      const rendered = renderAdjustedCanvas(sourceCanvas, imageDraft);
      const output = await canvasToJpeg(rendered, imageDraft.quality);
      const next: ImageEdit = { region: selectedImage, adjustments: imageDraft, output };
      if (sourceLabel.startsWith("Replacement")) {
        next.replacementName = sourceLabel;
        next.replacementBytes = (await canvasToJpeg(sourceCanvas, 0.92)).bytes;
      }
      setImageEdits((prev) => ({ ...prev, [selectedImage.id]: next }));
    } catch {
      setError("That photo could not be processed. Nothing was written to the original file.");
    } finally {
      setStatus(null);
    }
  };

  const replaceImage = async (file: File) => {
    setPreviewBusy(true);
    try {
      const canvas = await fileToWorkingCanvas(file);
      setSourceCanvas(canvas);
      setSourceLabel(`Replacement · ${file.name}`);
      setImageDraft(DEFAULT_ADJUSTMENTS);
    } catch {
      setError("That replacement image could not be read. Use a JPEG, PNG, or WebP.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const resetImage = async () => {
    if (!doc || !selectedImage) return;
    setPreviewBusy(true);
    try {
      const canvas = await decodePageImage(doc.proxy, selectedImage.page, selectedImage.name);
      setSourceCanvas(canvas);
      setSourceLabel("Original embedded photo");
      setImageDraft(DEFAULT_ADJUSTMENTS);
      setImageEdits((prev) => {
        const next = { ...prev };
        delete next[selectedImage.id];
        return next;
      });
    } catch {
      setError("The original photo could not be restored.");
    } finally {
      setPreviewBusy(false);
    }
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
        originalText: line.text,
        fontName: line.fontName,
        fontFamily: line.fontFamily,
      }));
      const imagePatches = Object.values(imageEdits).map((edit) => ({
        page: edit.region.page,
        x: edit.region.x,
        y: edit.region.y,
        width: edit.region.width,
        height: edit.region.height,
        bytes: edit.output.bytes,
        mime: "image/jpeg" as const,
      }));
      const bytes = await applyWorkshopPatches(doc.bytes, patches, imagePatches, []);
      downloadBytes(bytes, `${doc.base}-edited.pdf`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The export failed. Nothing was changed on your original file.",
      );
    } finally {
      setStatus(null);
    }
  };

  const textOverlay = useMemo(
    () =>
      lines.map((line) => {
        const isEdited = !!edits[line.id];
        return (
          <button
            key={line.id}
            type="button"
            onClick={() => select(line)}
            title={line.text}
            style={boxStyle(line.x, line.y, line.width, line.height, scale, viewSize)}
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

  const imageOverlay = useMemo(
    () =>
      images.map((image) => {
        const isEdited = !!imageEdits[image.id];
        return (
          <button
            key={image.id}
            type="button"
            onClick={() => selectImage(image)}
            title="Edit this photo"
            style={boxStyle(image.x, image.y, image.width, image.height, scale, viewSize)}
            className={[
              "absolute cursor-pointer rounded-[2px] border-2 transition-colors",
              selectedImageId === image.id
                ? "border-primary bg-primary/20"
                : isEdited
                  ? "border-success/80 bg-success/15"
                  : "border-primary/50 bg-primary/10 hover:border-primary hover:bg-primary/20",
            ].join(" ")}
          >
            <span className="sr-only">Edit embedded image</span>
          </button>
        );
      }),

    [images, scale, viewSize, selectedImageId, imageEdits],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Local editor · No Adobe license</p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
              Edit the words or the photo. Leave the rest of the page alone.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
              Original pages stay as PDF objects. Click a text run or one photo. Replace or crop
              that photo; export leaves surrounding text and lines alone.
            </p>
          </div>
          {doc && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-gauge">
                {pendingCount} pending change(s)
              </Badge>
              <Button size="sm" variant="secondary" onClick={runCheck} disabled={!!status}>
                <Calculator className="mr-1.5 size-3.5" /> Check numbers
              </Button>
              <Button size="sm" onClick={exportPdf} disabled={!!status || pendingCount === 0}>
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
                  <Button variant="outline" onClick={openSample}>
                    <FileText /> Load workshop notes
                  </Button>
                </PdfDropZone>
                <div className="bench-panel mt-5 p-4 text-sm text-muted-foreground">
                  No document yet. Use a contract, handout, quote, or the workshop notes sample
                  (photos + text). This editor is for documents you own — it will not help fake bank
                  statements or other official records.
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                      setSelectedImageId(null);
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
                      setSelectedImageId(null);
                      setPage((p) => Math.min(doc.pageCount, p + 1));
                    }}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 max-h-[70vh] overflow-auto rounded-md bg-paper p-2 sm:p-3">
                <div className="relative mx-auto w-full">
                  <div ref={holderRef} className="w-full" />
                  {status ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-paper/70 text-sm text-paper-foreground">
                      <Loader2 className="mr-2 size-4 animate-spin" /> {status}…
                    </div>
                  ) : (
                    <div className="absolute inset-0">
                      {textOverlay}
                      {imageOverlay}
                      {Object.values(imageEdits)
                        .filter(
                          (edit) => edit.region.page === page && edit.region.id !== selectedImageId,
                        )
                        .map((edit) => (
                          <CommittedImageOverlay
                            key={edit.region.id}
                            edit={edit}
                            scale={scale}
                            viewSize={viewSize}
                          />
                        ))}
                      {selectedImage && previewUrl && (
                        <img
                          src={previewUrl}
                          alt=""
                          className="pointer-events-none absolute object-contain"
                          style={boxStyle(
                            selectedImage.x,
                            selectedImage.y,
                            selectedImage.width,
                            selectedImage.height,
                            scale,
                            viewSize,
                          )}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {lines.length} text runs
                {images.length
                  ? ` · ${images.length} photo${images.length === 1 ? "" : "s"}`
                  : ""}
                . Click a line or one photo.
              </p>
            </div>

            <aside className="bench-panel flex flex-col p-4 sm:p-5">
              {selectedImage ? (
                <ImageStudioPanel
                  region={selectedImage}
                  imageCount={images.length}
                  draft={imageDraft}
                  previewUrl={previewUrl}
                  previewBusy={previewBusy}
                  sourceLabel={sourceLabel}
                  onChange={setImageDraft}
                  onReplace={(file) => void replaceImage(file)}
                  onCommit={() => void commitImage()}
                  onReset={() => void resetImage()}
                />
              ) : !selected ? (
                <div className="py-8 text-center">
                  <p className="font-display text-base font-semibold">Nothing selected</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Click a text run or one photo on this page.
                  </p>
                </div>
              ) : (
                <>
                  <p className="eyebrow">Editing one run</p>
                  <p className="text-gauge mt-2 text-xs text-muted-foreground">
                    page {selected.page} · {selected.fontSize.toFixed(1)}pt ·{" "}
                    {selected.width.toFixed(0)}pt wide
                    {selected.fontFamily ? ` · ${selected.fontFamily.split(",")[0]}` : ""}
                  </p>
                  <FontMatchIndicator
                    inspection={
                      inspection && missingGlyphs.length > 0
                        ? {
                            ...inspection,
                            method: "blocked",
                            missingGlyphs,
                            message: `Cannot encode ${missingGlyphs.map((c) => `“${c}”`).join(" ")} — export would write “?”.`,
                          }
                        : inspection
                    }
                    loading={inspecting}
                  />
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    className="mt-3"
                    placeholder="Replacement text"
                  />
                  <p
                    className={
                      draftFits ? "mt-2 text-xs text-muted-foreground" : "mt-2 text-xs text-warning"
                    }
                  >
                    {draftFits
                      ? "Fits the original box at full size."
                      : `Too wide — export will shrink type to about ${exportSize.toFixed(1)}pt to stay inside the box.`}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDraft(cleanCopy(draft))}
                    >
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
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={commit}
                      disabled={
                        !canCommitSafely(inspection, draft, selected.text) ||
                        missingGlyphs.length > 0
                      }
                    >
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
                  <p className="mt-3 text-xs text-muted-foreground">Original: “{selected.text}”</p>
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
                        <p className="text-gauge truncate text-xs text-muted-foreground">
                          {f.line}
                        </p>
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

              {pendingCount > 0 && (
                <>
                  <Separator className="my-5" />
                  <p className="eyebrow">Pending edits</p>
                  <ul className="mt-2 space-y-2">
                    {Object.values(edits).map(({ line, text }) => (
                      <li key={line.id} className="text-xs">
                        <span className="text-gauge text-muted-foreground">p{line.page} text</span>{" "}
                        <span className="text-success">{text}</span>
                      </li>
                    ))}
                    {Object.values(imageEdits).map((edit) => (
                      <li key={edit.region.id} className="text-xs">
                        <span className="text-gauge text-muted-foreground">
                          p{edit.region.page} photo
                        </span>{" "}
                        <span className="text-success">
                          {edit.output.width}×{edit.output.height} JPEG
                        </span>
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
