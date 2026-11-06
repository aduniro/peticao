// Protocolo de aprovação por e-mail. Nada que afete o público é executado sem "APROVADO" do dono, com o código da proposta.
// Regras: remetente = um dos 3 endereços do dono (dono.mjs); DKIM do remetente aprovado (Cloudflare); código [AP-XXXX] no assunto ou no texto citado;
// 1ª palavra da resposta nova: APROVADO | MODIFICAR: <pedido> | CANCELAR. Uma proposta modificada gera NOVA proposta (novo código).
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { enviar } from "./enviar.mjs"; import { mensagens, corpoNovo } from "./ler.mjs"; import { DONO, ENDERECO } from "./lib.mjs"; import { doDono as remetenteDono } from "./dono.mjs";
const ARQ = "/mnt/dev/peticao/.cache/ponte/propostas.json";
const ler = () => (existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, "utf8")) : {});
const gravar = (o) => { mkdirSync("/mnt/dev/peticao/.cache/ponte", { recursive: true }); writeFileSync(ARQ, JSON.stringify(o, null, 1)); };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export async function propor({ tarefa, resumo, detalhes = [], anexoHtml = "", provedor = "sendpulse", para }) {
  const codigo = "AP-" + randomBytes(3).toString("hex").toUpperCase();
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;line-height:1.5"><h2>Proposta ${codigo}: ${esc(tarefa)}</h2><p>${esc(resumo)}</p>${detalhes.length ? `<ul>${detalhes.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
<div style="background:#fff8d6;border:2px solid #f2c200;border-radius:10px;padding:14px;margin:16px 0"><b>Como responder (responda este e-mail):</b><br>
Escreva na primeira linha: <b>APROVADO</b> — ou <b>MODIFICAR:</b> e o que mudar — ou <b>CANCELAR</b>.<br>Mantenha o código <b>${codigo}</b> no assunto. Nada será executado antes de você aprovar; se pedir modificações, envio uma nova proposta para nova aprovação.</div>${anexoHtml ? `<hr><p><b>Modelo para sua revisão:</b></p>${anexoHtml}` : ""}</div>`;
  const texto = `Proposta ${codigo}: ${tarefa}\n\n${resumo}\n\n${detalhes.map((d) => "- " + d).join("\n")}\n\nResponda este e-mail com, na primeira linha: APROVADO, ou MODIFICAR: <o que mudar>, ou CANCELAR. Mantenha o código ${codigo} no assunto.`;
  const r = await enviar({ assunto: `[${codigo}] ${tarefa}`, html, texto, provedor, ...(para ? { para } : {}) });
  const est = ler(); est[codigo] = { tarefa, resumo, criada: new Date().toISOString(), enviada: r, estado: "aguardando" }; gravar(est);
  return { codigo, envio: r };
}

export function decidir(m, codigo) {
  const texto = corpoNovo(m.raw); const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const tem = new RegExp(codigo, "i").test(m.assunto) || new RegExp(codigo, "i").test(m.raw);
  const doDono = remetenteDono(m); // os 3 endereços do dono, com DKIM do próprio domínio
  if (!tem || !doDono) return null;
  const t = primeira.trim();
  if (/^aprov(ado|ada|ar|a|o)\b/i.test(t) || (/^sim\b|^ok\b|^pode\b/i.test(t) && /aprov/i.test(t))) return { decisao: "aprovado", texto };
  if (/^cancel/i.test(t)) return { decisao: "cancelado", texto };
  if (/^modific/i.test(t) || /^altere|^ajuste/i.test(t)) return { decisao: "modificar", texto: texto.replace(/^modific\w*:?\s*/i, "") };
  return { decisao: "ambigua", texto };
}

export async function consultar(codigo) {
  const est = ler(); const p = est[codigo]; if (!p) throw new Error("proposta desconhecida");
  const desde = Math.max(new Date(p.criada).getTime() - 60000, p.lidoAte ? new Date(p.lidoAte).getTime() + 1 : 0);
  const L = (await mensagens(desde)).reverse();
  for (const m of L) {
    const d = decidir(m, codigo); if (!d) continue;
    p.lidoAte = m.recebido; // mensagens já tratadas não são lidas de novo
    if (d.decisao === "ambigua") { p.ultimaPergunta = { em: m.recebido, texto: d.texto.slice(0, 2000) }; gravar(est); return { codigo, ...d, em: m.recebido }; }
    p.estado = d.decisao; p.resposta = { em: m.recebido, texto: d.texto.slice(0, 2000) }; gravar(est); return { codigo, ...d, em: m.recebido };
  }
  return { codigo, decisao: "aguardando" };
}
export const estadoDe = (codigo) => ler()[codigo];
if (process.argv[1]?.endsWith("aprovacao.mjs") && process.argv[2] === "consultar") console.log(JSON.stringify(await consultar(process.argv[3])));
