import { query } from "../db";
import { outboxStats } from "../mail/outbox";
import { versaoImplantada } from "../versao";
import type { Acao } from "./tipos";

const INICIO = Date.now() - process.uptime() * 1000;

export async function estadoDoSistema() {
  const a = (await query<{ pendentes: number; confirmadas: number }>("SELECT COUNT(*) FILTER (WHERE status='pending')::int pendentes, COUNT(*) FILTER (WHERE status='confirmed')::int confirmadas FROM signatures")).rows[0];
  const envios24h = (await query<{ provider: string; status: string; n: number }>("SELECT provider, status, COUNT(*)::int n FROM mail_log WHERE ts > now() - interval '24 hours' GROUP BY 1,2 ORDER BY 3 DESC")).rows;
  return { assinaturas: a, filaDeEmails: await outboxStats(), enviosUltimas24h: envios24h, ...versaoImplantada(), servidorLigadoDesde: new Date(INICIO).toISOString(), agora: new Date().toISOString() };
}

export const estadoVer: Acao<{}> = {
  id: "estado.ver", grupo: "estado", titulo: "Ver o estado do sistema",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Mostra assinaturas pendentes e confirmadas, a fila de e-mails, os envios das últimas 24 horas, a versão implantada e desde quando o servidor está ligado. Não altera nada.",
  simular: () => estadoDoSistema(),
  executar: () => estadoDoSistema(),
};
