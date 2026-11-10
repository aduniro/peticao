"use client";
import { useEffect, useId, useRef, useState } from "react";
import { presidentAdminRequest } from "@/lib/president-admin-client";

export type PresidentProfileView = { revision: number; responsibleId: number; name: string; email: string; enabled: boolean; hasCpf: boolean; hasWhatsapp: boolean; fingerprint: string };
export type PresidentIssueDocumentView = { batchId: number; seq: number; kind: "partial" | "final"; documentVersion: string; originalSha256: string; signedSha256: string | null; listHash: string; signatureKind: string | null };
type AccountOption = { id: number; name: string; email: string };
type Intent = { requestId: string; batchId: number; expectedDocumentVersion: string; expectedProfileFingerprint: string };
type Recovery = { requestId: string; challengeId: string; batchId: number; documentVersion: string; state: string; createdAt: string; expiresAt: string; credentialsExpired: boolean; credentialsRecoverable: false; isCurrent: boolean; receiptId: string | null };
type Credentials = { id: string; token: string; password: string; expiresAt: number; documentVersion: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
const time = (value: unknown): value is string => typeof value === "string" && value.length <= 30 && Number.isFinite(Date.parse(value));
function profileView(value: unknown): PresidentProfileView | null | undefined {
  if (!object(value) || value.ok !== true) return undefined;
  if (value.profile === null) return null;
  const p = value.profile;
  if (!object(p) || !id(p.revision) || !id(p.responsibleId) || typeof p.name !== "string" || p.name.length > 120 || typeof p.email !== "string" || p.email.length > 254 || typeof p.enabled !== "boolean" || typeof p.hasCpf !== "boolean" || typeof p.hasWhatsapp !== "boolean" || typeof p.fingerprint !== "string" || !HASH.test(p.fingerprint)) return undefined;
  return { revision: p.revision, responsibleId: p.responsibleId, name: p.name, email: p.email, enabled: p.enabled, hasCpf: p.hasCpf, hasWhatsapp: p.hasWhatsapp, fingerprint: p.fingerprint };
}
function validIntent(value: unknown): value is Intent {
  return object(value) && typeof value.requestId === "string" && UUID.test(value.requestId) && id(value.batchId) && typeof value.expectedDocumentVersion === "string" && HASH.test(value.expectedDocumentVersion) && typeof value.expectedProfileFingerprint === "string" && HASH.test(value.expectedProfileFingerprint);
}
function recoveryView(value: unknown, intent: Intent): Recovery | null {
  if (!object(value) || value.ok !== true || value.requestId !== intent.requestId || value.batchId !== intent.batchId || value.documentVersion !== intent.expectedDocumentVersion || typeof value.challengeId !== "string" || !UUID.test(value.challengeId) || !["issued", "verifying", "consumed", "expired", "rejected", "revoked"].includes(String(value.state)) || !time(value.createdAt) || !time(value.expiresAt) || typeof value.credentialsExpired !== "boolean" || value.credentialsRecoverable !== false || typeof value.isCurrent !== "boolean" || !(value.receiptId === null || typeof value.receiptId === "string" && UUID.test(value.receiptId))) return null;
  return { requestId: intent.requestId, batchId: intent.batchId, documentVersion: intent.expectedDocumentVersion, challengeId: value.challengeId, state: String(value.state), createdAt: value.createdAt, expiresAt: value.expiresAt, credentialsExpired: value.credentialsExpired, credentialsRecoverable: false, isCurrent: value.isCurrent, receiptId: value.receiptId as string | null };
}
// MUDAR AQUI: textos do controle administrativo. Decisão reversível registrada no roteiro.
const COPY = {
  title: "Assinatura própria do app", profile: "Responsável pela assinatura", save: "Salvar responsável", refresh: "Conferir configuração",
  issue: "Gerar acesso do presidente", check: "Conferir solicitação", retry: "Repetir esta solicitação", replace: "Preparar outro acesso",
  uncertain: "Não foi possível confirmar o resultado. Confira a solicitação antes de tentar outra ação.",
};
/** Mount with a key containing actor/session + batch/document version; no secret prop is accepted. */
export default function PresidenteAcesso({ actorScope, accounts, initialProfile, document }: { actorScope: string; accounts: AccountOption[]; initialProfile: PresidentProfileView | null; document: PresidentIssueDocumentView | null }) {
  const title = useId();
  const [profile, setProfile] = useState(initialProfile);
  const [responsible, setResponsible] = useState(String(initialProfile?.responsibleId ?? accounts[0]?.id ?? ""));
  const [enabled, setEnabled] = useState(initialProfile?.enabled ?? true);
  const [cpf, setCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [replaceWhatsapp, setReplaceWhatsapp] = useState(false);
  const [profileUncertain, setProfileUncertain] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false), alive = useRef(true);
  const storageKey = `president-admin-issue:${actorScope}:${document?.batchId ?? "none"}`;
  const installIntent = (value: Intent | null) => {
    setIntent(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Raw credentials are never persisted. */ }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (validIntent(stored) && stored.batchId === document?.batchId && stored.expectedDocumentVersion === document.documentVersion && stored.expectedProfileFingerprint === initialProfile?.fingerprint) setIntent(stored);
    } catch { /* Session storage is optional and contains only the mutation context. */ }
    return () => { alive.current = false; };
  }, [storageKey, document?.batchId, document?.documentVersion, initialProfile?.fingerprint]);
  useEffect(() => {
    if (!credentials) return;
    const timer = setTimeout(() => { setCredentials(null); setShowCredentials(false); }, Math.max(0, credentials.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [credentials]);
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try { await action(); } finally { busy.current = false; if (alive.current) setPending(false); }
  };
  const acceptProfile = (next: PresidentProfileView | null) => {
    if (next?.fingerprint !== profile?.fingerprint) { setCredentials(null); setRecovery(null); installIntent(null); }
    setProfile(next); setResponsible(String(next?.responsibleId ?? accounts[0]?.id ?? "")); setEnabled(next?.enabled ?? true);
    setCpf(""); setWhatsapp(""); setReplaceWhatsapp(false); setProfileUncertain(false);
  };
  const readProfile = async () => {
    const result = await presidentAdminRequest("/api/admin/presidente/perfil", "GET");
    if (!alive.current) return;
    const next = result.ok ? profileView(result.data) : undefined;
    if (next === undefined) { setMessage(COPY.uncertain); return; }
    acceptProfile(next); setMessage("Configuração conferida.");
  };
  const saveProfile = async () => {
    if (profileUncertain || !accounts.some(a => a.id === Number(responsible))) return;
    const payload = { responsibleId: Number(responsible), expectedRevision: profile?.revision ?? 0, enabled, ...(cpf.trim() ? { cpf: cpf.trim() } : {}), ...(replaceWhatsapp ? { whatsapp: whatsapp.trim() } : {}) };
    const result = await presidentAdminRequest("/api/admin/presidente/perfil", "POST", payload);
    if (!alive.current) return;
    // Profile updates revoke live challenges; a lost response must not leave credentials presented as current.
    setCpf(""); setWhatsapp(""); setCredentials(null); setShowCredentials(false); setRecovery(null); setProfileUncertain(true);
    if (result.ok && object(result.data) && result.data.ok === true && id(result.data.revision)) await readProfile();
    else setMessage(result.ok || !result.ok && result.kind !== "http" ? COPY.uncertain : "Não foi possível salvar. Confira a configuração antes de editar novamente.");
  };
  const check = async () => {
    if (!intent) return;
    const result = await presidentAdminRequest(`/api/admin/presidente/desafio?requestId=${intent.requestId}`, "GET");
    if (!alive.current) return;
    const read = result.ok ? recoveryView(result.data, intent) : null;
    setNotFound(!result.ok && result.kind === "http" && result.status === 404);
    if (!read) { setMessage(COPY.uncertain); return; }
    setRecovery(read);
    if (!read.isCurrent || read.credentialsExpired || read.state === "revoked" || read.state === "rejected") { setCredentials(null); setShowCredentials(false); }
    setMessage("Solicitação conferida. A senha e o código não são recuperados por esta consulta.");
  };
  const issue = async (repeat: boolean) => {
    if (!document || document.signedSha256 !== null || ![null, "", "none"].includes(document.signatureKind) || !profile?.enabled || profileUncertain || intent && !repeat || repeat && (!intent || !notFound)) return;
    const next: Intent = repeat && intent ? intent : { requestId: crypto.randomUUID(), batchId: document.batchId, expectedDocumentVersion: document.documentVersion, expectedProfileFingerprint: profile.fingerprint };
    if (next.expectedProfileFingerprint !== profile.fingerprint || next.expectedDocumentVersion !== document.documentVersion) return;
    installIntent(next); setRecovery(null); setCredentials(null); setShowCredentials(false); setNotFound(false);
    const result = await presidentAdminRequest("/api/admin/presidente/desafio", "POST", next);
    if (!alive.current) return;
    const data = result.ok ? result.data : null;
    if (object(data) && data.ok === true && typeof data.id === "string" && UUID.test(data.id) && typeof data.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.token) && typeof data.password === "string" && /^[A-Za-z0-9_-]{12}$/.test(data.password) && typeof data.expiresAt === "number" && Number.isSafeInteger(data.expiresAt) && data.documentVersion === next.expectedDocumentVersion) {
      setCredentials({ id: data.id, token: data.token, password: data.password, expiresAt: data.expiresAt, documentVersion: data.documentVersion });
      setMessage("Acesso gerado. O código e a senha aparecem somente nesta resposta; compartilhe-os com o presidente por um canal privado.");
    } else setMessage(COPY.uncertain);
  };
  const nativeEligible = !!document && document.signedSha256 === null && [null, "", "none"].includes(document.signatureKind);
  const canIssue = nativeEligible && !!profile?.enabled && !profileUncertain && !intent && !pending;
  const needsCpf = !profile?.hasCpf || profile.responsibleId !== Number(responsible);
  return <section className="box" aria-labelledby={title} aria-busy={pending}>
    <h3 id={title}>{COPY.title}</h3>
    <form onSubmit={event => { event.preventDefault(); void run(saveProfile); }} autoComplete="off">
      <label>{COPY.profile}<select aria-label={COPY.profile} value={responsible} disabled={pending || profileUncertain} required onChange={event => { setResponsible(event.target.value); setCpf(""); setWhatsapp(""); setReplaceWhatsapp(false); }}>
        {!accounts.length && <option value="">Nenhuma conta ativa</option>}
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}
      </select></label>
      <label>CPF do responsável<input type="password" inputMode="numeric" autoComplete="off" maxLength={20} value={cpf} required={needsCpf} disabled={pending || profileUncertain} onChange={event => setCpf(event.target.value)} /></label>
      {!needsCpf && <p className="small">Deixe vazio para preservar o CPF cadastrado.</p>}
      <label className="adm-check"><input type="checkbox" checked={replaceWhatsapp} disabled={pending || profileUncertain} onChange={event => setReplaceWhatsapp(event.target.checked)} />Alterar WhatsApp do responsável</label>
      {replaceWhatsapp && <label>WhatsApp<input type="tel" autoComplete="off" placeholder="+5569000000000" maxLength={32} value={whatsapp} pattern="\+[1-9][0-9]{7,14}" disabled={pending || profileUncertain} onChange={event => setWhatsapp(event.target.value)} /><span className="small">Informe com código do país. Vazio remove o número; não envia mensagens.</span></label>}
      <label className="adm-check"><input type="checkbox" checked={enabled} disabled={pending || profileUncertain} onChange={event => setEnabled(event.target.checked)} />Habilitar acesso do presidente</label>
      <p className="small">Salvar altera a versão da configuração e revoga os acessos ainda não confirmados.</p>
      <div className="fim"><button type="submit" className="adm-btn" disabled={pending || profileUncertain || !accounts.length}>{COPY.save}</button><button type="button" className="adm-btn" disabled={pending} onClick={() => void run(readProfile)}>{COPY.refresh}</button></div>
    </form>
    {document && !nativeEligible && <p className="small">Este documento já possui uma versão assinada. Uma confirmação adicional não altera esse arquivo.</p>}
    <div className="fim"><button type="button" className="adm-btn" disabled={!canIssue} onClick={() => void run(() => issue(false))}>{COPY.issue}</button><button type="button" className="adm-btn" disabled={!intent || pending} onClick={() => void run(check)}>{COPY.check}</button>
      {notFound && intent && <button type="button" className="adm-btn" disabled={pending || profileUncertain || !nativeEligible} onClick={() => void run(() => issue(true))}>{COPY.retry}</button>}
    </div>
    {intent && <p className="small" style={{ overflowWrap: "anywhere" }}>Solicitação: <code>{intent.requestId}</code></p>}
    {message && <p role="status">{message}</p>}
    {credentials && <div className="box">
      <p>Abra <a href="/presidente" target="_blank" rel="noopener noreferrer">a página do presidente</a> e informe as credenciais abaixo. Elas não são inseridas no endereço.</p>
      <label className="adm-check"><input type="checkbox" checked={showCredentials} onChange={event => setShowCredentials(event.target.checked)} />Mostrar código e senha</label>
      <label>Código de acesso<input readOnly type={showCredentials ? "text" : "password"} autoComplete="off" value={credentials.token} /></label>
      <label>Senha temporária<input readOnly type={showCredentials ? "text" : "password"} autoComplete="off" value={credentials.password} /></label>
      <p>Válido até {new Date(credentials.expiresAt).toLocaleString("pt-BR")}. Ao sair desta página, as credenciais não poderão ser recuperadas.</p>
      <button type="button" className="adm-btn" onClick={() => { setCredentials(null); setShowCredentials(false); }}>Ocultar e descartar credenciais desta tela</button>
    </div>}
    {recovery && <div className="box"><p>Estado: {recovery.state} · {recovery.isCurrent && !recovery.credentialsExpired ? "vínculo atual" : "acesso indisponível"}</p><p>Válido até {new Date(recovery.expiresAt).toLocaleString("pt-BR")}.</p>{recovery.receiptId && <p style={{ overflowWrap: "anywhere" }}>Comprovante: <code>{recovery.receiptId}</code></p>}
      <label className="adm-check"><input type="checkbox" checked={confirmReplace} disabled={pending} onChange={event => setConfirmReplace(event.target.checked)} />Quero preparar outro acesso. A emissão seguinte revogará o acesso anterior ainda não confirmado.</label>
      <button type="button" className="adm-btn" disabled={!confirmReplace || pending} onClick={() => { setCredentials(null); setShowCredentials(false); setRecovery(null); setNotFound(false); setConfirmReplace(false); installIntent(null); setMessage("Pronto para uma nova solicitação explícita."); }}>{COPY.replace}</button>
    </div>}
  </section>;
}
