export { detectDocumentQuad } from "./detect";
export { enhanceImage } from "./enhance";
export {
  buildScanPdf,
  defaultScanFilename,
  setFillTextMode,
  setInvisibleOcrTextMode,
  type ScanPdfPage,
} from "./pdf";
export { recognizePage, recognizePageLines, groupOcrWords, disposeOcr } from "./ocr";
export { processPreview, pageFromProcessed, detectOrFallback, releasePage } from "./process";
export { buildSampleScanPhotos } from "./samples";
export { warpPerspective } from "./warp";
export {
  ENHANCE_PRESETS,
  SCAN_MAX_EDGE,
  type EnhancePreset,
  type OcrWord,
  type OcrLineBox,
  type ScanPage,
} from "./types";
export type { Quad, Point } from "./geometry";
