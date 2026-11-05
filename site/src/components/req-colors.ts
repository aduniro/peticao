/** Cores das requisições no mapa (a legenda do painel usa as mesmas). Fica fora do VisitorMap para o servidor não carregar o Leaflet. */
export const REQ_COLORS = { confirmed: "#16a34a", pending: "#f59e0b", invalid: "#dc2626", blocked: "#7f1d1d", queued: "#7c3aed" } as const;
