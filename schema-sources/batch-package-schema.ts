/** Package versions are immutable evidence. No row approves a batch or dispatches an email. */
export const BATCH_PACKAGE_SCHEMA_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS package_selection_artifact_uq ON petition_base_selections(id,artifact_id,artifact_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS package_signed_document_uq ON batch_document_versions(id,batch_id,sha256,variant,signature_kind);
CREATE TABLE IF NOT EXISTS batch_packages (
 id UUID PRIMARY KEY,
 batch_id INTEGER NOT NULL REFERENCES batches(id),
 ordinal INTEGER NOT NULL CHECK(ordinal>0),
 document_version TEXT NOT NULL CHECK(document_version ~ '^[a-f0-9]{64}$'),
 previous_package_id UUID,
 previous_ordinal INTEGER,
 selection_id UUID NOT NULL,
 base_validation_id UUID NOT NULL,
 base_artifact_id UUID NOT NULL,
 base_sha256 TEXT NOT NULL CHECK(base_sha256 ~ '^[a-f0-9]{64}$'),
 batch_version_id UUID NOT NULL,
 batch_sha256 TEXT NOT NULL CHECK(batch_sha256 ~ '^[a-f0-9]{64}$'),
 batch_variant TEXT NOT NULL DEFAULT 'signed' CHECK(batch_variant='signed'),
 batch_signature_kind TEXT NOT NULL DEFAULT 'icp-brasil' CHECK(batch_signature_kind='icp-brasil'),
 manifest TEXT NOT NULL CHECK(octet_length(manifest) BETWEEN 2 AND 16384),
 package_digest TEXT NOT NULL CHECK(package_digest ~ '^[a-f0-9]{64}$'),
 encoded_budget_bytes INTEGER NOT NULL CHECK(encoded_budget_bytes BETWEEN 4097 AND 104857600),
 reserved_envelope_bytes INTEGER NOT NULL CHECK(reserved_envelope_bytes>=0 AND reserved_envelope_bytes<encoded_budget_bytes),
 actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 request_id UUID NOT NULL,
 request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id),
 UNIQUE(batch_id,document_version,ordinal),
 UNIQUE(id,batch_id,document_version,ordinal),
 FOREIGN KEY(previous_package_id,batch_id,document_version,previous_ordinal) REFERENCES batch_packages(id,batch_id,document_version,ordinal),
 FOREIGN KEY(selection_id,base_artifact_id,base_sha256) REFERENCES petition_base_selections(id,artifact_id,artifact_sha256),
 FOREIGN KEY(base_validation_id,base_artifact_id,base_sha256) REFERENCES petition_base_validations(id,artifact_id,artifact_sha256),
 FOREIGN KEY(batch_version_id,batch_id,batch_sha256,batch_variant,batch_signature_kind) REFERENCES batch_document_versions(id,batch_id,sha256,variant,signature_kind),
 CHECK(((ordinal=1 AND previous_package_id IS NULL AND previous_ordinal IS NULL) OR (ordinal>1 AND previous_package_id IS NOT NULL AND previous_ordinal=ordinal-1)) IS TRUE)
);
CREATE OR REPLACE FUNCTION batch_package_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'batch_package_immutable'; END $$;
DROP TRIGGER IF EXISTS batch_packages_immutable ON batch_packages;
CREATE TRIGGER batch_packages_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON batch_packages FOR EACH STATEMENT EXECUTE FUNCTION batch_package_immutable();
`;
