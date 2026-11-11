export const PRESIDENT_OWN_A1_SCHEMA_SQL = String.raw`
-- DRAFT ONLY. Apply after the existing batch_document_versions v2 source guard.
-- Preserve the v2 constraint NAME: older bootstrap checks for it and must not
-- recreate the old restrictive source set on replay over president-own history.
DO $own_a1_source$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='batch_document_versions'::regclass AND conname='batch_document_versions_source_check_v2' AND position('president-own' IN pg_get_constraintdef(oid))>0) THEN
    ALTER TABLE batch_document_versions DROP CONSTRAINT IF EXISTS batch_document_versions_source_check;
    ALTER TABLE batch_document_versions DROP CONSTRAINT IF EXISTS batch_document_versions_source_check_v2;
    ALTER TABLE batch_document_versions ADD CONSTRAINT batch_document_versions_source_check_v2
      CHECK(source IN ('prepared','upload','legacy-observed','a1-worker','president-own'));
  END IF;
END; $own_a1_source$;

CREATE TABLE IF NOT EXISTS president_own_a1_inputs (
  own_artifact_id UUID PRIMARY KEY REFERENCES president_own_document_artifacts(id),
  input_version_id UUID NOT NULL UNIQUE REFERENCES batch_document_versions(id),
  original_version_id UUID NOT NULL REFERENCES batch_document_versions(id),
  created_by INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION reject_president_own_a1_input_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'president own A1 input binding is immutable'; END;
$$;
CREATE OR REPLACE FUNCTION check_president_own_a1_input() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a president_own_document_artifacts%ROWTYPE; v batch_document_versions%ROWTYPE; o batch_document_versions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT a FROM president_own_document_artifacts WHERE id=NEW.own_artifact_id;
  SELECT * INTO STRICT v FROM batch_document_versions WHERE id=NEW.input_version_id;
  SELECT * INTO STRICT o FROM batch_document_versions WHERE id=NEW.original_version_id;
  IF a.source<>'president-own' OR v.source<>'president-own' OR v.variant<>'signed' OR v.signature_kind IS DISTINCT FROM 'own-confirmation'
    OR v.batch_id<>a.batch_id OR o.batch_id<>a.batch_id OR o.source<>'prepared' OR o.variant<>'original'
    OR v.sha256<>a.sha256 OR v.bytes<>a.bytes OR v.list_hash IS DISTINCT FROM (a.evidence_canonical::jsonb->>'listHash')
    OR o.sha256<>a.source_sha256 OR o.list_hash<>v.list_hash THEN
    RAISE EXCEPTION 'president own A1 input provenance mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DO $own_a1_bridge$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='president_own_a1_inputs'::regclass AND tgname='president_own_a1_binding_check') THEN
    CREATE TRIGGER president_own_a1_binding_check BEFORE INSERT ON president_own_a1_inputs FOR EACH ROW EXECUTE FUNCTION check_president_own_a1_input();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='president_own_a1_inputs'::regclass AND tgname='president_own_a1_binding_immutable') THEN
    CREATE TRIGGER president_own_a1_binding_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON president_own_a1_inputs FOR EACH STATEMENT EXECUTE FUNCTION reject_president_own_a1_input_mutation();
  END IF;
END; $own_a1_bridge$;
-- Existing batch_a1_jobs.input_artifact_version_id FK remains unchanged.
-- No UPDATE of batches.pdf/signed_pdf occurs when freezing this input.
`;
