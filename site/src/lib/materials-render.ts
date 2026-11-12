import { createHash } from "node:crypto";
import { materialContent, materialDigest } from "./materials-contract";

const ASSETS = {
  adunir: "/logos/adunir.png",
  "adunir-andes": "/logos/adunir-andes.png",
  andes: "/logos/andes.png",
} as const;

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A preview only. Export must measure every panel and refuse overflow first. */
export function renderMaterialPreview(value: unknown) {
  const content = materialContent(value);
  if (!content) throw new Error("material_content_invalid");
  const mono = content.template === "flyer-mono-cut-v1";
  const social = content.template === "social-square-v1";
  const copies = mono ? 4 : 1;
  const width = social ? "1080px" : "210mm";
  const height = social ? "1080px" : "297mm";
  const style = `
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#142720}
body{font-family:Arial,Helvetica,sans-serif}h1,p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.sheet{width:${width};height:${height};display:grid;grid-template-columns:${mono ? "1fr 1fr" : "1fr"};grid-template-rows:${mono ? "1fr 1fr" : "1fr"};background:#fff}
.panel{min-width:0;min-height:0;display:flex;flex-direction:column;padding:${social ? "64px" : mono ? "9mm" : "15mm"};gap:${social ? "28px" : mono ? "4mm" : "7mm"};overflow:visible;position:relative}
.brand{display:flex;align-items:center;min-height:${mono ? "10mm" : "18mm"};flex:none}
.brand img{display:block;max-width:75%;width:auto;max-height:${social ? "120px" : mono ? "14mm" : "24mm"};object-fit:contain}
h1{font-size:${social ? "62px" : mono ? "20px" : "36px"};line-height:1.12;color:${mono ? "#000" : "#075d40"}}
.body{font-size:${social ? "32px" : mono ? "13px" : "19px"};line-height:1.4}
.action{font-size:${social ? "38px" : mono ? "16px" : "25px"};font-weight:700;line-height:1.25;border-top:${mono ? "1px solid #000" : "4px solid #f4c52b"};padding-top:${mono ? "3mm" : "5mm"}}
.footer{font-size:${social ? "22px" : mono ? "10px" : "13px"};line-height:1.35;color:${mono ? "#000" : "#42594e"};margin-top:auto}
${mono ? ".panel{border:1px dashed #555;color:#000}.brand img{filter:grayscale(1)}" : ""}
@page{size:${social ? "1080px 1080px" : "A4 portrait"};margin:0}
@media print{html,body{width:${width};margin:0}.sheet{break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
  const styleHash = createHash("sha256").update(style).digest("base64");
  const panel = `<section class="panel" data-material-panel><div class="brand"><img src="${ASSETS[content.assetKey]}" alt="${escapeText(content.assetKey.toUpperCase())}"></div><h1>${escapeText(content.title)}</h1><p class="body">${escapeText(content.body)}</p><p class="action">${escapeText(content.callToAction)}</p><p class="footer">${escapeText(content.footer)}</p></section>`;
  const csp = `default-src 'none'; img-src 'self'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'`;
  return {
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeText(csp)}"><title>${escapeText(content.title)}</title><style>${style}</style></head><body><main class="sheet" data-material-sheet>${panel.repeat(copies)}</main></body></html>`,
    contentSha256: materialDigest(content),
    template: content.template,
    copies,
    size: social ? { width: 1080, height: 1080, unit: "px" as const } : { width: 210, height: 297, unit: "mm" as const },
    requiredAssets: [ASSETS[content.assetKey]],
    overflowPolicy: "measure-every-panel-and-reject-export-on-overflow" as const,
    exportReady: false as const,
  };
}
