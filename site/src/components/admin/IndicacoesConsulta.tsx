"use client";
import { useEffect, useRef, useState } from "react";
import { appendReferralRows, parseReferralPeople, parseReferralStats, peoplePath, referralRequest, statsPath, type ReferralPeoplePage, type ReferralStatsPage, type ReferralStatsRow } from "@/lib/referral-admin-client";
type Props = { actorScope: string; initial: unknown; appBase: string; initialError?: string };
// MUDAR AQUI: textos administrativos de consulta; não modifica o formulário público.
const initialFailure = (value?: string) => value === "forbidden" ? "Sua sessão não permite consultar as indicações. Entre novamente com uma conta autorizada." : value ? "A consulta de indicações está indisponível. Tente consultar novamente." : "";
const COPY = { title: "Indicações e links pessoais", load: "Consultar indicações", refresh: "Atualizar indicações", more: "Carregar mais indicações", people: "Ver pessoas", hide: "Ocultar pessoas", morePeople: "Carregar mais pessoas", failed: "Não foi possível consultar os dados. A lista anterior foi preservada.", empty: "Nenhum código nesta consulta.", emptyPeople: "Nenhuma pessoa neste código.", pending: "aguardando confirmação", confirmed: "assinou" };
export default function IndicacoesConsulta(props: Props) { return <Consulta key={props.actorScope} {...props} />; }
function Consulta({ initial, appBase, initialError }: Props) {
  const [page, setPage] = useState<ReferralStatsPage | null>(() => parseReferralStats(initial));
  const [pending, setPending] = useState(false), [message, setMessage] = useState(initialFailure(initialError));const busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const read = async (more = false) => {
    if (busy.current) return;const before = more ? page?.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    busy.current = true;setPending(true);setMessage("");
    try { const result = await referralRequest(statsPath(before)), next = result.ok ? parseReferralStats(result.data, before) : null;if (!alive.current) return;
      const rows = next && (more ? appendReferralRows(page?.rows ?? [], next.rows, page?.nextBefore ?? null, before!) : next.rows);
      if (!next || !rows) { setMessage(COPY.failed);return; }setPage({ ...next, rows });
    } finally { busy.current = false;if (alive.current) setPending(false); }
  };
  const safeBase = (() => { if (!appBase) return "";try { const u = new URL(appBase);return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash ? appBase.replace(/\/$/, "") : ""; } catch { return ""; } })();
  return <section className="box" aria-label={COPY.title} aria-busy={pending}>
    <h2>{COPY.title}</h2>
    {page && <p>{page.totals.codes} códigos no total ({page.totals.personalCodes} pessoais e {page.totals.organizationCodes} de organizações) · <strong>{page.totals.visits}</strong> acessos por indicação · <strong>{page.totals.signed}</strong> assinaturas confirmadas · <strong>{page.totals.pending}</strong> aguardando confirmação.</p>}
    <p className="small">Os totais abrangem todos os códigos. Acessos representam visitantes distintos em cada código; a mesma pessoa pode acessar mais de um código.</p>
    <div className="fim"><button type="button" className="adm-btn" disabled={pending} onClick={() => void read()}>{page ? COPY.refresh : COPY.load}</button>{page?.nextBefore && <button type="button" className="adm-btn" disabled={pending} onClick={() => void read(true)}>{COPY.more}</button>}</div>
    {message && <p role="status">{message}</p>}
    {page && <p className="small">{page.rows.length} código(s) carregado(s) nesta lista. Quem indica vê somente os próprios totais; os nomes são visíveis apenas no painel administrativo.</p>}
    <div className="table-scroll"><table style={{ minWidth: 600 }}><thead><tr><th>Código</th><th>Quem</th><th>Acessos</th><th>Assinaram</th><th>Aguardando</th><th>Link e pessoas</th></tr></thead><tbody>
      {page?.rows.map(row => <ReferralRow key={row.id} row={row} publicBase={safeBase} />)}
      {page?.rows.length === 0 && <tr><td colSpan={6}>{COPY.empty}</td></tr>}
    </tbody></table></div>
  </section>;
}
function ReferralRow({ row, publicBase }: { row: ReferralStatsRow; publicBase: string }) {
  const [open, setOpen] = useState(false), [people, setPeople] = useState<ReferralPeoplePage | null>(null), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const read = async (more = false) => {
    if (busy.current) return;const before = more ? people?.nextBefore ?? undefined : undefined;if (more && before === undefined) return;
    busy.current = true;setPending(true);setMessage("");
    try { const result = await referralRequest(peoplePath(row.code, before)), next = result.ok ? parseReferralPeople(result.data, row.code, before) : null;if (!alive.current) return;
      const rows = next && (more ? appendReferralRows(people?.rows ?? [], next.rows, people?.nextBefore ?? null, before!) : next.rows);
      if (!next || !rows) { setMessage(COPY.failed);return; }setPeople({ ...next, rows });
    } finally { busy.current = false;if (alive.current) setPending(false); }
  };
  return <tr><td><code>{row.code}</code>{row.archivedAt && <span className="small"> · arquivado</span>}</td><td>{row.kind === "organization" && row.label !== null ? `${row.label} (organização)` : row.name ?? row.label ?? "—"}</td><td>{row.visits}</td><td>{row.signed}</td><td>{row.pending}</td>
    <td style={{ overflowWrap: "anywhere" }}><a href={`/api/cartaz/${encodeURIComponent(row.code)}?baixar=1`}>cartaz</a> · <span className="small">{publicBase}/r/{row.code}</span>
      <p><button type="button" className="adm-btn" aria-expanded={open} disabled={pending} onClick={() => { setOpen(!open);if (!open && !people) void read(); }}>{open ? COPY.hide : COPY.people}</button></p>
      {open && <div aria-busy={pending}>{message && <p role="status">{message}</p>}{people && <p className="small">{people.rows.length} de {people.total} pessoa(s) carregada(s).</p>}
        <ul>{people?.rows.map(person => <li key={person.id}>{person.name} <span className="small">({person.status === "confirmed" ? COPY.confirmed : COPY.pending}; {person.category})</span></li>)}</ul>
        {people?.rows.length === 0 && <p>{COPY.emptyPeople}</p>}
        <button type="button" className="adm-btn" disabled={pending} onClick={() => void read()}>Atualizar pessoas</button>{people?.nextBefore && <button type="button" className="adm-btn" disabled={pending} onClick={() => void read(true)}>{COPY.morePeople}</button>}
      </div>}
    </td></tr>;
}
