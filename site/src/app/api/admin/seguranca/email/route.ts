import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { query, audit } from "@/lib/db";
import { hmac } from "@/lib/security";
import { dedupEmail } from "@/lib/email-check";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Tira da lista negra um e-mail marcado como inexistente (bounces e reclamações ficam: protegem a reputação do domínio) e zera as tentativas dele. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const email = String((await req.formData()).get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const url = new URL("/admin/emails", requestOrigin(req.headers));
  if (!email.includes("@")) url.searchParams.set("msg", "Informe um e-mail.");
  else {
    const r = await query("DELETE FROM email_suppressions WHERE email=$1 AND reason='invalid'", [email]);
    await query("DELETE FROM invalid_attempts WHERE email_hash=$1", [hmac(dedupEmail(email))]);
    await audit("email_unblocked", null, { emailHash: hmac(dedupEmail(email)).slice(0, 12), removed: r.rowCount });
    url.searchParams.set("msg", r.rowCount ? "E-mail liberado e tentativas zeradas." : "Esse e-mail não estava na lista negra por inexistência (bounces e reclamações não são removidos).");
  }
  return NextResponse.redirect(url, 303);
}
