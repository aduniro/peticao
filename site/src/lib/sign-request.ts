/** Network failures must not escape into React or trigger an automatic resubmission. */
export async function signRequest(body: Record<string, unknown>, transport: typeof fetch = fetch) {
  try {
    const response = await transport("/api/assinar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid response");
    return { status: response.status, data: data as Record<string, any> };
  } catch {
    return { status: 503, data: { transportError: true, errorCode: "generic" } as Record<string, any> };
  }
}
