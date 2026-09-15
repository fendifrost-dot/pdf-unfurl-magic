import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScanPage } from "@/lib/scan";

type Props = {
  pages: ScanPage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
};

export function ScanPageStrip({ pages, selectedId, onSelect, onMove, onRemove }: Props) {
  if (pages.length === 0) return null;
  return (
    <div className="bench-panel p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">
          Session · {pages.length} page{pages.length === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted-foreground">Order here is the PDF order.</p>
      </div>
      <ol className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {pages.map((page, index) => {
          const selected = page.id === selectedId;
          return (
            <li key={page.id} className="w-[132px] shrink-0">
              <button
                type="button"
                onClick={() => onSelect(page.id)}
                className={[
                  "block w-full overflow-hidden rounded-md border bg-paper text-left",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                ].join(" ")}
              >
                <img
                  src={page.thumbUrl}
                  alt={`Page ${index + 1}`}
                  className="h-36 w-full bg-paper object-contain"
                />
              </button>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <span className="text-gauge text-xs text-muted-foreground">{index + 1}</span>
                <div className="flex items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={index === 0}
                    aria-label={`Move page ${index + 1} earlier`}
                    onClick={() => onMove(page.id, -1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={index === pages.length - 1}
                    aria-label={`Move page ${index + 1} later`}
                    onClick={() => onMove(page.id, 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    aria-label={`Remove page ${index + 1}`}
                    onClick={() => onRemove(page.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
