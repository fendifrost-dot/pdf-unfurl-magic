import { useEffect, useState } from "react";
import type { PageSlot } from "@/lib/page-order";

/** Cap so Organize Pages cannot recreate Acrobat's thumbnail RAM pile. */
export const PAGE_THUMB_LIMIT = 40;
const THUMB_WIDTH = 88;

export function usePageThumbs(slots: PageSlot[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (slots.length === 0 || slots.length > PAGE_THUMB_LIMIT) {
      setUrls({});
      return;
    }

    let cancelled = false;
    setUrls({});

    void (async () => {
      const { openDocument, renderPage } = await import("@/lib/pdf-runtime");
      const groups = new Map<ArrayBuffer, PageSlot[]>();
      for (const slot of slots) {
        const list = groups.get(slot.sourceBytes) ?? [];
        list.push(slot);
        groups.set(slot.sourceBytes, list);
      }

      for (const [bytes, group] of groups) {
        if (cancelled) return;
        let proxy: Awaited<ReturnType<typeof openDocument>> | null = null;
        try {
          proxy = await openDocument(bytes);
          for (const slot of group) {
            if (cancelled) return;
            try {
              const { canvas } = await renderPage(proxy, slot.sourcePage, THUMB_WIDTH);
              const url = canvas.toDataURL("image/jpeg", 0.72);
              if (!cancelled) {
                setUrls((prev) => ({ ...prev, [slot.id]: url }));
              }
            } catch {
              // Numbered cards still work if a page will not rasterize.
            }
          }
        } catch {
          // Same: strip falls back to labels.
        } finally {
          try {
            await proxy?.destroy();
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slots]);

  return urls;
}
