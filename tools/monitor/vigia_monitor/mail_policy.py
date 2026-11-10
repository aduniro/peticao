"""Owner-controlled notification policy; does not change task events or execution."""
import datetime as dt

QUIET_KEY = "owner_quiet_until_utc"
SUMMARY_KEY = "owner_hourly_tree_reports"


def parse_utc(value):
 try:
  parsed=dt.datetime.fromisoformat(value.replace("Z","+00:00"))
  return parsed if parsed.tzinfo is not None else None
 except (ValueError,TypeError,AttributeError):return None


def suppress_mail(db,row,at):
 policy=db.execute("SELECT value FROM meta WHERE key=?",(QUIET_KEY,)).fetchone()
 cutoff=parse_utc(policy[0]) if policy else None
 if not cutoff:return False
 current=parse_utc(at);created=parse_utc(row['at'])
 # A queued message created during the quiet interval is retired, not sent in a
 # burst when the collector or network returns after the cutoff.
 if current and (current<cutoff or (created and created<cutoff)):
  db.execute("UPDATE outbox SET state='suppressed',updated_at=? WHERE id=?",(at,row['id']))
  db.execute("INSERT OR REPLACE INTO mail VALUES(?,?,?,?,?,?)",(row['id'],at,row['subject'],'suppressed',None,'Aviso suprimido por solicitação do responsável até '+cutoff.isoformat()+'. Evento original preservado; sem reenvio posterior.'))
  return True
 return False


def hourly_tree_owns_summary(store):
 return bool(store.rows("SELECT 1 FROM meta WHERE key=? AND value='1'",(SUMMARY_KEY,)))
