import { createHash } from "node:crypto";
import { PETICAO } from "../../content/peticao";
import { GOV_POINTS } from "../../content/governo";
import namePolicy from "../../content/name-validation-policy.json";

export const PURPOSES = ["painel", "divulgacao", "atendimento"] as const;
export type Purpose = typeof PURPOSES[number];
export type KnowledgeDocument = {
  id: string; title: string; text: string; purposes: readonly Purpose[];
  source: { ref: string; version: string; kind: "repository_content" | "human_reviewed_reference"; reviewedAt: string | null };
};
export const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string,unknown>)[k])])) : v;
export function document(id: string, title: string, text: string, purposes: readonly Purpose[], ref: string, kind: KnowledgeDocument["source"]["kind"] = "repository_content", reviewedAt: string | null = null): KnowledgeDocument {
  const version = createHash("sha256").update(JSON.stringify(canonical({ id, title, text, purposes, ref, kind, reviewedAt }))).digest("hex");
  return { id, title, text, purposes, source: { ref, version, kind, reviewedAt } };
}
/** Explicit imports only. Never indexes arbitrary repository files, private folders or live participant records. */
export function repositoryKnowledge(): KnowledgeDocument[] {
  const all = PURPOSES;
  return [
    document("repo:petition:title", PETICAO.title, PETICAO.title, all, "site/src/content/peticao.ts#BR.pt.title"),
    ...PETICAO.intro.map((text, i) => document(`repo:petition:intro:${i}`, PETICAO.title, text, all, `site/src/content/peticao.ts#BR.pt.intro[${i}]`)),
    ...PETICAO.reasons.map((text, i) => document(`repo:petition:reason:${i}`, PETICAO.reasonsTitle, text, all, `site/src/content/peticao.ts#BR.pt.reasons[${i}]`)),
    document("repo:petition:request", PETICAO.requestTitle, PETICAO.request, all, "site/src/content/peticao.ts#BR.pt.request"),
    document("repo:petition:organizer", "Organização da petição", PETICAO.organizer, all, "site/src/content/peticao.ts#ORGANIZER"),
    ...GOV_POINTS.map((text, i) => document(`repo:campaign:point:${i}`, "Pontos da campanha", text, ["painel", "divulgacao"], `site/src/content/governo.ts#GOV_POINTS[${i}]`)),
    // Internal configuration is not context for participant-facing drafts or publicity.
    document("repo:validation:counts", "Configuração de conferência do nome", JSON.stringify({ version: namePolicy.version, minimum_exact_words_by_api_word_count: namePolicy.minimum_exact_words_by_api_word_count, require_order: namePolicy.require_order, allow_typo_tolerance: namePolicy.allow_typo_tolerance, allow_initials: namePolicy.allow_initials, identity_challenge_overrides_name_mismatch: namePolicy.identity_challenge_overrides_name_mismatch }), ["painel"], "site/src/content/name-validation-policy.json"),
  ];
}
