/** Private upload staging only: no row in these tables proves a gov.br signature. */
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
`;
