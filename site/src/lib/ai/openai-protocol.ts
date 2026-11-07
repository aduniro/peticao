import type { prepareAiContext } from "./context";
import { exactKeys } from "./configuration";
type Prepared = Extract<Awaited<ReturnType<typeof prepareAiContext>>, { ok: true }>;
/** Offline protocol builder only. Not permission to send: execution still needs a durable budget reservation. */
export function openAiRequest(context: Prepared) {
  if (!context.requestedEnabled || !context.profile.model) return { ok: false as const, error: "not_configured" };
  return { ok: true as const, url: "https://api.openai.com/v1/responses", body: {
    model: context.profile.model, store: false, stream: false,
    instructions: context.instructions, input: context.input,
    tools: [], tool_choice: "none", max_output_tokens: context.limits.maxOutputTokens,
    ...(context.profile.effort === "default" ? {} : { reasoning: { effort: context.profile.effort } }),
    text: { format: { type: "json_schema", name: "admin_review_draft", strict: true, schema: {
      type: "object", properties: {
        text: { type: "string" }, needsReview: { type: "boolean", enum: [true] },
        citations: { type: "array", items: { type: "object", properties: { id: { type: "string" }, version: { type: "string" } }, required: ["id", "version"], additionalProperties: false } },
      }, required: ["text", "needsReview", "citations"], additionalProperties: false,
    } } },
  } };
}
/** Accept only completed assistant text with known citations. Hidden reasoning/tool output never becomes a draft. */
export function openAiDraft(raw: unknown, context: Prepared) {
  if (!raw || typeof raw !== "object") return { ok: false as const, error: "provider_response_invalid" };
  const r = raw as any;
  if (r.status !== "completed" || r.error || !Array.isArray(r.output) || r.output.length > 20) return { ok: false as const, error: "provider_incomplete" };
  const chunks: string[] = [];
  for (const item of r.output) {
    if (item?.type === "reasoning") continue;
    if (item?.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) return { ok: false as const, error: "provider_output_unsupported" };
    for (const part of item.content) {
      if (part?.type !== "output_text" || typeof part.text !== "string" || part.text.length > 20000) return { ok: false as const, error: "provider_output_unsupported" };
      chunks.push(part.text);
    }
  }
  const combined = chunks.join(""); if (combined.length > 20000) return { ok: false as const, error: "provider_response_invalid" };
  let body: any; try { body = JSON.parse(combined); } catch { return { ok: false as const, error: "provider_response_invalid" }; }
  if (!exactKeys(body, ["text", "needsReview", "citations"]) || typeof body.text !== "string" || !body.text.trim() || body.text.length > 12000 || body.needsReview !== true || !Array.isArray(body.citations) || body.citations.length > 10) return { ok: false as const, error: "provider_response_invalid" };
  const seen = new Set<string>();
  for (const citation of body.citations) {
    if (!exactKeys(citation, ["id", "version"]) || !context.sources.some(s => s.id === citation.id && s.version === citation.version) || seen.has(citation.id)) return { ok: false as const, error: "citation_invalid" };
    seen.add(citation.id);
  }
  if (context.sources.length && !body.citations.length) return { ok: false as const, error: "citation_missing" };
  const usage = r.usage;
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0 || usage.output_tokens > context.limits.maxOutputTokens || !Number.isSafeInteger(usage.total_tokens) || usage.total_tokens !== usage.input_tokens + usage.output_tokens) return { ok: false as const, error: "usage_invalid" };
  return { ok: true as const, draft: { text: body.text, format: "plain_text" as const, citations: body.citations as { id: string; version: string }[], requiresHumanReview: true }, usage: { inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number, totalTokens: usage.total_tokens as number } };
}
