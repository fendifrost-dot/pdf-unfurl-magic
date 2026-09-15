import { Contrast, Crop, ImagePlus, RotateCcw, RotateCw, SunMedium, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { formatBytes } from "@/lib/pdf-runtime";
import { nextRotate, type ImageAdjustments } from "@/lib/image-process";
import type { PdfImageRegion } from "@/lib/pdf-images";

type Props = {
  region: PdfImageRegion | null;
  imageCount: number;
  draft: ImageAdjustments;
  previewUrl: string | null;
  previewBusy: boolean;
  outputBytes: number | null;
  sourceLabel: string;
  onChange: (next: ImageAdjustments) => void;
  onReplace: (file: File) => void;
  onCommit: () => void;
  onReset: () => void;
};

function Field({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onValue,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onValue: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-gauge text-xs text-muted-foreground">{display}</span>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onValue(v[0] ?? value)}
      />
    </div>
  );
}

export function ImageStudioPanel({
  region,
  imageCount,
  draft,
  previewUrl,
  previewBusy,
  outputBytes,
  sourceLabel,
  onChange,
  onReplace,
  onCommit,
  onReset,
}: Props) {
  if (!region) {
    return (
      <div className="py-8 text-center">
        <p className="font-display text-base font-semibold">Image studio</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {imageCount === 0
            ? "No embedded photos on this page. Switch page, or load the workshop notes sample."
            : `${imageCount} photo${imageCount === 1 ? "" : "s"} on this page. Click one — only that image is decoded.`}
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="eyebrow">Image studio</p>
      <p className="text-gauge mt-2 text-xs text-muted-foreground">
        page {region.page} · {Math.round(region.width)}×{Math.round(region.height)}pt
        {region.pixelWidth ? ` · ${region.pixelWidth}×${region.pixelHeight}px` : ""}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sourceLabel}</p>

      <div className="mt-3 overflow-hidden rounded-md border border-border bg-paper">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Selected PDF image preview"
            className="mx-auto max-h-48 w-full object-contain"
          />
        ) : (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {previewBusy ? "Decoding this photo…" : "No preview"}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" asChild>
          <label className="cursor-pointer">
            <ImagePlus className="size-3.5" /> Replace
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onReplace(file);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Rotate left"
            onClick={() => onChange({ ...draft, rotate: nextRotate(draft.rotate, -1) })}
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Rotate right"
            onClick={() => onChange({ ...draft, rotate: nextRotate(draft.rotate, 1) })}
          >
            <RotateCw className="size-3.5" />
          </Button>
        </div>
      </div>

      <p className="mt-5 flex items-center gap-1.5 text-xs font-medium">
        <Crop className="size-3.5" /> Crop
      </p>
      <div className="mt-2 space-y-3">
        <Field
          id="crop-top"
          label="Top"
          value={draft.cropTop}
          min={0}
          max={0.4}
          step={0.01}
          display={`${Math.round(draft.cropTop * 100)}%`}
          onValue={(n) => onChange({ ...draft, cropTop: n })}
        />
        <Field
          id="crop-bottom"
          label="Bottom"
          value={draft.cropBottom}
          min={0}
          max={0.4}
          step={0.01}
          display={`${Math.round(draft.cropBottom * 100)}%`}
          onValue={(n) => onChange({ ...draft, cropBottom: n })}
        />
        <Field
          id="crop-left"
          label="Left"
          value={draft.cropLeft}
          min={0}
          max={0.4}
          step={0.01}
          display={`${Math.round(draft.cropLeft * 100)}%`}
          onValue={(n) => onChange({ ...draft, cropLeft: n })}
        />
        <Field
          id="crop-right"
          label="Right"
          value={draft.cropRight}
          min={0}
          max={0.4}
          step={0.01}
          display={`${Math.round(draft.cropRight * 100)}%`}
          onValue={(n) => onChange({ ...draft, cropRight: n })}
        />
      </div>

      <p className="mt-5 flex items-center gap-1.5 text-xs font-medium">
        <SunMedium className="size-3.5" /> Exposure
      </p>
      <div className="mt-2">
        <Field
          id="exposure"
          label="Lift / pull"
          value={draft.exposure}
          min={-0.8}
          max={0.8}
          step={0.05}
          display={draft.exposure.toFixed(2)}
          onValue={(n) => onChange({ ...draft, exposure: n })}
        />
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs font-medium">
        <Contrast className="size-3.5" /> Contrast
      </p>
      <div className="mt-2">
        <Field
          id="contrast"
          label="Punch"
          value={draft.contrast}
          min={-0.7}
          max={0.7}
          step={0.05}
          display={draft.contrast.toFixed(2)}
          onValue={(n) => onChange({ ...draft, contrast: n })}
        />
      </div>

      <p className="mt-5 text-xs font-medium">Compress</p>
      <div className="mt-2">
        <Field
          id="quality"
          label="JPEG quality"
          value={draft.quality}
          min={0.35}
          max={0.92}
          step={0.01}
          display={`${Math.round(draft.quality * 100)}%`}
          onValue={(n) => onChange({ ...draft, quality: n })}
        />
      </div>
      {outputBytes !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last kept version: {formatBytes(outputBytes)}. The rest of the page is not re-encoded.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" className="flex-1" onClick={onCommit} disabled={previewBusy}>
          Keep this change
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} aria-label="Reset image edits">
          <Undo2 className="size-3.5" />
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Export writes this photo back into its original slot. Text, rules, and photos you did not
        select stay as they were.
      </p>
    </>
  );
}
