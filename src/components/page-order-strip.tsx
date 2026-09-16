import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PAGE_THUMB_LIMIT, usePageThumbs } from "@/hooks/use-page-thumbs";
import { moveIndex, slotsAfterDelete, slotsForExtract, type PageSlot } from "@/lib/page-order";

type Props = {
  slots: PageSlot[];
  onReorder: (next: PageSlot[]) => void;
  onExtract?: (picked: PageSlot[]) => void;
  onDelete?: (remaining: PageSlot[]) => void;
  actionsDisabled?: boolean;
};

export function PageOrderStrip({
  slots,
  onReorder,
  onExtract,
  onDelete,
  actionsDisabled = false,
}: Props) {
  const thumbs = usePageThumbs(slots);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const live = new Set(slots.map((slot) => slot.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [slots]);

  if (slots.length === 0) return null;

  const selectedCount = slots.filter((slot) => selectedIds.has(slot.id)).length;
  const canExtract = !actionsDisabled && selectedCount > 0 && !!onExtract;
  const canDelete =
    !actionsDisabled && selectedCount > 0 && selectedCount < slots.length && !!onDelete;

  const move = (from: number, to: number) => {
    if (from === to) return;
    onReorder(moveIndex(slots, from, to));
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const extractSelected = () => {
    if (!onExtract) return;
    onExtract(slotsForExtract(slots, selectedIds));
  };

  const deleteSelected = () => {
    if (!onDelete) return;
    const remaining = slotsAfterDelete(slots, selectedIds);
    setSelectedIds(new Set());
    onDelete(remaining);
  };

  return (
    <div className="bench-panel p-3 sm:p-4" data-testid="page-order-strip">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">
            Page order · {slots.length} page{slots.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag or use the arrows to reorder. Tick pages, then extract a new PDF of the selection
            or delete them from this strip. Save As writes a copy; the files you opened stay as they
            are.
          </p>
          <p
            className="mt-1 text-sm font-medium"
            data-testid="page-order-sequence"
            aria-live="polite"
          >
            Original pages in this order: {slots.map((slot) => slot.sourcePage).join(" · ")}
          </p>
          <p
            className="mt-1 text-xs text-muted-foreground"
            data-testid="page-order-selected-count"
            aria-live="polite"
          >
            {selectedCount === 0
              ? "No pages selected."
              : `${selectedCount} page${selectedCount === 1 ? "" : "s"} selected.`}
          </p>
        </div>
        {slots.length > PAGE_THUMB_LIMIT && (
          <p className="max-w-xs text-xs text-muted-foreground">
            Thumbnails stay off above {PAGE_THUMB_LIMIT} pages so this strip does not fill RAM.
            Arrows still move pages.
          </p>
        )}
      </div>
      {(onExtract || onDelete) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onExtract && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 touch-manipulation"
              disabled={!canExtract}
              onClick={extractSelected}
              data-testid="extract-selected-pages"
            >
              <Layers className="size-3.5" />
              Extract selected
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 touch-manipulation"
              disabled={!canDelete}
              onClick={deleteSelected}
              data-testid="delete-selected-pages"
            >
              <Trash2 className="size-3.5" />
              Delete selected
            </Button>
          )}
        </div>
      )}
      <ol className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {slots.map((slot, index) => {
          const thumb = thumbs[slot.id];
          const isOver = over === index && dragging !== null && dragging !== index;
          const selected = selectedIds.has(slot.id);
          return (
            <li
              key={slot.id}
              data-testid={`page-slot-${index}`}
              data-source-page={slot.sourcePage}
              data-selected={selected ? "true" : "false"}
              aria-selected={selected}
              className={[
                "w-[132px] shrink-0 rounded-md",
                isOver ? "ring-2 ring-primary/40" : "",
              ].join(" ")}
              draggable
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOver(index);
              }}
              onDragLeave={() => {
                setOver((current) => (current === index ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                setDragging(null);
                setOver(null);
                if (Number.isInteger(from)) move(from, index);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <div
                className={[
                  "overflow-hidden rounded-md border bg-paper",
                  dragging === index ? "opacity-60" : "",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-1 px-1 py-0.5 text-muted-foreground">
                  <GripVertical className="size-3.5 shrink-0" aria-hidden />
                  <span
                    className="text-gauge min-w-0 flex-1 truncate text-[10px]"
                    title={slot.sourceName}
                  >
                    {slot.sourceName}
                  </span>
                  <div
                    className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected}
                      data-testid={`select-page-${index}`}
                      aria-label={`Select position ${index + 1}, original page ${slot.sourcePage}`}
                      onCheckedChange={(value) => toggleSelected(slot.id, value === true)}
                    />
                  </div>
                </div>
                <div className="relative">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`Position ${index + 1}: ${slot.sourceName} page ${slot.sourcePage}`}
                      className="h-36 w-full bg-paper object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="flex h-36 items-center justify-center bg-paper px-2 text-center text-xs text-muted-foreground"
                      aria-label={`Position ${index + 1}: ${slot.sourceName} page ${slot.sourcePage}`}
                    >
                      Page {slot.sourcePage}
                    </div>
                  )}
                  <span
                    className="absolute left-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-semibold"
                    data-testid={`source-page-${index}`}
                  >
                    p.{slot.sourcePage}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <span className="text-gauge text-xs font-medium">{index + 1}</span>
                <div className="flex items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="min-h-11 min-w-11 touch-manipulation"
                    disabled={index === 0}
                    aria-label={`Move page ${index + 1} earlier`}
                    data-testid={`move-page-earlier-${index}`}
                    onClick={() => move(index, index - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="min-h-11 min-w-11 touch-manipulation"
                    disabled={index === slots.length - 1}
                    aria-label={`Move page ${index + 1} later`}
                    data-testid={`move-page-later-${index}`}
                    onClick={() => move(index, index + 1)}
                  >
                    <ChevronRight className="size-3.5" />
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
