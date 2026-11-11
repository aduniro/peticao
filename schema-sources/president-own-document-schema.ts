export const PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL = String.raw`
-- Additive only. Run inside the bootstrap/migration transaction, never on app import.
CREATE TABLE IF NOT EXISTS president_own_document_intents (
  id UUID PRIMARY KEY,
  requested_by INTEGER NOT NULL REFERENCES admin_users(id),
  request_id UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  receipt_id UUID NOT NULL,
  document_version TEXT NOT NULL CHECK(document_version ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(requested_by,request_id)
);
CREATE TABLE IF NOT EXISTS president_own_document_artifacts (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'president-own' CHECK(source='president-own'),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  challenge_id UUID NOT NULL REFERENCES president_challenges(id),
  receipt_id UUID NOT NULL,
  document_version TEXT NOT NULL CHECK(document_version ~ '^[a-f0-9]{64}$'),
  source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_digest TEXT NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  evidence_canonical TEXT NOT NULL CHECK(octet_length(evidence_canonical) BETWEEN 1 AND 4096),
  bytes BYTEA NOT NULL CHECK(octet_length(bytes) BETWEEN 16 AND 26214400 AND substring(bytes FROM 1 FOR 5)=decode('255044462d','hex')),
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  created_by INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(batch_id,receipt_id,document_version,evidence_digest)
);
CREATE TABLE IF NOT EXISTS president_own_document_results (
  intent_id UUID PRIMARY KEY REFERENCES president_own_document_intents(id),
  state TEXT NOT NULL CHECK(state IN ('completed','failed')),
  artifact_id UUID REFERENCES president_own_document_artifacts(id),
  failure_kind TEXT CHECK(failure_kind IN ('capture_unavailable','render_failed','context_changed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK((state='completed' AND artifact_id IS NOT NULL AND failure_kind IS NULL) OR (state='failed' AND artifact_id IS NULL AND failure_kind IS NOT NULL))
);
CREATE OR REPLACE FUNCTION reject_president_own_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'president own document journal is immutable'; END;
$$;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['president_own_document_intents','president_own_document_artifacts','president_own_document_results'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=table_name::regclass AND tgname='president_own_immutable') THEN
      EXECUTE format('CREATE TRIGGER president_own_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_president_own_mutation()',table_name);
    END IF;
  END LOOP;
END; $$;
-- No INSERT/UPDATE of batches or batch_document_versions. Receipt and original are retained.
`;
