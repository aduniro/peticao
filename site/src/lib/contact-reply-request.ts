/** One explicit POST only. A browser timeout says nothing about server delivery. */
export async function requestContactReply(fetcher: typeof fetch, body: unknown, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/admin/contato/responder", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(body), signal: controller.signal,
    });
    const value = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (controller.signal.aborted) throw new Error("contact_request_timeout");
    return { response, value };
  } finally { clearTimeout(timer); }
}
