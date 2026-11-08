import { diagnosticTrace, emitSignDiagnostic, finishSignDiagnostic } from "./sign-diagnostic-client";
/** Network failures must not escape into React or trigger an automatic resubmission. */
export async function signRequest(body: Record<string, unknown>, transport: typeof fetch = fetch) {
  try {
    const trace = diagnosticTrace();
    const response = await transport("/api/assinar", {
      method: "POST",
      headers: { "content-type": "application/json", ...(trace ? { "x-sign-attempt": trace } : {}) },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid response");
    emitSignDiagnostic("client_result", { outcome: data.identityRequired ? "identity_required" : data.ok === true ? "accepted" : "rejected" });
    if (data.ok === true) finishSignDiagnostic();
    return { status: response.status, data: data as Record<string, any> };
  } catch {
    emitSignDiagnostic("client_result", { outcome: "network_error" });
    return { status: 503, data: { transportError: true, errorCode: "generic" } as Record<string, any> };
  }
}
