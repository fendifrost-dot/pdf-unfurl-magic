import { Crop, ImagePlus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { ImageAdjustments } from "@/lib/image-process";
import type { PdfImageRegion } from "@/lib/pdf-images";

type Props = {
  region: PdfImageRegion | null;
  imageCount: number;
  draft: ImageAdjustments;
  previewUrl: string | null;
  previewBusy: boolean;
  sourceLabel: string;
  onChange: (next: ImageAdjustments) => void;
  onReplace: (file: File) => void;
  onCommit: () => void;
  onReset: () => void;
};

function CropField({
  id,
  label,
  value,
  onValue,
}: {
  id: string;
  label: string;
  value: number;
  onValue: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-gauge text-xs text-muted-foreground">{Math.round(value * 100)}%</span>
      </div>
      <Slider
        id={id}
        min={0}
        max={0.4}
        step={0.01}
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
            ? "No embedded photos on this page."
            : "Click one photo on this page. Replace it or crop it, then export."}
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="eyebrow">Image studio</p>
      <p className="text-gauge mt-2 text-xs text-muted-foreground">
        page {region.page} · {Math.round(region.width)}×{Math.round(region.height)}pt
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

      <Button variant="secondary" size="sm" className="mt-4 w-full" asChild>
        <label className="cursor-pointer">
          <ImagePlus className="size-3.5" /> Replace image
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

      <p className="mt-5 flex items-center gap-1.5 text-xs font-medium">
        <Crop className="size-3.5" /> Crop
      </p>
      <div className="mt-2 space-y-3">
        <CropField
          id="crop-top"
          label="Top"
          value={draft.cropTop}
          onValue={(n) => onChange({ ...draft, cropTop: n })}
        />
        <CropField
          id="crop-bottom"
          label="Bottom"
          value={draft.cropBottom}
          onValue={(n) => onChange({ ...draft, cropBottom: n })}
        />
        <CropField
          id="crop-left"
          label="Left"
          value={draft.cropLeft}
          onValue={(n) => onChange({ ...draft, cropLeft: n })}
        />
        <CropField
          id="crop-right"
          label="Right"
          value={draft.cropRight}
          onValue={(n) => onChange({ ...draft, cropRight: n })}
        />
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" className="flex-1" onClick={onCommit} disabled={previewBusy}>
          Keep this change
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} aria-label="Reset image edits">
          <Undo2 className="size-3.5" />
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Export writes this one photo back into its slot. Surrounding text and lines stay as PDF
        objects.
      </p>
    </>
  );
}
