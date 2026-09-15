import { Loader2, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ENHANCE_PRESETS, type EnhancePreset } from "@/lib/scan";
import type { PageScanReport, ScanPageSession } from "@/lib/pdf-scan-edit";
import type { TextLine } from "@/lib/pdf-runtime";

export function ScanAwarePanel({
  report,
  session,
  busy,
  selectedId,
  editedIds,
  onPreset,
  onReplaceToggle,
  onEnhanceAndOcr,
  onSelectLine,
}: {
  report: PageScanReport;
  session: ScanPageSession;
  busy: string | null;
  selectedId: string | null;
  editedIds: string[];
  onPreset: (preset: EnhancePreset) => void;
  onReplaceToggle: (value: boolean) => void;
  onEnhanceAndOcr: () => void;
  onSelectLine: (line: TextLine) => void;
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
        <div>
          <p className="text-xs leading-relaxed text-success">
            {ocrCount} OCR line{ocrCount === 1 ? "" : "s"} ready. Click a line here or a box on the
            page. Export writes a text layer on the page image, not a white-out.
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {session.ocrLines.map((line) => (
              <li key={line.id}>
                <button
                  type="button"
                  className={[
                    "w-full truncate rounded-md border px-2 py-1.5 text-left text-xs",
                    selectedId === line.id
                      ? "border-primary bg-primary/15"
                      : editedIds.includes(line.id)
                        ? "border-success/60 bg-success/10"
                        : "border-border/70 hover:border-primary/50",
                  ].join(" ")}
                  onClick={() => onSelectLine(line)}
                >
                  {line.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ghost text from the file is not rewritten in place — that is the Helvetica / Unsafe
          refusal you would see otherwise.
        </p>
      )}
    </div>
  );
}
