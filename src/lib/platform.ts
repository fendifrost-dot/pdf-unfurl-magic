/**
 * Runtime environment helpers for the phone / desktop / Electron shells.
 * Detection is client-only; callers should treat the first render as unknown.
 */
import { isDesktopApp } from "./desktop";

export { isDesktopApp };

export function isBrowser() {
  return typeof window !== "undefined";
}

/** Standalone PWA (added to Home Screen) or Electron. */
export function isStandaloneDisplay() {
  if (!isBrowser()) return false;
  if (isDesktopApp()) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function prefersCoarsePointer() {
  if (!isBrowser()) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function isLikelyMobileViewport(breakpoint = 768) {
  if (!isBrowser()) return false;
  return window.innerWidth < breakpoint;
}

export function canSharePdfFile() {
  if (!isBrowser() || isDesktopApp()) return false;
  const file = new File([new Uint8Array([37, 80, 68, 70])], "probe.pdf", {
    type: "application/pdf",
  });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (typeof nav.share !== "function") return false;
  if (typeof nav.canShare === "function") {
    try {
      return nav.canShare({ files: [file] });
    } catch {
      return false;
    }
  }
  return "files" in (navigator as Navigator);
}

export function canShareText() {
  if (!isBrowser() || isDesktopApp()) return false;
  return typeof navigator.share === "function";
}
