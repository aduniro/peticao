const uuid = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const validDocumentReference = uuid;

/** Origin comes only from trusted server configuration, never request Host or input. */
export function documentReferenceUrl(origin: string, referenceId: string) {
  if (!uuid(referenceId) || typeof origin !== "string" || origin.length > 500 || /[\\\s\u0000-\u001f]/.test(origin)) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash || u.port && u.port !== "443" || !u.hostname.includes(".") || u.hostname.endsWith(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith("[") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)) return null;
    u.pathname = `/api/documentos/referencia/${referenceId}`;
    return u.href;
  } catch { return null; }
}
