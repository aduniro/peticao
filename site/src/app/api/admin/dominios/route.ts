import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { decideDomain, DomainDecisionDenied, KIND_LABELS, type DomainKind } from "@/lib/institutional";
import { pendingBySource } from "@/lib/domain-import";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const actor = await quemAge(req);
  if (!actor) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const f = await req.formData();
  const url = new URL("/admin/dominios", requestOrigin(req.headers));
  const by = actor.email;
  const str = (k: string) => String(f.get(k) ?? "").trim();
  const kindRaw = str("kind");
  const kind = (Object.prototype.hasOwnProperty.call(KIND_LABELS, kindRaw) ? kindRaw : "outro") as DomainKind;
  try {
    const action = str("action");
    if (action === "approve" || action === "reject") {
      const n = await decideDomain(str("domain"), action === "approve" ? "approved" : "rejected", {
        kind, institution: str("institution") || undefined, evidenceUrl: str("evidence") || undefined, by, actor: { userId: actor.userId, email: actor.email },
      });
      url.searchParams.set("msg", action === "approve" ? `Domínio aprovado. ${n} assinatura(s) já existente(s) receberam o selo.` : "Domínio rejeitado.");
    } else if (action === "approve_source") {
      const source = str("source");
      const domains = await pendingBySource(source);
      let total = 0;
      for (const d of domains) total += await decideDomain(d, "approved", { kind, by, actor: { userId: actor.userId, email: actor.email } });
      url.searchParams.set("msg", `${domains.length} domínio(s) da fonte "${source}" aprovados como "${KIND_LABELS[kind]}". ${total} assinatura(s) atualizada(s).`);
    } else url.searchParams.set("msg", "Ação desconhecida.");
  } catch (e) {
    if (e instanceof DomainDecisionDenied) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 403 });
    url.searchParams.set("msg", (e as Error).message);
  }
  return NextResponse.redirect(url, 303);
}
