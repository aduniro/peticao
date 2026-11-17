CREATE TABLE IF NOT EXISTS signup_diagnostics (
    id UUID PRIMARY KEY, trace_id UUID NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL, classification TEXT NOT NULL, category TEXT, http_status INTEGER,
    duration_ms INTEGER, learning_index TEXT NOT NULL, policy_version TEXT NOT NULL,
    metadata JSONB NOT NULL, email_cipher TEXT, email_hash TEXT);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_time ON signup_diagnostics(ts DESC,id);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_trace ON signup_diagnostics(trace_id,ts);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_learning ON signup_diagnostics(learning_index,ts);
    CREATE INDEX IF NOT EXISTS signup_diagnostics_expiry ON signup_diagnostics(expires_at)
