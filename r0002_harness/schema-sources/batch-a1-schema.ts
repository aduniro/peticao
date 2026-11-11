export const BATCH_A1_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS batch_a1_jobs (
    id UUID PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
    request_id UUID NOT NULL, request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
    actor_id INTEGER NOT NULL REFERENCES admin_users(id), actor_email TEXT NOT NULL,
    session_id INTEGER NOT NULL, authorization_id UUID NOT NULL UNIQUE,
    authorized_at TIMESTAMPTZ NOT NULL, authorization_expires_at TIMESTAMPTZ NOT NULL,
    input_artifact_version_id UUID NOT NULL REFERENCES batch_document_versions(id),
    input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
    input_byte_length INTEGER NOT NULL CHECK(input_byte_length>0 AND input_byte_length<=26214400),
    document_version TEXT NOT NULL CHECK(document_version ~ '^[a-f0-9]{64}$'),
    list_hash TEXT NOT NULL, batch_revision TEXT NOT NULL,
    credential_version_id UUID NOT NULL, profile_version TEXT NOT NULL,
    trust_store_version TEXT NOT NULL CHECK(trust_store_version ~ '^[a-f0-9]{64}$'),
    expected_cnpj TEXT NOT NULL CHECK(expected_cnpj='15883671000115'),
    certificate_fingerprint_sha256 TEXT NOT NULL CHECK(certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
    policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
    policy_fingerprint TEXT NOT NULL CHECK(policy_fingerprint ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','validating','succeeded','failed','stale','cancelled')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    lease_token UUID, lease_until TIMESTAMPTZ,
    error_code TEXT CHECK(error_code IS NULL OR error_code IN ('signing_failed','validation_failed','worker_unavailable','result_uncertain','input_mismatch','authorization_changed','policy_changed','document_changed','attempt_limit')),
    output_version_id UUID REFERENCES batch_document_versions(id),
    output_sha256 TEXT CHECK(output_sha256 IS NULL OR output_sha256 ~ '^[a-f0-9]{64}$'),
    validation_report_id UUID, completed_lease_token_sha256 TEXT CHECK(completed_lease_token_sha256 IS NULL OR completed_lease_token_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(actor_id,request_id),
    UNIQUE(batch_id,input_artifact_version_id,credential_version_id,profile_version,authorization_id),
    CHECK(authorization_expires_at>authorized_at AND authorization_expires_at<=authorized_at+interval '10 minutes'),
    CHECK((state IN ('running','validating') AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (state NOT IN ('running','validating') AND lease_token IS NULL AND lease_until IS NULL)),
    CHECK((state='succeeded' AND output_version_id IS NOT NULL AND output_sha256 IS NOT NULL AND validation_report_id IS NOT NULL)
      OR (state<>'succeeded' AND output_version_id IS NULL AND output_sha256 IS NULL AND validation_report_id IS NULL))
  );
  ALTER TABLE batch_a1_jobs ADD COLUMN IF NOT EXISTS completed_lease_token_sha256 TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS batch_a1_active_batch ON batch_a1_jobs(batch_id) WHERE state IN ('queued','running','validating');
  CREATE INDEX IF NOT EXISTS batch_a1_actor_requests ON batch_a1_jobs(actor_id,created_at);
  CREATE OR REPLACE FUNCTION preserve_batch_a1_binding() RETURNS trigger LANGUAGE plpgsql AS $a1_binding$
  BEGIN
    IF (to_jsonb(NEW)-ARRAY['state','revision','attempts','lease_token','lease_until','error_code','output_version_id','output_sha256','validation_report_id','completed_lease_token_sha256','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','attempts','lease_token','lease_until','error_code','output_version_id','output_sha256','validation_report_id','completed_lease_token_sha256','updated_at'])
      THEN RAISE EXCEPTION 'batch_a1_binding_immutable'; END IF;
    RETURN NEW;
  END; $a1_binding$;
  DO $a1_trigger$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='batch_a1_jobs'::regclass AND tgname='batch_a1_binding_immutable') THEN
      CREATE TRIGGER batch_a1_binding_immutable BEFORE UPDATE ON batch_a1_jobs FOR EACH ROW EXECUTE FUNCTION preserve_batch_a1_binding();
    END IF;
  END; $a1_trigger$;

  CREATE TABLE IF NOT EXISTS batch_a1_validations (
    id UUID PRIMARY KEY, job_id UUID NOT NULL UNIQUE REFERENCES batch_a1_jobs(id),
    output_version_id UUID NOT NULL REFERENCES batch_document_versions(id),
    output_sha256 TEXT NOT NULL CHECK(output_sha256 ~ '^[a-f0-9]{64}$'),
    input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
    metadata JSONB NOT NULL CHECK(jsonb_typeof(metadata)='object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(job_id,output_sha256),
    UNIQUE(id,job_id,output_sha256)
  );
  CREATE OR REPLACE FUNCTION preserve_batch_a1_validation() RETURNS trigger LANGUAGE plpgsql AS $a1_validation$
  BEGIN RAISE EXCEPTION 'batch_a1_validation_immutable'; END; $a1_validation$;
  DO $a1_validation_trigger$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='batch_a1_validations'::regclass AND tgname='batch_a1_validation_immutable') THEN
      CREATE TRIGGER batch_a1_validation_immutable BEFORE UPDATE OR DELETE ON batch_a1_validations FOR EACH ROW EXECUTE FUNCTION preserve_batch_a1_validation();
      CREATE TRIGGER batch_a1_validation_no_truncate BEFORE TRUNCATE ON batch_a1_validations FOR EACH STATEMENT EXECUTE FUNCTION preserve_batch_a1_validation();
    END IF;
  END; $a1_validation_trigger$;
  DO $a1_report_fk$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='batch_a1_jobs'::regclass AND conname='batch_a1_report_binding_fk') THEN
      ALTER TABLE batch_a1_jobs ADD CONSTRAINT batch_a1_report_binding_fk FOREIGN KEY(validation_report_id,id,output_sha256) REFERENCES batch_a1_validations(id,job_id,output_sha256);
    END IF;
  END; $a1_report_fk$;
`;
