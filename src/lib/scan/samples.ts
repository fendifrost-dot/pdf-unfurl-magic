import { makeCanvas, canvasContext } from "./image";

type SampleSpec = {
  filename: string;
  title: string;
  kind: "color" | "whiteboard" | "receipt";
  angle: number;
};

const SAMPLES: SampleSpec[] = [
  { filename: "delivery-docket.jpg", title: "Delivery docket", kind: "color", angle: -7.5 },
  { filename: "install-board.jpg", title: "Install sequence", kind: "whiteboard", angle: 6 },
  { filename: "timber-receipt.jpg", title: "Timber yard receipt", kind: "receipt", angle: -4 },
];

function fillDesk(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#3a2c22";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.fillStyle = `rgba(${40 + Math.random() * 40}, ${28 + Math.random() * 24}, ${18 + Math.random() * 16}, 0.35)`;
    ctx.fillRect(x, y, 2 + Math.random() * 10, 1);
  }
}

function drawColorDocket(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8c3b1e";
  ctx.fillRect(0, 0, w, 86);
  ctx.fillStyle = "#fff8ee";
  ctx.font = "700 42px Georgia, serif";
  ctx.fillText("Northgate Joinery", 48, 56);
  ctx.fillStyle = "#2b241c";
  ctx.font = "600 28px Georgia, serif";
  ctx.fillText("Delivery docket 2026-118", 48, 140);
  ctx.font = "16px ui-sans-serif, system-ui";
  ctx.fillStyle = "#5b5146";
  ctx.fillText("14 Wren Street  ·  kitchen bench rebuild", 48, 172);
  const rows = [
    ["European oak worktop, 40mm", "3 m"],
    ["Cabinet carcasses, birch ply", "6"],
    ["Soft-close hinges", "12"],
    ["Finish oil, three coats", "1"],
  ];
  ctx.font = "600 15px ui-sans-serif, system-ui";
  ctx.fillStyle = "#2b241c";
  ctx.fillText("Description", 48, 230);
  ctx.fillText("Qty", w - 160, 230);
  ctx.strokeStyle = "#d7c8b2";
  ctx.beginPath();
  ctx.moveTo(48, 242);
  ctx.lineTo(w - 48, 242);
  ctx.stroke();
  ctx.font = "16px ui-sans-serif, system-ui";
  rows.forEach((row, i) => {
    const y = 280 + i * 42;
    ctx.fillStyle = "#2b241c";
    ctx.fillText(row[0]!, 48, y);
    ctx.fillText(row[1]!, w - 160, y);
  });
  ctx.font = "15px ui-sans-serif, system-ui";
  ctx.fillStyle = "#6a5d50";
  ctx.fillText(
    "Leave in the workshop file. Do not open this in Acrobat Organize Pages.",
    48,
    h - 64,
  );
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#eef2f3";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c5ced1";
  ctx.lineWidth = 2;
  for (let x = 40; x < w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 40; y < h; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#1d4f7a";
  ctx.font = "700 36px ui-sans-serif, system-ui";
  ctx.fillText("Install sequence", 56, 92);
  const lines = [
    "1. Dry-fit carcasses, check scribe.",
    "2. Worktop template — leave 2mm.",
    "3. Hinges only after oil coat 2.",
    "4. Photograph joints before leave.",
  ];
  ctx.font = "22px ui-sans-serif, system-ui";
  ctx.fillStyle = "#14324a";
  lines.forEach((line, i) => ctx.fillText(line, 56, 170 + i * 56));
  ctx.fillStyle = "#9a3412";
  ctx.font = "700 20px ui-sans-serif, system-ui";
  ctx.fillText("Do not rasterize the whole job file.", 56, 430);
}

function drawReceipt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1f1a14";
  ctx.font = "700 22px ui-monospace, monospace";
  ctx.fillText("HALE TIMBER  YARD", 36, 56);
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText("VAT 128 4401 19", 36, 80);
  ctx.fillText("14 SEP 2026   10:42", 36, 102);
  ctx.fillText("--------------------------------", 36, 128);
  const items = [
    ["OAK 40MM 3.0M", "186.00"],
    ["PLY 18MM 2440", "74.40"],
    ["BISCUITS #20", "6.80"],
  ];
  items.forEach((item, i) => {
    ctx.fillText(item[0]!, 36, 160 + i * 24);
    ctx.fillText(item[1]!, w - 130, 160 + i * 24);
  });
  ctx.fillText("--------------------------------", 36, 248);
  ctx.font = "700 14px ui-monospace, monospace";
  ctx.fillText("TOTAL   267.20", 36, 278);
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText("Card **** 4412", 36, 310);
  ctx.fillText("Keep for the job wallet.", 36, 340);
}

function renderClean(spec: SampleSpec): HTMLCanvasElement {
  const width = spec.kind === "receipt" ? 520 : 900;
  const height = spec.kind === "receipt" ? 720 : 1200;
  const canvas = makeCanvas(width, height);
  const ctx = canvasContext(canvas);
  if (spec.kind === "color") drawColorDocket(ctx, width, height);
  else if (spec.kind === "whiteboard") drawWhiteboard(ctx, width, height);
  else drawReceipt(ctx, width, height);
  return canvas;
}

function photograph(page: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const pad = 160;
  const width = page.width + pad * 2;
  const height = page.height + pad * 2;
  const photo = makeCanvas(width, height);
  const ctx = canvasContext(photo);
  fillDesk(ctx, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(page, -page.width / 2, -page.height / 2);
  ctx.restore();
  return photo;
}

async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error("Could not build a sample page."))),
      "image/jpeg",
      0.9,
    );
  });
  return new File([blob], name, { type: "image/jpeg" });
}

/** Three photographed workshop pages so a session can be tried without a camera. */
export async function buildSampleScanPhotos(): Promise<File[]> {
  const files: File[] = [];
  for (const spec of SAMPLES) {
    files.push(await canvasToFile(photograph(renderClean(spec), spec.angle), spec.filename));
  }
  return files;
}
