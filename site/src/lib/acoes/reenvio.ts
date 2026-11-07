import { query } from "../db";
import { getSetting } from "../batches";
import { CHAVES, alvos } from "../reenvio";
import type { Acao, Ctx } from "./tipos";

const writeSetting = (key: string, value: string, ctx: Ctx) => query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, value], ctx.client);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(-03:00|Z|[+-]\d{2}:\d{2})$/;
const JANELA_PADRAO = { ini: "2026-11-04T04:00:00-03:00", fim: "2026-11-04T12:00:00-03:00" };
const brt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Porto_Velho", dateStyle: "short", timeStyle: "short" });

/** Situação do reenvio (somente leitura). Mesmos números do `reenvio-ctl.mjs status`. */
export async function statusReenvio() {
  const [ini, fim, ativo, lote] = await Promise.all([getSetting(CHAVES.inicio, ""), getSetting(CHAVES.fim, ""), getSetting(CHAVES.ativo, ""), getSetting(CHAVES.lote, "60")]);
  const porStatus = (await query<{ status: string; servico: string; n: number }>("SELECT status, COALESCE(provider,'-') servico, COUNT(*)::int n FROM reenvio_falha GROUP BY 1,2 ORDER BY 3 DESC")).rows;
  const confirmaram = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures s JOIN reenvio_falha r ON r.signature_id=s.id WHERE s.status='confirmed'")).rows[0].n;
  const restantes = ini && fim ? (await alvos(1_000_000, { ini, fim })).length : 0;
  return { ativo: ativo.trim() || null, janela: ini && fim ? { ini, fim } : null, lote: Number(lote) || 60, restantes, porStatus, confirmaramDepoisDoReenvio: confirmaram };
}

export const reenvioStatus: Acao<{}> = {
  id: "reenvio.status", grupo: "reenvio", titulo: "Ver a situação do reenvio",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Mostra quantos reenvios foram feitos, quantos faltam e se o reenvio está ligado. Não altera nada.",
  simular: () => statusReenvio(),
  executar: () => statusReenvio(),
};

type PIniciar = { ini: string; fim: string };
export const reenvioIniciar: Acao<PIniciar> = {
  id: "reenvio.iniciar", grupo: "reenvio", titulo: "Ligar o reenvio das confirmações", palavra: "REENVIAR", transacional: true,
  validar: (e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    const ini = typeof x.ini === "string" && x.ini ? x.ini : JANELA_PADRAO.ini, fim = typeof x.fim === "string" && x.fim ? x.fim : JANELA_PADRAO.fim;
    if (!ISO.test(ini) || !ISO.test(fim)) return { ok: false, erro: "Datas inválidas (use data e hora com fuso)." };
    if (!(new Date(ini) < new Date(fim))) return { ok: false, erro: "O início precisa ser antes do fim." };
    if (new Date(fim).getTime() > Date.now() + 60_000) return { ok: false, erro: "O fim da janela não pode estar no futuro." };
    return { ok: true, p: { ini, fim } };
  },
  descrever: (p) => `Liga o reenvio: quem se cadastrou entre ${brt(p.ini)} e ${brt(p.fim)} (horário de Rondônia), ainda NÃO confirmou e nunca foi reenviado, recebe um novo e-mail com link novo, por um serviço de e-mail diferente do que já tentou. Lotes pequenos a cada 2 minutos; para sozinho após 8 falhas seguidas. As datas originais dos cadastros não mudam.`,
  simular: async (p) => {
    const lista = await alvos(1_000_000, p);
    return { pessoasAlcancadas: lista.length, primeiras: lista.slice(0, 5).map((r) => ({ id: r.id, cadastro: r.created_at })), gravaria: { inicio: p.ini, fim: p.fim, lote: 60 } };
  },
  executar: async (p, ctx) => {
    const n = (await alvos(1_000_000, p)).length;
    await writeSetting(CHAVES.inicio, p.ini, ctx); await writeSetting(CHAVES.fim, p.fim, ctx); await writeSetting(CHAVES.lote, "60", ctx);
    const marca = `PAINEL-${ctx.userId}-${new Date().toISOString().slice(0, 10)}`;
    await writeSetting(CHAVES.ativo, marca, ctx);
    return { ligado: true, codigo: marca, pessoasAlcancadas: n };
  },
};

export const reenvioParar: Acao<{}> = {
  id: "reenvio.parar", grupo: "reenvio", titulo: "Parar o reenvio", palavra: "PARAR", transacional: true,
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Desliga o reenvio. Nada mais é enviado por ele; o que já foi enviado continua registrado e ninguém é reenviado duas vezes.",
  simular: async () => ({ estavaLigado: !!(await getSetting(CHAVES.ativo, "")).trim() }),
  executar: async (_p, ctx) => { const antes = !!(await query<{ value: string }>("SELECT value FROM settings WHERE key=$1", [CHAVES.ativo], ctx.client)).rows[0]?.value.trim(); await writeSetting(CHAVES.ativo, "", ctx); return { estavaLigado: antes, ligado: false }; },
};
