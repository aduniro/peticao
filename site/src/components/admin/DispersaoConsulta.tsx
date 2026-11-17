"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { brasilia } from "@/lib/time";
import { appendDispersionRows, enterDispersionNode, getDispersion, type DispersionQuery } from "@/lib/dispersion-admin-client";
import { CHAIN_LABELS, ORIGIN_LABELS, parseDispersionPage, type DispersionAllRow, type DispersionPage, type DispersionTreeNode } from "@/lib/dispersion-admin-view";
type Props = { actorScope: string; initial: unknown; initialError?: string };
type Loaded = { page: DispersionPage; times: string[] };
// MUDAR AQUI: textos internos da Dispersão; vínculos não determinam a validade das assinaturas.
const COPY = { title: "Dispersão da campanha", failed: "Não foi possível consultar os dados. A lista anterior foi preservada.", all: "Consultar assinaturas", refresh: "Atualizar assinaturas", more: "Carregar mais assinaturas", roots: "Consultar raízes", moreRoots: "Carregar mais raízes", children: "Ver filhos", moreChildren: "Carregar mais filhos", back: "Voltar um nível", diagnostics: "Consultar diagnósticos de vínculos", moreDiagnostics: "Carregar mais diagnósticos", inspect: "Examinar vínculo na árvore", cycle: "Este vínculo retorna a um registro já visitado. A navegação foi interrompida para evitar um ciclo. Isso não invalida a assinatura.", unknown: "Não determinada", asOf: "Cada consulta tem seu próprio horário. As páginas carregadas podem refletir momentos diferentes; não representam um único snapshot." };
const pct = (value: number | null) => value === null ? "Não determinado" : `${Math.round(value * 100)}%`;
export default function DispersaoConsulta(props: Props) { return <Consulta key={props.actorScope} {...props} />; }
function Consulta({ initial, initialError }: Props) {
  const first = useMemo(() => parseDispersionPage(initial, { view: "all", limit: 50 }), [initial]);
  const [all, setAll] = useState<Loaded | null>(() => first ? { page: first, times: [first.asOf] } : null);
  const [tree, setTree] = useState<Loaded | null>(null), [diagnostics, setDiagnostics] = useState<Loaded | null>(null), [path, setPath] = useState<number[]>([]);
  const [latest, setLatest] = useState<DispersionPage | null>(first), [generationLimit, setGenerationLimit] = useState(50);
  const [allPending, setAllPending] = useState(false), [treePending, setTreePending] = useState(false), [diagPending, setDiagPending] = useState(false);
  const [allMessage, setAllMessage] = useState(initialError ? initialError === "forbidden" ? "Sua sessão não permite consultar a dispersão. Entre novamente com uma conta autorizada." : "A consulta de dispersão está indisponível." : ""), [treeMessage, setTreeMessage] = useState(""), [diagMessage, setDiagMessage] = useState("");
  const alive = useRef(true), allBusy = useRef(false), treeBusy = useRef(false), diagBusy = useRef(false);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const obtain = async (query: DispersionQuery) => { const response = await getDispersion(query);return response.ok ? parseDispersionPage(response.data, query) : null; };
  const loadAll = async (more = false) => {
    if (allBusy.current) return;const before = more ? all?.page.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    allBusy.current = true;setAllPending(true);setAllMessage("");
    try { const page = await obtain({ view: "all", ...(before ? { before } : {}) });if (!alive.current) return;const rows = page && (more ? appendDispersionRows(all?.page.rows ?? [], page.rows, all?.page.nextBefore ?? null, before!) : page.rows);if (!page || !rows) { setAllMessage(COPY.failed);return; }setAll({ page: { ...page, rows }, times: more ? [...all!.times, page.asOf] : [page.asOf] });setLatest(page); }
    finally { allBusy.current = false;if (alive.current) setAllPending(false); }
  };
  const loadTree = async (query: DispersionQuery = { view: "roots" }, targetPath: number[] = [], more = false) => {
    if (treeBusy.current) return;const before = more ? tree?.page.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    treeBusy.current = true;setTreePending(true);setTreeMessage("");
    try { const page = await obtain({ ...query, ...(before ? { before } : {}) });if (!alive.current) return;const rows = page && (more ? appendDispersionRows(tree?.page.rows ?? [], page.rows, tree?.page.nextBefore ?? null, before!) : page.rows);if (!page || !rows) { setTreeMessage(COPY.failed);return; }setTree({ page: { ...page, rows }, times: more ? [...tree!.times, page.asOf] : [page.asOf] });setPath(targetPath);setLatest(page); }
    finally { treeBusy.current = false;if (alive.current) setTreePending(false); }
  };
  const enter = (node: DispersionTreeNode, external = false) => {
    const next = enterDispersionNode(external ? [] : path, node.id);if (!next.ok) { setTreeMessage(next.reason === "cycle" ? COPY.cycle : COPY.failed);return; }
    void loadTree({ view: "children", parentId: node.id }, next.path);
  };
  const loadDiagnostics = async (more = false) => {
    if (diagBusy.current) return;const before = more ? diagnostics?.page.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    diagBusy.current = true;setDiagPending(true);setDiagMessage("");
    try { const page = await obtain({ view: "diagnostics", ...(before ? { before } : {}) });if (!alive.current) return;const rows = page && (more ? appendDispersionRows(diagnostics?.page.rows ?? [], page.rows, diagnostics?.page.nextBefore ?? null, before!) : page.rows);if (!page || !rows) { setDiagMessage(COPY.failed);return; }setDiagnostics({ page: { ...page, rows }, times: more ? [...diagnostics!.times, page.asOf] : [page.asOf] });setLatest(page); }
    finally { diagBusy.current = false;if (alive.current) setDiagPending(false); }
  };
  const treeQuery: DispersionQuery = tree?.page.view === "children" && tree.page.focus ? { view: "children", parentId: tree.page.focus.id } : { view: "roots" };
  const generations = latest?.summary.byGeneration.filter(g => g.generation !== null) ?? [], unknownGeneration = latest?.summary.byGeneration.find(g => g.generation === null);
  return <section aria-label={COPY.title}>
    <p>De onde vieram as assinaturas: link direto, código de uma organização ou link/QR de outro assinante. <a href="/api/admin/dispersao">Baixar base interna (CSV, com e-mail e horário de Brasília)</a>. <strong>Não envie esse arquivo às autoridades.</strong></p>
    <p className="small">{COPY.asOf}</p>
    {latest && <section aria-label="Resumo global da dispersão"><p className="small">Resumo global consultado em {brasilia(latest.asOf, true)}.</p>
      <div className="stats"><div><strong>{latest.summary.confirmed}</strong><span>assinaturas confirmadas ({latest.summary.total} no total; {latest.summary.pending} aguardando)</span></div>
        {(["direto","organizacao","pessoal","desconhecido"] as const).map(k => <div key={k}><strong>{latest.summary.byOrigin[k].confirmed}</strong><span>{ORIGIN_LABELS[k]} ({latest.summary.confirmed ? pct(latest.summary.byOrigin[k].confirmed / latest.summary.confirmed) : "—"})</span></div>)}
        <div><strong>{latest.summary.avgInvitedPerConfirmed === null ? "Não determinado" : latest.summary.avgInvitedPerConfirmed.toFixed(2)}</strong><span>convites que viraram assinatura, por assinante</span></div><div><strong>{pct(latest.summary.deepShare)}</strong><span>vieram de uma cadeia com 2+ repasses</span></div>
      </div>
      <p className="small">Vínculos analisados: {latest.coverage.analyzed}/{latest.coverage.total}. Geração não determinada em {latest.coverage.generationUnknown} registros; alcance não determinado em {latest.coverage.reachUnknown}. Esses diagnósticos não alteram a situação das assinaturas.</p>
      <p className="small">Cobertura dos índices: convites confirmados {latest.summary.metricCoverage.avgInvitedPerConfirmed.numerator}/{latest.summary.metricCoverage.avgInvitedPerConfirmed.denominator}, com {latest.summary.metricCoverage.avgInvitedPerConfirmed.unknown} atribuição(ões) não determinada(s); cadeias com 2+ repasses {latest.summary.metricCoverage.deepShare.numerator}/{latest.summary.metricCoverage.deepShare.denominator}, com {latest.summary.metricCoverage.deepShare.unknown} geração(ões) não determinada(s).</p>
      <h2>Por geração</h2><p className="small">Geração 0 = entrou direto ou por código de organização. Geração 1 = entrou pelo link de alguém da geração 0. Geração 2+ = o link foi repassado por novos assinantes. Vínculos não resolvidos aparecem separadamente.</p>
      <div className="table-scroll"><table><thead><tr><th>Geração</th><th>Pessoas</th><th>Confirmadas</th><th>Aguardando</th></tr></thead><tbody>{generations.slice(0,generationLimit).map(g => <tr key={g.generation}><td>{g.generation}</td><td>{g.total}</td><td>{g.confirmed}</td><td>{g.pending}</td></tr>)}{latest.summary.total === 0 && <tr><td colSpan={4}>Sem assinaturas ainda.</td></tr>}{unknownGeneration && <tr><td>{COPY.unknown}</td><td>{unknownGeneration.total}</td><td>{unknownGeneration.confirmed}</td><td>{unknownGeneration.pending}</td></tr>}</tbody></table></div>
      {generations.length > generationLimit && <button type="button" className="adm-btn" onClick={() => setGenerationLimit(n => n + 50)}>Mostrar mais gerações</button>}
      <h2>Quem mais trouxe gente</h2><div className="table-scroll"><table style={{minWidth:600}}><thead><tr><th>Assinante</th><th>Convidou</th><th>Confirmaram</th><th>Alcance total*</th></tr></thead><tbody>{latest.summary.spreaders.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.invited}</td><td>{p.invitedConfirmed}</td><td>{p.reach}</td></tr>)}{latest.summary.spreaders.length === 0 && <tr><td colSpan={4}>Ninguém trouxe outra pessoa com alcance determinado ainda.</td></tr>}</tbody></table></div><p className="small">* Alcance total = assinaturas confirmadas descendentes da pessoa, conforme vínculos resolvidos. O ranking é global; {latest.coverage.rankingExcluded} registro(s) sem alcance determinado ficam fora dessa comparação.</p>
      <h2>Repasse do e-mail de confirmação</h2><p>Das confirmadas: <strong>{latest.summary.sameDevice}</strong> confirmaram no mesmo aparelho em que assinaram, <strong>{latest.summary.notSameDevice}</strong> em outro aparelho e <strong>{latest.summary.unknownDevice}</strong> não têm essa informação. <span className="small">Atenção: é só um indício. Abrir o e-mail no celular e assinar no computador, ou o navegador embutido do aplicativo de e-mail, também aparece como outro aparelho.</span></p>
    </section>}
    <section className="box" aria-label="Árvore de indicações" aria-busy={treePending}><h2>Árvore de indicações</h2><p className="small">Explore raízes e filhos por consulta. A navegação não corta gerações por profundidade.</p>
      <div className="fim"><button type="button" className="adm-btn" disabled={treePending} onClick={() => void loadTree()}>{COPY.roots}</button>{path.length > 0 && <button type="button" className="adm-btn" disabled={treePending} onClick={() => { const parent = path.at(-2);void loadTree(parent ? {view:"children",parentId:parent} : {view:"roots"},path.slice(0,-1)); }}>{COPY.back}</button>}</div>
      {treeMessage && <p role="status">{treeMessage}</p>}{path.length > 0 && <p className="small" style={{overflowWrap:"anywhere"}}>Caminho: {path.length} registro(s) visitado(s) · {path.slice(-6).join(" → ")}{path.length > 6 ? " (últimos registros)" : ""}.</p>}
      {tree?.page.focus && <p>Examinando <strong>{tree.page.focus.name}</strong> · origem {tree.page.focus.ownerId === null ? ORIGIN_LABELS[tree.page.focus.origin] : tree.page.focus.parentName ?? "origem pessoal não localizada"} · {tree.page.focus.invited} filho(s) no total.</p>}
      {tree && <Moments value={tree} />}
      <ul className="tree">{tree?.page.rows.map(node => <li key={node.id}><NodeText node={node} /> <button type="button" className="adm-btn" disabled={treePending || node.invited === 0} onClick={() => enter(node)}>{COPY.children}</button></li>)}</ul>
      {tree?.page.rows.length === 0 && <p>Nenhum registro nesta consulta.</p>}{tree?.page.nextBefore && <button type="button" className="adm-btn" disabled={treePending} onClick={() => void loadTree(treeQuery,path,true)}>{tree.page.view === "children" ? COPY.moreChildren : COPY.moreRoots}</button>}
    </section>
    <section className="box" aria-label="Diagnósticos de vínculos" aria-busy={diagPending}><h2>Diagnósticos de vínculos</h2><p>Problemas de indicação ou parentesco do grafo. Não significam que a assinatura é inválida.</p>
      <button type="button" className="adm-btn" disabled={diagPending} onClick={() => void loadDiagnostics()}>{COPY.diagnostics}</button>{diagMessage && <p role="status">{diagMessage}</p>}{diagnostics && <Moments value={diagnostics} />}
      <ul>{diagnostics?.page.rows.map(node => <li key={node.id}><NodeText node={node} /> <button type="button" className="adm-btn" disabled={treePending} onClick={() => enter(node,true)}>{COPY.inspect}</button></li>)}</ul>{diagnostics?.page.nextBefore && <button type="button" className="adm-btn" disabled={diagPending} onClick={() => void loadDiagnostics(true)}>{COPY.moreDiagnostics}</button>}
    </section>
    <section aria-label="Todas as assinaturas" aria-busy={allPending}><h2>Todas as assinaturas{all ? ` (${all.page.total} no total)` : ""}</h2><div className="fim"><button type="button" className="adm-btn" disabled={allPending} onClick={() => void loadAll()}>{all ? COPY.refresh : COPY.all}</button>{all?.page.nextBefore && <button type="button" className="adm-btn" disabled={allPending} onClick={() => void loadAll(true)}>{COPY.more}</button>}</div>{allMessage && <p role="status">{allMessage}</p>}{all && <Moments value={all} />}
      <div className="table-scroll"><table style={{minWidth:1000}}><thead><tr><th>Assinou em (Brasília)</th><th>Nome</th><th>E-mail</th><th>Instituição pelo e-mail</th><th>Origem</th><th>Quem indicou / código</th><th>Ger.</th><th>Convidou</th><th>Situação</th><th>Vínculo</th></tr></thead><tbody>{all?.page.rows.map(item => { const r = item as DispersionAllRow;return <tr key={r.id}><td>{brasilia(r.consentAt)}</td><td>{r.name}</td><td>{r.email}</td><td>{r.emailInstitution ?? r.emailDomain ?? "—"}{r.emailDomainKindLabel && <span className="small"> · {r.emailDomainKindLabel}</span>}</td><td>{ORIGIN_LABELS[r.origin]}</td><td>{r.origin === "pessoal" ? r.parentName ?? "—" : r.orgLabel ?? "—"}{r.refCode !== null && <span className="small"> · {r.refCode || "código vazio"}</span>}</td><td>{r.generation ?? COPY.unknown}</td><td>{r.invitedConfirmed}/{r.invited}</td><td>{r.status === "confirmed" ? `confirmada ${brasilia(r.confirmedAt)}` : "aguardando"}</td><td>{CHAIN_LABELS[r.chainState]}</td></tr>;})}{all?.page.rows.length === 0 && <tr><td colSpan={10}>Sem assinaturas ainda.</td></tr>}</tbody></table></div>
    </section>
  </section>;
}
function NodeText({node}:{node:DispersionTreeNode}) { return <span style={{overflowWrap:"anywhere"}}><strong>{node.name}</strong> <span className="small">({node.status === "confirmed" ? "assinou" : "aguardando"} · geração {node.generation ?? COPY.unknown} · {node.invitedConfirmed}/{node.invited} convidados confirmados · {CHAIN_LABELS[node.chainState]}{node.cycleSize ? ` · ciclo com ${node.cycleSize} registro(s)` : ""})</span></span>; }
function Moments({value}:{value:Loaded}) { return <p className="small">{value.page.rows.length} de {value.page.total} registro(s) carregado(s). Última consulta: {brasilia(value.page.asOf,true)}. {value.times.length > 1 ? `${value.times.length} páginas consultadas em momentos próprios.` : ""}</p>; }
