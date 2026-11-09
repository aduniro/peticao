import ifesDomains from "./ifes-domains.json";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import { config } from "./config";
import { newVerifyCode } from "./verify-code";

/** Pool compartilhado (sobrevive ao hot reload do Next em desenvolvimento). */
const g = globalThis as unknown as { __pool?: Pool | null; __ready?: Promise<void> | null };

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS signatures (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_hash TEXT NOT NULL UNIQUE,
    cpf_hash TEXT UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('servidor','apoiador','estrangeiro')),
    institution TEXT,
    role TEXT,
    city TEXT,
    uf TEXT,
    text_version TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
    token_hash TEXT,
    token_expires_at TEXT,
    confirmed_at TEXT,
    batch_id INTEGER,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  CREATE INDEX IF NOT EXISTS idx_sig_status ON signatures(status, category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_token ON signatures(token_hash) WHERE token_hash IS NOT NULL;
  CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('partial','final')),
    status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','prepared','sent','failed','cancelled')),
    n_servidor INTEGER NOT NULL,
    n_apoiador INTEGER NOT NULL,
    list_hash TEXT NOT NULL,
    pdf BYTEA,
    pdf_sha256 TEXT,
    signature_kind TEXT,
    approval_code_hash TEXT,
    approval_code_expires_at TEXT,
    approval_attempts INTEGER NOT NULL DEFAULT 0,
    approved_by TEXT,
    approved_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  CREATE TABLE IF NOT EXISTS batch_sends (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    recipient TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    error TEXT,
    at TEXT NOT NULL,
    UNIQUE (batch_id, recipient)
  );
  CREATE TABLE IF NOT EXISTS batch_preparations (
    batch_id INTEGER PRIMARY KEY REFERENCES batches(id),
    snapshot TEXT NOT NULL,
    snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_token TEXT,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    CHECK ((lease_token IS NULL) = (lease_until IS NULL))
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS visitor_id TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS ref_code TEXT;
  CREATE INDEX IF NOT EXISTS idx_sig_visitor ON signatures(visitor_id);
  CREATE INDEX IF NOT EXISTS idx_sig_ref ON signatures(ref_code);
  ALTER TABLE batches ADD COLUMN IF NOT EXISTS signed_pdf BYTEA;
  ALTER TABLE batches ADD COLUMN IF NOT EXISTS signed_pdf_sha256 TEXT;
  ALTER TABLE batches ADD COLUMN IF NOT EXISTS signed_note TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS cpf_name_check TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS email_domain_kind TEXT;
  CREATE TABLE IF NOT EXISTS contact_messages (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
    locale TEXT, ip_hash TEXT, mailed BOOLEAN NOT NULL DEFAULT false, mail_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS contact_triage_jobs (
    id SERIAL PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contact_messages(id), revision INTEGER NOT NULL,
    engine TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
    requested_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), lease_token TEXT, lease_until TIMESTAMPTZ,
    input_hash TEXT, evidence JSONB, analysis JSONB, error_code TEXT, UNIQUE(contact_id,revision)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS contact_triage_active ON contact_triage_jobs(contact_id) WHERE status IN ('queued','running');
  CREATE INDEX IF NOT EXISTS contact_triage_due ON contact_triage_jobs(status,next_attempt_at);
  CREATE TABLE IF NOT EXISTS email_suppressions (
    email TEXT PRIMARY KEY, reason TEXT NOT NULL CHECK (reason IN ('bounce','complaint')), detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE email_suppressions DROP CONSTRAINT IF EXISTS email_suppressions_reason_check;
  ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('bounce','complaint','invalid'));
  CREATE TABLE IF NOT EXISTS invalid_attempts (id SERIAL PRIMARY KEY, email_hash TEXT NOT NULL, ip TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS invalid_attempts_email ON invalid_attempts(email_hash, ts);
  CREATE INDEX IF NOT EXISTS invalid_attempts_ip ON invalid_attempts(ip, ts);
  CREATE TABLE IF NOT EXISTS ip_blacklist (ip TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ);
  CREATE TABLE IF NOT EXISTS request_log (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, ip TEXT,
    lat DOUBLE PRECISION, lon DOUBLE PRECISION, city TEXT, region TEXT, country TEXT, signature_id INTEGER, email_hash TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS request_log_ts ON request_log(ts);
  -- Registro de CADA tentativa de envio (por provedor e por tipo de mensagem) e das devoluções/verificações, para o painel de e-mails.
  CREATE TABLE IF NOT EXISTS mail_log (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, provider TEXT NOT NULL, from_addr TEXT, to_addr TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent','failed','queued')), error TEXT, channel TEXT NOT NULL DEFAULT 'transactional');
  CREATE INDEX IF NOT EXISTS mail_log_ts ON mail_log(ts);
  CREATE INDEX IF NOT EXISTS mail_log_to ON mail_log(lower(to_addr), ts);
  CREATE TABLE IF NOT EXISTS mail_events (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, provider TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('hard_bounce','soft_bounce','blocked','complaint')),
    email TEXT NOT NULL, reason TEXT, source TEXT NOT NULL DEFAULT 'api', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (provider, type, email, ts));
  CREATE INDEX IF NOT EXISTS mail_events_ts ON mail_events(ts);
  CREATE INDEX IF NOT EXISTS mail_events_email ON mail_events(lower(email));
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS wa_cipher TEXT, ADD COLUMN IF NOT EXISTS wa_fp TEXT, ADD COLUMN IF NOT EXISTS wa_optin_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS wa_token_hash TEXT, ADD COLUMN IF NOT EXISTS wa_token_expires_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS wa_confirmed_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS signatures_wa_token ON signatures(wa_token_hash) WHERE wa_token_hash IS NOT NULL;
  CREATE TABLE IF NOT EXISTS whatsapp_senders (
    id SERIAL PRIMARY KEY, label TEXT NOT NULL, phone_cipher TEXT NOT NULL, phone_last4 TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE whatsapp_senders ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE whatsapp_senders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id SERIAL PRIMARY KEY, signature_id INTEGER, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', provider_id TEXT, error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS whatsapp_messages_provider ON whatsapp_messages(provider_id);
  CREATE TABLE IF NOT EXISTS reenvio_falha (
    signature_id INTEGER PRIMARY KEY, enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(), provider TEXT, evitou TEXT, status TEXT NOT NULL DEFAULT 'sent', erro TEXT);
  CREATE TABLE IF NOT EXISTS mail_engagement (
    provider TEXT NOT NULL, email TEXT NOT NULL, delivered_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, email));
  CREATE INDEX IF NOT EXISTS mail_engagement_email ON mail_engagement(email);
  CREATE TABLE IF NOT EXISTS email_checks (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), via TEXT NOT NULL, domain TEXT, verdict TEXT NOT NULL, ms INTEGER, detail TEXT);
  CREATE INDEX IF NOT EXISTS email_checks_ts ON email_checks(ts);
  CREATE TABLE IF NOT EXISTS provider_status (
    provider TEXT PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS mail_outbox (
    id SERIAL PRIMARY KEY, kind TEXT NOT NULL, to_addr TEXT NOT NULL, payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ);
  CREATE INDEX IF NOT EXISTS mail_outbox_due ON mail_outbox(status, next_attempt_at);
  CREATE TABLE IF NOT EXISTS mail_messages (
    id UUID PRIMARY KEY, request_key TEXT UNIQUE, kind TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('transactional','marketing')),
    to_addr TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL DEFAULT 'prepared'
      CHECK(status IN ('prepared','sending','accepted','rejected','indeterminate','queued')),
    content_fingerprint TEXT NOT NULL, content_state TEXT NOT NULL CHECK(content_state IN ('unavailable','stored','expired','oversize')),
    content_cipher TEXT, content_expires_at TIMESTAMPTZ, previous_id UUID REFERENCES mail_messages(id)
  );
  ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS reply_to TEXT;
  CREATE INDEX IF NOT EXISTS mail_messages_history ON mail_messages(created_at DESC,id);
  CREATE INDEX IF NOT EXISTS mail_messages_to ON mail_messages(lower(to_addr),created_at DESC);
  CREATE TABLE IF NOT EXISTS mail_message_attempts (
    id UUID PRIMARY KEY, message_id UUID NOT NULL REFERENCES mail_messages(id), provider TEXT NOT NULL, from_addr TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','accepted','rejected','indeterminate')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ, provider_id TEXT, error_code TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mail_message_attempt_active ON mail_message_attempts(message_id) WHERE state='prepared';
  CREATE INDEX IF NOT EXISTS mail_message_attempt_history ON mail_message_attempts(message_id,started_at);
  ALTER TABLE mail_message_attempts ADD COLUMN IF NOT EXISTS account_scope TEXT CHECK(account_scope IS NULL OR account_scope ~ '^[a-f0-9]{64}$');
  CREATE INDEX IF NOT EXISTS mail_message_receipt ON mail_message_attempts(provider,account_scope,provider_id) WHERE provider_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS mail_message_events (
    id BIGSERIAL PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL, account_scope TEXT NOT NULL, provider_id TEXT NOT NULL, recipient TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('delivered','opened','clicked','hard_bounce','soft_bounce','blocked','complaint')),
    occurred_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), source TEXT NOT NULL CHECK(source IN ('api','sns','webhook')),
    association_state TEXT NOT NULL DEFAULT 'unlinked' CHECK(association_state IN ('unlinked','linked','ambiguous')),
    message_id UUID REFERENCES mail_messages(id), attempt_id UUID REFERENCES mail_message_attempts(id)
  );
  CREATE INDEX IF NOT EXISTS mail_message_event_identity ON mail_message_events(provider,account_scope,provider_id,recipient);
  CREATE INDEX IF NOT EXISTS mail_message_event_history ON mail_message_events(message_id,occurred_at DESC,id DESC) WHERE association_state='linked';
  ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES mail_messages(id);
  ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES mail_messages(id);
  CREATE SEQUENCE IF NOT EXISTS signature_seq;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS seq INTEGER;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS verify_code TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS signatures_verify_code ON signatures(verify_code) WHERE verify_code IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS signatures_seq ON signatures(seq) WHERE seq IS NOT NULL;
  CREATE TABLE IF NOT EXISTS tour_seen (
    ip_hash TEXT NOT NULL, category TEXT NOT NULL, version TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ip_hash, category, version)
  );
  ALTER TABLE batches ADD COLUMN IF NOT EXISTS n_estrangeiro INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE signatures ALTER COLUMN cpf_hash DROP NOT NULL;
  ALTER TABLE signatures DROP CONSTRAINT IF EXISTS signatures_category_check;
  ALTER TABLE signatures ADD CONSTRAINT signatures_category_check CHECK (category IN ('servidor','apoiador','estrangeiro'));
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS city_ibge INTEGER;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS ifes_acronym TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS institution_listed BOOLEAN;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS campus TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS campus_ibge INTEGER;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS campus_listed BOOLEAN;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS region_declared BOOLEAN;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS region_validated BOOLEAN;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS region_criteria TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS country TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS university TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS university_domain TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS locale TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS domain_check TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS identity_method TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS email_domain TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS email_institution TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS confirm_visitor_id TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS confirm_ip TEXT;
  ALTER TABLE signatures ADD COLUMN IF NOT EXISTS confirm_same_visitor BOOLEAN;
  CREATE INDEX IF NOT EXISTS idx_sig_confirmed_at ON signatures(confirmed_at DESC) WHERE status='confirmed';
  CREATE TABLE IF NOT EXISTS identity_attempts (
    id SERIAL PRIMARY KEY,
    cpf_hash TEXT NOT NULL,
    method TEXT,
    ok BOOLEAN NOT NULL,
    ts TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_idatt ON identity_attempts(cpf_hash, ts);
  CREATE TABLE IF NOT EXISTS cpf_lookup_cache (
    cpf_hash TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > fetched_at AND expires_at <= fetched_at + interval '30 days')
  );
  CREATE INDEX IF NOT EXISTS cpf_lookup_cache_expiry ON cpf_lookup_cache(expires_at);
  CREATE TABLE IF NOT EXISTS institutional_domains (
    domain TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'outro',
    institution TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('approved','pending','rejected')),
    seen_count INTEGER NOT NULL DEFAULT 0,
    evidence_url TEXT,
    decided_by TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    updated_at TEXT
  );
  -- This overlay organizes only the admin catalog; effective policy columns stay separate.
  ALTER TABLE institutional_domains ADD COLUMN IF NOT EXISTS admin_catalog JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(admin_catalog)='object');
  ALTER TABLE institutional_domains ADD COLUMN IF NOT EXISTS admin_catalog_version BIGINT NOT NULL DEFAULT 1;
  ALTER TABLE institutional_domains ADD COLUMN IF NOT EXISTS admin_archived_at TIMESTAMPTZ;
  INSERT INTO institutional_domains(domain,kind,institution,source,status,decided_by)
    VALUES ('unir.br','ifes','Fundação Universidade Federal de Rondônia','manual','approved','semente')
    ON CONFLICT (domain) DO NOTHING;
  ALTER TABLE institutional_domains ADD COLUMN IF NOT EXISTS acronym TEXT;
  ALTER TABLE institutional_domains ADD COLUMN IF NOT EXISTS country TEXT;
  UPDATE institutional_domains SET acronym = 'UNIR' WHERE domain = 'unir.br' AND acronym IS NULL;
  CREATE TABLE IF NOT EXISTS world_universities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    domain TEXT NOT NULL,
    web TEXT,
    state TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_wu_domain ON world_universities(domain);
  CREATE INDEX IF NOT EXISTS idx_wu_country ON world_universities(country);
  CREATE TABLE IF NOT EXISTS referrers (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    manage_token_hash TEXT UNIQUE,
    label TEXT,
    display_name TEXT,
    signature_id INTEGER UNIQUE REFERENCES signatures(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  -- Administrative catalog state only: public referral links remain valid.
  ALTER TABLE referrers ADD COLUMN IF NOT EXISTS admin_version BIGINT NOT NULL DEFAULT 1;
  ALTER TABLE referrers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    nivel TEXT NOT NULL CHECK (nivel IN ('leitura','edicao','exclusao','total')),
    senha_hash TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    trocar_senha BOOLEAN NOT NULL DEFAULT false,
    falhas INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_acesso TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id SERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em TIMESTAMPTZ NOT NULL,
    stepup_ate TIMESTAMPTZ,
    ip_hash TEXT
  );
  CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions(user_id);
  CREATE TABLE IF NOT EXISTS batch_document_versions (
    id UUID PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    ordinal INTEGER NOT NULL CHECK(ordinal>0),
    variant TEXT NOT NULL CHECK(variant IN ('original','signed')),
    bytes BYTEA NOT NULL CHECK(octet_length(bytes)>0),
    sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
    list_hash TEXT NOT NULL,
    signature_kind TEXT,
    note TEXT,
    source TEXT NOT NULL CHECK(source IN ('prepared','upload','legacy-observed')),
    author_id INTEGER REFERENCES admin_users(id),
    recorded_by INTEGER REFERENCES admin_users(id),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(batch_id,ordinal),
    CHECK(source<>'legacy-observed' OR author_id IS NULL)
  );
  CREATE OR REPLACE FUNCTION reject_batch_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'batch_document_versions is immutable'; END;
  $$;
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='batch_document_versions'::regclass AND tgname='batch_document_versions_immutable') THEN
      CREATE TRIGGER batch_document_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON batch_document_versions FOR EACH STATEMENT EXECUTE FUNCTION reject_batch_document_mutation();
    END IF;
  END $$;
  CREATE TABLE IF NOT EXISTS president_challenges (
    id UUID PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    responsible_id INTEGER NOT NULL REFERENCES admin_users(id),
    issued_by INTEGER NOT NULL REFERENCES admin_users(id),
    profile_revision INTEGER NOT NULL,
    responsible_fingerprint TEXT NOT NULL,
    document_version TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
    password_hash TEXT NOT NULL CHECK(password_hash ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL DEFAULT 'issued' CHECK(state IN ('issued','verifying','consumed','rejected','revoked','expired')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    receipt_id UUID UNIQUE,
    confirmed_at TIMESTAMPTZ,
    CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
    CHECK((lease_token IS NULL)=(lease_until IS NULL)),
    CHECK((state='verifying')=(lease_token IS NOT NULL)),
    CHECK((receipt_id IS NULL)=(confirmed_at IS NULL)),
    CHECK((state='consumed')=(receipt_id IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS president_challenges_batch ON president_challenges(batch_id,created_at);
  CREATE TABLE IF NOT EXISTS admin_referral_requests (
    actor_id INTEGER NOT NULL REFERENCES admin_users(id), request_id UUID NOT NULL,
    input_hash TEXT NOT NULL, referrer_id INTEGER NOT NULL REFERENCES referrers(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS admin_referral_mutations (
    actor_id INTEGER NOT NULL REFERENCES admin_users(id), request_id UUID NOT NULL,
    input_hash TEXT NOT NULL, referrer_id INTEGER NOT NULL REFERENCES referrers(id),
    result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS admin_domain_catalog_requests (
    actor_id INTEGER NOT NULL REFERENCES admin_users(id), request_id UUID NOT NULL,
    input_hash TEXT NOT NULL, domain TEXT NOT NULL REFERENCES institutional_domains(domain),
    result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS admin_reset (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expira_em TIMESTAMPTZ NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS admin_stepup (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    sessao_id INTEGER NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    expira_em TIMESTAMPTZ NOT NULL,
    tentativas INTEGER NOT NULL DEFAULT 0,
    usado BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS admin_stepup_sessao ON admin_stepup(sessao_id);
  CREATE TABLE IF NOT EXISTS contact_replies (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    rodada INTEGER NOT NULL DEFAULT 1,
    versao TEXT NOT NULL CHECK (versao IN ('texto','card')),
    user_id INTEGER,
    por TEXT,
    assunto TEXT NOT NULL,
    codigo_pessoal TEXT,
    agendada BOOLEAN NOT NULL DEFAULT false,
    ok BOOLEAN NOT NULL DEFAULT false,
    erro TEXT,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contact_id, rodada, versao)
  );
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'legacy' CHECK (estado IN ('legacy','prepared','blocked','sending','accepted','uncertain','rejected'));
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS payload JSONB;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS selo TEXT;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS attempt_id TEXT;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contact_replies ADD COLUMN IF NOT EXISTS error_code TEXT;
  CREATE INDEX IF NOT EXISTS contact_replies_due ON contact_replies(estado,due_at);
  CREATE TABLE IF NOT EXISTS contact_drafts (
    contact_id INTEGER PRIMARY KEY REFERENCES contact_messages(id), id UUID NOT NULL UNIQUE,
    revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('stored','discarded','expired')),
    content_cipher TEXT, created_by INTEGER NOT NULL REFERENCES admin_users(id), updated_by INTEGER NOT NULL REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
    CHECK((state='stored' AND content_cipher IS NOT NULL) OR (state<>'stored' AND content_cipher IS NULL))
  );
  CREATE INDEX IF NOT EXISTS contact_drafts_expiry ON contact_drafts(expires_at) WHERE state='stored';
  CREATE TABLE IF NOT EXISTS contact_campus_reviews (
    id SERIAL PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contact_messages(id),
    triage_job_id INTEGER NOT NULL REFERENCES contact_triage_jobs(id), revision INTEGER NOT NULL,
    previous_id INTEGER REFERENCES contact_campus_reviews(id), proposal JSONB NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), source_reviewed BOOLEAN NOT NULL,
    created_by INTEGER NOT NULL REFERENCES admin_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    intent_hash TEXT NOT NULL UNIQUE, UNIQUE(contact_id,revision),
    CHECK(decision<>'approved' OR source_reviewed)
  );
  CREATE INDEX IF NOT EXISTS contact_campus_review_history ON contact_campus_reviews(contact_id,id DESC);
  CREATE TABLE IF NOT EXISTS admin_ai_requests (
    id UUID PRIMARY KEY, request_id UUID NOT NULL, created_by INTEGER NOT NULL REFERENCES admin_users(id),
    day DATE NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('painel','divulgacao','atendimento')),
    configuration_revision INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    context_hash TEXT NOT NULL, source_versions JSONB NOT NULL, input_bytes INTEGER NOT NULL CHECK(input_bytes>0),
    reserved_output_tokens INTEGER NOT NULL CHECK(reserved_output_tokens BETWEEN 16 AND 4096),
    state TEXT NOT NULL CHECK(state IN ('reserved','completed','rejected','uncertain','discarded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    input_tokens INTEGER CHECK(input_tokens>=0), output_tokens INTEGER CHECK(output_tokens>=0),
    provider_response_id TEXT, error_code TEXT, UNIQUE(created_by,request_id)
  );
  CREATE INDEX IF NOT EXISTS admin_ai_request_budget ON admin_ai_requests(day);
  CREATE INDEX IF NOT EXISTS admin_ai_request_history ON admin_ai_requests(created_at DESC,id);
  CREATE TABLE IF NOT EXISTS admin_acoes (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id INTEGER,
    email TEXT,
    acao TEXT NOT NULL,
    parametros JSONB,
    modo TEXT NOT NULL,
    resultado JSONB,
    ok BOOLEAN NOT NULL DEFAULT false
  );
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_estado TEXT NOT NULL DEFAULT 'legacy' CHECK (central_estado IN ('legacy','solicitado','concluido','aceito','falhou','indeterminado'));
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_transacional BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_fim TIMESTAMPTZ;
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_request_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS admin_acoes_central_request ON admin_acoes(central_request_id) WHERE central_request_id IS NOT NULL;
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_simulacao_hash TEXT;
  ALTER TABLE admin_acoes ADD COLUMN IF NOT EXISTS central_simulacao_id INTEGER REFERENCES admin_acoes(id);
  CREATE UNIQUE INDEX IF NOT EXISTS admin_acoes_central_intent ON admin_acoes(central_simulacao_id) WHERE modo='executar' AND central_simulacao_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS admin_acoes_central_pendente ON admin_acoes(acao) WHERE modo='executar' AND central_estado IN ('solicitado','indeterminado');
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    ts TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    session_id TEXT,
    type TEXT NOT NULL,
    path TEXT,
    target TEXT,
    label TEXT,
    ref_code TEXT,
    ip TEXT,
    ip_version INTEGER,
    country TEXT,
    region TEXT,
    city TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    isp TEXT,
    asn INTEGER,
    os TEXT,
    browser TEXT,
    device TEXT,
    is_bot BOOLEAN NOT NULL DEFAULT false,
    ua TEXT,
    lang TEXT,
    screen TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ev_visitor ON events(visitor_id, ts);
  CREATE INDEX IF NOT EXISTS idx_ev_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_ev_ref ON events(ref_code, type);
  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    ts TEXT NOT NULL,
    event TEXT NOT NULL,
    signature_id INTEGER,
    data TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
`;

export function getPool(): Pool {
  if (!g.__pool) {
    const schema = process.env.DATABASE_SCHEMA;
    g.__pool = new Pool({
      connectionString: config.databaseUrl(),
      max: 10,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
  }
  return g.__pool;
}

/**
 * Domínios de e-mail das IFES (sigla.br / sigla.edu.br com servidor de e-mail ativo), já aprovados: servidor de IFES com e-mail .edu.br de instituto federal não pode ser barrado.
 * Domínio que um visitante já tinha digitado e ficou "pendente" na curadoria (ex.: ifc.edu.br) é promovido a aprovado; decisão manual (aprovado ou rejeitado) nunca é alterada.
 * Quem já assinou com um domínio recém-aprovado e ainda não tinha classificação passa a constar com o domínio e a instituição (a categoria escolhida não muda).
 */
export async function seedIfesDomains(): Promise<void> {
  const rows = ifesDomains as { domain: string; acronym: string; institution: string }[];
  const r = await getPool().query<{ domain: string; institution: string }>(
    `INSERT INTO institutional_domains(domain,kind,institution,acronym,source,status,decided_by)
     SELECT d,'ifes',n,a,'derivado-ifes','approved','semente-ifes' FROM unnest($1::text[],$2::text[],$3::text[]) AS t(d,a,n)
     ON CONFLICT (domain) DO UPDATE SET kind='ifes', institution=EXCLUDED.institution, acronym=EXCLUDED.acronym, status='approved', decided_by='semente-ifes',
       updated_at=to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE institutional_domains.status = 'pending'
     RETURNING domain, institution`,
    [rows.map((x) => x.domain), rows.map((x) => x.acronym), rows.map((x) => x.institution)]
  );
  for (const x of r.rows) {
    await getPool().query(
      "UPDATE signatures SET email_domain_kind='ifes', email_domain=$1, email_institution=$2 WHERE email_domain_kind IS NULL AND lower(split_part(email,'@',2)) = $1",
      [x.domain, x.institution]);
  }
}

/** Assinaturas já confirmadas ganham número (por ordem de confirmação) e código de verificação, uma única vez. */
async function backfillSignatureIds(): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE signatures s SET seq = x.n FROM (
      SELECT id, (SELECT COALESCE(MAX(seq),0) FROM signatures) + ROW_NUMBER() OVER (ORDER BY confirmed_at, id) AS n
      FROM signatures WHERE status='confirmed' AND seq IS NULL) x WHERE s.id = x.id`);
  await pool.query(`SELECT setval('signature_seq', GREATEST((SELECT COALESCE(MAX(seq),0) FROM signatures), 1), (SELECT COALESCE(MAX(seq),0) FROM signatures) > 0)`);
  const miss = await pool.query<{ id: number }>("SELECT id FROM signatures WHERE status='confirmed' AND verify_code IS NULL");
  for (const r of miss.rows) await pool.query("UPDATE signatures SET verify_code=$1 WHERE id=$2 AND verify_code IS NULL", [newVerifyCode(), r.id]);
}

function init(): Promise<void> {
  if (!g.__ready) {
    g.__ready = getPool()
      .query(SCHEMA_SQL)
      .then(() => seedIfesDomains())
      .then(() => backfillSignatureIds())
      .catch((e) => {
        g.__ready = null;
        throw e;
      });
  }
  return g.__ready;
}

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = [], client?: PoolClient): Promise<QueryResult<T>> {
  await init();
  return (client ?? getPool()).query<T>(text, params);
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await init();
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Só para testes: usa um schema próprio para isolar cada teste. */
export async function _openForTests(schema: string) {
  await _closeDbForTests();
  const boot = new Pool({ connectionString: config.databaseUrl() });
  await boot.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); // começa limpo (um teste anterior que falhou pode ter deixado dados)
  await boot.query(`CREATE SCHEMA ${schema}`);
  await boot.end();
  process.env.DATABASE_SCHEMA = schema;
}

export async function _closeDbForTests() {
  const schema = process.env.DATABASE_SCHEMA;
  if (g.__pool) await g.__pool.end();
  g.__pool = null;
  g.__ready = null;
  if (schema) {
    const boot = new Pool({ connectionString: config.databaseUrl() });
    await boot.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await boot.end();
    delete process.env.DATABASE_SCHEMA;
  }
}

export const auditHash = (prev: string, ts: string, event: string, sigId: number | null, data: string) =>
  createHash("sha256").update(`${prev}|${ts}|${event}|${sigId ?? ""}|${data}`).digest("hex");

/** Trilha de auditoria encadeada por hash: alterar uma linha invalida as seguintes. */
export async function audit(event: string, signatureId: number | null, data: Record<string, unknown> = {}, client?: PoolClient) {
  const run = async (c: PoolClient) => {
    await c.query("SELECT pg_advisory_xact_lock(7001)"); // serializa a escrita da cadeia
    const last = await c.query<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prev = last.rows[0]?.hash ?? "GENESIS";
    const ts = new Date().toISOString();
    const json = JSON.stringify(data);
    await c.query("INSERT INTO audit_log (ts,event,signature_id,data,prev_hash,hash) VALUES ($1,$2,$3,$4,$5,$6)", [
      ts, event, signatureId, json, prev, auditHash(prev, ts, event, signatureId, json),
    ]);
  };
  if (client) return run(client);
  return tx(run);
}

export async function verifyAuditChain(): Promise<{ ok: boolean; brokenAt?: number }> {
  const { rows } = await query<{ id: number; ts: string; event: string; signature_id: number | null; data: string; prev_hash: string; hash: string }>(
    "SELECT id,ts,event,signature_id,data,prev_hash,hash FROM audit_log ORDER BY id"
  );
  let prev = "GENESIS";
  for (const r of rows) {
    if (r.prev_hash !== prev || r.hash !== auditHash(prev, r.ts, r.event, r.signature_id, r.data)) {
      return { ok: false, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { ok: true };
}
