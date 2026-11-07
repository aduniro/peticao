import { Marked, Renderer } from "marked";

const escape = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const renderer = new Renderer();
renderer.html = token => escape(token.text);
renderer.image = token => escape(token.text || "Imagem"); // No remote images or tracking pixels from Markdown.
renderer.codespan = token => `<code style="font-family:Consolas,monospace;font-size:0.94em;overflow-wrap:anywhere;word-break:break-all">${escape(token.text)}</code>`;
renderer.link = function(token) {
  const text = this.parser.parseInline(token.tokens);
  const href = token.href?.trim() ?? "";
  if (!/^(https?:\/\/|mailto:)[^\s<>\u0000-\u001f]+$/i.test(href)) return text;
  return `<a href="${escape(href)}" style="color:#086647;text-decoration:underline">${text}</a>`;
};
renderer.heading = function(token) {
  const size = token.depth === 1 ? 24 : token.depth === 2 ? 20 : 17;
  return `<h${token.depth} style="font-family:Arial,Helvetica,sans-serif;font-size:${size}px;line-height:1.35;color:#153c32;margin:24px 0 12px">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
};
renderer.paragraph = function(token) {
  return `<p style="margin:0 0 14px;line-height:1.6">${this.parser.parseInline(token.tokens)}</p>\n`;
};
renderer.table = function(token) {
  const cell = (value, i, header) => {
    const firstWidth = token.header.length === 3 && token.header[0].text.length > 20 ? 60 : 40;
    const width = i === 0 ? firstWidth : (100-firstWidth)/Math.max(1,token.header.length-1);
    const tag = header ? "th" : "td", alignment = ["left","center","right"].includes(token.align[i]) ? token.align[i] : "left";
    return `<${tag}${header ? ' scope="col"' : ""} style="${header ? `width:${width}%;` : ""}border:1px solid #cbd8d2;padding:9px 10px;text-align:${alignment};vertical-align:top;overflow-wrap:anywhere;${header ? "background-color:#e7f2ec;font-weight:bold;color:#153c32;" : "background-color:#ffffff;"}">${this.parser.parseInline(value.tokens)}</${tag}>`;
  };
  return `<div style="max-width:100%;overflow-x:auto;margin:16px 0 22px"><table role="table" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;width:100%;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45"><thead><tr>${token.header.map((v,i)=>cell(v,i,true)).join("")}</tr></thead><tbody>${token.rows.map(row=>`<tr>${row.map((v,i)=>cell(v,i,false)).join("")}</tr>`).join("")}</tbody></table></div>\n`;
};
const markdown = new Marked({ gfm:true, breaks:false, async:false, renderer });

/** HTML alternative for mail clients; Markdown is parsed, never sent as unrendered HTML. */
export function markdownParaHtml(texto) {
  if (typeof texto !== "string") throw new TypeError("email_text_required");
  const content = markdown.parse(texto);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório da petição</title></head><body style="margin:0;padding:20px 12px;background-color:#f3f6f4;color:#202d27;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6"><table role="presentation" style="table-layout:fixed;width:100%" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><div style="box-sizing:border-box;width:100%;max-width:960px;margin:0 auto;padding:20px;background-color:#ffffff;border:1px solid #dce5df;text-align:left">${content}</div></td></tr></table></body></html>`;
}
export function formatarCorpoEmail({ html, texto }) {
  if (typeof html === "string" && html.trim()) return { html, texto };
  if (typeof texto !== "string" || !texto.trim()) throw new TypeError("email_body_required");
  return { html:markdownParaHtml(texto), texto };
}
