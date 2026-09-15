import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PenLine,
  Trash2,
} from "lucide-react";
import { PdfDropZone } from "@/components/pdf-drop-zone";
import { SignatureCapture } from "@/components/signature-capture";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toDesktopBytes } from "@/lib/desktop";
import {
  FIELD_DEFAULTS,
  SIGNER_COLORS,
  buildSampleContractPdf,
  buildSignedExport,
  createSigner,
  fieldLabel,
  formatSignedDate,
  isFieldFilled,
  newId,
  sampleContractSetup,
  sidecarJson,
  type FieldKind,
  type SignField,
  type Signer,
} from "@/lib/esign";
import { saveBytesWithResult, saveTextSidecar } from "@/lib/file-export";
import { openDocument, renderPage } from "@/lib/pdf-runtime";

type Doc = {
  name: string;
  base: string;
  bytes: ArrayBuffer;
  proxy: PDFDocumentProxy;
  pageCount: number;
};

type Mode = "prepare" | "sign";
type CaptureTarget =
  { kind: "signature" | "initials"; fieldId: string } | { kind: "date" | "text"; fieldId: string };

const CANVAS_WIDTH = 720;
const MVP_TOOLS: FieldKind[] = ["signature", "date"];

function signerColor(index: number): string {
  return SIGNER_COLORS[index % SIGNER_COLORS.length] ?? "#9a4a24";
}

export function EsignWorkbench() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<Mode>("prepare");
  const [tool, setTool] = useState<FieldKind>("signature");
  const [signers, setSigners] = useState<Signer[]>(() => [createSigner({ index: 1 })]);
  const [fields, setFields] = useState<SignField[]>([]);
  const [activeSignerId, setActiveSignerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const holderRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: SignField;
  } | null>(null);

  const activeSigner = signers.find((signer) => signer.id === activeSignerId) ?? signers[0];
  const selected = fields.find((field) => field.id === selectedId);

  const loadBytes = useCallback(
    async (
      name: string,
      bytes: ArrayBuffer,
      preset?: { signers: Signer[]; fields: SignField[] },
    ) => {
      setError(null);
      setStatus("Opening the file in this tab");
      try {
        const proxy = await openDocument(bytes);
        setDoc({
          name,
          base: name.replace(/\.pdf$/i, ""),
          bytes,
          proxy,
          pageCount: proxy.numPages,
        });
        const nextSigners = preset?.signers ?? [createSigner({ index: 1 })];
        setSigners(nextSigners);
        setFields(preset?.fields ?? []);
        setActiveSignerId(nextSigners[0]?.id ?? null);
        setSelectedId(null);
        setPage(1);
        setMode(preset ? "sign" : "prepare");
      } catch {
        setDoc(null);
        setError(
          "This PDF could not be opened here. Password-protected files and badly damaged files are the usual reasons.",
        );
      } finally {
        setStatus(null);
      }
    },
    [],
  );

  useEffect(() => {
    const api = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
    if (!api) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const pending = await api.takePendingPdf();
        if (!pending || cancelled) return;
        const bytes = toDesktopBytes(pending.data);
        await loadBytes(pending.name, bytes.slice().buffer as ArrayBuffer);
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

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setStatus("Rendering page " + page);
    void (async () => {
      try {
        const { canvas, viewport } = await renderPage(doc.proxy, page, CANVAS_WIDTH);
        if (cancelled) return;
        const holder = holderRef.current;
        if (holder) {
          holder.replaceChildren(canvas);
          canvas.className = "block h-auto w-full rounded-sm";
        }
        setScale(viewport.scale);
        setViewSize({ width: viewport.width, height: viewport.height });
      } catch {
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
    if (!activeSignerId || signers.some((signer) => signer.id === activeSignerId)) return;
    setActiveSignerId(signers[0]?.id ?? null);
  }, [activeSignerId, signers]);

  const placeField = (clientX: number, clientY: number, target: HTMLElement) => {
    if (!doc || !activeSigner || mode !== "prepare") return;
    const rect = target.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const defaults = FIELD_DEFAULTS[tool];
    const pdfX = clickX / scale - defaults.width / 2;
    const pdfY = (viewSize.height - clickY) / scale - defaults.height / 2;
    const field: SignField = {
      id: newId("field"),
      kind: tool,
      page,
      x: Math.max(8, pdfX),
      y: Math.max(8, pdfY),
      width: defaults.width,
      height: defaults.height,
      signerId: activeSigner.id,
      required: true,
    };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
  };

  const onPagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "prepare") return;
    if ((event.target as HTMLElement).closest("[data-esign-field]")) return;
    placeField(event.clientX, event.clientY, event.currentTarget);
  };

  const startDrag = (event: React.PointerEvent, field: SignField, dragMode: "move" | "resize") => {
    if (mode !== "prepare" || isFieldFilled(field)) return;
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(field.id);
    dragRef.current = {
      id: field.id,
      mode: dragMode,
      startX: event.clientX,
      startY: event.clientY,
      orig: field,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== drag.id) return field;
        if (drag.mode === "resize") {
          return {
            ...field,
            width: Math.max(28, drag.orig.width + dx),
            height: Math.max(18, drag.orig.height - dy),
          };
        }
        return {
          ...field,
          x: drag.orig.x + dx,
          y: drag.orig.y - dy,
        };
      }),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const openField = (field: SignField) => {
    setSelectedId(field.id);
    if (mode !== "sign" || isFieldFilled(field)) return;
    if (field.kind === "date") {
      setTextDraft(formatSignedDate());
      setCapture({ kind: "date", fieldId: field.id });
      return;
    }
    if (field.kind === "signature" || field.kind === "initials") {
      setCapture({ kind: field.kind, fieldId: field.id });
    }
  };

  const lockField = (fieldId: string, value: SignField["value"]) => {
    const signedAt = new Date().toISOString();
    setFields((prev) =>
      prev.map((field) => (field.id === fieldId && value ? { ...field, value, signedAt } : field)),
    );
    setCapture(null);
    setError(null);
  };

  const exportSigned = async () => {
    if (!doc) return;
    if (!fields.some(isFieldFilled)) {
      setError("Sign at least one field before exporting.");
      return;
    }
    setStatus("Writing marks and the audit record");
    try {
      const exported = await buildSignedExport({
        sourceBytes: doc.bytes,
        sourceFileName: doc.name,
        signers,
        fields,
      });
      const outcome = await saveBytesWithResult(exported.pdf, `${doc.base}-signed.pdf`);
      if (!outcome.saved) return;
      const sidecarWritten = await saveTextSidecar({
        outcome,
        extension: ".esign.json",
        downloadName: `${doc.base}-signed.esign.json`,
        text: sidecarJson(exported.sidecar),
      });
      if (!sidecarWritten) {
        setError(
          "The signed PDF was saved. The matching .esign.json audit record could not be written, so there is nothing to check the file against — export again to get one.",
        );
      }
    } catch {
      setError("The export failed. Nothing was changed on your original file.");
    } finally {
      setStatus(null);
    }
  };

  const openSample = async () => {
    setStatus("Building the sample agreement");
    const bytes = await buildSampleContractPdf();
    await loadBytes(
      "workshop-agreement-sample.pdf",
      bytes.slice().buffer as ArrayBuffer,
      sampleContractSetup(),
    );
  };

  const pageFields = fields.filter((field) => field.page === page);
  const filledCount = fields.filter(isFieldFilled).length;
  const captureField = capture ? fields.find((field) => field.id === capture.fieldId) : undefined;
  const captureSigner = captureField
    ? signers.find((signer) => signer.id === captureField.signerId)
    : undefined;

  const overlay = useMemo(
    () =>
      pageFields.map((field) => {
        const signerIndex = Math.max(
          0,
          signers.findIndex((signer) => signer.id === field.signerId),
        );
        const color = signerColor(signerIndex);
        const left = field.x * scale;
        const top = viewSize.height - (field.y + field.height) * scale;
        const filled = isFieldFilled(field);
        const selectedField = selectedId === field.id;
        return (
          <div
            key={field.id}
            data-esign-field={field.id}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => {
              if (mode === "prepare" && !filled) startDrag(event, field, "move");
              else event.stopPropagation();
            }}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onClick={(event) => {
              event.stopPropagation();
              openField(field);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openField(field);
              }
            }}
            style={{
              left: `${(left / viewSize.width) * 100}%`,
              top: `${(top / viewSize.height) * 100}%`,
              width: `${(Math.max(field.width * scale, 16) / viewSize.width) * 100}%`,
              height: `${(Math.max(field.height * scale, 16) / viewSize.height) * 100}%`,
              borderColor: color,
              backgroundColor: filled ? `${color}22` : `${color}14`,
            }}
            className={[
              "absolute overflow-hidden rounded-[3px] border-2 text-left",
              selectedField ? "ring-2 ring-primary ring-offset-1" : "",
              filled ? "cursor-default" : mode === "prepare" ? "cursor-move" : "cursor-pointer",
            ].join(" ")}
          >
            {filled &&
            field.value &&
            (field.value.kind === "signature" || field.value.kind === "initials") ? (
              <img src={field.value.pngDataUrl} alt="" className="h-full w-full object-contain" />
            ) : filled &&
              field.value &&
              (field.value.kind === "date" || field.value.kind === "text") ? (
              <span className="block px-1 text-[11px] leading-6">{field.value.text}</span>
            ) : (
              <span
                className="block px-1 text-[10px] font-medium uppercase tracking-wide"
                style={{ color }}
              >
                {fieldLabel(field.kind)}
                {filled ? " · locked" : ""}
              </span>
            )}
            {mode === "prepare" && !filled && (
              <button
                type="button"
                aria-label="Resize field"
                className="absolute bottom-0 right-0 size-3 cursor-se-resize bg-primary"
                onPointerDown={(event) => startDrag(event, field, "resize")}
              />
            )}
          </div>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageFields, signers, scale, viewSize, selectedId, mode, fields],
  );

  return (
    <div>
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="size-4" />
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!doc ? (
        status ? (
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
              title="Drop a contract PDF to sign"
              hint="Stays in this browser. Place a signature and date, then export a signed copy with an audit page."
            >
              <Button variant="outline" onClick={() => void openSample()}>
                <PenLine /> Load sample agreement
              </Button>
            </PdfDropZone>
            <div className="bench-panel mt-5 p-4 text-sm text-muted-foreground">
              E-Sign is for documents you already have authority to sign. Single signer for this
              MVP. It is not DocuSign and not a PKI certificate — the audit page records who, when,
              and a SHA-256 of the file bytes.
            </div>
          </>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="bench-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="truncate text-sm font-medium">{doc.name}</p>
              <div className="flex items-center gap-2">
                <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
                  <TabsList>
                    <TabsTrigger value="prepare">Prepare</TabsTrigger>
                    <TabsTrigger value="sign">Sign</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={page <= 1 || !!status}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
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
                    onClick={() => setPage((value) => Math.min(doc.pageCount, value + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            {mode === "prepare" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {MVP_TOOLS.map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={tool === kind ? "default" : "secondary"}
                    onClick={() => setTool(kind)}
                  >
                    {kind === "date" ? <CalendarDays /> : <PenLine />}
                    {fieldLabel(kind)}
                  </Button>
                ))}
                <p className="w-full text-xs text-muted-foreground">
                  Click the page to place a {fieldLabel(tool).toLowerCase()}. Drag to move; corner
                  to resize.
                </p>
              </div>
            )}

            <div className="mt-4 rounded-md bg-paper p-2 sm:p-3">
              <div className="relative mx-auto w-full">
                <div ref={holderRef} className="w-full" />
                {status ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-paper/70 text-sm text-paper-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> {status}…
                  </div>
                ) : (
                  <div className="absolute inset-0" onPointerDown={onPagePointerDown}>
                    {overlay}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {filledCount}/{fields.length} fields filled. Signed marks lock in this session; export
              burns them into the page content and appends a certificate page.
            </p>
          </div>

          <aside className="bench-panel flex flex-col p-4 sm:p-5">
            <p className="eyebrow">Signer</p>
            <Label htmlFor="signer-name" className="mt-3">
              Name
            </Label>
            <Input
              id="signer-name"
              className="mt-1"
              value={activeSigner?.name ?? ""}
              onChange={(event) =>
                setSigners((prev) =>
                  prev.map((item, index) =>
                    index === 0 ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
              placeholder="Your name"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Single-signer MVP. Draw or type a mark, stamp the date, export. Multi-signer routing
              is deferred.
            </p>

            <Separator className="my-5" />

            {selected ? (
              <div>
                <p className="eyebrow">Selected field</p>
                <p className="mt-2 text-sm">
                  {fieldLabel(selected.kind)} on page {selected.page}
                  {isFieldFilled(selected) ? " · locked" : ""}
                </p>
                {!isFieldFilled(selected) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setFields((prev) => prev.filter((field) => field.id !== selected.id));
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" /> Delete field
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {mode === "prepare"
                  ? "Choose Signature or Date, then click the page."
                  : "Click a field to fill it."}
              </p>
            )}

            <Separator className="my-5" />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void exportSigned()}
                disabled={!!status || filledCount === 0}
              >
                <Download className="size-3.5" /> Export signed PDF
              </Button>
              <Badge variant="secondary">{filledCount} filled</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Export appends an audit page with the signer, timestamp, and SHA-256 of the file
              bytes.
            </p>
          </aside>
        </div>
      )}

      {capture && (capture.kind === "signature" || capture.kind === "initials") && (
        <SignatureCapture
          open
          kind={capture.kind}
          signerName={captureSigner?.name ?? ""}
          onClose={() => setCapture(null)}
          onApply={(pngDataUrl, method) =>
            lockField(capture.fieldId, { kind: capture.kind, pngDataUrl, method })
          }
        />
      )}

      <Dialog
        open={Boolean(capture && (capture.kind === "date" || capture.kind === "text"))}
        onOpenChange={(open) => !open && setCapture(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{capture?.kind === "date" ? "Date" : "Text"}</DialogTitle>
          </DialogHeader>
          <Input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCapture(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!capture || (capture.kind !== "date" && capture.kind !== "text")) return;
                if (!textDraft.trim()) return;
                lockField(capture.fieldId, { kind: capture.kind, text: textDraft.trim() });
              }}
            >
              Lock field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
