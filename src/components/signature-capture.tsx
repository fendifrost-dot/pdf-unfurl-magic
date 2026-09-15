import { useEffect, useRef, useState } from "react";
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

export function SignatureCapture({ open, kind, signerName, onClose, onApply }: Props) {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [typed, setTyped] = useState(signerName);
  const [upload, setUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTyped(signerName);
    setUpload(null);
    setError(null);
    setTab("draw");
    dirty.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [open, signerName]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const stroke = (event: React.PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = point(event);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1814";
    ctx.lineWidth = kind === "initials" ? 5 : 4;
    if (start) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    dirty.current = true;
  };

  const apply = () => {
    setError(null);
    try {
      if (tab === "draw") {
        const canvas = canvasRef.current;
        if (!canvas || !dirty.current) {
          setError("Draw a mark first.");
          return;
        }
        onApply(canvas.toDataURL("image/png"), "draw");
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
              width={kind === "initials" ? 360 : 520}
              height={kind === "initials" ? 180 : 168}
              className="w-full cursor-crosshair rounded-md border border-border bg-paper touch-none"
              onPointerDown={(event) => {
                drawing.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                stroke(event, true);
              }}
              onPointerMove={(event) => {
                if (drawing.current) stroke(event, false);
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext("2d");
                if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                dirty.current = false;
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
