import { MAX_MINUTOS, desligarTerminal, ligarTerminal, terminalAte, terminalConfigurado } from "../terminal";
import type { Acao } from "./tipos";

/** Avisa o dono por e-mail sempre que o Terminal é ligado (quem, até quando). Falha de e-mail nunca impede a ação. */
export async function avisarTerminalLigado(quem: string, ate: Date, minutos: number): Promise<boolean> {
  try {
    const { sendMail } = await import("../mail"); const { config } = await import("../config");
    const hora = ate.toLocaleString("pt-BR", { timeZone: "America/Porto_Velho", dateStyle: "short", timeStyle: "short" });
    await sendMail({ to: config.contactBcc()[0], subject: `Terminal do painel LIGADO por ${quem}`, text: `O Terminal do painel foi ligado por ${quem} por ${minutos} minutos (até ${hora}, horário de Rondônia).\n\nEle roda sem privilégios de administrador, sem acesso às senhas do site e sem acesso à internet; cada comando fica registrado com o nome de quem o executou.\n\nSe NÃO foi você nem alguém de confiança, desligue agora em Central de Ações → Desligar o Terminal e troque as senhas do painel.` }, "admin");
    return true;
  } catch { return false; }
}

const estado = async () => { const ate = await terminalAte(); return { ligado: !!ate, ate: ate?.toISOString() ?? null, configurado: terminalConfigurado() }; };

export const terminalLigar: Acao<{ minutos: number }> = {
  id: "terminal.ligar", grupo: "terminal", titulo: "Ligar o Terminal", palavra: "TERMINAL",
  validar: (e) => { const m = Number((e as any)?.minutos ?? 30); return Number.isFinite(m) && m >= 5 && m <= MAX_MINUTOS ? { ok: true, p: { minutos: Math.round(m) } } : { ok: false, erro: `Informe de 5 a ${MAX_MINUTOS} minutos.` }; },
  descrever: (p) => `Liga o Terminal (/admin/terminal) por ${p.minutos} minutos e depois desliga sozinho, e avisa o dono por e-mail. Ele roda num serviço separado, sem privilégios de administrador, sem acesso às senhas do site e sem acesso à internet. Cada comando fica registrado. Comandos que precisam de administrador continuam indo por e-mail.`,
  simular: async (p) => ({ ...(await estado()), ligariaPorMinutos: p.minutos }),
  executar: async (p, ctx) => { const ate = await ligarTerminal(p.minutos); const avisado = await avisarTerminalLigado(ctx.email, ate, p.minutos); return { ligado: true, ate: ate.toISOString(), configurado: terminalConfigurado(), dono_avisado_por_email: avisado }; },
};
export const terminalDesligar: Acao<{}> = {
  id: "terminal.desligar", grupo: "terminal", titulo: "Desligar o Terminal", palavra: "DESLIGAR",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Desliga o Terminal agora. Nenhum comando novo é aceito.",
  simular: () => estado(),
  executar: async () => { await desligarTerminal(); return { ligado: false }; },
};
export const terminalStatus: Acao<{}> = {
  id: "terminal.status", grupo: "terminal", titulo: "Ver o Terminal",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Mostra se o Terminal está ligado, até quando e se o serviço foi configurado neste servidor. Não altera nada.",
  simular: () => estado(), executar: () => estado(),
};
