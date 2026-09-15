import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import {
  FIELD_JS_WARNING,
  SAMPLE_ACROFORM_FIELDS,
  applyAcroFormToDocument,
  buildSampleAcroFormPdf,
  catalogAcroFormFieldCount,
  catalogHasAcroForm,
  catalogNeedAppearances,
  fillAndFlattenAcroForm,
  inspectAcroForm,
  listWidgetAppearanceText,
  listWidgetSubtypes,
  valuesFromReport,
} from "./pdf-acroform";
import { applyWorkshopPatches, buildSamplePdf } from "./pdf-tools";
import { bytesToArrayBuffer } from "./pdf-io";
import { listPageShownText } from "./pdf-text-edit";

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytesToArrayBuffer(bytes);
}

describe("AcroForm inspect", () => {
  it("reports no form on the workshop notes sample", async () => {
    const bytes = await buildSamplePdf();
    const report = await inspectAcroForm(asBuffer(bytes));
    expect(report.hasAcroForm).toBe(false);
    expect(report.fields).toEqual([]);
    const doc = await PDFDocument.load(bytes.slice());
    expect(catalogHasAcroForm(doc)).toBe(false);
  });

  it("lists text, checkbox, radio, and dropdown on the sample form", async () => {
    const bytes = await buildSampleAcroFormPdf();
    const report = await inspectAcroForm(asBuffer(bytes));
    expect(report.hasAcroForm).toBe(true);
    expect(report.hasXfa).toBe(false);
    expect(report.fields.map((field) => field.name).sort()).toEqual(
      Object.values(SAMPLE_ACROFORM_FIELDS).slice().sort(),
    );
    expect(report.fields.find((field) => field.name === "fullName")?.kind).toBe("text");
    expect(report.fields.find((field) => field.name === "agree")?.kind).toBe("checkbox");
    expect(report.fields.find((field) => field.name === "size")?.kind).toBe("radio");
    expect(report.fields.find((field) => field.name === "city")?.options).toEqual([
      "Redwood",
      "Bristol",
      "York",
    ]);
    const widgets = await listWidgetSubtypes(asBuffer(bytes));
    expect(widgets.filter((subtype) => subtype === "Widget").length).toBeGreaterThanOrEqual(5);
    expect(report.hasFieldJavaScript).toBe(false);
    expect(report.fields).toHaveLength(Object.keys(SAMPLE_ACROFORM_FIELDS).length);
  });

  it("warns unmistakably when fields have calculate/validate/format JavaScript", async () => {
    const bytes = await buildSampleAcroFormPdf({ includeFieldJs: true });
    const report = await inspectAcroForm(asBuffer(bytes));
    expect(report.hasFieldJavaScript).toBe(true);
    expect(report.fields.find((field) => field.name === "email")?.hasActions).toBe(true);
    expect(report.warnings).toContain(FIELD_JS_WARNING);
    expect(report.warnings.join(" ")).toMatch(/will not recalculate/i);
    expect(report.warnings.join(" ")).toMatch(/JavaScript/i);
  });

  it("reads the committed acroform-blank fixture as a real AcroForm", async () => {
    const bytes = await readFile(join(process.cwd(), "fixtures/acroform-blank.pdf"));
    const report = await inspectAcroForm(asBuffer(bytes));
    expect(report.hasAcroForm).toBe(true);
    expect(report.hasXfa).toBe(false);
    expect(report.fillableCount).toBeGreaterThanOrEqual(5);
    expect(report.fields.map((field) => field.name).sort()).toEqual(
      Object.values(SAMPLE_ACROFORM_FIELDS).slice().sort(),
    );
    expect(report.hasFieldJavaScript).toBe(true);
    expect(report.warnings).toContain(FIELD_JS_WARNING);
    const doc = await PDFDocument.load(bytes.slice());
    expect(catalogHasAcroForm(doc)).toBe(true);
    expect(doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict)).toBeInstanceOf(PDFDict);
  });
});

describe("AcroForm fill + flatten", () => {
  it("burns values into the page and removes interactive widgets", async () => {
    const source = await buildSampleAcroFormPdf();
    const { bytes, result } = await fillAndFlattenAcroForm(asBuffer(source), {
      values: {
        fullName: "Ada Lovelace",
        city: "York",
        size: "M",
        agree: true,
      },
      flatten: true,
    });

    expect(result.flattened).toBe(true);
    expect(result.filled).toBe(4);
    expect(await catalogAcroFormFieldCount(asBuffer(bytes))).toBe(0);
    const flattenedDoc = await PDFDocument.load(bytes.slice());
    expect(catalogHasAcroForm(flattenedDoc)).toBe(false);
    const widgets = await listWidgetSubtypes(asBuffer(bytes));
    expect(widgets).not.toContain("Widget");

    const shown = await listPageShownText(asBuffer(bytes), 1);
    const joined = shown.join(" ");
    expect(joined).toContain("Ada Lovelace");
    expect(joined).toContain("York");
    expect(joined).toContain("PDF Relief sample AcroForm");

    const after = await inspectAcroForm(asBuffer(bytes));
    expect(after.fields.filter((field) => field.fillable)).toHaveLength(0);
  });

  it("can fill without flattening so widgets stay interactive", async () => {
    const source = await buildSampleAcroFormPdf();
    const { bytes, result } = await fillAndFlattenAcroForm(asBuffer(source), {
      values: { fullName: "Grace Hopper", city: "Bristol", email: "grace@example.com" },
      flatten: false,
    });
    expect(result.flattened).toBe(false);
    expect(await catalogAcroFormFieldCount(asBuffer(bytes))).toBeGreaterThan(0);
    const report = await inspectAcroForm(asBuffer(bytes));
    expect(report.fields.find((field) => field.name === "fullName")?.value).toBe("Grace Hopper");
    expect(report.fields.find((field) => field.name === "city")?.value).toBe("Bristol");
    expect(report.fields.find((field) => field.name === "email")?.value).toBe("grace@example.com");
    expect(await listWidgetSubtypes(asBuffer(bytes))).toContain("Widget");

    const filledDoc = await PDFDocument.load(bytes.slice());
    expect(catalogNeedAppearances(filledDoc)).toBe(true);
    expect(filledDoc.catalog.lookup(PDFName.of("AcroForm"), PDFDict).lookup(PDFName.of("NeedAppearances"))).toBe(
      PDFBool.True,
    );
    const appearance = listWidgetAppearanceText(filledDoc).join(" ");
    expect(appearance).toContain("Grace Hopper");
    expect(appearance).toContain("Bristol");
    expect(appearance).toContain("grace@example.com");
  });

  it("goes through applyWorkshopPatches so Edit export shares the same path", async () => {
    const source = await buildSampleAcroFormPdf();
    const out = await applyWorkshopPatches(asBuffer(source), [], [], [], [], {
      values: {
        fullName: "Jordan Vega",
        city: "Redwood",
        size: "L",
        agree: true,
      },
      flatten: true,
    });
    const shown = await listPageShownText(asBuffer(out), 1);
    expect(shown.join(" ")).toContain("Jordan Vega");
    expect(shown.join(" ")).toContain("Redwood");
    expect(await listWidgetSubtypes(asBuffer(out))).not.toContain("Widget");
  });

  it("leaves a document without AcroForm untouched when asked to flatten", async () => {
    const source = await buildSamplePdf();
    const { bytes, result } = await fillAndFlattenAcroForm(asBuffer(source), {
      values: { fullName: "nobody" },
      flatten: true,
    });
    expect(result.filled).toBe(0);
    expect(result.flattened).toBe(false);
    const shown = await listPageShownText(asBuffer(bytes), 1);
    expect(shown.join(" ")).toContain("Northgate Joinery");
  });

  it("warns on XFA-only forms and refuses to pretend they were filled", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("XFA only", { x: 40, y: 240, size: 12, font, color: rgb(0, 0, 0) });
    const form = doc.getForm();
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    acroForm.set(PDFName.of("XFA"), PDFArray.withContext(doc.context));
    // Drop the empty Fields array so this looks like an XFA packet, not widgets.
    acroForm.delete(PDFName.of("Fields"));
    const source = await doc.save();

    const report = await inspectAcroForm(asBuffer(source));
    expect(report.hasXfa).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/XFA/i);

    await expect(fillAndFlattenAcroForm(asBuffer(source), { flatten: true })).rejects.toThrow(
      /XFA/i,
    );
  });

  it("seeds UI values from the inspected report", async () => {
    const bytes = await buildSampleAcroFormPdf();
    const report = await inspectAcroForm(asBuffer(bytes));
    const values = valuesFromReport(report);
    expect(values.fullName).toBe("");
    expect(values.email).toBe("");
    expect(values.agree).toBe(false);
    expect(values.city).toBe("");
  });
});

describe("applyAcroFormToDocument", () => {
  it("mutates an already-open document so workshop export can flatten last", async () => {
    const source = await buildSampleAcroFormPdf();
    const doc = await PDFDocument.load(source.slice());
    const result = applyAcroFormToDocument(doc, {
      values: { fullName: "In-place Fill" },
      flatten: true,
    });
    expect(result.filled).toBe(1);
    const out = await doc.save();
    expect(await listPageShownText(asBuffer(out), 1).then((rows) => rows.join(" "))).toContain(
      "In-place Fill",
    );
  });
});
