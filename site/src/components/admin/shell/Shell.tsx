"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ativo, GRUPOS, grupoDe, gruposVisiveis, tituloDe, type Alertas, type Grupo, type Item } from "./menu";

/** Quem está logado e o nível (vindos do servidor). Itens marcados `total` só aparecem para o nível Total; quem barra de verdade é cada página e rota. */
export type Quem = { nome: string; nivel: string; rotuloNivel: string };

const Icone = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const SAIR = (cls: string, rotulo = "Sair") => <form method="post" action="/api/admin/sair"><button className={cls} aria-label="Sair do painel">{rotulo}</button></form>;

/** Moldura do painel v2: topo fixo com botão sanduíche, trilho lateral com submenus (flyout) ao passar o mouse e gaveta no celular. Sem barra inferior. */
export default function Shell({ children, quem, ehTotal = false }: { children: React.ReactNode; quem?: Quem; ehTotal?: boolean }) {
  const path = usePathname() ?? "/admin";
  if (path.startsWith("/admin/mapa/tela")) return <div className="adm v2 adm-solo">{children}</div>;
  return <Moldura path={path} quem={quem} ehTotal={ehTotal}>{children}</Moldura>;
}

function Moldura({ path, children, quem, ehTotal }: { path: string; children: React.ReactNode; quem?: Quem; ehTotal: boolean }) {
  const [al, setAl] = useState<Alertas>({ emails: 0, lotes: 0, contato: 0 });
  const [gaveta, setGaveta] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null); // grupo com flyout aberto
  const [fixo, setFixo] = useState(false);                   // flyout fixado por clique
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const escuro = path === "/admin";
  const grupos = gruposVisiveis(ehTotal);

  useEffect(() => {
    let vivo = true;
    const carregar = () => fetch("/api/admin/alertas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo && j) setAl(j); }).catch(() => {});
    carregar(); const t = setInterval(carregar, 120_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // gaveta do celular: botão voltar do navegador fecha; Esc fecha; sem rolagem do fundo
  const abrirGaveta = useCallback(() => { history.pushState({ gaveta: 1 }, ""); setGaveta(true); }, []);
  const fecharGaveta = useCallback(() => { setGaveta(false); if (history.state?.gaveta) history.back(); }, []);
  useEffect(() => { const pop = () => setGaveta(false); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => { setGaveta(false); setAberto(null); setFixo(false); }, [path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(null); setFixo(false); if (gaveta) fecharGaveta(); } };
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [gaveta, fecharGaveta]);
  useEffect(() => { document.documentElement.style.overflow = gaveta ? "hidden" : ""; return () => { document.documentElement.style.overflow = ""; }; }, [gaveta]);

  const entrar = (id: string) => { clearTimeout(timer.current); if (!fixo) timer.current = setTimeout(() => setAberto(id), 120); };
  const sair = () => { clearTimeout(timer.current); if (!fixo) timer.current = setTimeout(() => setAberto(null), 220); };
  const soma = (g: Grupo) => g.itens.reduce((n, i) => n + (i.alerta ? al[i.alerta] : 0), 0);
  const link = (i: Item, cls: string) => (
    <a key={i.href} href={i.href} className={`${cls}${ativo(path, i.href) ? " on" : ""}`} aria-current={ativo(path, i.href) ? "page" : undefined}>
      <Icone d={i.icone} /><span>{i.rotulo}</span>{i.alerta && al[i.alerta] > 0 && <b className="adm-dot" aria-label={`${al[i.alerta]} alerta(s)`}>{al[i.alerta] > 9 ? "9+" : al[i.alerta]}</b>}
    </a>
  );
  const gAtivo = grupoDe(path);
  const gAberto = grupos.find((g) => g.id === aberto);

  return (
    <div className="adm v2" data-tema={escuro ? "escuro" : "claro"}>
      <header className="v2-topo">
        <button type="button" className="v2-sanduiche" aria-label="Abrir o menu" aria-expanded={gaveta} onClick={abrirGaveta}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        <a className="v2-marca" href="/admin"><b>PLV 12/2026</b><small>Painel da campanha</small></a>
        <nav className="v2-migalha" aria-label="Você está em"><span>{GRUPOS.find((g) => g.id === gAtivo)?.rotulo}</span><i aria-hidden="true">›</i><strong>{tituloDe(path)}</strong></nav>
        <div className="v2-topo-dir">{quem ? <span className="v2-quem-topo" data-testid="quem-topo" title={`Nível: ${quem.rotuloNivel}`}>{quem.nome.split(" ")[0]} · {quem.rotuloNivel}</span> : null}<a className="v2-link-site" href="/" target="_blank" rel="noopener">Ver o site ↗</a>{SAIR("v2-btn v2-btn-fantasma")}</div>
      </header>

      <aside className="v2-trilho" aria-label="Menu do painel" onMouseLeave={sair}>
        {grupos.map((g) => (
          <button key={g.id} type="button" className={`v2-trilho-item${gAtivo === g.id ? " on" : ""}${aberto === g.id ? " aberto" : ""}`} aria-haspopup="true" aria-expanded={aberto === g.id}
            onMouseEnter={() => entrar(g.id)} onFocus={() => entrar(g.id)}
            onClick={() => { if (g.itens.length === 1) { location.href = g.itens[0].href; return; } clearTimeout(timer.current); setFixo(aberto !== g.id || !fixo); setAberto(aberto === g.id && fixo ? null : g.id); }}>
            <Icone d={g.icone} /><span>{g.rotulo}</span>{soma(g) > 0 && <b className="adm-dot">{soma(g) > 9 ? "9+" : soma(g)}</b>}
          </button>
        ))}
      </aside>
      {gAberto && (
        <div className="v2-flyout" role="menu" aria-label={gAberto.rotulo} onMouseEnter={() => { clearTimeout(timer.current); }} onMouseLeave={sair}>
          <h3>{gAberto.rotulo}</h3>{gAberto.itens.map((i) => link(i, "v2-flyout-item"))}
        </div>
      )}

      {gaveta && <div className="v2-scrim" onClick={fecharGaveta} />}
      <aside className={`v2-gaveta${gaveta ? " aberta" : ""}`} aria-hidden={!gaveta} aria-label="Menu" {...(!gaveta ? { inert: "" as unknown as undefined } : {})}>
        <div className="v2-gaveta-topo"><a className="v2-marca" href="/admin"><b>PLV 12/2026</b><small>Painel da campanha</small></a><button type="button" className="v2-sanduiche" aria-label="Fechar o menu" onClick={fecharGaveta}>✕</button></div>
        {grupos.map((g) => (<section key={g.id}><h4>{g.rotulo}</h4>{g.itens.map((i) => link(i, "v2-gaveta-item"))}</section>))}
        <div className="v2-gaveta-pe">{quem ? <p className="v2-quem" data-testid="quem">{quem.nome}<br />Nível: {quem.rotuloNivel}</p> : null}<a className="v2-gaveta-item" href="/" target="_blank" rel="noopener"><span>Ver o site ↗</span></a>{SAIR("v2-btn v2-btn-perigo v2-largo", "Sair do painel")}</div>
      </aside>

      <div className={`adm-content v2-main${escuro ? " v2-escuro" : ""}`} {...(gaveta ? { inert: "" as unknown as undefined } : {})}>{children}</div>
    </div>
  );
}
