import { query, tx, audit } from "./db";
import { config } from "./config";
import { isValidCpf, onlyDigits } from "./cpf";
import { UFS, findByName, findMunicipality, regionCriteria, regionOf } from "./geo-data";
import { findIfes, ifesEligible, allCampiInAmazonia, regionCampusIds, resolveCampus } from "./ifes-data";
import { isCountryCode } from "@/i18n/countries";
import { hmac, newToken, normalizeEmail, sha256 } from "./security";
import { titleCaseName, lowerEmail } from "./name-case";
import { sendMail } from "./mail";
import { newVerifyCode } from "./verify-code";
import { confirmationHtml, reenvioHtml } from "./mail/templates";
import { logRequest } from "./abuse";
import { isSuppressed } from "./mail/suppression";
import type { CpfNameCheck } from "./cpf-check";
import { checkMx, dedupEmail, isDisposable } from "./email-check";
import { emailDomain, institutionInfo, institutionalKind, notePendingDomain } from "./institutional";
import { brasilia } from "./time";
import { createReferrerForSignature } from "./referrals";
import { TEXT_VERSION } from "@/content/peticao";
import { SAFE_EMAIL_RE as EMAIL_RE } from "./email-syntax";
import { pedirWhatsapp } from "./whatsapp/store";

export type Category = "servidor" | "apoiador" | "estrangeiro";

export type SignInput = {
  name: string;
  email: string;
  cpf?: string; // não existe para estrangeiros
  category: Category;
  // servidor
  institution?: string; // sigla da IFES (ou o texto digitado, se não constar na lista)
  ifesListed?: boolean;
  role?: "docente" | "tae";
  campus?: string;
  campusIbge?: number | null;
  campusListed?: boolean;
  regionDeclared?: boolean;
  regionValidated?: boolean;
  regionCriteria?: string | null;
  // apoiador
  city?: string;
  uf?: string;
  cityIbge?: number;
  // estrangeiro
  country?: string;
  university?: string;
  locale?: string;
  consent: boolean;
};

export type Meta = { ip?: string; userAgent?: string; visitorId?: string; refCode?: string };
export type SubmitExtra = { whatsapp?: string | null; identityMethod?: string | null; nameCheck?: CpfNameCheck; universityDomain?: string | null; domainCheck?: string | null };

/** O domínio do e-mail não recebe mensagens (sem MX/A): a confirmação nunca chegaria. */
export class EmailUndeliverableError extends Error {}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Códigos de erro de validação (o navegador traduz); o texto em português é a reserva. */
export const ERROR_PT: Record<string, string> = {
  name_required: "Informe seu nome completo.", email_invalid: "Informe um e-mail válido.", email_disposable: "Use seu e-mail pessoal ou institucional (não aceitamos e-mails temporários).",
  cpf_invalid: "CPF inválido.", category_invalid: "Escolha uma categoria.", consent_required: "É necessário concordar com o texto.",
  ifes_required: "Informe a instituição.", role_required: "Informe o cargo.", campus_invalid: "Campus inválido.", campus_required: "Informe onde você está lotado.", region_ifes_not_eligible: "Esta instituição não tem sede nem campus na Amazônia Legal ou na faixa de fronteira.", campus_not_in_ifes: "Este campus não consta entre os campi da instituição na região.", region_not_eligible: "O município do campus não está na Amazônia Legal nem na faixa de fronteira.",
  uf_invalid: "Informe uma UF válida.", city_required: "Informe a cidade.", city_invalid: "Essa cidade não existe nessa UF.", city_ambiguous: "Há mais de uma cidade com esse nome: escolha a UF.",
  country_invalid: "Escolha o país da sua instituição.", university_required: "Informe sua universidade.",
  email_undeliverable: "Este e-mail parece não existir (o domínio não recebe mensagens). Confira a digitação.",
  server_email_not_institutional: "Servidor(a): use o e-mail institucional de um órgão público (ou assine como Apoiador(a)).",
  email_not_found: "Esse e-mail parece não existir. Confira a digitação.", email_full: "A caixa de entrada desse e-mail está cheia. Use outro e-mail.",
  not_university_email: "Use o e-mail institucional da sua universidade.", university_country_mismatch: "Este e-mail pertence a uma universidade de outro país.",
};

export type ValidationResult = { ok: true; value: SignInput } | { ok: false; errors: Record<string, string> };

export function validate(raw: any): ValidationResult {
  const errors: Record<string, string> = {};
  const name = titleCaseName(clean(raw?.name, 120), { final: true }); // "mAria DA sILVA" → "Maria da Silva"
  const email = lowerEmail(clean(raw?.email, 200)); // sempre minúsculas antes de qualquer checagem ou gravação
  const category = raw?.category as Category;
  if (name.split(" ").length < 2 || name.length < 5) errors.name = "name_required";
  if (!EMAIL_RE.test(email)) errors.email = "email_invalid";
  else if (isDisposable(email)) errors.email = "email_disposable";
  if (category !== "servidor" && category !== "apoiador" && category !== "estrangeiro") errors.category = "category_invalid";
  if (raw?.consent !== true) errors.consent = "consent_required";
  const cpf = clean(raw?.cpf, 20);
  if ((category === "servidor" || category === "apoiador") && !isValidCpf(cpf)) errors.cpf = "cpf_invalid";

  const v: SignInput = { name, email, category, consent: true };
  if (category === "servidor") {
    const text = clean(raw?.institution, 160);
    const ifes = findIfes(text);
    if (text.length < 2) errors.institution = "ifes_required";
    v.institution = ifes ? ifes.s : text;
    v.ifesListed = !!ifes;
    // Cargo e "Lotado em" só existem para quem declara ser servidor da educação federal na Amazônia Legal/Faixa de Fronteira.
    const declared = raw?.regionDeclared === true;
    // O cargo (docente ou técnico-administrativo) é obrigatório para todo servidor, esteja ou não lotado na região.
    if (raw?.role !== "docente" && raw?.role !== "tae") errors.role = "role_required";
    else v.role = raw.role;
    // O campus de quem não se declara lotado na região (ex.: IFRS Ibirubá, fora da faixa de fronteira) também é gravado, desde que conste na lista da instituição: aí é só informação, nunca vira "lotação na região".
    const campusText = clean(raw?.campus, 120);
    const picked = Number(raw?.campusIbge) || null;
    if (declared && !campusText && !picked) errors.campus = "campus_required";
    let placeIbge: number | null = ifes?.m ?? null; // sem campus informado, vale a sede da IFES
    if (campusText || picked) {
      const rc = resolveCampus(ifes, campusText, picked);
      if (!rc) { if (declared) errors.campus = "campus_invalid"; } // sem declaração de região o campus é opcional: valor ilegível é ignorado, não barra a assinatura
      else if (!declared && !rc.listed) { /* sem declarar a região, só se grava campus que conste na lista da instituição; texto livre/outro município é ignorado */ }
      else { v.campus = rc.name; v.campusIbge = rc.ibge; v.campusListed = rc.listed; placeIbge = rc.ibge; }
    }
    // Checkbox "lotado na Amazônia Legal / faixa de fronteira": só vale para instituição federal da lista com sede ou campus na região (listas do IBGE)
    // e para um campus dessa instituição que esteja na região.
    const reg = regionOf(placeIbge);
    v.regionDeclared = declared;
    const campusInRegion = !!v.campusIbge && regionCampusIds(ifes).includes(v.campusIbge);
    v.regionValidated = declared && !!ifes && ifesEligible(ifes) && !!v.campusListed && campusInRegion && (reg.amazoniaLegal || reg.faixaFronteira);
    v.regionCriteria = v.regionValidated ? regionCriteria(reg) : null;
    if (!declared && ifes && allCampiInAmazonia(ifes)) errors.region = "region_required"; // todos os campi na Amazônia Legal: a caixa é obrigatória
    if (declared) {
      if (!ifes || !ifesEligible(ifes)) errors.region = "region_ifes_not_eligible";
      else {
        if (!errors.campus && v.campusIbge && !v.campusListed) errors.campus = "campus_not_in_ifes"; // o campus escolhido não é da instituição
        if (!v.regionValidated) errors.region = "region_not_eligible"; // ou não está na Amazônia Legal/faixa de fronteira
      }
    }
  } else if (category === "apoiador") {
    let uf = clean(raw?.uf, 2).toUpperCase();
    const city = clean(raw?.city, 100);
    if (!(UFS as readonly string[]).includes(uf)) {
      const guess = city ? findByName(city) : [];
      if (guess.length === 1) uf = guess[0].uf; // cidade única no país: a UF é deduzida
      else { errors.uf = guess.length > 1 ? "city_ambiguous" : "uf_invalid"; }
    }
    if (!city) errors.city = "city_required";
    else if ((UFS as readonly string[]).includes(uf)) {
      const m = findMunicipality(uf, city);
      if (!m) errors.city = "city_invalid";
      else { v.city = m.name; v.uf = m.uf; v.cityIbge = m.id; }
    }
  } else if (category === "estrangeiro") {
    const country = clean(raw?.country, 2).toUpperCase();
    if (!isCountryCode(country) || country === "BR") errors.country = "country_invalid";
    v.country = country;
    const uni = clean(raw?.university, 160);
    if (uni.length < 2) errors.university = "university_required";
    v.university = uni;
  }
  const loc = clean(raw?.locale, 5);
  if (loc) v.locale = loc;
  if (Object.keys(errors).length) return { ok: false, errors };
  if (category !== "estrangeiro") v.cpf = onlyDigits(cpf);
  return { ok: true, value: v };
}

const addHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

export function confirmationMail(name: string, token: string, startedIso?: string) {
  const link = `${config.appUrl()}/confirmar?token=${encodeURIComponent(token)}`;
  const first = name.split(" ")[0];
  const started = brasilia(startedIso ?? new Date(), true); // no reenvio vale a data/hora ORIGINAL do cadastro
  return {
    subject: "Confirme sua assinatura: sanção integral do PLV 12/2026",
    text:
      `Olá, ${first}.\n\nVocê iniciou sua assinatura em ${started}.\nPara confirmar sua assinatura na petição pela sanção integral do PLV nº 12/2026, abra o link abaixo e clique em "Confirmar":\n\n${link}\n\n` +
      `O link vale por ${config.tokenTtlHours} horas e só pode ser usado uma vez. Se não foi você, ignore esta mensagem: nada será registrado.\n\n` +
      `ADUNIR – Seção Sindical do ANDES-SN`,
    html: confirmationHtml({ origin: config.appUrl(), firstName: first, link, hours: config.tokenTtlHours, startedAt: started }),
  };
}

/** Reenvio por falha do serviço de disparo: aviso de desculpas + pedido de ajuda + nova solicitação de confirmação (a data/hora ORIGINAL do cadastro é mantida). */
export function reenvioMail(name: string, token: string, startedIso?: string) {
  const link = `${config.appUrl()}/confirmar?token=${encodeURIComponent(token)}`;
  const first = name.split(" ")[0];
  const started = brasilia(startedIso ?? new Date(), true);
  return {
    subject: "Confirme sua assinatura: pedimos desculpas pela falha no envio dos e-mails (PLV 12/2026)",
    text:
      `Olá, ${first}.\n\nPedimos desculpas. Tivemos um problema no nosso serviço de disparo de e-mails na quarta-feira (04/11). Ele já foi corrigido, mas alguns e-mails de confirmação não chegaram ou podem ter caído na caixa de spam.\n\n` +
      `Um pedido: avise os colegas que assinaram para olharem a pasta de spam, lixo eletrônico e promoções. Se encontrarem o e-mail da petição, marquem como "não é spam" e confirmem a assinatura.\n\n` +
      `Você iniciou a sua assinatura em ${started}. Se já confirmou, ignore esta mensagem. Para que ela conte, abra o novo link e clique em "Confirmar":\n\n${link}\n\n` +
      `O novo link vale por ${config.tokenTtlHours} horas e só pode ser usado uma vez. Se não foi você, ignore: nada será registrado.\n\nADUNIR – Seção Sindical do ANDES-SN`,
    html: reenvioHtml({ origin: config.appUrl(), firstName: first, link, hours: config.tokenTtlHours, startedAt: started }),
  };
}

/**
 * Registra (ou reenvia confirmação para) uma assinatura.
 * A resposta é sempre a mesma para quem já assinou, para não revelar quem consta na lista.
 */
export async function submit(input: SignInput, meta: Meta, extra: SubmitExtra = {}): Promise<void> {
  const foreign = input.category === "estrangeiro";
  const emailHash = hmac(dedupEmail(input.email)); // Gmail: pontos e +etiqueta contam como o mesmo e-mail
  const cpfHash = input.cpf ? hmac(input.cpf) : null; // estrangeiros não têm CPF
  if ((await checkMx(input.email)) === "none") throw new EmailUndeliverableError("domínio sem servidor de e-mail");
  if (await isSuppressed(input.email)) throw new EmailUndeliverableError("endereço na lista de supressão (bounce/reclamação)");
  const found = (
    await query<{ id: number; status: string }>("SELECT id,status FROM signatures WHERE email_hash = $1 OR ($2::text IS NOT NULL AND cpf_hash = $2)", [emailHash, cpfHash])
  ).rows;
  const confirmed = found.find((r) => r.status === "confirmed");
  if (confirmed) {
    await audit("duplicate_attempt", confirmed.id);
    return;
  }
  const token = newToken();
  const tokenHash = sha256(token);
  // O selo "e-mail institucional" é dos órgãos brasileiros; estrangeiros têm a validação própria de universidade.
  const domainKind = foreign ? null : await institutionalKind(input.email);
  const inst = domainKind ? await institutionInfo(input.email) : { domain: null, institution: null };
  if (!foreign && !domainKind && input.category === "servidor") {
    const d = emailDomain(input.email);
    if (d) await notePendingDomain(d).catch(() => {}); // fila de curadoria da ADUNIR
  }
  const identityMethod = foreign ? extra.identityMethod ?? "universidade_estrangeira" : domainKind && domainKind !== "discente" ? "email_institucional" : extra.identityMethod ?? null;
  const refCode = meta.refCode && (await query("SELECT 1 FROM referrers WHERE code=$1", [meta.refCode])).rowCount ? meta.refCode : null;
  const cols: Record<string, unknown> = {
    name: input.name, email: normalizeEmail(input.email), email_hash: emailHash, cpf_hash: cpfHash, category: input.category,
    institution: input.institution ?? null, role: input.role ?? null, city: input.city ?? null, uf: input.uf ?? null,
    text_version: TEXT_VERSION, consent_at: new Date().toISOString(), ip: meta.ip ?? null, user_agent: (meta.userAgent ?? "").slice(0, 300) || null,
    token_hash: tokenHash, token_expires_at: addHours(config.tokenTtlHours), email_domain_kind: domainKind, identity_method: identityMethod,
    cpf_name_check: extra.nameCheck && extra.nameCheck !== "nao_verificado" ? extra.nameCheck : null, visitor_id: meta.visitorId ?? null, ref_code: refCode,
    email_domain: inst.domain, email_institution: inst.institution, city_ibge: input.cityIbge ?? null,
    ifes_acronym: input.category === "servidor" && input.ifesListed ? input.institution : null, institution_listed: input.category === "servidor" ? !!input.ifesListed : null,
    campus: input.campus ?? null, campus_ibge: input.campusIbge ?? null, campus_listed: input.category === "servidor" && input.campus ? !!input.campusListed : null,
    region_declared: input.category === "servidor" ? !!input.regionDeclared : null, region_validated: input.category === "servidor" ? !!input.regionValidated : null,
    region_criteria: input.regionCriteria ?? null,
    country: foreign ? input.country : input.category === "apoiador" || input.category === "servidor" ? "BR" : null,
    university: input.university ?? null, university_domain: extra.universityDomain ?? null, locale: input.locale ?? null, domain_check: extra.domainCheck ?? null,
  };
  const keys = Object.keys(cols);
  let id: number;
  try {
    id = await tx(async (c) => {
      // Cadastros pendentes com o mesmo e-mail/CPF são substituídos pelos dados mais recentes.
      for (const r of found) await c.query("DELETE FROM signatures WHERE id = $1 AND status = 'pending'", [r.id]);
      const ins = await c.query<{ id: number }>(
        `INSERT INTO signatures (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
        keys.map((k) => cols[k])
      );
      await audit(found.length ? "signature_recreated" : "signature_created", ins.rows[0].id, { category: input.category, textVersion: TEXT_VERSION }, c);
      return ins.rows[0].id;
    });
  } catch (e: any) {
    if (e?.code === "23505") return; // corrida com outra requisição igual: já há cadastro
    throw e;
  }
  try {
    const outcome = await sendMail({ to: normalizeEmail(input.email), ...confirmationMail(input.name, token) }, "confirmacao");
    await logRequest("sign_pending", meta.ip ?? "local", { signatureId: id, email: input.email, detail: "aguardando confirmação do e-mail" });
    if (outcome === "queued") await logRequest("mail_queued", meta.ip ?? "local", { signatureId: id, email: input.email, detail: "e-mail na fila de reenvio" });
    // WhatsApp (opcional, só quando o recurso está ligado): nunca atrapalha a assinatura; falha aqui é só registrada.
    if (extra.whatsapp) await pedirWhatsapp(id, input.name, extra.whatsapp).catch((e) => console.error("whatsapp: pedido falhou", e instanceof Error ? e.message : e));
  } catch (e) {
    // Sem e-mail entregue não há como confirmar: desfaz o cadastro pendente.
    await query("DELETE FROM signatures WHERE id = $1 AND status = 'pending'", [id]);
    await audit("send_failed_rolled_back", id);
    throw e;
  }
}

export type ConfirmResult = "ok" | "invalid" | "expired";
export type ConfirmFull = { result: ConfirmResult; manageToken?: string; code?: string; email?: string; name?: string; visitorId?: string | null; signatureId?: number };

/** Confirma a assinatura e cria o código/painel de indicação da pessoa (o token do painel só é devolvido aqui, uma vez). */
export async function confirmFull(token: string, ctx: { visitorId?: string; ip?: string } = {}, canal: "email" | "whatsapp" = "email"): Promise<ConfirmFull> {
  if (!token || token.length > 200) return { result: "invalid" };
  return tx(async (c) => {
    const { rows } = await c.query<{ id: number; status: string; token_expires_at: string; name: string; email: string; visitor_id: string | null }>(
      canal === "whatsapp"
        ? "SELECT id,status,wa_token_expires_at AS token_expires_at,name,email,visitor_id FROM signatures WHERE wa_token_hash = $1 FOR UPDATE"
        : "SELECT id,status,token_expires_at,name,email,visitor_id FROM signatures WHERE token_hash = $1 FOR UPDATE",
      [sha256(token)]
    );
    const row = rows[0];
    if (!row || row.status !== "pending") return { result: "invalid" as const };
    if (new Date(row.token_expires_at).getTime() < Date.now()) return { result: "expired" as const };
    // "Mesmo aparelho": o navegador que confirmou é o mesmo que assinou? (null = não dá para saber). É só um indício de repasse do e-mail.
    const same = row.visitor_id && ctx.visitorId ? row.visitor_id === ctx.visitorId : null;
    await c.query("UPDATE signatures SET status='confirmed', confirmed_at=$1, token_hash=NULL, token_expires_at=NULL, wa_token_hash=NULL, wa_token_expires_at=NULL, wa_confirmed_at=CASE WHEN $7 THEN $8::timestamptz ELSE wa_confirmed_at END, confirm_visitor_id=$3, confirm_ip=$4, confirm_same_visitor=$5, seq=nextval('signature_seq'), verify_code=$6 WHERE id=$2",
      [new Date().toISOString(), row.id, ctx.visitorId ?? null, ctx.ip ?? null, same, newVerifyCode(), canal === "whatsapp", new Date().toISOString()]);
    await audit("signature_confirmed", row.id, {}, c);
    const ref = await createReferrerForSignature(row.id, row.name.split(" ")[0], c);
    return { result: "ok" as const, manageToken: ref?.manageToken, code: ref?.code, email: row.email, name: row.name, visitorId: row.visitor_id, signatureId: row.id };
  });
}

export async function confirm(token: string): Promise<ConfirmResult> {
  return (await confirmFull(token)).result;
}

export type Counts = { servidor: number; apoiador: number; estrangeiro: number; total: number };

export async function counts(): Promise<Counts> {
  const { rows } = await query<{ category: Category; n: number }>(
    "SELECT category, COUNT(*)::int n FROM signatures WHERE status='confirmed' GROUP BY category"
  );
  const c = { servidor: 0, apoiador: 0, estrangeiro: 0, total: 0 };
  for (const r of rows) c[r.category] = r.n;
  c.total = c.servidor + c.apoiador + c.estrangeiro;
  return c;
}
