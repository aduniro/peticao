"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { filtrosParaQuery, filtrosVazios, type Filtros } from "@/lib/assinaturas-filtros";
import type { Faceta, Ponto } from "@/lib/assinaturas-explorar";
import Grafico from "./Grafico";
import { Caixa, Faixa, Multi, Segmentado } from "./controles";

const Coropletico = dynamic(() => import("./Coropletico"), { ssr: false, loading: () => <div className="adm-skel" style={{ height: 460 }} /> });

type Dados = {
  totais: { confirmadas: number; pendentes: number; servidores: number; apoiadores: number; estrangeiros: number; cpfConferido: number };
  serie: { d: string; iniciadas: number; confirmadas: number }[];
  funil: { visitors: number; formStarts: number; signedVisitors: number; confirmedVisitors: number };
  estados: { uf: string; n: number }[];
  ranking: Record<"instituicao" | "campus" | "cargo" | "cidade" | "pais" | "universidade", { nome: string; valor: number }[]>;
  pontos: Ponto[]; semLocal: number;
};
const JANELAS = [{ v: "24h", t: "24 h" }, { v: "7d", t: "7 dias" }, { v: "30d", t: "30 dias" }, { v: "all", t: "Tudo" }] as const;
const CATEG: Faceta[] = [{ v: "servidor", n: 0, rotulo: "Servidor" }, { v: "apoiador", n: 0, rotulo: "Apoiador" }, { v: "estrangeiro", n: 0, rotulo: "Estrangeiro" }];
const CARGOS: Faceta[] = [{ v: "docente", n: 0, rotulo: "Docente" }, { v: "tae", n: 0, rotulo: "Técnico-administrativo (TAE)" }];
const brData = (d: string) => d.split("-").reverse().join("/");

/** Painel de entrada: KPIs, gráficos (Chart.js), mapa de estados em degradê, campi e controles interativos. */
export default function Dashboard() {
  const [f, setF] = useState<Filtros>(filtrosVazios());
  const [janela, setJanela] = useState<"24h" | "7d" | "30d" | "all">("30d");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [opcoes, setOpcoes] = useState<Record<string, Faceta[]>>({});
  const [dias, setDias] = useState<string[]>([]);
  const [faixa, setFaixa] = useState<[number, number] | null>(null);
  const [minimo, setMinimo] = useState(1);
  const [campi, setCampi] = useState(true);
  const [auto, setAuto] = useState(false);
  const [aberto, setAberto] = useState(true);
  useEffect(() => { if (window.innerWidth <= 768) setAberto(false); }, []);
  const seq = useRef(0);
  const qs = filtrosParaQuery(f);

  const carregar = useMemo(() => async () => {
    const id = ++seq.current; setCarregando(true);
    try {
      const r = await fetch(`/api/admin/dashboard?${qs}${qs ? "&" : ""}janela=${janela}`);
      const j = await r.json();
      if (id !== seq.current) return;
      if (!j.ok) { setErro(j.erro ?? "Falha ao carregar"); return; }
      setDados(j); setErro("");
    } catch { if (id === seq.current) setErro("Falha de rede"); }
    if (id === seq.current) setCarregando(false);
  }, [qs, janela]);

  useEffect(() => { const t = setTimeout(carregar, 150); return () => clearTimeout(t); }, [carregar]);
  useEffect(() => { if (!auto) return; const t = setInterval(carregar, 60_000); return () => clearInterval(t); }, [auto, carregar]);
  // opções dos dropdowns (sem filtro de data) e limites do slider de datas: uma vez
  useEffect(() => {
    fetch("/api/admin/assinaturas/explorar?limite=10").then((r) => r.json()).then((j) => { if (j.ok) setOpcoes(j.facetas); }).catch(() => {});
    fetch("/api/admin/dashboard?janela=all").then((r) => r.json()).then((j) => { if (j.ok) { const d: string[] = j.serie.map((x: any) => x.d); setDias(d); setFaixa(d.length ? [0, d.length - 1] : null); } }).catch(() => {});
  }, []);

  const set = (k: keyof Filtros, v: string[]) => setF((a) => ({ ...a, [k]: v }));
  const tem = (k: "regiao" | "cpf" | "status", v: string) => f[k].includes(v);
  const alterna = (k: "regiao" | "cpf" | "status", v: string, on: boolean) => setF((a) => ({ ...a, [k]: on ? [...a[k], v] : a[k].filter((x) => x !== v) }));
  const aplicaFaixa = (r: [number, number]) => { setFaixa(r); setF((a) => ({ ...a, de: r[0] > 0 ? dias[r[0]] : "", ate: r[1] < dias.length - 1 ? dias[r[1]] : "" })); };
  const pontos = useMemo(() => (dados?.pontos ?? []).filter((p) => p.conf + p.pend >= minimo), [dados, minimo]);
  const maxPonto = Math.max(1, ...(dados?.pontos ?? []).map((p) => p.conf + p.pend));
  const t = dados?.totais;
  const total = (t?.confirmadas ?? 0) + (t?.pendentes ?? 0);
  const ativos = (["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf"] as const).filter((k) => f[k].length).length + (f.de || f.ate ? 1 : 0);
  const rank = (k: keyof Dados["ranking"]) => ({ labels: (dados?.ranking[k] ?? []).map((x) => x.nome), datasets: [{ label: "Assinaturas", data: (dados?.ranking[k] ?? []).map((x) => x.valor) }] });
  const serie = useMemo(() => ({ labels: (dados?.serie ?? []).map((x) => brData(x.d)), datasets: [{ label: "Iniciadas", data: (dados?.serie ?? []).map((x) => x.iniciadas), cor: 1 }, { label: "Confirmadas", data: (dados?.serie ?? []).map((x) => x.confirmadas), cor: 0 }] }), [dados]);
  const rosca = useMemo(() => ({ labels: ["Servidores", "Apoiadores", "Estrangeiros"], datasets: [{ label: "Categorias", data: [t?.servidores ?? 0, t?.apoiadores ?? 0, t?.estrangeiros ?? 0] }] }), [t]);
  const funil = useMemo(() => ({ labels: ["Visitantes", "Iniciaram o formulário", "Assinaram (qualquer status)", "Confirmaram"], datasets: [{ label: "Visitantes", data: [dados?.funil.visitors ?? 0, dados?.funil.formStarts ?? 0, dados?.funil.signedVisitors ?? 0, dados?.funil.confirmedVisitors ?? 0] }] }), [dados]);
  const nada = (k: keyof Dados["ranking"]) => (dados?.ranking[k].length ? null : <p className="adm-sub">Sem dados com estes filtros.</p>);

  return (
    <section className="adm-dash" aria-label="Visão geral">
      <div className="adm-card">
        <div className="adm-barra-filtros">
          <Segmentado rotulo="Período das visitas (funil)" opcoes={JANELAS.map((j) => ({ v: j.v, t: j.t }))} valor={janela} onChange={setJanela} />
          <button type="button" className="adm-btn adm-filtros-btn" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>{aberto ? "Ocultar filtros" : "Filtros"}{ativos ? ` (${ativos})` : ""}</button>
        </div>
        <div hidden={!aberto} className="adm-filtros-corpo">
        <div className="adm-barra-filtros" role="search" style={{ marginTop: 10 }}>
          <Multi rotulo="Categoria" opcoes={CATEG} valor={f.categoria} onChange={(v) => set("categoria", v)} />
          <Multi rotulo="Cargo" opcoes={opcoes.cargo?.length ? opcoes.cargo : CARGOS} valor={f.cargo} onChange={(v) => set("cargo", v)} />
          <Multi rotulo="Instituição" opcoes={opcoes.instituicao ?? []} valor={f.instituicao} onChange={(v) => set("instituicao", v)} />
          <Multi rotulo="Campus" opcoes={opcoes.campus ?? []} valor={f.campus} onChange={(v) => set("campus", v)} />
          <Multi rotulo="Estado" opcoes={opcoes.uf ?? []} valor={f.uf} onChange={(v) => set("uf", v)} />
          <Multi rotulo="Cidade" opcoes={opcoes.cidade ?? []} valor={f.cidade} onChange={(v) => set("cidade", v)} />
          <Multi rotulo="País" opcoes={opcoes.pais ?? []} valor={f.pais} onChange={(v) => set("pais", v)} />
          <Multi rotulo="Universidade" opcoes={opcoes.universidade ?? []} valor={f.universidade} onChange={(v) => set("universidade", v)} />
        </div>
        <div className="adm-barra-filtros" style={{ marginTop: 10 }}>
          <Caixa rotulo="Amazônia Legal" marcado={tem("regiao", "amazonia_legal")} onChange={(v) => alterna("regiao", "amazonia_legal", v)} />
          <Caixa rotulo="Faixa de Fronteira" marcado={tem("regiao", "faixa_fronteira")} onChange={(v) => alterna("regiao", "faixa_fronteira", v)} />
          <Caixa rotulo="CPF conferido" marcado={tem("cpf", "sim")} onChange={(v) => alterna("cpf", "sim", v)} />
          <Caixa rotulo="Só confirmadas" marcado={tem("status", "confirmed")} onChange={(v) => alterna("status", "confirmed", v)} />
          <Caixa rotulo="Campi no mapa" marcado={campi} onChange={setCampi} />
          <Caixa rotulo="Atualizar a cada 1 min" marcado={auto} onChange={setAuto} />
          {ativos ? <button type="button" className="adm-btn" onClick={() => { setF(filtrosVazios()); if (dias.length) setFaixa([0, dias.length - 1]); }}>Limpar filtros ({ativos})</button> : null}
        </div>
        <div className="adm-barra-filtros" style={{ marginTop: 10 }}>
          {faixa && dias.length > 1 ? <Faixa rotulo="Intervalo de datas" min={0} max={dias.length - 1} valor={faixa} onChange={aplicaFaixa} formato={(n) => brData(dias[n] ?? "")} /> : null}
          <Faixa rotulo="Mínimo de assinaturas por local (mapa)" min={1} max={Math.max(2, maxPonto)} valor={minimo} onChange={setMinimo} />
        </div>
        </div>
      </div>
      {erro ? <p className="err" role="alert">{erro}</p> : null}
      <div className="adm-kpis" aria-live="polite" aria-busy={carregando}>
        <div className="adm-kpi"><b>{total}</b><span>cadastros</span></div>
        <div className="adm-kpi"><b>{t?.confirmadas ?? 0}</b><span>confirmadas{total ? ` (${Math.round(((t?.confirmadas ?? 0) / total) * 100)}%)` : ""}</span></div>
        <div className="adm-kpi"><b>{t?.pendentes ?? 0}</b><span>aguardando confirmação</span></div>
        <div className="adm-kpi"><b>{t?.servidores ?? 0}</b><span>servidores</span></div>
        <div className="adm-kpi"><b>{t?.apoiadores ?? 0}</b><span>apoiadores</span></div>
        <div className="adm-kpi"><b>{t?.estrangeiros ?? 0}</b><span>estrangeiros</span></div>
        <div className="adm-kpi"><b>{t?.cpfConferido ?? 0}</b><span>com CPF conferido</span></div>
      </div>
      <div className="adm-grid">
        <div className="adm-card adm-c8"><h3>Assinaturas por dia</h3><Grafico tipo="line" dados={serie} altura={260} /></div>
        <div className="adm-card adm-c4"><h3>Categorias</h3><Grafico tipo="doughnut" dados={rosca} altura={260} /></div>
        <div className="adm-card adm-c8"><h3>Estados <small className="adm-sub">(vermelho: menos · azul: mais · amarelo: campi)</small></h3>
          <Coropletico estados={dados?.estados ?? []} pontos={pontos} selecionadas={f.uf} onSelecionar={(ufs) => set("uf", ufs)} campi={campi} />
          {dados?.semLocal ? <p className="adm-sub">{dados.semLocal} assinatura(s) sem local identificado não aparecem no mapa.</p> : null}</div>
        <div className="adm-card adm-c4"><h3>Funil de visitas</h3><Grafico tipo="bar" dados={funil} horizontal altura={260} /></div>
        <div className="adm-card adm-c6"><h3>Instituições</h3><Grafico tipo="bar" dados={rank("instituicao")} horizontal altura={280} />{nada("instituicao")}</div>
        <div className="adm-card adm-c6"><h3>Campi</h3><Grafico tipo="bar" dados={rank("campus")} horizontal altura={280} />{nada("campus")}</div>
        <div className="adm-card adm-c4"><h3>Cargos</h3><Grafico tipo="bar" dados={rank("cargo")} horizontal altura={220} />{nada("cargo")}</div>
        <div className="adm-card adm-c4"><h3>Cidades</h3><Grafico tipo="bar" dados={rank("cidade")} horizontal altura={220} />{nada("cidade")}</div>
        <div className="adm-card adm-c4"><h3>Países e universidades</h3><Grafico tipo="bar" dados={rank(dados?.ranking.universidade.length ? "universidade" : "pais")} horizontal altura={220} />{nada("pais")}</div>
      </div>
      <p className="adm-sub"><a href={`/admin/mapa${qs ? `?${qs}` : ""}`}>Abrir mapa e tabela com estes filtros →</a></p>
    </section>
  );
}
