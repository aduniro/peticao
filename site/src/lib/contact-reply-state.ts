/** Preserve what was recorded; provider acceptance is not delivery to the recipient. */
export function contactReplyLabel(row: { estado: string; ok: boolean; agendada: boolean }): string {
  const labels: Record<string, string> = {
    prepared: "Aguardando envio", blocked: "Aguardando o texto", sending: "Envio em andamento",
    accepted: "Aceita pelo provedor", uncertain: "Resultado a conferir", rejected: "Recusada",
  };
  if (row.estado === "legacy") return row.ok ? "Histórico anterior: envio registrado" : row.agendada ? "Histórico anterior: agendada" : "Histórico anterior: falha registrada";
  return labels[row.estado] ?? "Resultado a conferir";
}
