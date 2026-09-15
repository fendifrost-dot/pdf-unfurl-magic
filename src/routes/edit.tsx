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
  Highlighter,
  ImageIcon,
  Loader2,
  Scissors,
  ScanLine,
  Square,
  StickyNote,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
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
import { exportFileName } from "@/lib/pdf-marks";
import { toDesktopBytes } from "@/lib/desktop";
import { FontMatchIndicator } from "@/components/font-match-indicator";
import { FontPicker } from "@/components/font-picker";
import { canCommitSafely, type TextEditInspection } from "@/lib/pdf-text-edit";
import { ScanAwarePanel } from "@/components/scan-aware-panel";
import {
  emptyScanSession,
  enhancePageForScan,
  inspectPageScan,
  ocrCanvasToLines,
  releaseScanSession,
  type PageScanReport,
  type ScanPageExport,
  type ScanPageSession,
} from "@/lib/pdf-scan-edit";
import { disposeOcr, type EnhancePreset } from "@/lib/scan";
import {
  defaultFontChoiceId,
  loadSystemFontBytes,
  mergeFontCatalog,
  querySystemFonts,
  type CatalogFont,
} from "@/lib/pdf-font-catalog";
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
  type AnnotationBurn,
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

type Edit = { line: TextLine; text: string; fontChoiceId?: string };
type Mode = "text" | "image" | "mark";
type MarkTool = AnnotationBurn["kind"];

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
  const [mode, setMode] = useState<Mode>("text");
  const [marks, setMarks] = useState<AnnotationBurn[]>([]);
  const [markTool, setMarkTool] = useState<MarkTool>("redact");
  const [draftMark, setDraftMark] = useState<Omit<AnnotationBurn, "id"> | null>(null);
  const [scale, setScale] = useState(1);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<NumberFinding[] | null>(null);
  const [inspection, setInspection] = useState<TextEditInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [scanReport, setScanReport] = useState<PageScanReport | null>(null);
  const [scanByPage, setScanByPage] = useState<Record<number, ScanPageSession>>({});
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [fontCatalog, setFontCatalog] = useState<CatalogFont[]>([]);
  const [fontChoiceId, setFontChoiceId] = useState("");
  const holderRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const scanByPageRef = useRef(scanByPage);
  scanByPageRef.current = scanByPage;

  const selected = selectedId ? lines.find((l) => l.id === selectedId) : undefined;
  const selectedImage = selectedImageId
    ? images.find((img) => img.id === selectedImageId)
    : undefined;
  const editedIds = Object.keys(edits);
  const imageEditIds = Object.keys(imageEdits);
  const scanExportReady = Object.values(scanByPage).filter(
    (session) =>
      session.originalJpeg &&
      (session.ocrLines.length > 0 || (session.replaceWithCleaned && session.enhancedJpeg)),
  ).length;
  const pendingCount = editedIds.length + imageEditIds.length + marks.length + scanExportReady;
  const scanSession = scanByPage[page] ?? emptyScanSession();
  const scanMode = !!scanReport?.looksScanned || scanSession.ocrLines.length > 0;
  const selectedIsOcr = selected?.source === "ocr";

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
      const proxy = await openDocument(bytes.slice(0));
      setDoc({
        name,
        base: name.replace(/\.pdf$/i, ""),
        bytes: bytes.slice(0),
        proxy,
        pageCount: proxy.numPages,
      });
      setEdits({});
      setImageEdits({});
      setMarks([]);
      setSelectedId(null);
      setSelectedImageId(null);
      setSourceCanvas(null);
      setInspection(null);
      setScanReport(null);
      setScanByPage((prev) => {
        Object.values(prev).forEach(releaseScanSession);
        return {};
      });
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      if (window.location.hash === "#images") setMode("image");
      if (window.location.hash === "#marks") setMode("mark");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
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
          extractLines(doc.proxy, page, doc.bytes),
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
        const ocrLines = scanByPage[page]?.ocrLines;
        setLines(ocrLines?.length ? ocrLines : pageLines);
        setImages(pageImages);
        const report = await inspectPageScan(
          doc.bytes,
          page,
          pageLines.map((line) => line.text),
        );
        if (cancelled) return;
        setScanReport(report);
        if (report.looksScanned) {
          setScanByPage((prev) => (prev[page] ? prev : { ...prev, [page]: emptyScanSession() }));
        }
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
    // OCR lines are applied in enhanceAndOcr; do not re-rasterize on session edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    return () => {
      Object.values(scanByPageRef.current).forEach(releaseScanSession);
      void disposeOcr();
    };
  }, []);

  const boxWidth = selected ? selected.width : 0;
  const draftFits = selected ? estimateWidth(draft, selected.fontSize) <= boxWidth : true;
  const exportSize = selected ? fitFontSize(draft, selected.fontSize, boxWidth) : 0;

  useEffect(() => {
    if (!doc || !selected || selected.source === "ocr" || scanReport?.looksScanned) {
      setInspection(null);
      setInspecting(false);
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
      text: draft,
      originalText: selected.text,
      fontName: selected.fontName,
      fontFamily: selected.fontFamily,
    };
    const timer = window.setTimeout(() => {
      void inspectTextPatch(doc.bytes, probe)
        .then(async (result) => {
          if (cancelled) return;
          setInspection(result);
          const system = await querySystemFonts();
          if (cancelled) return;
          const catalog = mergeFontCatalog({
            embedded: result.embeddedFonts ?? [],
            selectedKey: result.resourceKey || selected.fontName,
            originalText: selected.text,
            match: result.fontMatch,
            system,
          });
          setFontCatalog(catalog);
          setFontChoiceId((prev) =>
            catalog.some((item) => item.id === prev)
              ? prev
              : defaultFontChoiceId(catalog, result.resourceKey || selected.fontName),
          );
        })
        .catch(() => {
          if (!cancelled) setInspection(null);
        })
        .finally(() => {
          if (!cancelled) setInspecting(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, selected, draft, scanReport?.looksScanned]);

  const openSample = async () => {
    setStatus("Building the sample quote");
    const bytes = await buildSamplePdf();
    await loadBytes("northgate-quote-sample.pdf", bytes.slice(0).buffer as ArrayBuffer);
    setMode("image");
  };

  const select = (line: TextLine) => {
    setSelectedImageId(null);
    setSelectedId(line.id);
    setDraft(edits[line.id]?.text ?? line.text);
    setMode("text");
  };

  const selectImage = (image: PdfImageRegion) => {
    setSelectedId(null);
    setSelectedImageId(image.id);
    setMode("image");
  };

  const commit = () => {
    if (!selected) return;
    const text = draft.trim();
    if (selected.source !== "ocr" && scanMode) return;
    if (text && text !== selected.text && !canCommitSafely(inspection, text, selected.text)) return;
    setEdits((prev) => {
      const next = { ...prev };
      if (!text || text === selected.text) delete next[selected.id];
      else next[selected.id] = { line: selected, text, fontChoiceId };
      return next;
    });
  };

  const patchScanSession = (partial: Partial<ScanPageSession>) => {
    setScanByPage((prev) => ({
      ...prev,
      [page]: { ...(prev[page] ?? emptyScanSession()), ...partial },
    }));
  };

  const enhanceAndOcr = async () => {
    if (!doc) return;
    setError(null);
    const preset: EnhancePreset = scanSession.preset;
    setScanBusy("Rendering this page");
    try {
      setScanBusy("Enhancing page");
      const result = await enhancePageForScan(doc.proxy, page, preset);
      setScanBusy("Reading text");
      const ocrLines = await ocrCanvasToLines(
        result.enhancedCanvas,
        page,
        result.pageWidth,
        result.pageHeight,
      );
      const preview = new Blob([result.enhancedJpeg.bytes.slice() as unknown as BlobPart], {
        type: "image/jpeg",
      });
      const previewUrl = URL.createObjectURL(preview);
      setScanByPage((prev) => {
        releaseScanSession(prev[page]);
        return {
          ...prev,
          [page]: {
            ...(prev[page] ?? emptyScanSession()),
            preset,
            originalJpeg: result.originalJpeg,
            enhancedJpeg: result.enhancedJpeg,
            enhancedPreviewUrl: previewUrl,
            ocrLines,
            pageWidth: result.pageWidth,
            pageHeight: result.pageHeight,
          },
        };
      });
      setLines(ocrLines);
      setSelectedId(null);
      setDraft("");
      if (ocrLines.length === 0) {
        setError(
          "OCR did not find readable lines on this page. Try another enhance preset, then run it again.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Enhance / OCR failed. Nothing was written to the original file.",
      );
    } finally {
      setScanBusy(null);
      void disposeOcr();
    }
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
      setImageDraft((prev) => ({
        ...DEFAULT_ADJUSTMENTS,
        quality: prev.quality,
        exposure: prev.exposure,
        contrast: prev.contrast,
      }));
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

  const eventToPdf = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = pageBoxRef.current;
    if (!box || !viewSize.width) return null;
    const rect = box.getBoundingClientRect();
    const pageWidth = viewSize.width / scale;
    const pageHeight = viewSize.height / scale;
    const x = ((event.clientX - rect.left) / rect.width) * pageWidth;
    const y = pageHeight - ((event.clientY - rect.top) / rect.height) * pageHeight;
    return { x, y };
  };

  const onMarkPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "mark") return;
    const point = eventToPdf(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = point;
    setDraftMark({ page, kind: markTool, x: point.x, y: point.y, width: 0, height: 0 });
  };

  const onMarkPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const point = eventToPdf(event);
    if (!point) return;
    const start = dragRef.current;
    setDraftMark({
      page,
      kind: markTool,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const onMarkPointerUp = () => {
    dragRef.current = null;
  };

  const keepMark = () => {
    if (!draftMark) return;
    let next = draftMark;
    const tiny = next.width < 8 || next.height < 8;
    if (tiny && next.kind === "note") {
      const pageWidth = viewSize.width / scale;
      const pageHeight = viewSize.height / scale;
      const width = Math.min(140, pageWidth);
      const height = Math.min(72, pageHeight);
      next = {
        ...next,
        x: Math.min(Math.max(0, next.x), Math.max(0, pageWidth - width)),
        y: Math.min(Math.max(0, next.y - height), Math.max(0, pageHeight - height)),
        width,
        height,
        text: "",
      };
    } else if (tiny) {
      return;
    }
    setMarks((prev) => [
      ...prev,
      {
        ...next,
        id: `mark-${prev.length + 1}-${Math.round(next.x)}-${Math.round(next.y)}`,
      },
    ]);
    setDraftMark(null);
  };

  const runCheck = async () => {
    if (!doc) return;
    setStatus("Checking the numbers on every page");
    try {
      const all: string[] = [];
      for (let p = 1; p <= doc.pageCount; p++) {
        const ocrLines = scanByPage[p]?.ocrLines;
        const pageLines = ocrLines?.length ? ocrLines : await extractLines(doc.proxy, p, doc.bytes);
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
      const patches: TextPatch[] = [];
      for (const { line, text, fontChoiceId: editFontId } of Object.values(edits)) {
        if (line.source === "ocr" || scanByPage[line.page]?.ocrLines.length) continue;
        const option = fontCatalog.find((item) => item.id === (editFontId || fontChoiceId));
        let embedBytes: Uint8Array | undefined;
        if (option?.source === "system" && option.postscriptName) {
          embedBytes = (await loadSystemFontBytes(option.postscriptName)) ?? undefined;
        }
        patches.push({
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
          ...(option
            ? {
                fontChoice: {
                  source: option.source,
                  family: option.family,
                  ...(option.resourceKey ? { resourceKey: option.resourceKey } : {}),
                  ...(option.postscriptName ? { postscriptName: option.postscriptName } : {}),
                  ...(embedBytes ? { embedBytes } : {}),
                },
              }
            : {}),
        });
      }
      const imagePatches = Object.values(imageEdits).map((edit) => ({
        page: edit.region.page,
        x: edit.region.x,
        y: edit.region.y,
        width: edit.region.width,
        height: edit.region.height,
        bytes: edit.output.bytes,
        mime: "image/jpeg" as const,
      }));
      const scanPatches: ScanPageExport[] = [];
      for (const [pageKey, session] of Object.entries(scanByPage)) {
        const jpeg =
          session.replaceWithCleaned && session.enhancedJpeg
            ? session.enhancedJpeg
            : session.originalJpeg;
        if (!jpeg) continue;
        if (!session.ocrLines.length && !session.replaceWithCleaned) continue;
        scanPatches.push({
          page: Number(pageKey),
          imageBytes: jpeg.bytes,
          pixelWidth: jpeg.width,
          pixelHeight: jpeg.height,
          lines: session.ocrLines.map((line) => ({
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            fontSize: line.fontSize,
            text: edits[line.id]?.text ?? line.text,
            originalText: line.text,
          })),
        });
      }
      const bytes = await applyWorkshopPatches(
        doc.bytes,
        patches,
        imagePatches,
        marks,
        scanPatches,
      );
      downloadBytes(
        bytes,
        exportFileName(
          doc.base,
          patches.length + imagePatches.length + scanPatches.length > 0,
          marks,
        ),
      );
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
            data-text={line.text}
            style={boxStyle(line.x, line.y, line.width, line.height, scale, viewSize)}
            className={[
              "absolute min-h-[22px] cursor-text touch-manipulation rounded-[2px] border transition-colors [@media(pointer:fine)]:min-h-0",
              selectedId === line.id
                ? "border-primary bg-primary/25"
                : isEdited
                  ? "border-success/70 bg-success/20"
                  : line.source === "ocr"
                    ? "border-primary/70 bg-primary/15"
                    : scanMode
                      ? "border-dashed border-warning/70 bg-warning/15"
                      : "border-primary/40 bg-primary/10 [@media(pointer:fine)]:border-transparent [@media(pointer:fine)]:bg-transparent [@media(pointer:fine)]:hover:border-primary/60 [@media(pointer:fine)]:hover:bg-primary/15",
            ].join(" ")}
          >
            <span className="sr-only">Edit: {line.text}</span>
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, scale, viewSize, selectedId, edits, scanMode],
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

  const markOverlay = [...marks.filter((m) => m.page === page), draftMark].filter(Boolean) as Array<
    Omit<AnnotationBurn, "id"> & { id?: string }
  >;

  return (
    <AppShell hideFooter>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Local editor · No Adobe license</p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
              Edit the words or the photo. Leave the rest of the page alone.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
              Original pages stay as PDF objects — fonts, rules, and images you do not touch are not
              rasterized. Click a run, rewrite it in a font already in the file, and export. No
              white-out layer. Image studio is a document workshop, not Photoshop: replace, crop,
              rotate, exposure, contrast, compress. Marks burn in only after you confirm them.
            </p>
          </div>
          {doc && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-gauge">
                {pendingCount} pending change(s)
              </Badge>
              <Button
                className="min-h-11 touch-manipulation"
                variant="secondary"
                onClick={runCheck}
                disabled={!!status}
              >
                <Calculator className="mr-1.5 size-3.5" /> Check numbers
              </Button>
              <Button
                className="min-h-11 touch-manipulation"
                onClick={exportPdf}
                disabled={!!status || pendingCount === 0}
              >
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
                      setDraftMark(null);
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
                      setDraftMark(null);
                      setPage((p) => Math.min(doc.pageCount, p + 1));
                    }}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1 rounded-md bg-muted p-1">
                {(
                  [
                    ["text", Type, "Text"],
                    ["image", ImageIcon, "Image studio"],
                    ["mark", Highlighter, "Marks"],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={mode === value ? "default" : "ghost"}
                    className="flex-1"
                    onClick={() => setMode(value)}
                  >
                    <Icon className="size-3.5" /> {label}
                  </Button>
                ))}
              </div>

              {scanMode && mode === "text" && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
                  <ScanLine className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-semibold">This page looks scanned</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scanReport?.message ||
                        "Enhance page and OCR to edit amounts without painting Helvetica over the image."}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-4 max-h-[70vh] overflow-auto rounded-md bg-paper p-2 sm:p-3">
                <div className="relative mx-auto w-full">
                  <div ref={holderRef} className="w-full" />
                  {status ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-paper/70 text-sm text-paper-foreground">
                      <Loader2 className="mr-2 size-4 animate-spin" /> {status}…
                    </div>
                  ) : (
                    <div
                      ref={pageBoxRef}
                      className="absolute inset-0"
                      onPointerDown={mode === "mark" ? onMarkPointerDown : undefined}
                      onPointerMove={mode === "mark" ? onMarkPointerMove : undefined}
                      onPointerUp={mode === "mark" ? onMarkPointerUp : undefined}
                    >
                      {scanSession.replaceWithCleaned && scanSession.enhancedPreviewUrl && (
                        <img
                          src={scanSession.enhancedPreviewUrl}
                          alt=""
                          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                        />
                      )}
                      {mode === "text" && textOverlay}
                      {mode === "image" && imageOverlay}
                      {mode === "image" &&
                        Object.values(imageEdits)
                          .filter(
                            (edit) =>
                              edit.region.page === page && edit.region.id !== selectedImageId,
                          )
                          .map((edit) => (
                            <CommittedImageOverlay
                              key={edit.region.id}
                              edit={edit}
                              scale={scale}
                              viewSize={viewSize}
                            />
                          ))}
                      {mode === "image" && selectedImage && previewUrl && (
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
                      {markOverlay.map((mark, index) => (
                        <div
                          key={mark.id ?? `draft-${index}`}
                          style={boxStyle(mark.x, mark.y, mark.width, mark.height, scale, viewSize)}
                          className={
                            mark.kind === "redact"
                              ? "pointer-events-none absolute bg-black"
                              : mark.kind === "highlight"
                                ? "pointer-events-none absolute border border-amber-500/70 bg-amber-300/45"
                                : mark.kind === "underline"
                                  ? "pointer-events-none absolute bg-transparent shadow-[inset_0_-3px_0_0_rgb(185,50,35)]"
                                  : mark.kind === "note"
                                    ? "pointer-events-none absolute overflow-hidden border border-amber-700/40 bg-amber-200/95 text-[10px] leading-tight text-foreground/80"
                                    : "pointer-events-none absolute border-2 border-primary bg-primary/10"
                          }
                        >
                          {mark.kind === "note" ? (
                            <span className="block truncate px-1 py-0.5">
                              {mark.text || "Note"}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {mode === "text" &&
                  (scanMode
                    ? scanSession.ocrLines.length
                      ? `${scanSession.ocrLines.length} OCR lines on this page. Click one to edit; export writes a text layer on the page image.`
                      : "This page looks scanned. Ghost boxes are not real text operators — use Enhance page & OCR in the side panel."
                    : `${lines.length} text runs on this page. Hover to see the boxes; click one to edit that run only.`)}
                {mode === "image" &&
                  `${images.length} embedded photo${images.length === 1 ? "" : "s"} on this page. Only the selected image is decoded.`}
                {mode === "mark" &&
                  "Drag a highlight, underline, note, or redaction box, then keep it. Redaction burns a black box into the export copy."}
              </p>
            </div>

            <aside className="bench-panel flex flex-col p-4 sm:p-5">
              {mode === "image" ? (
                <ImageStudioPanel
                  region={selectedImage ?? null}
                  imageCount={images.length}
                  draft={imageDraft}
                  previewUrl={previewUrl}
                  previewBusy={previewBusy}
                  outputBytes={
                    selectedImage
                      ? (imageEdits[selectedImage.id]?.output.bytes.byteLength ?? null)
                      : null
                  }
                  sourceLabel={sourceLabel}
                  onChange={setImageDraft}
                  onReplace={(file) => void replaceImage(file)}
                  onCommit={() => void commitImage()}
                  onReset={() => void resetImage()}
                />
              ) : mode === "mark" ? (
                <>
                  <p className="eyebrow">Marks</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Confirmed marks write onto the export copy. Redaction is an opaque black box.
                    The original file is never changed. No comment threads.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant={markTool === "highlight" ? "default" : "secondary"}
                      onClick={() => setMarkTool("highlight")}
                    >
                      <Highlighter className="size-3.5" /> Highlight
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "underline" ? "default" : "secondary"}
                      onClick={() => setMarkTool("underline")}
                    >
                      <Underline className="size-3.5" /> Underline
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "note" ? "default" : "secondary"}
                      onClick={() => setMarkTool("note")}
                    >
                      <StickyNote className="size-3.5" /> Note
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "redact" ? "default" : "secondary"}
                      onClick={() => setMarkTool("redact")}
                    >
                      <Square className="size-3.5" /> Redact
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "rect" ? "default" : "secondary"}
                      onClick={() => setMarkTool("rect")}
                    >
                      <Square className="size-3.5" /> Rectangle
                    </Button>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={
                        !draftMark ||
                        (draftMark.kind !== "note" && (draftMark.width < 8 || draftMark.height < 8))
                      }
                      onClick={keepMark}
                    >
                      Keep this mark
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraftMark(null)}
                      aria-label="Cancel draft mark"
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  </div>
                  {marks.length > 0 && (
                    <ul className="mt-4 space-y-2 text-xs">
                      {marks.map((mark) => (
                        <li key={mark.id} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">
                              p{mark.page} · {mark.kind}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setMarks((prev) => prev.filter((m) => m.id !== mark.id))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                          {mark.kind === "note" && (
                            <Textarea
                              value={mark.text ?? ""}
                              rows={2}
                              placeholder="Sticky note text"
                              onChange={(e) =>
                                setMarks((prev) =>
                                  prev.map((m) =>
                                    m.id === mark.id ? { ...m, text: e.target.value } : m,
                                  ),
                                )
                              }
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  {scanMode && (
                    <ScanAwarePanel
                      report={
                        scanReport ?? {
                          looksScanned: true,
                          reason: "image-only",
                          message:
                            "This page looks scanned. Enhance page and OCR to edit amounts without a white-out.",
                          showCount: 0,
                          imageCount: 0,
                          pdfJsLineCount: 0,
                          matchedLineCount: 0,
                          matchRatio: 0,
                        }
                      }
                      session={scanSession}
                      busy={scanBusy}
                      onPreset={(preset) => patchScanSession({ preset })}
                      onReplaceToggle={(value) => patchScanSession({ replaceWithCleaned: value })}
                      onEnhanceAndOcr={() => void enhanceAndOcr()}
                      selectedId={selectedId}
                      editedIds={editedIds}
                      onSelectLine={select}
                    />
                  )}
                  {scanMode && selected && <Separator className="my-5" />}
                  {!selected ? (
                    scanMode ? null : (
                      <div className="py-8 text-center">
                        <p className="font-display text-base font-semibold">
                          {lines.length === 0 && doc
                            ? "No text operators on this page"
                            : "Nothing selected"}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {lines.length === 0 && doc
                            ? "This looks like a scan. A Safe edit here would paint over the image. Use Enhance page or Scan to OCR it instead."
                            : "Click any line on the page to open it here, or switch to Image studio."}
                        </p>
                        {lines.length === 0 && doc && (
                          <Button asChild className="mt-4" variant="secondary" size="sm">
                            <a href="/scan">Open Scan</a>
                          </Button>
                        )}
                      </div>
                    )
                  ) : (
                    <>
                      <p className="eyebrow">
                        {selectedIsOcr ? "Editing one OCR line" : "Editing one run"}
                      </p>
                      <p className="text-gauge mt-2 text-xs text-muted-foreground">
                        page {selected.page} · {selected.fontSize.toFixed(1)}pt ·{" "}
                        {selected.width.toFixed(0)}pt wide
                        {selectedIsOcr
                          ? " · OCR"
                          : selected.fontFamily
                            ? ` · ${selected.fontFamily.split(",")[0]}`
                            : ""}
                      </p>
                      {!selectedIsOcr && (
                        <>
                          <FontMatchIndicator inspection={inspection} loading={inspecting} />
                          <FontPicker
                            options={fontCatalog}
                            value={fontChoiceId}
                            onChange={setFontChoiceId}
                            disabled={!!inspection?.deferToScan}
                          />
                        </>
                      )}
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={4}
                        className="mt-3"
                        placeholder="Replacement text"
                        data-testid="edit-draft"
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
                            !selectedIsOcr &&
                            (scanMode || !canCommitSafely(inspection, draft, selected.text))
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
                      <p className="mt-3 text-xs text-muted-foreground">
                        Original: <code className="font-mono">{selected.text}</code>
                      </p>
                    </>
                  )}
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
                    {marks.map((mark) => (
                      <li key={mark.id} className="text-xs">
                        <span className="text-gauge text-muted-foreground">p{mark.page}</span>{" "}
                        <span className="text-success">{mark.kind}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>
        )}
      </main>
    </AppShell>
  );
}
