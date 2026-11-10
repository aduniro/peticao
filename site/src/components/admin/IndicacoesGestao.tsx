"use client";
import { useEffect, useRef, useState } from "react";
import { appendReferralRows, referralRequest } from "@/lib/referral-admin-client";
import { abandonLegacyReferral, applyReferralResult, mutationUuid, referralVersion, normalizeReferralLabel, parseManagedPage, parseReferralMutation, parseMutationResult, readyMutation, recoveredMutation, type ManagedReferralRow, type ReferralManagedPage, type ReferralMutation, type ReferralMutationState, type ReferralOperation, type LegacyReferralReference } from "@/lib/referral-management-client";
type Props = { actorScope: string; canArchive: boolean };
type Filter = "active" | "archived" | "all";
// MUDAR AQUI: rótulos e avisos da gestão administrativa de códigos de organizações.
const COPY = { title: "Gerenciar códigos de organizações", read: "Consultar organizações", refresh: "Atualizar organizações", more: "Carregar mais organizações", edit: "Editar rótulo", archive: "Arquivar", restore: "Restaurar", review: "Revisar ação", confirm: "Confirmar ação revisada", check: "Conferir resultado", retry: "Repetir a mesma solicitação", newAction: "Iniciar outra ação", rebase: "Atualizar versão mantendo meu texto", uncertain: "Não foi possível confirmar o resultado. Confira a solicitação antes de tentar outra ação.", failed: "Não foi possível consultar os códigos. A lista anterior foi preservada.", notFound: "A consulta não encontrou esta solicitação. Você pode repetir a mesma intenção ou atualizar a versão antes de revisar outra ação.", legacy: "O resultado desta solicitação legada não pôde ser recuperado. Consulte a linha atual antes de decidir se deseja abandonar apenas esta intenção local.", abandon: "Abandonar somente a intenção legada local", legacyConsent: "Conferi a linha atual e quero abandonar apenas esta intenção local. O resultado antigo continuará não confirmado.", done: "Resultado confirmado. Atualize a lista antes de iniciar outra ação.", archiveNote: "Arquivar organiza a lista administrativa. O link público e suas indicações continuam válidos." };
export default function IndicacoesGestao(props: Props) { return <Gestao key={props.actorScope} {...props} />; }
function Gestao({ actorScope, canArchive }: Props) {
  const [filter, setFilter] = useState<Filter>("active"), [page, setPage] = useState<ReferralManagedPage | null>(null);
  const [selected, setSelected] = useState<ManagedReferralRow | null>(null), [draft, setDraft] = useState(""), [operation, setOperation] = useState<ReferralOperation>("edit");
  const [state, setState] = useState<ReferralMutationState>(readyMutation), [reviewed, setReviewed] = useState(false), [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");const busy = useRef(false), alive = useRef(true), pageEpoch = useRef(0), reservedEpoch = useRef(0);
  const [needsStepup, setNeedsStepup] = useState(false);
  const [legacyCheckedAt, setLegacyCheckedAt] = useState<number | null>(null), [legacyConsent, setLegacyConsent] = useState(false);
  const [legacyReference, setLegacyReference] = useState<LegacyReferralReference | null>(null);
  const storageKey = `admin-referral-management:v1:${actorScope}`, legacyKey = `admin-referral-management:legacy-reference:v1:${actorScope}`;
  const unresolved = !!state.intent && state.mode !== "confirmed";
  const remember = (value: ReferralMutationState) => { setState(value);try { if (value.intent) sessionStorage.setItem(storageKey, JSON.stringify(value.intent));else sessionStorage.removeItem(storageKey); } catch { /* No automatic retry if optional storage is unavailable. */ } };
  useEffect(() => {
    alive.current = true;
    try { const raw = sessionStorage.getItem(storageKey);const intent = raw && raw.length <= 2048 ? parseReferralMutation(JSON.parse(raw)) : null;if (intent) { setState({ mode: "uncertain", intent, result: null });setDraft(intent.label ?? "");setOperation(intent.operation); } } catch { /* Malformed storage is never sent. */ }
    try { const raw = sessionStorage.getItem(legacyKey);const ref = raw && raw.length < 512 ? JSON.parse(raw) : null;if (ref && mutationUuid(ref.requestId) && Number.isInteger(ref.id) && ref.id > 0 && referralVersion(ref.observedVersion)) setLegacyReference({ requestId: ref.requestId, id: ref.id, observedVersion: ref.observedVersion }); } catch { /* Informational reference never authorizes an action. */ }
    setHydrated(true);return () => { alive.current = false; };
  }, [storageKey]);
  const run = async (job: () => Promise<void>) => { if (busy.current || !hydrated) return;busy.current = true;setPending(true);setMessage("");try { await job(); } finally { busy.current = false;if (alive.current) setPending(false); } };
  const read = async (more = false) => {
    const before = more ? page?.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    const q = new URLSearchParams({ filter });if (before) q.set("before", String(before));
    const result = await referralRequest(`/api/admin/indicacoes/gestao?${q}`), next = result.ok ? parseManagedPage(result.data, before, filter) : null;if (!alive.current) return;
    const rows = next && (more ? appendReferralRows(page?.rows ?? [], next.rows, page?.nextBefore ?? null, before!) : next.rows);
    if (!next || !rows) { setMessage(COPY.failed);return; }setPage({ ...next, rows });pageEpoch.current++;setLegacyConsent(false);
  };
  const select = (row: ManagedReferralRow, op: ReferralOperation) => {
    if (pending || unresolved || op !== "edit" && !canArchive) return;
    setSelected(row);setDraft(row.label);setOperation(op);setReviewed(false);remember(readyMutation());setMessage("");
  };
  const accept = (next: ReferralMutationState) => {
    remember(next);if (next.result) { const row = next.result.row;setSelected(row);setPage(previous => previous ? { ...previous, rows: applyReferralResult(previous.rows, row, filter) } : previous);setMessage(COPY.done); }
    else setMessage(next.mode === "not-found" ? COPY.notFound : next.mode === "legacy" ? COPY.legacy : COPY.uncertain);
  };
  const check = async () => {
    const intent = state.intent;if (!intent) return;const result = await referralRequest(`/api/admin/indicacoes/gestao?requestId=${intent.requestId}`);if (!alive.current) return;
    if (!result.ok && result.reason === "stepup") { setNeedsStepup(true);setMessage("Confirme seu acesso e depois confira esta solicitação novamente.");return; }
    const next = recoveredMutation(state, result.ok ? result.data : null, result.ok ? undefined : result.status, result.ok ? undefined : result.reason);
    setLegacyConsent(false);setLegacyCheckedAt(next.mode === "legacy" ? pageEpoch.current : null);accept(next);
  };
  const send = async (repeat = false) => {
    if (operation !== "edit" && !canArchive) return;
    let intent: ReferralMutation | null;
    if (repeat) intent = state.mode === "not-found" ? state.intent : null;
    else intent = selected && reviewed && !state.intent ? parseReferralMutation({ id: selected.id, version: selected.version, requestId: crypto.randomUUID(), operation, ...(operation === "edit" ? { label: normalizeReferralLabel(draft) } : {}) }) : null;
    if (!intent) return;
    const next: ReferralMutationState = { mode: "uncertain", intent, result: null };reservedEpoch.current = pageEpoch.current;remember(next);setReviewed(false);
    const result = await referralRequest("/api/admin/indicacoes/gestao", "POST", intent);if (!alive.current) return;
    if (!result.ok && result.reason === "stepup") { setNeedsStepup(true);setMessage("Confirme seu acesso e depois confira esta solicitação novamente.");return; }
    const parsed = result.ok ? parseMutationResult(result.data, intent) : null;
    accept(parsed ? { ...next, mode: "confirmed", result: parsed } : next);
  };
  const rebase = async () => {
    if (!state.intent || state.mode !== "not-found") return;
    // Read the exact row through a bounded list traversal supplied by the operator; never scan unboundedly.
    const current = pageEpoch.current > reservedEpoch.current ? page?.rows.find(r => r.id === state.intent!.id) : null;
    if (!current) { setMessage("Atualize a lista até localizar este código antes de atualizar a versão.");return; }
    setSelected(current);setReviewed(false);remember(readyMutation());setMessage("Versão atualizada. Seu texto foi preservado; revise novamente antes de confirmar.");
  };
  const legacyRow = state.intent ? page?.rows.find(row => row.id === state.intent!.id) : undefined;
  const legacyExit = abandonLegacyReferral(state, legacyRow, legacyCheckedAt, pageEpoch.current, legacyConsent);
  const abandonLegacy = () => {
    const exit = abandonLegacyReferral(state, legacyRow, legacyCheckedAt, pageEpoch.current, legacyConsent);if (!exit || pending) return;
    try { sessionStorage.setItem(legacyKey, JSON.stringify(exit.reference)); } catch { /* Reference remains visible in this session. */ }
    setLegacyReference(exit.reference);remember(exit.state);setSelected(null);setReviewed(false);setLegacyConsent(false);setLegacyCheckedAt(null);
    setMessage("Somente a intenção local foi abandonada. O resultado antigo continua não confirmado. Selecione uma linha e revise uma nova ação, se necessário.");
  };
  const validDraft = selected && parseReferralMutation({ id: selected.id, version: selected.version, requestId: "00000000-0000-4000-8000-000000000001", operation, ...(operation === "edit" ? { label: normalizeReferralLabel(draft) } : {}) });
  return <section className="box" aria-label={COPY.title} aria-busy={pending}>
    <h2>{COPY.title}</h2><p className="small">Somente códigos administrativos de organizações podem ser alterados aqui. Códigos pessoais permanecem na consulta.</p>
    <label>Situação<select value={filter} disabled={pending} onChange={event => { setFilter(event.target.value as Filter);setPage(null); }}><option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select></label>
    <div className="fim"><button type="button" className="adm-btn" disabled={!hydrated || pending} onClick={() => void run(() => read())}>{page ? COPY.refresh : COPY.read}</button>{page?.nextBefore && <button type="button" className="adm-btn" disabled={pending} onClick={() => void run(() => read(true))}>{COPY.more}</button>}</div>
    {message && <p role="status">{message}</p>}
    {legacyReference && <p className="small" style={{ overflowWrap: "anywhere" }}>Referência da intenção legada abandonada localmente: <code>{legacyReference.requestId}</code> · código interno {legacyReference.id} · versão consultada <code>{legacyReference.observedVersion}</code>. Resultado anterior não confirmado.</p>}{needsStepup && <p><a className="adm-btn" href="/admin/confirmar?volta=/admin/indicacoes">Confirmar acesso</a></p>}
    <div className="table-scroll"><table style={{ minWidth: 600 }}><thead><tr><th>Código</th><th>Organização</th><th>Versão</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{page?.rows.map(row => <tr key={row.id}><td><code>{row.code}</code></td><td>{row.label}</td><td><code>{row.version}</code></td><td>{row.archivedAt ? "Arquivado" : "Ativo"}</td><td>
      {!row.archivedAt && <button type="button" className="adm-btn" disabled={pending || unresolved} onClick={() => select(row, "edit")}>{COPY.edit}</button>}
      {canArchive && <button type="button" className="adm-btn" disabled={pending || unresolved} onClick={() => select(row, row.archivedAt ? "restore" : "archive")}>{row.archivedAt ? COPY.restore : COPY.archive}</button>}
    </td></tr>)}</tbody></table></div>
    {selected && <section className="box" aria-label="Revisar alteração do código"><h3>{selected.code}</h3><p>Versão: <code>{selected.version}</code> · Ação: {operation === "edit" ? COPY.edit : operation === "archive" ? COPY.archive : COPY.restore}</p>
      {operation === "edit" && <label>Rótulo da organização<input value={draft} maxLength={80} disabled={pending || unresolved || state.mode === "confirmed"} onChange={event => { setDraft(event.target.value);setReviewed(false); }} /></label>}
      {operation !== "edit" && <p>{COPY.archiveNote} A operação exige confirmação adicional de acesso. <a href="/admin/confirmar?volta=/admin/indicacoes">Confirmar acesso</a></p>}
      {!state.intent && <><button type="button" className="adm-btn" disabled={pending || !validDraft} onClick={() => setReviewed(true)}>{COPY.review}</button>{reviewed && <p role="status">Revisei o código, a ação e o texto acima.</p>}<button type="button" className="adm-btn" disabled={pending || !reviewed || !validDraft} onClick={() => void run(() => send())}>{COPY.confirm}</button></>}
    </section>}
    {state.intent && <div className="box" style={{ overflowWrap: "anywhere" }}><p>Solicitação: <code>{state.intent.requestId}</code> · versão esperada <code>{state.intent.version}</code></p>
      <button type="button" className="adm-btn" disabled={pending} onClick={() => void run(check)}>{COPY.check}</button>
      {state.mode === "legacy" && <div className="box"><p>Consulte novamente a lista e localize o código interno {state.intent.id}. A leitura deve ser posterior à conferência desta solicitação.</p>
        {legacyRow && <p>Versão atualmente consultada: <code>{legacyRow.version}</code> · <code>{legacyRow.code}</code> · {legacyRow.label}</p>}
        <label className="adm-check"><input type="checkbox" checked={legacyConsent} disabled={pending || !legacyRow || legacyCheckedAt === null || pageEpoch.current <= legacyCheckedAt} onChange={event => setLegacyConsent(event.target.checked)} />{COPY.legacyConsent}</label>
        <button type="button" className="adm-btn" disabled={pending || !legacyExit} onClick={abandonLegacy}>{COPY.abandon}</button>
      </div>}
      {state.mode === "not-found" && <><button type="button" className="adm-btn" disabled={pending || state.intent.operation !== "edit" && !canArchive} onClick={() => void run(() => send(true))}>{COPY.retry}</button><button type="button" className="adm-btn" disabled={pending} onClick={() => void run(rebase)}>{COPY.rebase}</button></>}
      {state.mode === "confirmed" && <button type="button" className="adm-btn" disabled={pending} onClick={() => { remember(readyMutation());setSelected(null);setReviewed(false);setPage(null);pageEpoch.current = 0;setMessage(""); }}>{COPY.newAction}</button>}
    </div>}
  </section>;
}
