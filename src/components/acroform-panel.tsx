import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AcroFormField, AcroFormReport, AcroFormValue } from "@/lib/pdf-acroform";

type Props = {
  report: AcroFormReport;
  values: Record<string, AcroFormValue>;
  selectedName: string | null;
  flatten: boolean;
  onFlattenChange: (next: boolean) => void;
  onSelect: (name: string, page?: number) => void;
  onChange: (name: string, value: AcroFormValue) => void;
};

function FieldEditor({
  field,
  value,
  selected,
  onSelect,
  onChange,
}: {
  field: AcroFormField;
  value: AcroFormValue | undefined;
  selected: boolean;
  onSelect: () => void;
  onChange: (value: AcroFormValue) => void;
}) {
  const id = `acro-${field.name}`;
  const disabled = !field.fillable;

  return (
    <li
      className={[
        "rounded-md border p-3",
        selected ? "border-primary bg-primary/5" : "border-border",
        disabled ? "opacity-70" : "",
      ].join(" ")}
    >
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-between gap-2 text-left"
        onClick={onSelect}
      >
        <Label htmlFor={id} className="cursor-pointer text-sm">
          {field.name}
        </Label>
        <span className="text-gauge text-[10px] uppercase tracking-wide text-muted-foreground">
          {field.kind}
          {field.required ? " · required" : ""}
        </span>
      </button>

      {field.kind === "text" &&
        (field.multiline ? (
          <Textarea
            id={id}
            rows={3}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onSelect}
            data-testid={`acro-field-${field.name}`}
          />
        ) : (
          <Input
            id={id}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onSelect}
            data-testid={`acro-field-${field.name}`}
          />
        ))}

      {field.kind === "checkbox" && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            id={id}
            disabled={disabled}
            checked={value === true}
            onCheckedChange={(next) => onChange(next === true)}
            data-testid={`acro-field-${field.name}`}
          />
          Checked
        </label>
      )}

      {field.kind === "radio" && (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          disabled={disabled}
          className="gap-2"
        >
          {field.options.map((option) => (
            <label key={option} className="flex min-h-9 items-center gap-2 text-sm">
              <RadioGroupItem value={option} id={`${id}-${option}`} />
              {option}
            </label>
          ))}
        </RadioGroup>
      )}

      {(field.kind === "dropdown" || field.kind === "optionList") && (
        <Select
          value={typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : ""}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={id} data-testid={`acro-field-${field.name}`}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {(field.kind === "button" || field.kind === "signature" || field.kind === "unknown") && (
        <p className="text-xs text-muted-foreground">Not fillable in this MVP.</p>
      )}
    </li>
  );
}

export function AcroFormPanel({
  report,
  values,
  selectedName,
  flatten,
  onFlattenChange,
  onSelect,
  onChange,
}: Props) {
  return (
    <>
      <p className="eyebrow">Form fields</p>
      <p className="mt-2 text-sm text-muted-foreground">
        AcroForm widgets stay in this browser. Export fills them, then flattens so the values are
        burned into the page — no longer editable fields.
      </p>

      {report.warnings.map((warning) => (
        <p key={warning} className="mt-3 text-xs leading-relaxed text-warning">
          {warning}
        </p>
      ))}

      {!report.hasAcroForm ? (
        <div className="py-8 text-center">
          <ListChecks className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-display text-base font-semibold">No AcroForm in this file</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open a PDF with interactive fields, or load the sample form. XFA / LiveCycle packets are
            not supported.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Badge variant="secondary" className="text-gauge">
              {report.fillableCount} fillable · {report.fieldCount} total
            </Badge>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={flatten}
                onCheckedChange={onFlattenChange}
                data-testid="acro-flatten-toggle"
              />
              Flatten on export
            </label>
          </div>
          {!flatten && (
            <p className="mt-2 text-xs text-muted-foreground">
              Fields stay interactive. Most Acrobat replacements flatten so printers and other
              readers see the typed values.
            </p>
          )}
          <ul className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {report.fields.map((field) => (
              <FieldEditor
                key={field.name}
                field={field}
                value={values[field.name]}
                selected={selectedName === field.name}
                onSelect={() => onSelect(field.name, field.widgets[0]?.page)}
                onChange={(value) => onChange(field.name, value)}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
