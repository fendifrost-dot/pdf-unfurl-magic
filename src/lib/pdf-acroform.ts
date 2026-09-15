/**
 * AcroForm detect / fill / flatten.
 *
 * Uses pdf-lib form APIs we already depend on. Appearance streams are
 * generated (Helvetica / WinAnsi) then merged into the page so the export
 * is a static PDF — widget annotations are removed.
 *
 * Honest limits: no XFA, no field JavaScript (calculate / validate / format),
 * no rich-text (RV) values, no digital-signature fields. Hybrid XFA+AcroForm
 * files keep the AcroForm widgets; XFA packets are dropped by pdf-lib.
 */
import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFField,
} from "pdf-lib";
import { loadPdfDocument } from "./pdf-io";

export const SAMPLE_ACROFORM_FIELDS = {
  fullName: "fullName",
  city: "city",
  size: "size",
  agree: "agree",
} as const;

export type AcroFormFieldKind =
  "text" | "checkbox" | "radio" | "dropdown" | "optionList" | "button" | "signature" | "unknown";

export type AcroFormValue = string | boolean | string[];

export type AcroFormWidget = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  exportValue?: string;
};

export type AcroFormField = {
  name: string;
  kind: AcroFormFieldKind;
  value: string;
  checked?: boolean;
  selected?: string[];
  options: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  fillable: boolean;
  hasActions: boolean;
  widgets: AcroFormWidget[];
};

export type AcroFormReport = {
  hasAcroForm: boolean;
  hasXfa: boolean;
  fieldCount: number;
  fillableCount: number;
  fields: AcroFormField[];
  warnings: string[];
};

export type AcroFormFillRequest = {
  values?: Record<string, AcroFormValue>;
  /** Default true: burn appearances into the page and drop widgets. */
  flatten?: boolean;
};

export type AcroFormApplyResult = {
  filled: number;
  flattened: boolean;
  hasXfa: boolean;
  warnings: string[];
};

export const emptyAcroFormReport = (): AcroFormReport => ({
  hasAcroForm: false,
  hasXfa: false,
  fieldCount: 0,
  fillableCount: 0,
  fields: [],
  warnings: [],
});

export function catalogHasAcroForm(doc: PDFDocument): boolean {
  return !!doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
}

export function catalogHasXfa(doc: PDFDocument): boolean {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acroForm) return false;
  return acroForm.has(PDFName.of("XFA"));
}

function dictHasActions(dict: PDFDict): boolean {
  return dict.has(PDFName.of("AA")) || dict.has(PDFName.of("A"));
}

function fieldKind(field: PDFField): AcroFormFieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFSignature) return "signature";
  return "unknown";
}

function isFillableKind(kind: AcroFormFieldKind): boolean {
  return (
    kind === "text" ||
    kind === "checkbox" ||
    kind === "radio" ||
    kind === "dropdown" ||
    kind === "optionList"
  );
}

function pageNumberForWidget(
  doc: PDFDocument,
  widget: { P: () => unknown; dict: PDFDict },
): number {
  const pages = doc.getPages();
  const pageRef = widget.P();
  if (pageRef) {
    const idx = pages.findIndex((page) => page.ref === pageRef);
    if (idx >= 0) return idx + 1;
  }
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i]?.node.Annots();
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j++) {
      const dict = doc.context.lookup(annots.get(j));
      if (dict === widget.dict) return i + 1;
    }
  }
  return 1;
}

function describeField(doc: PDFDocument, field: PDFField): AcroFormField {
  const kind = fieldKind(field);
  const widgets = field.acroField.getWidgets().map((widget) => {
    const rect = widget.getRectangle();
    const onValue = widget.getOnValue();
    return {
      page: pageNumberForWidget(doc, widget),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      ...(onValue ? { exportValue: onValue.decodeText() } : {}),
    };
  });

  const hasActions =
    dictHasActions(field.acroField.dict) ||
    field.acroField.getWidgets().some((widget) => dictHasActions(widget.dict));

  let value = "";
  let checked: boolean | undefined;
  let selected: string[] | undefined;
  let options: string[] = [];
  let multiline = false;

  if (field instanceof PDFTextField) {
    try {
      value = field.getText() ?? "";
    } catch {
      value = "";
    }
    multiline = field.isMultiline();
  } else if (field instanceof PDFCheckBox) {
    checked = field.isChecked();
    value = checked ? "Yes" : "Off";
  } else if (field instanceof PDFRadioGroup) {
    options = field.getOptions();
    value = field.getSelected() ?? "";
    selected = value ? [value] : [];
  } else if (field instanceof PDFDropdown) {
    options = field.getOptions();
    selected = field.getSelected();
    value = selected[0] ?? "";
  } else if (field instanceof PDFOptionList) {
    options = field.getOptions();
    selected = field.getSelected();
    value = selected.join(", ");
  }

  return {
    name: field.getName(),
    kind,
    value,
    ...(checked !== undefined ? { checked } : {}),
    ...(selected ? { selected } : {}),
    options,
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    multiline,
    fillable: isFillableKind(kind) && !field.isReadOnly(),
    hasActions,
    widgets,
  };
}

function collectWarnings(hasXfa: boolean, fields: AcroFormField[]): string[] {
  const warnings: string[] = [];
  if (hasXfa) {
    warnings.push(
      "This file also has an XFA packet. PDF Relief fills AcroForm widgets only — LiveCycle XFA is not supported and is discarded on export.",
    );
  }
  if (fields.some((field) => field.hasActions)) {
    warnings.push(
      "Some fields have JavaScript actions (calculate, validate, or format). Those scripts do not run here.",
    );
  }
  if (fields.some((field) => field.kind === "signature")) {
    warnings.push("Signature fields are listed but not filled. Use E-Sign for a drawn mark.");
  }
  if (hasXfa && fields.filter((field) => field.fillable).length === 0) {
    warnings.push(
      "No AcroForm widgets to fill. Export this as a static PDF from Acrobat, or ask for an AcroForm (not XFA) copy.",
    );
  }
  return warnings;
}

export async function inspectAcroForm(bytes: ArrayBuffer): Promise<AcroFormReport> {
  const doc = await loadPdfDocument(bytes);
  if (!catalogHasAcroForm(doc)) return emptyAcroFormReport();

  const hasXfa = catalogHasXfa(doc);
  let form;
  try {
    form = doc.getForm();
  } catch (error) {
    return {
      ...emptyAcroFormReport(),
      hasAcroForm: true,
      hasXfa,
      warnings: [
        `This AcroForm could not be read (${error instanceof Error ? error.message : "unknown error"}).`,
      ],
    };
  }

  const fields = form.getFields().map((field) => describeField(doc, field));
  return {
    hasAcroForm: true,
    hasXfa,
    fieldCount: fields.length,
    fillableCount: fields.filter((field) => field.fillable).length,
    fields,
    warnings: collectWarnings(hasXfa, fields),
  };
}

export function valuesFromReport(report: AcroFormReport): Record<string, AcroFormValue> {
  const values: Record<string, AcroFormValue> = {};
  for (const field of report.fields) {
    if (field.kind === "checkbox") values[field.name] = field.checked === true;
    else if (field.kind === "optionList") values[field.name] = field.selected ?? [];
    else values[field.name] = field.value;
  }
  return values;
}

export function formValuesEqual(
  a: AcroFormValue | undefined,
  b: AcroFormValue | undefined,
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : a != null && a !== "" ? [String(a)] : [];
    const right = Array.isArray(b) ? b : b != null && b !== "" ? [String(b)] : [];
    return left.length === right.length && left.every((item, i) => item === right[i]);
  }
  return a === b;
}

function checkboxOn(value: AcroFormValue): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(checkboxOn);
  const text = String(value).trim().toLowerCase();
  return text === "yes" || text === "true" || text === "on" || text === "1";
}

function asString(value: AcroFormValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  if (typeof value === "boolean") return value ? "Yes" : "";
  return value;
}

function applyFieldValue(field: PDFField, value: AcroFormValue) {
  if (field instanceof PDFTextField) {
    const text = asString(value);
    field.setText(text === "" ? undefined : text);
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (checkboxOn(value)) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof PDFRadioGroup) {
    const option = asString(value);
    if (option) field.select(option);
    return;
  }
  if (field instanceof PDFDropdown) {
    const option = asString(value);
    if (option) field.select(option);
    return;
  }
  if (field instanceof PDFOptionList) {
    const options = Array.isArray(value) ? value : asString(value) ? [asString(value)] : [];
    if (options.length) field.select(options);
  }
}

export function applyAcroFormToDocument(
  doc: PDFDocument,
  request: AcroFormFillRequest = {},
): AcroFormApplyResult {
  const flatten = request.flatten !== false;
  const values = request.values ?? {};
  const warnings: string[] = [];

  if (!catalogHasAcroForm(doc)) {
    return { filled: 0, flattened: false, hasXfa: false, warnings };
  }

  const hasXfa = catalogHasXfa(doc);
  if (hasXfa) {
    warnings.push("XFA data was present and is discarded. Only AcroForm widgets are filled.");
  }

  const form = doc.getForm();
  const fields = form.getFields();
  if (hasXfa && fields.length === 0) {
    throw new Error(
      "This PDF uses XFA forms (LiveCycle), which PDF Relief cannot fill or flatten. Ask for an AcroForm copy, or export a static PDF from Acrobat.",
    );
  }

  let filled = 0;
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    const kind = fieldKind(field);
    if (!isFillableKind(kind) || field.isReadOnly()) continue;
    try {
      applyFieldValue(field, value);
      filled += 1;
    } catch (error) {
      warnings.push(
        `Could not set “${name}”: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
  }

  if (flatten) {
    try {
      form.updateFieldAppearances();
    } catch (error) {
      warnings.push(
        `Appearance update used Helvetica/WinAnsi and failed (${error instanceof Error ? error.message : "unknown"}). Flatten will burn whatever appearance already exists.`,
      );
    }
    try {
      form.flatten({ updateFieldAppearances: false });
    } catch (error) {
      throw new Error(
        `Could not flatten this form: ${error instanceof Error ? error.message : "unknown error"}. Some widgets may lack appearance streams.`,
      );
    }
  }

  return { filled, flattened: flatten, hasXfa, warnings };
}

export async function fillAndFlattenAcroForm(
  bytes: ArrayBuffer,
  request: AcroFormFillRequest = {},
): Promise<{ bytes: Uint8Array; result: AcroFormApplyResult }> {
  const doc = await loadPdfDocument(bytes);
  const result = applyAcroFormToDocument(doc, request);
  return { bytes: await doc.save(), result };
}

export async function listWidgetSubtypes(bytes: ArrayBuffer): Promise<string[]> {
  const doc = await loadPdfDocument(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const dict = doc.context.lookup(annots.get(i));
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      if (subtype instanceof PDFName) out.push(subtype.decodeText());
    }
  }
  return out;
}

export function catalogFieldCount(doc: PDFDocument): number {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acroForm) return 0;
  const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
  return fields?.size() ?? 0;
}

export async function catalogAcroFormFieldCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await loadPdfDocument(bytes);
  return catalogFieldCount(doc);
}

/** Tiny intake form: text, dropdown, radio, checkbox. */
export async function buildSampleAcroFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("acroform-simple");
  doc.setProducer("PDF Relief fixtures");
  doc.setCreator("PDF Relief fixtures");
  doc.setSubject("Synthetic AcroForm QA fixture — not a real document");

  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.11, 0.13);
  const soft = rgb(0.42, 0.44, 0.48);
  const border = rgb(0.62, 0.63, 0.66);

  page.drawText("PDF Relief sample AcroForm", {
    x: 56,
    y: 780,
    size: 18,
    font: bold,
    color: ink,
  });
  page.drawText("Synthetic intake — fill locally, then flatten on export.", {
    x: 56,
    y: 758,
    size: 10,
    font: body,
    color: soft,
  });

  page.drawText("Full name", { x: 56, y: 706, size: 11, font: body, color: ink });
  page.drawText("City", { x: 56, y: 662, size: 11, font: body, color: ink });
  page.drawText("Size", { x: 56, y: 618, size: 11, font: body, color: ink });
  page.drawText("S", { x: 196, y: 618, size: 11, font: body, color: ink });
  page.drawText("M", { x: 246, y: 618, size: 11, font: body, color: ink });
  page.drawText("L", { x: 296, y: 618, size: 11, font: body, color: ink });
  page.drawText("I agree to the workshop terms", {
    x: 80,
    y: 574,
    size: 11,
    font: body,
    color: ink,
  });

  const form = doc.getForm();
  const nameField = form.createTextField(SAMPLE_ACROFORM_FIELDS.fullName);
  nameField.addToPage(page, {
    x: 160,
    y: 700,
    width: 280,
    height: 20,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: rgb(1, 1, 1),
  });

  const city = form.createDropdown(SAMPLE_ACROFORM_FIELDS.city);
  city.addOptions(["Redwood", "Bristol", "York"]);
  city.addToPage(page, {
    x: 160,
    y: 656,
    width: 180,
    height: 20,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: rgb(1, 1, 1),
  });

  const size = form.createRadioGroup(SAMPLE_ACROFORM_FIELDS.size);
  size.addOptionToPage("S", page, { x: 176, y: 616, width: 14, height: 14 });
  size.addOptionToPage("M", page, { x: 226, y: 616, width: 14, height: 14 });
  size.addOptionToPage("L", page, { x: 276, y: 616, width: 14, height: 14 });

  const agree = form.createCheckBox(SAMPLE_ACROFORM_FIELDS.agree);
  agree.addToPage(page, {
    x: 56,
    y: 572,
    width: 16,
    height: 16,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: rgb(1, 1, 1),
  });

  form.updateFieldAppearances();
  return doc.save();
}
