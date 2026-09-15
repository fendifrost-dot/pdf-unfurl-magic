import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ALIGN_HINT,
  ALIGN_SELECTION_LABEL,
  SNAP_ORIGINAL_LABEL,
  type AlignKind,
} from "@/lib/text-align";

export function AlignSelectionPanel({
  onAlign,
  onNudge,
  onSnap,
}: {
  onAlign: (kind: AlignKind) => void;
  onNudge: (dx: number) => void;
  onSnap: () => void;
}) {
  return (
    <div
      className="mt-4 rounded-md border border-border/70 px-3 py-2.5"
      data-testid="align-selection-panel"
    >
      <p className="text-sm font-semibold">{ALIGN_SELECTION_LABEL}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ALIGN_HINT}</p>
      <div className="mt-3 grid grid-cols-4 gap-1">
        <Button
          size="sm"
          variant="secondary"
          data-testid="align-left"
          onClick={() => onAlign("left")}
        >
          <AlignLeft className="size-3.5" /> Left
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="align-center"
          onClick={() => onAlign("center")}
        >
          <AlignCenter className="size-3.5" /> Center
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="align-right"
          onClick={() => onAlign("right")}
        >
          <AlignRight className="size-3.5" /> Right
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="align-justify"
          onClick={() => onAlign("justify")}
        >
          <AlignJustify className="size-3.5" /> Justify
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        <Button size="sm" variant="ghost" data-testid="nudge-left-1" onClick={() => onNudge(-1)}>
          <ArrowLeft className="size-3.5" /> 1pt
        </Button>
        <Button size="sm" variant="ghost" data-testid="nudge-left-5" onClick={() => onNudge(-5)}>
          <ArrowLeft className="size-3.5" /> 5pt
        </Button>
        <Button size="sm" variant="ghost" data-testid="nudge-right-1" onClick={() => onNudge(1)}>
          1pt <ArrowRight className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" data-testid="nudge-right-5" onClick={() => onNudge(5)}>
          5pt <ArrowRight className="size-3.5" />
        </Button>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        data-testid="snap-original-layout"
        onClick={onSnap}
      >
        {SNAP_ORIGINAL_LABEL}
      </Button>
    </div>
  );
}
