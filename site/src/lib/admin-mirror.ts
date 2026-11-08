/** Exclusive to the isolated local mirror. This flag must never be set in production. */
export function adminMirrorEnabled(): boolean {
  return process.env.ADMIN_MIRROR_MODE === "1";
}

const READ_APIS = new Set([
  "alertas", "assinaturas/explorar", "assinaturas/visitas", "configuracoes",
  "dashboard", "diagnosticos/assinaturas", "dispersao", "dominios",
  "emails/engajamento", "emails/entregas", "emails/mensagens",
  "emails/mensagens/previa", "emails/recuperacao", "export", "indicacoes",
  "monitor", "painel", "rankings",
]);

/** Allowlist: new routes remain unavailable until reviewed for side effects. */
export function mirrorRequestAllowed(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname.startsWith("/_next/static/") || pathname === "/favicon.ico") return true;
  const prefix = "/api/admin/";
  if (!pathname.startsWith(prefix)) return false;
  const route = pathname.slice(prefix.length);
  return READ_APIS.has(route)
    || /^lotes\/[1-9]\d*\/pdf$/.test(route)
    || /^monitor\/visitante\/[a-zA-Z0-9_-]+$/.test(route);
}
