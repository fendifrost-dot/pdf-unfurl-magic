import { ShieldAlert, ShieldCheck, ScanSearch, Type } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TextEditInspection } from "@/lib/pdf-text-edit";

export function FontMatchIndicator({
  inspection,
  loading,
  closestMatchReason,
}: {
  inspection: TextEditInspection | null;
  loading: boolean;
  closestMatchReason?: string;
}) {
  if (loading && !inspection) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">Checking the page font for this run…</p>
    );
  }
  if (!inspection) return null;

  const scan = !!inspection.deferToScan || inspection.blockReason === "scan-page";
  const blocked = inspection.method === "blocked";
  const inPlace = inspection.method === "in-place";
  const system = inspection.method === "redraw-system";
  const unicode = inspection.method === "redraw-unicode";
  const missingOperator = !inspection.found && !scan;
  const tone = scan
    ? "text-warning"
    : blocked
      ? "text-destructive"
      : inPlace || unicode
        ? "text-success"
        : "text-warning";
  const Icon = scan ? ScanSearch : blocked ? ShieldAlert : ShieldCheck;
  const label = scan
    ? "Scan page — Enhance or OCR instead of a fake Safe edit"
    : missingOperator
      ? "Not a text operator"
      : blocked && inspection.blockReason === "not-found"
        ? "Run not found"
        : blocked && inspection.blockReason === "unsafe-font"
          ? "Unsafe font"
          : blocked
            ? "Blocked"
            : inPlace
              ? "Safe in-place rewrite"
              : unicode
                ? "Safe Unicode embed"
                : system
                  ? "Safe local system font"
                  : "Safe standard stand-in";

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-surface/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          <Type className="mr-1 size-3" />
          {inspection.fontLabel}
        </Badge>
        <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
          <Icon className="size-3.5" />
          {label}
        </span>
      </div>
      {closestMatchReason ? (
        <p className="mt-1.5 text-xs leading-relaxed text-foreground">{closestMatchReason}</p>
      ) : null}
      {inspection.message && inspection.message !== closestMatchReason ? (
        <p
          className={`mt-1.5 text-xs leading-relaxed ${blocked && !scan ? "text-destructive" : "text-muted-foreground"}`}
        >
          {inspection.message}
        </p>
      ) : null}
    </div>
  );
}
