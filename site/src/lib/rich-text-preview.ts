export const escapeRichText = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const RICH_PREVIEW_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'";
/** Only accepts previewHtml produced by the server formatter, not arbitrary original HTML.
 * The caller must also set iframe sandbox="". No allow-scripts/allow-same-origin.
 */
export function richTextPreviewDocument(previewHtml: string, title = "Prévia") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${RICH_PREVIEW_CSP}"><title>${escapeRichText(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:16px;color:#16352a;background:#fff;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #d5e0da;padding:6px}pre{white-space:pre-wrap}a{color:#006c48}</style></head><body>${previewHtml}</body></html>`;
}
