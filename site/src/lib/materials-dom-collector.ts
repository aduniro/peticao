import type { LayoutBox, LayoutRect, MaterialLayoutSample, MaterialPanelMetrics } from "./materials-layout";

/** Read-only, self-contained page.evaluate callback. It produces no provenance or fit verdict. */
export function collectMaterialLayout(): MaterialLayoutSample {
  const fail = (code: string): never => { throw new Error(code); };
  const finite = (v: number, min = 0, max = 32768) => Number.isFinite(v) && v >= min && v <= max;
  const rect = (el: Element): LayoutRect => {
    const r = el.getBoundingClientRect();
    if (!finite(r.x, -32768) || !finite(r.y, -32768) || !finite(r.width) || !finite(r.height)) fail("collector_invalid_rect");
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const box = (el: Element): LayoutBox => {
    const values = [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight];
    if (!values.every(v => finite(v) && Number.isInteger(v))) fail("collector_invalid_box");
    return { rect: rect(el), clientWidth: values[0], clientHeight: values[1], scrollWidth: values[2], scrollHeight: values[3] };
  };
  const errors = new Set<string>();
  const clipped = (el: Element) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility !== "visible" || s.opacity !== "1" || s.contentVisibility !== "visible") errors.add("hidden_style");
    if (s.transform !== "none" || s.filter !== "none" && !(el.tagName === "IMG" && s.filter === "grayscale(1)")) errors.add("unsupported_effect");
    return [s.overflowX, s.overflowY].some(v => v !== "visible") || s.clipPath !== "none" ||
      s.clip !== "auto" || s.maskImage !== "none" || s.textOverflow === "ellipsis" || !["none", "0", ""].includes(s.webkitLineClamp);
  };
  const noExtraText = (el: Element) => {
    if (Array.from(el.childNodes).some(n => n.nodeType === 3 && n.nodeValue?.trim())) fail("collector_invalid_structure");
  };
  const exact = (el: Element, tag: string, className: string) => {
    if (el.tagName !== tag || el.className !== className) fail("collector_invalid_structure");
  };
  const sheets = document.querySelectorAll("[data-material-sheet]");
  if (sheets.length !== 1 || document.body.children.length !== 1 || document.body.firstElementChild !== sheets[0]) fail("collector_invalid_structure");
  const sheet = sheets[0]; exact(sheet, "MAIN", "sheet");
  noExtraText(document.body); noExtraText(sheet);
  const children = Array.from(sheet.children);
  if (![1, 4].includes(children.length) || document.querySelectorAll("[data-material-panel]").length !== children.length) fail("collector_invalid_structure");
  for (const el of [document.documentElement, document.body, sheet]) if (clipped(el)) errors.add("ancestor_clipping");
  const kinds = ["brand", "title", "body", "action", "footer"] as const;
  const tags = ["DIV", "H1", "P", "P", "P"];
  const classes = ["brand", "", "body", "action", "footer"];
  const panels: MaterialPanelMetrics[] = children.map((panel, index) => {
    exact(panel, "SECTION", "panel"); noExtraText(panel);
    if (!panel.hasAttribute("data-material-panel") || panel.children.length !== 5) fail("collector_invalid_structure");
    if (clipped(panel)) errors.add("ancestor_clipping");
    const blocks = Array.from(panel.children).map((el, i) => {
      exact(el, tags[i], classes[i]);
      if (i > 0 && el.children.length !== 0 || i === 0 && el.children.length !== 1) fail("collector_invalid_structure");
      return { kind: kinds[i], box: box(el), clipped: clipped(el) };
    });
    const img = panel.children[0].children[0] as HTMLImageElement;
    exact(img, "IMG", ""); noExtraText(panel.children[0]);
    if (img.children.length || !Number.isInteger(img.naturalWidth) || !Number.isInteger(img.naturalHeight) ||
        !finite(img.naturalWidth, 0, 16384) || !finite(img.naturalHeight, 0, 16384)) fail("collector_invalid_image");
    if (clipped(img)) errors.add("image_clipping");
    return { index, box: box(panel), blocks, image: { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, rect: rect(img) } };
  });
  const timeMs = performance.now(), width = window.innerWidth, height = window.innerHeight;
  if (!finite(timeMs, 0, 3600000) || !finite(width, 1, 8192) || !finite(height, 1, 8192) ||
      !Number.isInteger(width) || !Number.isInteger(height) || window.devicePixelRatio !== 1) fail("collector_invalid_environment");
  return { timeMs, deviceScaleFactor: 1, viewport: { width, height }, fontsReady: document.fonts.status === "loaded",
    errors: [...errors], sheet: box(sheet), panels };
}
