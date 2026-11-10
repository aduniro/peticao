-- Fixed rollback fence, only after the app and scheduler consumers have stopped.
-- No app.env, provider key, plaintext message or signature row is read.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $guard$
DECLARE
  has_messages boolean := to_regclass('mail_messages') IS NOT NULL;
  has_link boolean := EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mail_outbox' AND column_name='message_id');
  accepted_ids integer[];
  held_ids integer[];
  previous_hash text;
  stamp text;
  detail text;
  digest text;
BEGIN
  -- An old sender has no v2 envelope/intent support. Never downgrade an unresolved package.
  IF to_regclass('batch_packages') IS NOT NULL THEN
    IF to_regclass('batches') IS NULL THEN RAISE EXCEPTION 'unsupported_batch_rollback_schema'; END IF;
    LOCK TABLE batches IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE batch_packages IN SHARE MODE;
    IF EXISTS(SELECT 1 FROM batch_packages p JOIN batches b ON b.id=p.batch_id WHERE b.status NOT IN ('sent','cancelled')) THEN
      RAISE EXCEPTION 'batch_package_rollback_blocked';
    END IF;
  END IF;
  IF NOT has_messages AND NOT has_link THEN RETURN; END IF;
  IF NOT has_messages OR NOT has_link OR to_regclass('mail_message_attempts') IS NULL THEN RAISE EXCEPTION 'unsupported_mail_rollback_schema'; END IF;
  -- The managed app is stopped. Serialize all updates and the existing audit chain.
  LOCK TABLE mail_outbox IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(7001);
  WITH settled AS (
    UPDATE mail_outbox q SET status='sent',last_error=NULL,
      sent_at=COALESCE(q.sent_at,(SELECT max(a.finished_at) FROM mail_message_attempts a WHERE a.message_id=q.message_id AND a.state='accepted'))
    FROM mail_messages m WHERE q.status='pending' AND q.message_id=m.id AND m.status='accepted'
      AND m.channel='transactional' AND m.kind=q.kind AND m.to_addr=lower(q.to_addr)
      AND EXISTS(SELECT 1 FROM mail_message_attempts a WHERE a.message_id=m.id AND a.state='accepted' AND a.finished_at IS NOT NULL)
    RETURNING q.id
  ) SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::integer[]) INTO accepted_ids FROM settled;
  WITH held AS (
    UPDATE mail_outbox SET status='failed',last_error='mail_rollback_quarantine'
      WHERE status='pending' AND message_id IS NOT NULL RETURNING id
  ) SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::integer[]) INTO held_ids FROM held;
  IF cardinality(accepted_ids)+cardinality(held_ids)=0 THEN RETURN; END IF;
  SELECT hash INTO previous_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  previous_hash:=COALESCE(previous_hash,'GENESIS');
  stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  detail:=json_build_object('acceptedQueueIds',accepted_ids,'quarantinedQueueIds',held_ids,'by','fixed-root-rollback-guard')::text;
  digest:=encode(sha256(convert_to(previous_hash||'|'||stamp||'|mail_rollback_guard||'||detail,'UTF8')),'hex');
  INSERT INTO audit_log(ts,event,signature_id,data,prev_hash,hash) VALUES(stamp,'mail_rollback_guard',NULL,detail,previous_hash,digest);
END
$guard$;
COMMIT;
