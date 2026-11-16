CREATE TABLE IF NOT EXISTS peticao_coord.queue_snapshots (
  source_id text NOT NULL, watermark bigint NOT NULL, sha256 text NOT NULL,
  metadata jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,watermark)
);
CREATE TABLE IF NOT EXISTS peticao_coord.queue_projection (
  source_id text NOT NULL, external_id text NOT NULL, state text NOT NULL,
  source_generation bigint NOT NULL, payload_digest text NOT NULL,
  source_created_at text NOT NULL, source_updated_at text NOT NULL, watermark bigint NOT NULL,
  PRIMARY KEY(source_id,external_id)
);
