/** Additive Materials migration, registered only in the explicit apply bootstrap. */
export const MATERIALS_SCHEMA_SQL = String.raw`
  CREATE TABLE IF NOT EXISTS campaign_materials (
    id UUID PRIMARY KEY,
    revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
    current_version UUID NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_by INTEGER NOT NULL REFERENCES admin_users(id),
    updated_by INTEGER NOT NULL REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  CREATE TABLE IF NOT EXISTS campaign_material_versions (
    id UUID PRIMARY KEY,
    material_id UUID NOT NULL REFERENCES campaign_materials(id),
    ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 2147483646),
    content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
    sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
    archived BOOLEAN NOT NULL,
    author_id INTEGER NOT NULL REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(material_id,ordinal),
    UNIQUE(material_id,id,ordinal,archived)
  );
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='campaign_material_head_version_fk' AND conrelid='campaign_materials'::regclass) THEN
      ALTER TABLE campaign_materials ADD CONSTRAINT campaign_material_head_version_fk
        FOREIGN KEY(id,current_version,revision,archived)
        REFERENCES campaign_material_versions(material_id,id,ordinal,archived)
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END; $$;
  CREATE INDEX IF NOT EXISTS campaign_materials_library ON campaign_materials(archived,id DESC);
  CREATE TABLE IF NOT EXISTS campaign_material_requests (
    actor_id INTEGER NOT NULL REFERENCES admin_users(id),
    request_id UUID NOT NULL,
    fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
    version_id UUID NOT NULL REFERENCES campaign_material_versions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(actor_id,request_id)
  );
  CREATE OR REPLACE FUNCTION campaign_material_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'campaign_material_history_immutable'; END; $$;
  DROP TRIGGER IF EXISTS campaign_material_versions_immutable ON campaign_material_versions;
  CREATE TRIGGER campaign_material_versions_immutable BEFORE UPDATE OR DELETE ON campaign_material_versions
    FOR EACH ROW EXECUTE FUNCTION campaign_material_immutable_version();
  DROP TRIGGER IF EXISTS campaign_material_requests_immutable ON campaign_material_requests;
  CREATE TRIGGER campaign_material_requests_immutable BEFORE UPDATE OR DELETE ON campaign_material_requests
    FOR EACH ROW EXECUTE FUNCTION campaign_material_immutable_version();
  CREATE OR REPLACE FUNCTION campaign_material_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign_material_archive_only'; END IF;
    IF NEW.id<>OLD.id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
      OR NEW.revision<>OLD.revision+1 OR NEW.current_version=OLD.current_version
      OR OLD.archived THEN RAISE EXCEPTION 'campaign_material_invalid_revision'; END IF;
    RETURN NEW;
  END; $$;
  DROP TRIGGER IF EXISTS campaign_material_head_guard ON campaign_materials;
  CREATE TRIGGER campaign_material_head_guard BEFORE UPDATE OR DELETE ON campaign_materials
    FOR EACH ROW EXECUTE FUNCTION campaign_material_head_guard();
`;
