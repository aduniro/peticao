import { ProviderUnavailable, type CpfProvider } from "./cpf-check";
import { classifyCpfName } from "./cpf-name";
import type { SignInput } from "./signatures";
import { findEvidence, makeIntent, enqueueCpf, ncpfEnabled, ncpfQueriesEnabled, readIntent, type Intent } from "./ncpf-store";

/** Request-scoped provider. Only replaces the nominal reference; never birth/mother. */
export function extraValidator(original: CpfProvider, a: { input: SignInput; visitor?: string; whatsapp?: string | null; token?: unknown; intent?: Intent | null; securityPassed: () => boolean }) {
  const state: { pendingToken?: string; unavailable?: boolean; token?: string; evidenceId?: string; source?: "trt3"; rejected?:boolean; apiName?:string } = {};
  const provider: CpfProvider = {
    name: original.name,
    async lookup(cpf) {
      const record = await original.lookup(cpf);
      if (record) state.apiName=record.nome;
      const intent = a.intent ?? (a.token ? await readIntent(a.token,a.input,a.visitor,a.whatsapp) : null);
      if (!record) {
        if(intent?.evidence_id){state.unavailable=true;throw new ProviderUnavailable('NCPF_SOURCE_UNAVAILABLE');}
        return record;
      }
      if (!ncpfEnabled() || !intent?.evidence_id && classifyCpfName(record.nome,a.input.name) !== "mismatch") return record;
      const evidence = await findEvidence(cpf,intent?.evidence_id ?? undefined);
      if (evidence) {
        if (classifyCpfName(evidence.name,a.input.name) === "mismatch") {state.rejected=true;return record;}
        state.source="trt3"; state.evidenceId=evidence.id;
        state.token = typeof a.token === "string" && intent ? a.token : await makeIntent({ input:a.input,visitor:a.visitor,whatsapp:a.whatsapp,securityPassed:a.securityPassed(),evidenceId:evidence.id,apiName:record.nome });
        return { ...record, nome:evidence.name };
      }
      if(intent?.evidence_id){state.unavailable=true;throw new ProviderUnavailable('NCPF_SOURCE_UNAVAILABLE');}
      if (!ncpfQueriesEnabled()) { state.unavailable=true; throw new ProviderUnavailable("NCPF_SOURCE_UNAVAILABLE"); }
      const jobId = await enqueueCpf(cpf);
      state.pendingToken = typeof a.token === "string" && intent ? a.token : await makeIntent({ input:a.input,visitor:a.visitor,whatsapp:a.whatsapp,securityPassed:a.securityPassed(),jobId,apiName:record.nome });
      throw new ProviderUnavailable("NCPF_PENDING");
    },
  };
  return { provider,state };
}
