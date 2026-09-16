import { useCallback, useState } from "react";
import { isPdfPasswordError, openPdfBytes, type OpenedPdf } from "@/lib/pdf-open";

export type PdfPasswordPrompt = {
  name: string;
  bytes: ArrayBuffer;
  incorrect: boolean;
};

export function useOpenPdf() {
  const [prompt, setPrompt] = useState<PdfPasswordPrompt | null>(null);

  const openPdf = useCallback(
    async (name: string, bytes: ArrayBuffer, password?: string): Promise<OpenedPdf | null> => {
      try {
        const opened = await openPdfBytes(bytes, password);
        setPrompt(null);
        return opened;
      } catch (error) {
        if (isPdfPasswordError(error)) {
          setPrompt({
            name,
            bytes,
            // A submitted password that still fails should show retry copy.
            incorrect: error.kind === "incorrect-password" || password !== undefined,
          });
          return null;
        }
        throw error;
      }
    },
    [],
  );

  const cancelPrompt = useCallback(() => setPrompt(null), []);

  return { prompt, openPdf, cancelPrompt };
}
