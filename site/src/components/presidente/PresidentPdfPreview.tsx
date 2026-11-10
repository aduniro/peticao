"use client";

import { useEffect, useRef, useState } from "react";
import { PRESIDENT_PDFJS_ASSET_ROOT, PRESIDENT_PDFJS_VERSION, presidentPdfCanvasGeometry, presidentPdfPageNumber, presidentPdfPreviewOptions } from "@/lib/president-pdf-preview";

type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPage = { getViewport: (input: { scale: number }) => PdfViewport; render: (input: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; transform?: number[]; annotationMode: number; intent: string }) => PdfRenderTask; cleanup: () => void };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };
type PdfLoadingTask = { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
type PdfJsWorker = { destroy: () => void };
type PdfJsApi = { PDFWorker: { create: (input: { port: Worker }) => PdfJsWorker }; version: string; GlobalWorkerOptions: { workerSrc: string }; AnnotationMode: { DISABLE: number }; getDocument: (options: ReturnType<typeof presidentPdfPreviewOptions> & { worker: PdfJsWorker }) => PdfLoadingTask };

/** Display-only canvas. No PDF viewer, iframe, text/annotation/scripting layers or server upload. */
export default function PresidentPdfPreview({ bytes, onRendered }: { bytes: Uint8Array; onRendered?: (page: number, total: number) => void }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<PdfRenderTask | null>(null), renderQueue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0), callback = useRef(onRendered);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [width, setWidth] = useState(0), [page, setPage] = useState(1);
  const [status, setStatus] = useState<"loading" | "rendering" | "ready" | "error">("loading");
  useEffect(() => { callback.current = onRendered; }, [onRendered]);
  useEffect(() => {
    const element = host.current;if (!element) return;
    const measure = () => setWidth(Math.max(1, Math.floor(element.getBoundingClientRect().width - 2)));
    measure();const observer = new ResizeObserver(measure);observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false, loading: PdfLoadingTask | undefined, port: Worker | undefined, worker: PdfJsWorker | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const destroy = () => { if (deadline) clearTimeout(deadline);if (loading) void loading.destroy().catch(() => {});worker?.destroy();port?.terminate(); };
    generation.current++;renderTask.current?.cancel();setDocument(null);setPage(1);setStatus("loading");
    void (async () => {
      try {
        const options = presidentPdfPreviewOptions(bytes);
        const moduleUrl = `${PRESIDENT_PDFJS_ASSET_ROOT}/pdf.mjs`;
        // Served assets are pinned by prepare-pdfjs-assets.mjs; never evaluate this library in Node/SSR.
        const api = await import(/* webpackIgnore: true */ moduleUrl) as PdfJsApi;
        if (cancelled) return;
        if (api.version !== PRESIDENT_PDFJS_VERSION || typeof api.getDocument !== "function" || !api.GlobalWorkerOptions || api.AnnotationMode?.DISABLE !== 0 || !api.PDFWorker?.create || typeof Worker === "undefined") throw new Error("pdf_preview_runtime_mismatch");
        api.GlobalWorkerOptions.workerSrc = `${PRESIDENT_PDFJS_ASSET_ROOT}/pdf.worker.mjs`;
        port = new Worker(`${PRESIDENT_PDFJS_ASSET_ROOT}/pdf.worker.mjs`, { type: "module", name: "president-pdf-preview" });
        worker = api.PDFWorker.create({ port });
        deadline = setTimeout(() => { if (!cancelled) { setStatus("error");destroy(); } }, 45_000);
        loading = api.getDocument({ ...options, worker });
        const pdf = await loading.promise;if (deadline) clearTimeout(deadline);
        if (cancelled) { destroy();return; }
        if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 1000) throw new Error("pdf_preview_page_limit");
        setDocument(pdf);
      } catch { if (!cancelled) setStatus("error");destroy(); }
    })();
    return () => { cancelled = true;generation.current++;renderTask.current?.cancel();destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!document || !width || !canvas.current) return;
    const epoch = ++generation.current, element = canvas.current;
    let cancelled = false;
    renderTask.current?.cancel();setStatus("rendering");
    const current = () => !cancelled && generation.current === epoch;
    const work = async () => {
      let pdfPage: PdfPage | undefined, task: PdfRenderTask | undefined;
      try {
        if (!current()) return;
        pdfPage = await document.getPage(presidentPdfPageNumber(page, document.numPages));
        if (!current()) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const geometry = presidentPdfCanvasGeometry(original.width, original.height, width, window.devicePixelRatio || 1);
        const viewport = pdfPage.getViewport({ scale: geometry.scale }), context = element.getContext("2d", { alpha: false });
        if (!context) throw new Error("canvas_unavailable");
        element.width = geometry.pixelWidth;element.height = geometry.pixelHeight;
        element.style.width = `${geometry.cssWidth}px`;element.style.height = `${geometry.cssHeight}px`;
        task = pdfPage.render({ canvas: element, canvasContext: context, viewport, transform: geometry.outputScale === 1 ? undefined : [geometry.outputScale, 0, 0, geometry.outputScale, 0, 0], annotationMode: 0, intent: "display" });
        renderTask.current = task;
        const deadline = setTimeout(() => { task?.cancel();if (current()) setStatus("error"); }, 45_000);
        try { await task.promise; } finally { clearTimeout(deadline); }
        if (current()) { setStatus("ready");callback.current?.(page, document.numPages); }
      } catch { if (current()) setStatus("error"); }
      finally { if (renderTask.current === task) renderTask.current = null;try { pdfPage?.cleanup(); } catch { /* A destroyed document can finish cleanup concurrently. */ } }
    };
    // A canvas cannot be used by concurrent renders, including cancelled renders still settling.
    renderQueue.current = renderQueue.current.catch(() => {}).then(work);
    return () => { cancelled = true;generation.current++;renderTask.current?.cancel(); };
  }, [document, page, width]);
  return <section aria-label="Prévia do PDF conferido" style={{ minWidth: 0 }}>
    {document && <div className="seg-row" role="group" aria-label="Páginas do documento">
      <button type="button" disabled={page <= 1 || status === "loading" || status === "rendering"} onClick={() => setPage(value => presidentPdfPageNumber(value - 1, document.numPages))}>Página anterior</button>
      <span aria-live="polite">Página {page} de {document.numPages}</span>
      <button type="button" disabled={page >= document.numPages || status === "loading" || status === "rendering"} onClick={() => setPage(value => presidentPdfPageNumber(value + 1, document.numPages))}>Próxima página</button>
    </div>}
    <div ref={host} style={{ width: "100%", minWidth: 0, overflow: "hidden", border: "1px solid var(--line)", background: "#fff" }} aria-busy={status === "loading" || status === "rendering"}>
      <canvas ref={canvas} role="img" aria-label={`Prévia da página ${page}`} style={{ display: status === "error" ? "none" : "block", maxWidth: "100%", margin: "0 auto" }} />
    </div>
    <p role="status" aria-live="polite" className="small">{status === "error" ? "Prévia indisponível. Você pode baixar o PDF conferido." : status === "ready" ? "Prévia carregada." : "Carregando prévia…"}</p>
  </section>;
}
