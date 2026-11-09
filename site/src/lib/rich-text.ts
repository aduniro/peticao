import { Marked } from "marked";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { isRichFormat, type RichFormat } from "./rich-text-format";
import { escapeRichText as esc } from "./rich-text-preview";

const markdown = new Marked({ gfm: true, breaks: false, async: false });
type Node = DefaultTreeAdapterMap["node"];
const ALLOWED = new Set(["p", "div", "span", "br", "hr", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "h4", "blockquote", "pre", "code", "ul", "ol", "li", "a", "table", "thead", "tbody", "tfoot", "tr", "td", "th"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "textarea", "select", "option", "template", "noscript", "video", "audio", "canvas", "img", "picture", "source", "link", "meta", "base"]);
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "blockquote", "pre", "ul", "ol", "li", "table", "tr"]);
const EMPTY = { html: "", previewHtml: "", text: "" };
function safeHref(raw: string | undefined) {
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    if (url.protocol === "mailto:" && !url.search && !url.hash && /^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(decodeURIComponent(url.pathname))) return url.href;
  } catch { /* Malformed/relative/unknown protocols are text, never active attributes. */ }
  return null;
}
/** Server only. Original markup never leaves this function as trusted HTML.
 * Mail HTML retains only validated links; previewHtml removes even their destinations.
 */
export function renderRichText(source: string, format: RichFormat) {
  if (typeof source !== "string" || source.length > 20_000 || source.includes("\0") || !isRichFormat(format)) throw new Error("rich_text_parameters");
  if (format === "texto") { const html = `<p>${esc(source).replace(/\r?\n/g, "<br>")}</p>`; return { html, previewHtml: html, text: source }; }
  const markup = format === "markdown" ? markdown.parse(source, { async: false }) : source;
  if (typeof markup !== "string" || markup.length > 100_000) throw new Error("rich_text_limit");
  const tree = parseFragment(markup); let nodes = 0;
  function walk(node: Node, depth = 0): { html: string; previewHtml: string; text: string } {
    if (++nodes > 10_000 || depth > 60) throw new Error("rich_text_limit");
    if ("value" in node) return { html: esc(node.value), previewHtml: esc(node.value), text: node.value };
    const tag = "tagName" in node ? node.tagName : null;
    if (tag && (node.namespaceURI !== "http://www.w3.org/1999/xhtml" || DROP.has(tag))) return EMPTY;
    const parts = "childNodes" in node ? node.childNodes.map(child => walk(child, depth + 1)) : [];
    const body = { html: parts.map(p => p.html).join(""), previewHtml: parts.map(p => p.previewHtml).join(""), text: parts.map(p => p.text).join("") };
    if (!tag || !ALLOWED.has(tag)) return body;
    if (tag === "br" || tag === "hr") return { html: `<${tag}>`, previewHtml: `<${tag}>`, text: "\n" };
    let attributes = "", text = body.text;
    if (tag === "a" && "attrs" in node) {
      const href = safeHref(node.attrs.find(a => a.name === "href")?.value);
      if (href) { attributes = ` href="${esc(href)}" rel="noreferrer noopener"`; if (text.trim() !== href) text += ` (${href})`; }
    }
    if (tag === "li") text = `\n- ${text.trim()}\n`;
    else if (BLOCK.has(tag)) text = `\n${text}\n`;
    else if (tag === "td" || tag === "th") text += "\t";
    return { html: `<${tag}${attributes}>${body.html}</${tag}>`, previewHtml: `<${tag}>${body.previewHtml}</${tag}>`, text };
  }
  const result = walk(tree);
  return { ...result, text: result.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
}
