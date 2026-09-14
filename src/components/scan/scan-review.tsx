import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENHANCE_PRESETS, processPreview, type EnhancePreset } from "@/lib/scan";
import { canvasFromImageData, imageDataToJpeg } from "@/lib/scan/image";
import type { Point, Quad } from "@/lib/scan";

type Props = {
  original: ImageData;
  sourceName: string;
  initialQuad: Quad;
  onCancel: () => void;
  onConfirm: (processed: ImageData, preset: EnhancePreset) => void;
};

export function ScanReview({ original, sourceName, initialQuad, onCancel, onConfirm }: Props) {
  const [quad, setQuad] = useState<Quad>(initialQuad);
  const [preset, setPreset] = useState<EnhancePreset>("color");
  const [turns, setTurns] = useState(0);
  const [adjust, setAdjust] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    if (adjust) return;
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      try {
        const processed = processPreview(original, quad, preset, turns);
        void imageDataToJpeg(processed, 0.78).then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          if (previewRef.current) URL.revokeObjectURL(previewRef.current);
          previewRef.current = url;
          setPreviewUrl(url);
          setBusy(false);
        });
      } catch {
        if (!cancelled) setBusy(false);
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [original, quad, preset, turns, adjust]);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const originalUrl = useMemo(() => {
    const canvas = canvasFromImageData(original);
    return canvas.toDataURL("image/jpeg", 0.72);
  }, [original]);

  const confirm = () => {
    const processed = processPreview(original, quad, preset, turns);
    onConfirm(processed, preset);
  };

  return (
    <div className="bench-panel p-3 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Review one page</p>
          <p className="mt-1 text-sm text-muted-foreground">{sourceName}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdjust((v) => !v)}>
          {adjust ? "Hide corners" : "Adjust edges"}
        </Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-md bg-paper p-2">
        {adjust ? (
          <QuadEditor
            src={originalUrl}
            quad={quad}
            width={original.width}
            height={original.height}
            onChange={setQuad}
          />
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt="Corrected page preview"
            className="mx-auto max-h-[68vh] w-auto max-w-full"
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Correcting page…
          </div>
        )}
      </div>
      {busy && <p className="mt-2 text-xs text-muted-foreground">Updating the page…</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {ENHANCE_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreset(item.id)}
            className={[
              "rounded-md border px-3 py-2 text-left",
              preset === item.id ? "border-primary bg-primary/10" : "border-border bg-card",
            ].join(" ")}
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setTurns((t) => t + 1)}>
            <RotateCw /> Rotate
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            <Trash2 /> Discard
          </Button>
        </div>
        <Button type="button" onClick={confirm}>
          <Check /> Add page
        </Button>
      </div>
    </div>
  );
}

function QuadEditor({
  src,
  quad,
  width,
  height,
  onChange,
}: {
  src: string;
  quad: Quad;
  width: number;
  height: number;
  onChange: (quad: Quad) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  const toImage = (event: ReactPointerEvent): Point => {
    const box = boxRef.current;
    if (!box) return quad[0];
    const rect = box.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  return (
    <div ref={boxRef} className="relative mx-auto max-w-full touch-none">
      <img
        src={src}
        alt="Original capture with document corners"
        className="block max-h-[68vh] w-auto max-w-full"
      />
      <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
        <polygon
          points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="rgba(140,59,30,0.14)"
          stroke="#c26a3a"
          strokeWidth={Math.max(width, height) * 0.004}
        />
        {quad.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={Math.max(width, height) * 0.018}
            fill="#fff8ee"
            stroke="#8c3b1e"
            strokeWidth={Math.max(width, height) * 0.004}
            className="cursor-grab"
            onPointerDown={(event) => {
              event.preventDefault();
              drag.current = index;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current === null) return;
              const next: Quad = [quad[0], quad[1], quad[2], quad[3]];
              next[drag.current] = toImage(event);
              onChange(next);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        ))}
      </svg>
    </div>
  );
}
