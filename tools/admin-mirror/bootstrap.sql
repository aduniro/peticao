-- Run only against the new local preview database, using its import owner.
-- This file must never be applied to the production database.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='admin_mirror_reader') THEN
    CREATE ROLE admin_mirror_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.admin_mirror_state (
  singleton boolean PRIMARY KEY CHECK (singleton),
  revision text NOT NULL,
  captured_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.admin_mirror_access_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  event text NOT NULL,
  signature_id integer,
  data jsonb NOT NULL
);
GRANT USAGE ON SCHEMA public TO admin_mirror_reader;
GRANT SELECT ON public.admin_mirror_state TO admin_mirror_reader;
GRANT INSERT(ts,event,signature_id,data) ON public.admin_mirror_access_log TO admin_mirror_reader;
GRANT USAGE ON SEQUENCE public.admin_mirror_access_log_id_seq TO admin_mirror_reader;
