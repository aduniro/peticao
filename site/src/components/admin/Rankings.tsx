"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { filtrosParaQuery, filtrosVazios } from "@/lib/assinaturas-filtros";
import type { Faceta } from "@/lib/assinaturas-explorar";
import { Caixa, Multi, Segmentado } from "./controles";
import { FiltrosShell } from "./shell/filtros";
import Abas from "./ui/Abas";
import SeletorPeriodo from "./ui/SeletorPeriodo";
import { Tabela } from "./ui/blocos";

type Cont = { total: number; conf: number; pend: number };
type Cargos = { docente: number; tae: number; nd: number };
type Ifes = Cont & Cargos & { ifes: string };
type Campus = Cont & Cargos & { ifes: string; ibge: number; municipio: string; uf: string };
type Local = Cont & { chave: string; nome: string; uf?: string; pais?: string };
type Dados = { ifes: Ifes[]; campi: Campus[]; apoio: { porUf: Local[]; porCidade: Local[] }; ext: { porPais: Local[]; porUniversidade: Local[] } };
const n0 = (n: number) => n.toLocaleString("pt-BR");
const STATUS = [{ v: "todas", t: "Todas" }, { v: "confirmed", t: "Confirmadas" }, { v: "pending", t: "Aguardando" }] as const;

/** Página de rankings: filtros (status, período, estados, região) e quatro abas. Só contagens. */
export default function Rankings({ ufs, ufInicial }: { ufs: { v: string; rotulo: string }[]; ufInicial: string[] }) {
  const [status, setStatus] = useState<"todas" | "confirmed" | "pending">("todas");
  const [periodo, setPeriodo] = useState({ de: "", ate: "" });
  const [uf, setUf] = useState<string[]>(ufInicial);
  const [regiao, setRegiao] = useState<string[]>([]);
  const [ifesSel, setIfesSel] = useState("");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const seq = useRef(0);
  const filtros = useMemo(() => filtrosParaQuery({ ...filtrosVazios(), status: status === "todas" ? [] : [status], uf, regiao, de: periodo.de, ate: periodo.ate }), [status, uf, regiao, periodo]);
  const opcoesUf: Faceta[] = useMemo(() => ufs.map((u) => ({ v: u.v, n: 0, rotulo: u.rotulo })), [ufs]);

  useEffect(() => {
    const id = ++seq.current; setCarregando(true);
    const q = (tipo: string, extra = "") => `/api/admin/rankings?tipo=${tipo}${filtros ? "&" + filtros : ""}${extra}`;
    Promise.all([
      fetch(q("ifes")).then((r) => r.json()), fetch(q("campi", ifesSel ? `&ifes=${encodeURIComponent(ifesSel)}` : "")).then((r) => r.json()),
      fetch(q("apoiadores")).then((r) => r.json()), fetch(q("exterior")).then((r) => r.json()),
    ]).then(([a, b, c, d]) => {
      if (id !== seq.current) return;
      if (![a, b, c, d].every((x) => x.ok)) { setErro("Não foi possível carregar os rankings."); setCarregando(false); return; }
      setDados({ ifes: a.linhas, campi: b.linhas, apoio: { porUf: c.porUf, porCidade: c.porCidade }, ext: { porPais: d.porPais, porUniversidade: d.porUniversidade } }); setErro(""); setCarregando(false);
    }).catch(() => { if (id === seq.current) { setErro("Falha de rede."); setCarregando(false); } });
  }, [filtros, ifesSel]);

  const temRegiao = (v: string) => regiao.includes(v);
  const alternaRegiao = (v: string, on: boolean) => setRegiao((r) => (on ? [...r, v] : r.filter((x) => x !== v)));
  const ativos = (status !== "todas" ? 1 : 0) + (periodo.de || periodo.ate ? 1 : 0) + uf.length + regiao.length;
  const csv = (tipo: string, lista = "") => `/api/admin/rankings?tipo=${tipo}${filtros ? "&" + filtros : ""}${tipo === "campi" && ifesSel ? `&ifes=${encodeURIComponent(ifesSel)}` : ""}${lista ? `&lista=${lista}` : ""}&formato=csv`;
  const Baixar = ({ href }: { href: string }) => <a className="v2-btn v2-btn-sec v2-pequeno" href={href}>Baixar CSV</a>;
  const soma = <T extends Cont>(l: T[]) => l.reduce((a, x) => ({ total: a.total + x.total, conf: a.conf + x.conf, pend: a.pend + x.pend }), { total: 0, conf: 0, pend: 0 });
  const num = (n: number) => <td className="num">{n0(n)}</td>;
  const SEM = "Nenhum cadastro com estes filtros.";

  const tabIfes = (
    <>
      <div className="v2-rank-barra"><span className="v2-sub">{dados ? `${dados.ifes.length} IFES · ${n0(soma(dados.ifes).conf)} confirmadas · ${n0(soma(dados.ifes).pend)} aguardando` : ""}</span><Baixar href={csv("ifes")} /></div>
      <div className="v2-tab-rank"><Tabela colunas={["#", "IFES", "Docentes", "Técnicos", "Não declarados", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.ifes.length ? SEM : undefined}>
        {(dados?.ifes ?? []).map((x, i) => <tr key={x.ifes}><td className="num">{i + 1}</td><td>{x.ifes}</td>{num(x.docente)}{num(x.tae)}{num(x.nd)}{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}
      </Tabela></div>
    </>
  );
  const tabCampi = (
    <>
      <div className="v2-rank-barra">
        <label className="v2-rank-sel">IFES<select value={ifesSel} onChange={(e) => setIfesSel(e.target.value)}><option value="">Todas as IFES</option>{(dados?.ifes ?? []).map((x) => <option key={x.ifes} value={x.ifes}>{x.ifes}</option>)}</select></label>
        <Baixar href={csv("campi")} />
      </div>
      <p className="v2-sub">O campus é o município do campus (ex.: "Porto Velho (UNIR)"). Servidor sem campus informado conta na sede da IFES.</p>
      <div className="v2-tab-rank"><Tabela colunas={["#", "Campus", "UF", "IFES", "Docentes", "Técnicos", "Não declarados", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.campi.length ? SEM : undefined}>
        {(dados?.campi ?? []).map((x, i) => <tr key={`${x.ifes}|${x.ibge}`}><td className="num">{i + 1}</td><td>{x.municipio}</td><td>{x.uf}</td><td>{x.ifes}</td>{num(x.docente)}{num(x.tae)}{num(x.nd)}{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}
      </Tabela></div>
    </>
  );
  const tabApoio = (
    <Abas variante="interna" abas={[
      { id: "estado", rotulo: "Por estado", conteudo: (<><div className="v2-rank-barra"><span className="v2-sub">Apoiadores da sociedade civil</span><Baixar href={csv("apoiadores", "uf")} /></div>
        <div className="v2-tab-rank"><Tabela colunas={["#", "Estado", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.apoio.porUf.length ? SEM : undefined}>{(dados?.apoio.porUf ?? []).map((x, i) => <tr key={x.chave}><td className="num">{i + 1}</td><td>{x.nome}</td>{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}</Tabela></div></>) },
      { id: "cidade", rotulo: "Por cidade", conteudo: (<><div className="v2-rank-barra"><span className="v2-sub">Apoiadores da sociedade civil</span><Baixar href={csv("apoiadores", "cidade")} /></div>
        <div className="v2-tab-rank"><Tabela colunas={["#", "Cidade", "UF", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.apoio.porCidade.length ? SEM : undefined}>{(dados?.apoio.porCidade ?? []).map((x, i) => <tr key={x.chave}><td className="num">{i + 1}</td><td>{x.nome}</td><td>{x.uf}</td>{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}</Tabela></div></>) },
    ]} />
  );
  const tabExt = (
    <Abas variante="interna" abas={[
      { id: "pais", rotulo: "Por país", conteudo: (<><div className="v2-rank-barra"><span className="v2-sub">Estrangeiros</span><Baixar href={csv("exterior", "pais")} /></div>
        <div className="v2-tab-rank"><Tabela colunas={["#", "País", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.ext.porPais.length ? SEM : undefined}>{(dados?.ext.porPais ?? []).map((x, i) => <tr key={x.chave}><td className="num">{i + 1}</td><td>{x.nome}</td>{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}</Tabela></div></>) },
      { id: "uni", rotulo: "Por universidade", conteudo: (<><div className="v2-rank-barra"><span className="v2-sub">Estrangeiros</span><Baixar href={csv("exterior", "universidade")} /></div>
        <div className="v2-tab-rank"><Tabela colunas={["#", "Universidade", "País", "Total", "Confirmadas", "Aguardando"]} vazio={dados && !dados.ext.porUniversidade.length ? SEM : undefined}>{(dados?.ext.porUniversidade ?? []).map((x, i) => <tr key={x.chave}><td className="num">{i + 1}</td><td>{x.nome}</td><td>{x.pais}</td>{num(x.total)}{num(x.conf)}{num(x.pend)}</tr>)}</Tabela></div></>) },
    ]} />
  );

  return (
    <>
      <FiltrosShell>
        <div className="v2-cartao v2-rank-filtros">
          <div className="v2-rank-linha">
            <Segmentado rotulo="Situação" opcoes={STATUS.map((s) => ({ v: s.v, t: s.t }))} valor={status} onChange={setStatus} />
            <SeletorPeriodo rotulo="Período de cadastro" valor={periodo} onChange={setPeriodo} />
          </div>
          <div className="v2-rank-linha">
            <Multi rotulo="Estado" opcoes={opcoesUf} valor={uf} onChange={setUf} />
            <Caixa rotulo="Amazônia Legal" marcado={temRegiao("amazonia_legal")} onChange={(v) => alternaRegiao("amazonia_legal", v)} />
            <Caixa rotulo="Faixa de Fronteira" marcado={temRegiao("faixa_fronteira")} onChange={(v) => alternaRegiao("faixa_fronteira", v)} />
            {ativos ? <button type="button" className="adm-btn" onClick={() => { setStatus("todas"); setPeriodo({ de: "", ate: "" }); setUf([]); setRegiao([]); }}>Limpar filtros ({ativos})</button> : null}
          </div>
        </div>
      </FiltrosShell>
      {erro ? <p className="v2-aviso erro" role="alert">{erro}</p> : null}
      <div aria-busy={carregando} aria-live="polite">
        <Abas abas={[{ id: "ifes", rotulo: "IFES", conteudo: tabIfes }, { id: "campi", rotulo: "Campi", conteudo: tabCampi }, { id: "apoio", rotulo: "Apoiadores", conteudo: tabApoio }, { id: "ext", rotulo: "Exterior", conteudo: tabExt }]} />
      </div>
    </>
  );
}
