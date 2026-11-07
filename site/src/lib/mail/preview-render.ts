import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Mail } from "./index";

type Node = DefaultTreeAdapterMap["node"];
const LIMIT = 256 * 1024;
const HTML_NS = "http://www.w3.org/1999/xhtml";
const TAGS = new Set(["p", "div", "span", "table", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code"]);
const DROP = new Set(["head", "script", "style", "iframe", "object", "embed", "svg", "math", "template", "form", "textarea", "noscript"]);
const VOID = new Set(["br", "hr", "col"]);
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "");
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** These are conservative display masks, not an authorization mechanism or general secret classifier. */
const patterns = [
  /(?:https?:\/\/|www\.)[^\s<>"']+/gi,
  /\/(?:confirmar|admin|whatsapp|identidade|corrigir|cancelar|redefinir|verificar)[^\s<>"']*/gi,
  /[A-Za-z0-9_-]{24,}/g,
  /[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}/gi,
  /\b[0-9A-HJKMNP-TV-Z]{10}\b/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{11}\b/g,
  /(?:\d\s*){6}/g,
];
type Range = { start: number; end: number };
function ranges(text: string): Range[] {
  const found: Range[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) found.push({ start: match.index!, end: match.index! + match[0].length });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Range[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push({ ...range });
  }
  return merged;
}
function maskedPart(text: string, offset: number, masks: Range[]) {
  let result = "", at = 0, low = 0, high = masks.length;
  while (low < high) { const middle = (low + high) >>> 1; if (masks[middle].end <= offset) low = middle + 1; else high = middle; }
  for (let i = low; i < masks.length; i++) {
    const mask = masks[i];
    if (mask.start >= offset + text.length) break;
    const start = Math.max(0, mask.start - offset), end = Math.min(text.length, mask.end - offset);
    result += text.slice(at, start);
    if (mask.start >= offset) result += "[restrito]";
    at = end;
  }
  return result + text.slice(at);
}
export function redactPreviewText(raw: string) {
  const text = clean(raw); return maskedPart(text, 0, ranges(text));
}
function safeStyle(raw: string) {
  if (raw.length > 2000) return "";
  const result: string[] = [];
  for (const declaration of raw.split(";")) {
    const split = declaration.indexOf(":"), property = declaration.slice(0, split).trim().toLowerCase(), value = declaration.slice(split + 1).trim();
    if (split < 1 || /[\\()@!{}<>]/.test(value)) continue;
    const color = /^(?:#[a-f\d]{3,8}|white|black|transparent)$/i.test(value);
    let allowed = ["color", "background", "background-color", "border-color"].includes(property) && color;
    allowed ||= ["padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "border-radius"].includes(property) && /^(?:0|\d{1,2}px)(?: (?:0|\d{1,2}px)){0,3}$/.test(value);
    allowed ||= ["width", "max-width", "height", "min-height"].includes(property) && /^(?:auto|0|\d{1,3}px|100%)$/.test(value);
    allowed ||= property === "font-size" && /^(?:[1-6]?\d|7[0-2])px$/.test(value);
    allowed ||= property === "font-weight" && /^(?:normal|bold|[1-9]00)$/.test(value);
    allowed ||= property === "line-height" && /^(?:[0-3](?:\.\d{1,2})?|\d{1,2}px)$/.test(value);
    allowed ||= property === "text-align" && /^(?:left|right|center|justify)$/.test(value);
    allowed ||= property === "vertical-align" && /^(?:top|middle|bottom|baseline)$/.test(value);
    allowed ||= property === "text-decoration" && /^(?:none|underline|line-through)$/.test(value);
    allowed ||= property === "text-transform" && /^(?:none|uppercase|lowercase|capitalize)$/.test(value);
    allowed ||= property === "border-collapse" && /^(?:collapse|separate)$/.test(value);
    allowed ||= property === "display" && /^(?:block|inline|inline-block|none)$/.test(value);
    allowed ||= property === "white-space" && /^(?:normal|pre-wrap)$/.test(value);
    allowed ||= property === "border" && /^(?:0|[0-3]px solid #[a-f\d]{3,8})$/i.test(value);
    if (allowed) result.push(`${property}:${value}`);
  }
  return result.join(";");
}
/** Parse HTML as a browser, then emit only fixed safe tags/attributes. No original HTML is returned. */
export function renderMailPreview(mail: Mail) {
  const html = mail.html ?? `<pre>${esc(mail.text)}</pre>`;
  if (Buffer.byteLength(html) > LIMIT || Buffer.byteLength(mail.text) > LIMIT || Buffer.byteLength(mail.subject) > 2048 || (html.match(/</g)?.length ?? 0) > 4000) return { state: "limited" as const };
  const document = parse(html);
  type Part = { html: string } | { text: string; offset: number };
  const parts: Part[] = [], text: string[] = [];
  const stack: { node?: Node; depth: number; closing?: string }[] = [{ node: document, depth: 0 }];
  let offset = 0, count = 0, omittedImages = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.closing) { parts.push({ html: frame.closing }); continue; }
    if (++count > 10000 || frame.depth > 80) return { state: "limited" as const };
    const node = frame.node!;
    if (node.nodeName === "#text" && "value" in node) {
      const value = clean(node.value); parts.push({ text: value, offset }); text.push(value); offset += value.length; continue;
    }
    if ("tagName" in node) {
      if (node.namespaceURI !== HTML_NS || DROP.has(node.tagName)) continue;
      if (node.tagName === "img") { omittedImages++; continue; }
      const tag = node.tagName === "a" || node.tagName === "body" ? "div" : node.tagName;
      if (TAGS.has(tag)) {
        const attrs = new Map(node.attrs.map(a => [a.name, a.value]));
        const style = safeStyle(attrs.get("style") ?? "");
        let attributes = style ? ` style="${esc(style)}"` : "";
        if (["td", "th"].includes(tag)) for (const name of ["colspan", "rowspan"]) {
          const value = attrs.get(name); if (value && /^[1-9]\d?$/.test(value)) attributes += ` ${name}="${value}"`;
        }
        parts.push({ html: `<${tag}${attributes}>` });
        if (!VOID.has(tag)) stack.push({ closing: `</${tag}>`, depth: frame.depth });
      }
    }
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], depth: frame.depth + 1 });
  }
  const masks = ranges(text.join(""));
  const body = parts.map(part => "html" in part ? part.html : esc(maskedPart(part.text, part.offset, masks))).join("");
  const subject = redactPreviewText(mail.subject);
  const documentHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(PREVIEW_CSP)}"><meta name="referrer" content="no-referrer"><title>${esc(subject)}</title><style>body{margin:0;padding:12px;background:#eef3f0;color:#1b2b24;font:16px/1.5 Arial,sans-serif;overflow-wrap:anywhere}table{max-width:100%;table-layout:fixed}pre{white-space:pre-wrap}*{box-sizing:border-box}</style></head><body>${body}</body></html>`;
  return { state: "ready" as const, subject, text: redactPreviewText(mail.text), html: documentHtml, transformed: true as const, omittedImages,
    attachments: (mail.attachments ?? []).slice(0, 100).map(a => ({ filename: redactPreviewText(a.filename.split(/[\\/]/).pop() ?? "").slice(0, 200), bytes: a.content.length })),
    attachmentsTruncated: (mail.attachments?.length ?? 0) > 100 };
}
