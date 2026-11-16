-- Isolated coordination metadata. This schema does not dispatch work.
CREATE SCHEMA IF NOT EXISTS peticao_coord;
CREATE TABLE IF NOT EXISTS peticao_coord.migrations (
  version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS peticao_coord.fences;
CREATE TABLE IF NOT EXISTS peticao_coord.agents (
  id text PRIMARY KEY, thread_id text, role text NOT NULL, context_refs jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS peticao_coord.tasks (
  id uuid PRIMARY KEY, namespace text NOT NULL, idem_key text NOT NULL, input_sha256 text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100), assigned_to text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','uncertain','completed','failed','cancelled')),
  context_refs jsonb NOT NULL DEFAULT '[]', evidence_refs jsonb NOT NULL DEFAULT '[]',
  owner text, token_hash text, fence bigint, expires_at timestamptz,
  version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(namespace,idem_key)
);
CREATE INDEX IF NOT EXISTS tasks_active ON peticao_coord.tasks(namespace,status,priority DESC,id)
  WHERE status NOT IN ('completed','cancelled');
CREATE TABLE IF NOT EXISTS peticao_coord.dependencies (
  task_id uuid NOT NULL REFERENCES peticao_coord.tasks(id),
  depends_on uuid NOT NULL REFERENCES peticao_coord.tasks(id),
  PRIMARY KEY(task_id,depends_on), CHECK(task_id <> depends_on)
);
CREATE TABLE IF NOT EXISTS peticao_coord.events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace text NOT NULL,
  task_id uuid REFERENCES peticao_coord.tasks(id), actor text NOT NULL, kind text NOT NULL,
  refs jsonb NOT NULL DEFAULT '[]', fence bigint, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS peticao_coord.decisions (
  id uuid PRIMARY KEY, namespace text NOT NULL, actor text NOT NULL, question text NOT NULL,
  decision text NOT NULL, evidence_refs jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- A read-only projection of metadata from the existing authority. Never copy tokens or resource payloads.
CREATE TABLE IF NOT EXISTS peticao_coord.ledger_snapshots (
  source_id text NOT NULL, watermark bigint NOT NULL, sha256 text NOT NULL,
  summary jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,watermark)
);
