import { findIfes } from "../ifes-data";
import { findByName, municipalityById, regionCriteria, regionOf } from "../geo-data";
import { outboundReasons, type OutboundEvidence } from "./outbound";

export const ENGINE = "contact-triage-v1";
export type Category = "remover" | "cpf" | "campus" | "expirou" | "corrigir" | "email_recusado" | "nao_recebeu" | "erro" | "duvida";
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Priority and keyword patterns extracted from tools/ponte/triagem-lib.mjs; campus is an additional case. */
export function categoryOf(text: string, kind = ""): Category {
  const t = sem(text);
  if (/(remov|exclu|apag|cancel|retir)\w*.{0,40}(assinatura|dados|cadastro|nome|e-?mail)|lgpd|nao quero mais (assin|constar|participar)/.test(t)) return "remover";
  if (/\bcpf\b|nome nao confere|nao confere com|receita federal/.test(t)) return "cpf";
  if (/campus|campi/.test(t) && /nao|ausen|falt|cadast|inclu|encontr|list/.test(t)) return "campus";
  if (/expir|link (invalido|vencido)|token/.test(t)) return "expirou";
  if (/corrig|errei|digitei errad|troc\w* (o |meu )?(nome|e-?mail)|alter\w* (o |meu )?(nome|e-?mail|dados)|(nome|e-?mail) errad/.test(t)) return "corrigir";
  if (/(nao|n)\w* (esta |estao )?(aceit|permit|reconhec)\w*.{0,40}e-?mail|e-?mail.{0,50}(invalido|nao (e )?aceit|recusad|rejeitad|nao passa)|dominio.{0,30}(nao|invalid)/.test(t)) return "email_recusado";
  if (/(nao|n) (recebi|chegou|chega|chegaram|encontr|veio|vieram)|nenhum e-?mail|sem e-?mail|spam|lixo eletronico|caixa de entrada|e-?mail de confirmacao|link de confirmacao|confirmar (a |minha )?assinatura|demora/.test(t)) return "nao_recebeu";
  return kind === "bug" || /erro|bug|travou|nao (consigo|funciona|abre|carrega|aparece)|tela|pagina|botao|formulario|navegador|celular/.test(t) ? "erro" : "duvida";
}
/** Same redaction patterns as the original pure triage helper. No raw errors or CPF are archived. */
export const redact = (text: string) => text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
  .replace(/\b[0-9a-f:]{16,}\b/gi, "[code]").replace(/[A-Za-z0-9_-]{32,}/g, "[code]");

export type CampusProposal = { status: "unknown_institution" | "unknown_city" | "ambiguous_city" | "invalid_location" | "listed" | "needs_evidence"; institution: string | null; candidates: { id: number; name: string; uf: string }[]; criteria: string | null; sources: string[] };
export function proposeCampus(input: { institution: string; city: string; uf?: string; ibge?: number | null }): CampusProposal {
  const institution = findIfes(input.institution);
  const city = input.city.replace(/^campus(?: de| do| da)?\s+/i, "").replace(/\s*\([A-Z]{2}\)\s*$/, "").trim();
  let candidates = findByName(city).filter(m => !input.uf || m.uf === input.uf.toUpperCase());
  if (input.ibge) {
    const picked = municipalityById(input.ibge);
    if (!picked || city && !candidates.some(m => m.id === picked.id) || input.uf && picked.uf !== input.uf.toUpperCase()) return { status: "invalid_location", institution: institution?.s ?? null, candidates: [], criteria: null, sources: [] };
    candidates = [picked];
  }
  const base = { institution: institution?.s ?? null, candidates, criteria: null, sources: ["public/data/ifes.json", "public/data/municipios.json"] };
  if (!institution) return { ...base, status: "unknown_institution" };
  if (!candidates.length) return { ...base, status: "unknown_city" };
  if (candidates.length > 1) return { ...base, status: "ambiguous_city" };
  const id = candidates[0].id;
  return { ...base, criteria: regionCriteria(regionOf(id)), status: institution.c.includes(id) || institution.m === id ? "listed" : "needs_evidence" };
}

export type SignatureEvidence = { id: number; status: string; category: string; created_at: string; confirmed_at: string | null; token_expires_at: string | null; cpf_name_check: string | null; email_domain_kind: string | null; institution: string | null; campus: string | null; campus_ibge: number | null; uf: string | null };
export type Evidence = {
  contact: { id: number; kind: string; created_at: string; message: string };
  snapshotAt: string; signatures: SignatureEvidence[];
  mail: { ts: string; provider: string; status: string; kind: string }[];
  events: { ts: string; provider: string; type: string }[];
  outbound?: OutboundEvidence;
  suppression: { reason: string; created_at: string } | null;
  queue: { pending: number; failed: number } | null;
  unavailable: string[]; truncated: string[];
};
export type Analysis = { engine: string; category: Category; state: "inconclusive" | "review" | "resolved"; priority: "normal" | "high"; reasons: string[]; suggestedActions: string[]; campus: CampusProposal | null };
/** Produces codes for review, never an approval, a claimed delivery or a promise that an action was performed. */
export function analyze(e: Evidence): Analysis {
  const category = categoryOf(e.contact.message, e.contact.kind);
  const out: Analysis = { engine: ENGINE, category, state: "inconclusive", priority: category === "remover" ? "high" : "normal", reasons: [], suggestedActions: ["human_review"], campus: null };
  if (e.unavailable.length || e.truncated.length) { out.reasons.push("incomplete_evidence"); return out; }
  if (e.signatures.length > 1) { out.reasons.push("multiple_registrations"); return out; }
  const signature = e.signatures[0];
  if (category === "remover" || category === "corrigir") { out.state = "review"; out.reasons.push("identity_required_before_change"); out.suggestedActions.push("verify_requester_control"); return out; }
  if (category === "campus") {
    out.state = "review"; out.reasons.push("campus_evidence_required"); out.suggestedActions.push("collect_official_campus_source");
    if (signature) out.campus = proposeCampus({ institution: signature.institution ?? "", city: signature.campus ?? "", ibge: signature.campus_ibge });
    return out;
  }
  if (category === "cpf") { out.reasons.push(signature?.cpf_name_check === "mismatch" ? "name_mismatch_recorded" : signature?.cpf_name_check === "match" ? "name_match_not_identity_proof" : "no_cpf_check_evidence"); return out; }
  if (!["nao_recebeu", "expirou", "email_recusado"].includes(category)) { out.state = "review"; out.reasons.push("manual_context_required"); return out; }
  if (!signature) { out.reasons.push("no_registration_for_email"); return out; }
  if (signature.status === "confirmed") {
    if (signature.confirmed_at && Date.parse(signature.confirmed_at) >= Date.parse(e.contact.created_at)) { out.state = "resolved"; out.reasons.push("confirmed_after_report"); }
    else out.reasons.push("confirmed_before_report");
    return out;
  }
  if (signature.status !== "pending") { out.reasons.push("registration_not_pending"); return out; }
  out.state = "review";
  out.reasons.push(...outboundReasons(e.outbound, e.snapshotAt));
  if (e.suppression) { out.reasons.push("address_suppressed"); out.suggestedActions.push("review_suppression_reason"); }
  if (e.events.some(event => ["hard_bounce", "blocked", "complaint"].includes(event.type))) out.reasons.push("address_event_not_message_linked");
  if (signature.token_expires_at && Date.parse(signature.token_expires_at) < Date.parse(e.snapshotAt)) out.reasons.push("confirmation_link_expired");
  if (e.mail.some(mail => mail.status === "sent") && !out.reasons.includes("provider_accepted_not_delivery_proof")) out.reasons.push("provider_accepted_not_delivery_proof");
  if (out.reasons.includes("provider_accepted_not_delivery_proof")) out.suggestedActions.push("check_delivery_evidence");
  if (e.queue?.pending) out.reasons.push("confirmation_queued");
  if ((e.mail.some(mail => mail.status === "failed") || e.queue?.failed) && !out.reasons.includes("send_failure_recorded")) out.reasons.push("send_failure_recorded");
  if (!out.reasons.length) { out.state = "inconclusive"; out.reasons.push("no_delivery_evidence"); }
  return out;
}
