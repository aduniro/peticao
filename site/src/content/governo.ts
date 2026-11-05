/** Pontos do cartão ao Governo (também usados no corpo do e-mail). Em português: os destinatários são autoridades brasileiras. */
export const GOV_POINTS = [
  "Sanção integral do PLV nº 12/2026, sem vetos à educação federal",
  "Indenização de Localidades Estratégicas: R$ 191 por dia (antes R$ 91)",
  "Todos os Campi das IFES na Amazônia Legal e na Faixa de Fronteira",
  "Apelo ao MGI: critério que contemple todos os Campi",
  "Mesmo tratamento para docentes e técnicos no mesmo município",
] as const;


/** Destinatários do e-mail ao Governo, sempre em cópia oculta (BCC): um não vê o outro. */
export const GOV_RECIPIENTS = [
  // Presidência da República
  "secom.gabinete@presidencia.gov.br", "sgpr.agenda@presidencia.gov.br", "aesppr@presidencia.gov.br", "ouvidoria@presidencia.gov.br", "gabinetepessoal@presidencia.gov.br",
  // Casa Civil
  "saj.gabinete@presidencia.gov.br", "agendacasacivil@presidencia.gov.br", "executiva.casacivil@presidencia.gov.br", "sag.agenda@presidencia.gov.br", "cc.assessoriaespecial@presidencia.gov.br",
  // Ministério da Gestão e da Inovação em Serviços Públicos
  "seges.gabinete@gestao.gov.br", "sgp.gabinete@gestao.gov.br",
] as const;

export const GOV_SUBJECT = "Pedido de sanção integral do PLV nº 12/2026 (servidores das IFES na Amazônia Legal e na Faixa de Fronteira)";

/** Link do `mailto:` com todos os destinatários em BCC (campo "Para" vazio) e o texto com tópicos. */
export function govMailto(o: { link: string; cardUrl: string }): string {
  const body =
    "Excelentíssimas autoridades,\n\nVenho, no exercício do direito de petição, requerer:\n\n" +
    GOV_POINTS.map((p) => `• ${p}`).join("\n") +
    `\n\nPetição pública (assine e acompanhe): ${o.link}\nCartão com o resumo: ${o.cardUrl}\n\nRespeitosamente.`;
  return `mailto:?bcc=${GOV_RECIPIENTS.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(GOV_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
