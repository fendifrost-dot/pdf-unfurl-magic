import { Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  REDACT_SEARCH_HINT,
  REDACT_SEARCH_TITLE,
  REDACT_SEARCH_VIEW_ONLY_HINT,
  type RedactSearchHit,
} from "@/lib/pdf-redact-search";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  hits: RedactSearchHit[];
  selectedIds: string[];
  activeId: string | null;
  busy: boolean;
  canMutate: boolean;
  message: string | null;
  onFind: () => void;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onHighlight: (hit: RedactSearchHit) => void;
  onConfirm: () => void;
};

export function RedactSearchPanel({
  query,
  onQueryChange,
  hits,
  selectedIds,
  activeId,
  busy,
  canMutate,
  message,
  onFind,
  onToggle,
  onToggleAll,
  onHighlight,
  onConfirm,
}: Props) {
  const selectedCount = hits.filter((hit) => selectedIds.includes(hit.id)).length;
  const confirmLabel =
    selectedCount === 1
      ? "Mark 1 hit for permanent redact"
      : `Mark ${selectedCount} hits for permanent redact`;

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="redact-search-panel">
      <p className="text-sm font-medium">{REDACT_SEARCH_TITLE}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{REDACT_SEARCH_HINT}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onFind();
        }}
      >
        <Label htmlFor="redact-search-input" className="sr-only">
          Text to find and redact
        </Label>
        <Input
          id="redact-search-input"
          data-testid="redact-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="SECRET"
          autoComplete="off"
          disabled={busy}
        />
        <Button
          type="submit"
          size="sm"
          className="min-h-11 shrink-0 touch-manipulation"
          data-testid="redact-search-find"
          disabled={busy || !query.trim()}
        >
          <Search className="size-3.5" /> Find
        </Button>
      </form>
      {!canMutate ? (
        <Alert className="mt-3">
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>{REDACT_SEARCH_VIEW_ONLY_HINT}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="redact-search-message">
          {message}
        </p>
      ) : null}
      {hits.length > 0 ? (
        <div className="mt-3" data-testid="redact-search-hits">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {hits.length} hit{hits.length === 1 ? "" : "s"} — not cover boxes
            </p>
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => onToggleAll(selectedCount < hits.length)}
            >
              {selectedCount < hits.length ? "Select all" : "Select none"}
            </button>
          </div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
            {hits.map((hit) => {
              const checked = selectedIds.includes(hit.id);
              return (
                <li key={hit.id}>
                  <div
                    className={
                      hit.id === activeId
                        ? "flex items-start gap-2 rounded-md bg-destructive/10 p-1.5"
                        : "flex items-start gap-2 rounded-md p-1.5"
                    }
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(hit.id)}
                      aria-label={`Include hit on page ${hit.page}`}
                      className="mt-0.5"
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      data-testid={`redact-search-hit-${hit.id}`}
                      onClick={() => onHighlight(hit)}
                    >
                      <span className="font-medium">
                        p{hit.page} · {hit.matched}
                      </span>
                      <span className="mt-0.5 block truncate text-muted-foreground">
                        {hit.snippet}
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            className="mt-3 min-h-11 w-full touch-manipulation"
            data-testid="redact-search-confirm"
            disabled={busy || selectedCount === 0 || !canMutate}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
