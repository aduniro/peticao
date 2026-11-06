"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { filtrosParaQuery, filtrosVazios, parseFiltros, type Filtros } from "@/lib/assinaturas-filtros";
import type { Faceta, Ponto, Resultado } from "@/lib/assinaturas-explorar";
import { Multi as MultiBase } from "./controles";
import { FiltrosShell, useEhMobile } from "./shell/filtros";
import type { PontoVisita } from "@/app/api/admin/assinaturas/visitas/route";
import type { RequestPoint } from "@/lib/monitor";

const Mapa = dynamic(() => import("./MapaAssinaturas"), { ssr: false, loading: () => <div className="adm-skel" style={{ height: "60dvh" }} /> });

const FIXAS: Record<string, Faceta[]> = {
  categoria: [{ v: "servidor", n: 0, rotulo: "Servidor" }, { v: "apoiador", n: 0, rotulo: "Apoiador" }, { v: "estrangeiro", n: 0, rotulo: "Estrangeiro" }],
  regiao: [{ v: "amazonia_legal", n: 0, rotulo: "Amazônia Legal" }, { v: "faixa_fronteira", n: 0, rotulo: "Faixa de Fronteira" }, { v: "ambos", n: 0, rotulo: "Ambas" }, { v: "fora", n: 0, rotulo: "Nenhuma" }],
  status: [{ v: "confirmed", n: 0, rotulo: "Confirmada" }, { v: "pending", n: 0, rotulo: "Aguardando" }],
  cpf: [{ v: "sim", n: 0, rotulo: "CPF conferido" }, { v: "nao", n: 0, rotulo: "Sem conferência" }],
  whatsapp: [{ v: "sim", n: 0, rotulo: "Com WhatsApp" }, { v: "nao", n: 0, rotulo: "Sem WhatsApp" }],
};
const ROTULOS: Record<string, string> = { categoria: "Categoria", instituicao: "Instituição", cargo: "Cargo", campus: "Campus", regiao: "Amazônia Legal / Fronteira", uf: "Estado", cidade: "Cidade", pais: "País", universidade: "Universidade", status: "Status", cpf: "CPF", whatsapp: "WhatsApp" };
const CHAVES = ["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf", "whatsapp"] as const;
const COLUNAS: [string, string][] = [["nome", "Nome"], ["categoria", "Categoria"], ["instituicao", "Instituição"], ["cargo", "Cargo"], ["regiao", "AL/Fronteira"], ["campus", "Campus"], ["cidadeUf", "Cidade/UF"], ["pais", "País"], ["status", "Status"], ["whatsapp", "WhatsApp"], ["criada", "Criada em"]];
const ORDENAVEIS = new Set(["nome", "categoria", "instituicao", "cargo", "campus", "status", "criada"]);

/** Mapa + tabela com um só conjunto de filtros (sincronizado com a URL). `tela` = modo janela cheia, só o mapa. */
export default function Explorador({ inicial, tela = false, cheio = false }: { inicial: string; tela?: boolean; cheio?: boolean }) {
  const [f, setF] = useState<Filtros>(() => parseFiltros(new URLSearchParams(inicial)));
  const [pagina, setPagina] = useState(1);
  const [ordem, setOrdem] = useState({ k: "criada", dir: "desc" });
  const [r, setR] = useState<(Resultado & { pagina: number; limite: number }) | null>(null);
  const [erro, setErro] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(!(cheio || tela));
  const mobile = useEhMobile(); // no celular os filtros vão para a folha do botão "Filtros" da barra inferior
  const [camada, setCamada] = useState<"assinaturas" | "visitas" | "acessos">("assinaturas");
  const [acessos, setAcessos] = useState<RequestPoint[] | null>(null);
  useEffect(() => { const q = new URLSearchParams(location.search); const c = q.get("camada"); if (c === "visitas" || c === "acessos") setCamada(c); const j = q.get("janela"); if (j && ["1h", "24h", "7d", "30d", "all"].includes(j)) setJanela(j); }, []);
  const [janela, setJanela] = useState("7d");
  const [visitas, setVisitas] = useState<PontoVisita[] | null>(null);
  useEffect(() => {
    if (camada !== "acessos") { setAcessos(null); return; }
    let vivo = true;
    fetch(`/api/admin/monitor?w=${janela === "all" ? "30d" : janela}`).then((r) => r.json()).then((j) => { if (vivo) setAcessos(j.requestPoints ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [camada, janela]);
  useEffect(() => {
    if (camada !== "visitas") { setVisitas(null); return; }
    let vivo = true;
    fetch(`/api/admin/assinaturas/visitas?janela=${janela}`).then((r) => r.json()).then((j) => { if (vivo && j.ok) setVisitas(j.pontos); }).catch(() => {});
    return () => { vivo = false; };
  }, [camada, janela]);
  useEffect(() => { if (window.innerWidth <= 768) setAberto(false); }, []);
  const seq = useRef(0);
  const qs = filtrosParaQuery(f);

  useEffect(() => {
    const id = ++seq.current; setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams(qs); p.set("pagina", String(pagina)); p.set("ordem", ordem.k); p.set("dir", ordem.dir);
        const res = await fetch(`/api/admin/assinaturas/explorar?${p}`);
        const j = await res.json();
        if (id !== seq.current) return;
        if (!j.ok) setErro(j.erro ?? "Falha ao carregar"); else { setR(j); setErro(""); }
      } catch { if (id === seq.current) setErro("Falha de rede"); }
      if (id === seq.current) setBuscando(false);
    }, 200);
    return () => clearTimeout(t);
  }, [qs, pagina, ordem]);

  useEffect(() => { if (tela) return; const e = new URLSearchParams(qs); if (camada !== "assinaturas") { e.set("camada", camada); e.set("janela", janela); } const t = e.toString(); history.replaceState(null, "", t ? `?${t}` : location.pathname); }, [qs, tela, camada, janela]);

  const mudar = useCallback((k: keyof Filtros, v: string | string[]) => { setF((a) => ({ ...a, [k]: v })); setPagina(1); }, []);
  const escolher = useCallback((p: Ponto) => {
    const [t, v] = p.chave.split(":");
    setF((a) => ({ ...a, cidade: t === "m" ? [v] : [], pais: t === "p" ? [v] : [], uf: [] })); setPagina(1);
  }, []);
  const paginas = r ? Math.max(1, Math.ceil(r.total / r.limite)) : 1;
  const ativos = CHAVES.filter((k) => f[k].length).length + (f.q ? 1 : 0) + (f.de || f.ate ? 1 : 0);
  const abrirJanela = () => window.open(`/admin/mapa/tela${qs ? `?${qs}` : ""}`, "_blank", "popup,width=1400,height=900");

  const modoCheio = cheio || tela;
  const [folha, setFolha] = useState(false);
  if (modoCheio) {
    return (
      <div className="adm-explorador v2-mapa-cheio">
        <div className="v2-mapa-fundo">
      <Mapa visitas={visitas} acessos={acessos} pontos={r?.pontos ?? []} altura="100%" onEscolher={escolher} foco={foco} />
        </div>
        <div className="v2-mapa-comando">
          <div className="v2-mapa-barra">
            <button type="button" className="v2-btn v2-btn-primario" hidden={mobile} aria-expanded={aberto} onClick={() => setAberto(!aberto)}>{aberto ? "Fechar filtros" : "Filtros"}{ativos ? ` (${ativos})` : ""}</button>
            {!tela && <button type="button" className="v2-btn v2-btn-sec" aria-expanded={folha} onClick={() => setFolha(!folha)}>{folha ? "Fechar tabela" : "Tabela"}</button>}
      <div className="adm-seg" role="group" aria-label="Camada do mapa">
        <button type="button" aria-pressed={camada === "assinaturas"} className={camada === "assinaturas" ? "on" : ""} onClick={() => setCamada("assinaturas")}>Assinaturas (local declarado)</button>
        <button type="button" aria-pressed={camada === "visitas"} className={camada === "visitas" ? "on" : ""} onClick={() => setCamada("visitas")}>Visitas (por IP)</button>
        <button type="button" aria-pressed={camada === "acessos"} className={camada === "acessos" ? "on" : ""} onClick={() => setCamada("acessos")}>Acessos e pedidos</button>
        {camada !== "assinaturas" ? <select value={janela} onChange={(e) => setJanela(e.target.value)} aria-label="Período das visitas"><option value="1h">1 hora</option><option value="24h">24 horas</option><option value="7d">7 dias</option><option value="30d">30 dias</option><option value="all">Tudo</option></select> : null}
      </div>
            {!tela && <button type="button" className="v2-btn v2-btn-sec" onClick={abrirJanela}>Tela cheia ↗</button>}
          </div>
      <p className="adm-sub v2-mapa-resumo" aria-live="polite">
        <span>{r ? <><b>{r.total}</b> assinatura(s) · {r.totais.confirmadas} confirmadas · {r.totais.pendentes} aguardando{r.semLocal ? ` · ${r.semLocal} sem local no mapa` : ""}</> : "Carregando…"}{buscando ? " …" : ""}</span>
        
      </p>
      {erro ? <p className="err" role="alert">{erro}</p> : null}

          {(aberto || mobile) && <div className={mobile ? undefined : "v2-mapa-filtros"}><FiltrosShell><div className="adm-filters" role="search" >
        <input type="search" placeholder="Buscar nome…" value={f.q} onChange={(e) => mudar("q", e.target.value)} aria-label="Buscar por nome" />
        {CHAVES.map((k) => <MultiBase key={k} rotulo={ROTULOS[k]} opcoes={FIXAS[k] ?? r?.facetas[k] ?? []} valor={f[k]} onChange={(v) => mudar(k, v)} />)}
        <label>De <input type="date" value={f.de} onChange={(e) => mudar("de", e.target.value)} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => mudar("ate", e.target.value)} /></label>
        {ativos ? <button type="button" className="adm-btn" onClick={() => { setF(filtrosVazios()); setPagina(1); }}>Limpar filtros ({ativos})</button> : null}
      </div></FiltrosShell></div>}
        </div>
        {!tela && folha && (
          <div className="v2-mapa-folha" role="region" aria-label="Tabela de assinaturas">
            <div className="v2-mapa-folha-topo"><b>Assinaturas deste filtro</b><button type="button" className="v2-btn v2-btn-sec v2-pequeno" onClick={() => setFolha(false)}>Fechar ✕</button></div>
      {r ? (
        <>
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead><tr>{COLUNAS.map(([k, t]) => (
                <th key={k} aria-sort={ordem.k === k ? (ordem.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {ORDENAVEIS.has(k) ? <button type="button" onClick={() => { setOrdem((o) => ({ k, dir: o.k === k && o.dir === "asc" ? "desc" : "asc" })); setPagina(1); }}>{t}{ordem.k === k ? (ordem.dir === "asc" ? " ▲" : " ▼") : ""}</button> : t}
                </th>))}</tr></thead>
              <tbody>
                {r.linhas.map((l) => (
                  <tr key={l.id}>
                    <td data-l="Nome">{l.nome}</td><td data-l="Categoria">{l.categoria}</td><td data-l="Instituição">{l.instituicao}</td><td data-l="Cargo">{l.cargo}</td><td data-l="AL/Fronteira">{l.regiao}</td>
                    <td data-l="Campus">{l.campus}</td><td data-l="Cidade/UF">{l.cidadeUf}</td><td data-l="País">{l.pais}</td><td data-l="Status">{l.status}</td><td data-l="WhatsApp">{l.whatsapp ? `${l.whatsapp}${l.waConfirmado ? " ✓" : ""}` : ""}</td><td data-l="Criada em">{l.criada}</td>
                  </tr>))}
                {r.linhas.length === 0 ? <tr><td colSpan={COLUNAS.length}>Nenhuma assinatura com esses filtros.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="adm-bar">
            <button type="button" className="adm-btn" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
            <span>Página {pagina} de {paginas}</span>
            <button type="button" className="adm-btn" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
            <a className="adm-btn" href={`/api/admin/assinaturas/explorar?${new URLSearchParams(qs).toString()}${qs ? "&" : ""}formato=csv&ordem=${ordem.k}&dir=${ordem.dir}`}>Baixar CSV do filtro</a>
          </div>
        </>
      ) : null}

          </div>
        )}
      </div>
    );
  }
  return (
    <div className="adm-explorador">
      <button type="button" className="adm-btn adm-filtros-btn" hidden={mobile} aria-expanded={aberto} onClick={() => setAberto(!aberto)}>{aberto ? "Ocultar filtros" : "Filtros"}{ativos ? ` (${ativos})` : ""}</button>
      <FiltrosShell><div className="adm-filters" role="search" hidden={!aberto && !mobile}>
        <input type="search" placeholder="Buscar nome…" value={f.q} onChange={(e) => mudar("q", e.target.value)} aria-label="Buscar por nome" />
        {CHAVES.map((k) => <MultiBase key={k} rotulo={ROTULOS[k]} opcoes={FIXAS[k] ?? r?.facetas[k] ?? []} valor={f[k]} onChange={(v) => mudar(k, v)} />)}
        <label>De <input type="date" value={f.de} onChange={(e) => mudar("de", e.target.value)} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => mudar("ate", e.target.value)} /></label>
        {ativos ? <button type="button" className="adm-btn" onClick={() => { setF(filtrosVazios()); setPagina(1); }}>Limpar filtros ({ativos})</button> : null}
      </div></FiltrosShell>
      <p className="adm-sub" aria-live="polite">
        <span>{r ? <><b>{r.total}</b> assinatura(s) · {r.totais.confirmadas} confirmadas · {r.totais.pendentes} aguardando{r.semLocal ? ` · ${r.semLocal} sem local no mapa` : ""}</> : "Carregando…"}{buscando ? " …" : ""}</span>
        
      </p>
      {erro ? <p className="err" role="alert">{erro}</p> : null}
      <p><a className="v2-btn v2-btn-sec" href={`/admin/mapa${qs ? `?${qs}` : ""}`}>Ver estes filtros no mapa →</a></p>
      {r ? (
        <>
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead><tr>{COLUNAS.map(([k, t]) => (
                <th key={k} aria-sort={ordem.k === k ? (ordem.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {ORDENAVEIS.has(k) ? <button type="button" onClick={() => { setOrdem((o) => ({ k, dir: o.k === k && o.dir === "asc" ? "desc" : "asc" })); setPagina(1); }}>{t}{ordem.k === k ? (ordem.dir === "asc" ? " ▲" : " ▼") : ""}</button> : t}
                </th>))}</tr></thead>
              <tbody>
                {r.linhas.map((l) => (
                  <tr key={l.id}>
                    <td data-l="Nome">{l.nome}</td><td data-l="Categoria">{l.categoria}</td><td data-l="Instituição">{l.instituicao}</td><td data-l="Cargo">{l.cargo}</td><td data-l="AL/Fronteira">{l.regiao}</td>
                    <td data-l="Campus">{l.campus}</td><td data-l="Cidade/UF">{l.cidadeUf}</td><td data-l="País">{l.pais}</td><td data-l="Status">{l.status}</td><td data-l="WhatsApp">{l.whatsapp ? `${l.whatsapp}${l.waConfirmado ? " ✓" : ""}` : ""}</td><td data-l="Criada em">{l.criada}</td>
                  </tr>))}
                {r.linhas.length === 0 ? <tr><td colSpan={COLUNAS.length}>Nenhuma assinatura com esses filtros.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="adm-bar">
            <button type="button" className="adm-btn" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
            <span>Página {pagina} de {paginas}</span>
            <button type="button" className="adm-btn" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
            <a className="adm-btn" href={`/api/admin/assinaturas/explorar?${new URLSearchParams(qs).toString()}${qs ? "&" : ""}formato=csv&ordem=${ordem.k}&dir=${ordem.dir}`}>Baixar CSV do filtro</a>
          </div>
        </>
      ) : null}
    </div>
  );
}
