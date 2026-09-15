/**
 * Draw-to-sign uses `signature_pad` (MIT) for velocity-weighted ink and high-DPI
 * canvases. Type-to-sign and upload still emit the same PNG + MarkMethod that
 * `src/lib/esign.ts` burns into the page and audit record.
 * See docs/PRIOR_ART.md #3.
 */
import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Eraser, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renderTypedMark, type MarkMethod } from "@/lib/esign";

type Props = {
  open: boolean;
  kind: "signature" | "initials";
  signerName: string;
  onClose: () => void;
  onApply: (pngDataUrl: string, method: MarkMethod) => void;
};

function fitSignatureCanvas(canvas: HTMLCanvasElement, pad: SignaturePad): void {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const cssWidth = canvas.offsetWidth;
  const cssHeight = canvas.offsetHeight;
  if (cssWidth < 2 || cssHeight < 2) return;

  const nextWidth = Math.max(1, Math.round(cssWidth * ratio));
  const nextHeight = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.getContext("2d")?.scale(ratio, ratio);
  pad.redraw();
}

export function SignatureCapture({ open, kind, signerName, onClose, onApply }: Props) {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [typed, setTyped] = useState(signerName);
  const [upload, setUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped(signerName);
    setUpload(null);
    setError(null);
    setTab("draw");
  }, [open, signerName]);

  useEffect(() => {
    if (!open || tab !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePad(canvas, {
      penColor: "#1b1814",
      backgroundColor: "rgba(0,0,0,0)",
      minWidth: kind === "initials" ? 0.8 : 0.55,
      maxWidth: kind === "initials" ? 3.4 : 2.6,
      minDistance: 3,
      throttle: 16,
    });
    padRef.current = pad;

    const fit = () => fitSignatureCanvas(canvas, pad);
    fit();
    const frame = requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    window.addEventListener("resize", fit);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", fit);
      pad.off();
      if (padRef.current === pad) padRef.current = null;
    };
  }, [open, tab, kind]);

  const apply = () => {
    setError(null);
    try {
      if (tab === "draw") {
        const pad = padRef.current;
        if (!pad || pad.isEmpty()) {
          setError("Draw a mark first.");
          return;
        }
        onApply(pad.toDataURL("image/png"), "draw");
        return;
      }
      if (tab === "type") {
        onApply(renderTypedMark(typed, kind), "type");
        return;
      }
      if (!upload) {
        setError("Choose a PNG or JPEG of the mark.");
        return;
      }
      onApply(upload, "upload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That mark could not be used.");
    }
  };

  const title = kind === "initials" ? "Initials" : "Signature";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add your {title.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Draw or type a mark. It stays on this device and is burned into the PDF on export — not
            sent to a signing service.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="draw">Draw</TabsTrigger>
            <TabsTrigger value="type">Type</TabsTrigger>
          </TabsList>

          <TabsContent value="draw" className="mt-4">
            <canvas
              ref={canvasRef}
              className={
                kind === "initials"
                  ? "h-36 w-full cursor-crosshair touch-none select-none rounded-md border border-border bg-paper"
                  : "h-44 w-full cursor-crosshair touch-none select-none rounded-md border border-border bg-paper sm:h-[168px]"
              }
              aria-label={kind === "initials" ? "Draw your initials" : "Draw your signature"}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Draw with a mouse, trackpad, or finger. The pad ignores page scroll while you ink.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => {
                padRef.current?.clear();
              }}
            >
              <Eraser className="size-3.5" /> Clear
            </Button>
          </TabsContent>

          <TabsContent value="type" className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="typed-mark">
                {kind === "initials" ? "Initials" : "Name to sign"}
              </Label>
              <Input
                id="typed-mark"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={kind === "initials" ? "A.R." : "Alex Rivera"}
              />
            </div>
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-paper">
              <p
                className="font-display text-4xl text-foreground"
                style={{ fontFamily: "Caveat, cursive" }}
              >
                {typed.trim() || " "}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="mt-4 space-y-3">
            <Label htmlFor="mark-file">PNG or JPEG</Label>
            <Input
              id="mark-file"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") setUpload(reader.result);
                };
                reader.readAsDataURL(file);
              }}
            />
            {upload ? (
              <img
                src={upload}
                alt="Uploaded mark preview"
                className="mx-auto max-h-28 object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Upload className="mr-1 inline size-3.5" />A transparent PNG looks best on the page.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={apply}>
            Use this {title.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
