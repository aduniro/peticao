/** Private immutable artifacts and verifier evidence; selection and packaging remain separate. */
export const PETITION_BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS petition_base_artifacts (
 id UUID PRIMARY KEY,
 bytes BYTEA NOT NULL CHECK(octet_length(bytes) BETWEEN 16 AND 26214400),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 uploaded_by INTEGER NOT NULL REFERENCES admin_users(id),
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS petition_base_upload_requests (
 actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 request_id UUID NOT NULL,
 input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 artifact_id UUID NOT NULL UNIQUE REFERENCES petition_base_artifacts(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
CREATE OR REPLACE FUNCTION petition_base_upload_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'petition_base_upload_immutable'; END $$;
DROP TRIGGER IF EXISTS petition_base_artifacts_immutable ON petition_base_artifacts;
CREATE TRIGGER petition_base_artifacts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_artifacts FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();
DROP TRIGGER IF EXISTS petition_base_upload_requests_immutable ON petition_base_upload_requests;
CREATE TRIGGER petition_base_upload_requests_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_upload_requests FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();

CREATE UNIQUE INDEX IF NOT EXISTS petition_base_artifacts_id_sha256_uq ON petition_base_artifacts(id,sha256);
CREATE TABLE IF NOT EXISTS petition_base_validations (
 id UUID PRIMARY KEY,
 artifact_id UUID NOT NULL,
 artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 petition_text_version TEXT NOT NULL CHECK(petition_text_version ~ '^[a-f0-9]{64}$'),
 responsible_id INTEGER NOT NULL REFERENCES admin_users(id),
 profile_revision INTEGER NOT NULL CHECK(profile_revision>0),
 signer_cpf_hash TEXT NOT NULL CHECK(signer_cpf_hash ~ '^[a-f0-9]{64}$'),
 binding_sha256 TEXT NOT NULL CHECK(binding_sha256 ~ '^[a-f0-9]{64}$'),
 report_sha256 TEXT NOT NULL CHECK(report_sha256 ~ '^[a-f0-9]{64}$'),
 validator_configuration_sha256 TEXT CHECK(validator_configuration_sha256 IS NULL OR validator_configuration_sha256 ~ '^[a-f0-9]{64}$'),
 report JSONB NOT NULL CHECK((jsonb_typeof(report)='object' AND report->>'protocol'='peticao-base-validation' AND report->>'method'='gov-br-advanced' AND report->'valid'='true'::jsonb AND report->>'sha256'=artifact_sha256 AND report->>'signerCpfHash'=signer_cpf_hash AND NOT(report ? 'signerCpf')) IS TRUE),
 created_by INTEGER NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(artifact_id,artifact_sha256) REFERENCES petition_base_artifacts(id,sha256),
 UNIQUE(artifact_id,binding_sha256,report_sha256)
);
DROP TRIGGER IF EXISTS petition_base_validations_immutable ON petition_base_validations;
CREATE TRIGGER petition_base_validations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_validations FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();

ALTER TABLE petition_base_validations ADD COLUMN IF NOT EXISTS validator_configuration_sha256 TEXT CHECK(validator_configuration_sha256 IS NULL OR validator_configuration_sha256 ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS petition_base_validation_artifact_uq ON petition_base_validations(id,artifact_id,artifact_sha256);
CREATE TABLE IF NOT EXISTS petition_base_selections (
 id UUID PRIMARY KEY,
 revision INTEGER NOT NULL UNIQUE CHECK(revision>0),
 previous_revision INTEGER REFERENCES petition_base_selections(revision),
 validation_id UUID NOT NULL,
 artifact_id UUID NOT NULL,
 artifact_sha256 TEXT NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 petition_text_version TEXT NOT NULL CHECK(petition_text_version ~ '^[a-f0-9]{64}$'),
 responsible_id INTEGER NOT NULL REFERENCES admin_users(id),
 profile_revision INTEGER NOT NULL CHECK(profile_revision>0),
 validator_configuration_sha256 TEXT NOT NULL CHECK(validator_configuration_sha256 ~ '^[a-f0-9]{64}$'),
 request_id UUID NOT NULL,
 request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id),
 FOREIGN KEY(validation_id,artifact_id,artifact_sha256) REFERENCES petition_base_validations(id,artifact_id,artifact_sha256),
 CHECK(((revision=1 AND previous_revision IS NULL) OR (revision>1 AND previous_revision=revision-1)) IS TRUE)
);
DROP TRIGGER IF EXISTS petition_base_selections_immutable ON petition_base_selections;
CREATE TRIGGER petition_base_selections_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_selections FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();

-- Attempts and outcomes are append-only: a later failure/pending check supersedes cached success.
CREATE TABLE IF NOT EXISTS petition_base_validation_attempts (
 id UUID PRIMARY KEY,
 ordinal BIGSERIAL NOT NULL UNIQUE,
 artifact_id UUID NOT NULL,
 artifact_sha256 TEXT NOT NULL,
 binding_sha256 TEXT NOT NULL CHECK(binding_sha256 ~ '^[a-f0-9]{64}$'),
 validator_configuration_sha256 TEXT NOT NULL CHECK(validator_configuration_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(artifact_id,artifact_sha256) REFERENCES petition_base_artifacts(id,sha256)
);
CREATE INDEX IF NOT EXISTS petition_base_validation_attempt_latest ON petition_base_validation_attempts(artifact_id,ordinal DESC);
CREATE TABLE IF NOT EXISTS petition_base_validation_results (
 attempt_id UUID PRIMARY KEY REFERENCES petition_base_validation_attempts(id),
 state TEXT NOT NULL CHECK(state IN ('valid','rejected','unavailable')),
 validation_id UUID REFERENCES petition_base_validations(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='valid' AND validation_id IS NOT NULL) OR (state<>'valid' AND validation_id IS NULL))
);
DROP TRIGGER IF EXISTS petition_base_validation_attempts_immutable ON petition_base_validation_attempts;
CREATE TRIGGER petition_base_validation_attempts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_validation_attempts FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();
DROP TRIGGER IF EXISTS petition_base_validation_results_immutable ON petition_base_validation_results;
CREATE TRIGGER petition_base_validation_results_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_validation_results FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();
`;
