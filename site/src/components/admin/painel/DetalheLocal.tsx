"use client";
import { useState } from "react";
import Abas from "../ui/Abas";

export type Cat = { docente: number; tae: number; nd: number; apoiador: number };
export type TopIfes = { sigla: string; conf: number; pend: number };
export type TopCampus = { nome: string; uf: string; ifes: string; conf: number; pend: number };
export type TopCidade = { nome: string; uf: string; conf: number; pend: number };
export type Resumo = { cat: { conf: Cat; pend: Cat }; rankIfes: TopIfes[]; rankCampi: TopCampus[]; rankCidades: TopCidade[] };
/** Apoiadores por estado dentro do escopo mostrado (a própria região, ou o país quando o popup é de um estado). `destaque` marca o estado do popup. */
export type EstadoApoio = { nome: string; conf: number; pend: number; destaque?: boolean };
const n0 = (n: number) => n.toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1).replace(".", ",") : "0");

/** "Docentes 3 · Técnicos 2 · Não declarados 1 · Apoiadores 4": só o que não é zero. */
export function Categorias({ c }: { c: Cat }) {
  const itens = [["Docentes", c.docente], ["Técnicos", c.tae], ["Não declarados", c.nd], ["Apoiadores", c.apoiador]].filter(([, v]) => (v as number) > 0);
  return <span className="v2-cats">{itens.length ? itens.map(([n, v]) => <span key={n as string}>{n} <b>{n0(v as number)}</b></span>) : <span>sem cadastros</span>}</span>;
}

const Linha = ({ pos, nome, conf, pend, destaque }: { pos: number; nome: string; conf: number; pend: number; destaque?: boolean }) => (
  <li className={destaque ? "dest" : undefined}><span title={nome}>{pos}. {nome}</span><b>{n0(conf)}</b>{pend > 0 ? <small>+{n0(pend)} aguardando</small> : null}</li>
);
const Lista = ({ vazio, children }: { vazio: string; children: React.ReactNode[] }) => (children.length ? <ol className="v2-rank">{children}</ol> : <p className="v2-vazio">{vazio}</p>);

/**
 * Ranking em duas abas principais: "Servidores" (IFES e Campi) e "Apoiadores" (Estado e Cidade). Ex.: "Porto Velho (UNIR): 120".
 */
export function RankingAbas({ r, estados }: { r: Resumo; estados: EstadoApoio[] }) {
  return (
    <Abas abas={[
      { id: "servidores", rotulo: "Servidores", conteudo: (
        <Abas variante="interna" abas={[
          { id: "ifes", rotulo: "IFES", conteudo: <Lista vazio="Sem servidores nesta área.">{r.rankIfes.map((x, i) => <Linha key={x.sigla} pos={i + 1} nome={x.sigla} conf={x.conf} pend={x.pend} />)}</Lista> },
          { id: "campi", rotulo: "Campi", conteudo: <Lista vazio="Sem campi nesta área.">{r.rankCampi.map((x, i) => <Linha key={`${x.nome}|${x.ifes}`} pos={i + 1} nome={`${x.nome} (${x.ifes})`} conf={x.conf} pend={x.pend} />)}</Lista> },
        ]} />) },
      { id: "apoiadores", rotulo: "Apoiadores", conteudo: (
        <Abas variante="interna" abas={[
          { id: "estado", rotulo: "Estado", conteudo: <Lista vazio="Sem apoiadores nesta área.">{estados.map((x, i) => <Linha key={x.nome} pos={i + 1} nome={x.nome} conf={x.conf} pend={x.pend} destaque={x.destaque} />)}</Lista> },
          { id: "cidade", rotulo: "Cidade", conteudo: <Lista vazio="Sem apoiadores nesta área.">{r.rankCidades.map((x, i) => <Linha key={`${x.nome}|${x.uf}`} pos={i + 1} nome={`${x.nome}/${x.uf}`} conf={x.conf} pend={x.pend} />)}</Lista> },
        ]} />) },
    ]} />
  );
}

/**
 * Conteúdo do popup do estado e da região (o MESMO nos dois): total, confirmadas e aguardando com as categorias dentro de cada uma, IFES e campus líderes.
 * "Ver Rankings" RECOLHE essa parte de cima (para o ranking aparecer melhor) e mostra as abas Servidores/Apoiadores; "Esconder Rankings" traz a parte de cima de volta.
 * O ranking nunca nasce aberto.
 */
export default function DetalheLocal({ conf, pend, totalGeral, resumo, estados, hrefRanking, hrefMapa }: { conf: number; pend: number; totalGeral: number; resumo: Resumo; estados: EstadoApoio[]; hrefRanking: string; hrefMapa?: string }) {
  const [ver, setVer] = useState(false);
  const total = conf + pend, i1 = resumo.rankIfes[0], c1 = resumo.rankCampi[0];
  return (
    <div className="v2-det">
      {ver ? null : (
        <div className="v2-det-topo">
          <table><tbody>
            <tr><td>Total</td><td><b>{n0(total)}</b></td></tr>
            <tr><td>Confirmadas</td><td>{n0(conf)}</td></tr><tr className="sub"><td colSpan={2}><Categorias c={resumo.cat.conf} /></td></tr>
            <tr><td>Aguardando</td><td>{n0(pend)}</td></tr><tr className="sub"><td colSpan={2}><Categorias c={resumo.cat.pend} /></td></tr>
            <tr><td>% do total</td><td>{pct(total, totalGeral)}%</td></tr>
          </tbody></table>
          <div className="v2-lideres">
            <p><small>IFES com mais assinaturas</small>{i1 ? <><b>{i1.sigla}</b><span>{n0(i1.conf)}{i1.pend ? ` (+${n0(i1.pend)} aguardando)` : ""}</span></> : <span>—</span>}</p>
            <p><small>Campus com mais assinaturas</small>{c1 ? <><b>{c1.nome} ({c1.ifes})</b><span>{n0(c1.conf)}{c1.pend ? ` (+${n0(c1.pend)} aguardando)` : ""}</span></> : <span>—</span>}</p>
          </div>
        </div>
      )}
      <button type="button" className="v2-btn v2-btn-sec v2-largo" aria-expanded={ver} onClick={() => setVer((v) => !v)}>{ver ? "Esconder Rankings" : "Ver Rankings"}</button>
      {ver ? <div className="v2-det-rank"><RankingAbas r={resumo} estados={estados} /></div> : null}
      <div className="v2-det-links">
        <a className="v2-btn v2-btn-fantasma" href={hrefRanking}>Ranking completo →</a>
        {hrefMapa ? <a className="v2-btn v2-btn-primario" href={hrefMapa}>Abrir no mapa interativo</a> : null}
      </div>
    </div>
  );
}
