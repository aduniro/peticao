import { diagnosticMark } from "./signup-diagnostics";
import { validate, submit, EmailUndeliverableError, type Meta } from "./signatures";
import { needsIdentity, identityMode, verifyCpfName, makeTicket, checkTicket, verifyIdentity, type IdentityMethod, MAX_FAILED } from "./identity";
import { checkMx } from "./email-check";
import { verificarEmail } from "./verificacao";
import { emailDomain, institutionalKind, notePendingDomain, type DomainKind } from "./institutional";
import { defaultProvider, type CpfProvider } from "./cpf-check";
import { MailBlockedError } from "./mail/guard";
import { verifyTurnstile, turnstileEnabled } from "./turnstile";
import { rateLimit } from "./ratelimit";
import { makeSignupSecurityProof, checkSignupSecurityProof, signupSecurityProofFromTicket } from "./signup-security-proof";
import { validateUniversityEmail, type Probe } from "./university-check";
import { whatsappAtivo } from "./whatsapp/provider";
import { normalizarTelefone } from "./whatsapp/telefone";
import { isEmailBlacklisted, recordInvalidEmail, logRequest } from "./abuse";

export type SignCtx = Meta & { ip: string };
export type FlowResult = { status: number; json: Record<string, unknown> };

import { suggestEmail } from "./email-typos";
import { dominiosConhecidos } from "./email-sugestao";
import { detalheDeSugestao, diagnosticar } from "./email-diagnostico";
import { validateEmailField } from "./email-validate";
import { acceptsServerDomain } from "./server-email-policy";
const ASK = (json: Record<string, unknown>, status = 422): FlowResult => ({ status, json });
const ROBOT = { error: "Não foi possível confirmar que você não é um robô. Recarregue a página e tente de novo.", errorCode: "robot" };

/**
 * Fluxo de assinatura.
 *  - Brasil (servidor/apoiador): em até duas etapas. 1) formulário → se o e-mail NÃO for institucional, responde `identityRequired` + ticket
 *    (nada é gravado, nenhum e-mail sai); 2) mesmo formulário + ticket + { method, value } → se os dados conferirem, grava e envia o e-mail.
 *  - Estrangeiro: sem CPF e sem janela de identidade; o e-mail precisa ser de universidade real (lista aberta ou checagem pela internet).
 *    Se falhar, nada é gravado e nenhum e-mail é enviado.
 */
/**
 * O e-mail existe e a caixa não está cheia? (Reacher local.) Só roda DEPOIS do antirrobô, para um robô não usar a sua VPS como sonda de SMTP
 * nem tirar proveito do "existe/não existe" como oráculo. Só recusa com prova do SMTP; sem cota por IP/global ou com o serviço fora, deixa passar.
 * Domínios institucionais já conferidos não são consultados.
 */
const slowDomains = new Map<string, number>();
export const _clearSlowDomains = () => slowDomains.clear();
async function emailExistsGate(input: { email: string }, ctx: SignCtx, estrangeiro = false): Promise<FlowResult | null> {
  // Vale também para e-mail institucional: é onde mais se erra a digitação (caixa inexistente). Só recusa com prova do SMTP (falha aberta).
  if (!rateLimit(`reacher:${ctx.ip}`, 15, 60 * 60_000) || !rateLimit("reacher:global", 600, 60 * 60_000)) return null;
  // Domínio que não responde à sonda (porta 25 fechada, lista cinza…): não seguramos cada pessoa por segundos; pula esse domínio por 30 min.
  const dom = emailDomain(input.email) ?? "";
  if ((slowDomains.get(dom) ?? 0) > Date.now()) return null;
  const rv = await verificarEmail(input.email, { timeoutMs: Number(process.env.REACHER_TIMEOUT_MS ?? 4000) });
  if (rv.ok && rv.skipped === "indisponivel") { if (slowDomains.size > 500) slowDomains.clear(); slowDomains.set(dom, Date.now() + 30 * 60_000); }
  if (rv.ok) return null;
  if (rv.code === "email_not_found" || rv.code === "email_undeliverable" || rv.code === "email_invalid") return invalidEmail(input.email, ctx, rv.code, estrangeiro); // caixa cheia e descartável não contam como inexistente
  return ASK({ errors: { email: rv.code } });
}

/**
 * E-mail que não existe: conta a tentativa (3 do mesmo e-mail → lista negra) e devolve o erro para a janela de aviso, com a sugestão
 * ("você quis dizer…?", a partir dos domínios do banco) e o detalhe do que está errado e de como digitar. O IP nunca é bloqueado por erro.
 */
async function invalidEmail(email: string, ctx: SignCtx, code: string, estrangeiro = false): Promise<FlowResult> {
  await recordInvalidEmail(email, ctx.ip);
  const kn = await dominiosConhecidos(estrangeiro).catch(() => undefined);
  const diag = diagnosticar(email, kn ?? []);
  const suggest = suggestEmail(email, { known: kn, semServidor: code === "email_undeliverable" }) ?? diag?.sugestao ?? null;
  const detail = diag ?? (suggest ? detalheDeSugestao(email, suggest) : null);
  return ASK({ errors: { email: code }, ...(suggest ? { suggest } : {}), ...(detail ? { fix: detail } : {}) });
}


export async function handleSign(body: any, ctx: SignCtx, provider: CpfProvider | null = defaultProvider(), probe?: Probe): Promise<FlowResult> {
  const suspected = typeof body?.website === "string" && body.website.length > 0;
  if (suspected) diagnosticMark("submission", "honeypot_detected");
  const v = validate(body);
  if (!v.ok) return ASK({ errors: v.errors });
  const input = v.value;
  // A challenge is consumed at most once per HTTP request. Identity continuation
  // uses a separate proof bound to its ticket/input, never a reused Turnstile token.
  let challengeChecked = false, challengePassed = false;
  const checkChallenge = async () => {
    if (!challengeChecked) {
      challengeChecked = true;
      challengePassed = turnstileEnabled() && (
        !!body?.identity && checkTicket(body?.ticket, input.cpf ?? "", input.email) &&
          checkSignupSecurityProof(body?.securityProof ?? signupSecurityProofFromTicket(body?.ticket), input, body?.ticket) ||
        await verifyTurnstile(body?.turnstileToken, ctx.ip)
      );
    }
    return challengePassed;
  };
  // WhatsApp opcional: só existe quando o recurso está ligado e configurado; senão o campo é ignorado (o site age como se não existisse).
  let wa: string | null = null;
  if (whatsappAtivo() && String(body?.whatsapp?.numero ?? "").trim()) {
    const tel = normalizarTelefone(body.whatsapp.ddi, body.whatsapp.numero);
    if (!tel.ok) return ASK({ errors: { whatsapp: tel.code } });
    if (body?.whatsappConsent !== true) return ASK({ errors: { whatsappConsent: "wa_consent_required" } });
    wa = tel.e164;
  }
  // E-mail já na lista negra (inexistente, bounce ou reclamação): recusa sem gastar consulta e conta como tentativa inválida do IP.
  if (await isEmailBlacklisted(input.email)) { await logRequest("email_blocked", ctx.ip, { email: input.email, detail: "tentativa com e-mail da lista negra" }); return invalidEmail(input.email, ctx, "email_not_found", input.category === "estrangeiro"); }


  // Approved IFES and exact EBSERH domains redirect to the servidor form.
  if (input.category === "apoiador") {
    const k = await institutionalKind(input.email);
    if (acceptsServerDomain(k, emailDomain(input.email))) return ASK({ errors: { email: "apoiador_institutional_email" } });
  }

  // New servidor requests require approved IFES or the explicit EBSERH exception.
  // Public-sector suffixes, other curated kinds and generic .edu.br do not qualify.
  if (input.category === "servidor") {
    const kind = await institutionalKind(input.email);
    if (!acceptsServerDomain(kind, emailDomain(input.email))) {
      const d = emailDomain(input.email);
      const v = await validateEmailField(input.email, "servidor"); // mesmo veredito do formulário: "e-mail institucional inválido" (com sugestão) ou "use e-mail de órgão público"
      const provavelErro = !v.ok && !!v.suggest; // domínio com cara de erro de digitação não vai para a fila de curadoria (evita lixo como "ufpa.edu.bt")
      if (d && !provavelErro && (kind === null || kind === "ensino-edu-br") && rateLimit(`pend:${ctx.ip}`, 10, 60 * 60_000)) await notePendingDomain(d).catch(() => {}); // limite por IP: ninguém lota a fila de revisão
      return ASK({ errors: { email: v.ok ? "server_email_not_institutional" : v.code }, ...(!v.ok && v.suggest ? { suggest: v.suggest } : {}), ...(!v.ok && v.detail ? { fix: v.detail } : {}) });
    }
  }
  // Apoiador: domínio de provedor público digitado errado (gmial.com) ou sem servidor de e-mail → "e-mail inválido" com a sugestão
  if (input.category === "apoiador") {
    const v = await validateEmailField(input.email, "apoiador");
    if (!v.ok && (v.code === "email_provider_invalid" || v.code === "email_typo")) {
      await recordInvalidEmail(input.email, ctx.ip); // conta como tentativa com e-mail inexistente (3 do mesmo e-mail → lista negra); o IP nunca é bloqueado
      return ASK({ errors: { email: v.code }, ...(v.suggest ? { suggest: v.suggest } : {}), ...(v.detail ? { fix: v.detail } : {}) });
    }
  }

  if ((await checkMx(input.email)) === "none") return invalidEmail(input.email, ctx, "email_undeliverable", input.category === "estrangeiro");

  if (suspected) {
    if (!(await checkChallenge())) {
      diagnosticMark("submission", "security_failed");
      return ASK({ securityRetry: true, errorCode: "security_retry", error: "Não foi possível concluir a verificação de segurança. Seus dados foram mantidos. Tente novamente." });
    }
    diagnosticMark("submission", "honeypot_recovered");
  }

  if (input.category === "estrangeiro") {
    if (turnstileEnabled() && !(await checkChallenge())) return ASK(ROBOT);
    if (!rateLimit(`uni:${ctx.ip}`, 20, 60 * 60_000)) return ASK({ error: "Muitas tentativas. Tente novamente mais tarde.", errorCode: "rate_limited" }, 429);
    const fdom = emailDomain(input.email) ?? "";
    const reject = async (code: string, detail?: string) => { await logRequest("foreign_rejected", ctx.ip, { email: input.email, detail: `${fdom} | país ${input.country ?? "?"} | ${code}${detail ? ` (${detail})` : ""}`.slice(0, 200) }); };
    // Domínio brasileiro (.br, órgão público, IFES ou discente) não é de universidade estrangeira: a pessoa deve usar o formulário de Servidor ou de Apoiador.
    const fkind = await institutionalKind(input.email);
    if (fdom.endsWith(".br") || (fkind !== null && fkind !== "universidade-estrangeira")) { await reject("foreign_brazilian_email"); return ASK({ errors: { email: "foreign_brazilian_email" } }); }
    const gF = await emailExistsGate(input, ctx, true); if (gF) return gF;
    const u = await validateUniversityEmail(input.email, input.country!, probe);
    if (!u.ok) {
      await reject(u.code, u.detail);
      if (u.code === "domain_unavailable") return ASK({ error: "Não foi possível verificar o domínio agora. Tente novamente em alguns minutos.", errorCode: "domain_unavailable" }, 503);
      return ASK({ errors: { email: u.code }, detail: u.detail });
    }
    try {
      await submit(input, ctx, { identityMethod: "universidade_estrangeira", universityDomain: u.domain, domainCheck: u.check, whatsapp: wa });
    } catch (e) {
      if (e instanceof EmailUndeliverableError) return invalidEmail(input.email, ctx, "email_undeliverable", input.category === "estrangeiro");
      if (e instanceof MailBlockedError) return ASK({ error: "Este endereço de e-mail não pode ser usado em ambiente de teste.", errorCode: "mail_blocked" });
      console.error("assinar falhou", e);
      return ASK({ error: "Não foi possível enviar o e-mail de confirmação. Tente novamente.", errorCode: "send_failed" }, 500);
    }
    return { status: 200, json: { ok: true } };
  }

  const identity = body?.identity as { method?: IdentityMethod; value?: string } | undefined;
  let needs = await needsIdentity(input.email, provider);
  // Apoiadores sempre passam pela consulta completa antes de ver o desafio de
  // nascimento/mãe. O modo geral "off" não desliga esta validação obrigatória.
  if (input.category === "apoiador") needs = true;
  let extra: { identityMethod?: string | null; nameCheck?: any } = {};

  if (identity && !checkTicket(body?.ticket, input.cpf!, input.email)) {
    return ASK({ restart: true, error: "Sua sessão de confirmação expirou. Preencha e envie o formulário novamente.", errorCode: "ticket_expired" }, 400);
  }

  let preflightDone = false;
  const checkCpfBeforeIdentity = input.category === "apoiador" || !!provider && identityMode(provider) === "required";
  if (!identity && checkCpfBeforeIdentity) {
    if (turnstileEnabled() && !(await checkChallenge())) return ASK(ROBOT);
    const gS = await emailExistsGate(input, ctx); if (gS) return gS;
    if (!provider) return ASK({ error: "Não conseguimos conferir o CPF agora. Tente de novo em alguns minutos.", errorCode: "cpf_check_unavailable" }, 503);
    {
      if (!rateLimit(`cpfname:${ctx.ip}`, 30, 60 * 60_000)) return ASK({ error: "Muitas tentativas. Tente novamente mais tarde.", errorCode: "rate_limited" }, 429);
      const g = await verifyCpfName({ cpf: input.cpf!, declaredName: input.name, provider });
      if (!g.ok && g.reason === "identity_required") {
        needs = true;
      } else if (!g.ok) {
        switch (g.reason) {
          case "mismatch": return ASK({ errors: { name: "name_cpf_mismatch" } });
          case "not_found": return ASK({ errors: { cpf: "cpf_not_found" } });
          case "mock_unknown": return ASK({ error: "Este CPF não está disponível nos dados desta pré-visualização.", errorCode: "cpf_mock_unknown" }, 503);
          case "locked": return ASK({ errors: { cpf: "cpf_locked" } }, 429);
          default: return ASK({ error: "Não conseguimos conferir o CPF agora. Tente de novo em alguns minutos.", errorCode: "cpf_check_unavailable" }, 503);
        }
      }
      if (g.ok) extra = { nameCheck: g.nameCheck };
    }
    preflightDone = true;
  }
  // O ticket só é emitido depois do preflight correspondente; revalidar o nome
  // junto com o dado de identidade evita aceitar uma troca entre as etapas.
  if (identity && checkCpfBeforeIdentity) needs = true;

  if (needs) {
    if (!identity) {
      if (!preflightDone && turnstileEnabled() && !(await checkChallenge())) return ASK(ROBOT);
      if (!preflightDone) { const gN = await emailExistsGate(input, ctx); if (gN) return gN; } // antes de a pessoa gastar a janela de identidade (e a CPF Brasil)
      const ticket = makeTicket(input.cpf!, input.email);
      const securityProof = challengePassed ? makeSignupSecurityProof(input, ticket) : null;
      return { status: 200, json: { identityRequired: true, ticket: securityProof ? `${ticket}.${securityProof}` : ticket, ...(securityProof ? { securityProof } : {}), methods: ["mae", "nascimento"] } };
    }
    if (!rateLimit(`ident:${ctx.ip}`, 15, 60 * 60_000)) return ASK({ error: "Muitas tentativas. Tente novamente mais tarde.", errorCode: "rate_limited" }, 429);

    const r = await verifyIdentity({ cpf: input.cpf!, method: identity.method as IdentityMethod, value: String(identity.value ?? ""), declaredName: input.name, provider });
    if (!r.ok) {
      switch (r.reason) {
        case "name_mismatch": return ASK({ errors: { name: "name_cpf_mismatch" } });
        case "bad_input": return ASK({ identityError: "Confira o dado informado: digite o nome completo da mãe ou uma data de nascimento válida (dd/mm/aaaa).", identityCode: "bad_input" });
        case "method_unavailable": return ASK({ identityError: "Não conseguimos conferir por este método para este CPF. Tente pelo outro método.", identityCode: "method_unavailable", methodUnavailable: identity.method });
        case "mock_unknown": return ASK({ identityError: "Pré-visualização com dados de TESTE: este CPF não existe no ambiente de teste. Para experimentar a janela, use o CPF 529.982.247-25 (nascimento 15/08/1985; mãe: Ana Maria da Conceição). Para consultar CPFs reais, grave a chave com: npm run chave:cpf -- --preview e reinicie.", identityCode: "mock_unknown" });
        case "locked": return ASK({ identityError: "Muitas tentativas incorretas para este CPF. Tente novamente em 24 horas.", identityCode: "locked", locked: true }, 429);
        case "unavailable": return ASK({ error: "O serviço de verificação de identidade está indisponível no momento. Tente novamente em alguns minutos.", errorCode: "identity_unavailable" }, 503);
        default: return ASK({ identityError: "Os dados não conferem.", identityCode: "mismatch", attemptsLeft: r.attemptsLeft ?? MAX_FAILED - 1 });
      }
    }
    extra = { identityMethod: identity.method, nameCheck: r.nameCheck };
  }

  try {
    await submit(input, ctx, { ...extra, whatsapp: wa });
  } catch (e) {
    if (e instanceof EmailUndeliverableError) return invalidEmail(input.email, ctx, "email_undeliverable", false);
    if (e instanceof MailBlockedError) return ASK({ error: "Este endereço de e-mail não pode ser usado em ambiente de teste.", errorCode: "mail_blocked" });
    console.error("assinar falhou", e);
    return ASK({ error: "Não foi possível enviar o e-mail de confirmação. Tente novamente.", errorCode: "send_failed" }, 500);
  }
  return { status: 200, json: { ok: true } };
}
