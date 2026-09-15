import { Loader2, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ENHANCE_PRESETS, type EnhancePreset } from "@/lib/scan";
import type { PageScanReport, ScanPageSession } from "@/lib/pdf-scan-edit";

export function ScanAwarePanel({
  report,
  session,
  busy,
  onPreset,
  onReplaceToggle,
  onEnhanceAndOcr,
}: {
  report: PageScanReport;
  session: ScanPageSession;
  busy: string | null;
  onPreset: (preset: EnhancePreset) => void;
  onReplaceToggle: (value: boolean) => void;
  onEnhanceAndOcr: () => void;
}) {
  const ocrCount = session.ocrLines.length;
  return (
    <div className="space-y-4">
      <Alert>
        <ScanLine className="size-4" />
        <AlertTitle>This page looks scanned</AlertTitle>
        <AlertDescription>{report.message}</AlertDescription>
      </Alert>

      <div>
        <p className="eyebrow">Enhance page</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One page at a time: upscale if the bitmap is small, then denoise / contrast. OCR stays on
          this machine. The original page image is kept unless you replace it with the cleaned
          picture.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ENHANCE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={session.preset === preset.id ? "default" : "secondary"}
            onClick={() => onPreset(preset.id)}
            disabled={!!busy}
            title={preset.hint}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {session.enhancedPreviewUrl && (
        <img
          src={session.enhancedPreviewUrl}
          alt="Enhanced page preview"
          className="max-h-36 w-full rounded-md border border-border/70 object-contain bg-paper"
        />
      )}

      <div className="flex items-start gap-3">
        <Switch
          id="scan-replace-cleaned"
          checked={session.replaceWithCleaned}
          onCheckedChange={(value) => onReplaceToggle(value === true)}
          disabled={!session.enhancedJpeg || !!busy}
        />
        <div>
          <Label htmlFor="scan-replace-cleaned" className="text-sm font-semibold">
            Replace with cleaned image
          </Label>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Off keeps the original page picture underneath. On writes the enhanced bitmap as the
            page image, still with an OCR text layer rather than a white-out.
          </p>
        </div>
      </div>

      <Button type="button" className="w-full min-h-11" onClick={onEnhanceAndOcr} disabled={!!busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {busy ?? "Enhance page & OCR"}
      </Button>

      {ocrCount > 0 ? (
        <p className="text-xs leading-relaxed text-success">
          {ocrCount} OCR line{ocrCount === 1 ? "" : "s"} ready. Click a box to edit; export writes
          those lines as a text layer on the page image.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ghost text from the file is not rewritten in place — that is the Helvetica / Unsafe
          refusal you would see otherwise.
        </p>
      )}
    </div>
  );
}
