/** Additive schema; immutable reference reservation and one exact final binary binding. */
export const DOCUMENT_REFERENCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS document_references (
 id UUID PRIMARY KEY,
 batch_id INTEGER NOT NULL UNIQUE REFERENCES batches(id),
 origin TEXT NOT NULL,
 created_by INTEGER REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS document_reference_bindings (
 reference_id UUID PRIMARY KEY REFERENCES document_references(id),
 version_id UUID NOT NULL UNIQUE REFERENCES batch_document_versions(id),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bound_by INTEGER NOT NULL REFERENCES admin_users(id),
 bound_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION document_reference_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'document_reference_immutable'; END $$;
DROP TRIGGER IF EXISTS document_references_immutable ON document_references;
CREATE TRIGGER document_references_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON document_references FOR EACH STATEMENT EXECUTE FUNCTION document_reference_immutable();
DROP TRIGGER IF EXISTS document_reference_bindings_immutable ON document_reference_bindings;
CREATE TRIGGER document_reference_bindings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON document_reference_bindings FOR EACH STATEMENT EXECUTE FUNCTION document_reference_immutable();
CREATE OR REPLACE FUNCTION document_reference_binding_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM document_references r JOIN batch_document_versions v ON v.batch_id=r.batch_id WHERE r.id=NEW.reference_id AND v.id=NEW.version_id AND v.sha256=NEW.sha256) THEN
  RAISE EXCEPTION 'document_reference_binding_mismatch';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS document_reference_binding_matches ON document_reference_bindings;
CREATE TRIGGER document_reference_binding_matches BEFORE INSERT ON document_reference_bindings FOR EACH ROW EXECUTE FUNCTION document_reference_binding_matches();
`;
