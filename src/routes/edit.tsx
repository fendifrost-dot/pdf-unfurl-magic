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
  Sparkles,
  Square,
  StickyNote,
  Type,
  Underline,
  Undo2,
  ListChecks,
  MousePointer2,
  BoxSelect,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PdfDropZone } from "@/components/pdf-drop-zone";
import { ImageStudioPanel } from "@/components/image-studio-panel";
import { AcroFormPanel } from "@/components/acroform-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  downloadBytes,
  expandToFullLine,
  extractLines,
  openDocument,
  renderPage,
  type TextLine,
} from "@/lib/pdf-runtime";
import {
  applyTextPatches,
  applyWorkshopPatches,
  buildSamplePdf,
  inspectTextPatch,
  type TextPatch,
} from "@/lib/pdf-tools";
import { exportFileName } from "@/lib/pdf-marks";
import { toDesktopBytes } from "@/lib/desktop";
import { FontMatchIndicator } from "@/components/font-match-indicator";
import { FontPicker } from "@/components/font-picker";
import { AlignSelectionPanel } from "@/components/align-selection-panel";
import { canCommitSafely, type TextEditInspection } from "@/lib/pdf-text-edit";
import {
  APPLY_EDIT_LABEL,
  APPLY_SUCCESS_MESSAGE,
  EDIT_HIGHLIGHT_STORAGE_KEY,
  MARK_CHANGES_FOR_REVIEWER_HINT,
  ORIGINAL_UNCHANGED_HINT,
  SHOW_EDIT_HIGHLIGHT_LABEL,
  canApplyTextEdit,
  columnFieldsForLine,
  enhanceOpenAfterTextChip,
  isColumnarLine,
  joinColumnDrafts,
  membersForLinePatch,
  remapColumnMemberTexts,
  nextEnhanceOpen,
  overlayApplyState,
  overlayFillMode,
  overlayShouldPaintLabel,
  pendingExportBanner,
  preferOcrOverlay,
  shouldFlattenPageAsScan,
  textOverlayChromeClass,
  textOverlayLabelClass,
  textPageFooter,
} from "@/lib/edit-apply";
import { ScanAwarePanel } from "@/components/scan-aware-panel";
import {
  applyMarqueeToLines,
  coverBoxesFromLine,
  type PdfRect,
  type TextSelectMode,
} from "@/lib/text-select";
import {
  alignRuns,
  editIsPending,
  extractOrigin,
  groupForAlign,
  lineAtOrigin,
  nudgeRuns,
  patchesFromEdit,
  positionMoved,
  remapLinePositions,
  selectionMembers,
  showAlignControls,
  snapRunsToOrigin,
  type AlignKind,
} from "@/lib/text-align";
import {
  applyOcrVerifyDecision,
  collectUncertainSnippets,
  ocrVerifyBlocksApply,
  pendingOcrSnippets,
  type OcrVerifyDecision,
} from "@/lib/ocr-verify";
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
import { ENHANCE_CHIP_LABEL } from "@/lib/enhance-entry";
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
import {
  buildSampleAcroFormPdf,
  emptyAcroFormReport,
  formValuesEqual,
  inspectAcroForm,
  valuesFromReport,
  type AcroFormReport,
  type AcroFormValue,
} from "@/lib/pdf-acroform";

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

type Edit = {
  line: TextLine;
  text: string;
  fontChoiceId?: string;
  memberTexts?: Record<string, string>;
};
type Mode = "text" | "image" | "mark" | "form";
type MarkTool = AnnotationBurn["kind"];

function persistShowEditHighlight(on: boolean) {
  try {
    sessionStorage.setItem(EDIT_HIGHLIGHT_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Private mode / blocked storage — session memory still holds the toggle.
  }
}

function readShowEditHighlight(): boolean {
  try {
    return sessionStorage.getItem(EDIT_HIGHLIGHT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markKindLabel(kind: AnnotationBurn["kind"]): string {
  if (kind === "redact") return "cover box";
  if (kind === "erase") return "permanent redact";
  if (kind === "rect") return "rectangle";
  return kind;
}

const CANVAS_WIDTH = 720;

function findLineOrMember(lines: TextLine[], id: string): TextLine | undefined {
  for (const line of lines) {
    if (line.id === id) return line;
    const member = line.members?.find((run) => run.id === id);
    if (member) return member;
  }
  return undefined;
}

function parentLineFor(lines: TextLine[], selected: TextLine): TextLine | undefined {
  if (lines.some((line) => line.id === selected.id)) return selected;
  return lines.find((line) => line.members?.some((run) => run.id === selected.id));
}

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

function memberBoxesForPatch(line: TextLine): TextPatch["memberBoxes"] {
  const runs = line.members?.length ? line.members : [];
  if (runs.length <= 1) return undefined;
  return runs.map((run) => {
    const origin = extractOrigin(run);
    return {
      x: origin.x,
      y: origin.y,
      width: run.width,
      height: run.height,
      ...(run.text ? { text: run.text } : {}),
    };
  });
}

function segmentedPatchFields(
  line: TextLine,
  text: string,
  memberTexts?: Record<string, string>,
): Pick<TextPatch, "members" | "memberBoxes"> {
  const members = membersForLinePatch(line, memberTexts ?? { [line.id]: text });
  const memberBoxes = memberBoxesForPatch(line);
  return {
    ...(memberBoxes ? { memberBoxes } : {}),
    ...(members?.length ? { members } : {}),
  };
}

function patchFontExtras(
  option: CatalogFont | undefined,
  embedBytes?: Uint8Array,
): Pick<TextPatch, "fontChoice"> {
  if (!option) return {};
  return {
    fontChoice: {
      source: option.source,
      family: option.family,
      ...(option.resourceKey ? { resourceKey: option.resourceKey } : {}),
      ...(option.postscriptName ? { postscriptName: option.postscriptName } : {}),
      ...(embedBytes ? { embedBytes } : {}),
    },
  };
}

/** Column members already carry targetX; otherwise fall back to per-run align patches. */
function patchesForNativeEdit(
  edit: Edit,
  option: CatalogFont | undefined,
  embedBytes?: Uint8Array,
): TextPatch[] {
  const extras = patchFontExtras(option, embedBytes);
  const segmented = segmentedPatchFields(edit.line, edit.text, edit.memberTexts);
  if (segmented.members?.length) {
    const { line, text } = edit;
    const origin = extractOrigin(line);
    return [
      {
        page: line.page,
        x: origin.x,
        y: origin.y,
        width: line.width,
        height: line.height,
        fontSize: line.fontSize,
        text,
        originalText: line.text,
        ...(line.rawText ? { rawText: line.rawText } : {}),
        ...segmented,
        fontName: line.fontName,
        fontFamily: line.fontFamily,
        ...extras,
      },
    ];
  }
  return patchesFromEdit(
    {
      line: edit.line,
      text: edit.text,
      ...(edit.fontChoiceId ? { fontChoiceId: edit.fontChoiceId } : {}),
      ...(edit.memberTexts ? { memberTexts: edit.memberTexts } : {}),
    },
    extras,
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
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string>>({});
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
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [nativeLines, setNativeLines] = useState<TextLine[]>([]);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [showOriginalHint, setShowOriginalHint] = useState(false);
  const [showEditHighlight, setShowEditHighlight] = useState(false);
  const [pageHasPatchedPreview, setPageHasPatchedPreview] = useState(false);
  const [formReport, setFormReport] = useState<AcroFormReport>(emptyAcroFormReport);
  const [formValues, setFormValues] = useState<Record<string, AcroFormValue>>({});
  const [formOriginal, setFormOriginal] = useState<Record<string, AcroFormValue>>({});
  const [formFlatten, setFormFlatten] = useState(true);
  const [selectedFieldName, setSelectedFieldName] = useState<string | null>(null);
  const [fontCatalog, setFontCatalog] = useState<CatalogFont[]>([]);
  const [fontChoiceId, setFontChoiceId] = useState("");
  const [textSelectMode, setTextSelectMode] = useState<TextSelectMode>("line");
  const [draftMarquee, setDraftMarquee] = useState<PdfRect | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<PdfRect | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const scanByPageRef = useRef(scanByPage);
  scanByPageRef.current = scanByPage;
  const enhancePageKeyRef = useRef("");
  const enhanceDismissedRef = useRef(false);
  const enhanceOpenRef = useRef(false);
  enhanceOpenRef.current = enhanceOpen;
  const patchedPreviewRef = useRef<PDFDocumentProxy | null>(null);
  const canvasGenRef = useRef(0);

  const selected = selectedId ? findLineOrMember(lines, selectedId) : undefined;
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
  const formDirtyCount = formReport.fields.filter(
    (field) => !formValuesEqual(formValues[field.name], formOriginal[field.name]),
  ).length;
  const formPending =
    formReport.fillableCount > 0 && formFlatten ? Math.max(1, formDirtyCount) : formDirtyCount;
  const pendingCount =
    editedIds.length + imageEditIds.length + marks.length + scanExportReady + formPending;
  const scanSession = scanByPage[page] ?? emptyScanSession();
  const looksScanned = !!scanReport?.looksScanned;
  const showingOcr = preferOcrOverlay({
    enhanceOpen,
    ocrLineCount: scanSession.ocrLines.length,
  });
  const ocrVerify = scanSession.ocrVerify ?? [];
  const marqueeEnabled = mode === "text" && textSelectMode === "marquee" && !showingOcr;
  const selectedIsOcr = selected?.source === "ocr";
  const selectedParent = selected ? parentLineFor(lines, selected) : undefined;
  const editingRun = !!selected && !!selectedParent && selectedParent.id !== selected.id;
  const columnFields =
    selected && !selectedIsOcr && !editingRun ? columnFieldsForLine(selected) : [];
  const columnarEdit = columnFields.length > 1;
  const fullLine = selected && !selectedIsOcr ? expandToFullLine(lines, selected) : null;
  const selectedVerifyPending = ocrVerifyBlocksApply({
    source: selected?.source,
    lineId: selected?.id,
    snippets: ocrVerify,
  });
  const applyText = columnarEdit ? joinColumnDrafts(columnFields, memberDrafts) : draft.trim();
  const applyOriginal = selected
    ? columnarEdit
      ? joinColumnDrafts(columnFields, Object.fromEntries(columnFields.map((f) => [f.id, f.text])))
      : selected.text
    : "";
  const applyEnabled = selected
    ? canApplyTextEdit({
        selectedIsOcr,
        source: selected.source,
        deferToScan: inspection?.deferToScan,
        canCommitSafely: canCommitSafely(inspection, applyText, applyOriginal),
        looksScanned,
        hasTextOperator: selected.hasTextOperator,
        ocrVerifyPending: selectedVerifyPending,
      })
    : false;
  const panelReport: PageScanReport = scanReport ?? {
    looksScanned,
    reason: looksScanned ? "image-only" : "ok",
    message: looksScanned ? "Enhance page and OCR to edit amounts without a white-out." : "",
    showCount: 0,
    imageCount: 0,
    pdfJsLineCount: lines.length,
    matchedLineCount: 0,
    matchRatio: 0,
  };

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
      setNativeLines([]);
      setApplyNotice(null);
      setShowOriginalHint(false);
      setPageHasPatchedPreview(false);
      if (patchedPreviewRef.current) {
        void patchedPreviewRef.current.destroy();
        patchedPreviewRef.current = null;
      }
      enhanceDismissedRef.current = false;
      setScanByPage((prev) => {
        Object.values(prev).forEach(releaseScanSession);
        return {};
      });
      setFormReport(emptyAcroFormReport());
      setFormValues({});
      setFormOriginal({});
      setSelectedFieldName(null);
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
    setShowEditHighlight(readShowEditHighlight());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      if (window.location.hash === "#images") setMode("image");
      if (window.location.hash === "#marks") setMode("mark");
      if (window.location.hash === "#form") setMode("form");
      if (window.location.hash === "#enhance") {
        setMode("text");
        setEnhanceOpen(true);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void inspectAcroForm(doc.bytes).then((report) => {
      if (cancelled) return;
      setFormReport(report);
      const values = valuesFromReport(report);
      setFormValues(values);
      setFormOriginal(values);
      const hash = typeof window === "undefined" ? "" : window.location.hash;
      if (report.fillableCount > 0 && (hash === "#form" || hash === "")) {
        setMode((current) => (hash === "#form" || current === "text" ? "form" : current));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const enhancePageKey = `${doc?.name ?? ""}:${page}`;

  useEffect(() => {
    const pageChanged = enhancePageKeyRef.current !== enhancePageKey;
    if (pageChanged) {
      enhancePageKeyRef.current = enhancePageKey;
      enhanceDismissedRef.current = false;
    }
    const hashEnhance = typeof window !== "undefined" && window.location.hash === "#enhance";
    const open = nextEnhanceOpen({
      userClosed: enhanceDismissedRef.current,
      looksScanned: !!scanReport?.looksScanned,
      ocrLineCount: scanSession.ocrLines.length,
      hashEnhance,
    });
    if (open) setEnhanceOpen(true);
    else if (pageChanged) setEnhanceOpen(false);
  }, [enhancePageKey, scanReport?.looksScanned, scanSession.ocrLines.length]);

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
    setScanReport(null);
    clearPreview();
    const gen = ++canvasGenRef.current;
    (async () => {
      try {
        const [{ canvas, viewport }, pageLines, pageImages] = await Promise.all([
          renderPage(doc.proxy, page, CANVAS_WIDTH),
          extractLines(doc.proxy, page, doc.bytes),
          extractImages(doc.proxy, page),
        ]);
        if (cancelled) return;
        const holder = holderRef.current;
        if (holder && gen === canvasGenRef.current) {
          holder.replaceChildren(canvas);
          canvas.className = "block w-full h-auto rounded-sm";
          setScale(viewport.scale);
          setViewSize({ width: viewport.width, height: viewport.height });
        }
        const ocrLines = scanByPage[page]?.ocrLines ?? [];
        setNativeLines(pageLines);
        setLines(
          preferOcrOverlay({
            enhanceOpen: enhanceOpenRef.current,
            ocrLineCount: ocrLines.length,
          })
            ? ocrLines
            : pageLines,
        );
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

  // After Apply, rewrite a copy and paint that page so replacement glyphs match
  // the rest of the file — no overlay whiteout over watermarks.
  useEffect(() => {
    if (!doc) return;
    const nativeEdits = Object.values(edits).filter(
      (edit) => edit.line.page === page && edit.line.source !== "ocr" && editIsPending(edit),
    );
    let cancelled = false;
    let gen = canvasGenRef.current;

    const paint = async (proxy: PDFDocumentProxy) => {
      const { canvas, viewport } = await renderPage(proxy, page, CANVAS_WIDTH);
      if (cancelled || gen !== canvasGenRef.current) return;
      const holder = holderRef.current;
      if (holder) {
        holder.replaceChildren(canvas);
        canvas.className = "block w-full h-auto rounded-sm";
      }
      setScale(viewport.scale);
      setViewSize({ width: viewport.width, height: viewport.height });
    };

    if (nativeEdits.length === 0) {
      setPageHasPatchedPreview(false);
      if (patchedPreviewRef.current) {
        gen = ++canvasGenRef.current;
        void patchedPreviewRef.current.destroy();
        patchedPreviewRef.current = null;
        void paint(doc.proxy);
      }
      return () => {
        cancelled = true;
      };
    }

    gen = ++canvasGenRef.current;

    void (async () => {
      try {
        const patches: TextPatch[] = nativeEdits.flatMap((edit) => {
          const option = fontCatalog.find(
            (item) => item.id === (edit.fontChoiceId || fontChoiceId),
          );
          return patchesForNativeEdit(edit, option);
        });
        const bytes = await applyTextPatches(doc.bytes, patches);
        if (cancelled) return;
        const proxy = await openDocument(bytes.slice().buffer as ArrayBuffer);
        if (cancelled) {
          void proxy.destroy();
          return;
        }
        await paint(proxy);
        if (cancelled) {
          void proxy.destroy();
          return;
        }
        if (patchedPreviewRef.current && patchedPreviewRef.current !== proxy) {
          void patchedPreviewRef.current.destroy();
        }
        patchedPreviewRef.current = proxy;
        setPageHasPatchedPreview(true);
      } catch {
        if (!cancelled) setPageHasPatchedPreview(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, page, edits, fontCatalog, fontChoiceId]);

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
    if (!doc || !selected || selected.source === "ocr") {
      setInspection(null);
      setInspecting(false);
      return;
    }
    let cancelled = false;
    setInspecting(true);
    const locate = lineAtOrigin(selected);
    const coverBoxes = coverBoxesFromLine(locate);
    const origin = extractOrigin(selected);
    const memberBoxes = memberBoxesForPatch(locate);
    const probe: TextPatch = {
      page: selected.page,
      x: origin.x,
      y: origin.y,
      width: selected.width,
      height: selected.height,
      fontSize: selected.fontSize,
      text: draft,
      originalText: selected.text,
      ...(selected.rawText ? { rawText: selected.rawText } : {}),
      ...segmentedPatchFields(selected, draft, memberDrafts),
      fontName: selected.fontName,
      fontFamily: selected.fontFamily,
      ...(memberBoxes ? { memberBoxes } : {}),
      ...(coverBoxes ? { coverBoxes } : {}),
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
          const preferBundled =
            result.method === "redraw-unicode" ||
            !!result.embeddedFonts?.some(
              (font) => font.cid && font.key === (result.resourceKey || selected.fontName),
            );
          setFontChoiceId((prev) => {
            const current = catalog.find((item) => item.id === prev);
            const fallback = defaultFontChoiceId(
              catalog,
              result.resourceKey || selected.fontName,
              preferBundled,
            );
            if (preferBundled) {
              if (current?.source === "bundled" || current?.source === "system") return prev;
              return fallback;
            }
            if (current) return prev;
            return fallback;
          });
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
  }, [doc, selected, draft, memberDrafts]);

  const openSample = async () => {
    setStatus("Building the sample quote");
    const bytes = await buildSamplePdf();
    await loadBytes("northgate-quote-sample.pdf", bytes.slice(0).buffer as ArrayBuffer);
    setMode("image");
  };

  const openSampleForm = async () => {
    setStatus("Building the sample AcroForm");
    const bytes = await buildSampleAcroFormPdf();
    await loadBytes("acroform-simple.pdf", bytes.slice(0).buffer as ArrayBuffer);
    setMode("form");
  };

  const select = (line: TextLine, storedOverride?: Edit) => {
    setSelectedImageId(null);
    setSelectedId(line.id);
    const stored = storedOverride ?? edits[line.id];
    setDraft(stored?.text ?? line.text);
    const fields = columnFieldsForLine(line);
    const nextDrafts: Record<string, string> = {};
    for (const field of fields) {
      nextDrafts[field.id] = stored?.memberTexts?.[field.id] ?? field.text;
    }
    setMemberDrafts(nextDrafts);
    setMode("text");
  };

  const focusTextDraft = () => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-testid=edit-draft]")?.focus();
    });
  };

  const setEnhancePanelOpen = (open: boolean) => {
    if (open) {
      enhanceDismissedRef.current = false;
      setEnhanceOpen(true);
      if (scanSession.ocrLines.length) setLines(scanSession.ocrLines);
      return;
    }
    enhanceDismissedRef.current = true;
    setEnhanceOpen(enhanceOpenAfterTextChip());
    if (typeof window !== "undefined" && window.location.hash === "#enhance") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (selected?.source === "ocr") {
      setSelectedId(null);
      setDraft("");
    }
    if (nativeLines.length) setLines(nativeLines);
  };

  const exitEnhanceToText = () => {
    setMode("text");
    setEnhancePanelOpen(false);
    focusTextDraft();
  };

  const clearOcrForPage = () => {
    setScanByPage((prev) => {
      const session = prev[page];
      if (!session) return prev;
      return {
        ...prev,
        [page]: { ...session, ocrLines: [], ocrVerify: [] },
      };
    });
    setEdits((prev) => {
      const next = { ...prev };
      for (const [id, edit] of Object.entries(next)) {
        if (edit.line.source === "ocr" && edit.line.page === page) delete next[id];
      }
      return next;
    });
    if (selected?.source === "ocr") {
      setSelectedId(null);
      setDraft("");
    }
    if (nativeLines.length) setLines(nativeLines);
    setEnhancePanelOpen(false);
    setMode("text");
  };

  useEffect(() => {
    const ocr = scanByPage[page]?.ocrLines ?? [];
    if (preferOcrOverlay({ enhanceOpen, ocrLineCount: ocr.length })) {
      setLines(ocr);
    } else if (nativeLines.length) {
      setLines(nativeLines);
    }
  }, [enhanceOpen, nativeLines, page, scanByPage]);

  const expandSelectedLine = () => {
    if (!selected) return;
    const joined = expandToFullLine(lines, selected);
    if (!joined) return;
    const fromFields = columnFieldsForLine(selected);
    const toFields = columnFieldsForLine(joined);
    const stored = edits[selected.id];
    const remapped = remapColumnMemberTexts({
      fromFields,
      toFields,
      memberTexts: stored?.memberTexts,
      liveDrafts: memberDrafts,
      sourceDraft: stored?.text ?? draft,
      sourceWasColumnar: fromFields.length > 1,
    });
    const joinedText =
      toFields.length > 1
        ? joinColumnDrafts(toFields, remapped)
        : (stored?.text ?? draft ?? joined.text);
    const carried: Edit = {
      line: joined,
      text: joinedText,
      fontChoiceId: stored?.fontChoiceId ?? fontChoiceId,
      ...(toFields.length > 1 ? { memberTexts: remapped } : {}),
    };
    const hadApplied = !!stored;
    const hadLiveChange =
      (draft && draft !== selected.text) ||
      fromFields.some((field) => (memberDrafts[field.id] ?? field.text) !== field.text);
    const band = Math.max(3, selected.fontSize * 0.5);
    const merge = (prev: TextLine[]) => {
      const kept = prev.filter(
        (line) => !(line.page === selected.page && Math.abs(line.y - selected.y) <= band),
      );
      return [...kept, joined].sort((a, b) => b.y - a.y || a.x - b.x);
    };
    setNativeLines(merge);
    setLines(merge);
    if (hadApplied) {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[selected.id];
        next[joined.id] = carried;
        return next;
      });
    }
    select(joined, hadApplied || hadLiveChange ? carried : undefined);
  };

  const selectImage = (image: PdfImageRegion) => {
    setSelectedId(null);
    setSelectedImageId(image.id);
    setMode("image");
  };

  const commit = () => {
    if (!selected) return;
    const fields = columnFieldsForLine(selected);
    const memberTexts =
      fields.length > 1
        ? Object.fromEntries(
            fields.map((field) => [field.id, memberDrafts[field.id] ?? field.text]),
          )
        : undefined;
    const text = fields.length > 1 ? joinColumnDrafts(fields, memberTexts ?? {}) : draft.trim();
    if (!applyEnabled) {
      return;
    }
    const pending: Edit = {
      line: { ...selected },
      text: text || selected.text,
      ...(fontChoiceId ? { fontChoiceId } : {}),
      ...(memberTexts ? { memberTexts } : {}),
    };
    setEdits((prev) => {
      const next = { ...prev };
      if (!editIsPending(pending)) delete next[selected.id];
      else next[selected.id] = pending;
      return next;
    });
    if (editIsPending(pending)) {
      setApplyNotice(APPLY_SUCCESS_MESSAGE);
      setShowOriginalHint(true);
    }
  };

  const pageLines = () =>
    showingOcr
      ? scanSession.ocrLines.length
        ? scanSession.ocrLines
        : lines
      : nativeLines.length
        ? nativeLines
        : lines;

  const applyMemberLayout = (
    nextMembers: ReturnType<typeof selectionMembers>,
    sourceLines: TextLine[] = pageLines(),
    anchor: TextLine = selected!,
  ) => {
    if (!anchor) return;
    const nextLines = remapLinePositions(sourceLines, nextMembers);
    const snapshot =
      findLineOrMember(nextLines, anchor.id) ?? parentLineFor(nextLines, anchor) ?? anchor;
    const parent = parentLineFor(nextLines, snapshot) ?? snapshot;
    if (showingOcr) {
      setLines(nextLines);
      patchScanSession({ ocrLines: nextLines });
    } else {
      setNativeLines(nextLines);
      setLines(nextLines);
    }
    setSelectedId(parent.id);
    if (anchor.id !== selected?.id) {
      setDraft(edits[parent.id]?.text ?? parent.text);
    }
    setEdits((prev) => {
      const touched = new Set(nextMembers.map((run) => run.id));
      const next: Record<string, Edit> = { ...prev };
      for (const [id, edit] of Object.entries(prev)) {
        const live = findLineOrMember(nextLines, id) ?? edit.line;
        const liveParent = parentLineFor(nextLines, live) ?? live;
        const pending = {
          line: liveParent,
          text: edit.text,
          ...(edit.fontChoiceId ? { fontChoiceId: edit.fontChoiceId } : {}),
          ...(edit.memberTexts ? { memberTexts: edit.memberTexts } : {}),
        };
        if (!editIsPending(pending)) delete next[id];
        else if (touched.has(id) || liveParent.members?.some((member) => touched.has(member.id))) {
          next[id] = pending;
        }
      }
      const existing = next[anchor.id] ?? next[parent.id];
      const pending = {
        line: parent,
        text: existing?.text ?? parent.text,
        ...((existing?.fontChoiceId ?? fontChoiceId)
          ? { fontChoiceId: existing?.fontChoiceId ?? fontChoiceId }
          : {}),
        ...(existing?.memberTexts ? { memberTexts: existing.memberTexts } : {}),
      };
      delete next[anchor.id];
      if (!editIsPending(pending)) delete next[parent.id];
      else next[parent.id] = pending;
      return next;
    });
    setApplyNotice(APPLY_SUCCESS_MESSAGE);
    setShowOriginalHint(true);
  };

  const workingAlignGroup = () => {
    if (!selected) return null;
    const source = pageLines();
    const current = parentLineFor(source, selected) ?? selected;
    if (selectionMembers(current).length >= 2) {
      return { source, anchor: current, members: selectionMembers(current) };
    }
    const expanded = expandToFullLine(source, current);
    if (expanded && selectionMembers(expanded).length >= 2) {
      const band = Math.max(3, current.fontSize * 0.5);
      const working = [
        ...source.filter(
          (line) => !(line.page === current.page && Math.abs(line.y - current.y) <= band),
        ),
        expanded,
      ].sort((a, b) => b.y - a.y || a.x - b.x);
      return { source: working, anchor: expanded, members: selectionMembers(expanded) };
    }
    return { source, anchor: current, members: selectionMembers(current) };
  };

  const alignSelection = (kind: AlignKind) => {
    const group = workingAlignGroup();
    if (!group) return;
    applyMemberLayout(alignRuns(group.members, kind), group.source, group.anchor);
  };

  const nudgeSelection = (dx: number) => {
    const group = workingAlignGroup();
    if (!group) return;
    applyMemberLayout(nudgeRuns(group.members, dx), group.source, group.anchor);
  };

  const snapSelectionToOrigin = () => {
    const group = workingAlignGroup();
    if (!group) return;
    const pendingOnPage = group.source
      .filter((line) => line.page === group.anchor.page)
      .flatMap((line) => (line.members?.length ? line.members : [line]))
      .filter((run) => positionMoved(run));
    const selectedIds = new Set(group.members.map((run) => run.id));
    const extras = pendingOnPage.filter((run) => !selectedIds.has(run.id));
    applyMemberLayout(snapRunsToOrigin([...group.members, ...extras]), group.source, group.anchor);
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
      const ocrVerifySnippets = collectUncertainSnippets(ocrLines);
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
            ocrVerify: ocrVerifySnippets,
            pageWidth: result.pageWidth,
            pageHeight: result.pageHeight,
          },
        };
      });
      setLines(ocrLines);
      setSelectedId(null);
      setDraft("");
      enhanceDismissedRef.current = false;
      setEnhanceOpen(true);
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

  const onTextMarqueeDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeEnabled) return;
    const point = eventToPdf(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = point;
    const rect = { x: point.x, y: point.y, width: 0, height: 0 };
    marqueeRef.current = rect;
    setDraftMarquee(rect);
  };

  const onTextMarqueeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeEnabled || !dragRef.current) return;
    const point = eventToPdf(event);
    if (!point) return;
    const start = dragRef.current;
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    marqueeRef.current = rect;
    setDraftMarquee(rect);
  };

  const onTextMarqueeUp = () => {
    if (!marqueeEnabled) {
      dragRef.current = null;
      marqueeRef.current = null;
      setDraftMarquee(null);
      return;
    }
    const rect = marqueeRef.current;
    dragRef.current = null;
    marqueeRef.current = null;
    setDraftMarquee(null);
    if (!rect) return;
    const source = nativeLines.length ? nativeLines : lines;
    const { lines: next, joined } = applyMarqueeToLines(source, rect);
    if (!joined) return;
    setNativeLines(next);
    setLines(next);
    select(joined);
  };

  const decideOcrVerify = (snippetId: string, decision: OcrVerifyDecision) => {
    const current = scanByPage[page] ?? emptyScanSession();
    const result = applyOcrVerifyDecision(
      current.ocrLines,
      current.ocrVerify ?? [],
      snippetId,
      decision,
    );
    patchScanSession({ ocrLines: result.lines, ocrVerify: result.snippets });
    if (preferOcrOverlay({ enhanceOpen, ocrLineCount: result.lines.length }) || showingOcr) {
      setLines(result.lines);
    }
    const stillSelected = selectedId ? findLineOrMember(result.lines, selectedId) : undefined;
    if (selectedId && !stillSelected) {
      setSelectedId(null);
      setDraft("");
    } else if (stillSelected) {
      setDraft(edits[stillSelected.id]?.text ?? stillSelected.text);
    }
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
      const flattenedPages = new Set<number>();
      for (const [pageKey, session] of Object.entries(scanByPage)) {
        if (
          shouldFlattenPageAsScan({
            hasOriginalJpeg: !!session.originalJpeg,
            hasOcrEdits: session.ocrLines.some((line) => !!edits[line.id]),
            replaceWithCleaned: session.replaceWithCleaned,
            hasNativeEdits: Object.values(edits).some(
              (edit) => edit.line.page === Number(pageKey) && edit.line.source !== "ocr",
            ),
            ocrLineCount: session.ocrLines.length,
          })
        ) {
          flattenedPages.add(Number(pageKey));
        }
      }
      const patches: TextPatch[] = [];
      for (const edit of Object.values(edits)) {
        const { line, fontChoiceId: editFontId } = edit;
        if (line.source === "ocr" || flattenedPages.has(line.page)) continue;
        if (!editIsPending(edit)) continue;
        const option = fontCatalog.find((item) => item.id === (editFontId || fontChoiceId));
        let embedBytes: Uint8Array | undefined;
        if (option?.source === "system" && option.postscriptName) {
          embedBytes = (await loadSystemFontBytes(option.postscriptName)) ?? undefined;
        }
        patches.push(...patchesForNativeEdit(edit, option, embedBytes));
      }
      const imagePatches = Object.values(imageEdits).map((edit) => ({
        page: edit.region.page,
        x: edit.region.x,
        y: edit.region.y,
        width: edit.region.width,
        height: edit.region.height,
        bytes: edit.output.bytes,
        mime: "image/jpeg" as const,
        name: edit.region.name,
      }));
      const scanPatches: ScanPageExport[] = [];
      for (const [pageKey, session] of Object.entries(scanByPage)) {
        if (!flattenedPages.has(Number(pageKey))) continue;
        const jpeg =
          session.replaceWithCleaned && session.enhancedJpeg
            ? session.enhancedJpeg
            : session.originalJpeg;
        if (!jpeg) continue;
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
      const formFill =
        formReport.hasAcroForm && formReport.fillableCount > 0
          ? { values: formValues, flatten: formFlatten }
          : null;
      const bytes = await applyWorkshopPatches(
        doc.bytes,
        patches,
        imagePatches,
        marks,
        scanPatches,
        formFill,
      );
      downloadBytes(
        bytes,
        exportFileName(
          doc.base,
          patches.length + imagePatches.length + scanPatches.length > 0,
          marks,
          !!formFill,
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
        const overlay = overlayApplyState({
          lineId: line.id,
          originalText: line.text,
          appliedText: edits[line.id]?.text,
          selectedId,
          draft,
          memberIds: line.members?.map((run) => run.id),
        });
        const memberEdited = line.members?.some((run) => !!edits[run.id]);
        const isMoved = positionMoved(line) || !!line.members?.some((run) => positionMoved(run));
        const isEdited = overlay.isEdited || !!memberEdited || isMoved;
        const isSelected =
          selectedId === line.id || !!line.members?.some((run) => run.id === selectedId);
        const fill = overlayFillMode({
          isEdited,
          isLivePreview: overlay.isLivePreview,
          showHighlight: showEditHighlight,
        });
        const canvasShowsApplied = pageHasPatchedPreview && isEdited && line.source !== "ocr";
        const columnar = isColumnarLine(line);
        const showLabel =
          overlayShouldPaintLabel({
            isEdited,
            isLivePreview: overlay.isLivePreview,
            showHighlight: showEditHighlight,
            canvasShowsApplied,
          }) && !(columnar && overlay.isLivePreview && !showEditHighlight);
        return (
          <button
            key={line.id}
            type="button"
            data-testid="text-overlay"
            data-edited={isEdited ? "true" : "false"}
            data-overlay-fill={fill}
            data-overlay-text={overlay.displayText}
            onClick={(event) => {
              if (event.shiftKey && line.members && line.members.length > 1) {
                const rect = event.currentTarget.getBoundingClientRect();
                const rel = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
                const pdfX = line.x + rel * line.width;
                const member = [...line.members]
                  .reverse()
                  .find((run) => pdfX >= run.x - 1 && pdfX <= run.x + run.width + 1);
                select(member ?? line);
                return;
              }
              select(line);
            }}
            title={overlay.displayText}
            data-text={overlay.displayText}
            style={boxStyle(line.x, line.y, line.width, line.height, scale, viewSize)}
            className={[
              textOverlayChromeClass({
                isSelected,
                isEdited,
                isLivePreview: overlay.isLivePreview,
                showHighlight: showEditHighlight,
                source: line.source,
                looksScanned,
                showingOcr,
              }),
              marqueeEnabled ? "pointer-events-none" : "",
            ].join(" ")}
          >
            {showLabel ? (
              <span
                className={textOverlayLabelClass(fill)}
                style={{ fontSize: `${Math.max(9, Math.min(22, line.fontSize * scale * 0.92))}px` }}
              >
                {overlay.displayText}
              </span>
            ) : (
              <span className="sr-only">Edit: {line.text}</span>
            )}
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lines,
      scale,
      viewSize,
      selectedId,
      edits,
      draft,
      looksScanned,
      showingOcr,
      showEditHighlight,
      pageHasPatchedPreview,
      marqueeEnabled,
    ],
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
              white-out layer. Form mode fills AcroForm fields and flattens them on export. Image
              studio is a document workshop, not Photoshop. Marks burn in only after you confirm
              them.
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
                  <Button variant="outline" onClick={() => void openSampleForm()}>
                    <ListChecks /> Load sample form
                  </Button>
                </PdfDropZone>
                <div className="bench-panel mt-5 p-4 text-sm text-muted-foreground">
                  No document yet. Use a contract, handout, quote, a fillable AcroForm, or the
                  workshop notes sample. Form export fills fields then flattens them. This editor is
                  for documents you own — it will not help fake bank statements or other official
                  records.
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
                      setScanReport(null);
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
                      setScanReport(null);
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
                    [
                      "form",
                      ListChecks,
                      formReport.fillableCount ? `Form (${formReport.fillableCount})` : "Form",
                    ],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={
                      mode === value && !(value === "text" && enhanceOpen) ? "default" : "ghost"
                    }
                    className="flex-1"
                    data-testid={
                      value === "form"
                        ? "edit-mode-form"
                        : value === "text"
                          ? "edit-mode-text"
                          : undefined
                    }
                    onClick={() => {
                      setMode(value);
                      if (value === "text") exitEnhanceToText();
                      if (value === "form") setEnhancePanelOpen(false);
                    }}
                  >
                    <Icon className="size-3.5" /> {label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={mode === "text" && enhanceOpen ? "default" : "ghost"}
                  className="flex-1"
                  data-testid="edit-mode-enhance"
                  onClick={() => {
                    setMode("text");
                    setEnhancePanelOpen(true);
                    window.requestAnimationFrame(() => {
                      const panel = document.getElementById("enhance-page-panel");
                      panel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                      panel?.querySelector<HTMLElement>("[data-enhance-focus]")?.focus();
                    });
                  }}
                >
                  <Sparkles className="size-3.5" /> {ENHANCE_CHIP_LABEL}
                </Button>
              </div>

              {mode === "text" && !showingOcr && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Text pick</p>
                  <div className="flex gap-1 rounded-md bg-muted p-1">
                    <Button
                      size="sm"
                      variant={textSelectMode === "line" ? "default" : "ghost"}
                      data-testid="text-select-line"
                      onClick={() => setTextSelectMode("line")}
                    >
                      <MousePointer2 className="size-3.5" /> Line
                    </Button>
                    <Button
                      size="sm"
                      variant={textSelectMode === "marquee" ? "default" : "ghost"}
                      data-testid="text-select-marquee"
                      onClick={() => setTextSelectMode("marquee")}
                    >
                      <BoxSelect className="size-3.5" /> Select any
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {textSelectMode === "marquee"
                      ? "Drag a rectangle over any runs — including a label and its amount."
                      : "Click a row to edit the whole line. Shift-click a fragment for one run."}
                  </p>
                </div>
              )}

              {looksScanned && mode === "text" && !showingOcr && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
                  <ScanLine className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-semibold">This page looks scanned</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scanReport?.message ||
                        "Enhance page and OCR to edit amounts without painting Helvetica over the image. Damaged lettering goes Enhance → Verify → Edit."}
                    </p>
                  </div>
                </div>
              )}

              {showingOcr && mode === "text" && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">OCR boxes on this page</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {pendingOcrSnippets(ocrVerify).length > 0
                        ? "Verify uncertain OCR in the side panel (Accept, Correct, or Skip) before Apply. Enhance → Verify → Edit."
                        : "Click a line, edit it, Apply to page, then Export. Or press Text / Done to return to native PDF lines."}
                    </p>
                  </div>
                </div>
              )}

              {editedIds.length > 0 && (
                <div
                  className="mt-4 sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2.5"
                  data-testid="pending-export-banner"
                >
                  <p className="text-sm font-semibold">{pendingExportBanner(editedIds.length)}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        id="show-edit-highlight-banner"
                        checked={showEditHighlight}
                        onCheckedChange={(value) => {
                          const on = value === true;
                          setShowEditHighlight(on);
                          persistShowEditHighlight(on);
                        }}
                        data-testid="show-edit-highlight-banner"
                      />
                      {SHOW_EDIT_HIGHLIGHT_LABEL}
                    </label>
                    <Button size="sm" onClick={() => void exportPdf()} disabled={!!status}>
                      <Download className="size-3.5" /> Export
                    </Button>
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
                      className={
                        marqueeEnabled ? "absolute inset-0 cursor-crosshair" : "absolute inset-0"
                      }
                      onPointerDown={
                        mode === "mark"
                          ? onMarkPointerDown
                          : marqueeEnabled
                            ? onTextMarqueeDown
                            : undefined
                      }
                      onPointerMove={
                        mode === "mark"
                          ? onMarkPointerMove
                          : marqueeEnabled
                            ? onTextMarqueeMove
                            : undefined
                      }
                      onPointerUp={
                        mode === "mark"
                          ? onMarkPointerUp
                          : marqueeEnabled
                            ? onTextMarqueeUp
                            : undefined
                      }
                      onPointerCancel={
                        mode === "mark"
                          ? onMarkPointerUp
                          : marqueeEnabled
                            ? () => {
                                dragRef.current = null;
                                marqueeRef.current = null;
                                setDraftMarquee(null);
                              }
                            : undefined
                      }
                    >
                      {scanSession.replaceWithCleaned && scanSession.enhancedPreviewUrl && (
                        <img
                          src={scanSession.enhancedPreviewUrl}
                          alt=""
                          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                        />
                      )}
                      {mode === "text" && textOverlay}
                      {marqueeEnabled &&
                        draftMarquee &&
                        draftMarquee.width + draftMarquee.height > 0 && (
                          <div
                            data-testid="text-marquee-rect"
                            style={boxStyle(
                              draftMarquee.x,
                              draftMarquee.y,
                              draftMarquee.width,
                              draftMarquee.height,
                              scale,
                              viewSize,
                            )}
                            className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
                          />
                        )}
                      {mode === "form" &&
                        formReport.fields.flatMap((field) =>
                          field.widgets
                            .filter((widget) => widget.page === page)
                            .map((widget, index) => (
                              <button
                                key={`${field.name}-${index}`}
                                type="button"
                                title={field.name}
                                data-testid={`acro-widget-${field.name}`}
                                onClick={() => setSelectedFieldName(field.name)}
                                style={boxStyle(
                                  widget.x,
                                  widget.y,
                                  widget.width,
                                  widget.height,
                                  scale,
                                  viewSize,
                                )}
                                className={[
                                  "absolute min-h-[22px] cursor-text touch-manipulation rounded-[2px] border transition-colors",
                                  selectedFieldName === field.name
                                    ? "border-primary bg-primary/25"
                                    : "border-primary/50 bg-primary/10 hover:border-primary hover:bg-primary/20",
                                ].join(" ")}
                              >
                                <span className="sr-only">Form field: {field.name}</span>
                              </button>
                            )),
                        )}
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
                            mark.kind === "erase"
                              ? "pointer-events-none absolute bg-black ring-2 ring-red-700"
                              : mark.kind === "redact"
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
                  textPageFooter({
                    showingOcr,
                    ocrLineCount: scanSession.ocrLines.length,
                    looksScanned,
                    nativeLineCount: nativeLines.length || lines.length,
                    pendingTextEdits: editedIds.length,
                  })}
                {mode === "image" &&
                  `${images.length} embedded photo${images.length === 1 ? "" : "s"} on this page. Only the selected image is decoded.`}
                {mode === "mark" &&
                  "Drag a highlight, underline, note, cover box, or permanent redaction rectangle. Highlights and notes save as real PDF annotations. A cover box draws an opaque box — the text or image underneath is still in the file. Redact (permanent) removes intersecting text operators and punches image pixels in the exported copy; that cannot be undone."}
                {mode === "form" &&
                  (formReport.fillableCount
                    ? `${formReport.fillableCount} fillable AcroForm field${formReport.fillableCount === 1 ? "" : "s"}. Click a box or use the list. Export fills, then flattens to a static PDF.`
                    : "No AcroForm widgets on this file. XFA / LiveCycle packets are not supported.")}
              </p>
            </div>

            <aside className="bench-panel flex flex-col p-4 sm:p-5">
              {mode === "form" ? (
                <AcroFormPanel
                  report={formReport}
                  values={formValues}
                  selectedName={selectedFieldName}
                  flatten={formFlatten}
                  onFlattenChange={setFormFlatten}
                  onSelect={(name, fieldPage) => {
                    setSelectedFieldName(name);
                    if (fieldPage && fieldPage !== page) setPage(fieldPage);
                  }}
                  onChange={(name, value) => setFormValues((prev) => ({ ...prev, [name]: value }))}
                />
              ) : mode === "image" ? (
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
                    Highlights, notes, underlines, and rectangles save as PDF annotations other
                    viewers can see. Cover box: draws an opaque box over the area in the exported
                    copy. The text or image underneath is still in the file and can be recovered —
                    this hides content, it does not remove it. Redact (permanent) actually removes
                    intersecting text and punches image pixels; it cannot be undone after export.
                    The original file is never changed.
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
                      <Square className="size-3.5" /> Cover box
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "rect" ? "default" : "secondary"}
                      onClick={() => setMarkTool("rect")}
                    >
                      <Square className="size-3.5" /> Rectangle
                    </Button>
                    <Button
                      size="sm"
                      variant={markTool === "erase" ? "default" : "secondary"}
                      onClick={() => setMarkTool("erase")}
                    >
                      <Eraser className="size-3.5" /> Redact (permanent)
                    </Button>
                  </div>
                  {markTool === "erase" ? (
                    <Alert className="mt-4">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Cannot be undone</AlertTitle>
                      <AlertDescription>
                        Export removes text operators and image pixels under this box from the copy.
                        Cover box only hides them. The original file on disk is never changed.
                      </AlertDescription>
                    </Alert>
                  ) : null}
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
                              p{mark.page} · {markKindLabel(mark.kind)}
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
                  <ScanAwarePanel
                    report={panelReport}
                    session={scanSession}
                    busy={scanBusy}
                    open={enhanceOpen}
                    onOpenChange={setEnhancePanelOpen}
                    onPreset={(preset) => patchScanSession({ preset })}
                    onReplaceToggle={(value) => patchScanSession({ replaceWithCleaned: value })}
                    onEnhanceAndOcr={() => void enhanceAndOcr()}
                    selectedId={selectedId}
                    editedIds={editedIds}
                    onSelectLine={select}
                    onDone={exitEnhanceToText}
                    onClearOcr={clearOcrForPage}
                    onVerifyDecide={decideOcrVerify}
                    onEnhanceAgain={() => {
                      setEnhancePanelOpen(true);
                      void enhanceAndOcr();
                    }}
                  />
                  <Separator className="my-5" />
                  {!selected ? (
                    <div className="py-8 text-center">
                      <p className="font-display text-base font-semibold">
                        {lines.length === 0 && doc
                          ? "No text operators on this page"
                          : "Nothing selected"}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {scanSession.ocrLines.length > 0
                          ? pendingOcrSnippets(ocrVerify).length > 0
                            ? "Verify uncertain OCR above, then click a confirmed line."
                            : "Click an OCR line above or a box on the page."
                          : lines.length === 0 && doc
                            ? "Use Enhance & OCR this page when this is a scan or the picture is hard to read. A Safe edit here would paint over the image."
                            : textSelectMode === "marquee"
                              ? "Drag a rectangle across any text runs, then edit the merged draft."
                              : "Click any line on the page to open it here, or switch to Image studio. Enhance is optional if picking feels wrong."}
                      </p>
                      {lines.length === 0 && doc && (
                        <Button asChild className="mt-4" variant="secondary" size="sm">
                          <a href="/scan">Open Scan</a>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="eyebrow">
                        {selectedIsOcr
                          ? "Editing one OCR line"
                          : editingRun
                            ? "Editing one run"
                            : "Editing one line"}
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
                      {columnarEdit ? (
                        <div className="mt-3 space-y-3" data-testid="edit-columns">
                          <p className="text-xs text-muted-foreground">
                            Each column keeps its original position. Extra spaces will not move
                            amounts.
                          </p>
                          {columnFields.map((field) => (
                            <label key={field.id} className="block space-y-1">
                              <span className="text-xs font-medium text-foreground">
                                {field.label}
                              </span>
                              <Input
                                value={memberDrafts[field.id] ?? field.text}
                                onChange={(event) => {
                                  const next = {
                                    ...memberDrafts,
                                    [field.id]: event.target.value,
                                  };
                                  setMemberDrafts(next);
                                  setDraft(joinColumnDrafts(columnFields, next));
                                }}
                                className="font-mono text-sm"
                                data-testid={
                                  field.label === "Description"
                                    ? "edit-draft"
                                    : `edit-draft-${field.label.toLowerCase()}`
                                }
                                placeholder={field.label}
                              />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <Textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={4}
                          className="mt-3"
                          placeholder="Replacement text"
                          data-testid="edit-draft"
                        />
                      )}
                      <p
                        className={
                          draftFits
                            ? "mt-2 text-xs text-muted-foreground"
                            : "mt-2 text-xs text-warning"
                        }
                      >
                        {draftFits
                          ? columnarEdit
                            ? "Amounts stay in their columns. Description edits do not move them."
                            : "Fits the original box at full size."
                          : `Too wide — export will shrink type to about ${exportSize.toFixed(1)}pt to stay inside the box.`}
                      </p>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (columnarEdit) {
                              const next = { ...memberDrafts };
                              for (const field of columnFields) {
                                next[field.id] = cleanCopy(next[field.id] ?? field.text);
                              }
                              setMemberDrafts(next);
                              setDraft(joinColumnDrafts(columnFields, next));
                              return;
                            }
                            setDraft(cleanCopy(draft));
                          }}
                        >
                          <Eraser className="mr-1.5 size-3.5" /> Clean copy
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (columnarEdit) {
                              const next = { ...memberDrafts };
                              for (const field of columnFields) {
                                next[field.id] = shortenToFit(
                                  next[field.id] ?? field.text,
                                  field.fontSize,
                                  field.width,
                                );
                              }
                              setMemberDrafts(next);
                              setDraft(joinColumnDrafts(columnFields, next));
                              return;
                            }
                            setDraft(shortenToFit(draft, selected.fontSize, boxWidth));
                          }}
                        >
                          <Scissors className="mr-1.5 size-3.5" /> Shorten to fit
                        </Button>
                      </div>

                      {fullLine && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-3 w-full"
                          onClick={expandSelectedLine}
                          title="Include every run on this baseline, including the amount column"
                        >
                          Expand to full line
                        </Button>
                      )}

                      {showAlignControls({ selected, lines, textSelectMode }) && (
                        <AlignSelectionPanel
                          onAlign={alignSelection}
                          onNudge={nudgeSelection}
                          onSnap={snapSelectionToOrigin}
                        />
                      )}

                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          data-testid="apply-edit"
                          onClick={commit}
                          disabled={!applyEnabled}
                        >
                          {APPLY_EDIT_LABEL}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDraft(selected.text);
                            const reset: Record<string, string> = {};
                            for (const field of columnFields) reset[field.id] = field.text;
                            setMemberDrafts(reset);
                          }}
                          aria-label="Reset to original text"
                        >
                          <Undo2 className="size-3.5" />
                        </Button>
                      </div>
                      {selectedVerifyPending && (
                        <p className="mt-3 text-sm text-warning" data-testid="ocr-verify-gate">
                          Accept, correct, or skip this OCR snippet before Apply.
                        </p>
                      )}
                      {applyNotice && (
                        <p
                          className="mt-3 text-sm font-medium text-success"
                          data-testid="apply-notice"
                        >
                          {applyNotice}
                        </p>
                      )}
                      {showOriginalHint && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {ORIGINAL_UNCHANGED_HINT}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        Original: <code className="font-mono">{selected.text}</code>
                      </p>
                    </>
                  )}
                  <div className="mt-4 flex items-start gap-3 rounded-md border border-border/70 px-3 py-2.5">
                    <Switch
                      id="show-edit-highlight"
                      checked={showEditHighlight}
                      onCheckedChange={(value) => {
                        const on = value === true;
                        setShowEditHighlight(on);
                        persistShowEditHighlight(on);
                      }}
                      data-testid="show-edit-highlight"
                    />
                    <div>
                      <Label htmlFor="show-edit-highlight" className="text-sm font-semibold">
                        {SHOW_EDIT_HIGHLIGHT_LABEL}
                      </Label>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {MARK_CHANGES_FOR_REVIEWER_HINT}. Off keeps applied text flush with the page
                        — no white box covering watermarks or rules.
                      </p>
                    </div>
                  </div>
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
                  <div
                    className="rounded-md border border-success/40 bg-success/10 p-3"
                    data-testid="sidebar-export"
                  >
                    <p className="text-sm font-semibold">
                      {pendingExportBanner(editedIds.length || pendingCount)}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {ORIGINAL_UNCHANGED_HINT}
                    </p>
                    <Button
                      className="mt-3 w-full min-h-11"
                      onClick={() => void exportPdf()}
                      disabled={!!status}
                    >
                      <Download className="mr-1.5 size-3.5" /> Export
                    </Button>
                  </div>
                  <p className="eyebrow mt-5">Pending edits</p>
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
                    {formReport.fields
                      .filter(
                        (field) =>
                          !formValuesEqual(formValues[field.name], formOriginal[field.name]),
                      )
                      .map((field) => (
                        <li key={field.name} className="text-xs">
                          <span className="text-gauge text-muted-foreground">
                            form {field.name}
                          </span>{" "}
                          <span className="text-success">
                            {Array.isArray(formValues[field.name])
                              ? (formValues[field.name] as string[]).join(", ")
                              : String(formValues[field.name] ?? "")}
                          </span>
                        </li>
                      ))}
                    {formFlatten && formReport.fillableCount > 0 && formDirtyCount === 0 && (
                      <li className="text-xs">
                        <span className="text-gauge text-muted-foreground">form</span>{" "}
                        <span className="text-success">flatten on export</span>
                      </li>
                    )}
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
