export type DesktopPdfFile = {
  name: string;
  data: Uint8Array | ArrayBuffer | number[] | { type: "Buffer"; data: number[] };
};

export type PdfReliefDesktop = {
  isDesktop: true;
  pickPdf: () => Promise<DesktopPdfFile | null>;
  pickPdfs: () => Promise<DesktopPdfFile[] | null>;
  pickImages?: () => Promise<DesktopPdfFile[] | null>;
  takePendingPdf: () => Promise<DesktopPdfFile | null>;
  saveFile: (payload: { name: string; data: Uint8Array }) => Promise<string | null>;
  onPdfReady: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    pdfReliefDesktop?: PdfReliefDesktop;
  }
}

export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean(window.pdfReliefDesktop);
}

export function toDesktopBytes(data: DesktopPdfFile["data"]): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (data && Array.isArray(data.data)) return Uint8Array.from(data.data);
  throw new Error("Could not read that PDF from the desktop dialog.");
}

export async function pickDesktopPdf(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const api = window.pdfReliefDesktop;
  if (!api) return null;
  const picked = await api.pickPdf();
  if (!picked) return null;
  return { name: picked.name, bytes: toDesktopBytes(picked.data) };
}

export async function pickDesktopPdfs(): Promise<{ name: string; bytes: Uint8Array }[] | null> {
  const api = window.pdfReliefDesktop;
  if (!api) return null;
  const picked = await api.pickPdfs();
  if (!picked || picked.length === 0) return null;
  return picked.map((file) => ({ name: file.name, bytes: toDesktopBytes(file.data) }));
}

export async function pickDesktopImages(): Promise<File[] | null> {
  const api = window.pdfReliefDesktop;
  if (!api?.pickImages) return null;
  const picked = await api.pickImages();
  if (!picked || picked.length === 0) return null;
  return picked.map((file) => {
    const bytes = toDesktopBytes(file.data);
    const lower = file.name.toLowerCase();
    const type = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return new File([bytes.slice(0) as unknown as BlobPart], file.name, { type });
  });
}
