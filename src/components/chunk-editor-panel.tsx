import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ChunkRow } from "@/lib/edit-apply";

export function ChunkEditorPanel({
  rows,
  drafts,
  onChange,
}: {
  rows: ChunkRow[];
  drafts: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const setDraft = (id: string, value: string) => {
    onChange({ ...drafts, [id]: value });
  };

  return (
    <div className="mt-3 space-y-3" data-testid="edit-chunk">
      <p className="text-xs text-muted-foreground">
        Each selected row keeps its own draft. Amount and balance stay in their columns — Apply
        rewrites every run in place.
      </p>
      {rows.map((row) => {
        const columnar = row.fields.length > 1;
        return (
          <div
            key={row.id}
            className="space-y-2 rounded-md border border-border/70 px-3 py-2.5"
            data-testid="edit-chunk-row"
            data-chunk-row={row.index}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">Row {row.index + 1}</p>
              <p className="truncate text-[11px] text-muted-foreground" title={row.text}>
                {row.runCount} run{row.runCount === 1 ? "" : "s"}
              </p>
            </div>
            {columnar ? (
              row.fields.map((field) => (
                <label key={field.id} className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">{field.label}</span>
                  <Input
                    value={drafts[field.id] ?? field.text}
                    onChange={(event) => setDraft(field.id, event.target.value)}
                    className="font-mono text-sm"
                    data-testid={
                      row.index === 0 && field.label === "Description"
                        ? "edit-draft"
                        : `edit-chunk-${row.index}-${field.label.toLowerCase().replace(/\s+/g, "-")}`
                    }
                    placeholder={field.label}
                  />
                </label>
              ))
            ) : (
              <Textarea
                value={drafts[row.id] ?? row.text}
                onChange={(event) => setDraft(row.id, event.target.value)}
                rows={2}
                className="font-mono text-sm"
                data-testid={row.index === 0 ? "edit-draft" : `edit-chunk-${row.index}-text`}
                placeholder="Replacement text"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
