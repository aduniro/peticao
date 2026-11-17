/** Browser-safe transport: one attempt only; callers keep their existing error copy and draft state. */
export async function adminJsonRequest(url: string, method: string, body?: unknown, transport: typeof fetch = fetch): Promise<any> {
  try {
    const response = await transport(url, { method, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data: unknown = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, erro: `Erro ${response.status}` };
    const result = data as Record<string, unknown>;
    return { ...result, ok: response.ok && result.ok === true };
  } catch {
    // A lost response is uncertain. Never repeat a mutation automatically.
    return { ok: false };
  }
}
