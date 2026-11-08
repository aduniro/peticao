import { outboxStats } from "./outbox";
import { semEmailEntregue, sesSaude, statusProvedores } from "./painel";

const n = (x: unknown) => Number(x ?? 0).toLocaleString("pt-BR");

/** Alertas do painel de e-mails (saldo baixo, SES em risco, fila parada, cadastros sem e-mail, falha ao consultar provedor). */
export async function alertasEmail(): Promise<string[]> {
  const [status, ses, outbox, sem] = await Promise.all([statusProvedores(), sesSaude(), outboxStats(), semEmailEntregue()]);
  const out: string[] = [];
  const b = status.brevo?.data, sp = status.sendpulse?.data, ms = status.mailersend?.data;
  if (b?.ok && b.creditos < 500) out.push(`Brevo com ${n(b.creditos)} envios restantes.`);
  if (sp?.ok && sp.restantes < 5000) out.push(`SendPulse com ${n(sp.restantes)} envios restantes.`);
  if (ms?.ok && ms.restantes < 20) out.push(`MailerSend com ${n(ms.restantes)} envios restantes hoje.`);
  if (ses.nivel === "risco") out.push(`SES em RISCO: ${ses.taxaDevolucao}% de devolução e ${ses.taxaReclamacao}% de reclamação (a Amazon revisa a conta a 5% / 0,1%).`);
  else if (ses.nivel === "atencao") out.push(`SES em atenção: ${ses.taxaDevolucao}% de devolução.`);
  if (outbox.pending > 0) out.push(`${outbox.pending} e-mail(s) parado(s) na fila de reenvio.`);
  if (sem.length > 0) out.push(`${sem.length} cadastro(s) pendente(s) sem e-mail entregue.`);
  const poll = status._poll?.data as Record<string, { ok: boolean; erro?: string }> | undefined;
  for (const [k, v] of Object.entries(poll ?? {})) if (!v.ok) out.push(`Falha ao consultar ${k}: ${v.erro}.`);
  return out;
}
