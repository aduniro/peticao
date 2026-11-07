import { hmac } from "../security";
import type { Evidence, Analysis } from "./analyze";
type Snapshot = Omit<Evidence,"contact"> & {contact:Omit<Evidence["contact"],"message">};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
/** Ignore collection clock/free text, but include the effective link-expiry transition. Never persists another body copy. */
export function evidenceFingerprint(e:Snapshot) {
  const at=Date.parse(e.snapshotAt);
  if(!Number.isFinite(at)||!e.contact||!Array.isArray(e.signatures)||!Array.isArray(e.mail)||!Array.isArray(e.events)||!Array.isArray(e.unavailable)||!Array.isArray(e.truncated))throw new Error("triage_evidence_invalid");
  const {snapshotAt:_at,contact,...rest}=e;
  const safeContact={id:contact.id,kind:contact.kind,created_at:contact.created_at};
  const expiry=e.signatures.map(s=>s.status==="pending"&&s.token_expires_at&&Number.isFinite(Date.parse(s.token_expires_at))?Date.parse(s.token_expires_at)<at:null);
  return hmac("contact-triage-evidence-v1:"+JSON.stringify(canonical({...rest,contact:safeContact,expired:expiry})));
}


/** Machine analysis only, including the campus context derived from current public datasets. */
export function analysisFingerprint(a:Analysis) {
  if(!a||typeof a.engine!=="string"||!Array.isArray(a.reasons)||!Array.isArray(a.suggestedActions))throw new Error("triage_analysis_invalid");
  return hmac("contact-triage-analysis-v1:"+JSON.stringify(canonical(a)));
}
