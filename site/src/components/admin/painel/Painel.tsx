"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapaSVG, { type Geo, type UfDado } from "./MapaSVG";
import Expansor from "../ui/Expansor";
import DetalheLocal, { type Resumo } from "./DetalheLocal";
import { RAMPA, classe, quantis } from "@/lib/quantis";

type Dados = {
  geradoEm: string; meta: number; loteTamanho: number;
  totais: { confirmadas: number; pendentes: number; servidores: number; apoiadores: number; estrangeiros: number; cpfConferido: number };
  ufs: (UfDado & Resumo)[]; regioes: ({ id: string; nome: string; conf: number; pend: number } & Resumo)[]; exterior: { conf: number; pend: number };
  hoje: { iniciadas: number; confirmadas: number }; ontem: { iniciadas: number; confirmadas: number };
  funil: { visitors: number; formStarts: number; signedVisitors: number; confirmedVisitors: number };
};
type Pop = { uf: string; x: number; y: number };
const n0 = (n: number) => n.toLocaleString("pt-BR");
const ORDEM = ["N", "NE", "CO", "SE", "S"];

/** Painel ao vivo (estilo "apuração"): cartões-herói, faixa de UFs, mapa do Brasil com popups e barras por região. Atualiza a cada 20 s. */
export default function Painel() {
  const [d, setD] = useState<Dados | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [erro, setErro] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const [dest, setDest] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const ultimo = useRef(0);

  const carregar = useCallback(async () => {
    try { const r = await fetch("/api/admin/painel", { cache: "no-store" }); const j = await r.json(); if (j.ok) { setD(j); ultimo.current = Date.now(); setErro(false); } else setErro(true); } catch { setErro(true); }
  }, []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 20_000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => { fetch("/data/geo/brasil-svg.json").then((r) => r.json()).then(setGeo).catch(() => {}); }, []);
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 5000); return () => clearInterval(t); }, []);

  const cortes = useMemo(() => quantis((d?.ufs ?? []).map((u) => u.total)), [d]);
  const idade = ultimo.current ? (agora - ultimo.current) / 1000 : 0;
  const estado = !d ? "carregando" : idade > 180 ? "parado" : idade > 60 ? "atrasado" : "vivo";
  const t = d?.totais, tot = (t?.confirmadas ?? 0) + (t?.pendentes ?? 0);
  const pct = d ? Math.min(100, (d.totais.confirmadas / d.meta) * 100) : 0;
  const faltaLote = d ? d.loteTamanho - (d.totais.confirmadas % d.loteTamanho) : 0;
  const dif = d ? d.hoje.confirmadas - d.ontem.confirmadas : 0;
  const ufsOrd = useMemo(() => [...(d?.ufs ?? [])].sort((a, b) => ORDEM.indexOf(a.regiao) - ORDEM.indexOf(b.regiao) || b.total - a.total), [d]);

  // Os detalhes do estado (categorias, IFES e campus líderes, rankings) já vêm no payload do painel: abrir o popup não faz nova consulta.
  const abrir = (uf: string, x: number, y: number) => setPop({ uf, x, y });
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && setPop(null); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, []);
  const u = pop && d?.ufs.find((x) => x.uf === pop.uf);
  const left = pop ? Math.max(8, Math.min(pop.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 320)) : 0;
  const top = pop ? Math.max(70, Math.min(pop.y - 20, (typeof window !== "undefined" ? window.innerHeight : 800) - 520)) : 0;

  return (
    <section className="v2-painel" aria-label="Painel ao vivo">
      <div className="v2-painel-topo">
        <div><span className="v2-kicker">Painel ao vivo</span><h1>Petição pela sanção integral do PLV 12/2026</h1></div>
        <span className={`v2-vivo ${estado}`} role="status"><i />{estado === "vivo" ? "AO VIVO" : estado === "carregando" ? "carregando…" : estado === "atrasado" ? "atualização atrasada" : "SEM ATUALIZAR"}{d ? ` · ${new Date(d.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" })}` : ""}</span>
      </div>
      {erro && <p className="v2-aviso" role="alert">Não consegui atualizar agora; mostrando o último dado recebido.</p>}

      <div className="v2-faixa" aria-label="Estados">
        {ufsOrd.map((x) => { const c = classe(x.total, cortes); return (
          <button key={x.uf} type="button" className={`v2-uf-card${dest === x.uf ? " hl" : ""}`} style={{ ["--cc" as string]: c < 0 ? "#4b5f55" : RAMPA[c] }} onMouseEnter={() => setDest(x.uf)} onMouseLeave={() => setDest(null)} onClick={(e) => abrir(x.uf, e.clientX, e.clientY)}>
            <b>{x.uf}</b><span>{n0(x.total)}</span><i style={{ ["--p" as string]: `${x.total ? (x.conf / x.total) * 100 : 0}%` }} />
          </button>); })}
        {d && (d.exterior.conf + d.exterior.pend) > 0 && <div className="v2-uf-card ext" style={{ ["--cc" as string]: "#4b5f55" }}><b>EXT</b><span>{n0(d.exterior.conf + d.exterior.pend)}</span><i style={{ ["--p" as string]: `${(d.exterior.conf / (d.exterior.conf + d.exterior.pend)) * 100}%` }} /></div>}
      </div>

      <div className="v2-painel-corpo">
        <div className="v2-coluna">
          <div className="v2-heroi">
            <div className="v2-cartao v2-destaque">
              <h2>Assinaturas confirmadas</h2>
              <div className="v2-numerao">{d ? n0(d.totais.confirmadas) : "—"}</div>
              <div className="v2-prog" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da meta"><i style={{ width: `${pct}%` }} /></div>
              <p className="v2-leg"><b>{pct.toFixed(1).replace(".", ",")}%</b> da meta de {d ? n0(d.meta) : "—"} · faltam <b>{d ? n0(faltaLote) : "—"}</b> para o próximo envio ao Governo</p>
            </div>
            <div className="v2-cartao"><h2>Aguardando confirmação</h2><div className="v2-numerao m">{d ? n0(d.totais.pendentes) : "—"}</div><p className="v2-leg">{tot ? `${Math.round(((t?.pendentes ?? 0) / tot) * 100)}% dos cadastros` : ""}</p><a className="v2-btn v2-btn-sec v2-pequeno" href="/admin/emails">Ver pendentes</a></div>
            <div className="v2-cartao"><h2>Hoje</h2><div className="v2-numerao m">{d ? n0(d.hoje.confirmadas) : "—"}</div><p className="v2-leg">confirmadas · {d ? n0(d.hoje.iniciadas) : "—"} iniciadas{d ? <> · <b className={dif >= 0 ? "pos" : "neg"}>{dif >= 0 ? "+" : ""}{dif}</b> vs. ontem</> : null}</p></div>
          </div>
          <div className="v2-cartao">
            <h2>Quem assinou</h2>
            <div className="v2-dupla" aria-label="Proporção por categoria">
              {d && tot ? [["Servidores", t!.servidores, "#2a78d6"], ["Apoiadores", t!.apoiadores, "#eb6834"], ["Estrangeiros", t!.estrangeiros, "#1baf7a"]].map(([nome, v, cor]) => (v as number) > 0 ? <div key={nome as string} style={{ flex: v as number, background: cor as string }} title={`${nome}: ${v}`}><span>{n0(v as number)}</span></div> : null) : null}
            </div>
            <ul className="v2-legenda">{d ? [["Servidores", t!.servidores, "#2a78d6"], ["Apoiadores", t!.apoiadores, "#eb6834"], ["Estrangeiros", t!.estrangeiros, "#1baf7a"]].map(([nome, v, cor]) => <li key={nome as string}><i style={{ background: cor as string }} />{nome} <b>{n0(v as number)}</b></li>) : null}<li><i style={{ background: "#8fe0b0" }} />CPF conferido <b>{d ? n0(t!.cpfConferido) : "—"}</b></li></ul>
          </div>
          <div className="v2-cartao">
            <h3 className="v2-barras-t">Por região</h3>
            {(d?.regioes ?? []).length === 0 ? <p className="v2-vazio">Carregando…</p> : (() => {
              const lista = d!.regioes, maximo = Math.max(1, ...lista.map((r) => r.conf + r.pend)), soma = lista.reduce((a, r) => a + r.conf + r.pend, 0) || 1;
              return lista.map((r) => {
                const v = r.conf + r.pend, ufs = d!.ufs.filter((x) => x.regiao === r.id).map((x) => x.uf).join(",");
                return (
                  <Expansor key={r.id} resumo={<span className="v2-reg-resumo"><span className="v2-reg-nome" title={r.nome}>{r.nome}</span><span className="v2-reg-trilho"><i style={{ width: `${Math.max(2, (v / maximo) * 100)}%` }} /></span><b>{n0(v)}</b><small>{Math.round((v / soma) * 100)}%</small></span>}>
                    <DetalheLocal conf={r.conf} pend={r.pend} totalGeral={tot} resumo={r} rankingAberto hrefRanking={`/admin/rankings?uf=${ufs}`} hrefMapa={`/admin/mapa?uf=${ufs}`} />
                  </Expansor>
                );
              });
            })()}
          </div>
        </div>

        <div className="v2-cartao v2-mapa-cartao">
          <h2>Mapa por estado <small>(vermelho: menos · azul: mais)</small></h2>
          <div className="v2-mapa-caixa">{geo && d ? <MapaSVG geo={geo} dados={d.ufs} cortes={cortes} destaque={dest} selecionada={pop?.uf ?? null} onDestaque={setDest} onEscolher={abrir} /> : <div className="adm-skel" style={{ height: 380 }} />}</div>
          <div className="v2-escala" aria-label="Legenda do mapa">{RAMPA.map((c, i) => <i key={c} style={{ background: c }} title={`classe ${i + 1}`} />)}<span>menos</span><span>mais</span></div>
        </div>
      </div>

      {pop && u && (
        <div className="v2-popup" style={{ left, top }} role="dialog" aria-label={`Detalhes de ${u.nome}`}>
          <button type="button" className="v2-popup-x" aria-label="Fechar" onClick={() => setPop(null)}>✕</button>
          <h3>{u.nome} <small>{u.uf}</small></h3>
          <DetalheLocal conf={u.conf} pend={u.pend} totalGeral={tot} resumo={u} hrefRanking={`/admin/rankings?uf=${u.uf}`} hrefMapa={`/admin/mapa?uf=${u.uf}`} />
        </div>
      )}
    </section>
  );
}
