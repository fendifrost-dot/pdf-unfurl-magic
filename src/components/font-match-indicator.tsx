import { ShieldAlert, ShieldCheck, Type } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TextEditInspection } from "@/lib/pdf-text-edit";

export function FontMatchIndicator({
  inspection,
  loading,
}: {
  inspection: TextEditInspection | null;
  loading: boolean;
}) {
  if (loading && !inspection) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">Checking the page font for this run…</p>
    );
  }
  if (!inspection) return null;

  const blocked = inspection.method === "blocked";
  const inPlace = inspection.method === "in-place";
  const missingOperator = !inspection.found;
  const tone = blocked ? "text-destructive" : inPlace ? "text-success" : "text-warning";
  const Icon = blocked ? ShieldAlert : ShieldCheck;
  const status = missingOperator
    ? "Not a text operator"
    : blocked
      ? "Unsafe"
      : inPlace
        ? "Safe in-place rewrite"
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
          {status}
        </span>
      </div>
      <p
        className={`mt-1.5 text-xs leading-relaxed ${blocked ? "text-destructive" : "text-muted-foreground"}`}
      >
        {inspection.message}
      </p>
    </div>
  );
}
