import { ChevronDown, Loader2, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ENHANCE_PRESETS, type EnhancePreset } from "@/lib/scan";
import {
  ENHANCE_TRIGGER_LABEL,
  enhanceEntryCopy,
  shouldAutoExpandEnhance,
} from "@/lib/enhance-entry";
import type { PageScanReport, ScanPageSession } from "@/lib/pdf-scan-edit";
import type { TextLine } from "@/lib/pdf-runtime";

export function ScanAwarePanel({
  report,
  session,
  busy,
  selectedId,
  editedIds,
  open,
  onOpenChange,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreset: (preset: EnhancePreset) => void;
  onReplaceToggle: (value: boolean) => void;
  onEnhanceAndOcr: () => void;
  onSelectLine: (line: TextLine) => void;
}) {
  const ocrCount = session.ocrLines.length;
  const emphasized = shouldAutoExpandEnhance({
    looksScanned: report.looksScanned,
    ocrLineCount: ocrCount,
  });
  const copy = enhanceEntryCopy(emphasized);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        id="enhance-page-panel"
        data-testid="enhance-panel"
        data-emphasized={emphasized ? "true" : "false"}
        className={
          emphasized
            ? "rounded-md border border-warning/40 bg-warning/5"
            : "rounded-md border border-border/70 bg-muted/40"
        }
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid="enhance-trigger"
            data-enhance-focus
            aria-expanded={open}
            className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{ENHANCE_TRIGGER_LABEL}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {emphasized
                  ? "This page looks scanned — enhance and OCR before rewriting type."
                  : "Optional. Scan, blurry, or text picking is wrong."}
              </span>
            </span>
            <ChevronDown
              className={[
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                open ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 border-t border-border/60 px-3 py-3">
            {emphasized ? (
              <Alert>
                <ScanLine className="size-4" />
                <AlertTitle>{copy.title}</AlertTitle>
                <AlertDescription>{report.message || copy.body}</AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
            )}

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
                  Off keeps the original page picture underneath. On writes the enhanced bitmap as
                  the page image, still with an OCR text layer rather than a white-out.
                </p>
              </div>
            </div>

            <Button
              type="button"
              className="w-full min-h-11"
              onClick={onEnhanceAndOcr}
              disabled={!!busy}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {busy ?? "Enhance page & OCR"}
            </Button>

            {ocrCount > 0 ? (
              <div>
                <p className="text-xs leading-relaxed text-success">
                  {ocrCount} OCR line{ocrCount === 1 ? "" : "s"} ready. Click a line here or a box
                  on the page. Export writes a text layer on the page image, not a white-out.
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
                {emphasized
                  ? "Ghost text from the file is not rewritten in place — that is the Helvetica / Unsafe refusal you would see otherwise."
                  : "Native text stays click-to-edit. Enhance does not run until you press the button."}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
