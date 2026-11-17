"use client";

import { useEffect, useRef, useState } from "react";

const ENDPOINT = "/api/admin/presidente/a1/credencial";
const MAX_FILE = 2 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
type Credential = { credentialVersionId: string; certificateFingerprintSha256: string; cnpj: string; notBefore: string; notAfter: string; profileVersion: string; trustStoreVersion: string; activatedAt: string | null };
type Snapshot = { configured: boolean; credential: Credential | null; intent?: { requestId: string; state: "completed" | "not_found"; activated: boolean } };
type Operation = "reading" | "posting" | null;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const MESSAGES: Record<string, string> = {
  forbidden: "Confirme novamente sua senha de administrador para continuar.",
  invalid_request: "Confira o arquivo e a senha do certificado.",
  invalid_certificate: "Não foi possível abrir o certificado. Confira o arquivo e a senha.",
  certificate_invalid: "O certificado foi recusado. Confira sua validade, o arquivo e a senha.",
  password_or_certificate_invalid: "Não foi possível abrir o certificado. Confira o arquivo e a senha.",
  certificate_expired_or_not_yet_valid: "O certificado está fora do período de validade. Cadastre um certificado vigente.",
  certificate_expired: "O certificado está vencido. Cadastre um certificado vigente.",
  certificate_not_yet_valid: "O certificado ainda não está no período de validade.",
  holder_mismatch: "O certificado precisa pertencer ao e-CNPJ da ADUNIR.",
  cnpj_mismatch: "O certificado precisa pertencer ao e-CNPJ da ADUNIR.",
  activation_pending: "O certificado foi recebido, mas a ativação ainda precisa ser conferida.",
  signing_unavailable: "O serviço de certificados está indisponível. Aguarde e confira o resultado.",
  unavailable: "O serviço de certificados está indisponível. Aguarde e confira o resultado.",
  credential_service_unavailable: "O serviço de certificados está indisponível. Aguarde e confira o resultado.",
  configuration_unavailable: "O serviço de certificados ainda não está pronto. Aguarde e consulte novamente.",
  storage_unavailable: "Não foi possível confirmar o armazenamento do certificado. Confira o resultado antes de continuar.",
  request_conflict: "Esse pedido já está associado a outro cadastro. Confira o resultado antes de continuar.",
  revocation_unavailable: "Não foi possível conferir a revogação do certificado. Aguarde e confira o resultado.",
  chain_or_revocation_unavailable: "Não foi possível conferir a cadeia de confiança ou a revogação do certificado. Aguarde e confira o resultado.",
  chain_or_revocation_invalid: "A cadeia de confiança ou a situação de revogação do certificado não foi validada.",
  key_mismatch: "A chave do arquivo não corresponde ao certificado. Escolha o arquivo A1 correto.",
  request_not_found: "O cadastro anterior não foi encontrado. Confira o resultado e inicie um novo cadastro quando autorizado.",
  credential_superseded: "Outro certificado foi cadastrado depois deste pedido. Confira o certificado atual antes de continuar.",
};

function credential(value: unknown): Credential | null {
  if (!object(value) || typeof value.credentialVersionId !== "string" || !UUID.test(value.credentialVersionId) || typeof value.certificateFingerprintSha256 !== "string" || !SHA.test(value.certificateFingerprintSha256) || typeof value.cnpj !== "string" || !/^\d{14}$/.test(value.cnpj) || !timestamp(value.notBefore) || !timestamp(value.notAfter) || typeof value.profileVersion !== "string" || value.profileVersion.length > 100 || typeof value.trustStoreVersion !== "string" || !SHA.test(value.trustStoreVersion) || !(value.activatedAt === null || timestamp(value.activatedAt))) return null;
  return value as Credential;
}

function snapshot(value: unknown, expectedRequestId: string | null): Snapshot | null {
  if (!object(value) || value.ok !== true || typeof value.configured !== "boolean") return null;
  const cert = value.credential === null ? null : credential(value.credential);
  if (value.credential !== null && !cert || value.configured && !cert) return null;
  let intent: Snapshot["intent"];
  if (expectedRequestId) {
    if (!object(value.intent) || value.intent.requestId !== expectedRequestId || !["completed", "not_found"].includes(String(value.intent.state)) || typeof value.intent.activated !== "boolean") return null;
    intent = value.intent as Snapshot["intent"];
    if (intent?.activated && (intent.state !== "completed" || !cert)) return null;
    if (intent?.state === "completed" && (!cert || cert.credentialVersionId !== expectedRequestId)) return null;
  }
  return { configured: value.configured, credential: cert, ...(intent ? { intent } : {}) };
}

async function request(method: "GET" | "POST", intent: string | null, body?: object): Promise<{ response: Response; value: unknown }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), method === "GET" ? 15_000 : 75_000);
  try {
    const response = await fetch(ENDPOINT + (method === "GET" && intent ? `?requestId=${encodeURIComponent(intent)}` : ""), { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    // Never render arbitrary service error text (which could contain secrets).
    const text = await response.text();
    if (text.length > 64 * 1024) throw new Error("response_limit");
    return { response, value: JSON.parse(text) as unknown };
  } finally { clearTimeout(timer); }
}

export default function A1Credencial({ actorScope }: { actorScope: string }) {
  const [status, setStatus] = useState<Snapshot | null>(null), [operation, setOperation] = useState<Operation>(null), [message, setMessage] = useState("");
  const [password, setPassword] = useState(""), [file, setFile] = useState<File | null>(null), [consent, setConsent] = useState(false), [resetConsent, setResetConsent] = useState(false);
  const [intent, setIntent] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), alive = useRef(true), busy = useRef(false);
  const key = `a1-credential-intent:v1:${actorScope}`;
  const remember = (id: string | null) => {
    setIntent(id);
    try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* Recovery stays available in memory. */ }
  };
  const clearSecrets = () => { setPassword(""); setFile(null); if (fileInput.current) fileInput.current.value = ""; };
  const read = async (id: string | null) => {
    if (busy.current) return;
    busy.current = true; setOperation("reading"); setResetConsent(false);
    try {
      const { response, value } = await request("GET", id);
      const next = response.ok ? snapshot(value, id) : null;
      if (!next) throw new Error("unavailable");
      if (!alive.current) return;
      setStatus(next);
      if (next.intent?.state === "completed" && next.intent.activated) {
        setUncertain(false); remember(null); setMessage("Certificado cadastrado e ativado. Você já pode solicitar a assinatura A1.");
      } else if (id) {
        setUncertain(true);
        setMessage(next.intent?.state === "completed" ? "Certificado recebido. Conclua a ativação abaixo para usá-lo." : "Nenhum cadastro foi encontrado para este pedido. Nenhum arquivo será reenviado automaticamente.");
      } else { setMessage(next.configured ? "Certificado ativo para assinatura A1." : "Assinatura A1 habilitada. Cadastre o certificado da ADUNIR para começar."); }
    } catch {
      if (alive.current) { setMessage("Não foi possível conferir o certificado agora. Tente consultar novamente."); if (id) setUncertain(true); }
    } finally { busy.current = false; if (alive.current) setOperation(null); }
  };
  useEffect(() => {
    alive.current = true;
    let restored: string | null = null;
    try { const raw = sessionStorage.getItem(key); if (raw && UUID.test(raw)) restored = raw; } catch { /* Optional storage. */ }
    if (restored) { setIntent(restored); setUncertain(true); }
    void read(restored);
    return () => { alive.current = false; if (fileInput.current) fileInput.current.value = ""; };
  }, [actorScope]);

  const submit = async (complete = false) => {
    if (busy.current || !consent || !status || complete && (!intent || status.intent?.state !== "completed" || status.intent.activated) || !complete && uncertain) return;
    if (!complete && (!file || !/\.(pfx|p12)$/i.test(file.name) || file.size < 1 || file.size > MAX_FILE || password.length < 1 || password.length > 4096)) {
      setMessage("Escolha um certificado .pfx ou .p12 de até 2 MB e informe a senha."); return;
    }
    busy.current = true; setOperation("posting"); setMessage("");
    const id = complete ? intent! : crypto.randomUUID(); remember(id); setUncertain(true);
    let bytes: Uint8Array | null = null;
    try {
      let payload: { requestId: string; pfxBase64?: string; password?: string } = { requestId: id };
      if (!complete) {
        bytes = new Uint8Array(await file!.arrayBuffer());
        let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        payload = { requestId: id, pfxBase64: btoa(binary), password };
      }
      clearSecrets(); setConsent(false);
      const { response, value } = await request("POST", null, payload);
      payload = { requestId: id };
      if (!alive.current) return;
      if (response.ok && object(value) && value.ok === true && value.requestId === id && value.activated === true) {
        const cert = credential(value.credential);
        if (!cert || cert.credentialVersionId !== id) throw new Error("invalid_response");
        setStatus({ configured: true, credential: cert }); setUncertain(false); remember(null); setMessage("Certificado cadastrado e ativado. Você já pode solicitar a assinatura A1.");
      } else {
        const code = object(value) && typeof value.error === "string" ? value.error : "";
        setMessage(MESSAGES[code] ?? "Não foi possível confirmar o cadastro. Confira o resultado antes de tentar outra operação.");
      }
    } catch { if (alive.current) setMessage("A resposta do cadastro não foi confirmada. O arquivo não será reenviado automaticamente. Confira o resultado abaixo."); }
    finally { bytes?.fill(0); busy.current = false; if (alive.current) { clearSecrets(); setOperation(null); } }
  };

  const currentIsDifferent = !!(intent && status?.configured && status.credential && status.credential.credentialVersionId !== intent);
  const reset = () => {
    if (operation || !resetConsent || status?.intent?.state !== "not_found" && !currentIsDifferent) return;
    remember(null); setUncertain(false); setResetConsent(false); setConsent(false); setStatus(old => old ? { configured: old.configured, credential: old.credential } : old); setMessage("Você pode escolher o arquivo e iniciar um novo cadastro.");
  };
  const cert = status?.credential;
  return <section className="box" aria-labelledby="a1-credential-title">
    <h2 id="a1-credential-title">Certificado A1 da ADUNIR</h2>
    <p>Cadastre o arquivo do e-CNPJ e sua senha para assinar os documentos pelo painel. Cadastrar o certificado não assina nem envia um lote.</p>
    <p role="status" aria-live="polite">{operation === "reading" ? "Conferindo certificado…" : operation === "posting" ? "Conferindo e cadastrando certificado…" : message}</p>
    {cert && <dl style={{ overflowWrap: "anywhere" }}>
      <dt>Situação</dt><dd>{status?.configured ? "Ativo" : "Ativação pendente"}</dd>
      <dt>CNPJ</dt><dd>{cert.cnpj}</dd>
      <dt>Validade</dt><dd>{new Date(cert.notAfter).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</dd>
      <dt>Identificação do certificado</dt><dd><code>{cert.certificateFingerprintSha256}</code></dd>
    </dl>}
    <button type="button" className="v2-btn v2-btn-sec" disabled={!!operation} onClick={() => void read(intent)}>Conferir certificado</button>
    {uncertain && intent ? <div>
      <p>Há um pedido de cadastro para conferir. A consulta recupera somente o estado e a identificação do certificado.</p>
      <button type="button" className="v2-btn v2-btn-sec" disabled={!!operation} onClick={() => void read(null)}>Consultar certificado atual</button>
      {status?.intent?.state === "completed" && !status.intent.activated && <>
        <label className="adm-check"><input type="checkbox" checked={consent} disabled={!!operation} onChange={e => setConsent(e.target.checked)} />Confirmo a ativação deste certificado para assinatura.</label>
        <button type="button" disabled={!!operation || !consent} onClick={() => void submit(true)}>Concluir ativação</button>
      </>}
      {(status?.intent?.state === "not_found" || currentIsDifferent) && <>
        <label className="adm-check"><input type="checkbox" checked={resetConsent} disabled={!!operation} onChange={e => setResetConsent(e.target.checked)} />{currentIsDifferent ? "Conferi o certificado atual e quero encerrar o acompanhamento do pedido anterior." : "Conferi que o pedido não foi cadastrado e quero iniciar um novo cadastro."}</label>
        <button type="button" disabled={!!operation || !resetConsent} onClick={reset}>{currentIsDifferent ? "Encerrar acompanhamento anterior" : "Iniciar novo cadastro"}</button>
      </>}
    </div> : <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label>Arquivo do certificado A1<input ref={fileInput} type="file" accept=".pfx,.p12,application/x-pkcs12" disabled={!!operation || !status} onChange={e => { setFile(e.target.files?.[0] ?? null); setConsent(false); }} required /></label>
      <label>Senha do certificado<input type="password" autoComplete="new-password" maxLength={4096} value={password} disabled={!!operation || !status} onChange={e => setPassword(e.target.value)} required /></label>
      <label className="adm-check"><input type="checkbox" checked={consent} disabled={!!operation || !status} onChange={e => setConsent(e.target.checked)} />{status?.configured ? "Autorizo substituir o certificado ativo por este certificado." : "Autorizo cadastrar este certificado para assinatura pela ADUNIR."}</label>
      <button type="submit" className="v2-btn" disabled={!!operation || !status || !file || !consent}>{status?.configured ? "Substituir certificado A1" : "Cadastrar certificado A1"}</button>
      <p className="small">Arquivo de até 2 MB. A senha não aparece no histórico e não fica salva neste navegador.</p>
    </form>}
  </section>;
}
