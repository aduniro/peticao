export const isProd = process.env.NODE_ENV === "production";
/**
 * Pré-visualização para revisão (ex.: pessoal da ADUNIR). Roda com NODE_ENV=production, mas mantém todas as
 * travas de ambiente de teste: e-mail só na caixa de saída, sem envio a autoridades, sem exigir ICP-Brasil.
 */
export const isPreview = process.env.PREVIEW_MODE === "1";

function required(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (isProd) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return devDefault;
}

export const config = {
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  databaseUrl: () => required("DATABASE_URL", "postgres://peticao:peticao@localhost:54329/peticao"),
  pepper: () => {
    const v = required("HASH_PEPPER", "dev-pepper-nao-usar-em-producao-0123456789");
    if (isProd && v.length < 32) throw new Error("HASH_PEPPER precisa ter pelo menos 32 caracteres");
    return v;
  },
  adminPassword: () => required("ADMIN_PASSWORD", "admin-dev"),
  mailProvider: () => (process.env.MAIL_PROVIDER ?? "dev") as "dev" | "smtp" | "brevo",
  /** Cadeia de provedores, em ordem de tentativa: MAIL_PROVIDERS="ses,brevo". Sem ela, vale MAIL_PROVIDER (um só). */
  mailProviders: (): string[] => {
    const raw = process.env.MAIL_PROVIDERS?.trim();
    const list = (raw ? raw.split(",") : [process.env.MAIL_PROVIDER ?? "dev"]).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return list.length ? list : ["dev"];
  },
  /** Rodízio entre os serviços transacionais: MAIL_ROTATION="ses:6,sendpulse:3,mailersend:1" (pesos). Vazio = sem rodízio (ordem da cadeia). */
  mailRotation: (): string | undefined => process.env.MAIL_ROTATION,
  /** Rodízio do canal de marketing: MAIL_ROTATION_MARKETING="mailrelaypresidente:1,sendpulse:1". */
  mailRotationMarketing: (): string | undefined => process.env.MAIL_ROTATION_MARKETING,
  /**
   * Cadeia do canal de MARKETING/campanhas (envios em massa: pedidos de correção de nome/CPF, divulgação…), separada da transacional para isolar a reputação.
   * MAIL_PROVIDERS_MARKETING="mailrelay,sendpulse". Sem ela, o marketing não envia (nunca cai na cadeia transacional).
   */
  marketingProviders: (): string[] => (process.env.MAIL_PROVIDERS_MARKETING ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  /** Remetente do canal de marketing de cada provedor (subdomínio próprio): MAIL_FROM_MAILRELAY_MARKETING, MAIL_FROM_SENDPULSE_MARKETING… Obrigatório. */
  mailFromMarketing: (provider: string): string => {
    const v = process.env[`MAIL_FROM_${provider.toUpperCase()}_MARKETING`];
    if (!v) throw new Error(`Remetente de marketing ausente para "${provider}" (MAIL_FROM_${provider.toUpperCase()}_MARKETING)`);
    return v;
  },
  /** Remetente visível por provedor (cada um no seu subdomínio): MAIL_FROM_SES, MAIL_FROM_BREVO…; senão MAIL_FROM. */
  /**
   * Remetente por provedor e por TIPO de mensagem (cada tipo no seu subdomínio, para isolar a reputação):
   * MAIL_FROM_SES_CONFIRMACAO, MAIL_FROM_SES_CONFIRMADA… têm prioridade; depois MAIL_FROM_<PROVEDOR>; depois MAIL_FROM.
   */
  mailFromFor: (provider: string, kind0?: string) => {
    const kind = kind0 === "reenvio" ? "confirmacao" : kind0; // o reenvio da confirmação sai com o MESMO remetente da confirmação original
    return (kind ? process.env[`MAIL_FROM_${provider.toUpperCase()}_${kind.toUpperCase()}`] : undefined) ?? process.env[`MAIL_FROM_${provider.toUpperCase()}`] ?? process.env.MAIL_FROM ?? "Sanção Integral do PLV 12/2026 <peticao@localhost>";
  },
  /** Endereço de resposta padrão dos e-mails (as respostas chegam a quem lê esta caixa). Vazio = sem Reply-To. */
  mailReplyTo: () => (process.env.MAIL_REPLY_TO ?? "").trim(),
  mailFrom: () => process.env.MAIL_FROM ?? "Sanção Integral do PLV 12/2026 <peticao@localhost>",
  tokenTtlHours: 48,
  /** Mensagens da página de contato: destino principal e cópia oculta. */
  contactTo: () => process.env.CONTACT_TO ?? "contato@sancionaintegral.org",
  contactBcc: () => (process.env.CONTACT_BCC ?? "operator-1608598f41@example.invalid").split(",").map((s) => s.trim()).filter(Boolean),
  batchSize: () => Number(process.env.BATCH_SIZE ?? 500),
  /** Nº da capa escolhida pela ADUNIR (COVER_CHOICE). Sem valor, a página mostra o carrossel com todas as opções. */
  coverChoice: () => { const n = Number(process.env.COVER_CHOICE); return Number.isInteger(n) && n > 0 ? n : null; },
  goal: () => Number(process.env.PETITION_GOAL ?? 20000),
  /** Fechamento do dossiê final: 12/11/2026, 18h em Porto Velho (UTC-4). */
  finalAt: () => new Date(process.env.FINAL_AT ?? "2026-11-12T18:00:00-04:00"),
  approverEmail: () => process.env.APPROVER_EMAIL ?? "",
  recipients: () => (process.env.RECIPIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  cronSecret: () => process.env.CRON_SECRET ?? "",
};
