/** Pure browser-preview limits, deliberately separate from signature validation. */
export const PRESIDENT_PDFJS_VERSION = "6.5.438";
export const PRESIDENT_PDFJS_ASSET_ROOT = `/vendor/pdfjs/${PRESIDENT_PDFJS_VERSION}`;
export function presidentPdfPreviewOptions(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > 25 * 1024 * 1024) throw new Error("invalid_preview_bytes");
  return {
    // PDF.js transfers its data buffer to the worker. Preserve the caller's verified bytes.
    data: new Uint8Array(bytes),
    isEvalSupported: false, enableXfa: false, enableScripting: false,
    cMapUrl: `${PRESIDENT_PDFJS_ASSET_ROOT}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${PRESIDENT_PDFJS_ASSET_ROOT}/standard_fonts/`,
    wasmUrl: `${PRESIDENT_PDFJS_ASSET_ROOT}/wasm/`, iccUrl: `${PRESIDENT_PDFJS_ASSET_ROOT}/iccs/`,
    useWorkerFetch: true, useWasm: true, useSystemFonts: false,
    withCredentials: false, disableRange: true, disableStream: true, disableAutoFetch: true,
    stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 32_000_000,
    fontExtraProperties: false, pdfBug: false, verbosity: 0,
    disableWorkerRendering: true, enableHWA: false, enableWebGPU: false,
  };
}
export function presidentPdfCanvasGeometry(width: number, height: number, availableWidth: number, deviceRatio: number) {
  if (![width, height, availableWidth, deviceRatio].every(Number.isFinite) || width <= 0 || height <= 0 || width > 100_000 || height > 100_000 || availableWidth <= 0 || deviceRatio <= 0) throw new Error("invalid_preview_viewport");
  const scale = Math.min(Math.max(1, Math.min(1400, availableWidth)) / width, 10_000 / height);
  const cssWidth = width * scale, cssHeight = height * scale;
  const outputScale = Math.min(Math.max(1, deviceRatio), 2, Math.sqrt(8_000_000 / (cssWidth * cssHeight)), 16_000 / cssWidth, 16_000 / cssHeight);
  return { scale, outputScale, cssWidth, cssHeight, pixelWidth: Math.max(1, Math.floor(cssWidth * outputScale)), pixelHeight: Math.max(1, Math.floor(cssHeight * outputScale)) };
}
export function presidentPdfPageNumber(page: number, total: number) {
  if (!Number.isInteger(page) || !Number.isInteger(total) || total < 1 || total > 1000) throw new Error("invalid_preview_page");
  return Math.max(1, Math.min(total, page));
}
