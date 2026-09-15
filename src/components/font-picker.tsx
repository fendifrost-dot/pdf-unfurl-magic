import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { CatalogFont } from "@/lib/pdf-font-catalog";

export function FontPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: CatalogFont[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((item) => item.id === value);
  const embedded = options.filter((item) => item.source === "embedded");
  const system = options.filter((item) => item.source === "system");
  const bundled = options.filter((item) => item.source === "bundled");
  const standard = options.filter((item) => item.source === "standard");

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground">Font</p>
      <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder="Choose a font already on this page or this machine">
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                <span className="truncate">{selected.label}</span>
                <SafetyMark safety={selected.safety} />
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {embedded.length > 0 && (
            <SelectGroup>
              <SelectLabel>Embedded in this PDF</SelectLabel>
              {embedded.map((item) => (
                <SelectItem key={item.id} value={item.id} disabled={item.safety === "unsafe"}>
                  <span className="flex items-center gap-2">
                    {item.label}
                    <SafetyMark safety={item.safety} />
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {system.length > 0 && (
            <SelectGroup>
              <SelectLabel>Local system fonts</SelectLabel>
              {system.map((item) => (
                <SelectItem key={item.id} value={item.id} disabled={item.safety === "unsafe"}>
                  <span className="flex items-center gap-2">
                    {item.label}
                    <SafetyMark safety={item.safety} />
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {bundled.length > 0 && (
            <SelectGroup>
              <SelectLabel>Bundled SIL OFL (PRIOR_ART #1)</SelectLabel>
              {bundled.map((item) => (
                <SelectItem key={item.id} value={item.id} disabled={item.safety === "unsafe"}>
                  <span className="flex items-center gap-2">
                    {item.label}
                    <SafetyMark safety={item.safety} />
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {standard.length > 0 && (
            <SelectGroup>
              <SelectLabel>Metric stand-in (Standard 14)</SelectLabel>
              {standard.map((item) => (
                <SelectItem key={item.id} value={item.id} disabled={item.safety === "unsafe"}>
                  <span className="flex items-center gap-2">
                    {item.label}
                    <SafetyMark safety={item.safety} />
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {selected && (
        <p className="text-xs leading-relaxed text-muted-foreground">{selected.reason}</p>
      )}
    </div>
  );
}

function SafetyMark({ safety }: { safety: CatalogFont["safety"] }) {
  return (
    <Badge
      variant="outline"
      className={
        safety === "safe"
          ? "border-success/40 font-normal text-success"
          : "border-destructive/40 font-normal text-destructive"
      }
    >
      {safety === "safe" ? "Safe" : "Unsafe"}
    </Badge>
  );
}
