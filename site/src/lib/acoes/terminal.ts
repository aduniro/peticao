import { MAX_MINUTOS, desligarTerminal, ligarTerminal, terminalAte, terminalConfigurado } from "../terminal";
import type { Acao } from "./tipos";

const estado = async () => { const ate = await terminalAte(); return { ligado: !!ate, ate: ate?.toISOString() ?? null, configurado: terminalConfigurado() }; };

export const terminalLigar: Acao<{ minutos: number }> = {
  id: "terminal.ligar", grupo: "terminal", titulo: "Ligar o Terminal", palavra: "TERMINAL",
  validar: (e) => { const m = Number((e as any)?.minutos ?? 30); return Number.isFinite(m) && m >= 5 && m <= MAX_MINUTOS ? { ok: true, p: { minutos: Math.round(m) } } : { ok: false, erro: `Informe de 5 a ${MAX_MINUTOS} minutos.` }; },
  descrever: (p) => `Liga o Terminal (/admin/terminal) por ${p.minutos} minutos e depois desliga sozinho. Ele roda num serviço separado, sem privilégios de administrador, sem acesso às senhas do site e sem acesso à internet. Cada comando fica registrado. Comandos que precisam de administrador continuam indo por e-mail.`,
  simular: async (p) => ({ ...(await estado()), ligariaPorMinutos: p.minutos }),
  executar: async (p) => { const ate = await ligarTerminal(p.minutos); return { ligado: true, ate: ate.toISOString(), configurado: terminalConfigurado() }; },
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
