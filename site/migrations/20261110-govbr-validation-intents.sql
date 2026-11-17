-- Additive only. Prerequisite: existing petition-base schema and immutable trigger function.
BEGIN;
-- Additive intent journal; existing immutable attempts are never rewritten.
CREATE TABLE IF NOT EXISTS petition_base_validation_intents (
 request_id UUID PRIMARY KEY,
 attempt_id UUID NOT NULL UNIQUE REFERENCES petition_base_validation_attempts(id),
 actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
DROP TRIGGER IF EXISTS petition_base_validation_intents_immutable ON petition_base_validation_intents;
CREATE TRIGGER petition_base_validation_intents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON petition_base_validation_intents FOR EACH STATEMENT EXECUTE FUNCTION petition_base_upload_immutable();
COMMIT;
