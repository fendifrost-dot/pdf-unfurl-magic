import { useState } from "react";
import { Check, Eraser, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ocrVerifyNextStep,
  pendingOcrSnippets,
  type OcrUncertainSnippet,
  type OcrVerifyDecision,
} from "@/lib/ocr-verify";

export function OcrVerifyPanel({
  snippets,
  ocrLineCount,
  busy,
  onDecide,
  onEnhanceAgain,
}: {
  snippets: OcrUncertainSnippet[];
  ocrLineCount: number;
  busy: string | null;
  onDecide: (snippetId: string, decision: OcrVerifyDecision) => void;
  onEnhanceAgain: () => void;
}) {
  const pending = pendingOcrSnippets(snippets);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (ocrLineCount === 0) return null;

  return (
    <div className="space-y-3" data-testid="ocr-verify-panel">
      <Alert>
        <ScanLine className="size-4" />
        <AlertTitle>Verify uncertain OCR</AlertTitle>
        <AlertDescription>{ocrVerifyNextStep(pending.length, ocrLineCount)}</AlertDescription>
      </Alert>

      {pending.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          No low-confidence glyphs left on this page. You can edit and Apply.
        </p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {pending.map((snippet) => {
            const draft = drafts[snippet.id] ?? snippet.text;
            return (
              <li
                key={snippet.id}
                className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2"
                data-testid="ocr-verify-snippet"
              >
                <p className="text-xs text-muted-foreground">
                  {Math.round(snippet.confidence)}% confidence
                </p>
                <Input
                  value={draft}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [snippet.id]: event.target.value }))
                  }
                  aria-label={`Correct OCR snippet ${snippet.text}`}
                  className="h-9 font-mono text-sm"
                />
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="ocr-verify-accept"
                    onClick={() => onDecide(snippet.id, { status: "accepted" })}
                  >
                    <Check className="size-3.5" /> Accept
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    data-testid="ocr-verify-correct"
                    disabled={!draft.trim()}
                    onClick={() =>
                      onDecide(snippet.id, { status: "corrected", text: draft.trim() })
                    }
                  >
                    Correct
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="ocr-verify-skip"
                    onClick={() => onDecide(snippet.id, { status: "skipped" })}
                  >
                    <Eraser className="size-3.5" /> Skip
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full min-h-11"
        data-testid="ocr-verify-enhance-again"
        disabled={!!busy}
        onClick={onEnhanceAgain}
      >
        <Sparkles className="size-3.5" /> Enhance again with a different preset
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Local Tesseract only. Optional later AI assist can suggest corrections here — no cloud key
        in this build.
      </p>
    </div>
  );
}
