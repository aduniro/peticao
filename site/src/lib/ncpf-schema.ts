/** Additive schema, applied offline in production; no runtime DDL authority. */
export const NCPF_SCHEMA_SQL = `
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS declared_name TEXT;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS name_source TEXT;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS name_evidence_id UUID;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS api_name_snapshot TEXT;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS name_projected_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS ncpf_evidence (
  id UUID PRIMARY KEY, cpf_hash TEXT NOT NULL, payload TEXT NOT NULL,
  document_sha256 TEXT NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
  document_bytes BYTEA NOT NULL, fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, last_verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cpf_hash,document_sha256), CHECK(expires_at>fetched_at)
);
CREATE INDEX IF NOT EXISTS ncpf_evidence_lookup ON ncpf_evidence(cpf_hash,fetched_at DESC);
CREATE TABLE IF NOT EXISTS ncpf_evidence_observations (
  evidence_id UUID NOT NULL REFERENCES ncpf_evidence(id), verified_at TIMESTAMPTZ NOT NULL,
  origin_digest TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(evidence_id,verified_at)
);
CREATE TABLE IF NOT EXISTS ncpf_jobs (
  id UUID PRIMARY KEY, cpf_hash TEXT NOT NULL, payload TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('interactive','consolidation')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','retry','done','not_found')),
  attempts INTEGER NOT NULL DEFAULT 0, next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT, lease_until TIMESTAMPTZ, last_error TEXT,
  evidence_id UUID REFERENCES ncpf_evidence(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ncpf_one_active_job ON ncpf_jobs(cpf_hash) WHERE state IN ('queued','running','retry');
CREATE INDEX IF NOT EXISTS ncpf_job_schedule ON ncpf_jobs(next_run_at,created_at) WHERE state IN ('queued','retry','running');
CREATE TABLE IF NOT EXISTS ncpf_intents (
  id UUID PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, binding_hash TEXT NOT NULL,
  cpf_hash TEXT NOT NULL, declared_name TEXT NOT NULL, visitor_hash TEXT NOT NULL,
  security_passed BOOLEAN NOT NULL, job_id UUID REFERENCES ncpf_jobs(id),
  evidence_id UUID REFERENCES ncpf_evidence(id), expires_at TIMESTAMPTZ NOT NULL,
  rejected_recorded BOOLEAN NOT NULL DEFAULT false, api_name_payload TEXT, ticket_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ncpf_candidates (
  signature_id INTEGER PRIMARY KEY REFERENCES signatures(id) ON DELETE CASCADE,
  cpf_hash TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ncpf_intents_expiry ON ncpf_intents(expires_at);
CREATE INDEX IF NOT EXISTS ncpf_intents_ticket ON ncpf_intents(ticket_hash) WHERE ticket_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS signature_name_history (
  id BIGSERIAL PRIMARY KEY, signature_id INTEGER NOT NULL REFERENCES signatures(id),
  previous_name TEXT NOT NULL, selected_name TEXT NOT NULL,
  evidence_id UUID NOT NULL REFERENCES ncpf_evidence(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signup_receipts (
  request_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('working','done','uncertain')),
  response JSONB, lease_until TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS confirmation_receipts (
  token_hash TEXT PRIMARY KEY, signature_id INTEGER NOT NULL REFERENCES signatures(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
`;
