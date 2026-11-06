/** Estrutura do menu do painel (barra lateral, flyout e gaveta do celular). */
export type Alertas = { emails: number; lotes: number; contato: number };
export type Item = { href: string; rotulo: string; icone: string; alerta?: keyof Alertas; total?: boolean };
export type Grupo = { id: string; rotulo: string; icone: string; itens: Item[] };

export const GRUPOS: Grupo[] = [
  { id: "geral", rotulo: "Visão geral", icone: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", itens: [{ href: "/admin", rotulo: "Painel ao vivo", icone: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" }] },
  { id: "mapas", rotulo: "Mapas", icone: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z", itens: [{ href: "/admin/mapa", rotulo: "Mapa interativo", icone: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" }, { href: "/admin/monitor", rotulo: "Monitor de acessos", icone: "M3 13h4l3-9 4 16 3-7h4" }] },
  { id: "assinaturas", rotulo: "Assinaturas", icone: "M4 4h16v4H4zm0 6h16v4H4zm0 6h16v4H4z", itens: [{ href: "/admin/assinaturas", rotulo: "Lista e filtros", icone: "M4 4h16v4H4zm0 6h16v4H4zm0 6h16v4H4z" }, { href: "/admin/emails", rotulo: "E-mails e pendentes", icone: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v.5l8 5 8-5V7z", alerta: "emails" }, { href: "/admin/dominios", rotulo: "Domínios institucionais", icone: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 17.9A8 8 0 0 1 4.1 13H9a8 8 0 0 0 2 6.9zM4.1 11A8 8 0 0 1 11 4.1 8 8 0 0 0 9 11zm9 8.9A8 8 0 0 0 15 13h4.9a8 8 0 0 1-6.8 6.9zM15 11a8 8 0 0 0-2-6.9A8 8 0 0 1 19.9 11z" }] },
  { id: "comunicacao", rotulo: "Comunicação", icone: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1z", itens: [{ href: "/admin/contato", rotulo: "Contato", icone: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1z", alerta: "contato" }, { href: "/admin/whatsapp", rotulo: "WhatsApp", icone: "M20 12a8 8 0 0 1-11.7 7.1L4 20l.9-4.2A8 8 0 1 1 20 12zM9 8.5c0 3.5 3 6.5 6.5 6.5l1.2-1.4-2-1-.9.6a4 4 0 0 1-1.9-1.9l.6-.9-1-2z" }] },
  { id: "campanha", rotulo: "Campanha", icone: "M12 2l9 4.5v11L12 22l-9-4.5v-11zM12 4.3L5.5 7.5 12 10.8l6.5-3.3z", itens: [{ href: "/admin/lotes", rotulo: "Lotes e envios", icone: "M12 2l9 4.5v11L12 22l-9-4.5v-11zM12 4.3L5.5 7.5 12 10.8l6.5-3.3z", alerta: "lotes" }, { href: "/admin/indicacoes", rotulo: "Indicações", icone: "M18 8a3 3 0 1 0-2.8-4H15a3 3 0 0 0 .1 1L8.9 8.4a3 3 0 1 0 0 4.2l6.2 3.4A3 3 0 1 0 16 14.7L9.8 11.3a3 3 0 0 0 0-.6l6.2-3.4A3 3 0 0 0 18 8z" }, { href: "/admin/dispersao", rotulo: "Dispersão", icone: "M5 5h4v4H5zm10 0h4v4h-4zM5 15h4v4H5zm10 3a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 7h6M7 9v6" }] },
  { id: "acesso", rotulo: "Conta e acesso", icone: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9a8 8 0 0 1 16 0z", itens: [
    { href: "/admin/acoes", rotulo: "Central de Ações", icone: "M13 2L4 14h7l-1 8 9-12h-7z", total: true },
    { href: "/admin/terminal", rotulo: "Terminal", icone: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm3 4l3 3-3 3m5 0h4", total: true },
    { href: "/admin/usuarios", rotulo: "Usuários", icone: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0z", total: true },
    { href: "/admin/conta", rotulo: "Minha conta", icone: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9a8 8 0 0 1 16 0z" },
  ] },
];
export const gruposVisiveis = (ehTotal: boolean): Grupo[] => GRUPOS.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.total || ehTotal) })).filter((g) => g.itens.length > 0);
export const ativo = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
export const tituloDe = (path: string) => GRUPOS.flatMap((g) => g.itens).find((i) => ativo(path, i.href))?.rotulo ?? "Painel";
export const grupoDe = (path: string) => GRUPOS.find((g) => g.itens.some((i) => ativo(path, i.href)))?.id ?? "geral";
