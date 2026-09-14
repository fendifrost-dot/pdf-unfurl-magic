/** Local-only text helpers. Pure functions, no network, no model calls. */

export function cleanCopy(input: string): string {
  let out = input.replace(/\u00a0/g, " ");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\s+([,.;:!?%])/g, "$1");
  out = out.replace(/([,;:])(?=\S)/g, "$1 ");
  // Repeated words: "the the total total"
  out = out.replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1");
  return out.trim();
}

/** Rough width in text units (1 unit == 1 font size em) using Helvetica-ish metrics. */
export function estimateWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.28;
    else if (/[iljtfr.,:;'"|![\]()]/.test(ch)) units += 0.31;
    else if (/[A-Z0-9]/.test(ch)) units += 0.63;
    else if (/[mwMW]/.test(ch)) units += 0.85;
    else units += 0.52;
  }
  return units * fontSize;
}

const FILLER: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bplease note that\b/gi, replacement: "" },
  { pattern: /\bin order to\b/gi, replacement: "to" },
  { pattern: /\bat this point in time\b/gi, replacement: "now" },
  { pattern: /\bas a matter of fact\b/gi, replacement: "" },
  { pattern: /\bkindly\b/gi, replacement: "" },
  { pattern: /\bvery\b/gi, replacement: "" },
  { pattern: /\bjust\b/gi, replacement: "" },
  { pattern: /\breally\b/gi, replacement: "" },
  { pattern: /\bthat\b/gi, replacement: "" },
];

/** Trim a line so it fits maxWidth without shrinking type: drop filler, then clip on a word boundary. */
export function shortenToFit(text: string, fontSize: number, maxWidth: number): string {
  let out = cleanCopy(text);
  for (const { pattern, replacement } of FILLER) {
    if (estimateWidth(out, fontSize) <= maxWidth) break;
    out = cleanCopy(out.replace(pattern, replacement));
  }
  if (estimateWidth(out, fontSize) <= maxWidth) return out;
  const words = out.split(" ");
  while (words.length > 1 && estimateWidth(words.join(" ") + "…", fontSize) > maxWidth) words.pop();
  return words.join(" ") + "…";
}

/** Largest font size (capped at original) where the text still fits the original box. */
export function fitFontSize(text: string, originalSize: number, maxWidth: number): number {
  let size = originalSize;
  while (size > 4 && estimateWidth(text, size) > maxWidth) size -= 0.25;
  return Math.max(size, 4);
}

export type NumberFinding = {
  id: string;
  kind: "arithmetic" | "total";
  severity: "error" | "warning";
  line: string;
  message: string;
  suggestion?: string;
};

const NUM = /-?\d[\d,]*(?:\.\d+)?/g;

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function fmtLike(sample: string, value: number): string {
  const decimalPart = sample.split(".")[1];
  const decimals = sample.includes(".") ? (decimalPart?.length ?? 2) : 0;
  const grouped = sample.includes(",");
  const fixed = value.toFixed(decimals);
  if (!grouped) return fixed;
  const [int = "0", dec] = fixed.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${withCommas}.${dec}` : withCommas;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Flags two things, using only the lines on the page:
 * 1. Inline arithmetic that does not compute (3 x 12 = 35).
 * 2. A line labelled total/sum/balance that does not match the amounts above it.
 */
export function checkNumbers(lines: string[]): NumberFinding[] {
  const findings: NumberFinding[] = [];

  lines.forEach((line, index) => {
    const math = line.match(
      /(-?\d[\d,]*(?:\.\d+)?)\s*([x×*+\-/÷])\s*(-?\d[\d,]*(?:\.\d+)?)\s*=\s*(-?\d[\d,]*(?:\.\d+)?)/,
    );
    if (!math) return;
    const left = math[1] ?? "";
    const op = math[2] ?? "*";
    const right = math[3] ?? "";
    const claimedRaw = math[4] ?? "";
    const a = toNumber(left);
    const b = toNumber(right);
    const claimed = toNumber(claimedRaw);
    const actual =
      op === "+"
        ? a + b
        : op === "-"
          ? a - b
          : op === "/" || op === "÷"
            ? b === 0
              ? NaN
              : a / b
            : a * b;
    if (Number.isFinite(actual) && !near(actual, claimed)) {
      findings.push({
        id: `math-${index}`,
        kind: "arithmetic",
        severity: "error",
        line,
        message: `${left} ${op} ${right} is ${fmtLike(claimedRaw, actual)}, but the line says ${claimedRaw}.`,
        suggestion: fmtLike(claimedRaw, actual),
      });
    }
  });

  const totalPattern = /\b(total|subtotal|sum|amount due|balance due|grand total)\b/i;
  lines.forEach((line, index) => {
    if (!totalPattern.test(line)) return;
    const nums = line.match(NUM);
    const claimedRaw = nums?.[nums.length - 1];
    if (!claimedRaw) return;
    const claimed = toNumber(claimedRaw);

    const above: number[] = [];
    for (let i = index - 1; i >= 0 && above.length < 40; i--) {
      const prev = lines[i];
      if (!prev) continue;
      if (totalPattern.test(prev)) break;
      const prevNums = prev.match(NUM);
      // A table row carries several figures (qty, rate, amount). A prose line
      // like "Valid for 30 days" carries one - once the rows stop, stop reading.
      if (!prevNums || prevNums.length < 2) {
        if (above.length >= 2) break;
        continue;
      }
      const money = prevNums[prevNums.length - 1];
      if (!money) continue;
      if (!/[.,]/.test(money) && Number(money) < 10) continue; // skip counts like "3"
      above.push(toNumber(money));
    }
    if (above.length < 2) return;
    const sum = above.reduce((a, b) => a + b, 0);
    if (!near(sum, claimed)) {
      findings.push({
        id: `total-${index}`,
        kind: "total",
        severity:
          Math.abs(sum - claimed) > Math.max(0.5, Math.abs(claimed) * 0.005) ? "error" : "warning",
        line,
        message: `The ${above.length} amounts above add up to ${fmtLike(claimedRaw, sum)}, but this line says ${claimedRaw}.`,
        suggestion: fmtLike(claimedRaw, sum),
      });
    }
  });

  return findings;
}
