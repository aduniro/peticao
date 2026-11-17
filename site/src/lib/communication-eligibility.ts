/** Pure facts only. No identifiers, PII, persistence, clocks, network or permission grants. */
export type CommunicationFacts = {
  record: "active" | "archived" | "unknown";
  address: "valid" | "invalid" | "unknown";
  origin: "signature" | "contact" | "manual" | "csv" | "abandoned" | "unknown";
  review: "approved" | "rejected" | "unknown";
  basis: "recorded" | "missing" | "unknown";
  evidence: "recorded" | "missing" | "unknown";
  purpose: "campaign" | "other" | "unknown";
  retention: "in_policy" | "expired" | "unknown";
  marketingOptOut: "yes" | "no" | "unknown";
  globalSuppression: "yes" | "no" | "unknown";
};
export type EligibilityReason = "invalid_facts" | "archived" | "invalid_address" | "review_rejected" | "basis_missing" | "evidence_missing" | "purpose_mismatch" | "content_expired" | "marketing_optout" | "global_suppression" | "record_unknown" | "address_unknown" | "origin_unknown" | "review_unknown" | "basis_unknown" | "evidence_unknown" | "purpose_unknown" | "retention_unknown" | "marketing_preference_unknown" | "suppression_unknown";
export type EligibilityResult = {
  state: "eligible_for_preparation" | "ineligible" | "unknown";
  reasons: EligibilityReason[];
  authorizedToSend: false;
  consentInferred: false;
};
export type SuppressionResult = { state: "clear" | "suppressed" | "unknown"; reasons: ("global_suppression" | "marketing_optout" | "suppression_unknown" | "marketing_preference_unknown" | "channel_unknown" | "invalid_facts")[] };
const definitions = {
  record: ["active", "archived", "unknown"], address: ["valid", "invalid", "unknown"],
  origin: ["signature", "contact", "manual", "csv", "abandoned", "unknown"],
  review: ["approved", "rejected", "unknown"], basis: ["recorded", "missing", "unknown"],
  evidence: ["recorded", "missing", "unknown"], purpose: ["campaign", "other", "unknown"],
  retention: ["in_policy", "expired", "unknown"], marketingOptOut: ["yes", "no", "unknown"],
  globalSuppression: ["yes", "no", "unknown"],
} as const;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const membership = <T extends readonly string[]>(x: unknown, list: T): x is T[number] => typeof x === "string" && (list as readonly string[]).includes(x);

/** Marketing opt-out is never converted into a transactional bounce/complaint. */
export function assessCommunicationSuppression(raw: unknown): SuppressionResult {
  const x = object(raw) ? raw : {}, reasons: SuppressionResult["reasons"] = [];
  const invalid = !object(raw) || Object.keys(x).some(k => !["channel", "marketingOptOut", "globalSuppression"].includes(k)) || Object.entries(x).some(([k, v]) => k === "channel" ? !membership(v, ["marketing", "transactional", "unknown"]) : !membership(v, ["yes", "no", "unknown"]));
  if (x.globalSuppression === "yes") reasons.push("global_suppression");
  if (x.channel === "marketing" && x.marketingOptOut === "yes") reasons.push("marketing_optout");
  if (reasons.length) return { state: "suppressed", reasons };
  if (invalid) reasons.push("invalid_facts");
  if (!membership(x.channel, ["marketing", "transactional"])) reasons.push("channel_unknown");
  if (x.globalSuppression !== "no") reasons.push("suppression_unknown");
  if (x.channel === "marketing" && x.marketingOptOut !== "no") reasons.push("marketing_preference_unknown");
  return { state: reasons.length ? "unknown" : "clear", reasons };
}

/**
 * Conditional readiness for a future reviewed campaign only. The caller must
 * obtain these facts from authorized records; browser assertions are not grants.
 * Which basis qualifies and how retention is computed remain policy decisions.
 */
export function assessCommunicationEligibility(raw: unknown): EligibilityResult {
  const x = object(raw) ? raw : {}, facts = {} as CommunicationFacts;
  let invalid = !object(raw) || Object.keys(x).some(k => !Object.hasOwn(definitions, k));
  for (const key of Object.keys(definitions) as (keyof CommunicationFacts)[]) {
    if (x[key] !== undefined && !membership(x[key], definitions[key])) invalid = true;
    (facts as Record<string, string>)[key] = membership(x[key], definitions[key]) ? x[key] as string : "unknown";
  }
  const deny: EligibilityReason[] = [];
  if (facts.record === "archived") deny.push("archived");
  if (facts.address === "invalid") deny.push("invalid_address");
  if (facts.review === "rejected") deny.push("review_rejected");
  if (facts.basis === "missing") deny.push("basis_missing");
  if (facts.evidence === "missing") deny.push("evidence_missing");
  if (facts.purpose === "other") deny.push("purpose_mismatch");
  if (facts.retention === "expired") deny.push("content_expired");
  if (facts.marketingOptOut === "yes") deny.push("marketing_optout");
  if (facts.globalSuppression === "yes") deny.push("global_suppression");
  if (deny.length) return { state: "ineligible", reasons: deny, authorizedToSend: false, consentInferred: false };
  const unknown: EligibilityReason[] = [];
  if (invalid) unknown.push("invalid_facts");
  const unresolved: [keyof CommunicationFacts, EligibilityReason][] = [["record", "record_unknown"], ["address", "address_unknown"], ["origin", "origin_unknown"], ["review", "review_unknown"], ["basis", "basis_unknown"], ["evidence", "evidence_unknown"], ["purpose", "purpose_unknown"], ["retention", "retention_unknown"], ["marketingOptOut", "marketing_preference_unknown"], ["globalSuppression", "suppression_unknown"]];
  for (const [key, reason] of unresolved) if (facts[key] === "unknown") unknown.push(reason);
  return { state: unknown.length ? "unknown" : "eligible_for_preparation", reasons: unknown, authorizedToSend: false, consentInferred: false };
}
