"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Alertas = { emails: number; lotes: number; contato: number };
const ITENS: { href: string; rotulo: string; icone: string; alerta?: keyof Alertas; mobile?: boolean }[] = [
  { href: "/admin", rotulo: "Início", icone: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", mobile: true },
  { href: "/admin/mapa", rotulo: "Mapa", icone: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z", mobile: true },
  { href: "/admin/assinaturas", rotulo: "Assinaturas", icone: "M4 4h16v4H4zm0 6h16v4H4zm0 6h16v4H4z", mobile: true },
  { href: "/admin/emails", rotulo: "E-mails", icone: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v.5l8 5 8-5V7z", alerta: "emails", mobile: true },
  { href: "/admin/lotes", rotulo: "Lotes", icone: "M12 2l9 4.5v11L12 22l-9-4.5v-11zM12 4.3L5.5 7.5 12 10.8l6.5-3.3z", alerta: "lotes" },
  { href: "/admin/contato", rotulo: "Contato", icone: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1z", alerta: "contato" },
  { href: "/admin/whatsapp", rotulo: "WhatsApp", icone: "M20 12a8 8 0 0 1-11.7 7.1L4 20l.9-4.2A8 8 0 1 1 20 12zM9 8.5c0 3.5 3 6.5 6.5 6.5l1.2-1.4-2-1-.9.6a4 4 0 0 1-1.9-1.9l.6-.9-1-2z" },
  { href: "/admin/dominios", rotulo: "Domínios", icone: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 17.9A8 8 0 0 1 4.1 13H9a8 8 0 0 0 2 6.9zM4.1 11A8 8 0 0 1 11 4.1 8 8 0 0 0 9 11zm9 8.9A8 8 0 0 0 15 13h4.9a8 8 0 0 1-6.8 6.9zM15 11a8 8 0 0 0-2-6.9A8 8 0 0 1 19.9 11z" },
  { href: "/admin/indicacoes", rotulo: "Indicações", icone: "M18 8a3 3 0 1 0-2.8-4H15a3 3 0 0 0 .1 1L8.9 8.4a3 3 0 1 0 0 4.2l6.2 3.4A3 3 0 1 0 16 14.7L9.8 11.3a3 3 0 0 0 0-.6l6.2-3.4A3 3 0 0 0 18 8z" },
  { href: "/admin/monitor", rotulo: "Monitor de acessos", icone: "M3 13h4l3-9 4 16 3-7h4" },
  { href: "/admin/dispersao", rotulo: "Dispersão", icone: "M5 5h4v4H5zm10 0h4v4h-4zM5 15h4v4H5zm10 3a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 7h6M7 9v6" },
];

const Icone = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const solo = (usePathname() ?? "").startsWith("/admin/mapa/tela");
  return solo ? <div className="adm adm-solo">{children}</div> : <Moldura>{children}</Moldura>;
}

function Moldura({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/admin";
  const [al, setAl] = useState<Alertas>({ emails: 0, lotes: 0, contato: 0 });
  const [mais, setMais] = useState(false);
  useEffect(() => {
    let vivo = true;
    const carregar = () => fetch("/api/admin/alertas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo && j) setAl(j); }).catch(() => {});
    carregar(); const t = setInterval(carregar, 120_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  useEffect(() => setMais(false), [path]);
  const ativo = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
  const titulo = ITENS.find((i) => ativo(i.href))?.rotulo ?? "Painel";
  if (path.startsWith("/admin/mapa/tela")) return <>{children}</>; // mapa em tela cheia: sem menu
  const link = (i: (typeof ITENS)[number], classe: string) => (
    <a key={i.href} href={i.href} className={`${classe}${ativo(i.href) ? " on" : ""}`} aria-current={ativo(i.href) ? "page" : undefined}>
      <Icone d={i.icone} /><span>{i.rotulo}</span>{i.alerta && al[i.alerta] > 0 && <b className="adm-dot" aria-label={`${al[i.alerta]} alerta(s)`}>{al[i.alerta] > 9 ? "9+" : al[i.alerta]}</b>}
    </a>
  );
  return (
    <div className="adm">
      <aside className="adm-side" aria-label="Menu do painel">
        <a className="adm-brand" href="/admin"><span>PLV 12/2026</span><small>Painel da campanha</small></a>
        <nav>{ITENS.map((i) => link(i, "adm-item"))}</nav>
        <div className="adm-side-foot">
          <a href="/" target="_blank" rel="noopener">Ver o site ↗</a>
          <form method="post" action="/api/admin/sair"><button className="adm-out">Sair</button></form>
        </div>
      </aside>
      <header className="adm-top"><strong>{titulo}</strong><form method="post" action="/api/admin/sair"><button className="adm-out" aria-label="Sair">Sair</button></form></header>
      <div className="adm-content">{children}</div>
      <nav className="adm-tabs" aria-label="Menu do painel">
        {ITENS.filter((i) => i.mobile).map((i) => link(i, "adm-tab"))}
        <button type="button" className={`adm-tab${mais ? " on" : ""}`} onClick={() => setMais((m) => !m)} aria-expanded={mais}>
          <Icone d="M5 12h.01M12 12h.01M19 12h.01" /><span>Mais</span>{(al.lotes + al.contato) > 0 && <b className="adm-dot">{al.lotes + al.contato > 9 ? "9+" : al.lotes + al.contato}</b>}
        </button>
      </nav>
      {mais && (<>
        <div className="adm-scrim" onClick={() => setMais(false)} />
        <div className="adm-sheet" role="dialog" aria-label="Mais opções"><div className="adm-grip" />
          <div className="adm-sheet-grid">{ITENS.filter((i) => !i.mobile).map((i) => link(i, "adm-tile"))}</div>
          <a className="adm-tile" href="/" target="_blank" rel="noopener"><span>Ver o site ↗</span></a>
          <form method="post" action="/api/admin/sair"><button className="adm-out wide">Sair do painel</button></form>
        </div>
      </>)}
    </div>
  );
}
