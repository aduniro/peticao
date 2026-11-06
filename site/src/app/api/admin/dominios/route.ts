import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { config } from "@/lib/config";
import { decideDomain, KIND_LABELS, type DomainKind } from "@/lib/institutional";
import { pendingBySource } from "@/lib/domain-import";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "edicao");
  if (bloqueio) return bloqueio;
  const f = await req.formData();
  const url = new URL("/admin/dominios", requestOrigin(req.headers));
  const by = config.approverEmail() || "admin";
  const str = (k: string) => String(f.get(k) ?? "").trim();
  const kindRaw = str("kind");
  const kind = (kindRaw in KIND_LABELS ? kindRaw : "outro") as DomainKind;
  try {
    const action = str("action");
    if (action === "approve" || action === "reject") {
      const n = await decideDomain(str("domain"), action === "approve" ? "approved" : "rejected", {
        kind, institution: str("institution") || undefined, evidenceUrl: str("evidence") || undefined, by,
      });
      url.searchParams.set("msg", action === "approve" ? `Domínio aprovado. ${n} assinatura(s) já existente(s) receberam o selo.` : "Domínio rejeitado.");
    } else if (action === "approve_source") {
      const source = str("source");
      const domains = await pendingBySource(source);
      let total = 0;
      for (const d of domains) total += await decideDomain(d, "approved", { kind, by });
      url.searchParams.set("msg", `${domains.length} domínio(s) da fonte "${source}" aprovados como "${KIND_LABELS[kind]}". ${total} assinatura(s) atualizada(s).`);
    } else url.searchParams.set("msg", "Ação desconhecida.");
  } catch (e) {
    url.searchParams.set("msg", (e as Error).message);
  }
  return NextResponse.redirect(url, 303);
}
